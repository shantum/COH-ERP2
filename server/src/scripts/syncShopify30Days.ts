/**
 * One-off Shopify sync for the last 30 days
 *
 * Usage: cd server && npx tsx src/scripts/syncShopify30Days.ts
 */

import { PrismaClient } from '@prisma/client';
import shopifyClient from '../services/shopify/index.js';
import { cacheShopifyOrders, processCacheBatch } from '../services/shopifyOrderProcessor/index.js';

const prisma = new PrismaClient();
const LOOKBACK_DAYS = 30;

async function run(): Promise<void> {
    console.log(`Starting Shopify sync for last ${LOOKBACK_DAYS} days...`);

    // Load Shopify config from DB
    await shopifyClient.loadFromDatabase();

    if (!shopifyClient.isConfigured()) {
        console.error('Shopify is not configured. Check your settings.');
        process.exit(1);
    }

    const since = new Date();
    since.setDate(since.getDate() - LOOKBACK_DAYS);
    console.log(`Fetching orders created since: ${since.toISOString()}`);

    // Step 1: Fetch from Shopify and cache
    const orders = await shopifyClient.getAllOrders(
        (fetched, total) => {
            if (fetched % 50 === 0 || fetched === total) {
                console.log(`  Fetched ${fetched}${total ? ` / ${total}` : ''} orders`);
            }
        },
        {
            status: 'any',
            created_at_min: since.toISOString()
        }
    );

    console.log(`\nStep 1: ${orders.length} orders fetched from Shopify`);

    let cached = 0;
    let skipped = 0;

    for (const order of orders) {
        try {
            await cacheShopifyOrders(prisma, order, 'manual_30day_sync');
            cached++;
            if (cached % 100 === 0) {
                console.log(`  Cached ${cached} / ${orders.length}`);
            }
        } catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            console.error(`  Error caching order ${order.name}: ${msg}`);
            skipped++;
        }
    }

    console.log(`Step 1 complete: ${cached} cached, ${skipped} skipped`);

    // Step 2: Process unprocessed cache entries
    const unprocessed = await prisma.shopifyOrderCache.findMany({
        where: { processedAt: null, processingError: null },
        orderBy: { lastWebhookAt: 'asc' },
        take: 5000,
        select: { id: true, rawData: true, orderNumber: true }
    });

    console.log(`\nStep 2: ${unprocessed.length} unprocessed cache entries found`);

    if (unprocessed.length > 0) {
        const batchResult = await processCacheBatch(prisma, unprocessed, { concurrency: 10 });
        console.log(`Step 2 complete: ${batchResult.succeeded} processed, ${batchResult.failed} failed`);

        if (batchResult.errors.length > 0) {
            console.log('\nFirst 10 errors:');
            for (const e of batchResult.errors.slice(0, 10)) {
                console.log(`  ${e.orderNumber || 'unknown'}: ${e.error}`);
            }
        }
    } else {
        console.log('Step 2 complete: nothing to process');
    }

    console.log('\nDone!');
}

run()
    .catch((err) => {
        console.error('Fatal error:', err);
        process.exit(1);
    })
    .finally(() => prisma.$disconnect());
