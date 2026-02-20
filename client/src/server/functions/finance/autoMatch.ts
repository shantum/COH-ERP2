/**
 * Finance Auto-Match — Suggest and apply bank transaction-invoice matches
 */

'use server';

import { createServerFn } from '@tanstack/react-start';
import { z } from 'zod';
import { authMiddleware } from '../../middleware/auth';
import { getPrisma } from '@coh/shared/services/db';
import { ApplyAutoMatchesSchema } from '@coh/shared/schemas/finance';

// ============================================
// PARTY INVOICE DEFAULTS
// ============================================

export const getPartyInvoiceDefaults = createServerFn({ method: 'GET' })
  .middleware([authMiddleware])
  .inputValidator((input: unknown) => z.object({ partyId: z.string().uuid() }).parse(input))
  .handler(async ({ data }) => {
    const prisma = await getPrisma();
    const party = await prisma.party.findUnique({
      where: { id: data.partyId },
      select: {
        category: true,
        tdsApplicable: true,
        tdsSection: true,
        tdsRate: true,
        transactionType: {
          select: { defaultGstRate: true, debitAccountCode: true, expenseCategory: true },
        },
      },
    });
    if (!party) return { success: false as const, error: 'Party not found' };
    return {
      success: true as const,
      defaults: {
        category: party.transactionType?.expenseCategory ?? party.category,
        gstRate: party.transactionType?.defaultGstRate ?? null,
        tdsApplicable: party.tdsApplicable,
        tdsSection: party.tdsSection,
        tdsRate: party.tdsRate,
      },
    };
  });

// ============================================
// AUTO-MATCH BANK TRANSACTIONS TO INVOICES
// ============================================

/**
 * Score a bank transaction-invoice pair for auto-matching.
 * Amount score (0-100) + Date score (0-30) = total confidence.
 */
function scoreMatch(
  txnAmount: number,
  invoiceBalance: number,
  txnDate: Date,
  invoiceDate: Date,
): { score: number; confidence: 'high' | 'medium' | null; amountDiff: number; daysDiff: number } {
  const amountDiff = Math.abs(txnAmount - invoiceBalance);
  const pctDiff = amountDiff / Math.max(invoiceBalance, 0.01);

  // Amount score
  let amountScore = 0;
  if (amountDiff <= 1) amountScore = 100;
  else if (pctDiff <= 0.01) amountScore = 90;
  else if (pctDiff <= 0.05) amountScore = 70;
  else if (pctDiff <= 0.10) amountScore = 40;
  else return { score: 0, confidence: null, amountDiff, daysDiff: 0 }; // beyond 10% = skip

  // Date score
  const daysDiff = Math.abs(
    Math.floor((txnDate.getTime() - invoiceDate.getTime()) / (1000 * 60 * 60 * 24))
  );
  let dateScore = 0;
  if (daysDiff <= 31) dateScore = 30;
  else if (daysDiff <= 62) dateScore = 20;
  else if (daysDiff <= 93) dateScore = 10;

  const total = amountScore + dateScore;
  const confidence = total >= 90 ? 'high' as const : total >= 60 ? 'medium' as const : null;
  return { score: total, confidence, amountDiff, daysDiff };
}

