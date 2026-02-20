/**
 * Fast Backfill COD Settlement (bulk SQL version)
 *
 * 1. Bulk-loads all remitted orders missing invoices
 * 2. Computes GST in JS
 * 3. Bulk-inserts invoices + lines via raw SQL
 * 4. Assigns invoice numbers + confirms in bulk
 *
 * Usage: npx tsx server/src/scripts/backfillCodSettlementFast.ts
 */

import prisma from '../lib/prisma.js';
import { computeOrderGst, type GstLineInput } from '@coh/shared/domain';
import { dateToPeriod } from '@coh/shared';
import { COMPANY_GST } from '../config/finance/gst.js';
import { getFiscalYear } from '../services/invoiceNumberGenerator.js';
import { randomUUID } from 'crypto';

async function main() {
  // 1. Admin user
  const admin = await prisma.user.findFirst({ where: { role: 'admin' } });
  if (!admin) throw new Error('No admin user found');
  console.log(`Admin: ${admin.name ?? admin.email}`);

  // 2. Bulk-load remitted orders without invoices
  const orders = await prisma.order.findMany({
    where: {
      codRemittedAt: { not: null },
      financeInvoices: { none: { category: 'customer_order' } },
    },
    select: {
      id: true,
      orderNumber: true,
      totalAmount: true,
      orderDate: true,
      customerId: true,
      customerState: true,
      codRemittedAmount: true,
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
  });

  console.log(`Found ${orders.length} remitted orders without invoices`);
  if (orders.length === 0) {
    console.log('Nothing to do.');
    return;
  }

  // 3. Compute GST and prepare invoice data
  const invoiceRows: Array<{
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
  }> = [];

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
  }

  console.log(`Computed GST for ${invoiceRows.length} orders (${skipped} skipped — no lines)`);

  // 4. Get current invoice sequence number
  const fiscalYear = getFiscalYear();
  const seqResult = await prisma.$queryRaw<Array<{ currentNumber: number }>>`
    SELECT "currentNumber" FROM "InvoiceSequence" WHERE "prefix" = 'COH'
  `;
  const startNumber = seqResult[0].currentNumber;
  console.log(`Current invoice sequence: ${startNumber}, will assign ${startNumber + 1} to ${startNumber + invoiceRows.length}`);

  // 5. Bulk insert invoices via raw SQL
  const CHUNK = 100;
  let inserted = 0;

  for (let i = 0; i < invoiceRows.length; i += CHUNK) {
    const chunk = invoiceRows.slice(i, i + CHUNK);
    const invoiceNumber = (n: number) => `COH/${fiscalYear}/${String(n).padStart(5, '0')}`;

    // Build VALUES for invoices
    const invoiceValues = chunk.map((inv, idx) => {
      const num = startNumber + 1 + i + idx;
      return `('${inv.id}', 'receivable', 'customer_order', 'confirmed', '${invoiceNumber(num)}',
        '${inv.orderDate.toISOString()}'::timestamptz, '${dateToPeriod(inv.orderDate)}',
        '${inv.orderId}', ${inv.customerId ? `'${inv.customerId}'` : 'NULL'},
        ${inv.subtotal}, ${inv.gstRate}, ${inv.gstAmount}, '${inv.gstType}',
        ${inv.cgstAmount}, ${inv.sgstAmount}, ${inv.igstAmount},
        ${inv.totalAmount}, ${inv.totalAmount}, 0,
        '${admin.id}', 'Auto-generated from order ${inv.orderNumber} (COD backfill)',
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
      inv.lines.map((line) =>
        `('${line.id}', '${inv.id}', '${line.description}', '${line.hsnCode}',
          ${line.qty}, ${line.rate}, ${line.amount}, ${line.gstPercent}, ${line.gstAmount},
          '${line.orderLineId}')`
      )
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

  console.log(`\n--- Done ---`);
  console.log(`Created & confirmed: ${invoiceRows.length} invoices`);
  console.log(`Invoice numbers: COH/${fiscalYear}/${String(startNumber + 1).padStart(5, '0')} to COH/${fiscalYear}/${String(startNumber + invoiceRows.length).padStart(5, '0')}`);
  console.log(`Skipped (no lines): ${skipped}`);
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
