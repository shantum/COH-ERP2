/**
 * One-time migration: Cancel open orders with specific tags
 *
 * Tags to cancel:
 * - OTP Unconfirmed
 * - COD Cancelled
 * - Fraud_Order
 * - Fraud_Client
 * - RTO_Client
 *
 * Actions:
 * - Set all orderLines.lineStatus = 'cancelled'
 *
 * Run: npx tsx src/scripts/cancelTaggedOrders.ts
 * Dry run: npx tsx src/scripts/cancelTaggedOrders.ts --dry-run
 */

import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();
const DRY_RUN = process.argv.includes('--dry-run');

// Tags that indicate order should be cancelled
const CANCEL_TAGS = [
    'OTP Unconfirmed',
    'COD Cancelled',
    'Fraud_Order',
    'Fraud_Client',
    'RTO_Client',
    'RTO_Cient', // typo variant
];

async function cancelTaggedOrders() {
    console.log(`${DRY_RUN ? '[DRY RUN] ' : ''}Starting cancel tagged orders migration...\n`);
    console.log('Tags to cancel:', CANCEL_TAGS.join(', '));
    console.log('');

    // Find open orders (not shipped, not cancelled, not released)
    // that have any of the cancel tags
    const openOrders = await prisma.order.findMany({
        where: {
            // Open view criteria: not released to shipped
            releasedToShipped: false,
            // Has at least one non-cancelled, non-shipped line
            orderLines: {
                some: {
                    lineStatus: { notIn: ['shipped', 'cancelled'] },
                },
            },
        },
        select: {
            id: true,
            orderNumber: true,
            shopifyCache: {
                select: {
                    tags: true,
                },
            },
            orderLines: {
                select: {
                    id: true,
                    lineStatus: true,
                },
            },
        },
    });

    console.log(`Found ${openOrders.length} open orders total\n`);

    // Filter to orders that have any of the cancel tags
    const ordersToCancel = openOrders.filter(order => {
        const tags = order.shopifyCache?.tags || '';
        return CANCEL_TAGS.some(cancelTag =>
            tags.toLowerCase().includes(cancelTag.toLowerCase())
        );
    });

    console.log(`Orders with cancel tags: ${ordersToCancel.length}\n`);

    // Group by tag for reporting
    const tagCounts: Record<string, number> = {};
    ordersToCancel.forEach(order => {
        const tags = order.shopifyCache?.tags || '';
        CANCEL_TAGS.forEach(cancelTag => {
            if (tags.toLowerCase().includes(cancelTag.toLowerCase())) {
                tagCounts[cancelTag] = (tagCounts[cancelTag] || 0) + 1;
            }
        });
    });

    console.log('Breakdown by tag:');
    Object.entries(tagCounts).forEach(([tag, count]) => {
        console.log(`  - ${tag}: ${count}`);
    });
    console.log('');

    // Count lines that need updating
    const linesToCancel = ordersToCancel.flatMap(o =>
        o.orderLines.filter(l => l.lineStatus !== 'cancelled')
    );
    console.log(`Order lines to cancel: ${linesToCancel.length}`);
    console.log('');

    // Show sample orders
    console.log('Sample orders to cancel:');
    ordersToCancel.slice(0, 10).forEach(o => {
        const lineStatuses = o.orderLines.map(l => l.lineStatus).join(', ');
        console.log(`  - ${o.orderNumber}: tags="${o.shopifyCache?.tags}", lines=[${lineStatuses}]`);
    });
    console.log('');

    if (DRY_RUN) {
        console.log('[DRY RUN] No changes made. Run without --dry-run to apply changes.');
        return;
    }

    if (ordersToCancel.length === 0) {
        console.log('No orders to cancel.');
        return;
    }

    // Update order lines: set lineStatus = 'cancelled'
    const orderIds = ordersToCancel.map(o => o.id);

    console.log('Cancelling order lines...');
    const lineUpdateResult = await prisma.orderLine.updateMany({
        where: {
            orderId: { in: orderIds },
            lineStatus: { not: 'cancelled' },
        },
        data: { lineStatus: 'cancelled' },
    });
    console.log(`  Order lines cancelled: ${lineUpdateResult.count}`);

    console.log('\n--- Migration Complete ---');
}

cancelTaggedOrders()
    .catch((e) => {
        console.error('Migration failed:', e);
        process.exit(1);
    })
    .finally(async () => {
        await prisma.$disconnect();
    });
