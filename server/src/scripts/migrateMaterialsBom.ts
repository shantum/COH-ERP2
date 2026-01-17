/**
 * Material & BOM Migration Script
 *
 * Full migration script for the new Material hierarchy and BOM system.
 *
 * PHASE 1: Seeds & Fabric Migration
 * 1. Seeds Material records from FabricType mappings
 * 2. Seeds ComponentType and ComponentRole from config
 * 3. Updates existing Fabric records with materialId and textile attributes
 * 4. Creates FabricColour records from existing Fabric color data
 *
 * PHASE 2: BOM Population
 * 5. Creates ProductBomTemplate for each Product (main fabric role)
 * 6. Creates VariationBomLine for each Variation (main fabric + lining if hasLining)
 * 7. Creates SkuBomLine for SKUs with custom fabricConsumption
 *
 * Safe to run multiple times - uses upsert operations.
 *
 * Usage: npx ts-node src/scripts/migrateMaterialsBom.ts
 *
 * Options:
 *   --dry-run      Preview changes without applying
 *   --skip-seed    Skip seeding, only migrate existing data
 *   --skip-phase1  Skip Phase 1, only run Phase 2
 *   --only-phase2  Same as --skip-phase1
 */

import { PrismaClient } from '@prisma/client';
import {
  COMPONENT_TYPES,
  COMPONENT_ROLES,
  type ComponentTypeCode,
} from '../config/bom/componentTypes.js';

const prisma = new PrismaClient();

// ============================================
// MATERIAL MAPPING (FabricType → Material)
// ============================================

/**
 * Maps existing FabricType names to new Material structure.
 * Adjust this mapping based on your actual FabricType data.
 */
const FABRIC_TYPE_TO_MATERIAL_MAP: Record<
  string,
  {
    materialName: string;
    constructionType?: 'knit' | 'woven';
    pattern?: string;
    weightUnit?: 'gsm' | 'lea' | 'oz';
    unit?: string;
  }
> = {
  // Linen types
  'Linen': { materialName: 'Linen', constructionType: 'woven', pattern: 'linen_regular', weightUnit: 'lea', unit: 'meters' },
  'Linen 25 Lea': { materialName: 'Linen', constructionType: 'woven', pattern: 'linen_regular', weightUnit: 'lea', unit: 'meters' },
  'Linen 40 Lea': { materialName: 'Linen', constructionType: 'woven', pattern: 'linen_regular', weightUnit: 'lea', unit: 'meters' },
  'Linen 60 Lea': { materialName: 'Linen', constructionType: 'woven', pattern: 'linen_regular', weightUnit: 'lea', unit: 'meters' },

  // Cotton types - knit
  'Cotton': { materialName: 'Cotton', constructionType: 'knit', pattern: 'single_jersey', weightUnit: 'gsm', unit: 'meters' },
  'Cotton Jersey': { materialName: 'Cotton', constructionType: 'knit', pattern: 'single_jersey', weightUnit: 'gsm', unit: 'meters' },
  'Cotton French Terry': { materialName: 'Cotton', constructionType: 'knit', pattern: 'french_terry', weightUnit: 'gsm', unit: 'meters' },
  'Cotton Fleece': { materialName: 'Cotton', constructionType: 'knit', pattern: 'fleece', weightUnit: 'gsm', unit: 'meters' },
  'Cotton Rib': { materialName: 'Cotton', constructionType: 'knit', pattern: 'rib', weightUnit: 'gsm', unit: 'meters' },

  // Cotton types - woven
  'Cotton Poplin': { materialName: 'Cotton', constructionType: 'woven', pattern: 'poplin', weightUnit: 'gsm', unit: 'meters' },
  'Cotton Twill': { materialName: 'Cotton', constructionType: 'woven', pattern: 'twill', weightUnit: 'gsm', unit: 'meters' },
  'Cotton Chambray': { materialName: 'Cotton', constructionType: 'woven', pattern: 'chambray', weightUnit: 'gsm', unit: 'meters' },
  'Cotton Voile': { materialName: 'Cotton', constructionType: 'woven', pattern: 'voile', weightUnit: 'gsm', unit: 'meters' },
  'Cotton Oxford': { materialName: 'Cotton', constructionType: 'woven', pattern: 'oxford', weightUnit: 'gsm', unit: 'meters' },
  'Denim': { materialName: 'Cotton', constructionType: 'woven', pattern: 'denim', weightUnit: 'oz', unit: 'meters' },

  // Pima Cotton
  'Pima Cotton': { materialName: 'Pima Cotton', constructionType: 'knit', pattern: 'single_jersey', weightUnit: 'gsm', unit: 'meters' },
  'Pima Single Jersey': { materialName: 'Pima Cotton', constructionType: 'knit', pattern: 'single_jersey', weightUnit: 'gsm', unit: 'meters' },
  'Pima French Terry': { materialName: 'Pima Cotton', constructionType: 'knit', pattern: 'french_terry', weightUnit: 'gsm', unit: 'meters' },

  // Supima Cotton (premium long-staple cotton)
  'Supima Single Jersey': { materialName: 'Pima Cotton', constructionType: 'knit', pattern: 'single_jersey', weightUnit: 'gsm', unit: 'meters' },
  'Supima French Terry': { materialName: 'Pima Cotton', constructionType: 'knit', pattern: 'french_terry', weightUnit: 'gsm', unit: 'meters' },

  // Rib fabrics
  'Rib': { materialName: 'Cotton', constructionType: 'knit', pattern: 'rib', weightUnit: 'gsm', unit: 'meters' },

  // Vintage (washed/distressed cotton)
  'Vintage': { materialName: 'Cotton', constructionType: 'knit', pattern: 'single_jersey', weightUnit: 'gsm', unit: 'meters' },

  // Utility fabrics
  'Utility': { materialName: 'Utility', unit: 'meters' },
  'Lining': { materialName: 'Utility', constructionType: 'woven', pattern: 'plain', unit: 'meters' },
  'Interfacing': { materialName: 'Utility', unit: 'meters' },
};

