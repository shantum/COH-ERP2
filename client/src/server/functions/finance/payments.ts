/**
 * Finance Payments — List, match, unmatch (now backed by BankTransaction)
 */

'use server';

import { createServerFn } from '@tanstack/react-start';
import { z } from 'zod';
import { authMiddleware } from '../../middleware/auth';
import { getPrisma } from '@coh/shared/services/db';
import {
  MatchAllocationSchema,
  ListPaymentsInput,
} from '@coh/shared/schemas/finance';

// ============================================
// PAYMENTS — LIST (backed by BankTransaction)
// ============================================

export const listPayments = createServerFn({ method: 'POST' })
  .middleware([authMiddleware])
  .inputValidator((input: unknown) => ListPaymentsInput.parse(input))
  .handler(async ({ data }) => {
    const prisma = await getPrisma();
    const { direction, bank, matchStatus, paymentCategory, search, page = 1, limit = 50 } = data ?? {};
    const skip = (page - 1) * limit;

    const where: Record<string, unknown> = {};
    if (matchStatus === 'skipped') {
      where.status = 'skipped';
    } else {
      where.status = { in: ['posted', 'legacy_posted'] };
      if (matchStatus === 'unmatched') where.unmatchedAmount = { gt: 0.01 };
      if (matchStatus === 'matched') where.unmatchedAmount = { lte: 0.01 };
    }
    if (direction) where.direction = direction;
    if (bank) where.bank = bank;
    const andClauses: Record<string, unknown>[] = [];
    if (paymentCategory) {
      andClauses.push({
        OR: [
          { party: { category: paymentCategory } },
          { category: paymentCategory },
        ],
      });
    }
    if (search) {
      andClauses.push({
        OR: [
          { reference: { contains: search, mode: 'insensitive' } },
          { utr: { contains: search, mode: 'insensitive' } },
          { counterpartyName: { contains: search, mode: 'insensitive' } },
          { party: { name: { contains: search, mode: 'insensitive' } } },
          { notes: { contains: search, mode: 'insensitive' } },
          { narration: { contains: search, mode: 'insensitive' } },
        ],
      });
    }
    if (data?.dateFrom) where.txnDate = { ...(where.txnDate as object ?? {}), gte: new Date(data.dateFrom) };
    if (data?.dateTo) where.txnDate = { ...(where.txnDate as object ?? {}), lte: new Date(data.dateTo + 'T23:59:59') };
    if (andClauses.length) where.AND = andClauses;

    const [payments, total] = await Promise.all([
      prisma.bankTransaction.findMany({
        where,
        select: {
          id: true,
          reference: true,
          utr: true,
          direction: true,
          bank: true,
          amount: true,
          matchedAmount: true,
          unmatchedAmount: true,
          txnDate: true,
          period: true,
          debitAccountCode: true,
          driveUrl: true,
          fileName: true,
          notes: true,
          narration: true,
          counterpartyName: true,
          category: true,
          status: true,
          skipReason: true,
          createdAt: true,
          party: {
            select: {
              id: true,
              name: true,
              category: true,
              gstin: true,
              tdsApplicable: true,
              tdsRate: true,
              tdsSection: true,
              transactionType: { select: { name: true, expenseCategory: true, defaultGstRate: true } },
            },
          },
          allocations: {
            select: {
              invoice: {
                select: {
                  id: true,
                  invoiceNumber: true,
                  invoiceDate: true,
                  billingPeriod: true,
                  driveUrl: true,
                  notes: true,
                },
              },
            },
            take: 3,
          },
          _count: { select: { allocations: true } },
        },
        orderBy: { txnDate: 'desc' },
        skip,
        take: limit,
      }),
      prisma.bankTransaction.count({ where }),
    ]);

    return { success: true as const, payments, total, page, limit };
  });

// ============================================
// PAYMENT — UPDATE NOTES
// ============================================

const updatePaymentNotesInput = z.object({
  id: z.string().uuid(),
  notes: z.string().nullable(),
});

