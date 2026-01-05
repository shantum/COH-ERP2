import { PrismaClient } from '@prisma/client';
import { processFromCache, markCacheProcessed, markCacheError } from './src/services/shopifyOrderProcessor.js';

const prisma = new PrismaClient();

async function reprocessOrder() {
    try {
        // Get the cached order 64002
        const cacheEntry = await prisma.shopifyOrderCache.findFirst({
            where: { orderNumber: { contains: '64002' } }
        });

        if (!cacheEntry) {
            console.log('Cache entry not found');
            return;
        }

        console.log('Found cache entry:', cacheEntry.id, cacheEntry.orderNumber);
        console.log('Current error:', cacheEntry.processingError?.substring(0, 100));

        // Try to reprocess
        const result = await processFromCache(prisma, cacheEntry, { skipNoSku: false });
        console.log('Reprocessing result:', result);

        // Mark as processed if successful
        if (result.action !== 'cache_only') {
            await markCacheProcessed(prisma, cacheEntry.id);
            console.log('Cache marked as processed!');
        }

        // Verify the order exists
        const order = await prisma.order.findFirst({
            where: { orderNumber: { contains: '64002' } },
            select: { id: true, orderNumber: true, customerName: true, status: true, syncedAt: true }
        });
        console.log('Order in DB:', order);

    } catch (e) {
        console.error('Error:', e.message);
    } finally {
        await prisma.$disconnect();
    }
}

reprocessOrder();
