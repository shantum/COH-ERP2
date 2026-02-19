/**
 * Finance Payments — List, create, match, unmatch
 */

'use server';

import { createServerFn } from '@tanstack/react-start';
import { z } from 'zod';
import { authMiddleware } from '../../middleware/auth';
import { getPrisma } from '@coh/shared/services/db';
import {
  CreateFinancePaymentSchema,
  MatchAllocationSchema,
  ListPaymentsInput,
} from '@coh/shared/schemas/finance';
import { dateToPeriod, applyPeriodOffset } from '@coh/shared';

// ============================================
// PAYMENT — LIST
// ============================================

export const listPayments = createServerFn({ method: 'POST' })
  .middleware([authMiddleware])
  .inputValidator((input: unknown) => ListPaymentsInput.parse(input))
  .handler(async ({ data }) => {
    const prisma = await getPrisma();
    const { direction, method, status, matchStatus, paymentCategory, search, page = 1, limit = 50 } = data ?? {};
    const skip = (page - 1) * limit;

    const where: Record<string, unknown> = {};
    if (direction) where.direction = direction;
    if (method) where.method = method;
    if (status) where.status = status;
    if (matchStatus === 'unmatched') where.unmatchedAmount = { gt: 0.01 };
    if (matchStatus === 'matched') where.unmatchedAmount = { lte: 0.01 };
    const andClauses: Record<string, unknown>[] = [];
    if (paymentCategory) {
      andClauses.push({
        OR: [
          { party: { category: paymentCategory } },
          { bankTransaction: { category: paymentCategory } },
        ],
      });
    }
    if (search) {
      andClauses.push({
        OR: [
          { referenceNumber: { contains: search, mode: 'insensitive' } },
          { party: { name: { contains: search, mode: 'insensitive' } } },
          { notes: { contains: search, mode: 'insensitive' } },
        ],
      });
    }
    if (data?.dateFrom) where.paymentDate = { ...(where.paymentDate as object ?? {}), gte: new Date(data.dateFrom) };
    if (data?.dateTo) where.paymentDate = { ...(where.paymentDate as object ?? {}), lte: new Date(data.dateTo + 'T23:59:59') };
    if (andClauses.length) where.AND = andClauses;

    const [payments, total] = await Promise.all([
      prisma.payment.findMany({
        where,
        select: {
          id: true,
          referenceNumber: true,
          direction: true,
          method: true,
          status: true,
          amount: true,
          matchedAmount: true,
          unmatchedAmount: true,
          paymentDate: true,
          period: true,
          debitAccountCode: true,
          driveUrl: true,
          fileName: true,
          notes: true,
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
          customer: { select: { id: true, email: true, firstName: true, lastName: true } },
          allocations: {
            select: {
              invoice: {
                select: {
                  id: true,
                  invoiceNumber: true,
                  invoiceDate: true,
                  billingPeriod: true,
                  driveUrl: true,
                },
              },
            },
            take: 3,
          },
          bankTransaction: {
            select: { category: true, bank: true, rawData: true },
          },
          _count: { select: { allocations: true } },
        },
        orderBy: { paymentDate: 'desc' },
        skip,
        take: limit,
      }),
      prisma.payment.count({ where }),
    ]);

    return { success: true as const, payments, total, page, limit };
  });

// ============================================
// PAYMENT — CREATE
// ============================================

export const createFinancePayment = createServerFn({ method: 'POST' })
  .middleware([authMiddleware])
  .inputValidator((input: unknown) => CreateFinancePaymentSchema.parse(input))
  .handler(async ({ data, context }) => {
    const prisma = await getPrisma();
    const userId = context.user.id;
    const debitAccountCode = data.direction === 'outgoing' ? 'ACCOUNTS_PAYABLE' : 'BANK_HDFC';

    // Fetch party offset for period calculation
    let periodOffset: number | null = null;
    if (data.partyId) {
      const party = await prisma.party.findUnique({ where: { id: data.partyId }, select: { billingPeriodOffsetMonths: true } });
      periodOffset = party?.billingPeriodOffsetMonths ?? null;
    }

    const paymentDate = new Date(data.paymentDate);
    let period = dateToPeriod(paymentDate);
    if (periodOffset) period = applyPeriodOffset(period, periodOffset);
    const payment = await prisma.payment.create({
      data: {
        referenceNumber: data.referenceNumber ?? null,
        direction: data.direction,
        method: data.method,
        status: 'confirmed',
        amount: data.amount,
        unmatchedAmount: data.amount,
        paymentDate,
        period,
        ...(data.partyId ? { partyId: data.partyId } : {}),
        ...(data.customerId ? { customerId: data.customerId } : {}),
        debitAccountCode,
        notes: data.notes ?? null,
        createdById: userId,
      },
      select: { id: true, referenceNumber: true, amount: true, direction: true },
    });

    return { success: true as const, payment };
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
    const payment = await prisma.payment.findUnique({ where: { id: data.id }, select: { id: true } });
    if (!payment) return { success: false as const, error: 'Payment not found' };
    await prisma.payment.update({
      where: { id: data.id },
      data: { notes: data.notes },
    });
    return { success: true as const };
  });

