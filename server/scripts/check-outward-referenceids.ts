/**
 * Check referenceId patterns for historical outward transactions.
 * Determines if order numbers are embedded in referenceIds.
 */

import 'dotenv/config';
import { PrismaClient, Prisma } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
    // 1. Sample referenceIds for outward/sale WITHOUT orderNumber
    const samples = await prisma.inventoryTransaction.findMany({
        where: { txnType: 'outward', reason: 'sale', orderNumber: null },
        select: { referenceId: true },
        take: 20,
    });
    console.log('=== Sample referenceIds for outward/sale WITHOUT orderNumber ===');
    for (const s of samples) {
        console.log('  ', s.referenceId);
    }

    // 2. Check referenceId prefix distribution using raw SQL
    const prefixQuery = await prisma.$queryRawUnsafe<Array<{ prefix: string; cnt: string }>>(
        `SELECT
            CASE
                WHEN "referenceId" LIKE 'sheet:outward-live%' THEN 'sheet:outward-live'
                WHEN "referenceId" LIKE 'sheet:ms-outward%' THEN 'sheet:ms-outward'
                WHEN "referenceId" LIKE 'sheet:ol-outward%' THEN 'sheet:ol-outward'
                WHEN "referenceId" LIKE 'sheet:%' THEN 'sheet:other'
                ELSE COALESCE(LEFT("referenceId", 30), 'null')
            END as prefix,
            COUNT(*)::text as cnt
        FROM "InventoryTransaction"
        WHERE "txnType" = 'outward'
        GROUP BY prefix
        ORDER BY COUNT(*) DESC`
    );
    console.log('\n=== ReferenceId prefix distribution (outward) ===');
    for (const r of prefixQuery) {
        console.log('  ', r.prefix.padEnd(30), r.cnt.padStart(8));
    }

    // 3. Sample ms-outward referenceIds to see if order number is embedded
    const msSamples = await prisma.inventoryTransaction.findMany({
        where: { txnType: 'outward', referenceId: { startsWith: 'sheet:ms-outward' } },
        select: { referenceId: true },
        take: 20,
    });
    if (msSamples.length > 0) {
        console.log('\n=== Sample sheet:ms-outward referenceIds ===');
        for (const s of msSamples) {
            console.log('  ', s.referenceId);
        }
    }

    // 4. Sample outward-live referenceIds
    const liveSamples = await prisma.inventoryTransaction.findMany({
        where: { txnType: 'outward', referenceId: { startsWith: 'sheet:outward-live' } },
        select: { referenceId: true, orderNumber: true },
        take: 20,
    });
    if (liveSamples.length > 0) {
        console.log('\n=== Sample sheet:outward-live referenceIds ===');
        for (const s of liveSamples) {
            console.log('  ', s.referenceId, '  orderNumber:', s.orderNumber);
        }
    }

    // 5. Count how many historical outward txns have order-number-looking segments in referenceId
    // Pattern: sheet:ms-outward:SKU:qty:date:ORDERNUMBER
    const historicalWithOrderInRef = await prisma.$queryRawUnsafe<Array<{ cnt: string }>>(
        `SELECT COUNT(*)::text as cnt
         FROM "InventoryTransaction"
         WHERE "txnType" = 'outward'
         AND "orderNumber" IS NULL
         AND "referenceId" LIKE 'sheet:ms-outward%'
         AND array_length(string_to_array("referenceId", ':'), 1) >= 6`
    );
    console.log('\n=== Historical ms-outward with 6+ segments in referenceId ===');
    console.log('  Count:', historicalWithOrderInRef[0]?.cnt ?? '0');

    // 6. For ms-outward with 6+ segments, show samples of the 6th segment (potential order number)
    const withExtra = await prisma.$queryRawUnsafe<Array<{ ref: string; seg6: string }>>(
        `SELECT "referenceId" as ref,
                split_part("referenceId", ':', 6) as seg6
         FROM "InventoryTransaction"
         WHERE "txnType" = 'outward'
         AND "orderNumber" IS NULL
         AND "referenceId" LIKE 'sheet:ms-outward%'
         AND array_length(string_to_array("referenceId", ':'), 1) >= 6
         LIMIT 30`
    );
    if (withExtra.length > 0) {
        console.log('\n=== Sample 6th segment (potential order#) from ms-outward refs ===');
        for (const r of withExtra) {
            console.log('  ', r.seg6.padEnd(20), '←', r.ref);
        }
    }

    // 7. Also check sheet:other prefix
    const otherSamples = await prisma.inventoryTransaction.findMany({
        where: {
            txnType: 'outward',
            referenceId: { startsWith: 'sheet:' },
            NOT: [
                { referenceId: { startsWith: 'sheet:outward-live' } },
                { referenceId: { startsWith: 'sheet:ms-outward' } },
                { referenceId: { startsWith: 'sheet:ol-outward' } },
            ],
        },
        select: { referenceId: true, orderNumber: true },
        take: 20,
    });
    if (otherSamples.length > 0) {
        console.log('\n=== Sample sheet:other referenceIds ===');
        for (const s of otherSamples) {
            console.log('  ', s.referenceId, '  orderNumber:', s.orderNumber);
        }
    }
}

main()
    .catch(console.error)
    .finally(() => prisma.$disconnect());
