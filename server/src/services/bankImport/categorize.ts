/**
 * Bank Import V2 — Categorize Service
 *
 * Party-centric categorization: matches narrations to Party records via aliases,
 * then uses the Party's TransactionType for accounting treatment.
 *
 * No hardcoded rules — all config lives in the database (Party + TransactionType).
 * To add a new vendor, create a Party record in the UI. Zero code changes.
 */

import { Prisma, PrismaClient } from '@prisma/client';
import {
  findPartyByNarration,
  resolveAccounting,
  type PartyWithTxnType,
} from '../transactionTypeResolver.js';

const prisma = new PrismaClient();

// ============================================
// TYPES
// ============================================

export interface CategorizeResult {
  total: number;
  categorized: number;
  skipped: number;
  breakdown: Record<string, { count: number; total: number }>;
}

export interface CategoryInfo {
  skip?: boolean;
  skipReason?: string;
  debitAccount: string;
  creditAccount: string;
  description: string;
  category?: string;
  counterpartyName?: string;
  partyId?: string;
}

// ============================================
// BANK-SPECIFIC NARRATION PARSING
// ============================================

/** Extract UPI payee name from HDFC narration: "UPI-PAYEE NAME-upi@bank-..." */
function extractUpiPayee(narration: string): string | null {
  if (!narration.toUpperCase().startsWith('UPI-')) return null;
  const parts = narration.split('-');
  return parts.length > 1 ? parts[1].trim() : null;
}

/** Extract note description from RazorpayX raw data */
function extractNoteDescription(rawData: Record<string, unknown>): string | null {
  const notes = String(rawData.notes ?? '{}');
  if (!notes || notes === '{}') return null;
  try {
    const parsed = JSON.parse(notes);
    const keys = Object.keys(parsed);
    if (keys.length > 0 && keys[0] !== 'note') return keys[0];
    return null;
  } catch { return null; }
}

// ============================================
// HDFC CATEGORIZATION
// ============================================

function categorizeHdfc(
  narration: string,
  direction: 'debit' | 'credit',
  parties: PartyWithTxnType[],
): CategoryInfo {
  const isWithdrawal = direction === 'debit';

  // Try alias-based Party match on the full narration
  const party = findPartyByNarration(narration, parties);

  if (party) {
    const acct = resolveAccounting(party);
    const bankAccount = 'BANK_HDFC';

    // Inter-bank transfer: skip if TransactionType is "Inter-bank Transfer"
    // and it's a known skip pattern (054105001906 ICICI transfer)
    if (party.transactionType?.name === 'Inter-bank Transfer') {
      // Check if this is an incoming transfer from RazorpayX or outgoing to it
      const debit = isWithdrawal ? (acct.debitAccount || 'BANK_RAZORPAYX') : bankAccount;
      const credit = isWithdrawal ? bankAccount : (acct.creditAccount || 'BANK_RAZORPAYX');
      return {
        debitAccount: debit,
        creditAccount: credit,
        description: `Transfer: ${party.name}`,
        partyId: party.id,
      };
    }

    if (isWithdrawal) {
      return {
        debitAccount: acct.debitAccount || 'UNMATCHED_PAYMENTS',
        creditAccount: bankAccount,
        description: `${party.name}`.slice(0, 80),
        category: acct.category || undefined,
        counterpartyName: party.name,
        partyId: party.id,
      };
    } else {
      return {
        debitAccount: bankAccount,
        creditAccount: acct.creditAccount || 'UNMATCHED_PAYMENTS',
        description: `${party.name}`.slice(0, 80),
        category: acct.category || undefined,
        counterpartyName: party.name,
        partyId: party.id,
      };
    }
  }

  // No Party match — try UPI payee extraction for display
  const upiPayee = extractUpiPayee(narration);
  if (upiPayee) {
    const upiDesc = narration.split('-').pop()?.trim() || '';
    if (isWithdrawal) {
      return { debitAccount: 'UNMATCHED_PAYMENTS', creditAccount: 'BANK_HDFC', description: `UPI: ${upiPayee} — ${upiDesc}`.slice(0, 80), counterpartyName: upiPayee };
    }
    return { debitAccount: 'BANK_HDFC', creditAccount: 'UNMATCHED_PAYMENTS', description: `UPI deposit: ${upiPayee} — ${upiDesc}`.slice(0, 80) };
  }

  // Generic fallback
  if (isWithdrawal) return { debitAccount: 'UNMATCHED_PAYMENTS', creditAccount: 'BANK_HDFC', description: `Payment: ${narration.slice(0, 60)}` };
  return { debitAccount: 'BANK_HDFC', creditAccount: 'UNMATCHED_PAYMENTS', description: `Deposit: ${narration.slice(0, 60)}` };
}

// ============================================
// RAZORPAYX CATEGORIZATION
// ============================================