// ============================================
// SEED FUNCTIONS
// ============================================

async function seedMaterials(dryRun: boolean): Promise<Map<string, string>> {
  console.log('\n=== Seeding Materials ===');

  // Get unique material names from the mapping
  const materialNames = [...new Set(Object.values(FABRIC_TYPE_TO_MATERIAL_MAP).map((m) => m.materialName))];

  // Add some default materials if they don't exist
  const defaultMaterials = ['Linen', 'Cotton', 'Pima Cotton', 'Silk', 'Wool', 'Utility'];
  for (const name of defaultMaterials) {
    if (!materialNames.includes(name)) {
      materialNames.push(name);
    }
  }

  const materialIdMap = new Map<string, string>();

  for (const name of materialNames) {
    if (dryRun) {
      console.log(`  [DRY-RUN] Would create/update Material: ${name}`);
      materialIdMap.set(name, `dry-run-id-${name}`);
    } else {
      const material = await prisma.material.upsert({
        where: { name },
        update: {},
        create: {
          name,
          description: `${name} base material`,
          isActive: true,
        },
      });
      materialIdMap.set(name, material.id);
      console.log(`  Created/Updated Material: ${name} (${material.id})`);
    }
  }

  console.log(`Materials seeded: ${materialNames.length}`);
  return materialIdMap;
}

async function seedComponentTypes(dryRun: boolean): Promise<Map<string, string>> {
  console.log('\n=== Seeding Component Types ===');

  const typeIdMap = new Map<string, string>();

  for (const typeConfig of COMPONENT_TYPES) {
    if (dryRun) {
      console.log(`  [DRY-RUN] Would create/update ComponentType: ${typeConfig.code}`);
      typeIdMap.set(typeConfig.code, `dry-run-type-${typeConfig.code}`);
    } else {
      const componentType = await prisma.componentType.upsert({
        where: { code: typeConfig.code },
        update: {
          name: typeConfig.name,
          trackInventory: typeConfig.trackInventory,
          sortOrder: typeConfig.sortOrder,
        },
        create: {
          code: typeConfig.code,
          name: typeConfig.name,
          trackInventory: typeConfig.trackInventory,
          sortOrder: typeConfig.sortOrder,
        },
      });
      typeIdMap.set(typeConfig.code, componentType.id);
      console.log(`  Created/Updated ComponentType: ${typeConfig.code} (${componentType.id})`);
    }
  }

  console.log(`Component Types seeded: ${COMPONENT_TYPES.length}`);
  return typeIdMap;
}

