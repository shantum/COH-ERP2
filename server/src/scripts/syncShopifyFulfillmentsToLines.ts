/**
 * Migration: Sync Shopify Fulfillment Data to Order Lines
 *
 * PROBLEM: Orders fulfilled in Shopify have tracking data in ShopifyCache
 * but OrderLine.awbNumber/courier/lineStatus were never updated because:
 * - syncFulfillmentsToOrderLines() previously only synced AWB (not status)
 * - ERP workflow was never run for legacy orders
 *
 * WHAT THIS FIXES:
 * 1. Copies AWB/courier from ShopifyCache to OrderLines (where missing)
 * 2. Sets lineStatus='shipped' for lines with AWB + fulfilled Shopify status
 * 3. Updates Order.status='shipped' when all lines are shipped
 *
 * NOTE: Does NOT create inventory transactions - these orders were physically
 * shipped months ago, inventory is already reflected in actual stock.
 *
 * Run: npx tsx src/scripts/syncShopifyFulfillmentsToLines.ts
 */

import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function syncShopifyFulfillmentsToLines() {
    console.log('Starting Shopify fulfillment sync to OrderLines...\n');

    // Step 0: Count affected orders (dry run info)
    console.log('Counting affected records...');
    const affectedCount = await prisma.$queryRaw<[{ count: bigint }]>`
        SELECT COUNT(DISTINCT o.id) as count
        FROM "Order" o
        JOIN "ShopifyOrderCache" soc ON o."shopifyOrderId" = soc.id
        WHERE soc."trackingNumber" IS NOT NULL
          AND NOT EXISTS (
              SELECT 1 FROM "OrderLine" ol
              WHERE ol."orderId" = o.id AND ol."awbNumber" IS NOT NULL
          )
    `;
    console.log(`  Orders with Shopify tracking but no line AWB: ${affectedCount[0].count}\n`);

    // Step 1: Update OrderLine AWB/courier from ShopifyCache
    console.log('Step 1: Updating OrderLine.awbNumber/courier from ShopifyCache...');
    const awbResult = await prisma.$executeRaw`
        UPDATE "OrderLine" ol
        SET "awbNumber" = soc."trackingNumber",
            "courier" = soc."trackingCompany"
        FROM "Order" o
        JOIN "ShopifyOrderCache" soc ON o."shopifyOrderId" = soc.id
        WHERE ol."orderId" = o.id
          AND soc."trackingNumber" IS NOT NULL
          AND ol."awbNumber" IS NULL
          AND ol."lineStatus" NOT IN ('cancelled')
    `;
    console.log(`  Lines updated with AWB: ${awbResult}`);

    // Step 2: Update lineStatus to 'shipped' for lines that have AWB
    // If a line has AWB, it was physically shipped - mark it shipped
    // Don't require fulfillmentStatus='fulfilled' since some orders have NULL
    console.log('\nStep 2: Updating lineStatus to shipped for lines with AWB...');
    const statusResult = await prisma.$executeRaw`
        UPDATE "OrderLine" ol
        SET "lineStatus" = 'shipped',
            "shippedAt" = COALESCE(
                (SELECT soc."shippedAt" FROM "Order" o2
                 JOIN "ShopifyOrderCache" soc ON o2."shopifyOrderId" = soc.id
                 WHERE o2.id = ol."orderId"),
                NOW()
            )
        WHERE ol."lineStatus" = 'pending'
          AND ol."awbNumber" IS NOT NULL
    `;
    console.log(`  Lines marked as shipped: ${statusResult}`);

    // Step 3: Update Order.awbNumber from lines where missing
    console.log('\nStep 3: Updating Order.awbNumber from line AWB...');
    const orderAwbResult = await prisma.$executeRaw`
        UPDATE "Order" o
        SET "awbNumber" = (
            SELECT ol."awbNumber"
            FROM "OrderLine" ol
            WHERE ol."orderId" = o.id
            AND ol."awbNumber" IS NOT NULL
            LIMIT 1
        )
        WHERE o."awbNumber" IS NULL
        AND EXISTS (
            SELECT 1 FROM "OrderLine" ol
            WHERE ol."orderId" = o.id
            AND ol."awbNumber" IS NOT NULL
        )
    `;
    console.log(`  Orders updated with AWB: ${orderAwbResult}`);

    // Step 4: Recompute Order.status (shipped if all lines shipped)
    console.log('\nStep 4: Updating Order.status where all lines are shipped...');
    const orderStatusResult = await prisma.$executeRaw`
        UPDATE "Order" o
        SET "status" = 'shipped'
        WHERE o.status = 'open'
          AND NOT EXISTS (
              SELECT 1 FROM "OrderLine" ol
              WHERE ol."orderId" = o.id
                AND ol."lineStatus" NOT IN ('shipped', 'cancelled')
          )
          AND EXISTS (
              SELECT 1 FROM "OrderLine" ol
              WHERE ol."orderId" = o.id AND ol."lineStatus" = 'shipped'
          )
    `;
    console.log(`  Orders marked as shipped: ${orderStatusResult}`);

    // Verification query
    console.log('\n--- Verification ---');
    const remaining = await prisma.$queryRaw<[{ count: bigint }]>`
        SELECT COUNT(DISTINCT o.id) as count
        FROM "Order" o
        JOIN "ShopifyOrderCache" soc ON o."shopifyOrderId" = soc.id
        WHERE soc."trackingNumber" IS NOT NULL
          AND NOT EXISTS (
              SELECT 1 FROM "OrderLine" ol
              WHERE ol."orderId" = o.id AND ol."awbNumber" IS NOT NULL
          )
    `;
    console.log(`  Remaining orders with tracking but no line AWB: ${remaining[0].count}`);

    console.log('\n--- Migration Complete ---');
}

syncShopifyFulfillmentsToLines()
    .catch((e) => {
        console.error('Migration failed:', e);
        process.exit(1);
    })
    .finally(async () => {
        await prisma.$disconnect();
    });
