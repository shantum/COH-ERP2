/**
 * One-time migration: Mark old prepaid orders as shipped and delivered
 *
 * Criteria:
 * - Open orders (releasedToShipped = false, has non-shipped/cancelled lines)
 * - Prepaid payment method (not COD)
 * - Order date on or before Dec 31, 2025
 *
 * Actions:
 * - Set all orderLines.lineStatus = 'shipped'
 * - Set Order.releasedToShipped = true
 * - Set Order.deliveredAt = now
 *
 * Run: npx tsx src/scripts/markOldPrepaidShipped.ts
 * Dry run: npx tsx src/scripts/markOldPrepaidShipped.ts --dry-run
 */

import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();
const DRY_RUN = process.argv.includes('--dry-run');

const CUTOFF_DATE = new Date('2025-12-31T23:59:59.999Z');

async function markOldPrepaidShipped() {
    console.log(`${DRY_RUN ? '[DRY RUN] ' : ''}Starting old prepaid orders migration...\n`);
    console.log(`Cutoff date: ${CUTOFF_DATE.toISOString()}\n`);

    // Find open prepaid orders on or before cutoff date
    const orders = await prisma.order.findMany({
        where: {
            // Open orders only
            releasedToShipped: false,
            orderLines: {
                some: {
                    lineStatus: { notIn: ['shipped', 'cancelled'] },
                },
            },
            // Order date on or before Dec 31, 2025
            orderDate: { lte: CUTOFF_DATE },
            // Prepaid (not COD) - check both Order and ShopifyCache
            OR: [
                { paymentMethod: { not: { contains: 'cod' }, mode: 'insensitive' } },
                { paymentMethod: null },
            ],
            // Exclude COD from shopifyCache too
            NOT: {
                shopifyCache: {
                    paymentMethod: { contains: 'cod', mode: 'insensitive' },
                },
            },
        },
        select: {
            id: true,
            orderNumber: true,
            orderDate: true,
            paymentMethod: true,
            shopifyCache: {
                select: { paymentMethod: true },
            },
            orderLines: {
                select: { id: true, lineStatus: true },
            },
        },
    });

    console.log(`Found ${orders.length} open prepaid orders on or before ${CUTOFF_DATE.toDateString()}\n`);

    // Count lines needing update
    const linesToUpdate = orders.flatMap(o =>
        o.orderLines.filter(l => !['shipped', 'cancelled'].includes(l.lineStatus))
    );
    console.log(`Order lines to mark shipped: ${linesToUpdate.length}`);

    // Show sample
    console.log('\nSample orders:');
    orders.slice(0, 10).forEach(o => {
        const payment = o.shopifyCache?.paymentMethod || o.paymentMethod || 'unknown';
        const lineStatuses = o.orderLines.map(l => l.lineStatus).join(', ');
        console.log(`  - ${o.orderNumber}: ${o.orderDate.toDateString()}, payment=${payment}, lines=[${lineStatuses}]`);
    });
    console.log('');

    if (DRY_RUN) {
        console.log('[DRY RUN] No changes made. Run without --dry-run to apply changes.');
        return;
    }

    if (orders.length === 0) {
        console.log('No orders to update.');
        return;
    }

    const orderIds = orders.map(o => o.id);
    const now = new Date();

    // Update order lines to shipped with deliveredAt and trackingStatus
    // Note: deliveredAt and trackingStatus are now on OrderLine, not Order
    console.log('Updating order lines to shipped + delivered...');
    const lineResult = await prisma.orderLine.updateMany({
        where: {
            orderId: { in: orderIds },
            lineStatus: { notIn: ['shipped', 'cancelled'] },
        },
        data: {
            lineStatus: 'shipped',
            shippedAt: now,
            deliveredAt: now,
            trackingStatus: 'delivered',
        },
    });
    console.log(`  Order lines updated: ${lineResult.count}`);

    // Update orders: releasedToShipped = true
    // Note: deliveredAt and trackingStatus removed from Order model
    console.log('Updating orders (released)...');
    const orderResult = await prisma.order.updateMany({
        where: { id: { in: orderIds } },
        data: {
            releasedToShipped: true,
        },
    });
    console.log(`  Orders updated: ${orderResult.count}`);

    console.log('\n--- Migration Complete ---');
}

markOldPrepaidShipped()
    .catch((e) => {
        console.error('Migration failed:', e);
        process.exit(1);
    })
    .finally(async () => {
        await prisma.$disconnect();
    });