async function seedComponentRoles(dryRun: boolean, typeIdMap: Map<string, string>): Promise<void> {
  console.log('\n=== Seeding Component Roles ===');

  let totalRoles = 0;

  for (const [typeCode, roles] of Object.entries(COMPONENT_ROLES)) {
    const typeId = typeIdMap.get(typeCode);
    if (!typeId) {
      console.warn(`  Warning: No type ID for ${typeCode}, skipping roles`);
      continue;
    }

    for (const roleConfig of roles) {
      if (dryRun) {
        console.log(`  [DRY-RUN] Would create/update Role: ${typeCode}.${roleConfig.code}`);
      } else {
        // Check if role exists (using composite key logic)
        const existingRole = await prisma.componentRole.findFirst({
          where: { typeId, code: roleConfig.code },
        });

        if (existingRole) {
          await prisma.componentRole.update({
            where: { id: existingRole.id },
            data: {
              name: roleConfig.name,
              isRequired: roleConfig.isRequired,
              allowMultiple: roleConfig.allowMultiple,
              defaultQuantity: roleConfig.defaultQuantity ?? null,
              defaultUnit: roleConfig.defaultUnit ?? null,
              sortOrder: roleConfig.sortOrder,
            },
          });
          console.log(`  Updated Role: ${typeCode}.${roleConfig.code}`);
        } else {
          await prisma.componentRole.create({
            data: {
              typeId,
              code: roleConfig.code,
              name: roleConfig.name,
              isRequired: roleConfig.isRequired,
              allowMultiple: roleConfig.allowMultiple,
              defaultQuantity: roleConfig.defaultQuantity ?? null,
              defaultUnit: roleConfig.defaultUnit ?? null,
              sortOrder: roleConfig.sortOrder,
            },
          });
          console.log(`  Created Role: ${typeCode}.${roleConfig.code}`);
        }
      }
      totalRoles++;
    }
  }

  console.log(`Component Roles seeded: ${totalRoles}`);
}

// ============================================
// ROLE ID HELPERS
// ============================================

interface RoleIds {
  mainFabricRoleId: string;
  liningRoleId: string;
}

async function getRoleIds(): Promise<RoleIds> {
  // Get FABRIC component type
  const fabricType = await prisma.componentType.findUnique({
    where: { code: 'FABRIC' },
  });

  if (!fabricType) {
    throw new Error('FABRIC ComponentType not found. Run seed first.');
  }

  // Get main and lining roles
  const mainRole = await prisma.componentRole.findFirst({
    where: { typeId: fabricType.id, code: 'main' },
  });

  const liningRole = await prisma.componentRole.findFirst({
    where: { typeId: fabricType.id, code: 'lining' },
  });

  if (!mainRole) {
    throw new Error('Main fabric role not found. Run seed first.');
  }

  if (!liningRole) {
    throw new Error('Lining role not found. Run seed first.');
  }

  return {
    mainFabricRoleId: mainRole.id,
    liningRoleId: liningRole.id,
  };
}

// ============================================
// MIGRATION FUNCTIONS (Phase 1)
// ============================================