export const getAutoMatchSuggestions = createServerFn({ method: 'GET' })
  .middleware([authMiddleware])
  .handler(async () => {
    const prisma = await getPrisma();

    // Find parties with BOTH unmatched outgoing bank txns AND unpaid payable invoices
    const [bankTxns, invoices] = await Promise.all([
      prisma.bankTransaction.findMany({
        where: {
          direction: 'debit',
          status: { in: ['posted', 'legacy_posted'] },
          unmatchedAmount: { gt: 0.01 },
          partyId: { not: null },
        },
        select: {
          id: true, amount: true, unmatchedAmount: true, txnDate: true,
          reference: true, utr: true, bank: true, partyId: true,
        },
        orderBy: { txnDate: 'desc' },
        take: 500,
      }),
      prisma.invoice.findMany({
        where: {
          type: 'payable',
          status: { in: ['confirmed', 'partially_paid'] },
          balanceDue: { gt: 0.01 },
          partyId: { not: null },
        },
        select: {
          id: true, invoiceNumber: true, totalAmount: true, balanceDue: true,
          tdsAmount: true, invoiceDate: true, billingPeriod: true, partyId: true,
        },
        orderBy: { invoiceDate: 'desc' },
        take: 500,
      }),
    ]);

    // Group by partyId
    const txnsByParty = new Map<string, typeof bankTxns>();
    for (const t of bankTxns) {
      if (!t.partyId) continue;
      const arr = txnsByParty.get(t.partyId) ?? [];
      arr.push(t);
      txnsByParty.set(t.partyId, arr);
    }

    const invoicesByParty = new Map<string, typeof invoices>();
    for (const inv of invoices) {
      if (!inv.partyId) continue;
      const arr = invoicesByParty.get(inv.partyId) ?? [];
      arr.push(inv);
      invoicesByParty.set(inv.partyId, arr);
    }

    // Find parties that appear in both maps
    const commonPartyIds = [...txnsByParty.keys()].filter(id => invoicesByParty.has(id));
    if (commonPartyIds.length === 0) {
      return { suggestions: [], totalSuggestions: 0 };
    }

    // Fetch party names
    const parties = await prisma.party.findMany({
      where: { id: { in: commonPartyIds } },
      select: { id: true, name: true },
    });
    const partyMap = new Map(parties.map(p => [p.id, p.name]));

    // Score all pairs per party, then greedy 1-to-1 assignment
    const suggestions: Array<{
      party: { id: string; name: string };
      matches: Array<{
        bankTransaction: { id: string; amount: number; unmatchedAmount: number; txnDate: string; reference: string | null; utr: string | null; bank: string };
        invoice: { id: string; invoiceNumber: string | null; totalAmount: number; balanceDue: number; tdsAmount: number; invoiceDate: string; billingPeriod: string | null };
        matchAmount: number;
        confidence: 'high' | 'medium';
        score: number;
        amountDiff: number;
        daysDiff: number;
      }>;
      unmatchedTxns: number;
      unmatchedInvoices: number;
    }> = [];

    for (const partyId of commonPartyIds) {
      const partyTxns = txnsByParty.get(partyId)!;
      const partyInvoices = invoicesByParty.get(partyId)!;

      // Score all pairs
      const scoredPairs: Array<{
        txnIdx: number;
        invoiceIdx: number;
        score: number;
        confidence: 'high' | 'medium';
        amountDiff: number;
        daysDiff: number;
        matchAmount: number;
      }> = [];

      for (let ti = 0; ti < partyTxns.length; ti++) {
        const txn = partyTxns[ti];
        for (let ii = 0; ii < partyInvoices.length; ii++) {
          const inv = partyInvoices[ii];
          const result = scoreMatch(
            txn.unmatchedAmount, inv.balanceDue,
            txn.txnDate, inv.invoiceDate ?? new Date(),
          );
          if (result.confidence) {
            scoredPairs.push({
              txnIdx: ti,
              invoiceIdx: ii,
              score: result.score,
              confidence: result.confidence,
              amountDiff: result.amountDiff,
              daysDiff: result.daysDiff,
              matchAmount: Math.min(txn.unmatchedAmount, inv.balanceDue),
            });
          }
        }
      }

      // Greedy 1-to-1 assignment (highest score first)
      scoredPairs.sort((a, b) => b.score - a.score);
      const usedTxns = new Set<number>();
      const usedInvoices = new Set<number>();
      const matches: typeof suggestions[number]['matches'] = [];

      for (const pair of scoredPairs) {
        if (usedTxns.has(pair.txnIdx) || usedInvoices.has(pair.invoiceIdx)) continue;
        usedTxns.add(pair.txnIdx);
        usedInvoices.add(pair.invoiceIdx);

        const txn = partyTxns[pair.txnIdx];
        const inv = partyInvoices[pair.invoiceIdx];
        matches.push({
          bankTransaction: {
            id: txn.id,
            amount: txn.amount,
            unmatchedAmount: txn.unmatchedAmount,
            txnDate: txn.txnDate.toISOString(),
            reference: txn.reference,
            utr: txn.utr,
            bank: txn.bank,
          },
          invoice: {
            id: inv.id,
            invoiceNumber: inv.invoiceNumber,
            totalAmount: inv.totalAmount,
            balanceDue: inv.balanceDue,
            tdsAmount: inv.tdsAmount ?? 0,
            invoiceDate: (inv.invoiceDate ?? new Date()).toISOString(),
            billingPeriod: inv.billingPeriod,
          },
          matchAmount: pair.matchAmount,
          confidence: pair.confidence,
          score: pair.score,
          amountDiff: pair.amountDiff,
          daysDiff: pair.daysDiff,
        });
      }

      if (matches.length > 0) {
        suggestions.push({
          party: { id: partyId, name: partyMap.get(partyId) ?? 'Unknown' },
          matches,
          unmatchedTxns: partyTxns.length - usedTxns.size,
          unmatchedInvoices: partyInvoices.length - usedInvoices.size,
        });
      }
    }

    // Sort by number of high-confidence matches descending
    suggestions.sort((a, b) => {
      const aHigh = a.matches.filter(m => m.confidence === 'high').length;
      const bHigh = b.matches.filter(m => m.confidence === 'high').length;
      return bHigh - aHigh;
    });

    return {
      suggestions,
      totalSuggestions: suggestions.reduce((sum, s) => sum + s.matches.length, 0),
    };
  });

