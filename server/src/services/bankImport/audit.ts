/**
 * Bank Import V2 — Audit Service
 *
 * Matches V2 BankTransactions to existing LedgerEntries created by old import scripts.
 * Reports: matches, mismatches, duplicates, orphans, and unmatched entries.
 */

import { Prisma, PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

// ============================================
// TYPES
// ============================================

export interface AuditResult {
  matches: number;
  mismatches: AuditMismatch[];
  duplicates: AuditDuplicate[];
  orphans: AuditOrphan[];
  unmatchedEntries: AuditUnmatchedEntry[];
  summary: {
    totalBankTxns: number;
    totalLedgerEntries: number;
    matchCount: number;
    mismatchCount: number;
    duplicateCount: number;
    orphanCount: number;
    unmatchedEntryCount: number;
    mismatchAmount: number;
  };
}

interface AuditMismatch {
  bankTxnId: string;
  legacySourceId: string;
  ledgerEntryId: string;
  amount: number;
  txnDate: Date;
  narration: string;
  v2DebitAccount: string;
  v2CreditAccount: string;
  oldDebitAccount: string;
  oldCreditAccount: string;
}

interface AuditDuplicate {
  bankTxnId: string;
  legacySourceId: string;
  amount: number;
  ledgerEntryIds: string[];
  ledgerSourceIds: (string | null)[];
}

interface AuditOrphan {
  bankTxnId: string;
  legacySourceId: string;
  amount: number;
  txnDate: Date;
  narration: string;
  status: string;
  debitAccountCode: string | null;
  creditAccountCode: string | null;
}

interface AuditUnmatchedEntry {
  ledgerEntryId: string;
  sourceType: string;
  sourceId: string | null;
  amount: number;
  description: string;
  entryDate: Date;
}

// ============================================
// SOURCE TYPE MAPPING
// ============================================

function getSourceTypes(bank: string): string[] {
  switch (bank) {
    case 'hdfc': return ['hdfc_statement'];
    case 'razorpayx': return ['bank_payout', 'bank_charge'];
    case 'hdfc_cc':
    case 'icici_cc': return ['cc_charge'];
    default: return [];
  }
}

// ============================================
// MAIN AUDIT FUNCTION
// ============================================

export async function auditExistingEntries(options?: { bank?: string }): Promise<AuditResult> {
  // 1. Fetch categorized/imported BankTransactions (not skipped)
  const bankWhere: Prisma.BankTransactionWhereInput = {
    status: { in: ['categorized', 'imported', 'legacy_posted'] },
    ...(options?.bank ? { bank: options.bank } : {}),
  };

  const bankTxns = await prisma.bankTransaction.findMany({
    where: bankWhere,
    orderBy: { txnDate: 'asc' },
  });

  // 2. Determine which source types to look at
  const banks = options?.bank ? [options.bank] : ['hdfc', 'razorpayx', 'hdfc_cc', 'icici_cc'];
  const sourceTypes = [...new Set(banks.flatMap(getSourceTypes))];

  // 3. Fetch all existing ledger entries for these source types
  const ledgerEntries = await prisma.ledgerEntry.findMany({
    where: { sourceType: { in: sourceTypes } },
    include: {
      lines: {
        include: { account: { select: { code: true } } },
      },
    },
  });

  // Build sourceId → entry(ies) map
  const entriesBySourceId = new Map<string, typeof ledgerEntries>();
  for (const entry of ledgerEntries) {
    const key = entry.sourceId || '';
    const existing = entriesBySourceId.get(key) || [];
    existing.push(entry);
    entriesBySourceId.set(key, existing);
  }

  // Track which entries got matched
  const matchedEntryIds = new Set<string>();

  const matches: { txnId: string; entryId: string; alreadyLinked: boolean }[] = [];
  const mismatches: AuditMismatch[] = [];
  const duplicates: AuditDuplicate[] = [];
  const orphans: AuditOrphan[] = [];

  // 4. For each BankTransaction, find matching LedgerEntry
  for (const txn of bankTxns) {
    if (!txn.legacySourceId) {
      orphans.push({
        bankTxnId: txn.id,
        legacySourceId: txn.legacySourceId || '',
        amount: txn.amount,
        txnDate: txn.txnDate,
        narration: txn.narration || '',
        status: txn.status,
        debitAccountCode: txn.debitAccountCode,
        creditAccountCode: txn.creditAccountCode,
      });
      continue;
    }

    // Find matching entries — for HDFC, use LIKE pattern (catches _1, _2 suffixes)
    let matchingEntries: typeof ledgerEntries = [];

    if (txn.bank === 'hdfc') {
      // HDFC sourceIds may have _1, _2 suffixes for duplicates
      const exact = entriesBySourceId.get(txn.legacySourceId) || [];
      matchingEntries.push(...exact);
      // Check for _1, _2, etc. suffixed entries
      for (let suffix = 1; suffix <= 5; suffix++) {
        const suffixed = entriesBySourceId.get(`${txn.legacySourceId}_${suffix}`);
        if (suffixed) matchingEntries.push(...suffixed);
        else break;
      }
    } else {
      matchingEntries = entriesBySourceId.get(txn.legacySourceId) || [];
    }

    if (matchingEntries.length === 0) {
      orphans.push({
        bankTxnId: txn.id,
        legacySourceId: txn.legacySourceId,
        amount: txn.amount,
        txnDate: txn.txnDate,
        narration: txn.narration || '',
        status: txn.status,
        debitAccountCode: txn.debitAccountCode,
        creditAccountCode: txn.creditAccountCode,
      });
      continue;
    }

    if (matchingEntries.length > 1) {
      duplicates.push({
        bankTxnId: txn.id,
        legacySourceId: txn.legacySourceId,
        amount: txn.amount,
        ledgerEntryIds: matchingEntries.map(e => e.id),
        ledgerSourceIds: matchingEntries.map(e => e.sourceId),
      });
      matchingEntries.forEach(e => matchedEntryIds.add(e.id));
      continue;
    }

    // Exactly one match — compare accounts
    const entry = matchingEntries[0];
    matchedEntryIds.add(entry.id);

    const debitLine = entry.lines.find(l => l.debit > 0);
    const creditLine = entry.lines.find(l => l.credit > 0);
    const oldDebitAccount = debitLine?.account.code || '';
    const oldCreditAccount = creditLine?.account.code || '';

    const v2Debit = txn.debitAccountCode || '';
    const v2Credit = txn.creditAccountCode || '';

    if (v2Debit === oldDebitAccount && v2Credit === oldCreditAccount) {
      matches.push({ txnId: txn.id, entryId: entry.id, alreadyLinked: txn.status === 'legacy_posted' });
    } else {
      mismatches.push({
        bankTxnId: txn.id,
        legacySourceId: txn.legacySourceId,
        ledgerEntryId: entry.id,
        amount: txn.amount,
        txnDate: txn.txnDate,
        narration: txn.narration || '',
        v2DebitAccount: v2Debit,
        v2CreditAccount: v2Credit,
        oldDebitAccount,
        oldCreditAccount,
      });
    }
  }

  // 4b. Batch-update matched transactions to legacy_posted
  const toLink = matches.filter(m => !m.alreadyLinked);
  if (toLink.length > 0) {
    const BATCH = 50;
    for (let i = 0; i < toLink.length; i += BATCH) {
      const batch = toLink.slice(i, i + BATCH);
      await Promise.all(
        batch.map(m => prisma.bankTransaction.update({
          where: { id: m.txnId },
          data: { status: 'legacy_posted', ledgerEntryId: m.entryId },
        }))
      );
      process.stdout.write(`  Linking: ${Math.min(i + BATCH, toLink.length)}/${toLink.length}\r`);
    }
    console.log('');
  }

  // 5. Find unmatched entries (exist in ledger but no matching BankTransaction)
  const unmatchedEntries: AuditUnmatchedEntry[] = [];
  for (const entry of ledgerEntries) {
    if (matchedEntryIds.has(entry.id)) continue;
    const amount = entry.lines.reduce((sum, l) => sum + l.debit, 0);
    unmatchedEntries.push({
      ledgerEntryId: entry.id,
      sourceType: entry.sourceType,
      sourceId: entry.sourceId,
      amount,
      description: entry.description,
      entryDate: entry.entryDate,
    });
  }

  // 6. Calculate mismatch financial impact
  const mismatchAmount = mismatches.reduce((sum, m) => sum + m.amount, 0);

  return {
    matches: matches.length as number,
    mismatches,
    duplicates,
    orphans,
    unmatchedEntries,
    summary: {
      totalBankTxns: bankTxns.length,
      totalLedgerEntries: ledgerEntries.length,
      matchCount: matches.length,
      mismatchCount: mismatches.length,
      duplicateCount: duplicates.length,
      orphanCount: orphans.length,
      unmatchedEntryCount: unmatchedEntries.length,
      mismatchAmount,
    },
  };
}