async function migrateFabrics(dryRun: boolean, materialIdMap: Map<string, string>): Promise<void> {
  console.log('\n=== Migrating Fabrics ===');

  // Get all fabrics with their fabric type
  const fabrics = await prisma.fabric.findMany({
    include: { fabricType: true },
  });

  console.log(`Found ${fabrics.length} fabrics to migrate`);

  let migrated = 0;
  let skipped = 0;

  for (const fabric of fabrics) {
    const fabricTypeName = fabric.fabricType.name;
    const mapping = FABRIC_TYPE_TO_MATERIAL_MAP[fabricTypeName];

    if (!mapping) {
      console.log(`  Skipped: ${fabric.name} - no mapping for FabricType "${fabricTypeName}"`);
      skipped++;
      continue;
    }

    const materialId = materialIdMap.get(mapping.materialName);
    if (!materialId) {
      console.log(`  Skipped: ${fabric.name} - Material "${mapping.materialName}" not found`);
      skipped++;
      continue;
    }

    // Clean fabric name: use fabricType.name (not the concatenated "Type - Color" format)
    // This is the ROOT FIX for the fabric name display bug
    const cleanFabricName = fabric.fabricType.name;

    if (dryRun) {
      console.log(`  [DRY-RUN] Would update Fabric: ${fabric.name}`);
      console.log(`    name: ${cleanFabricName} (was: ${fabric.name})`);
      console.log(`    materialId: ${materialId}`);
      console.log(`    constructionType: ${mapping.constructionType}`);
      console.log(`    pattern: ${mapping.pattern}`);
      console.log(`    weightUnit: ${mapping.weightUnit}`);
      console.log(`    unit: ${mapping.unit}`);
    } else {
      await prisma.fabric.update({
        where: { id: fabric.id },
        data: {
          // ROOT FIX: Set clean fabric name from fabricType
          name: cleanFabricName,
          materialId,
          constructionType: mapping.constructionType ?? null,
          pattern: mapping.pattern ?? null,
          weightUnit: mapping.weightUnit ?? null,
          unit: mapping.unit ?? fabric.fabricType.unit,
          // Copy shrinkage from FabricType if not set
          avgShrinkagePct: fabric.avgShrinkagePct ?? fabric.fabricType.avgShrinkagePct,
          defaultLeadTimeDays: fabric.defaultLeadTimeDays ?? fabric.fabricType.defaultLeadTimeDays,
          defaultMinOrderQty: fabric.defaultMinOrderQty ?? fabric.fabricType.defaultMinOrderQty,
        },
      });
      console.log(`  Updated: ${fabric.name} → ${cleanFabricName} (Material: ${mapping.materialName})`);
    }
    migrated++;
  }

  console.log(`Migration complete: ${migrated} migrated, ${skipped} skipped`);
}

async function createFabricColours(dryRun: boolean): Promise<void> {
  console.log('\n=== Creating Fabric Colours ===');

  // Get fabrics that have color data but no FabricColour records yet
  const fabrics = await prisma.fabric.findMany({
    where: {
      materialId: { not: null }, // Only migrated fabrics
      colorName: { not: '' },
    },
    include: {
      colours: true, // Check if colours already exist
    },
  });

  console.log(`Found ${fabrics.length} fabrics to check for colour creation`);

  let created = 0;
  let skipped = 0;

  for (const fabric of fabrics) {
    // Skip if FabricColour already exists for this fabric/color combo
    const existingColour = fabric.colours.find(
      (c) => c.colourName.toLowerCase() === fabric.colorName.toLowerCase()
    );

    if (existingColour) {
      skipped++;
      continue;
    }

    if (dryRun) {
      console.log(`  [DRY-RUN] Would create FabricColour: ${fabric.name} - ${fabric.colorName}`);
    } else {
      await prisma.fabricColour.create({
        data: {
          fabricId: fabric.id,
          colourName: fabric.colorName,
          standardColour: fabric.standardColor ?? null,
          colourHex: fabric.colorHex ?? null,
          costPerUnit: fabric.costPerUnit ?? null,
          supplierId: fabric.supplierId ?? null,
          leadTimeDays: fabric.leadTimeDays ?? null,
          minOrderQty: fabric.minOrderQty ?? null,
          isActive: fabric.isActive,
        },
      });
      console.log(`  Created: ${fabric.name} - ${fabric.colorName}`);
    }
    created++;
  }

  console.log(`Fabric Colours: ${created} created, ${skipped} already existed`);
}

// ============================================
// MIGRATION FUNCTIONS (Phase 2 - BOM Population)
// ============================================

/**
 * Phase 2, Task 1: Create ProductBomTemplate for each Product
 * Maps Product.defaultFabricConsumption → main_fabric role quantity
 */