/** RazorpayX purpose → fallback accounts (for refund/salary/rzp_fees without Party match) */
const PURPOSE_FALLBACK: Record<string, { debitAccount: string; creditAccount: string }> = {
  refund:   { debitAccount: 'SALES_REVENUE',     creditAccount: 'BANK_RAZORPAYX' },
  salary:   { debitAccount: 'OPERATING_EXPENSES', creditAccount: 'BANK_RAZORPAYX' },
  rzp_fees: { debitAccount: 'MARKETPLACE_FEES',   creditAccount: 'BANK_RAZORPAYX' },
};

function categorizeRazorpayxPayout(
  rawData: Record<string, unknown>,
  parties: PartyWithTxnType[],
): CategoryInfo {
  const contactName = String(rawData.contact_name ?? '');
  const purpose = String(rawData.purpose ?? '');
  const noteDesc = extractNoteDescription(rawData);

  // Try Party match by contact name
  const party = findPartyByNarration(contactName, parties);

  if (party && purpose === 'vendor bill') {
    const acct = resolveAccounting(party);
    const desc = noteDesc || party.name;
    return {
      debitAccount: acct.debitAccount || 'UNMATCHED_PAYMENTS',
      creditAccount: 'BANK_RAZORPAYX',
      description: `Vendor: ${desc} — ${contactName}`,
      category: acct.category || undefined,
      counterpartyName: contactName,
      partyId: party.id,
    };
  }

  // Purpose-based fallback (refund, salary, rzp_fees)
  if (PURPOSE_FALLBACK[purpose]) {
    const rule = PURPOSE_FALLBACK[purpose];
    const desc = purpose === 'refund' ? `Customer refund — ${contactName}`
      : purpose === 'salary' ? `Salary: ${noteDesc || 'Salary'} — ${contactName}`
      : `Razorpay fee`;

    return {
      debitAccount: rule.debitAccount,
      creditAccount: rule.creditAccount,
      description: desc,
      category: purpose,
      counterpartyName: contactName,
      ...(party ? { partyId: party.id } : {}),
    };
  }

  // Unknown vendor bill or other purpose — still try party match
  if (party) {
    const acct = resolveAccounting(party);
    return {
      debitAccount: acct.debitAccount || 'UNMATCHED_PAYMENTS',
      creditAccount: 'BANK_RAZORPAYX',
      description: `${purpose}: ${contactName}`,
      category: acct.category || undefined,
      counterpartyName: contactName,
      partyId: party.id,
    };
  }

  return { debitAccount: 'UNMATCHED_PAYMENTS', creditAccount: 'BANK_RAZORPAYX', description: `${purpose}: ${contactName}`, counterpartyName: contactName };
}

function categorizeRazorpayxCharge(): CategoryInfo {
  return {
    debitAccount: 'OPERATING_EXPENSES',
    creditAccount: 'BANK_RAZORPAYX',
    description: 'Bank charges (RazorpayX)',
    category: 'service',
  };
}

// ============================================
// CC CATEGORIZATION
// ============================================

function categorizeCcCharge(
  narration: string,
  bank: string,
  parties: PartyWithTxnType[],
): CategoryInfo {
  // Try Party match on narration
  const party = findPartyByNarration(narration, parties);

  if (party) {
    const acct = resolveAccounting(party);
    return {
      debitAccount: acct.debitAccount || 'OPERATING_EXPENSES',
      creditAccount: 'CREDIT_CARD',
      description: `CC ${bank === 'hdfc_cc' ? 'HDFC' : 'ICICI'}: ${party.name}`.slice(0, 80),
      category: acct.category || 'other',
      counterpartyName: party.name,
      partyId: party.id,
    };
  }

  // Fallback: check for marketplace fees
  const d = narration.toUpperCase();
  const expenseAccount = (d.includes('SHOPFLO') || d.includes('SHOPIFY')) ? 'MARKETPLACE_FEES' : 'OPERATING_EXPENSES';

  return {
    debitAccount: expenseAccount,
    creditAccount: 'CREDIT_CARD',
    description: `CC ${bank === 'hdfc_cc' ? 'HDFC' : 'ICICI'}: ${narration.slice(0, 60)}`,
    category: expenseAccount === 'MARKETPLACE_FEES' ? 'marketplace' : 'other',
  };
}

// ============================================
// REUSABLE HELPERS (used by import.ts for inline categorization)
// ============================================

