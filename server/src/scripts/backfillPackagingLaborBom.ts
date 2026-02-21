/**
 * Backfill Packaging & Stitching BOM Lines
 *
 * For every active Product, creates:
 * 1. ProductBomTemplate for packaging (PKG-STD trim) and stitching (SVC-STITCH service)
 * 2. VariationBomLine overrides where variation has custom laborMinutes
 * 3. SkuBomLine overrides where SKU has custom laborMinutes or packagingCost
 *
 * Packaging cost cascade (for overrideCost on SkuBomLine):
 *   SKU.packagingCost > Variation.packagingCost > Product.packagingCost > default (50)
 *   Only creates SkuBomLine when the resolved cost differs from the TrimItem catalog price (50).
 *
 * Stitching quantity cascade:
 *   SKU.laborMinutes > Variation.laborMinutes > Product.baseProductionTimeMins (default 60)
 *   VariationBomLine created when variation.laborMinutes differs from product default.
 *   SkuBomLine created when sku.laborMinutes differs from its variation's effective value.
 *
 * Prerequisite: Run seedPackagingAndLaborBom.ts first.
 * Idempotent — uses upserts on unique constraints.
 *
 * Usage: npx tsx server/src/scripts/backfillPackagingLaborBom.ts
 */

import prisma from '../lib/prisma.js';

const BATCH_SIZE = 50;

interface Summary {
  productsProcessed: number;
  packagingTemplates: number;
  stitchingTemplates: number;
  variationLaborLines: number;
  skuLaborLines: number;
  skuPackagingLines: number;
  errors: number;
}

