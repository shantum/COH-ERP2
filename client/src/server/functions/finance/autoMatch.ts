/**
 * Finance Auto-Match — Suggest and apply payment-invoice matches
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
// AUTO-MATCH PAYMENTS TO INVOICES
// ============================================

/**
 * Score a payment-invoice pair for auto-matching.
 * Amount score (0-100) + Date score (0-30) = total confidence.
 */
function scoreMatch(
  paymentAmount: number,
  invoiceBalance: number,
  paymentDate: Date,
  invoiceDate: Date,
): { score: number; confidence: 'high' | 'medium' | null; amountDiff: number; daysDiff: number } {
  const amountDiff = Math.abs(paymentAmount - invoiceBalance);
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
    Math.floor((paymentDate.getTime() - invoiceDate.getTime()) / (1000 * 60 * 60 * 24))
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

    // Find parties with BOTH unmatched outgoing payments AND unpaid payable invoices
    // Capped at 500 each to prevent unbounded memory usage on large datasets
    const [payments, invoices] = await Promise.all([
      prisma.payment.findMany({
        where: {
          direction: 'outgoing',
          status: 'confirmed',
          unmatchedAmount: { gt: 0.01 },
          partyId: { not: null },
        },
        select: {
          id: true, amount: true, unmatchedAmount: true, paymentDate: true,
          referenceNumber: true, method: true, partyId: true,
        },
        orderBy: { paymentDate: 'desc' },
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
    const paymentsByParty = new Map<string, typeof payments>();
    for (const p of payments) {
      if (!p.partyId) continue;
      const arr = paymentsByParty.get(p.partyId) ?? [];
      arr.push(p);
      paymentsByParty.set(p.partyId, arr);
    }

    const invoicesByParty = new Map<string, typeof invoices>();
    for (const inv of invoices) {
      if (!inv.partyId) continue;
      const arr = invoicesByParty.get(inv.partyId) ?? [];
      arr.push(inv);
      invoicesByParty.set(inv.partyId, arr);
    }

    // Find parties that appear in both maps
    const commonPartyIds = [...paymentsByParty.keys()].filter(id => invoicesByParty.has(id));
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
        payment: { id: string; amount: number; unmatchedAmount: number; paymentDate: string; referenceNumber: string | null; method: string };
        invoice: { id: string; invoiceNumber: string | null; totalAmount: number; balanceDue: number; tdsAmount: number; invoiceDate: string; billingPeriod: string | null };
        matchAmount: number;
        confidence: 'high' | 'medium';
        score: number;
        amountDiff: number;
        daysDiff: number;
      }>;
      unmatchedPayments: number;
      unmatchedInvoices: number;
    }> = [];

    for (const partyId of commonPartyIds) {
      const partyPayments = paymentsByParty.get(partyId)!;
      const partyInvoices = invoicesByParty.get(partyId)!;

      // Score all pairs
      const scoredPairs: Array<{
        paymentIdx: number;
        invoiceIdx: number;
        score: number;
        confidence: 'high' | 'medium';
        amountDiff: number;
        daysDiff: number;
        matchAmount: number;
      }> = [];

      for (let pi = 0; pi < partyPayments.length; pi++) {
        const pay = partyPayments[pi];
        for (let ii = 0; ii < partyInvoices.length; ii++) {
          const inv = partyInvoices[ii];
          const result = scoreMatch(
            pay.unmatchedAmount, inv.balanceDue,
            pay.paymentDate, inv.invoiceDate ?? new Date(),
          );
          if (result.confidence) {
            scoredPairs.push({
              paymentIdx: pi,
              invoiceIdx: ii,
              score: result.score,
              confidence: result.confidence,
              amountDiff: result.amountDiff,
              daysDiff: result.daysDiff,
              matchAmount: Math.min(pay.unmatchedAmount, inv.balanceDue),
            });
          }
        }
      }

      // Greedy 1-to-1 assignment (highest score first)
      scoredPairs.sort((a, b) => b.score - a.score);
      const usedPayments = new Set<number>();
      const usedInvoices = new Set<number>();
      const matches: typeof suggestions[number]['matches'] = [];

      for (const pair of scoredPairs) {
        if (usedPayments.has(pair.paymentIdx) || usedInvoices.has(pair.invoiceIdx)) continue;
        usedPayments.add(pair.paymentIdx);
        usedInvoices.add(pair.invoiceIdx);

        const pay = partyPayments[pair.paymentIdx];
        const inv = partyInvoices[pair.invoiceIdx];
        matches.push({
          payment: {
            id: pay.id,
            amount: pay.amount,
            unmatchedAmount: pay.unmatchedAmount,
            paymentDate: pay.paymentDate.toISOString(),
            referenceNumber: pay.referenceNumber,
            method: pay.method,
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
          unmatchedPayments: partyPayments.length - usedPayments.size,
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

    // Pre-validate all payments and invoices exist with sufficient balances
    const paymentIds = data.matches.map(m => m.paymentId);
    const invoiceIds = data.matches.map(m => m.invoiceId);

    const [paymentsData, invoicesData] = await Promise.all([
      prisma.payment.findMany({
        where: { id: { in: paymentIds } },
        select: { id: true, unmatchedAmount: true, matchedAmount: true, status: true },
      }),
      prisma.invoice.findMany({
        where: { id: { in: invoiceIds } },
        select: { id: true, balanceDue: true, paidAmount: true, status: true, invoiceNumber: true },
      }),
    ]);

    const paymentMap = new Map(paymentsData.map(p => [p.id, p]));
    const invoiceMap = new Map(invoicesData.map(i => [i.id, i]));

    // Filter to valid matches only
    const validMatches = data.matches.filter(m => {
      const payment = paymentMap.get(m.paymentId);
      const invoice = invoiceMap.get(m.invoiceId);
      if (!payment) { errors.push(`Payment ${m.paymentId.slice(0, 8)} not found`); return false; }
      if (!invoice) { errors.push(`Invoice ${m.invoiceId.slice(0, 8)} not found`); return false; }
      if (payment.status === 'cancelled') { errors.push(`Payment ${m.paymentId.slice(0, 8)} is cancelled`); return false; }
      if (invoice.status === 'cancelled') { errors.push(`Invoice ${invoice.invoiceNumber ?? m.invoiceId.slice(0, 8)} is cancelled`); return false; }
      if (m.amount > payment.unmatchedAmount + 0.01) { errors.push(`Amount exceeds unmatched balance for payment ${m.paymentId.slice(0, 8)}`); return false; }
      if (m.amount > invoice.balanceDue + 0.01) { errors.push(`Amount exceeds balance due for invoice ${invoice.invoiceNumber ?? m.invoiceId.slice(0, 8)}`); return false; }
      return true;
    });

    if (validMatches.length === 0) {
      return { success: false as const, matched: 0, errors: errors.length > 0 ? errors : ['No valid matches to apply'] };
    }

    // Apply all in one transaction
    await prisma.$transaction(async (tx) => {
      for (const match of validMatches) {
        const payment = paymentMap.get(match.paymentId)!;
        const invoice = invoiceMap.get(match.invoiceId)!;

        await tx.allocation.create({
          data: {
            paymentId: match.paymentId,
            invoiceId: match.invoiceId,
            amount: match.amount,
            notes: 'Auto-matched',
            matchedById: userId,
          },
        });

        const newPaymentMatched = payment.matchedAmount + match.amount;
        const newPaymentUnmatched = payment.unmatchedAmount - match.amount;
        await tx.payment.update({
          where: { id: match.paymentId },
          data: { matchedAmount: newPaymentMatched, unmatchedAmount: Math.max(0, newPaymentUnmatched) },
        });

        // Update in-memory for subsequent matches referencing same payment/invoice
        payment.matchedAmount = newPaymentMatched;
        payment.unmatchedAmount = Math.max(0, newPaymentUnmatched);

        const newInvoicePaid = invoice.paidAmount + match.amount;
        const newInvoiceBalance = invoice.balanceDue - match.amount;
        const newStatus = newInvoiceBalance <= 0.01 ? 'paid' : 'partially_paid';
        await tx.invoice.update({
          where: { id: match.invoiceId },
          data: { paidAmount: newInvoicePaid, balanceDue: Math.max(0, newInvoiceBalance), status: newStatus },
        });

        invoice.paidAmount = newInvoicePaid;
        invoice.balanceDue = Math.max(0, newInvoiceBalance);
      }
    });

    return { success: true as const, matched: validMatches.length, errors };
  });