/** Fetch all active parties with TransactionType — single query, reusable */
export async function fetchActiveParties(): Promise<PartyWithTxnType[]> {
  return prisma.party.findMany({
    where: { isActive: true },
    select: {
      id: true,
      name: true,
      aliases: true,
      category: true,
      tdsApplicable: true,
      tdsSection: true,
      tdsRate: true,
      invoiceRequired: true,
      transactionType: {
        select: {
          id: true,
          name: true,
          debitAccountCode: true,
          creditAccountCode: true,
          defaultGstRate: true,
          defaultTdsApplicable: true,
          defaultTdsSection: true,
          defaultTdsRate: true,
          invoiceRequired: true,
          expenseCategory: true,
        },
      },
    },
  });
}

/** Categorize a single transaction — returns update data (no status change) */
export function categorizeSingleTxn(
  txn: { bank: string; narration: string | null; direction: string; counterpartyName: string | null; rawData: unknown; legacySourceId: string | null },
  parties: PartyWithTxnType[],
): CategoryInfo {
  const rawData = (txn.rawData ?? {}) as Record<string, unknown>;

  if (txn.bank === 'hdfc') {
    return categorizeHdfc(txn.narration || '', txn.direction as 'debit' | 'credit', parties);
  } else if (txn.bank === 'razorpayx') {
    if (txn.legacySourceId?.startsWith('pay_') || txn.legacySourceId?.startsWith('pout_')) {
      return categorizeRazorpayxPayout(rawData, parties);
    } else if (txn.narration === 'Bank charges (RazorpayX)') {
      return categorizeRazorpayxCharge();
    } else {
      return categorizeRazorpayxPayout(rawData, parties);
    }
  } else if (txn.bank === 'hdfc_cc' || txn.bank === 'icici_cc') {
    return categorizeCcCharge(txn.narration || '', txn.bank, parties);
  }

  return { debitAccount: 'UNMATCHED_PAYMENTS', creditAccount: 'UNMATCHED_PAYMENTS', description: 'Unknown bank type' };
}

// ============================================
// MAIN CATEGORIZE FUNCTION
// ============================================

