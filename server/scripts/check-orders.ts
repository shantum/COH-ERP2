import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();

async function main() {
    console.log('=== CURRENT STATE ===');
    
    // Order status distribution
    const statusCounts = await prisma.order.groupBy({
        by: ['status'],
        _count: true,
    });
    console.log('Order status distribution:');
    statusCounts.forEach(s => console.log(`  ${s.status}: ${s._count}`));
    
    // Archived vs non-archived
    const archivedCount = await prisma.order.count({ where: { isArchived: true } });
    const notArchivedCount = await prisma.order.count({ where: { isArchived: false } });
    console.log(`\nArchived: ${archivedCount}, Not archived: ${notArchivedCount}`);
    
    // Lines with closedAt
    const linesWithClosedAt = await prisma.orderLine.count({ where: { closedAt: { not: null } } });
    const linesWithoutClosedAt = await prisma.orderLine.count({ where: { closedAt: null } });
    console.log(`\nLines with closedAt: ${linesWithClosedAt}, without: ${linesWithoutClosedAt}`);
    
    // Non-archived orders that would show in "open" view (has at least one open line)
    const openViewOrders = await prisma.order.count({
        where: {
            isArchived: false,
            orderLines: {
                some: {
                    closedAt: null,
                    lineStatus: { not: 'cancelled' },
                },
            },
        },
    });
    console.log(`\nOrders that would show in 'open' view: ${openViewOrders}`);
    
    // Non-archived orders that would show in "shipped" view (all non-cancelled lines closed)
    const shippedViewOrders = await prisma.order.count({
        where: {
            isArchived: false,
            NOT: {
                orderLines: {
                    some: {
                        closedAt: null,
                        lineStatus: { not: 'cancelled' },
                    },
                },
            },
            orderLines: { some: {} },
        },
    });
    console.log(`Orders that would show in 'shipped' view: ${shippedViewOrders}`);
    
    await prisma.$disconnect();
}

main().catch(e => {
    console.error(e);
    process.exit(1);
});
