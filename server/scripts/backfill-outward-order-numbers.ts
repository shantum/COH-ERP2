/**
 * Backfill orderNumber on historical outward InventoryTransactions.
 *
 * Historical ms-outward referenceId format:
 *   sheet:ms-outward:{SKU}:{qty}:{orderNumber}:{rowIndex}
 *
 * Extracts segment 5 (the order number) and populates the `orderNumber` field
 * for all ms-outward transactions where orderNumber is currently NULL.
 *
 * Non-destructive: only updates NULL orderNumber fields.
 *
 * Usage:
 *   npx tsx server/scripts/backfill-outward-order-numbers.ts              # dry-run
 *   npx tsx server/scripts/backfill-outward-order-numbers.ts --write      # apply
 */

import 'dotenv/config';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();
const shouldWrite = process.argv.includes('--write');

const BATCH_SIZE = 2000;

async function main() {
    console.log(`Mode: ${shouldWrite ? 'WRITE' : 'DRY-RUN'}\n`);

    // Step 1: Count eligible rows
    const eligibleCount = await prisma.inventoryTransaction.count({
        where: {
            txnType: 'outward',
            orderNumber: null,
            referenceId: { startsWith: 'sheet:ms-outward' },
        },
    });

    console.log(`Eligible transactions (ms-outward, orderNumber IS NULL): ${eligibleCount.toLocaleString()}\n`);

    if (eligibleCount === 0) {
        console.log('Nothing to backfill.');
        return;
    }

    // Step 2: Extract order numbers via SQL and preview
    const preview = await prisma.$queryRawUnsafe<Array<{
        id: string;
        reference_id: string;
        extracted_order: string;
    }>>(
        `SELECT
            id,
            "referenceId" as reference_id,
            split_part("referenceId", ':', 5) as extracted_order
        FROM "InventoryTransaction"
        WHERE "txnType" = 'outward'
        AND "orderNumber" IS NULL
        AND "referenceId" LIKE 'sheet:ms-outward%'
        LIMIT 10`
    );

    console.log('Preview (first 10):');
    for (const row of preview) {
        console.log(`  referenceId: ${row.reference_id}`);
        console.log(`  → orderNumber: "${row.extracted_order}"`);
        console.log();
    }

    // Step 3: Validate — check for empty extractions
    const emptyExtractions = await prisma.$queryRawUnsafe<Array<{ cnt: string }>>(
        `SELECT COUNT(*)::text as cnt
        FROM "InventoryTransaction"
        WHERE "txnType" = 'outward'
        AND "orderNumber" IS NULL
        AND "referenceId" LIKE 'sheet:ms-outward%'
        AND (split_part("referenceId", ':', 5) = '' OR split_part("referenceId", ':', 5) IS NULL)`
    );

    const emptyCount = parseInt(emptyExtractions[0]?.cnt ?? '0', 10);
    console.log(`Rows where extracted order# would be empty: ${emptyCount}`);
    if (emptyCount > 0) {
        console.log(`  → These ${emptyCount} rows will be skipped (only non-empty values written)\n`);
    }

    const updateCount = eligibleCount - emptyCount;
    console.log(`Rows to update: ${updateCount.toLocaleString()}\n`);

    if (!shouldWrite) {
        console.log('--- DRY-RUN complete. Use --write to apply. ---');
        return;
    }

    // Step 4: Apply in batches using a single UPDATE statement
    console.log('Applying backfill...');

    const result = await prisma.$executeRawUnsafe(
        `UPDATE "InventoryTransaction"
        SET "orderNumber" = split_part("referenceId", ':', 5)
        WHERE "txnType" = 'outward'
        AND "orderNumber" IS NULL
        AND "referenceId" LIKE 'sheet:ms-outward%'
        AND split_part("referenceId", ':', 5) != ''`
    );

    console.log(`\nUpdated ${result.toLocaleString()} rows.`);

    // Step 5: Verify
    const remaining = await prisma.inventoryTransaction.count({
        where: {
            txnType: 'outward',
            orderNumber: null,
            referenceId: { startsWith: 'sheet:ms-outward' },
        },
    });

    const nowPopulated = await prisma.inventoryTransaction.count({
        where: {
            txnType: 'outward',
            orderNumber: { not: null },
            referenceId: { startsWith: 'sheet:ms-outward' },
        },
    });

    console.log(`\nVerification:`);
    console.log(`  ms-outward with orderNumber:    ${nowPopulated.toLocaleString()}`);
    console.log(`  ms-outward still NULL:          ${remaining.toLocaleString()}`);
    console.log(`  Total outward with orderNumber: ${(
        await prisma.inventoryTransaction.count({
            where: { txnType: 'outward', orderNumber: { not: null } },
        })
    ).toLocaleString()}`);

    console.log('\nDone.');
}

main()
    .catch(console.error)
    .finally(() => prisma.$disconnect());
