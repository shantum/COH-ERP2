/**
 * Material & BOM Migration Script
 *
 * Phase 1 migration script for the new Material hierarchy and BOM system.
 * This script:
 * 1. Seeds Material records from FabricType mappings
 * 2. Seeds ComponentType and ComponentRole from config
 * 3. Updates existing Fabric records with materialId and textile attributes
 * 4. Creates FabricColour records from existing Fabric color data
 *
 * Safe to run multiple times - uses upsert operations.
 *
 * Usage: npx ts-node src/scripts/migrateMaterialsBom.ts
 *
 * Options:
 *   --dry-run    Preview changes without applying
 *   --skip-seed  Skip seeding, only migrate existing data
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
// MIGRATION FUNCTIONS
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

    // Skip if already migrated
    if (fabric.materialId && !dryRun) {
      console.log(`  Skipped: ${fabric.name} - already has materialId`);
      skipped++;
      continue;
    }

    if (dryRun) {
      console.log(`  [DRY-RUN] Would update Fabric: ${fabric.name}`);
      console.log(`    materialId: ${materialId}`);
      console.log(`    constructionType: ${mapping.constructionType}`);
      console.log(`    pattern: ${mapping.pattern}`);
      console.log(`    weightUnit: ${mapping.weightUnit}`);
      console.log(`    unit: ${mapping.unit}`);
    } else {
      await prisma.fabric.update({
        where: { id: fabric.id },
        data: {
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
      console.log(`  Updated: ${fabric.name} → Material: ${mapping.materialName}`);
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
// MAIN EXECUTION
// ============================================

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const dryRun = args.includes('--dry-run');
  const skipSeed = args.includes('--skip-seed');

  console.log('========================================');
  console.log('Material & BOM Migration Script');
  console.log('========================================');
  console.log(`Mode: ${dryRun ? 'DRY RUN (no changes)' : 'LIVE (applying changes)'}`);
  console.log(`Skip Seed: ${skipSeed}`);
  console.log('');

  try {
    let materialIdMap = new Map<string, string>();
    let typeIdMap = new Map<string, string>();

    if (!skipSeed) {
      // Phase 1: Seed reference data
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

    // Phase 2: Migrate existing data
    await migrateFabrics(dryRun, materialIdMap);
    await createFabricColours(dryRun);

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
