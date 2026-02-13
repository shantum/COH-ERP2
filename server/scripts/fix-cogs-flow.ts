/**
 * Fix COGS Flow: Historical Correction
 *
 * Problem: Old entries booked Dr COGS, Cr FABRIC_INVENTORY on production.
 * This was wrong — produced garments sitting in warehouse aren't "sold" yet.
 *
 * Fix:
 * 1. Reverse all existing fabric_consumption entries (they wrongly used COGS)
 * 2. Re-book production for all months: Dr FINISHED_GOODS, Cr FABRIC_INVENTORY
 * 3. Book shipment COGS for all months: Dr COGS, Cr FINISHED_GOODS
 * 4. Book return reversals for all months: Dr FINISHED_GOODS, Cr COGS
 *
 * SAFE TO RE-RUN: Uses the same idempotent service functions.
 *
 * Usage:
 *   cd server
 *   export $(grep -v '^#' .env | xargs)
 *   npx tsx scripts/fix-cogs-flow.ts
 */

import { PrismaClient } from '@prisma/client';
import {
  bookFabricConsumptionForMonth,
  bookShipmentCOGSForMonth,
  bookReturnReversalForMonth,
  reverseLedgerEntry,
} from '../src/services/ledgerService.js';

const prisma = new PrismaClient();

// ============================================
// STEP 1: Reverse old fabric_consumption entries
// ============================================

async function reverseOldFabricConsumptionEntries(adminUserId: string) {
  // Find all unreversed fabric_consumption entries
  const oldEntries = await prisma.ledgerEntry.findMany({
    where: {
      sourceType: 'fabric_consumption',
      isReversed: false,
    },
    include: {
      lines: {
        include: { account: { select: { code: true } } },
      },
    },
    orderBy: { entryDate: 'asc' },
  });

  if (oldEntries.length === 0) {
    console.log('  No old fabric_consumption entries to reverse');
    return;
  }

  // Check if they used COGS (the old wrong way) vs FINISHED_GOODS (the new correct way)
  const wrongEntries = oldEntries.filter(entry =>
    entry.lines.some(l => l.account.code === 'COGS' && l.debit > 0)
  );

  if (wrongEntries.length === 0) {
    console.log(`  All ${oldEntries.length} entries already use FINISHED_GOODS — nothing to reverse`);
    return;
  }

  console.log(`  Found ${wrongEntries.length} entries using old Dr COGS pattern — reversing...`);

  for (const entry of wrongEntries) {
    const amount = entry.lines.find(l => l.debit > 0)?.debit ?? 0;
    await reverseLedgerEntry(prisma, entry.id, adminUserId);
    // Free up the sourceId so the re-booking can use it
    await prisma.ledgerEntry.update({
      where: { id: entry.id },
      data: { sourceId: `${entry.sourceId}_old_cogs_reversed_${entry.id}` },
    });
    console.log(`    Reversed: ${entry.sourceId} (₹${amount.toLocaleString('en-IN')})`);
  }

  console.log(`  ✓ Reversed ${wrongEntries.length} old entries`);
}

// ============================================
// STEP 2-4: Re-book all months correctly
// ============================================

async function bookAllMonths(adminUserId: string) {
  const now = new Date();
  const istNow = new Date(now.getTime() + (5.5 * 60 * 60 * 1000));
  const currentYear = istNow.getFullYear();
  const currentMonth = istNow.getMonth() + 1;

  let y = 2022, m = 1; // Start from Jan 2022 (earliest inventory data)

  while (y < currentYear || (y === currentYear && m <= currentMonth)) {
    const label = `${y}-${String(m).padStart(2, '0')}`;

    // Production: Dr FINISHED_GOODS, Cr FABRIC_INVENTORY
    const prod = await bookFabricConsumptionForMonth(prisma, y, m, adminUserId);
    if (prod.fabricCost > 0) {
      console.log(`  ${label} Production → FG: ₹${prod.fabricCost.toLocaleString('en-IN')} (${prod.action})`);
    }

    // Shipments: Dr COGS, Cr FINISHED_GOODS
    const ship = await bookShipmentCOGSForMonth(prisma, y, m, adminUserId);
    if (ship.amount > 0) {
      console.log(`  ${label} Shipment → COGS: ₹${ship.amount.toLocaleString('en-IN')} (${ship.action})`);
    }

    // Returns: Dr FINISHED_GOODS, Cr COGS
    const ret = await bookReturnReversalForMonth(prisma, y, m, adminUserId);
    if (ret.amount > 0) {
      console.log(`  ${label} Returns → FG: ₹${ret.amount.toLocaleString('en-IN')} (${ret.action})`);
    }

    if (prod.fabricCost === 0 && ship.amount === 0 && ret.amount === 0) {
      console.log(`  ${label} — no activity`);
    }

    m++;
    if (m > 12) { m = 1; y++; }
  }
}

// ============================================
// VERIFICATION: Check balances make sense
// ============================================

async function verifyBalances() {
  const accounts = await prisma.ledgerAccount.findMany({
    where: { code: { in: ['FABRIC_INVENTORY', 'FINISHED_GOODS', 'COGS'] } },
    select: { code: true, name: true, balance: true },
  });

  console.log('\n  Account Balances:');
  for (const acc of accounts) {
    console.log(`    ${acc.code}: ₹${acc.balance.toLocaleString('en-IN', { minimumFractionDigits: 2 })}`);
  }

  const fabricInv = accounts.find(a => a.code === 'FABRIC_INVENTORY')?.balance ?? 0;
  const finishedGoods = accounts.find(a => a.code === 'FINISHED_GOODS')?.balance ?? 0;
  const cogs = accounts.find(a => a.code === 'COGS')?.balance ?? 0;

  if (finishedGoods < 0) {
    console.log('\n  ⚠ WARNING: FINISHED_GOODS is negative — more shipped than produced?');
  }
  if (cogs < 0) {
    console.log('\n  ⚠ WARNING: COGS is negative — more returns than shipments?');
  }
}

// ============================================
// MAIN
// ============================================

async function main() {
  const admin = await prisma.user.findFirst({ where: { role: 'admin' } });
  if (!admin) throw new Error('No admin user found');

  console.log('\n=== Step 1: Reverse old fabric_consumption entries (Dr COGS → wrong) ===');
  await reverseOldFabricConsumptionEntries(admin.id);

  console.log('\n=== Steps 2-4: Re-book all months with correct flow ===');
  console.log('  Production: Dr FINISHED_GOODS, Cr FABRIC_INVENTORY');
  console.log('  Shipment:   Dr COGS, Cr FINISHED_GOODS');
  console.log('  Returns:    Dr FINISHED_GOODS, Cr COGS\n');
  await bookAllMonths(admin.id);

  console.log('\n=== Verification ===');
  await verifyBalances();

  console.log('\nDone!\n');
}

main()
  .catch((err) => {
    console.error('ERROR:', err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
