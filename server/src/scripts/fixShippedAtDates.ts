/**
 * Corrective migration: Fix shippedAt dates from shopifyCache (BULK)
 *
 * Uses raw SQL for fast bulk updates across 60k+ orders.
 *
 * Run: npx tsx src/scripts/fixShippedAtDates.ts
 */

import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function fixShippedAtDates() {
    console.log('Starting BULK shippedAt date correction...\n');

    // 1. Update Order.shippedAt from ShopifyOrderCache.shippedAt
    console.log('Updating Order.shippedAt...');
    const orderResult = await prisma.$executeRaw`
        UPDATE "Order" o
        SET "shippedAt" = soc."shippedAt"
        FROM "ShopifyOrderCache" soc
        WHERE o."shopifyOrderId" = soc.id
          AND soc."shippedAt" IS NOT NULL
          AND (o."shippedAt" IS NULL OR o."shippedAt" != soc."shippedAt")
    `;
    console.log(`  Orders updated: ${orderResult}`);

    // 2. Update OrderLine.shippedAt from ShopifyOrderCache.shippedAt (via Order)
    console.log('Updating OrderLine.shippedAt...');
    const lineResult = await prisma.$executeRaw`
        UPDATE "OrderLine" ol
        SET "shippedAt" = soc."shippedAt"
        FROM "Order" o
        JOIN "ShopifyOrderCache" soc ON o."shopifyOrderId" = soc.id
        WHERE ol."orderId" = o.id
          AND ol."lineStatus" = 'shipped'
          AND soc."shippedAt" IS NOT NULL
          AND (ol."shippedAt" IS NULL OR ol."shippedAt" != soc."shippedAt")
    `;
    console.log(`  Order lines updated: ${lineResult}`);

    console.log('\n--- Correction Complete ---');
}

fixShippedAtDates()
    .catch((e) => {
        console.error('Correction failed:', e);
        process.exit(1);
    })
    .finally(async () => {
        await prisma.$disconnect();
    });