async function migrateProductBomTemplates(dryRun: boolean, roleIds: RoleIds): Promise<void> {
  console.log('\n=== Migrating Product BOM Templates ===');

  const products = await prisma.product.findMany({
    select: {
      id: true,
      name: true,
      defaultFabricConsumption: true,
    },
  });

  console.log(`Found ${products.length} products to migrate`);

  let created = 0;
  let updated = 0;
  let skipped = 0;

  for (const product of products) {
    const defaultQty = product.defaultFabricConsumption ?? 1.5;

    if (dryRun) {
      console.log(`  [DRY-RUN] Would upsert ProductBomTemplate: ${product.name} → ${defaultQty}m`);
      created++;
    } else {
      // Use upsert for idempotency
      const existing = await prisma.productBomTemplate.findUnique({
        where: {
          productId_roleId: {
            productId: product.id,
            roleId: roleIds.mainFabricRoleId,
          },
        },
      });

      if (existing) {
        await prisma.productBomTemplate.update({
          where: { id: existing.id },
          data: {
            defaultQuantity: defaultQty,
            quantityUnit: 'meter',
          },
        });
        console.log(`  Updated: ${product.name} → ${defaultQty}m`);
        updated++;
      } else {
        await prisma.productBomTemplate.create({
          data: {
            productId: product.id,
            roleId: roleIds.mainFabricRoleId,
            defaultQuantity: defaultQty,
            quantityUnit: 'meter',
            wastagePercent: 0,
          },
        });
        console.log(`  Created: ${product.name} → ${defaultQty}m`);
        created++;
      }
    }
  }

  console.log(`ProductBomTemplate: ${created} created, ${updated} updated, ${skipped} skipped`);
}

/**
 * Phase 2, Task 2: Create VariationBomLine for each Variation
 * - Links Variation.fabricId → FabricColour via color matching
 * - Creates lining placeholder if Variation.hasLining is true
 */
async function migrateVariationBomLines(dryRun: boolean, roleIds: RoleIds): Promise<void> {
  console.log('\n=== Migrating Variation BOM Lines ===');

  const variations = await prisma.variation.findMany({
    select: {
      id: true,
      colorName: true,
      fabricId: true,
      hasLining: true,
      product: { select: { name: true } },
    },
  });

  console.log(`Found ${variations.length} variations to migrate`);

  let mainCreated = 0;
  let mainUpdated = 0;
  let liningCreated = 0;
  let noFabricColour = 0;

  for (const variation of variations) {
    // Find matching FabricColour (fabric + color name match)
    const fabricColour = await prisma.fabricColour.findFirst({
      where: {
        fabricId: variation.fabricId,
        colourName: { equals: variation.colorName, mode: 'insensitive' },
      },
    });

    if (!fabricColour) {
      console.log(`  Warning: No FabricColour for ${variation.product.name} - ${variation.colorName}`);
      noFabricColour++;
      // Continue anyway - create line without fabricColourId (can be set manually later)
    }

    // MAIN FABRIC LINE
    if (dryRun) {
      console.log(
        `  [DRY-RUN] Would upsert main fabric line: ${variation.product.name} - ${variation.colorName}` +
          (fabricColour ? ` → FabricColour: ${fabricColour.id}` : ' (no FabricColour)')
      );
      mainCreated++;
    } else {
      const existingMain = await prisma.variationBomLine.findUnique({
        where: {
          variationId_roleId: {
            variationId: variation.id,
            roleId: roleIds.mainFabricRoleId,
          },
        },
      });

      if (existingMain) {
        await prisma.variationBomLine.update({
          where: { id: existingMain.id },
          data: {
            fabricColourId: fabricColour?.id ?? null,
          },
        });
        mainUpdated++;
      } else {
        await prisma.variationBomLine.create({
          data: {
            variationId: variation.id,
            roleId: roleIds.mainFabricRoleId,
            fabricColourId: fabricColour?.id ?? null,
            quantity: null, // Inherit from ProductBomTemplate
          },
        });
        mainCreated++;
      }
    }

    // LINING LINE (if hasLining)
    if (variation.hasLining) {
      if (dryRun) {
        console.log(`  [DRY-RUN] Would create lining line: ${variation.product.name} - ${variation.colorName}`);
        liningCreated++;
      } else {
        const existingLining = await prisma.variationBomLine.findUnique({
          where: {
            variationId_roleId: {
              variationId: variation.id,
              roleId: roleIds.liningRoleId,
            },
          },
        });

        if (!existingLining) {
          await prisma.variationBomLine.create({
            data: {
              variationId: variation.id,
              roleId: roleIds.liningRoleId,
              fabricColourId: null, // User assigns lining fabric later
              quantity: null,
            },
          });
          liningCreated++;
        }
      }
    }
  }

  console.log(
    `VariationBomLine: ${mainCreated} main created, ${mainUpdated} main updated, ` +
      `${liningCreated} lining created, ${noFabricColour} missing FabricColour`
  );
}

