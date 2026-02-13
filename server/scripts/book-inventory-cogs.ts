/**
 * Book Monthly Inventory & COGS Entries
 *
 * Three-part script covering the full inventory cost flow:
 * 1. Reclassify garment vendor payments from OPERATING_EXPENSES → FABRIC_INVENTORY
 * 2. Production: Dr FINISHED_GOODS, Cr FABRIC_INVENTORY (Sampling inwards × BOM cost)
 * 3. Shipments: Dr COGS, Cr FINISHED_GOODS (sale outwards × BOM cost)
 * 4. Returns:   Dr FINISHED_GOODS, Cr COGS (RTO/return inwards × BOM cost)
 *
 * SAFE TO RE-RUN: All booking functions are idempotent (reverse + re-create).
 *
 * Also runs automatically when new rows are ingested from Google Sheets
 * (hooked into sheetOffloadWorker for all three flows).
 *
 * Usage:
 *   cd server
 *   export $(grep -v '^#' .env | xargs)
 *   npx tsx scripts/book-inventory-cogs.ts
 */

import { PrismaClient } from '@prisma/client';
import {
  createLedgerEntry,
  entryExistsForSource,
  bookFabricConsumptionForMonth,
  bookShipmentCOGSForMonth,
  bookReturnReversalForMonth,
} from '../src/services/ledgerService.js';

const prisma = new PrismaClient();

// ============================================
// PART 1: Reclassify garment vendor entries
// ============================================

/**
 * These vendors were wrongly booked to OPERATING_EXPENSES.
 * They're fabric suppliers — should be FABRIC_INVENTORY.
 * Creates one reclassification entry to move the total.
 */
async function reclassifyGarmentVendors(adminUserId: string) {
  const SOURCE_TYPE = 'adjustment';
  const SOURCE_ID = 'reclassify_garment_vendors_to_fabric_inventory';

  // Check idempotency
  if (await entryExistsForSource(prisma, SOURCE_TYPE, SOURCE_ID)) {
    console.log('  ✓ Reclassification already done — skipping');
    return;
  }

  // Find all debit lines on OPERATING_EXPENSES for these vendors
  const vendorPatterns = [
    '%SHUBH CREATION%',
    '%DARSHAN CREATION%',
    '%Gemini Fashion%',
    '%Mehta Clothing%',
    '%MAYKA%',
  ];

  const rows = await prisma.$queryRaw<{ total: number }[]>`
    SELECT COALESCE(SUM(lel.debit), 0)::float AS total
    FROM "LedgerEntry" le
    JOIN "LedgerEntryLine" lel ON lel."entryId" = le.id
    JOIN "LedgerAccount" la ON la.id = lel."accountId"
    WHERE la.code = 'OPERATING_EXPENSES'
      AND lel.debit > 0
      AND le."isReversed" = false
      AND (
        le.description ILIKE ${vendorPatterns[0]}
        OR le.description ILIKE ${vendorPatterns[1]}
        OR le.description ILIKE ${vendorPatterns[2]}
        OR le.description ILIKE ${vendorPatterns[3]}
        OR le.description ILIKE ${vendorPatterns[4]}
      )
      AND le.description NOT ILIKE '%refund%'
  `;

  const total = rows[0]?.total ?? 0;
  if (total === 0) {
    console.log('  ✓ No garment vendor entries to reclassify');
    return;
  }

  const rounded = Math.round(total * 100) / 100;
  console.log(`  Reclassifying ₹${rounded.toLocaleString('en-IN')} from OPERATING_EXPENSES → FABRIC_INVENTORY`);

  await createLedgerEntry(prisma, {
    entryDate: new Date(),
    description: 'Reclassify: Garment production vendors (Shubh, Darshan, Gemini, Mehta, Mayka) are fabric suppliers',
    sourceType: SOURCE_TYPE,
    sourceId: SOURCE_ID,
    createdById: adminUserId,
    notes: 'Corrects historical misclassification. These payments were for fabric, not operating expenses.',
    lines: [
      { accountCode: 'FABRIC_INVENTORY', debit: rounded },
      { accountCode: 'OPERATING_EXPENSES', credit: rounded },
    ],
  });

  console.log(`  ✓ Reclassification entry created: ₹${rounded.toLocaleString('en-IN')}`);
}

// ============================================
// PARTS 2-4: Monthly booking for all three flows
// ============================================

async function bookAllMonths(adminUserId: string) {
  const now = new Date();
  const istNow = new Date(now.getTime() + (5.5 * 60 * 60 * 1000));
  const currentYear = istNow.getFullYear();
  const currentMonth = istNow.getMonth() + 1;

  let y = 2022, m = 1;
  while (y < currentYear || (y === currentYear && m <= currentMonth)) {
    const label = `${y}-${String(m).padStart(2, '0')}`;

    // Production: Dr FINISHED_GOODS, Cr FABRIC_INVENTORY
    const prod = await bookFabricConsumptionForMonth(prisma, y, m, adminUserId);
    const prodIcon = prod.action === 'unchanged' ? '✓' : prod.action === 'updated' ? '↻' : '✓';
    if (prod.fabricCost > 0) {
      console.log(`  ${prodIcon} ${label} Production → FG: ₹${prod.fabricCost.toLocaleString('en-IN')} (${prod.action})`);
    }

    // Shipments: Dr COGS, Cr FINISHED_GOODS
    const ship = await bookShipmentCOGSForMonth(prisma, y, m, adminUserId);
    const shipIcon = ship.action === 'unchanged' ? '✓' : ship.action === 'updated' ? '↻' : '✓';
    if (ship.amount > 0) {
      console.log(`  ${shipIcon} ${label} Shipment → COGS: ₹${ship.amount.toLocaleString('en-IN')} (${ship.action})`);
    }

    // Returns: Dr FINISHED_GOODS, Cr COGS
    const ret = await bookReturnReversalForMonth(prisma, y, m, adminUserId);
    const retIcon = ret.action === 'unchanged' ? '✓' : ret.action === 'updated' ? '↻' : '✓';
    if (ret.amount > 0) {
      console.log(`  ${retIcon} ${label} Returns → FG: ₹${ret.amount.toLocaleString('en-IN')} (${ret.action})`);
    }

    if (prod.fabricCost === 0 && ship.amount === 0 && ret.amount === 0) {
      console.log(`  - ${label} — no activity`);
    }

    m++;
    if (m > 12) { m = 1; y++; }
  }
}

// ============================================
// MAIN
// ============================================

async function main() {
  const admin = await prisma.user.findFirst({ where: { role: 'admin' } });
  if (!admin) throw new Error('No admin user found');

  console.log('\n=== Part 1: Reclassify garment vendor payments ===');
  await reclassifyGarmentVendors(admin.id);

  console.log('\n=== Parts 2-4: Monthly inventory & COGS entries ===');
  console.log('  Production: Dr FINISHED_GOODS, Cr FABRIC_INVENTORY');
  console.log('  Shipment:   Dr COGS, Cr FINISHED_GOODS');
  console.log('  Returns:    Dr FINISHED_GOODS, Cr COGS\n');
  await bookAllMonths(admin.id);

  console.log('\nDone!\n');
}

main()
  .catch((err) => {
    console.error('ERROR:', err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
