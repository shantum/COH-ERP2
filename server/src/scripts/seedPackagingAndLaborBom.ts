/**
 * Seed Packaging & Stitching BOM Components
 *
 * Creates:
 * 1. ComponentRole "packaging" under TRIM type
 * 2. ComponentRole "stitching" under SERVICE type
 * 3. TrimItem "PKG-STD" (Standard Packaging)
 * 4. ServiceItem "SVC-STITCH" (Stitching)
 *
 * Idempotent — safe to run multiple times.
 *
 * Usage: npx tsx server/src/scripts/seedPackagingAndLaborBom.ts
 */

import prisma from '../lib/prisma.js';

async function main() {
  // 1. Look up ComponentTypes
  const trimType = await prisma.componentType.findUnique({ where: { code: 'TRIM' } });
  if (!trimType) throw new Error('ComponentType "TRIM" not found');

  const serviceType = await prisma.componentType.findUnique({ where: { code: 'SERVICE' } });
  if (!serviceType) throw new Error('ComponentType "SERVICE" not found');

  console.log(`Found TRIM type: ${trimType.id}`);
  console.log(`Found SERVICE type: ${serviceType.id}`);

  // 2. Upsert ComponentRole "packaging" under TRIM
  const packagingRole = await prisma.componentRole.upsert({
    where: { typeId_code: { typeId: trimType.id, code: 'packaging' } },
    update: {},
    create: {
      typeId: trimType.id,
      code: 'packaging',
      name: 'Packaging',
      isRequired: true,
      allowMultiple: false,
      defaultQuantity: 1,
      defaultUnit: 'piece',
      sortOrder: 90,
    },
  });
  console.log(`ComponentRole "packaging": ${packagingRole.id} (TRIM)`);

  // 3. Upsert ComponentRole "stitching" under SERVICE
  const stitchingRole = await prisma.componentRole.upsert({
    where: { typeId_code: { typeId: serviceType.id, code: 'stitching' } },
    update: {},
    create: {
      typeId: serviceType.id,
      code: 'stitching',
      name: 'Stitching',
      isRequired: true,
      allowMultiple: false,
      defaultQuantity: 60,
      defaultUnit: 'minute',
      sortOrder: 90,
    },
  });
  console.log(`ComponentRole "stitching": ${stitchingRole.id} (SERVICE)`);

  // 4. Upsert TrimItem "PKG-STD"
  const trimItem = await prisma.trimItem.upsert({
    where: { code: 'PKG-STD' },
    update: {},
    create: {
      code: 'PKG-STD',
      name: 'Standard Packaging',
      category: 'packaging',
      costPerUnit: 50,
      unit: 'piece',
    },
  });
  console.log(`TrimItem "PKG-STD": ${trimItem.id}`);

  // 5. Upsert ServiceItem "SVC-STITCH"
  const serviceItem = await prisma.serviceItem.upsert({
    where: { code: 'SVC-STITCH' },
    update: {},
    create: {
      code: 'SVC-STITCH',
      name: 'Stitching',
      category: 'stitching',
      costPerJob: 2.50,
      costUnit: 'per_minute',
    },
  });
  console.log(`ServiceItem "SVC-STITCH": ${serviceItem.id}`);

  console.log('\nDone. All packaging & stitching BOM components seeded.');
}

main().catch(console.error).finally(() => prisma.$disconnect());