// ============================================
// PAYMENT — MATCH TO INVOICE
// ============================================

export const matchPaymentToInvoice = createServerFn({ method: 'POST' })
  .middleware([authMiddleware])
  .inputValidator((input: unknown) => MatchAllocationSchema.parse(input))
  .handler(async ({ data, context }) => {
    const prisma = await getPrisma();
    const userId = context.user.id;

    return prisma.$transaction(async (tx) => {
      // Read fresh state INSIDE transaction to prevent TOCTOU race
      const [payment, invoice] = await Promise.all([
        tx.payment.findUnique({ where: { id: data.paymentId }, select: { id: true, unmatchedAmount: true, status: true } }),
        tx.invoice.findUnique({ where: { id: data.invoiceId }, select: { id: true, balanceDue: true, paidAmount: true, status: true } }),
      ]);

      if (!payment) throw new Error('Payment not found');
      if (!invoice) throw new Error('Invoice not found');
      if (payment.status === 'cancelled') throw new Error('Payment is cancelled');
      if (invoice.status === 'cancelled') throw new Error('Invoice is cancelled');
      if (data.amount > payment.unmatchedAmount + 0.01) throw new Error('Amount exceeds unmatched payment balance');
      if (data.amount > invoice.balanceDue + 0.01) throw new Error('Amount exceeds invoice balance due');

      await tx.allocation.create({
        data: {
          paymentId: data.paymentId,
          invoiceId: data.invoiceId,
          amount: data.amount,
          notes: data.notes ?? null,
          matchedById: userId,
        },
      });

      await tx.payment.update({
        where: { id: data.paymentId },
        data: { matchedAmount: { increment: data.amount }, unmatchedAmount: { decrement: data.amount } },
      });

      const newInvoiceBalance = invoice.balanceDue - data.amount;
      const newStatus = newInvoiceBalance <= 0.01 ? 'paid' : 'partially_paid';
      await tx.invoice.update({
        where: { id: data.invoiceId },
        data: { paidAmount: { increment: data.amount }, balanceDue: { decrement: data.amount }, status: newStatus },
      });

      return { success: true as const };
    }).catch((error: unknown) => {
      const message = error instanceof Error ? error.message : 'Unknown error';
      return { success: false as const, error: message };
    });
  });

// ============================================
// PAYMENT — UNMATCH
// ============================================

const unmatchInput = z.object({
  paymentId: z.string().uuid(),
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
        where: { paymentId_invoiceId: { paymentId: data.paymentId, invoiceId: data.invoiceId } },
      });

      if (!match) throw new Error('Match not found');

      await tx.allocation.delete({
        where: { paymentId_invoiceId: { paymentId: data.paymentId, invoiceId: data.invoiceId } },
      });

      await tx.payment.update({
        where: { id: data.paymentId },
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
      const message = error instanceof Error ? error.message : 'Unknown error';
      return { success: false as const, error: message };
    });
  });


// ============================================
// FIND UNMATCHED PAYMENTS (for invoice linking)
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
      direction: 'outgoing',
      status: 'confirmed',
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

    const payments = await prisma.payment.findMany({
      where,
      select: {
        id: true,
        amount: true,
        unmatchedAmount: true,
        paymentDate: true,
        referenceNumber: true,
        method: true,
        notes: true,
        debitAccountCode: true,
        party: { select: { id: true, name: true } },
      },
      orderBy: { paymentDate: 'desc' },
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
