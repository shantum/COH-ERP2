/**
 * Fix Missing BOM Templates & Recalculate BOM Costs
 *
 * Uses raw SQL for bulk operations to avoid connection pool issues.
 *
 * Usage:
 *   cd server && npx tsx src/scripts/fixMissingBomTemplates.ts
 */

import { getPrisma } from '@coh/shared/services/db';

async function fixMissingBomTemplates() {
    console.log('Starting BOM cost fix...\n');

    const prisma = await getPrisma();

    // Step 1: Create missing ProductBomTemplates using raw SQL
    console.log('Step 1: Creating missing ProductBomTemplates...');

    const insertedTemplates = await prisma.$executeRaw`
        INSERT INTO "ProductBomTemplate" ("id", "productId", "roleId", "defaultQuantity", "quantityUnit", "wastagePercent", "createdAt", "updatedAt")
        SELECT
            gen_random_uuid(),
            v."productId",
            vbl."roleId",
            1.5,
            'meter',
            5,
            NOW(),
            NOW()
        FROM "VariationBomLine" vbl
        JOIN "Variation" v ON v.id = vbl."variationId"
        JOIN "ComponentRole" cr ON cr.id = vbl."roleId"
        JOIN "ComponentType" ct ON ct.id = cr."typeId"
        WHERE vbl."fabricColourId" IS NOT NULL
          AND ct.code = 'FABRIC'
          AND NOT EXISTS (
              SELECT 1 FROM "ProductBomTemplate" pbt
              WHERE pbt."productId" = v."productId"
                AND pbt."roleId" = vbl."roleId"
          )
        GROUP BY v."productId", vbl."roleId"
        ON CONFLICT DO NOTHING
    `;

    console.log(`  Created ${insertedTemplates} missing templates.\n`);

    // Step 2: Recalculate SKU BOM costs using raw SQL
    console.log('Step 2: Recalculating SKU BOM costs...');

    const skuCostUpdate = await prisma.$executeRaw`
        WITH sku_costs AS (
            SELECT
                s.id as sku_id,
                SUM(
                    COALESCE(sbl.quantity, vbl.quantity, pbt."defaultQuantity", 1)
                    * (1 + COALESCE(sbl."wastagePercent", vbl."wastagePercent", pbt."wastagePercent", 0) / 100.0)
                    * COALESCE(
                        sbl."overrideCost",
                        CASE
                            WHEN ct.code = 'FABRIC' THEN COALESCE(fc."costPerUnit", f."costPerUnit")
                            WHEN ct.code = 'TRIM' THEN COALESCE(ti_sku."costPerUnit", ti_var."costPerUnit", ti_prod."costPerUnit")
                            WHEN ct.code = 'SERVICE' THEN COALESCE(si_sku."costPerJob", si_var."costPerJob", si_prod."costPerJob")
                        END,
                        0
                    )
                ) as total_cost
            FROM "Sku" s
            JOIN "Variation" v ON v.id = s."variationId"
            JOIN "ProductBomTemplate" pbt ON pbt."productId" = v."productId"
            JOIN "ComponentRole" cr ON cr.id = pbt."roleId"
            JOIN "ComponentType" ct ON ct.id = cr."typeId"
            LEFT JOIN "VariationBomLine" vbl ON vbl."variationId" = v.id AND vbl."roleId" = pbt."roleId"
            LEFT JOIN "SkuBomLine" sbl ON sbl."skuId" = s.id AND sbl."roleId" = pbt."roleId"
            -- Fabric resolution
            LEFT JOIN "FabricColour" fc ON fc.id = COALESCE(sbl."fabricColourId", vbl."fabricColourId")
            LEFT JOIN "Fabric" f ON f.id = fc."fabricId"
            -- Trim resolution
            LEFT JOIN "TrimItem" ti_sku ON ti_sku.id = sbl."trimItemId"
            LEFT JOIN "TrimItem" ti_var ON ti_var.id = vbl."trimItemId"
            LEFT JOIN "TrimItem" ti_prod ON ti_prod.id = pbt."trimItemId"
            -- Service resolution
            LEFT JOIN "ServiceItem" si_sku ON si_sku.id = sbl."serviceItemId"
            LEFT JOIN "ServiceItem" si_var ON si_var.id = vbl."serviceItemId"
            LEFT JOIN "ServiceItem" si_prod ON si_prod.id = pbt."serviceItemId"
            WHERE s."isActive" = true
            GROUP BY s.id
        )
        UPDATE "Sku" s
        SET "bomCost" = NULLIF(sc.total_cost, 0)
        FROM sku_costs sc
        WHERE s.id = sc.sku_id
          AND (s."bomCost" IS DISTINCT FROM NULLIF(sc.total_cost, 0))
    `;

    console.log(`  Updated ${skuCostUpdate} SKU costs.\n`);

    // Step 3: Recalculate Variation BOM costs (average of SKU costs)
    console.log('Step 3: Recalculating Variation BOM costs...');

    const variationCostUpdate = await prisma.$executeRaw`
        WITH variation_costs AS (
            SELECT
                s."variationId",
                AVG(s."bomCost") as avg_cost
            FROM "Sku" s
            WHERE s."isActive" = true
              AND s."bomCost" IS NOT NULL
            GROUP BY s."variationId"
        )
        UPDATE "Variation" v
        SET "bomCost" = vc.avg_cost
        FROM variation_costs vc
        WHERE v.id = vc."variationId"
          AND (v."bomCost" IS DISTINCT FROM vc.avg_cost)
    `;

    console.log(`  Updated ${variationCostUpdate} Variation costs.\n`);

    // Summary
    console.log('=== Fix Complete ===');
    console.log(`ProductBomTemplates created: ${insertedTemplates}`);
    console.log(`SKU costs updated: ${skuCostUpdate}`);
    console.log(`Variation costs updated: ${variationCostUpdate}`);

    await prisma.$disconnect();
}

// Run the fix
fixMissingBomTemplates()
    .then(() => {
        console.log('\nCompleted successfully.');
        process.exit(0);
    })
    .catch((err) => {
        console.error('\nFailed:', err);
        process.exit(1);
    });