async function main() {
  console.log('=== Backfill Packaging & Stitching BOM Lines ===\n');

  // 1. Look up required roles and catalog items (fail fast if seed not run)
  const [packagingRole, stitchingRole, pkgTrimItem, svcStitchItem] = await Promise.all([
    prisma.componentRole.findFirst({
      where: { code: 'packaging', type: { code: 'TRIM' } },
      include: { type: true },
    }),
    prisma.componentRole.findFirst({
      where: { code: 'stitching', type: { code: 'SERVICE' } },
      include: { type: true },
    }),
    prisma.trimItem.findUnique({ where: { code: 'PKG-STD' } }),
    prisma.serviceItem.findUnique({ where: { code: 'SVC-STITCH' } }),
  ]);

  if (!packagingRole) throw new Error('ComponentRole "packaging" (TRIM) not found. Run seedPackagingAndLaborBom.ts first.');
  if (!stitchingRole) throw new Error('ComponentRole "stitching" (SERVICE) not found. Run seedPackagingAndLaborBom.ts first.');
  if (!pkgTrimItem) throw new Error('TrimItem "PKG-STD" not found. Run seedPackagingAndLaborBom.ts first.');
  if (!svcStitchItem) throw new Error('ServiceItem "SVC-STITCH" not found. Run seedPackagingAndLaborBom.ts first.');

  const defaultPkgCost = pkgTrimItem.costPerUnit; // 50

  console.log(`Packaging role: ${packagingRole.id} | TrimItem PKG-STD: ${pkgTrimItem.id} (Rs ${defaultPkgCost})`);
  console.log(`Stitching role: ${stitchingRole.id} | ServiceItem SVC-STITCH: ${svcStitchItem.id} (Rs ${svcStitchItem.costPerJob}/min)`);

  // 2. Load all active products with variations and SKUs
  const products = await prisma.product.findMany({
    where: { isActive: true },
    select: {
      id: true,
      name: true,
      baseProductionTimeMins: true,
      packagingCost: true,
      variations: {
        where: { isActive: true },
        select: {
          id: true,
          packagingCost: true,
          laborMinutes: true,
          skus: {
            where: { isActive: true },
            select: {
              id: true,
              packagingCost: true,
              laborMinutes: true,
            },
          },
        },
      },
    },
    orderBy: { name: 'asc' },
  });

  console.log(`\nFound ${products.length} active products to process.\n`);

  if (products.length === 0) {
    console.log('Nothing to do.');
    return;
  }

  // 3. Process in batches
  const summary: Summary = {
    productsProcessed: 0,
    packagingTemplates: 0,
    stitchingTemplates: 0,
    variationLaborLines: 0,
    skuLaborLines: 0,
    skuPackagingLines: 0,
    errors: 0,
  };

  for (let i = 0; i < products.length; i += BATCH_SIZE) {
    const batch = products.slice(i, i + BATCH_SIZE);

    for (const product of batch) {
      const index = i + batch.indexOf(product) + 1;
      const productDefaultMins = product.baseProductionTimeMins || 60;

      try {
        // --- ProductBomTemplate: Packaging ---
        await prisma.productBomTemplate.upsert({
          where: {
            productId_roleId: {
              productId: product.id,
              roleId: packagingRole.id,
            },
          },
          update: {},
          create: {
            productId: product.id,
            roleId: packagingRole.id,
            trimItemId: pkgTrimItem.id,
            defaultQuantity: 1,
            quantityUnit: 'piece',
            wastagePercent: 0,
          },
        });
        summary.packagingTemplates++;

        // --- ProductBomTemplate: Stitching ---
        await prisma.productBomTemplate.upsert({
          where: {
            productId_roleId: {
              productId: product.id,
              roleId: stitchingRole.id,
            },
          },
          update: {},
          create: {
            productId: product.id,
            roleId: stitchingRole.id,
            serviceItemId: svcStitchItem.id,
            defaultQuantity: productDefaultMins,
            quantityUnit: 'minute',
            wastagePercent: 0,
          },
        });
        summary.stitchingTemplates++;

        // --- Variation & SKU level overrides ---
        for (const variation of product.variations) {
          // Stitching: VariationBomLine if variation has custom laborMinutes
          if (variation.laborMinutes != null && variation.laborMinutes !== productDefaultMins) {
            await prisma.variationBomLine.upsert({
              where: {
                variationId_roleId: {
                  variationId: variation.id,
                  roleId: stitchingRole.id,
                },
              },
              update: { quantity: variation.laborMinutes },
              create: {
                variationId: variation.id,
                roleId: stitchingRole.id,
                serviceItemId: svcStitchItem.id,
                quantity: variation.laborMinutes,
              },
            });
            summary.variationLaborLines++;
          }

          // Effective values for this variation (for comparing against SKU values)
          const variationEffectiveMins = variation.laborMinutes ?? productDefaultMins;
          const variationEffectivePkgCost = variation.packagingCost ?? product.packagingCost ?? null;

          for (const sku of variation.skus) {
            // Stitching: SkuBomLine if SKU has custom laborMinutes different from variation effective
            if (sku.laborMinutes != null && sku.laborMinutes !== variationEffectiveMins) {
              await prisma.skuBomLine.upsert({
                where: {
                  skuId_roleId: {
                    skuId: sku.id,
                    roleId: stitchingRole.id,
                  },
                },
                update: { quantity: sku.laborMinutes },
                create: {
                  skuId: sku.id,
                  roleId: stitchingRole.id,
                  serviceItemId: svcStitchItem.id,
                  quantity: sku.laborMinutes,
                },
              });
              summary.skuLaborLines++;
            }

            // Packaging: SkuBomLine with overrideCost if resolved cost differs from catalog
            // Cascade: SKU > Variation > Product > default
            const resolvedPkgCost = sku.packagingCost ?? variationEffectivePkgCost;
            if (resolvedPkgCost != null && resolvedPkgCost !== defaultPkgCost) {
              await prisma.skuBomLine.upsert({
                where: {
                  skuId_roleId: {
                    skuId: sku.id,
                    roleId: packagingRole.id,
                  },
                },
                update: { overrideCost: resolvedPkgCost },
                create: {
                  skuId: sku.id,
                  roleId: packagingRole.id,
                  trimItemId: pkgTrimItem.id,
                  overrideCost: resolvedPkgCost,
                },
              });
              summary.skuPackagingLines++;
            }
          }

        }

        summary.productsProcessed++;
        console.log(`[${index}/${products.length}] ${product.name} — ${product.variations.length} variations`);
      } catch (error: unknown) {
        summary.errors++;
        const message = error instanceof Error ? error.message : String(error);
        console.error(`[${index}/${products.length}] ${product.name} — ERROR: ${message}`);
      }
    }
  }

  // 4. Print summary
  console.log('\n--- Summary ---');
  console.log(`Products processed:        ${summary.productsProcessed}`);
  console.log(`Packaging templates:       ${summary.packagingTemplates}`);
  console.log(`Stitching templates:       ${summary.stitchingTemplates}`);
  console.log(`Variation labor overrides:  ${summary.variationLaborLines}`);
  console.log(`SKU labor overrides:        ${summary.skuLaborLines}`);
  console.log(`SKU packaging overrides:    ${summary.skuPackagingLines}`);
  console.log(`Errors:                     ${summary.errors}`);
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
