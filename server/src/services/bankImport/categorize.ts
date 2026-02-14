/**
 * Bank Import V2 — Categorize Service
 *
 * Applies bank rules to imported BankTransactions.
 * Sets debitAccountCode, creditAccountCode, category, partyId, matchedInvoiceId.
 * Same logic as old import scripts — just separated from the posting step.
 */

import { PrismaClient } from '@prisma/client';
import {
  matchNarrationRule,
  getUpiPayeeRule,
  getVendorRule,
  PURPOSE_RULES,
} from '../../config/finance/bankRules.js';

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

interface CategoryInfo {
  skip?: boolean;
  skipReason?: string;
  debitAccount: string;
  creditAccount: string;
  description: string;
  category?: string;
  counterpartyName?: string;
}

// ============================================
// HDFC CATEGORIZATION (same as old script)
// ============================================

function categorizeHdfc(narration: string, direction: 'debit' | 'credit'): CategoryInfo {
  const isWithdrawal = direction === 'debit';
  const n = narration.toUpperCase();

  const rule = matchNarrationRule(narration, isWithdrawal);
  if (rule) {
    if (rule.skip) {
      return { skip: true, skipReason: 'inter_account_transfer', debitAccount: '', creditAccount: '', description: rule.description || 'Skipped' };
    }
    return {
      debitAccount: rule.debitAccount!,
      creditAccount: rule.creditAccount!,
      description: rule.description || narration.slice(0, 60),
      category: rule.category,
    };
  }

  if (n.startsWith('UPI-')) {
    const parts = narration.split('-');
    const payeeName = parts.length > 1 ? parts[1].trim() : 'Unknown';
    const upiDesc = parts[parts.length - 1]?.trim() || '';
    const upiRule = getUpiPayeeRule(payeeName);
    if (isWithdrawal) {
      if (upiRule) {
        return {
          debitAccount: upiRule.debitAccount,
          creditAccount: 'BANK_HDFC',
          description: `${upiRule.description} — ${payeeName}`,
          category: upiRule.category,
          counterpartyName: payeeName,
        };
      }
      return { debitAccount: 'UNMATCHED_PAYMENTS', creditAccount: 'BANK_HDFC', description: `UPI: ${payeeName} — ${upiDesc}`.slice(0, 80), counterpartyName: payeeName };
    }
    return { debitAccount: 'BANK_HDFC', creditAccount: 'UNMATCHED_PAYMENTS', description: `UPI deposit: ${payeeName} — ${upiDesc}`.slice(0, 80) };
  }

  if (isWithdrawal && n.includes('IMPS')) return { debitAccount: 'UNMATCHED_PAYMENTS', creditAccount: 'BANK_HDFC', description: `IMPS: ${narration.slice(0, 60)}` };
  if (isWithdrawal) return { debitAccount: 'UNMATCHED_PAYMENTS', creditAccount: 'BANK_HDFC', description: `Payment: ${narration.slice(0, 60)}` };
  return { debitAccount: 'BANK_HDFC', creditAccount: 'UNMATCHED_PAYMENTS', description: `Deposit: ${narration.slice(0, 60)}` };
}

// ============================================
// RAZORPAYX CATEGORIZATION (same as old script)
// ============================================

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

