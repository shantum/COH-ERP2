/**
 * Re-classify return reasons using AI
 *
 * Step 1: Pull customer comments from CSV enrichment into OrderLines that don't have them
 * Step 2: AI-classify all "other" lines that now have meaningful comments
 *
 * Usage: cd server && npx tsx src/scripts/reclassifyReturnReasons.ts [--dry-run]
 */

import { PrismaClient, Prisma } from '@prisma/client';
import { classifyReturnCommentsBatch } from '../services/aiClassifier.js';

const prisma = new PrismaClient();
const isDryRun = process.argv.includes('--dry-run');

async function main() {
    console.log(isDryRun ? '=== DRY RUN ===' : '=== LIVE RUN ===');

    // Step 1: Pull enrichment comments into OrderLines missing returnReasonDetail
    console.log('\n--- Step 1: Pull enrichment data into OrderLines ---');

    const enrichCount = isDryRun
        ? await prisma.$queryRaw<[{ count: bigint }]>`
            SELECT COUNT(*) as count FROM "OrderLine" ol
            JOIN "ReturnPrimeRequest" rpr ON rpr."orderId" = ol."orderId"
            JOIN "ReturnPrimeCsvEnrichment" e ON e."requestNumber" = rpr."rpRequestNumber"
            WHERE (ol."returnReasonDetail" IS NULL OR ol."returnReasonDetail" IN ('Others', 'NA'))
              AND e."customerComment" IS NOT NULL
              AND e."customerComment" != ''
              AND e."customerComment" NOT IN ('Others', 'NA', 'N/A')
              AND ol."returnStatus" IS NOT NULL
          `.then(r => Number(r[0].count))
        : await prisma.$executeRaw`
            UPDATE "OrderLine" ol
            SET "returnReasonDetail" = e."customerComment"
            FROM "ReturnPrimeRequest" rpr
            JOIN "ReturnPrimeCsvEnrichment" e ON e."requestNumber" = rpr."rpRequestNumber"
            WHERE rpr."orderId" = ol."orderId"
              AND (ol."returnReasonDetail" IS NULL OR ol."returnReasonDetail" IN ('Others', 'NA'))
              AND e."customerComment" IS NOT NULL
              AND e."customerComment" != ''
              AND e."customerComment" NOT IN ('Others', 'NA', 'N/A')
              AND ol."returnStatus" IS NOT NULL
          `.then(Number);

    console.log(`${isDryRun ? 'Would enrich' : 'Enriched'} ${enrichCount} OrderLines with CSV customer comments`);

    // Step 2: AI-classify all "other" lines with meaningful comments
    console.log('\n--- Step 2: AI classification ---');

    const lines = await prisma.orderLine.findMany({
        where: {
            returnStatus: { not: null },
            OR: [
                { returnReasonCategory: 'other' },
                { returnReasonCategory: null },
            ],
            returnReasonDetail: { not: null },
        },
        select: {
            id: true,
            returnReasonDetail: true,
            returnReasonCategory: true,
        },
    });

    const classifiable = lines.filter(l => {
        const comment = l.returnReasonDetail?.trim().toLowerCase();
        return comment
            && comment !== 'others'
            && comment !== 'na'
            && comment !== 'n/a'
            && comment.length > 2;
    });

    console.log(`Found ${lines.length} "other"/null lines with comments`);
    console.log(`${classifiable.length} have meaningful comments to classify`);

    if (classifiable.length === 0) {
        console.log('Nothing to reclassify.');
        return;
    }

    console.log(`\nClassifying ${classifiable.length} comments with AI...`);
    const classifications = await classifyReturnCommentsBatch(
        classifiable.map(l => ({ id: l.id, comment: l.returnReasonDetail! }))
    );

    const changes: Array<{ id: string; comment: string; to: string }> = [];
    for (const line of classifiable) {
        const newCategory = classifications.get(line.id);
        if (newCategory && newCategory !== 'other') {
            changes.push({ id: line.id, comment: line.returnReasonDetail!, to: newCategory });
        }
    }

    console.log(`\n${changes.length} of ${classifiable.length} would be reclassified:`);

    const byCat: Record<string, number> = {};
    for (const c of changes) byCat[c.to] = (byCat[c.to] || 0) + 1;
    for (const [cat, count] of Object.entries(byCat).sort((a, b) => b[1] - a[1])) {
        console.log(`  ${cat}: ${count}`);
    }

    console.log('\nSamples:');
    for (const c of changes.slice(0, 15)) {
        console.log(`  "${c.comment}" → ${c.to}`);
    }

    if (isDryRun) {
        console.log('\n[DRY RUN] No changes written. Run without --dry-run to apply.');
        return;
    }

    console.log(`\nApplying ${changes.length} updates...`);
    const BATCH = 100;
    let applied = 0;
    for (let i = 0; i < changes.length; i += BATCH) {
        const batch = changes.slice(i, i + BATCH);
        await prisma.$transaction(
            batch.map(c =>
                prisma.orderLine.update({
                    where: { id: c.id },
                    data: { returnReasonCategory: c.to },
                })
            )
        );
        applied += batch.length;
        console.log(`  ${applied}/${changes.length} applied`);
    }

    console.log('\nDone!');
}

main()
    .catch(console.error)
    .finally(() => prisma.$disconnect());
