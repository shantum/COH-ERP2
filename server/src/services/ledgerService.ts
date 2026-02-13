/**
 * Ledger Service
 *
 * Core functions for creating double-entry journal entries.
 * The DB trigger on LedgerEntryLine automatically updates account balances.
 *
 * Everything that creates ledger entries calls through here.
 */

import type { PrismaClient } from '@prisma/client';
import { isDebitNormal, getAccountByCode } from '../config/finance/index.js';
import type { AccountType } from '../config/finance/index.js';

// ============================================
// TYPES
// ============================================

export interface LedgerLine {
  accountCode: string;
  debit?: number;
  credit?: number;
  description?: string;
}

export interface CreateLedgerEntryInput {
  entryDate: Date;
  period: string; // "YYYY-MM" — which P&L month this belongs to
  description: string;
  sourceType: string;
  sourceId?: string;
  lines: LedgerLine[];
  createdById: string;
  notes?: string;
}

/**
 * Convert a Date to IST "YYYY-MM" period string.
 * IST = UTC + 5:30
 */
export function dateToPeriod(date: Date): string {
  const ist = new Date(date.getTime() + (5.5 * 60 * 60 * 1000));
  return `${ist.getUTCFullYear()}-${String(ist.getUTCMonth() + 1).padStart(2, '0')}`;
}

// ============================================
// CREATE LEDGER ENTRY
// ============================================

/**
 * Create a balanced journal entry with debit/credit lines.
 *
 * - Validates total debits = total credits
 * - Resolves account codes to IDs
 * - Creates entry + lines in a single transaction
 * - DB trigger handles balance updates automatically
 *
 * Throws if debits don't equal credits or if an account code is invalid.
 */
export async function createLedgerEntry(
  prisma: PrismaClient,
  input: CreateLedgerEntryInput
) {
  const { entryDate, period, description, sourceType, sourceId, lines, createdById, notes } = input;

  // Validate at least 2 lines
  if (lines.length < 2) {
    throw new Error('A journal entry needs at least 2 lines (debit + credit)');
  }

  // Validate debits = credits
  const totalDebit = lines.reduce((sum, l) => sum + (l.debit ?? 0), 0);
  const totalCredit = lines.reduce((sum, l) => sum + (l.credit ?? 0), 0);

  // Use a tolerance for floating-point comparison (0.01 = 1 paisa)
  if (Math.abs(totalDebit - totalCredit) > 0.01) {
    throw new Error(
      `Debits (${totalDebit.toFixed(2)}) must equal credits (${totalCredit.toFixed(2)})`
    );
  }

  // Validate each line has either debit or credit, not both
  for (const line of lines) {
    const d = line.debit ?? 0;
    const c = line.credit ?? 0;
    if (d > 0 && c > 0) {
      throw new Error(`Line "${line.accountCode}" has both debit and credit — pick one`);
    }
    if (d === 0 && c === 0) {
      throw new Error(`Line "${line.accountCode}" has zero debit and credit — must have one`);
    }
  }

  // Resolve account codes to IDs
  const accountCodes = [...new Set(lines.map((l) => l.accountCode))];
  const accounts = await prisma.ledgerAccount.findMany({
    where: { code: { in: accountCodes } },
    select: { id: true, code: true },
  });

  const accountMap = new Map(accounts.map((a) => [a.code, a.id]));

  // Check all codes were found
  for (const code of accountCodes) {
    if (!accountMap.has(code)) {
      throw new Error(`Unknown account code: ${code}`);
    }
  }

  // Create entry + lines in a transaction
  const entry = await prisma.ledgerEntry.create({
    data: {
      entryDate,
      period,
      description,
      sourceType,
      sourceId: sourceId ?? null,
      notes: notes ?? null,
      createdById,
      lines: {
        create: lines.map((line) => ({
          accountId: accountMap.get(line.accountCode)!,
          debit: line.debit ?? 0,
          credit: line.credit ?? 0,
          description: line.description ?? null,
        })),
      },
    },
    include: {
      lines: {
        include: { account: { select: { code: true, name: true } } },
      },
    },
  });

  return entry;
}

// ============================================
// REVERSE LEDGER ENTRY
// ============================================

/**
 * Create a mirror entry that cancels the original.
 * Swaps all debits and credits, marks original as reversed.
 */