export const updatePaymentNotes = createServerFn({ method: 'POST' })
  .middleware([authMiddleware])
  .inputValidator((input: unknown) => updatePaymentNotesInput.parse(input))
  .handler(async ({ data }) => {
    const prisma = await getPrisma();
    const bt = await prisma.bankTransaction.findUnique({ where: { id: data.id }, select: { id: true } });
    if (!bt) return { success: false as const, error: 'Bank transaction not found' };
    await prisma.bankTransaction.update({
      where: { id: data.id },
      data: { notes: data.notes },
    });
    return { success: true as const };
  });

// ============================================
// MATCH BANK TRANSACTION TO INVOICE
// ============================================

export const matchPaymentToInvoice = createServerFn({ method: 'POST' })
  .middleware([authMiddleware])
  .inputValidator((input: unknown) => MatchAllocationSchema.parse(input))
  .handler(async ({ data, context }) => {
    const prisma = await getPrisma();
    const userId = context.user.id;

    return prisma.$transaction(async (tx) => {
      // Read fresh state INSIDE transaction to prevent TOCTOU race
      const [bankTxn, invoice] = await Promise.all([
        tx.bankTransaction.findUnique({ where: { id: data.bankTransactionId }, select: { id: true, unmatchedAmount: true, status: true, notes: true } }),
        tx.invoice.findUnique({ where: { id: data.invoiceId }, select: { id: true, balanceDue: true, paidAmount: true, status: true, notes: true } }),
      ]);

      if (!bankTxn) throw new Error('Bank transaction not found');
      if (!invoice) throw new Error('Invoice not found');
      if (invoice.status === 'cancelled') throw new Error('Invoice is cancelled');
      if (data.amount > bankTxn.unmatchedAmount + 0.01) throw new Error('Amount exceeds unmatched balance');
      if (data.amount > invoice.balanceDue + 0.01) throw new Error('Amount exceeds invoice balance due');

      await tx.allocation.create({
        data: {
          bankTransactionId: data.bankTransactionId,
          invoiceId: data.invoiceId,
          amount: data.amount,
          notes: data.notes ?? null,
          matchedById: userId,
        },
      });

      await tx.bankTransaction.update({
        where: { id: data.bankTransactionId },
        data: { matchedAmount: { increment: data.amount }, unmatchedAmount: { decrement: data.amount } },
      });

      const newInvoiceBalance = invoice.balanceDue - data.amount;
      const newStatus = newInvoiceBalance <= 0.01 ? 'paid' : 'partially_paid';
      await tx.invoice.update({
        where: { id: data.invoiceId },
        data: { paidAmount: { increment: data.amount }, balanceDue: { decrement: data.amount }, status: newStatus },
      });

      // Inherit invoice notes to bank txn if bank txn has no notes
      if (!bankTxn.notes && invoice.notes) {
        await tx.bankTransaction.update({
          where: { id: data.bankTransactionId },
          data: { notes: invoice.notes },
        });
      }

      return { success: true as const };
    }).catch((error: unknown) => {
      console.error('[finance] matchPaymentToInvoice failed:', error);
      const message = error instanceof Error ? error.message : 'Unknown error';
      return { success: false as const, error: message };
    });
  });

// ============================================
// UNMATCH BANK TRANSACTION FROM INVOICE
// ============================================

const unmatchInput = z.object({
  bankTransactionId: z.string().uuid(),
  invoiceId: z.string().uuid(),
});