export async function categorizeTransactions(options?: { bank?: string }): Promise<CategorizeResult> {
  const where: Prisma.BankTransactionWhereInput = {
    status: 'imported',
    ...(options?.bank ? { bank: options.bank } : {}),
  };

  const txns = await prisma.bankTransaction.findMany({
    where,
    orderBy: { txnDate: 'asc' },
  });

  const parties = await fetchActiveParties();

  // Pre-fetch open invoices for RazorpayX matching
  const openInvoices = await prisma.invoice.findMany({
    where: {
      type: 'payable',
      status: { in: ['confirmed', 'partially_paid'] },
      balanceDue: { gt: 0.01 },
    },
    select: { id: true, invoiceNumber: true, totalAmount: true, partyId: true },
  });
  const invoiceByNumber = new Map(openInvoices.filter(i => i.invoiceNumber).map(i => [i.invoiceNumber!, i]));
  const invoiceById = new Map(openInvoices.map(i => [i.id, i]));

  const breakdown: Record<string, { count: number; total: number }> = {};
  let categorized = 0;
  let skipped = 0;
  const updates: { id: string; data: Prisma.BankTransactionUncheckedUpdateInput }[] = [];

  for (const txn of txns) {
    const cat = categorizeSingleTxn(txn, parties);
    const rawData = (txn.rawData ?? {}) as Record<string, unknown>;

    if (cat.skip) {
      updates.push({
        id: txn.id,
        data: {
          status: 'skipped',
          skipReason: cat.skipReason || 'skipped',
          debitAccountCode: cat.debitAccount || null,
          creditAccountCode: cat.creditAccount || null,
        },
      });
      skipped++;
      continue;
    }

    // Party may already be set by categorize functions
    let partyId = cat.partyId;

    // Fallback: try exact name match if no party from categorization
    if (!partyId) {
      const counterparty = cat.counterpartyName || txn.counterpartyName;
      if (counterparty) {
        const matchedParty = parties.find(p =>
          p.name.toLowerCase() === counterparty.toLowerCase() ||
          p.aliases.some(a => a.toLowerCase() === counterparty.toLowerCase())
        );
        if (matchedParty) partyId = matchedParty.id;
      }
    }

    // For RazorpayX vendor bills, check for invoice match by reference_id
    let matchedInvoiceId: string | undefined;
    if (txn.bank === 'razorpayx') {
      const referenceId = String(rawData.reference_id ?? '').trim();
      if (referenceId) {
        const inv = invoiceByNumber.get(referenceId) || invoiceById.get(referenceId);
        if (inv) {
          matchedInvoiceId = inv.id;
          cat.debitAccount = 'ACCOUNTS_PAYABLE';
        }
      }
    }

    updates.push({
      id: txn.id,
      data: {
        debitAccountCode: cat.debitAccount,
        creditAccountCode: cat.creditAccount,
        category: cat.category || null,
        counterpartyName: cat.counterpartyName || txn.counterpartyName || null,
        status: 'categorized',
        ...(partyId ? { partyId } : {}),
        ...(matchedInvoiceId ? { matchedInvoiceId } : {}),
      },
    });

    categorized++;

    const key = `${cat.debitAccount} → ${cat.creditAccount}`;
    if (!breakdown[key]) breakdown[key] = { count: 0, total: 0 };
    breakdown[key].count++;
    breakdown[key].total += txn.amount;
  }

  // PayU Settlement matching — match HDFC credits to PayuSettlement records by UTR (exact)
  // Runs BEFORE COD remittance matching because UTR is deterministic (exact match vs fuzzy amount+date)
  for (const txn of txns) {
    if (txn.bank !== 'hdfc' || txn.direction !== 'credit') continue;

    const existingUpdate = updates.find(u => u.id === txn.id);
    const creditAcct = existingUpdate?.data?.creditAccountCode as string | undefined;
    if (creditAcct && creditAcct !== 'UNMATCHED_PAYMENTS') continue;

    if (!txn.utr && !txn.reference) continue;

    // HDFC stores UTR with leading zeros in reference (e.g. "0000001442998025")
    // PayU gives bare UTR (e.g. "1442998025"). Try both stripped and original values.
    const candidates: string[] = [];
    if (txn.utr) { candidates.push(txn.utr); candidates.push(txn.utr.replace(/^0+/, '')); }
    if (txn.reference) { candidates.push(txn.reference); candidates.push(txn.reference.replace(/^0+/, '')); }
    const uniqueCandidates = [...new Set(candidates)];

    // Find any unlinked settlement matching this UTR (multiple settlements can share one UTR)
    const payuMatch = await prisma.payuSettlement.findFirst({
      where: {
        bankTransactionId: null,
        utrNumber: { in: uniqueCandidates },
      },
    });

    if (payuMatch) {
      const payuData: Prisma.BankTransactionUncheckedUpdateInput = {
        debitAccountCode: 'BANK_HDFC',
        creditAccountCode: 'SALES_REVENUE',
        category: 'payu_settlement',
        counterpartyName: 'PayU',
        status: 'categorized',
      };

      if (existingUpdate) {
        existingUpdate.data = payuData;
      } else {
        updates.push({ id: txn.id, data: payuData });
        categorized++;
      }

      // Link ALL settlements with this UTR to this bank transaction
      const utrValue = payuMatch.utrNumber;
      await prisma.payuSettlement.updateMany({
        where: { utrNumber: utrValue, bankTransactionId: null },
        data: { bankTransactionId: txn.id, matchedAt: new Date(), matchConfidence: 'utr_exact' },
      });
    }
  }

  // COD Remittance matching — match unmatched HDFC credits to CodRemittance records
  for (const txn of txns) {
    if (txn.bank !== 'hdfc' || txn.direction !== 'credit') continue;

    // Check if already categorized to a known party
    const existingUpdate = updates.find(u => u.id === txn.id);
    const creditAcct = existingUpdate?.data?.creditAccountCode as string | undefined;
    if (creditAcct && creditAcct !== 'UNMATCHED_PAYMENTS') continue;

    // Try matching to CodRemittance by amount (±Rs 1) + date (±3 days)
    const match = await prisma.codRemittance.findFirst({
      where: {
        bankTransactionId: null,
        codRemitted: { gte: txn.amount - 1, lte: txn.amount + 1 },
        remittanceDate: {
          gte: new Date(txn.txnDate.getTime() - 3 * 86400000),
          lte: new Date(txn.txnDate.getTime() + 3 * 86400000),
        },
      },
      orderBy: { remittanceDate: 'desc' },
    });

    if (match) {
      // Override or set categorization for this txn
      const codData: Prisma.BankTransactionUncheckedUpdateInput = {
        debitAccountCode: 'BANK_HDFC',
        creditAccountCode: 'SALES_REVENUE',
        category: 'cod_remittance',
        counterpartyName: 'iThink Logistics COD',
        status: 'categorized',
      };

      if (existingUpdate) {
        existingUpdate.data = codData;
      } else {
        updates.push({ id: txn.id, data: codData });
        categorized++;
      }

      // Link CodRemittance to BankTransaction
      await prisma.codRemittance.update({
        where: { id: match.id },
        data: { bankTransactionId: txn.id, matchedAt: new Date(), matchConfidence: 'exact_amount' },
      });
    }
  }

  // Batch update
  const BATCH = 50;
  for (let i = 0; i < updates.length; i += BATCH) {
    const batch = updates.slice(i, i + BATCH);
    await Promise.all(
      batch.map(u => prisma.bankTransaction.update({ where: { id: u.id }, data: u.data }))
    );
    process.stdout.write(`  Updated: ${Math.min(i + BATCH, updates.length)}/${updates.length}\r`);
  }

  return { total: txns.length, categorized, skipped, breakdown };
}