export async function reverseLedgerEntry(
  prisma: PrismaClient,
  entryId: string,
  userId: string
) {
  const original = await prisma.ledgerEntry.findUnique({
    where: { id: entryId },
    include: { lines: { include: { account: true } } },
  });

  if (!original) throw new Error('Ledger entry not found');
  if (original.isReversed) throw new Error('Entry is already reversed');

  // Create reversal entry — swap debit and credit on each line
  const reversal = await prisma.ledgerEntry.create({
    data: {
      entryDate: original.entryDate,
      period: original.period,
      description: `Reversal: ${original.description}`,
      sourceType: 'adjustment',
      notes: `Reversal of entry ${original.id}`,
      createdById: userId,
      lines: {
        create: original.lines.map((line) => ({
          accountId: line.accountId,
          debit: line.credit, // swap
          credit: line.debit, // swap
          description: `Reversal: ${line.description ?? ''}`,
        })),
      },
    },
    include: {
      lines: {
        include: { account: { select: { code: true, name: true } } },
      },
    },
  });

  // Mark original as reversed
  await prisma.ledgerEntry.update({
    where: { id: entryId },
    data: { isReversed: true, reversedById: reversal.id },
  });

  return reversal;
}

// ============================================
// QUERY HELPERS
// ============================================

/** Get current balance for an account by code */
export async function getAccountBalance(
  prisma: PrismaClient,
  accountCode: string
): Promise<number> {
  const account = await prisma.ledgerAccount.findUnique({
    where: { code: accountCode },
    select: { balance: true },
  });

  if (!account) throw new Error(`Unknown account: ${accountCode}`);
  return account.balance;
}

/** Get all account balances */
export async function getAllAccountBalances(prisma: PrismaClient) {
  return prisma.ledgerAccount.findMany({
    where: { isActive: true },
    select: { code: true, name: true, type: true, balance: true },
    orderBy: { code: 'asc' },
  });
}

/** Check if a ledger entry already exists for a given source (idempotency) */
export async function entryExistsForSource(
  prisma: PrismaClient,
  sourceType: string,
  sourceId: string
): Promise<boolean> {
  const existing = await prisma.ledgerEntry.findUnique({
    where: { sourceType_sourceId: { sourceType, sourceId } },
    select: { id: true },
  });
  return !!existing;
}

// ============================================
// FABRIC CONSUMPTION → FINISHED GOODS (Production)
// ============================================

/**
 * Recalculate and book fabric consumption for a given month.
 *
 * Looks at all inward transactions (except returns/RTO) for the month,
 * multiplies by BOM fabric cost, and creates/updates a journal entry:
 *   Dr FINISHED_GOODS, Cr FABRIC_INVENTORY
 *
 * Production converts raw fabric into finished garments — the cost moves
 * from fabric inventory to finished goods (not COGS, since we haven't sold yet).
 *
 * If an entry already exists and the amount changed, reverses the old
 * one and creates a fresh entry. Safe to call repeatedly.
 *
 * @returns The fabric cost booked, or 0 if nothing changed
 */