/**
 * Phase 2, Task 3: Create SkuBomLine for SKUs with custom fabric consumption
 * Only creates override if SKU.fabricConsumption differs from Product.defaultFabricConsumption
 */
async function migrateSkuBomLines(dryRun: boolean, roleIds: RoleIds): Promise<void> {
  console.log('\n=== Migrating SKU BOM Lines ===');

  const skus = await prisma.sku.findMany({
    select: {
      id: true,
      skuCode: true,
      fabricConsumption: true,
      variation: {
        select: {
          product: {
            select: {
              name: true,
              defaultFabricConsumption: true,
            },
          },
        },
      },
    },
  });

  console.log(`Found ${skus.length} SKUs to check`);

  let created = 0;
  let updated = 0;
  let skipped = 0;

  for (const sku of skus) {
    const productDefault = sku.variation.product.defaultFabricConsumption ?? 1.5;
    const skuConsumption = sku.fabricConsumption;

    // Only create override if different from product default
    // Use small epsilon for float comparison
    const isDifferent = Math.abs(skuConsumption - productDefault) > 0.001;

    if (!isDifferent) {
      skipped++;
      continue;
    }

    if (dryRun) {
      console.log(
        `  [DRY-RUN] Would create SKU override: ${sku.skuCode} (${skuConsumption}m vs default ${productDefault}m)`
      );
      created++;
    } else {
      const existing = await prisma.skuBomLine.findUnique({
        where: {
          skuId_roleId: {
            skuId: sku.id,
            roleId: roleIds.mainFabricRoleId,
          },
        },
      });

      if (existing) {
        await prisma.skuBomLine.update({
          where: { id: existing.id },
          data: { quantity: skuConsumption },
        });
        console.log(`  Updated: ${sku.skuCode} → ${skuConsumption}m`);
        updated++;
      } else {
        await prisma.skuBomLine.create({
          data: {
            skuId: sku.id,
            roleId: roleIds.mainFabricRoleId,
            quantity: skuConsumption,
          },
        });
        console.log(`  Created: ${sku.skuCode} → ${skuConsumption}m`);
        created++;
      }
    }
  }

  console.log(`SkuBomLine: ${created} created, ${updated} updated, ${skipped} inherited (no override needed)`);
}

// ============================================
// VERIFICATION
// ============================================

async function verifyMigration(): Promise<void> {
  console.log('\n=== Verification ===');

  // Count checks
  const productCount = await prisma.product.count();
  const variationCount = await prisma.variation.count();
  const skuCount = await prisma.sku.count();

  const productBomCount = await prisma.productBomTemplate.count();
  const variationBomCount = await prisma.variationBomLine.count();
  const skuBomCount = await prisma.skuBomLine.count();

  console.log('\nCount Check:');
  console.log(`  Products: ${productCount} → ProductBomTemplate: ${productBomCount}`);
  console.log(`    ${productBomCount === productCount ? '✓' : '⚠'} Expected 1:1 ratio`);

  console.log(`  Variations: ${variationCount} → VariationBomLine: ${variationBomCount}`);
  console.log(`    ${variationBomCount >= variationCount ? '✓' : '⚠'} Expected ≥ 1:1 (lining adds more)`);

  console.log(`  SKUs: ${skuCount} → SkuBomLine: ${skuBomCount}`);
  console.log(`    ${skuBomCount < skuCount ? '✓' : '⚠'} Expected < 1:1 (only overrides)`);

  // Data integrity
  const fabricRolesWithoutFabricColour = await prisma.variationBomLine.count({
    where: {
      fabricColourId: null,
      role: {
        type: { code: 'FABRIC' },
        code: 'main',
      },
    },
  });

  console.log('\nData Integrity:');
  console.log(
    `  VariationBomLine (main) without FabricColour: ${fabricRolesWithoutFabricColour}` +
      (fabricRolesWithoutFabricColour > 0 ? ' ⚠ (needs manual assignment)' : ' ✓')
  );

  const skuBomWithNullQty = await prisma.skuBomLine.count({
    where: { quantity: null },
  });
  console.log(
    `  SkuBomLine with null quantity: ${skuBomWithNullQty}` +
      (skuBomWithNullQty > 0 ? ' ⚠ (unexpected)' : ' ✓')
  );

  // Sample BOM resolution test
  console.log('\nSample BOM Resolution:');
  const sampleSku = await prisma.sku.findFirst({
    include: {
      variation: {
        include: {
          product: true,
        },
      },
      bomLines: {
        include: { role: true },
      },
    },
  });

  if (sampleSku) {
    const productDefault = sampleSku.variation.product.defaultFabricConsumption ?? 1.5;
    const skuOverride = sampleSku.bomLines.find((l) => l.role.code === 'main')?.quantity;
    const resolved = skuOverride ?? productDefault;

    console.log(`  SKU: ${sampleSku.skuCode}`);
    console.log(`    Product default: ${productDefault}m`);
    console.log(`    SKU override: ${skuOverride ?? 'none'}`);
    console.log(`    Resolved: ${resolved}m`);
    console.log(`    Original Sku.fabricConsumption: ${sampleSku.fabricConsumption}m`);
    console.log(
      `    ${Math.abs(resolved - sampleSku.fabricConsumption) < 0.001 ? '✓ Match!' : '⚠ Mismatch!'}`
    );
  }
}

