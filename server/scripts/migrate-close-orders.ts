import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();

async function main() {
    const threeMonthsAgo = new Date();
    threeMonthsAgo.setMonth(threeMonthsAgo.getMonth() - 3);
    
    console.log('=== PHASE 1: Archive old Shopify-fulfilled orders ===');
    console.log('Cutoff date:', threeMonthsAgo.toISOString());
    
    // Find orders older than 3 months with Shopify fulfillment
    const oldFulfilledOrders = await prisma.order.findMany({
        where: {
            orderDate: { lt: threeMonthsAgo },
            shopifyCache: {
                fulfillmentStatus: 'fulfilled'
            },
            isArchived: false,
        },
        include: {
            shopifyCache: { select: { shippedAt: true } },
            orderLines: { select: { id: true, closedAt: true } },
        },
        take: 100, // Process in batches for safety
    });
    
    console.log(`Found ${oldFulfilledOrders.length} orders to process (batch of 100)`);
    
    let phase1Processed = 0;
    for (const order of oldFulfilledOrders) {
        const closedAt = order.shopifyCache?.shippedAt || new Date();
        
        // Close all lines
        await prisma.orderLine.updateMany({
            where: {
                orderId: order.id,
                closedAt: null,
            },
            data: { closedAt },
        });
        
        // Archive the order
        await prisma.order.update({
            where: { id: order.id },
            data: { isArchived: true },
        });
        
        phase1Processed++;
    }
    console.log(`Phase 1: Processed ${phase1Processed} orders`);
    
    console.log('\n=== PHASE 2: Close lines with AWB ===');
    
    // Find lines with AWB but no closedAt
    const linesWithAwbNoClose = await prisma.orderLine.count({
        where: {
            awbNumber: { not: null },
            closedAt: null,
        },
    });
    console.log(`Found ${linesWithAwbNoClose} lines with AWB but no closedAt`);
    
    // Update them in batch
    const now = new Date();
    const phase2Result = await prisma.orderLine.updateMany({
        where: {
            awbNumber: { not: null },
            closedAt: null,
        },
        data: { closedAt: now },
    });
    console.log(`Phase 2: Closed ${phase2Result.count} lines`);
    
    console.log('\n=== SUMMARY ===');
    const stillOpen = await prisma.orderLine.count({
        where: { closedAt: null, lineStatus: { not: 'cancelled' } },
    });
    console.log(`Lines still open (closedAt is null, not cancelled): ${stillOpen}`);
    
    await prisma.$disconnect();
}

main().catch(e => {
    console.error(e);
    process.exit(1);
});