export const applyAutoMatches = createServerFn({ method: 'POST' })
  .middleware([authMiddleware])
  .inputValidator((input: unknown) => ApplyAutoMatchesSchema.parse(input))
  .handler(async ({ data, context }) => {
    const prisma = await getPrisma();
    const userId = context.user.id;
    const errors: string[] = [];

    // Pre-validate all bank txns and invoices exist with sufficient balances
    const txnIds = data.matches.map(m => m.bankTransactionId);
    const invoiceIds = data.matches.map(m => m.invoiceId);

    const [txnsData, invoicesData] = await Promise.all([
      prisma.bankTransaction.findMany({
        where: { id: { in: txnIds } },
        select: { id: true, unmatchedAmount: true, matchedAmount: true, status: true, notes: true },
      }),
      prisma.invoice.findMany({
        where: { id: { in: invoiceIds } },
        select: { id: true, balanceDue: true, paidAmount: true, status: true, invoiceNumber: true, notes: true },
      }),
    ]);

    const txnMap = new Map(txnsData.map(t => [t.id, t]));
    const invoiceMap = new Map(invoicesData.map(i => [i.id, i]));

    // Filter to valid matches only
    const validMatches = data.matches.filter(m => {
      const txn = txnMap.get(m.bankTransactionId);
      const invoice = invoiceMap.get(m.invoiceId);
      if (!txn) { errors.push(`Bank txn ${m.bankTransactionId.slice(0, 8)} not found`); return false; }
      if (!invoice) { errors.push(`Invoice ${m.invoiceId.slice(0, 8)} not found`); return false; }
      if (invoice.status === 'cancelled') { errors.push(`Invoice ${invoice.invoiceNumber ?? m.invoiceId.slice(0, 8)} is cancelled`); return false; }
      if (m.amount > txn.unmatchedAmount + 0.01) { errors.push(`Amount exceeds unmatched balance for txn ${m.bankTransactionId.slice(0, 8)}`); return false; }
      if (m.amount > invoice.balanceDue + 0.01) { errors.push(`Amount exceeds balance due for invoice ${invoice.invoiceNumber ?? m.invoiceId.slice(0, 8)}`); return false; }
      return true;
    });

    if (validMatches.length === 0) {
      return { success: false as const, matched: 0, errors: errors.length > 0 ? errors : ['No valid matches to apply'] };
    }

    // Apply all in one transaction
    await prisma.$transaction(async (tx) => {
      for (const match of validMatches) {
        const txn = txnMap.get(match.bankTransactionId)!;
        const invoice = invoiceMap.get(match.invoiceId)!;

        await tx.allocation.create({
          data: {
            bankTransactionId: match.bankTransactionId,
            invoiceId: match.invoiceId,
            amount: match.amount,
            notes: 'Auto-matched',
            matchedById: userId,
          },
        });

        const newTxnMatched = txn.matchedAmount + match.amount;
        const newTxnUnmatched = txn.unmatchedAmount - match.amount;
        await tx.bankTransaction.update({
          where: { id: match.bankTransactionId },
          data: { matchedAmount: newTxnMatched, unmatchedAmount: Math.max(0, newTxnUnmatched) },
        });

        // Update in-memory for subsequent matches referencing same txn/invoice
        txn.matchedAmount = newTxnMatched;
        txn.unmatchedAmount = Math.max(0, newTxnUnmatched);

        const newInvoicePaid = invoice.paidAmount + match.amount;
        const newInvoiceBalance = invoice.balanceDue - match.amount;
        const newStatus = newInvoiceBalance <= 0.01 ? 'paid' : 'partially_paid';
        await tx.invoice.update({
          where: { id: match.invoiceId },
          data: { paidAmount: newInvoicePaid, balanceDue: Math.max(0, newInvoiceBalance), status: newStatus },
        });

        // Inherit invoice notes to bank txn if bank txn has no notes
        if (!txn.notes && invoice.notes) {
          await tx.bankTransaction.update({
            where: { id: match.bankTransactionId },
            data: { notes: invoice.notes },
          });
          txn.notes = invoice.notes;
        }

        invoice.paidAmount = newInvoicePaid;
        invoice.balanceDue = Math.max(0, newInvoiceBalance);
      }
    });

    return { success: true as const, matched: validMatches.length, errors };
  });
