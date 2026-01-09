/**
 * Script to fix product fabricType based on assigned variation fabrics
 *
 * For any product that has Default/null fabricType but has variations with
 * proper fabrics assigned, update the product's fabricType to match.
 *
 * Run with: node scripts/fix-product-fabric-types.js [--apply]
 */

import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();

async function main() {
  const isDryRun = !process.argv.includes('--apply');

  console.log(isDryRun ? '=== DRY RUN MODE (use --apply to execute) ===' : '=== APPLYING CHANGES ===');
  console.log('');

  // Find variations with a proper fabric (not Default) where product has Default fabric type
  const variations = await prisma.variation.findMany({
    where: {
      fabric: {
        fabricType: { name: { not: 'Default' } }
      },
      product: {
        OR: [
          { fabricTypeId: null },
          { fabricType: { name: 'Default' } }
        ]
      }
    },
    include: {
      fabric: { include: { fabricType: true } },
      product: { include: { fabricType: true } }
    }
  });

  console.log(`Found ${variations.length} variations with proper fabric but product has Default/null fabricType`);
  console.log('');

  // Group by product to update each product once
  const productUpdates = new Map();

  for (const v of variations) {
    const productId = v.product.id;
    const newFabricTypeId = v.fabric.fabricTypeId;
    const newFabricTypeName = v.fabric.fabricType.name;

    if (!productUpdates.has(productId)) {
      productUpdates.set(productId, {
        productId,
        productName: v.product.name,
        currentType: v.product.fabricType?.name || 'null',
        newTypeId: newFabricTypeId,
        newTypeName: newFabricTypeName,
        sampleFabric: v.fabric.name
      });
    }
  }

  console.log(`Will update ${productUpdates.size} products`);
  console.log('');

  console.log('=== UPDATES ===');
  for (const [_, update] of productUpdates) {
    console.log(`${update.productName}: ${update.currentType} → ${update.newTypeName} (based on ${update.sampleFabric})`);
  }
  console.log('');

  if (!isDryRun) {
    let success = 0;
    for (const [_, update] of productUpdates) {
      try {
        await prisma.product.update({
          where: { id: update.productId },
          data: { fabricTypeId: update.newTypeId }
        });
        success++;
      } catch (err) {
        console.error(`Failed: ${update.productName}:`, err.message);
      }
    }
    console.log(`Updated ${success} products`);
  } else {
    console.log('Run with --apply to execute these updates');
  }
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
