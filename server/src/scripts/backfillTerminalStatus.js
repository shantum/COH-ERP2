/**
 * Backfill terminal status for existing orders
 *
 * This script populates terminalStatus and terminalAt for orders that have
 * already reached terminal states (delivered, rto_delivered, cancelled).
 *
 * Run with: node src/scripts/backfillTerminalStatus.js
 */

import prisma from '../lib/prisma.js';

async function backfillTerminalStatus() {
    console.log('Starting terminal status backfill...\n');

    const results = {
        delivered: 0,
        rto: 0,
        cancelled: 0,
        archived: 0,
    };

    // 1. Delivered orders (from trackingStatus = 'delivered')
    console.log('1. Backfilling delivered orders...');
    const deliveredOrders = await prisma.order.findMany({
        where: {
            trackingStatus: 'delivered',
            terminalStatus: null,
            isArchived: false,
        },
        select: { id: true, deliveredAt: true, createdAt: true },
    });

    for (const order of deliveredOrders) {
        await prisma.order.update({
            where: { id: order.id },
            data: {
                terminalStatus: 'delivered',
                terminalAt: order.deliveredAt || order.createdAt,
            },
        });
    }
    results.delivered = deliveredOrders.length;
    console.log(`   Updated ${results.delivered} delivered orders`);

    // 2. RTO received orders (from trackingStatus = 'rto_delivered')
    console.log('2. Backfilling RTO received orders...');
    const rtoOrders = await prisma.order.findMany({
        where: {
            trackingStatus: 'rto_delivered',
            terminalStatus: null,
            isArchived: false,
        },
        select: { id: true, rtoReceivedAt: true, createdAt: true },
    });

    for (const order of rtoOrders) {
        await prisma.order.update({
            where: { id: order.id },
            data: {
                terminalStatus: 'rto_received',
                terminalAt: order.rtoReceivedAt || order.createdAt,
            },
        });
    }
    results.rto = rtoOrders.length;
    console.log(`   Updated ${results.rto} RTO orders`);

    // 3. Cancelled orders (from status = 'cancelled')
    console.log('3. Backfilling cancelled orders...');
    const cancelledOrders = await prisma.order.findMany({
        where: {
            status: 'cancelled',
            terminalStatus: null,
            isArchived: false,
        },
        select: { id: true, createdAt: true },
    });

    for (const order of cancelledOrders) {
        await prisma.order.update({
            where: { id: order.id },
            data: {
                terminalStatus: 'cancelled',
                terminalAt: order.createdAt,
            },
        });
    }
    results.cancelled = cancelledOrders.length;
    console.log(`   Updated ${results.cancelled} cancelled orders`);

    // 4. Archived orders (use batch updates for performance)
    console.log('4. Backfilling archived orders...');

    // 4a. Archived RTO orders
    const archivedRtoResult = await prisma.$executeRaw`
        UPDATE "Order"
        SET "terminalStatus" = 'rto_received',
            "terminalAt" = COALESCE("rtoReceivedAt", "archivedAt", "createdAt")
        WHERE "isArchived" = true
          AND "terminalStatus" IS NULL
          AND "trackingStatus" = 'rto_delivered'
    `;
    console.log(`   Updated ${archivedRtoResult} archived RTO orders`);

    // 4b. Archived cancelled orders
    const archivedCancelledResult = await prisma.$executeRaw`
        UPDATE "Order"
        SET "terminalStatus" = 'cancelled',
            "terminalAt" = COALESCE("archivedAt", "createdAt")
        WHERE "isArchived" = true
          AND "terminalStatus" IS NULL
          AND "status" = 'cancelled'
    `;
    console.log(`   Updated ${archivedCancelledResult} archived cancelled orders`);

    // 4c. All other archived orders (default to delivered)
    const archivedDeliveredResult = await prisma.$executeRaw`
        UPDATE "Order"
        SET "terminalStatus" = 'delivered',
            "terminalAt" = COALESCE("deliveredAt", "archivedAt", "createdAt")
        WHERE "isArchived" = true
          AND "terminalStatus" IS NULL
    `;
    console.log(`   Updated ${archivedDeliveredResult} archived delivered orders`);

    results.archived = Number(archivedRtoResult) + Number(archivedCancelledResult) + Number(archivedDeliveredResult);

    // Summary
    console.log('\n=== Backfill Complete ===');
    console.log(`Delivered:  ${results.delivered}`);
    console.log(`RTO:        ${results.rto}`);
    console.log(`Cancelled:  ${results.cancelled}`);
    console.log(`Archived:   ${results.archived}`);
    console.log(`Total:      ${results.delivered + results.rto + results.cancelled + results.archived}`);
}

backfillTerminalStatus()
    .catch((error) => {
        console.error('Backfill failed:', error);
        process.exit(1);
    })
    .finally(() => prisma.$disconnect());
