import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();

const BATCH_SIZE = 10000;

async function main() {
    const threeMonthsAgo = new Date();
    threeMonthsAgo.setMonth(threeMonthsAgo.getMonth() - 3);
    
    console.log('=== FAST MIGRATION: Archive old Shopify-fulfilled orders ===');
    console.log('Cutoff date:', threeMonthsAgo.toISOString());
    
    // Count total
    const totalToArchive = await prisma.order.count({
        where: {
            orderDate: { lt: threeMonthsAgo },
            shopifyCache: { fulfillmentStatus: 'fulfilled' },
            isArchived: false,
        },
    });
    console.log(`Found ${totalToArchive} orders to archive`);
    
    let processed = 0;
    const now = new Date();
    
    while (processed < totalToArchive) {
        // Get batch of order IDs
        const orders = await prisma.order.findMany({
            where: {
                orderDate: { lt: threeMonthsAgo },
                shopifyCache: { fulfillmentStatus: 'fulfilled' },
                isArchived: false,
            },
            select: { id: true },
            take: BATCH_SIZE,
        });
        
        if (orders.length === 0) break;
        
        const orderIds = orders.map(o => o.id);
        
        // Batch close all lines for these orders
        const linesResult = await prisma.orderLine.updateMany({
            where: {
                orderId: { in: orderIds },
                closedAt: null,
            },
            data: { closedAt: now },
        });
        
        // Batch archive all orders
        const ordersResult = await prisma.order.updateMany({
            where: { id: { in: orderIds } },
            data: { isArchived: true },
        });
        
        processed += ordersResult.count;
        console.log(`Batch: archived ${ordersResult.count} orders, closed ${linesResult.count} lines. Total: ${processed}/${totalToArchive}`);
    }
    
    console.log('\n=== SUMMARY ===');
    const stillOpen = await prisma.orderLine.count({
        where: { closedAt: null, lineStatus: { not: 'cancelled' } },
    });
    console.log(`Lines still open: ${stillOpen}`);
    
    const archivedTotal = await prisma.order.count({
        where: { isArchived: true },
    });
    console.log(`Total archived orders: ${archivedTotal}`);
    
    await prisma.$disconnect();
}

main().catch(e => {
    console.error(e);
    process.exit(1);
});
