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
  description: string;
  sourceType: string;
  sourceId?: string;
  lines: LedgerLine[];
  createdById: string;
  notes?: string;
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
  const { entryDate, description, sourceType, sourceId, lines, createdById, notes } = input;

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
      entryDate: new Date(),
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