// ============================================
// MAIN EXECUTION
// ============================================

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const dryRun = args.includes('--dry-run');
  const skipSeed = args.includes('--skip-seed');
  const skipPhase1 = args.includes('--skip-phase1');
  const onlyPhase2 = args.includes('--only-phase2');

  console.log('========================================');
  console.log('Material & BOM Migration Script');
  console.log('========================================');
  console.log(`Mode: ${dryRun ? 'DRY RUN (no changes)' : 'LIVE (applying changes)'}`);
  console.log(`Skip Seed: ${skipSeed}`);
  console.log(`Skip Phase 1: ${skipPhase1 || onlyPhase2}`);
  console.log(`Only Phase 2: ${onlyPhase2}`);
  console.log('');

  try {
    let materialIdMap = new Map<string, string>();
    let typeIdMap = new Map<string, string>();

    // ============================================
    // PHASE 1: Seed & Fabric Migration
    // ============================================
    if (!onlyPhase2 && !skipPhase1) {
      if (!skipSeed) {
        // Seed reference data
        materialIdMap = await seedMaterials(dryRun);
        typeIdMap = await seedComponentTypes(dryRun);
        await seedComponentRoles(dryRun, typeIdMap);
      } else {
        // Load existing materials for migration
        const materials = await prisma.material.findMany();
        for (const m of materials) {
          materialIdMap.set(m.name, m.id);
        }
      }

      // Migrate existing fabric data
      await migrateFabrics(dryRun, materialIdMap);
      await createFabricColours(dryRun);
    } else {
      console.log('\n=== Skipping Phase 1 (Seed & Fabric Migration) ===');
    }

    // ============================================
    // PHASE 2: BOM Population
    // ============================================
    console.log('\n========================================');
    console.log('PHASE 2: BOM Population');
    console.log('========================================');

    // Get role IDs (required for Phase 2)
    let roleIds: RoleIds;
    if (dryRun) {
      // In dry-run mode, we can't get actual IDs, use placeholders
      roleIds = {
        mainFabricRoleId: 'dry-run-main-id',
        liningRoleId: 'dry-run-lining-id',
      };
    } else {
      roleIds = await getRoleIds();
      console.log(`  Main fabric role ID: ${roleIds.mainFabricRoleId}`);
      console.log(`  Lining role ID: ${roleIds.liningRoleId}`);
    }

    // Populate BOM tables
    await migrateProductBomTemplates(dryRun, roleIds);
    await migrateVariationBomLines(dryRun, roleIds);
    await migrateSkuBomLines(dryRun, roleIds);

    // Verify migration
    if (!dryRun) {
      await verifyMigration();
    }

    console.log('\n========================================');
    console.log('Migration Complete!');
    console.log('========================================');

    if (dryRun) {
      console.log('\nThis was a dry run. Run without --dry-run to apply changes.');
    }
  } catch (error) {
    console.error('\nMigration failed:', error);
    throw error;
  }
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
