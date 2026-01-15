/**
 * One-time migration script: Mark Shopify-fulfilled orders as shipped
 * Run on Railway: npx tsx src/scripts/migrateShopifyFulfilled.ts
 */

import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function migrate() {
    console.log('Starting Shopify fulfilled orders migration...');

    const startTime = Date.now();
    let totalMigrated = 0;
    let totalSkipped = 0;
    let batch = 1;
    const batchSize = 200;

    while (true) {
        // Find eligible orders
        const orders = await prisma.order.findMany({
            where: {
                status: 'open',
                shopifyCache: {
                    fulfillmentStatus: 'fulfilled',
                    trackingNumber: { not: null },
                    trackingCompany: { not: null },
                },
            },
            include: {
                orderLines: {
                    where: { lineStatus: { notIn: ['shipped', 'cancelled'] } },
                    select: { id: true }
                },
                shopifyCache: {
                    select: { trackingNumber: true, trackingCompany: true },
                },
            },
            orderBy: { orderDate: 'asc' },
            take: batchSize,
        });

        if (orders.length === 0) {
            console.log('No more eligible orders found.');
            break;
        }

        // Bulk update all lines in this batch
        const allLineIds = orders.flatMap(o => o.orderLines.map(l => l.id));
        const orderIds = orders.map(o => o.id);

        // Group by AWB for proper tracking assignment
        const now = new Date();

        // Process each order's lines with their specific AWB
        for (const order of orders) {
            if (order.orderLines.length === 0) {
                totalSkipped++;
                continue;
            }

            const lineIds = order.orderLines.map(l => l.id);

            await prisma.orderLine.updateMany({
                where: { id: { in: lineIds } },
                data: {
                    lineStatus: 'shipped',
                    shippedAt: now,
                    awbNumber: order.shopifyCache!.trackingNumber,
                    courier: order.shopifyCache!.trackingCompany,
                    trackingStatus: 'in_transit',
                },
            });

            totalMigrated++;
        }

        // Bulk update order statuses
        await prisma.order.updateMany({
            where: { id: { in: orderIds } },
            data: { status: 'shipped' },
        });

        const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
        console.log(`Batch ${batch}: migrated ${orders.length} orders (total: ${totalMigrated}, elapsed: ${elapsed}s)`);

        batch++;
    }

    const totalTime = ((Date.now() - startTime) / 1000).toFixed(1);
    console.log(`\nMigration complete!`);
    console.log(`  Total migrated: ${totalMigrated}`);
    console.log(`  Total skipped: ${totalSkipped}`);
    console.log(`  Total time: ${totalTime}s`);
}

migrate()
    .catch((e) => {
        console.error('Migration failed:', e);
        process.exit(1);
    })
    .finally(async () => {
        await prisma.$disconnect();
    });
