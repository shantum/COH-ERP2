/**
 * Sync Return Prime Status → OrderLine returnStatus
 *
 * One-time script to advance OrderLines whose returnStatus is stuck behind
 * the actual Return Prime request state.
 *
 * Status mapping (RP → ERP):
 *   isRefunded / isArchived / isRejected  →  'complete'
 *   isInspected / isReceived              →  'received'
 *   isApproved                            →  'requested' (no-op, already there)
 *
 * Only advances forward. Never moves a status backward.
 *
 * Dry-run by default. Pass --execute to actually write.
 *
 * Usage:
 *   npx tsx src/scripts/syncReturnPrimeStatusToOrderLines.ts          # dry-run
 *   npx tsx src/scripts/syncReturnPrimeStatusToOrderLines.ts --execute # write to DB
 */

import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();
const DRY_RUN = !process.argv.includes('--execute');

async function main(): Promise<void> {
    console.log(`\n=== Sync RP Status → OrderLine ${DRY_RUN ? '(DRY RUN)' : '(EXECUTE MODE)'} ===\n`);

    // --- Step 1: 'received' → 'complete' ---
    // OrderLines at 'received' whose RP request is refunded/archived/rejected
    const receivedToCompleteResult = await prisma.$queryRawUnsafe<[{ count: bigint }]>(
        DRY_RUN
            ? `SELECT COUNT(*) as count
               FROM "OrderLine" ol
               JOIN "ReturnPrimeRequest" rp ON rp."rpRequestId" = ol."returnPrimeRequestId"
               WHERE ol."returnStatus" = 'received'
                 AND ol."returnPrimeRequestId" IS NOT NULL
                 AND (rp."isRefunded" = true OR rp."isArchived" = true OR rp."isRejected" = true)`
            : `WITH updated AS (
                   UPDATE "OrderLine" ol
                   SET "returnStatus" = 'complete',
                       "returnPrimeStatus" = CASE
                           WHEN rp."isRefunded" = true THEN 'refunded'
                           WHEN rp."isRejected" = true THEN 'rejected'
                           WHEN rp."isArchived" = true THEN 'archived'
                       END,
                       "returnPrimeUpdatedAt" = NOW()
                   FROM "ReturnPrimeRequest" rp
                   WHERE rp."rpRequestId" = ol."returnPrimeRequestId"
                     AND ol."returnStatus" = 'received'
                     AND ol."returnPrimeRequestId" IS NOT NULL
                     AND (rp."isRefunded" = true OR rp."isArchived" = true OR rp."isRejected" = true)
                   RETURNING ol.id
               )
               SELECT COUNT(*) as count FROM updated`
    );
    const receivedToComplete = Number(receivedToCompleteResult[0].count);
    console.log(`Step 1: 'received' → 'complete': ${receivedToComplete} lines`);

    // --- Step 2: 'requested'/'pickup_scheduled'/'in_transit' → 'received' ---
    // Where RP shows isReceived or isInspected (but NOT refunded/archived/rejected — handled in step 3)
    const earlyToReceivedResult = await prisma.$queryRawUnsafe<[{ count: bigint }]>(
        DRY_RUN
            ? `SELECT COUNT(*) as count
               FROM "OrderLine" ol
               JOIN "ReturnPrimeRequest" rp ON rp."rpRequestId" = ol."returnPrimeRequestId"
               WHERE ol."returnStatus" IN ('requested', 'pickup_scheduled', 'in_transit')
                 AND ol."returnPrimeRequestId" IS NOT NULL
                 AND (rp."isReceived" = true OR rp."isInspected" = true)
                 AND rp."isRefunded" = false AND rp."isArchived" = false AND rp."isRejected" = false`
            : `WITH updated AS (
                   UPDATE "OrderLine" ol
                   SET "returnStatus" = 'received',
                       "returnPrimeStatus" = CASE
                           WHEN rp."isInspected" = true THEN 'inspected'
                           WHEN rp."isReceived" = true THEN 'received'
                       END,
                       "returnPrimeUpdatedAt" = NOW(),
                       "returnReceivedAt" = COALESCE(ol."returnReceivedAt", rp."receivedAt", NOW())
                   FROM "ReturnPrimeRequest" rp
                   WHERE rp."rpRequestId" = ol."returnPrimeRequestId"
                     AND ol."returnStatus" IN ('requested', 'pickup_scheduled', 'in_transit')
                     AND ol."returnPrimeRequestId" IS NOT NULL
                     AND (rp."isReceived" = true OR rp."isInspected" = true)
                     AND rp."isRefunded" = false AND rp."isArchived" = false AND rp."isRejected" = false
                   RETURNING ol.id
               )
               SELECT COUNT(*) as count FROM updated`
    );
    const earlyToReceived = Number(earlyToReceivedResult[0].count);
    console.log(`Step 2: 'requested/pickup_scheduled/in_transit' → 'received': ${earlyToReceived} lines`);

    // --- Step 3: 'requested'/'pickup_scheduled'/'in_transit' → 'complete' ---
    // Where RP is already refunded/archived/rejected (skip straight to complete)
    const earlyToCompleteResult = await prisma.$queryRawUnsafe<[{ count: bigint }]>(
        DRY_RUN
            ? `SELECT COUNT(*) as count
               FROM "OrderLine" ol
               JOIN "ReturnPrimeRequest" rp ON rp."rpRequestId" = ol."returnPrimeRequestId"
               WHERE ol."returnStatus" IN ('requested', 'pickup_scheduled', 'in_transit')
                 AND ol."returnPrimeRequestId" IS NOT NULL
                 AND (rp."isRefunded" = true OR rp."isArchived" = true OR rp."isRejected" = true)`
            : `WITH updated AS (
                   UPDATE "OrderLine" ol
                   SET "returnStatus" = 'complete',
                       "returnPrimeStatus" = CASE
                           WHEN rp."isRefunded" = true THEN 'refunded'
                           WHEN rp."isRejected" = true THEN 'rejected'
                           WHEN rp."isArchived" = true THEN 'archived'
                       END,
                       "returnPrimeUpdatedAt" = NOW(),
                       "returnReceivedAt" = COALESCE(ol."returnReceivedAt", rp."receivedAt", NOW())
                   FROM "ReturnPrimeRequest" rp
                   WHERE rp."rpRequestId" = ol."returnPrimeRequestId"
                     AND ol."returnStatus" IN ('requested', 'pickup_scheduled', 'in_transit')
                     AND ol."returnPrimeRequestId" IS NOT NULL
                     AND (rp."isRefunded" = true OR rp."isArchived" = true OR rp."isRejected" = true)
                   RETURNING ol.id
               )
               SELECT COUNT(*) as count FROM updated`
    );
    const earlyToComplete = Number(earlyToCompleteResult[0].count);
    console.log(`Step 3: 'requested/pickup_scheduled/in_transit' → 'complete': ${earlyToComplete} lines`);

    // --- Summary ---
    const totalComplete = receivedToComplete + earlyToComplete;
    const totalUpdated = totalComplete + earlyToReceived;

    console.log('\n=== Summary ===');
    console.log(`Total → complete:  ${totalComplete}`);
    console.log(`Total → received:  ${earlyToReceived}`);
    console.log(`Total updated:     ${totalUpdated}`);
    console.log(DRY_RUN ? '\nRe-run with --execute to apply changes.' : '\nDone!');
}

main()
    .catch(err => {
        console.error('Fatal error:', err);
        process.exit(1);
    })
    .finally(() => prisma.$disconnect());
