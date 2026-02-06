/**
 * Efficient batch script to recalculate BOM costs for all variations and SKUs.
 *
 * Run with: npx tsx scripts/recalculate-bom-costs.ts
 *
 * Uses raw SQL for bulk updates to minimize round trips over remote connections.
 */

import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
    console.log('🔄 Starting BOM cost recalculation (batch mode)...\n');

    // Step 1: Update all SKU bomCosts using SQL
    // This calculates: SUM(quantity * (1 + wastage/100) * unitCost) for each BOM line
    console.log('Step 1: Calculating SKU BOM costs...');

    const skuCostResult = await prisma.$executeRaw`
        WITH sku_costs AS (
            SELECT
                s.id as sku_id,
                SUM(
                    COALESCE(sbl.quantity, vbl.quantity, pbt."defaultQuantity", 0) *
                    (1 + COALESCE(sbl."wastagePercent", vbl."wastagePercent", pbt."wastagePercent", 0) / 100.0) *
                    CASE
                        WHEN cr."typeId" = (SELECT id FROM "ComponentType" WHERE code = 'FABRIC') THEN
                            COALESCE(
                                sbl_fc."costPerUnit",
                                sbl_f."costPerUnit",
                                vbl_fc."costPerUnit",
                                vbl_f."costPerUnit",
                                0
                            )
                        WHEN cr."typeId" = (SELECT id FROM "ComponentType" WHERE code = 'TRIM') THEN
                            COALESCE(
                                sbl_ti."costPerUnit",
                                vbl_ti."costPerUnit",
                                pbt_ti."costPerUnit",
                                0
                            )
                        WHEN cr."typeId" = (SELECT id FROM "ComponentType" WHERE code = 'SERVICE') THEN
                            COALESCE(
                                sbl_si."costPerJob",
                                vbl_si."costPerJob",
                                pbt_si."costPerJob",
                                0
                            )
                        ELSE 0
                    END
                ) as calculated_cost
            FROM "Sku" s
            JOIN "Variation" v ON s."variationId" = v.id
            JOIN "Product" p ON v."productId" = p.id
            JOIN "ProductBomTemplate" pbt ON pbt."productId" = p.id
            JOIN "ComponentRole" cr ON pbt."roleId" = cr.id
            LEFT JOIN "VariationBomLine" vbl ON vbl."variationId" = v.id AND vbl."roleId" = cr.id
            LEFT JOIN "SkuBomLine" sbl ON sbl."skuId" = s.id AND sbl."roleId" = cr.id
            -- Fabric lookups
            LEFT JOIN "FabricColour" sbl_fc ON sbl."fabricColourId" = sbl_fc.id
            LEFT JOIN "Fabric" sbl_f ON sbl_fc."fabricId" = sbl_f.id
            LEFT JOIN "FabricColour" vbl_fc ON vbl."fabricColourId" = vbl_fc.id
            LEFT JOIN "Fabric" vbl_f ON vbl_fc."fabricId" = vbl_f.id
            -- Trim lookups
            LEFT JOIN "TrimItem" sbl_ti ON sbl."trimItemId" = sbl_ti.id
            LEFT JOIN "TrimItem" vbl_ti ON vbl."trimItemId" = vbl_ti.id
            LEFT JOIN "TrimItem" pbt_ti ON pbt."trimItemId" = pbt_ti.id
            -- Service lookups
            LEFT JOIN "ServiceItem" sbl_si ON sbl."serviceItemId" = sbl_si.id
            LEFT JOIN "ServiceItem" vbl_si ON vbl."serviceItemId" = vbl_si.id
            LEFT JOIN "ServiceItem" pbt_si ON pbt."serviceItemId" = pbt_si.id
            WHERE s."isActive" = true
            GROUP BY s.id
        )
        UPDATE "Sku" s
        SET "bomCost" = CASE
            WHEN sc.calculated_cost > 0 THEN sc.calculated_cost
            ELSE NULL
        END
        FROM sku_costs sc
        WHERE s.id = sc.sku_id
    `;

    console.log(`   Updated ${skuCostResult} SKUs\n`);

    // Step 2: Update all Variation bomCosts as the average of their SKU bomCosts
    console.log('Step 2: Calculating Variation BOM costs (avg of SKUs)...');

    const variationCostResult = await prisma.$executeRaw`
        WITH variation_avg AS (
            SELECT
                v.id as variation_id,
                AVG(s."bomCost") as avg_cost,
                COUNT(s."bomCost") as sku_count
            FROM "Variation" v
            LEFT JOIN "Sku" s ON s."variationId" = v.id AND s."isActive" = true AND s."bomCost" IS NOT NULL
            WHERE v."isActive" = true
            GROUP BY v.id
        )
        UPDATE "Variation" v
        SET "bomCost" = CASE
            WHEN va.sku_count > 0 THEN va.avg_cost
            ELSE NULL
        END
        FROM variation_avg va
        WHERE v.id = va.variation_id
    `;

    console.log(`   Updated ${variationCostResult} Variations\n`);

    // Step 3: Show some sample results for verification
    console.log('Step 3: Verifying results (sample)...');

    const sample = await prisma.variation.findMany({
        where: {
            isActive: true,
            bomCost: { not: null }
        },
        select: {
            id: true,
            colorName: true,
            bomCost: true,
            product: { select: { name: true } },
            skus: {
                where: { isActive: true },
                select: { size: true, bomCost: true },
                take: 3
            }
        },
        take: 5,
        orderBy: { updatedAt: 'desc' }
    });

    console.log('\nSample updated variations:');
    for (const v of sample) {
        console.log(`  ${v.product.name} - ${v.colorName}: ₹${v.bomCost?.toFixed(2) ?? 'null'}`);
        for (const sku of v.skus) {
            console.log(`    ${sku.size}: ₹${sku.bomCost?.toFixed(2) ?? 'null'}`);
        }
    }

    console.log('\n✅ BOM cost recalculation complete!');

    await prisma.$disconnect();
}

main().catch((error) => {
    console.error('Fatal error:', error);
    prisma.$disconnect();
    process.exit(1);
});