function categorizeRazorpayxPayout(rawData: Record<string, unknown>): CategoryInfo {
  const contactName = String(rawData.contact_name ?? '');
  const purpose = String(rawData.purpose ?? '');
  const referenceId = String(rawData.reference_id ?? '').trim();
  const noteDesc = extractNoteDescription(rawData);

  if (purpose === 'vendor bill') {
    const info = getVendorRule(contactName, purpose, noteDesc);
    const desc = noteDesc || info.description || info.category;
    return {
      debitAccount: info.debitAccount,
      creditAccount: 'BANK_RAZORPAYX',
      description: `Vendor: ${desc} — ${contactName}`,
      category: info.category,
      counterpartyName: contactName,
    };
  }

  if (PURPOSE_RULES[purpose]) {
    const rule = PURPOSE_RULES[purpose];
    const desc = purpose === 'refund' ? `Customer refund — ${contactName}`
      : purpose === 'salary' ? `Salary: ${noteDesc || 'Salary'} — ${contactName}`
      : `Razorpay fee`;
    return { debitAccount: rule.debitAccount, creditAccount: rule.creditAccount, description: desc, category: purpose };
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
// CC CATEGORIZATION (same as old script)
// ============================================

function getExpenseAccount(desc: string): string {
  const d = desc.toUpperCase();
  if (d.includes('SHOPFLO') || d.includes('SHOPIFY')) return 'MARKETPLACE_FEES';
  return 'OPERATING_EXPENSES';
}

function categorizeCcCharge(narration: string, bank: string): CategoryInfo {
  const expenseAccount = getExpenseAccount(narration);
  return {
    debitAccount: expenseAccount,
    creditAccount: 'CREDIT_CARD',
    description: `CC ${bank === 'hdfc_cc' ? 'HDFC' : 'ICICI'}: ${narration.slice(0, 60)}`,
    category: expenseAccount === 'MARKETPLACE_FEES' ? 'marketplace' : 'other',
  };
}

// ============================================
// MAIN CATEGORIZE FUNCTION
// ============================================

export async function categorizeTransactions(options?: { bank?: string }): Promise<CategorizeResult> {
  const where: Record<string, unknown> = { status: 'imported' };
  if (options?.bank) where.bank = options.bank;

  const txns = await prisma.bankTransaction.findMany({
    where: where as any,
    orderBy: { txnDate: 'asc' },
  });

  // Pre-fetch parties for name matching
  const parties = await prisma.party.findMany({
    where: { isActive: true },
    select: { id: true, name: true, aliases: true },
  });

  // Build name → partyId map (name + all aliases)
  const partyByName = new Map<string, string>();
  for (const p of parties) {
    partyByName.set(p.name.toLowerCase(), p.id);
    for (const alias of p.aliases) {
      partyByName.set(alias.toLowerCase(), p.id);
    }
  }

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
  const CHUNK = 200;
  const updates: { id: string; data: Record<string, unknown> }[] = [];

  for (const txn of txns) {
    let cat: CategoryInfo;
    const rawData = (txn.rawData ?? {}) as Record<string, unknown>;

    if (txn.bank === 'hdfc') {
      cat = categorizeHdfc(txn.narration || '', txn.direction as 'debit' | 'credit');
    } else if (txn.bank === 'razorpayx') {
      // Distinguish payouts from charges by looking at legacySourceId format
      if (txn.legacySourceId?.startsWith('pay_') || txn.legacySourceId?.startsWith('pout_')) {
        cat = categorizeRazorpayxPayout(rawData);
      } else if (txn.narration === 'Bank charges (RazorpayX)') {
        cat = categorizeRazorpayxCharge();
      } else {
        cat = categorizeRazorpayxPayout(rawData);
      }
    } else if (txn.bank === 'hdfc_cc' || txn.bank === 'icici_cc') {
      cat = categorizeCcCharge(txn.narration || '', txn.bank);
    } else {
      cat = { debitAccount: 'UNMATCHED_PAYMENTS', creditAccount: 'UNMATCHED_PAYMENTS', description: 'Unknown bank type' };
    }

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

    // Try to match counterparty to a Party
    const counterparty = cat.counterpartyName || txn.counterpartyName;
    const partyId = counterparty ? partyByName.get(counterparty.toLowerCase()) : undefined;

    // For RazorpayX vendor bills, check for invoice match
    let matchedInvoiceId: string | undefined;
    if (txn.bank === 'razorpayx') {
      const referenceId = String(rawData.reference_id ?? '').trim();
      if (referenceId) {
        const inv = invoiceByNumber.get(referenceId) || invoiceById.get(referenceId);
        if (inv) {
          matchedInvoiceId = inv.id;
          // Override to route through AP when invoice exists
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
        counterpartyName: counterparty || txn.counterpartyName || null,
        status: 'categorized',
        ...(partyId ? { partyId } : {}),
        ...(matchedInvoiceId ? { matchedInvoiceId } : {}),
      },
    });

    categorized++;

    // Track breakdown
    const key = `${cat.debitAccount} → ${cat.creditAccount}`;
    if (!breakdown[key]) breakdown[key] = { count: 0, total: 0 };
    breakdown[key].count++;
    breakdown[key].total += txn.amount;
  }

  // Batch update — use concurrent promises in small batches for speed
  const BATCH = 50;
  for (let i = 0; i < updates.length; i += BATCH) {
    const batch = updates.slice(i, i + BATCH);
    await Promise.all(
      batch.map(u => prisma.bankTransaction.update({ where: { id: u.id }, data: u.data as any }))
    );
    process.stdout.write(`  Updated: ${Math.min(i + BATCH, updates.length)}/${updates.length}\r`);
  }
  console.log('');

  return { total: txns.length, categorized, skipped, breakdown };
}