export async function bookFabricConsumptionForMonth(
  prisma: PrismaClient,
  year: number,
  month: number, // 1-indexed
  adminUserId: string
): Promise<{ fabricCost: number; action: 'created' | 'updated' | 'unchanged' | 'zero' }> {
  const label = `${year}-${String(month).padStart(2, '0')}`;
  const SOURCE_TYPE = 'fabric_consumption';
  const SOURCE_ID = `fabric_consumption_${label}`;

  // IST month boundaries → UTC
  const startIST = new Date(Date.UTC(year, month - 1, 1, -5, -30));
  const endIST = new Date(Date.UTC(year, month, 1, -5, -30));

  // Calculate cost for all production inwards using pre-computed SKU bomCost
  // bomCost is trigger-maintained (includes fabric + trims + services) — no JOIN multiplication risk
  const result = await prisma.$queryRaw<{ fabric_cost: number }[]>`
    SELECT COALESCE(SUM(it.qty * COALESCE(s."bomCost", 0)), 0)::float AS fabric_cost
    FROM "InventoryTransaction" it
    JOIN "Sku" s ON s.id = it."skuId"
    WHERE it."txnType" = 'inward'
      AND it.reason NOT IN ('rto_received', 'return_receipt')
      AND it."createdAt" >= ${startIST}
      AND it."createdAt" < ${endIST}
  `;

  const fabricCost = Math.round((result[0]?.fabric_cost ?? 0) * 100) / 100;

  // Check existing entry
  const existing = await prisma.ledgerEntry.findUnique({
    where: { sourceType_sourceId: { sourceType: SOURCE_TYPE, sourceId: SOURCE_ID } },
    include: { lines: { where: { debit: { gt: 0 } }, select: { debit: true } } },
  });

  if (existing) {
    const oldAmount = Math.round((existing.lines[0]?.debit ?? 0) * 100) / 100;

    if (!existing.isReversed && Math.abs(oldAmount - fabricCost) < 0.01) {
      return { fabricCost, action: 'unchanged' };
    }

    // If old code reversed this entry, delete the reversal too (net out correctly)
    if (existing.isReversed && existing.reversedById) {
      await prisma.ledgerEntry.delete({ where: { id: existing.reversedById } });
    }

    // Delete old entry — cascade deletes lines, DB trigger corrects balances
    await prisma.ledgerEntry.delete({ where: { id: existing.id } });
  }

  if (fabricCost === 0) {
    return { fabricCost: 0, action: 'zero' };
  }

  // Last day of the month for entryDate
  const entryDate = new Date(Date.UTC(year, month, 0));

  await createLedgerEntry(prisma, {
    entryDate,
    period: label,
    description: `Production → Finished Goods — ${label} (all production inwards × BOM cost)`,
    sourceType: SOURCE_TYPE,
    sourceId: SOURCE_ID,
    createdById: adminUserId,
    notes: `Auto-calculated: sum of (BOM fabric qty × fabric cost per unit × units) from all non-return inwards in ${label}. Fabric becomes finished goods inventory.`,
    lines: [
      { accountCode: 'FINISHED_GOODS', debit: fabricCost },
      { accountCode: 'FABRIC_INVENTORY', credit: fabricCost },
    ],
  });

  return { fabricCost, action: existing ? 'updated' : 'created' };
}

// ============================================
// SHIPMENT → COGS (Finished Goods become Cost)
// ============================================

/**
 * Book COGS for shipments in a given month.
 *
 * Looks at all outward transactions with reason='sale' for the month,
 * calculates fabric cost using the same BOM formula, and creates:
 *   Dr COGS, Cr FINISHED_GOODS
 *
 * When goods ship to customers, finished goods become cost of goods sold.
 *
 * Same reversal logic as bookFabricConsumptionForMonth — safe to re-run.
 */
export async function bookShipmentCOGSForMonth(
  prisma: PrismaClient,
  year: number,
  month: number,
  adminUserId: string
): Promise<{ amount: number; action: 'created' | 'updated' | 'unchanged' | 'zero' }> {
  const label = `${year}-${String(month).padStart(2, '0')}`;
  const SOURCE_TYPE = 'shipment_cogs';
  const SOURCE_ID = `shipment_cogs_${label}`;

  // IST month boundaries → UTC
  const startIST = new Date(Date.UTC(year, month - 1, 1, -5, -30));
  const endIST = new Date(Date.UTC(year, month, 1, -5, -30));

  // Calculate cost of shipped goods using pre-computed SKU bomCost
  const result = await prisma.$queryRaw<{ total_cost: number }[]>`
    SELECT COALESCE(SUM(it.qty * COALESCE(s."bomCost", 0)), 0)::float AS total_cost
    FROM "InventoryTransaction" it
    JOIN "Sku" s ON s.id = it."skuId"
    WHERE it."txnType" = 'outward'
      AND it.reason = 'sale'
      AND it."createdAt" >= ${startIST}
      AND it."createdAt" < ${endIST}
  `;

  const amount = Math.round((result[0]?.total_cost ?? 0) * 100) / 100;

  // Check existing entry
  const existing = await prisma.ledgerEntry.findUnique({
    where: { sourceType_sourceId: { sourceType: SOURCE_TYPE, sourceId: SOURCE_ID } },
    include: { lines: { where: { debit: { gt: 0 } }, select: { debit: true } } },
  });

  if (existing) {
    const oldAmount = Math.round((existing.lines[0]?.debit ?? 0) * 100) / 100;

    if (!existing.isReversed && Math.abs(oldAmount - amount) < 0.01) {
      return { amount, action: 'unchanged' };
    }

    // If old code reversed this entry, delete the reversal too (net out correctly)
    if (existing.isReversed && existing.reversedById) {
      await prisma.ledgerEntry.delete({ where: { id: existing.reversedById } });
    }

    // Delete old entry — cascade deletes lines, DB trigger corrects balances
    await prisma.ledgerEntry.delete({ where: { id: existing.id } });
  }

  if (amount === 0) {
    return { amount: 0, action: 'zero' };
  }

  const entryDate = new Date(Date.UTC(year, month, 0));

  await createLedgerEntry(prisma, {
    entryDate,
    period: label,
    description: `Shipment COGS — ${label} (shipped goods × BOM cost)`,
    sourceType: SOURCE_TYPE,
    sourceId: SOURCE_ID,
    createdById: adminUserId,
    notes: `Auto-calculated: cost of goods shipped to customers in ${label}. Finished goods become COGS on shipment.`,
    lines: [
      { accountCode: 'COGS', debit: amount },
      { accountCode: 'FINISHED_GOODS', credit: amount },
    ],
  });

  return { amount, action: existing ? 'updated' : 'created' };
}

