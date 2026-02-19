/**
 * Backfill Order Invoices Script
 *
 * One-time script to generate draft invoices for existing orders
 * that don't have one yet. Safe to re-run (idempotent).
 *
 * Usage:
 *   npx ts-node server/src/scripts/backfillOrderInvoices.ts
 */

import { getPrisma } from '@coh/shared/services/db';
import { generateDraftInvoice } from '../services/orderInvoiceGenerator.js';

async function backfillOrderInvoices() {
    console.log('Starting order invoice backfill...\n');

    const prisma = await getPrisma();

    // Find orders without a customer_order invoice
    const orders = await prisma.order.findMany({
        where: {
            status: { notIn: ['cancelled'] },
            financeInvoices: {
                none: { category: 'customer_order' },
            },
        },
        select: { id: true, orderNumber: true },
        orderBy: { orderDate: 'asc' },
    });

    console.log(`Found ${orders.length} orders without invoices.\n`);

    let success = 0;
    let skipped = 0;
    let failed = 0;

    for (const order of orders) {
        try {
            const result = await generateDraftInvoice(prisma, order.id);
            if (result) {
                success++;
                console.log(`  [OK] ${order.orderNumber} → Invoice ${result.invoiceId} (₹${result.totalAmount})`);
            } else {
                skipped++;
            }
        } catch (err: unknown) {
            failed++;
            const msg = err instanceof Error ? err.message : 'Unknown error';
            console.error(`  [FAIL] ${order.orderNumber}: ${msg}`);
        }
    }

    console.log(`\nDone! Created: ${success}, Skipped: ${skipped}, Failed: ${failed}`);
    process.exit(0);
}

backfillOrderInvoices().catch((err) => {
    console.error('Backfill failed:', err);
    process.exit(1);
});