export const unmatchPayment = createServerFn({ method: 'POST' })
  .middleware([authMiddleware])
  .inputValidator((input: unknown) => unmatchInput.parse(input))
  .handler(async ({ data }) => {
    const prisma = await getPrisma();

    return prisma.$transaction(async (tx) => {
      // Read inside transaction to prevent TOCTOU race
      const match = await tx.allocation.findUnique({
        where: { bankTransactionId_invoiceId: { bankTransactionId: data.bankTransactionId, invoiceId: data.invoiceId } },
      });

      if (!match) throw new Error('Match not found');

      await tx.allocation.delete({
        where: { bankTransactionId_invoiceId: { bankTransactionId: data.bankTransactionId, invoiceId: data.invoiceId } },
      });

      await tx.bankTransaction.update({
        where: { id: data.bankTransactionId },
        data: {
          matchedAmount: { decrement: match.amount },
          unmatchedAmount: { increment: match.amount },
        },
      });

      const invoice = await tx.invoice.findUnique({
        where: { id: data.invoiceId },
        select: { paidAmount: true, balanceDue: true },
      });

      if (invoice) {
        const newPaid = invoice.paidAmount - match.amount;
        const newStatus = newPaid <= 0.01 ? 'confirmed' : 'partially_paid';
        await tx.invoice.update({
          where: { id: data.invoiceId },
          data: {
            paidAmount: { decrement: match.amount },
            balanceDue: { increment: match.amount },
            status: newStatus,
          },
        });
      }

      return { success: true as const };
    }).catch((error: unknown) => {
      console.error('[finance] unmatchPayment failed:', error);
      const message = error instanceof Error ? error.message : 'Unknown error';
      return { success: false as const, error: message };
    });
  });


// ============================================
// FIND UNMATCHED BANK TRANSACTIONS (for invoice linking)
// ============================================

const findUnmatchedPaymentsInput = z.object({
  partyId: z.string().uuid().optional(),
  partyName: z.string().optional(),
  amountMin: z.number().optional(),
  amountMax: z.number().optional(),
}).optional();

export const findUnmatchedPayments = createServerFn({ method: 'POST' })
  .middleware([authMiddleware])
  .inputValidator((input: unknown) => findUnmatchedPaymentsInput.parse(input))
  .handler(async ({ data }) => {
    const prisma = await getPrisma();
    const { partyId, partyName, amountMin, amountMax } = data ?? {};

    const where: Record<string, unknown> = {
      direction: 'debit',
      status: { in: ['posted', 'legacy_posted'] },
      unmatchedAmount: { gt: 0.01 },
    };

    if (partyId) {
      where.partyId = partyId;
    } else if (partyName) {
      where.party = { name: { contains: partyName, mode: 'insensitive' } };
    }
    if (amountMin !== undefined || amountMax !== undefined) {
      where.amount = {
        ...(amountMin !== undefined ? { gte: amountMin } : {}),
        ...(amountMax !== undefined ? { lte: amountMax } : {}),
      };
    }

    const payments = await prisma.bankTransaction.findMany({
      where,
      select: {
        id: true,
        amount: true,
        unmatchedAmount: true,
        txnDate: true,
        reference: true,
        utr: true,
        bank: true,
        notes: true,
        debitAccountCode: true,
        party: { select: { id: true, name: true } },
      },
      orderBy: { txnDate: 'desc' },
      take: 20,
    });

    return { success: true as const, payments };
  });

// ============================================
// FIND UNPAID INVOICES (for manual payment linking)
// ============================================

const findUnpaidInvoicesInput = z.object({
  partyId: z.string().uuid().optional(),
  search: z.string().optional(),
}).optional();

export const findUnpaidInvoices = createServerFn({ method: 'POST' })
  .middleware([authMiddleware])
  .inputValidator((input: unknown) => findUnpaidInvoicesInput.parse(input))
  .handler(async ({ data }) => {
    const prisma = await getPrisma();
    const { partyId, search } = data ?? {};

    const where: Record<string, unknown> = {
      status: { in: ['confirmed', 'partially_paid'] },
      balanceDue: { gt: 0.01 },
    };

    if (partyId) where.partyId = partyId;
    if (search) {
      where.OR = [
        { invoiceNumber: { contains: search, mode: 'insensitive' } },
        { party: { name: { contains: search, mode: 'insensitive' } } },
      ];
    }

    const invoices = await prisma.invoice.findMany({
      where,
      select: {
        id: true, invoiceNumber: true, type: true, category: true,
        totalAmount: true, balanceDue: true, tdsAmount: true,
        invoiceDate: true, billingPeriod: true,
        party: { select: { id: true, name: true } },
      },
      orderBy: [{ invoiceDate: 'desc' }],
      take: 50,
    });

    return { success: true as const, invoices };
  });
