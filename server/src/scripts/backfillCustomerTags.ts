/**
 * One-time migration: Backfill customer tags from ShopifyOrderCache.rawData
 *
 * Uses raw SQL UPDATE with JSON extraction for maximum speed.
 *
 * Run: npx tsx src/scripts/backfillCustomerTags.ts
 * Dry run: npx tsx src/scripts/backfillCustomerTags.ts --dry-run
 */

import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();
const DRY_RUN = process.argv.includes('--dry-run');

async function backfillCustomerTags() {
    console.log(`${DRY_RUN ? '[DRY RUN] ' : ''}Starting customer tags backfill...\n`);

    // Count how many will be updated
    const countResult = await prisma.$queryRaw<Array<{ count: bigint }>>`
        SELECT COUNT(DISTINCT c.id) as count
        FROM "Customer" c
        JOIN "Order" o ON o."customerId" = c.id
        JOIN "ShopifyOrderCache" soc ON soc.id = o."shopifyOrderId"
        WHERE c.tags IS NULL
          AND soc."rawData"::json->'customer'->>'tags' IS NOT NULL
          AND soc."rawData"::json->'customer'->>'tags' != ''
    `;

    const count = Number(countResult[0]?.count || 0);
    console.log(`Found ${count} customers to update\n`);

    // Show sample
    const sample = await prisma.$queryRaw<Array<{ email: string; tags: string }>>`
        SELECT DISTINCT ON (c.id)
            c.email,
            soc."rawData"::json->'customer'->>'tags' as tags
        FROM "Customer" c
        JOIN "Order" o ON o."customerId" = c.id
        JOIN "ShopifyOrderCache" soc ON soc.id = o."shopifyOrderId"
        WHERE c.tags IS NULL
          AND soc."rawData"::json->'customer'->>'tags' IS NOT NULL
          AND soc."rawData"::json->'customer'->>'tags' != ''
        ORDER BY c.id, o."orderDate" DESC
        LIMIT 10
    `;

    console.log('Sample customers:');
    sample.forEach(s => console.log(`  - ${s.email}: "${s.tags}"`));
    console.log('');

    if (DRY_RUN) {
        console.log('[DRY RUN] No changes made. Run without --dry-run to apply changes.');
        return;
    }

    if (count === 0) {
        console.log('No customers need updating.');
        return;
    }

    // Single SQL UPDATE with subquery - maximum speed
    console.log('Updating customers with single SQL statement...');
    const result = await prisma.$executeRaw`
        UPDATE "Customer" c
        SET tags = subq.customer_tags
        FROM (
            SELECT DISTINCT ON (o."customerId")
                o."customerId" as customer_id,
                soc."rawData"::json->'customer'->>'tags' as customer_tags
            FROM "Order" o
            JOIN "ShopifyOrderCache" soc ON soc.id = o."shopifyOrderId"
            WHERE o."customerId" IS NOT NULL
              AND soc."rawData"::json->'customer'->>'tags' IS NOT NULL
              AND soc."rawData"::json->'customer'->>'tags' != ''
            ORDER BY o."customerId", o."orderDate" DESC
        ) subq
        WHERE c.id = subq.customer_id
          AND c.tags IS NULL
    `;

    console.log(`  Updated: ${result} customers`);
    console.log('\n--- Backfill Complete ---');
}

backfillCustomerTags()
    .catch((e) => {
        console.error('Backfill failed:', e);
        process.exit(1);
    })
    .finally(async () => {
        await prisma.$disconnect();
    });
