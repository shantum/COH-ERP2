/**
 * Backfill Customer orderCount
 *
 * One-time migration script to populate the denormalized orderCount field
 * on the Customer table. Run this after adding the orderCount column.
 *
 * Usage: npx ts-node src/scripts/backfillCustomerOrderCounts.ts
 */

import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function backfillOrderCounts(): Promise<void> {
    console.log('Starting orderCount backfill...');

    const CHUNK_SIZE = 1000;
    const totalCount = await prisma.customer.count();
    console.log(`Total customers: ${totalCount}`);

    let processed = 0;
    let updated = 0;

    while (processed < totalCount) {
        const customers = await prisma.customer.findMany({
            select: { id: true },
            skip: processed,
            take: CHUNK_SIZE
        });

        if (customers.length === 0) break;

        const customerIds = customers.map(c => c.id);

        // Get order counts for all customers in chunk
        const orderCounts = await prisma.order.groupBy({
            by: ['customerId'],
            where: {
                customerId: { in: customerIds },
                status: { not: 'cancelled' }
            },
            _count: { id: true }
        });

        // Build count map
        const countMap = new Map<string, number>();
        for (const stat of orderCounts) {
            if (stat.customerId) {
                countMap.set(stat.customerId, stat._count.id);
            }
        }

        // Update all customers in chunk
        const updates = customerIds.map(id => {
            const orderCount = countMap.get(id) || 0;
            return prisma.customer.update({
                where: { id },
                data: { orderCount }
            });
        });

        await prisma.$transaction(updates);

        processed += customers.length;
        updated += updates.length;

        const percentComplete = ((processed / totalCount) * 100).toFixed(1);
        console.log(`Processed ${processed}/${totalCount} (${percentComplete}%)`);
    }

    console.log(`\nBackfill complete: ${updated} customers updated`);
}

backfillOrderCounts()
    .catch(console.error)
    .finally(() => prisma.$disconnect());
