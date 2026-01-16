/**
 * One-time migration: Release exchange orders (0 value or exchange notes)
 *
 * Criteria:
 * - Orders with totalAmount = 0 OR
 * - Orders where shopifyCache.customerNotes contains "This is an exchange order against"
 *
 * Actions:
 * - Set releasedToShipped = true
 * - Set all orderLines.lineStatus = 'shipped'
 *
 * Run: npx tsx src/scripts/releaseExchangeOrders.ts
 * Dry run: npx tsx src/scripts/releaseExchangeOrders.ts --dry-run
 */

import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();
const DRY_RUN = process.argv.includes('--dry-run');

async function releaseExchangeOrders() {
    console.log(`${DRY_RUN ? '[DRY RUN] ' : ''}Starting exchange order release migration...\n`);

    // Find matching orders
    const matchingOrders = await prisma.order.findMany({
        where: {
            OR: [
                { totalAmount: 0 },
                {
                    shopifyCache: {
                        customerNotes: {
                            contains: 'This is an exchange order against',
                            mode: 'insensitive',
                        },
                    },
                },
            ],
        },
        select: {
            id: true,
            orderNumber: true,
            totalAmount: true,
            releasedToShipped: true,
            shopifyCache: {
                select: {
                    customerNotes: true,
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

    console.log(`Found ${matchingOrders.length} matching orders\n`);

    // Categorize
    const zeroValueOrders = matchingOrders.filter(o => o.totalAmount === 0);
    const exchangeNoteOrders = matchingOrders.filter(
        o => o.totalAmount !== 0 && o.shopifyCache?.customerNotes?.toLowerCase().includes('this is an exchange order against')
    );

    console.log(`  - Zero value orders: ${zeroValueOrders.length}`);
    console.log(`  - Exchange note orders: ${exchangeNoteOrders.length}`);
    console.log('');

    // Count orders needing updates
    const needsRelease = matchingOrders.filter(o => !o.releasedToShipped);
    const needsLineUpdate = matchingOrders.filter(o =>
        o.orderLines.some(l => l.lineStatus !== 'shipped')
    );

    console.log(`  - Need releasedToShipped update: ${needsRelease.length}`);
    console.log(`  - Have non-shipped lines: ${needsLineUpdate.length}`);
    console.log('');

    // Show orders that need updating
    const ordersNeedingWork = matchingOrders.filter(o =>
        !o.releasedToShipped || o.orderLines.some(l => l.lineStatus !== 'shipped')
    );

    console.log(`Orders needing updates: ${ordersNeedingWork.length}`);
    ordersNeedingWork.slice(0, 10).forEach(o => {
        const reason = o.totalAmount === 0 ? 'zero value' : 'exchange note';
        const lineStatuses = o.orderLines.map(l => l.lineStatus).join(', ');
        console.log(`  - ${o.orderNumber}: ${reason}, released=${o.releasedToShipped}, lines=[${lineStatuses}]`);
    });
    console.log('');

    if (DRY_RUN) {
        console.log('[DRY RUN] No changes made. Run without --dry-run to apply changes.');
        return;
    }

    // Update orders: set releasedToShipped = true
    const orderIds = matchingOrders.map(o => o.id);

    console.log('Updating orders (releasedToShipped = true)...');
    const orderUpdateResult = await prisma.order.updateMany({
        where: { id: { in: orderIds } },
        data: { releasedToShipped: true },
    });
    console.log(`  Orders updated: ${orderUpdateResult.count}`);

    // Update order lines: set lineStatus = 'shipped'
    console.log('Updating order lines (lineStatus = shipped)...');
    const lineUpdateResult = await prisma.orderLine.updateMany({
        where: {
            orderId: { in: orderIds },
            lineStatus: { not: 'shipped' },
        },
        data: { lineStatus: 'shipped' },
    });
    console.log(`  Order lines updated: ${lineUpdateResult.count}`);

    console.log('\n--- Migration Complete ---');
}

releaseExchangeOrders()
    .catch((e) => {
        console.error('Migration failed:', e);
        process.exit(1);
    })
    .finally(async () => {
        await prisma.$disconnect();
    });
