/**
 * Backfill COD Settlement
 *
 * Finds all orders where codRemittedAt IS NOT NULL but the linked
 * customer_order invoice is still unpaid, then calls settleOrderInvoice
 * to confirm drafts and mark invoices appropriately.
 *
 * Usage: npx tsx server/src/scripts/backfillCodSettlement.ts
 */

import prisma from '../lib/prisma.js';
import { settleOrderInvoice, type SettleResult } from '../services/orderSettlement.js';

const BATCH_SIZE = 50;

async function main() {
  // 1. Look up admin user (critical rule: role is lowercase 'admin')
  const admin = await prisma.user.findFirst({ where: { role: 'admin' } });
  if (!admin) {
    throw new Error('No admin user found — cannot proceed without a userId');
  }
  console.log(`Using admin user: ${admin.name ?? admin.email} (${admin.id})`);

  // 2. Find orders where COD was remitted but invoice is not yet paid
  const orders = await prisma.order.findMany({
    where: {
      codRemittedAt: { not: null },
      financeInvoices: {
        some: {
          category: 'customer_order',
          status: { not: 'paid' },
        },
      },
    },
    select: {
      id: true,
      orderNumber: true,
      codRemittedAmount: true,
      totalAmount: true,
    },
    orderBy: { createdAt: 'asc' },
  });

  console.log(`Found ${orders.length} orders to process\n`);

  if (orders.length === 0) {
    console.log('Nothing to do — all COD-remitted orders are already settled.');
    return;
  }

  // 3. Process in batches
  const summary: Record<SettleResult['action'], number> = {
    confirmed: 0,
    allocated: 0,
    confirmed_and_allocated: 0,
    already_settled: 0,
    no_invoice: 0,
  };
  let errorCount = 0;

  for (let i = 0; i < orders.length; i += BATCH_SIZE) {
    const batch = orders.slice(i, i + BATCH_SIZE);

    for (const order of batch) {
      const index = orders.indexOf(order) + 1;
      const amount = order.codRemittedAmount ?? order.totalAmount;

      try {
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
          `Processing order ${index}/${orders.length}: #${order.orderNumber} → ${result.action}`,
        );
      } catch (error: unknown) {
        errorCount++;
        const message = error instanceof Error ? error.message : String(error);
        console.error(
          `Processing order ${index}/${orders.length}: #${order.orderNumber} → ERROR: ${message}`,
        );
      }
    }
  }

  // 4. Print summary
  console.log('\n--- Summary ---');
  console.log(`Total processed: ${orders.length}`);
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
