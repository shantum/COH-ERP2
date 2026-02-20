/**
 * Backfill COD Settlement
 *
 * Finds all orders where codRemittedAt IS NOT NULL but either:
 * - No customer_order invoice exists (creates one via generateDraftInvoice)
 * - Invoice exists but is not yet paid (confirms via settleOrderInvoice)
 *
 * Usage: npx tsx server/src/scripts/backfillCodSettlement.ts
 */

import prisma from '../lib/prisma.js';
import { generateDraftInvoice } from '../services/orderInvoiceGenerator.js';
import { settleOrderInvoice, type SettleResult } from '../services/orderSettlement.js';

const BATCH_SIZE = 50;

async function main() {
  // 1. Look up admin user (critical rule: role is lowercase 'admin')
  const admin = await prisma.user.findFirst({ where: { role: 'admin' } });
  if (!admin) {
    throw new Error('No admin user found — cannot proceed without a userId');
  }
  console.log(`Using admin user: ${admin.name ?? admin.email} (${admin.id})`);

  // 2. Find ALL orders where COD was remitted (regardless of invoice state)
  const orders = await prisma.order.findMany({
    where: {
      codRemittedAt: { not: null },
    },
    select: {
      id: true,
      orderNumber: true,
      codRemittedAmount: true,
      totalAmount: true,
      financeInvoices: {
        where: { category: 'customer_order' },
        select: { id: true, status: true },
        take: 1,
      },
    },
    orderBy: { createdAt: 'asc' },
  });

  // Filter: skip orders whose invoice is already paid
  const toProcess = orders.filter((o) => {
    const inv = o.financeInvoices[0];
    return !inv || inv.status !== 'paid';
  });

  console.log(`Found ${orders.length} remitted orders, ${toProcess.length} need processing\n`);

  if (toProcess.length === 0) {
    console.log('Nothing to do — all COD-remitted orders are already settled.');
    return;
  }

  // 3. Process in batches
  const summary: Record<SettleResult['action'] | 'invoice_created', number> = {
    invoice_created: 0,
    confirmed: 0,
    allocated: 0,
    confirmed_and_allocated: 0,
    already_settled: 0,
    no_invoice: 0,
  };
  let errorCount = 0;

  for (let i = 0; i < toProcess.length; i += BATCH_SIZE) {
    const batch = toProcess.slice(i, i + BATCH_SIZE);

    for (const order of batch) {
      const index = i + batch.indexOf(order) + 1;
      const amount = order.codRemittedAmount ?? order.totalAmount;
      const hasInvoice = order.financeInvoices.length > 0;

      try {
        // Step 1: Create invoice if missing
        if (!hasInvoice) {
          const generated = await generateDraftInvoice(prisma, order.id);
          if (generated) {
            summary.invoice_created++;
          }
        }

        // Step 2: Settle (confirm draft → confirmed)
        const result = await prisma.$transaction(async (tx) => {
          return settleOrderInvoice(tx, {
            orderId: order.id,
            amount,
            userId: admin.id,
            settlementRef: 'BACKFILL-COD-SETTLEMENT',
          });
        });

        summary[result.action]++;
        console.log(
          `[${index}/${toProcess.length}] #${order.orderNumber} → ${!hasInvoice ? 'created + ' : ''}${result.action}`,
        );
      } catch (error: unknown) {
        errorCount++;
        const message = error instanceof Error ? error.message : String(error);
        console.error(
          `[${index}/${toProcess.length}] #${order.orderNumber} → ERROR: ${message}`,
        );
      }
    }
  }

  // 4. Print summary
  console.log('\n--- Summary ---');
  console.log(`Total processed: ${toProcess.length}`);
  console.log(`  Invoices created: ${summary.invoice_created}`);
  console.log(`  Confirmed (draft → confirmed): ${summary.confirmed}`);
  console.log(`  Allocated: ${summary.allocated}`);
  console.log(`  Confirmed & Allocated: ${summary.confirmed_and_allocated}`);
  console.log(`  Already settled: ${summary.already_settled}`);
  console.log(`  No invoice found: ${summary.no_invoice}`);
  console.log(`  Errors: ${errorCount}`);
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
