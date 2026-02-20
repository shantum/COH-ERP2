/**
 * Backfill Prepaid Invoices (bulk SQL version)
 *
 * FY 25-26 only (April 2025 – March 2026).
 * 1. Bulk-loads prepaid orders missing customer_order invoices
 * 2. Computes GST in JS
 * 3. Bulk-inserts invoices + lines via raw SQL
 * 4. Bulk-updates orders with settlement fields
 *
 * Usage: npx tsx server/src/scripts/backfillPrepaidInvoices.ts
 *   --limit N     Process only N orders (for testing)
 *   --dry-run     Show what would be processed without making changes
 */

import prisma from '../lib/prisma.js';
import { computeOrderGst, type GstLineInput } from '@coh/shared/domain';
import { dateToPeriod } from '@coh/shared';
import { COMPANY_GST } from '../config/finance/gst.js';
import { getFiscalYear } from '../services/invoiceNumberGenerator.js';
import { randomUUID } from 'crypto';

// FY 25-26 boundaries
const FY_START = new Date('2025-04-01T00:00:00.000Z');
const FY_END = new Date('2026-03-31T23:59:59.999Z');

function escapeSql(str: string): string {
  return str.replace(/'/g, "''");
}

async function main() {
  const args = process.argv.slice(2);
  const limitIdx = args.indexOf('--limit');
  const limit = limitIdx >= 0 ? parseInt(args[limitIdx + 1], 10) : undefined;
  const dryRun = args.includes('--dry-run');

  if (dryRun) console.log('*** DRY RUN — no changes will be made ***\n');

  // 1. Admin user
  const admin = await prisma.user.findFirst({ where: { role: 'admin' } });
  if (!admin) throw new Error('No admin user found');
  console.log(`Admin: ${admin.name ?? admin.email}`);

  // 2. Bulk-load prepaid orders without invoices (FY 25-26 only)
  const orders = await prisma.order.findMany({
    where: {
      paymentMethod: 'Prepaid',
      orderDate: { gte: FY_START, lte: FY_END },
      status: { notIn: ['cancelled'] },
      isArchived: false,
      financeInvoices: { none: { category: 'customer_order' } },
    },
    select: {
      id: true,
      orderNumber: true,
      totalAmount: true,
      orderDate: true,
      customerId: true,
      customerState: true,
      orderLines: {
        where: { lineStatus: { not: 'cancelled' } },
        select: {
          id: true,
          qty: true,
          unitPrice: true,
          sku: {
            select: {
              mrp: true,
              variation: { select: { product: { select: { hsnCode: true } } } },
            },
          },
        },
      },
    },
    orderBy: { createdAt: 'asc' },
    ...(limit ? { take: limit } : {}),
  });

  console.log(`Found ${orders.length} prepaid orders without invoices (FY 25-26)`);
  if (orders.length === 0) {
    console.log('Nothing to do.');
    return;
  }

  if (dryRun) {
    for (const order of orders.slice(0, 20)) {
      console.log(`  Would process: #${order.orderNumber} (₹${order.totalAmount}) — ${order.orderDate.toISOString().slice(0, 10)}`);
    }
    if (orders.length > 20) console.log(`  ... and ${orders.length - 20} more`);
    console.log(`\nTotal: ${orders.length} orders`);
    return;
  }

  // 3. Compute GST and prepare invoice data
  type InvoiceRow = {
    id: string;
    orderId: string;
    orderNumber: string;
    customerId: string | null;
    orderDate: Date;
    subtotal: number;
    gstRate: number;
    gstAmount: number;
    gstType: string;
    cgstAmount: number;
    sgstAmount: number;
    igstAmount: number;
    totalAmount: number;
    lines: Array<{
      id: string;
      description: string;
      hsnCode: string;
      qty: number;
      rate: number;
      amount: number;
      gstPercent: number;
      gstAmount: number;
      orderLineId: string;
    }>;
  };

  const invoiceRows: InvoiceRow[] = [];
  const orderIds: string[] = [];
  let skipped = 0;

  for (const order of orders) {
    if (order.orderLines.length === 0) {
      skipped++;
      continue;
    }

    const gstLines: GstLineInput[] = order.orderLines.map((line) => ({
      amount: line.unitPrice * line.qty,
      mrp: line.sku.mrp,
      qty: line.qty,
      hsnCode: line.sku.variation.product.hsnCode || COMPANY_GST.DEFAULT_HSN,
    }));

    const gst = computeOrderGst(gstLines, order.customerState);
    const invoiceId = randomUUID();

    invoiceRows.push({
      id: invoiceId,
      orderId: order.id,
      orderNumber: order.orderNumber,
      customerId: order.customerId,
      orderDate: order.orderDate,
      subtotal: gst.subtotal,
      gstRate: gst.effectiveGstRate,
      gstAmount: gst.gstAmount,
      gstType: gst.gstType,
      cgstAmount: gst.cgstAmount,
      sgstAmount: gst.sgstAmount,
      igstAmount: gst.igstAmount,
      totalAmount: gst.total,
      lines: order.orderLines.map((line, i) => {
        const gstLine = gst.lines[i];
        return {
          id: randomUUID(),
          description: `Order ${order.orderNumber} — line item`,
          hsnCode: gstLine.hsnCode,
          qty: line.qty,
          rate: line.unitPrice,
          amount: gstLine.taxableValue,
          gstPercent: gstLine.gstRate,
          gstAmount: gstLine.gstAmount,
          orderLineId: line.id,
        };
      }),
    });
    orderIds.push(order.id);
  }

  console.log(`Computed GST for ${invoiceRows.length} orders (${skipped} skipped — no lines)`);

  // 4. Get current invoice sequence number
  const fiscalYear = getFiscalYear();
  const seqResult = await prisma.$queryRaw<Array<{ currentNumber: number }>>`
    SELECT "currentNumber" FROM "InvoiceSequence" WHERE "prefix" = 'COH'
  `;
  const startNumber = seqResult[0].currentNumber;
  console.log(`Current invoice sequence: ${startNumber}, will assign ${startNumber + 1} to ${startNumber + invoiceRows.length}`);

  // 5. Bulk insert invoices + lines via raw SQL
  const CHUNK = 100;
  let inserted = 0;

  for (let i = 0; i < invoiceRows.length; i += CHUNK) {
    const chunk = invoiceRows.slice(i, i + CHUNK);
    const invoiceNumber = (n: number) => `COH/${fiscalYear}/${String(n).padStart(5, '0')}`;

    // Build VALUES for invoices
    const invoiceValues = chunk.map((inv, idx) => {
      const num = startNumber + 1 + i + idx;
      const notes = escapeSql(`Auto-generated from order ${inv.orderNumber} (prepaid backfill)`);
      return `('${inv.id}', 'receivable', 'customer_order', 'paid', '${invoiceNumber(num)}',
        '${inv.orderDate.toISOString()}'::timestamptz, '${dateToPeriod(inv.orderDate)}',
        '${inv.orderId}', ${inv.customerId ? `'${inv.customerId}'` : 'NULL'},
        ${inv.subtotal}, ${inv.gstRate}, ${inv.gstAmount}, '${inv.gstType}',
        ${inv.cgstAmount}, ${inv.sgstAmount}, ${inv.igstAmount},
        ${inv.totalAmount}, 0, ${inv.totalAmount},
        '${admin.id}', '${notes}',
        NOW(), NOW())`;
    }).join(',\n');

    await prisma.$executeRawUnsafe(`
      INSERT INTO "Invoice" (
        "id", "type", "category", "status", "invoiceNumber",
        "invoiceDate", "billingPeriod",
        "orderId", "customerId",
        "subtotal", "gstRate", "gstAmount", "gstType",
        "cgstAmount", "sgstAmount", "igstAmount",
        "totalAmount", "balanceDue", "paidAmount",
        "createdById", "notes",
        "createdAt", "updatedAt"
      ) VALUES ${invoiceValues}
    `);

    // Build VALUES for invoice lines
    const lineValues = chunk.flatMap((inv) =>
      inv.lines.map((line) => {
        const desc = escapeSql(line.description);
        return `('${line.id}', '${inv.id}', '${desc}', '${line.hsnCode}',
          ${line.qty}, ${line.rate}, ${line.amount}, ${line.gstPercent}, ${line.gstAmount},
          '${line.orderLineId}')`;
      })
    ).join(',\n');

    if (lineValues) {
      await prisma.$executeRawUnsafe(`
        INSERT INTO "InvoiceLine" (
          "id", "invoiceId", "description", "hsnCode",
          "qty", "rate", "amount", "gstPercent", "gstAmount",
          "orderLineId"
        ) VALUES ${lineValues}
      `);
    }

    inserted += chunk.length;
    console.log(`Inserted ${inserted}/${invoiceRows.length}`);
  }

  // 6. Update invoice sequence
  await prisma.$executeRawUnsafe(`
    UPDATE "InvoiceSequence"
    SET "currentNumber" = ${startNumber + invoiceRows.length},
        "fiscalYear" = '${fiscalYear}'
    WHERE "prefix" = 'COH'
  `);

  // 7. Bulk update orders with settlement fields + payment status
  if (orderIds.length > 0) {
    // Chunk the IDs for the UPDATE (Postgres has param limits)
    for (let i = 0; i < orderIds.length; i += CHUNK) {
      const idChunk = orderIds.slice(i, i + CHUNK);
      const idList = idChunk.map(id => `'${id}'`).join(',');
      await prisma.$executeRawUnsafe(`
        UPDATE "Order"
        SET "paymentStatus" = 'paid',
            "paymentConfirmedAt" = "orderDate",
            "settledAt" = "orderDate",
            "settlementAmount" = "totalAmount",
            "settlementRef" = 'PREPAID-BACKFILL-' || "orderNumber"
        WHERE "id" IN (${idList})
          AND "settledAt" IS NULL
      `);
    }
    console.log(`Updated ${orderIds.length} orders with settlement fields`);
  }

  // 8. Summary
  const firstNum = `COH/${fiscalYear}/${String(startNumber + 1).padStart(5, '0')}`;
  const lastNum = `COH/${fiscalYear}/${String(startNumber + invoiceRows.length).padStart(5, '0')}`;
  console.log(`\n--- Done ---`);
  console.log(`Created & confirmed: ${invoiceRows.length} invoices (status=paid)`);
  console.log(`Invoice numbers: ${firstNum} to ${lastNum}`);
  console.log(`Orders updated: ${orderIds.length}`);
  console.log(`Skipped (no lines): ${skipped}`);
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