// ============================================
// RETURN/RTO → COGS REVERSAL (Back to Finished Goods)
// ============================================

/**
 * Book COGS reversal for returns/RTO in a given month.
 *
 * Looks at all inward transactions with reason in ('rto_received', 'return_receipt')
 * for the month, calculates fabric cost, and creates:
 *   Dr FINISHED_GOODS, Cr COGS
 *
 * When goods come back (RTO or customer return), they go back into
 * finished goods inventory and reduce COGS.
 *
 * Delete-and-recreate pattern — safe to re-run.
 */
export async function bookReturnReversalForMonth(
  prisma: PrismaClient,
  year: number,
  month: number,
  adminUserId: string
): Promise<{ amount: number; action: 'created' | 'updated' | 'unchanged' | 'zero' }> {
  const label = `${year}-${String(month).padStart(2, '0')}`;
  const SOURCE_TYPE = 'return_cogs_reversal';
  const SOURCE_ID = `return_cogs_reversal_${label}`;

  // IST month boundaries → UTC
  const startIST = new Date(Date.UTC(year, month - 1, 1, -5, -30));
  const endIST = new Date(Date.UTC(year, month, 1, -5, -30));

  // Calculate cost of returned goods using pre-computed SKU bomCost
  const result = await prisma.$queryRaw<{ total_cost: number }[]>`
    SELECT COALESCE(SUM(it.qty * COALESCE(s."bomCost", 0)), 0)::float AS total_cost
    FROM "InventoryTransaction" it
    JOIN "Sku" s ON s.id = it."skuId"
    WHERE it."txnType" = 'inward'
      AND it.reason IN ('rto_received', 'return_receipt')
      AND it."createdAt" >= ${startIST}
      AND it."createdAt" < ${endIST}
  `;

  const amount = Math.round((result[0]?.total_cost ?? 0) * 100) / 100;

  // Check existing entry
  const existing = await prisma.ledgerEntry.findUnique({
    where: { sourceType_sourceId: { sourceType: SOURCE_TYPE, sourceId: SOURCE_ID } },
    include: { lines: { where: { debit: { gt: 0 } }, select: { debit: true } } },
  });

  if (existing) {
    const oldAmount = Math.round((existing.lines[0]?.debit ?? 0) * 100) / 100;

    if (!existing.isReversed && Math.abs(oldAmount - amount) < 0.01) {
      return { amount, action: 'unchanged' };
    }

    // If old code reversed this entry, delete the reversal too (net out correctly)
    if (existing.isReversed && existing.reversedById) {
      await prisma.ledgerEntry.delete({ where: { id: existing.reversedById } });
    }

    // Delete old entry — cascade deletes lines, DB trigger corrects balances
    await prisma.ledgerEntry.delete({ where: { id: existing.id } });
  }

  if (amount === 0) {
    return { amount: 0, action: 'zero' };
  }

  const entryDate = new Date(Date.UTC(year, month, 0));

  await createLedgerEntry(prisma, {
    entryDate,
    period: label,
    description: `Return/RTO COGS reversal — ${label} (returned goods × BOM cost)`,
    sourceType: SOURCE_TYPE,
    sourceId: SOURCE_ID,
    createdById: adminUserId,
    notes: `Auto-calculated: cost of returned/RTO goods in ${label}. Returned goods go back to finished goods inventory.`,
    lines: [
      { accountCode: 'FINISHED_GOODS', debit: amount },
      { accountCode: 'COGS', credit: amount },
    ],
  });

  return { amount, action: existing ? 'updated' : 'created' };
}
