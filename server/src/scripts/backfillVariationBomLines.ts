/**
 * Backfill Variation BOM Lines from Legacy fabricColourId
 *
 * PREREQUISITE SCRIPT - Run this BEFORE the fabric consolidation migration!
 *
 * This script:
 * 1. Finds all variations with fabricColourId set (legacy field)
 * 2. Creates VariationBomLine records for the main fabric role
 * 3. Ensures no data is lost when the migration drops Variation.fabricColourId
 *
 * Safe to run multiple times - uses skipDuplicates and checks for existing BOM lines.
 *
 * Usage:
 *   npx ts-node server/src/scripts/backfillVariationBomLines.ts
 *
 * Or on server:
 *   ssh root@128.140.98.253 "cd /opt/coh-erp && npx ts-node server/src/scripts/backfillVariationBomLines.ts"
 */

import * as dotenv from 'dotenv';
dotenv.config();

import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient({
    log: ['warn', 'error'],
});

interface VariationWithLegacyFabric {
    id: string;
    colorName: string;
    productName: string;
    fabricColourId: string;
    fabricColourName: string | null;
    fabricName: string | null;
}

interface BomLineCheck {
    variationId: string;
    hasBomLine: boolean;
}

async function main() {
    console.log('='.repeat(60));
    console.log('Backfill Variation BOM Lines from Legacy fabricColourId');
    console.log('='.repeat(60));
    console.log();

    // Step 1: Get the main fabric role ID
    console.log('Step 1: Finding main fabric role...');
    const mainFabricRole = await prisma.componentRole.findFirst({
        where: {
            code: 'main',
            type: { code: 'FABRIC' },
        },
        include: { type: true },
    });

    if (!mainFabricRole) {
        console.error('ERROR: Main fabric role not found!');
        console.error('Please ensure ComponentRole with code="main" and type="FABRIC" exists.');
        process.exit(1);
    }

    console.log(`  Found: ${mainFabricRole.name} (${mainFabricRole.id})`);
    console.log();

    // Step 2: Find all variations with legacy fabricColourId set
    // NOTE: Using raw SQL because Prisma schema no longer has this field
    console.log('Step 2: Finding variations with legacy fabricColourId...');

    const variationsWithLegacyFabric = await prisma.$queryRaw<VariationWithLegacyFabric[]>`
        SELECT
            v.id,
            v."colorName",
            p.name as "productName",
            v."fabricColourId",
            fc."colourName" as "fabricColourName",
            f.name as "fabricName"
        FROM "Variation" v
        JOIN "Product" p ON v."productId" = p.id
        LEFT JOIN "FabricColour" fc ON v."fabricColourId" = fc.id
        LEFT JOIN "Fabric" f ON fc."fabricId" = f.id
        WHERE v."fabricColourId" IS NOT NULL
        ORDER BY p.name, v."colorName"
    `;

    console.log(`  Found ${variationsWithLegacyFabric.length} variations with fabricColourId set`);
    console.log();

    if (variationsWithLegacyFabric.length === 0) {
        console.log('No variations to backfill. Either:');
        console.log('  - All variations already use BOM for fabric assignment');
        console.log('  - Or no variations had fabricColourId set');
        console.log();
        console.log('Safe to proceed with migration.');
        return;
    }

    // Step 3: Check which variations already have a main fabric BOM line
    console.log('Step 3: Checking existing BOM lines...');

    const variationIds = variationsWithLegacyFabric.map(v => v.id);

    const existingBomLines = await prisma.variationBomLine.findMany({
        where: {
            variationId: { in: variationIds },
            roleId: mainFabricRole.id,
        },
        select: { variationId: true, fabricColourId: true },
    });

    const existingBomMap = new Map(existingBomLines.map(b => [b.variationId, b.fabricColourId]));

    console.log(`  Found ${existingBomLines.length} existing BOM lines for these variations`);
    console.log();

    // Step 4: Identify variations needing backfill
    const needsBackfill: VariationWithLegacyFabric[] = [];
    const alreadyHasBom: VariationWithLegacyFabric[] = [];
    const mismatch: { variation: VariationWithLegacyFabric; bomFabricColourId: string | null }[] = [];

    for (const v of variationsWithLegacyFabric) {
        const existingBomFabricColourId = existingBomMap.get(v.id);

        if (existingBomFabricColourId === undefined) {
            // No BOM line exists - needs backfill
            needsBackfill.push(v);
        } else if (existingBomFabricColourId === v.fabricColourId) {
            // BOM line exists with same fabricColourId - already good
            alreadyHasBom.push(v);
        } else {
            // BOM line exists but with different fabricColourId - mismatch!
            mismatch.push({ variation: v, bomFabricColourId: existingBomFabricColourId });
        }
    }

    console.log('Step 4: Analysis results:');
    console.log(`  - Already has matching BOM line: ${alreadyHasBom.length}`);
    console.log(`  - Needs backfill (no BOM line): ${needsBackfill.length}`);
    console.log(`  - Mismatch (BOM has different fabric): ${mismatch.length}`);
    console.log();

    // Report mismatches (these need manual review)
    if (mismatch.length > 0) {
        console.log('⚠️  WARNING: Found variations where BOM fabric differs from legacy fabricColourId:');
        console.log('    These will NOT be updated (BOM takes precedence). Review if needed:');
        for (const { variation: v, bomFabricColourId } of mismatch.slice(0, 10)) {
            console.log(`    - ${v.productName} / ${v.colorName}`);
            console.log(`      Legacy: ${v.fabricName} > ${v.fabricColourName} (${v.fabricColourId})`);
            console.log(`      BOM:    ${bomFabricColourId || 'null'}`);
        }
        if (mismatch.length > 10) {
            console.log(`    ... and ${mismatch.length - 10} more`);
        }
        console.log();
    }

    // Step 5: Create BOM lines for variations that need backfill
    if (needsBackfill.length === 0) {
        console.log('✅ No variations need backfill. All variations either:');
        console.log('   - Already have BOM lines, or');
        console.log('   - Have mismatches that should be reviewed manually');
        console.log();
        console.log('Safe to proceed with migration.');
        return;
    }

    console.log(`Step 5: Creating ${needsBackfill.length} BOM lines...`);
    console.log();

    // Batch create BOM lines
    const bomLinesToCreate = needsBackfill.map(v => ({
        variationId: v.id,
        roleId: mainFabricRole.id,
        fabricColourId: v.fabricColourId,
    }));

    const result = await prisma.variationBomLine.createMany({
        data: bomLinesToCreate,
        skipDuplicates: true,
    });

    console.log(`✅ Created ${result.count} BOM lines`);
    console.log();

    // Step 6: Verify
    console.log('Step 6: Verification...');

    const remainingWithoutBom = await prisma.$queryRaw<{ count: bigint }[]>`
        SELECT COUNT(*) as count
        FROM "Variation" v
        WHERE v."fabricColourId" IS NOT NULL
        AND NOT EXISTS (
            SELECT 1 FROM "VariationBomLine" vbl
            WHERE vbl."variationId" = v.id
            AND vbl."roleId" = ${mainFabricRole.id}::uuid
        )
    `;

    const remainingCount = Number(remainingWithoutBom[0]?.count || 0);

    if (remainingCount === 0) {
        console.log('✅ All variations with fabricColourId now have BOM lines');
        console.log();
        console.log('='.repeat(60));
        console.log('BACKFILL COMPLETE - Safe to run migration');
        console.log('='.repeat(60));
    } else {
        console.log(`⚠️  ${remainingCount} variations still without BOM lines`);
        console.log('   This may be due to race conditions or errors.');
        console.log('   Please run this script again or investigate manually.');
    }
}

main()
    .catch((error) => {
        console.error('ERROR:', error);
        process.exit(1);
    })
    .finally(() => {
        prisma.$disconnect();
    });
