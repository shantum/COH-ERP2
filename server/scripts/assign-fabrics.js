/**
 * Script to auto-assign fabrics to variations based on color name matching
 * Run with: node scripts/assign-fabrics.js [--dry-run]
 */

import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();

// For colors that have multiple fabric types, specify which one to use
const COLOR_TYPE_PREFERENCES = {
  'Mustard': 'Linen 40 Lea',  // Based on existing correct assignments
};

async function main() {
  const isDryRun = process.argv.includes('--dry-run');

  console.log(isDryRun ? '=== DRY RUN MODE ===' : '=== APPLYING CHANGES ===');
  console.log('');

  // Get the Default fabric ID to identify variations that need updating
  const defaultFabric = await prisma.fabric.findFirst({
    where: { fabricType: { name: 'Default' } }
  });

  if (!defaultFabric) {
    console.log('No Default fabric found');
    return;
  }

  console.log('Default Fabric ID:', defaultFabric.id);
  console.log('');

  // Get all fabrics (excluding Default)
  const fabrics = await prisma.fabric.findMany({
    where: { fabricType: { name: { not: 'Default' } } },
    include: { fabricType: true }
  });

  // Build color-to-fabric map
  const colorToFabrics = {};
  fabrics.forEach(f => {
    const colorKey = f.colorName.trim().toLowerCase();
    if (!colorToFabrics[colorKey]) colorToFabrics[colorKey] = [];
    colorToFabrics[colorKey].push(f);
  });

  // Get all variations with Default fabric
  const variations = await prisma.variation.findMany({
    where: { fabricId: defaultFabric.id },
    include: {
      product: { include: { fabricType: true } },
      fabric: true
    }
  });

  console.log(`Found ${variations.length} variations with Default fabric`);
  console.log('');

  let matched = 0;
  let unmatched = 0;
  let ambiguous = 0;
  const updates = [];
  const unmatchedList = [];
  const ambiguousList = [];

  for (const v of variations) {
    const colorKey = v.colorName.trim().toLowerCase();
    const candidates = colorToFabrics[colorKey] || [];

    if (candidates.length === 0) {
      unmatched++;
      unmatchedList.push(`${v.product.name} | ${v.colorName}`);
      continue;
    }

    let selectedFabric = null;

    if (candidates.length === 1) {
      // Single match - use it
      selectedFabric = candidates[0];
    } else {
      // Multiple matches - try to resolve

      // 1. Check if product has a fabric type set (not Default)
      if (v.product.fabricType && v.product.fabricType.name !== 'Default') {
        const typeMatch = candidates.find(f => f.fabricType.name === v.product.fabricType.name);
        if (typeMatch) {
          selectedFabric = typeMatch;
        }
      }

      // 2. Check color preferences
      if (!selectedFabric && COLOR_TYPE_PREFERENCES[v.colorName]) {
        const prefType = COLOR_TYPE_PREFERENCES[v.colorName];
        const prefMatch = candidates.find(f => f.fabricType.name === prefType);
        if (prefMatch) {
          selectedFabric = prefMatch;
        }
      }

      // 3. Still ambiguous - pick first non-default and log
      if (!selectedFabric) {
        selectedFabric = candidates[0];
        ambiguous++;
        ambiguousList.push(`${v.product.name} | ${v.colorName} → picked ${selectedFabric.fabricType.name} (options: ${candidates.map(c => c.fabricType.name).join(', ')})`);
      }
    }

    if (selectedFabric) {
      matched++;
      updates.push({
        variationId: v.id,
        productName: v.product.name,
        colorName: v.colorName,
        oldFabric: 'Default Fabric',
        newFabric: selectedFabric.name,
        newFabricId: selectedFabric.id,
        newType: selectedFabric.fabricType.name
      });
    }
  }

  // Show summary
  console.log('=== SUMMARY ===');
  console.log(`Matched: ${matched}`);
  console.log(`Unmatched (no fabric for color): ${unmatched}`);
  console.log(`Ambiguous (picked first): ${ambiguous}`);
  console.log('');

  // Show unmatched
  if (unmatchedList.length > 0) {
    console.log('=== UNMATCHED COLORS (no fabric exists) ===');
    unmatchedList.slice(0, 20).forEach(u => console.log('  ' + u));
    if (unmatchedList.length > 20) {
      console.log(`  ... and ${unmatchedList.length - 20} more`);
    }
    console.log('');
  }

  // Show ambiguous
  if (ambiguousList.length > 0) {
    console.log('=== AMBIGUOUS (multiple fabric types for color) ===');
    ambiguousList.forEach(a => console.log('  ' + a));
    console.log('');
  }

  // Show sample updates
  console.log('=== SAMPLE UPDATES ===');
  updates.slice(0, 15).forEach(u => {
    console.log(`  ${u.productName} | ${u.colorName} → ${u.newFabric} (${u.newType})`);
  });
  if (updates.length > 15) {
    console.log(`  ... and ${updates.length - 15} more`);
  }
  console.log('');

  // Apply updates if not dry run
  if (!isDryRun && updates.length > 0) {
    console.log('Applying updates...');

    let success = 0;
    let failed = 0;

    for (const u of updates) {
      try {
        await prisma.variation.update({
          where: { id: u.variationId },
          data: { fabricId: u.newFabricId }
        });
        success++;
      } catch (err) {
        console.error(`Failed to update ${u.productName} | ${u.colorName}:`, err.message);
        failed++;
      }
    }

    console.log(`Updated ${success} variations, ${failed} failed`);
  } else if (isDryRun) {
    console.log('Run without --dry-run to apply changes');
  }
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
