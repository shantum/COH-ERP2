/**
 * Finance Invoices — CRUD, confirm, cancel
 */

'use server';

import { createServerFn } from '@tanstack/react-start';
import { z } from 'zod';
import { authMiddleware } from '../../middleware/auth';
import { getPrisma } from '@coh/shared/services/db';
import {
  CreateInvoiceSchema,
  UpdateInvoiceSchema,
  ListInvoicesInput,
  generatePaymentNarration,
} from '@coh/shared/schemas/finance';
import { dateToPeriod, applyPeriodOffset } from '@coh/shared';

// ============================================
// INVOICE — LIST
// ============================================

export const listInvoices = createServerFn({ method: 'POST' })
  .middleware([authMiddleware])
  .inputValidator((input: unknown) => ListInvoicesInput.parse(input))
  .handler(async ({ data }) => {
    const prisma = await getPrisma();
    const { type, status, category, search, page = 1, limit = 50 } = data ?? {};
    const skip = (page - 1) * limit;

    const where: Record<string, unknown> = {};
    if (type) where.type = type;
    if (status) where.status = status;
    if (category) where.category = category;
    if (search) {
      where.OR = [
        { invoiceNumber: { contains: search, mode: 'insensitive' } },
        { party: { name: { contains: search, mode: 'insensitive' } } },
        { notes: { contains: search, mode: 'insensitive' } },
      ];
    }
    if (data?.dateFrom) where.invoiceDate = { ...(where.invoiceDate as object ?? {}), gte: new Date(data.dateFrom) };
    if (data?.dateTo) where.invoiceDate = { ...(where.invoiceDate as object ?? {}), lte: new Date(data.dateTo + 'T23:59:59') };

    const [invoices, total] = await Promise.all([
      prisma.invoice.findMany({
        where,
        select: {
          id: true,
          invoiceNumber: true,
          type: true,
          category: true,
          status: true,
          invoiceDate: true,
          dueDate: true,
          totalAmount: true,
          subtotal: true,
          gstAmount: true,
          tdsAmount: true,
          paidAmount: true,
          balanceDue: true,
          billingPeriod: true,
          notes: true,
          driveUrl: true,
          createdAt: true,
          party: { select: { id: true, name: true, bankAccountName: true, bankAccountNumber: true, bankIfsc: true, phone: true, email: true } },
          customer: { select: { id: true, email: true, firstName: true, lastName: true } },
          _count: { select: { lines: true, allocations: true } },
        },
        orderBy: [{ invoiceDate: 'desc' }, { createdAt: 'desc' }],
        skip,
        take: limit,
      }),
      prisma.invoice.count({ where }),
    ]);

    return { success: true as const, invoices, total, page, limit };
  });

// ============================================
// INVOICE — GET SINGLE
// ============================================

const getInvoiceInput = z.object({ id: z.string().uuid() });

export const getInvoice = createServerFn({ method: 'GET' })
  .middleware([authMiddleware])
  .inputValidator((input: unknown) => getInvoiceInput.parse(input))
  .handler(async ({ data }) => {
    const prisma = await getPrisma();

    const invoice = await prisma.invoice.findUnique({
      where: { id: data.id },
      include: {
        lines: true,
        allocations: {
          include: {
            payment: {
              select: { id: true, referenceNumber: true, method: true, amount: true, paymentDate: true },
            },
            matchedBy: { select: { id: true, name: true } },
          },
        },
        party: { select: { id: true, name: true, tdsApplicable: true, tdsSection: true, tdsRate: true, bankAccountName: true, bankAccountNumber: true, bankIfsc: true } },
        customer: { select: { id: true, email: true, firstName: true, lastName: true } },
        createdBy: { select: { id: true, name: true } },
      },
    });

    if (!invoice) return { success: false as const, error: 'Invoice not found' };

    // Strip file binary from response
    const { fileData: _, ...rest } = invoice;
    return { success: true as const, invoice: rest };
  });

// ============================================
// INVOICE — CREATE (draft)
// ============================================

export const createInvoice = createServerFn({ method: 'POST' })
  .middleware([authMiddleware])
  .inputValidator((input: unknown) => CreateInvoiceSchema.parse(input))
  .handler(async ({ data, context }) => {
    const prisma = await getPrisma();
    const userId = context.user.id;

    const invoice = await prisma.invoice.create({
      data: {
        invoiceNumber: data.invoiceNumber ?? null,
        type: data.type,
        category: data.category,
        status: 'draft',
        invoiceDate: data.invoiceDate ? new Date(data.invoiceDate) : null,
        dueDate: data.dueDate ? new Date(data.dueDate) : null,
        billingPeriod: data.billingPeriod ?? null,
        ...(data.partyId ? { partyId: data.partyId } : {}),
        ...(data.customerId ? { customerId: data.customerId } : {}),
        subtotal: data.subtotal ?? null,
        gstAmount: data.gstAmount ?? null,
        totalAmount: data.totalAmount,
        balanceDue: data.totalAmount,
        ...(data.orderId ? { orderId: data.orderId } : {}),
        ...(data.fabricInvoiceId ? { fabricInvoiceId: data.fabricInvoiceId } : {}),
        notes: data.notes ?? null,
        createdById: userId,
        ...(data.lines && data.lines.length > 0
          ? {
              lines: {
                create: data.lines.map((l) => ({
                  description: l.description ?? null,
                  hsnCode: l.hsnCode ?? null,
                  qty: l.qty ?? null,
                  unit: l.unit ?? null,
                  rate: l.rate ?? null,
                  amount: l.amount ?? null,
                  gstPercent: l.gstPercent ?? null,
                  gstAmount: l.gstAmount ?? null,
                })),
              },
            }
          : {}),
      },
      select: { id: true, invoiceNumber: true, status: true, totalAmount: true },
    });

    return { success: true as const, invoice };
  });

// ============================================
// INVOICE — UPDATE (draft only)
// ============================================

export const updateInvoice = createServerFn({ method: 'POST' })
  .middleware([authMiddleware])
  .inputValidator((input: unknown) => UpdateInvoiceSchema.parse(input))
  .handler(async ({ data }) => {
    const prisma = await getPrisma();

    const existing = await prisma.invoice.findUnique({
      where: { id: data.id },
      select: { status: true },
    });
    if (!existing) return { success: false as const, error: 'Invoice not found' };
    if (existing.status !== 'draft') return { success: false as const, error: 'Can only edit draft invoices' };

    const { id, ...updateData } = data;
    const updates: Record<string, unknown> = {};

    if (updateData.invoiceNumber !== undefined) updates.invoiceNumber = updateData.invoiceNumber;
    if (updateData.category !== undefined) updates.category = updateData.category;
    if (updateData.invoiceDate !== undefined) updates.invoiceDate = updateData.invoiceDate ? new Date(updateData.invoiceDate) : null;
    if (updateData.dueDate !== undefined) updates.dueDate = updateData.dueDate ? new Date(updateData.dueDate) : null;
    if (updateData.partyId !== undefined) updates.partyId = updateData.partyId;
    if (updateData.customerId !== undefined) updates.customerId = updateData.customerId;
    if (updateData.subtotal !== undefined) updates.subtotal = updateData.subtotal;
    if (updateData.gstAmount !== undefined) updates.gstAmount = updateData.gstAmount;
    if (updateData.totalAmount !== undefined) {
      updates.totalAmount = updateData.totalAmount;
      updates.balanceDue = updateData.totalAmount; // Reset since still draft
    }
    if (updateData.notes !== undefined) updates.notes = updateData.notes;
    if (updateData.billingPeriod !== undefined) updates.billingPeriod = updateData.billingPeriod;

    await prisma.invoice.update({ where: { id }, data: updates });

    return { success: true as const };
  });

// ============================================
// INVOICE — CONFIRM (draft -> confirmed)
// ============================================

const confirmInvoiceInput = z.object({
  id: z.string().uuid(),
  linkedPaymentId: z.string().uuid().optional(),
});

export const confirmInvoice = createServerFn({ method: 'POST' })
  .middleware([authMiddleware])
  .inputValidator((input: unknown) => confirmInvoiceInput.parse(input))
  .handler(async ({ data, context }) => {
    const prisma = await getPrisma();
    const userId = context.user.id;

    const invoice = await prisma.invoice.findUnique({
      where: { id: data.id },
      select: { id: true, type: true, category: true, status: true, totalAmount: true, gstAmount: true, subtotal: true, invoiceNumber: true, partyId: true, invoiceDate: true, billingPeriod: true },
    });

    if (!invoice) return { success: false as const, error: 'Invoice not found' };
    if (invoice.status !== 'draft') return { success: false as const, error: 'Can only confirm draft invoices' };

    // Fetch party details for TDS + TransactionType (advance-clearing vendors + expense account)
    let tdsAmount = 0;
    let expenseAccountOverride: string | null = null;
    let partyName: string | null = null;
    let periodOffset: number | null = null;
    if (invoice.type === 'payable' && invoice.partyId) {
      const party = await prisma.party.findUnique({
        where: { id: invoice.partyId },
        select: { name: true, tdsApplicable: true, tdsRate: true, billingPeriodOffsetMonths: true, transactionType: { select: { debitAccountCode: true } } },
      });
      partyName = party?.name ?? null;
      periodOffset = party?.billingPeriodOffsetMonths ?? null;
      if (party?.tdsApplicable && party.tdsRate && party.tdsRate > 0) {
        const subtotal = invoice.totalAmount - (invoice.gstAmount ?? 0);
        tdsAmount = Math.round(subtotal * (party.tdsRate / 100) * 100) / 100;
      }
      // Use TransactionType's debit account as expense account (if not advance-clearing)
      if (party?.transactionType?.debitAccountCode && party.transactionType.debitAccountCode !== 'ADVANCES_GIVEN') {
        expenseAccountOverride = party.transactionType.debitAccountCode;
      }
    }

    // ---- LINKED PAYMENT PATH (already-paid bill) ----
    if (data.linkedPaymentId && invoice.type === 'payable') {
      return confirmInvoiceWithLinkedPayment(prisma, invoice, data.linkedPaymentId, tdsAmount, userId, expenseAccountOverride, partyName, periodOffset);
    }

    // ---- NORMAL AP PATH (invoice first, pay later) ----
    const invoiceEntryDate = invoice.invoiceDate ? new Date(invoice.invoiceDate) : new Date();
    let derivedPeriod = dateToPeriod(invoiceEntryDate);
    if (periodOffset) derivedPeriod = applyPeriodOffset(derivedPeriod, periodOffset);
    await prisma.invoice.update({
      where: { id: invoice.id },
      data: {
        status: 'confirmed',
        ...(tdsAmount > 0 ? { tdsAmount, balanceDue: invoice.totalAmount - tdsAmount } : {}),
        // Default billingPeriod from invoiceDate (with party offset) if not set
        ...(!invoice.billingPeriod ? { billingPeriod: derivedPeriod } : {}),
      },
    });

    return { success: true as const };
  });

/**
 * Confirm an invoice and link it to an existing payment.
 * Creates Allocation (payment -> invoice match), updates payment matched/unmatched amounts,
 * and marks invoice as paid.
 *
 * The match amount uses the net payable (totalAmount - tdsAmount) because TDS is withheld
 * and never paid to the vendor. So payment.amount should roughly equal matchAmount.
 */
async function confirmInvoiceWithLinkedPayment(
  prisma: Awaited<ReturnType<typeof getPrisma>>,
  invoice: { id: string; category: string; totalAmount: number; gstAmount: number | null; subtotal: number | null; invoiceNumber: string | null; partyId: string | null; invoiceDate: Date | null; billingPeriod: string | null },
  paymentId: string,
  tdsAmount: number,
  userId: string,
  _expenseAccountOverride: string | null = null,
  partyName: string | null = null,
  periodOffset: number | null = null,
) {
  // The amount the vendor was actually paid (total minus TDS withheld)
  const matchAmount = invoice.totalAmount - tdsAmount;

  const payment = await prisma.payment.findUnique({
    where: { id: paymentId },
    select: {
      id: true, amount: true, unmatchedAmount: true, matchedAmount: true,
      status: true, paymentDate: true, debitAccountCode: true, notes: true,
    },
  });
  if (!payment) throw new Error('Payment not found');
  if (payment.status === 'cancelled') throw new Error('Payment is cancelled');
  if (payment.unmatchedAmount < matchAmount - 0.01) throw new Error('Payment unmatched amount is less than invoice net payable');

  // Auto-generate narration if payment doesn't have one
  let narration: string | null = null;
  if (!payment.notes) {
    narration = generatePaymentNarration({
      partyName,
      category: invoice.category,
      invoiceNumber: invoice.invoiceNumber,
      billingPeriod: invoice.billingPeriod,
    });
  }

  // Use a transaction to keep all writes atomic
  return prisma.$transaction(async (tx) => {
    // Create allocation (payment -> invoice match)
    await tx.allocation.create({
      data: {
        paymentId,
        invoiceId: invoice.id,
        amount: matchAmount,
        notes: 'Auto-linked on invoice confirm',
        matchedById: userId,
      },
    });

    // Update Payment: matched/unmatched amounts + narration
    await tx.payment.update({
      where: { id: paymentId },
      data: {
        matchedAmount: payment.matchedAmount + matchAmount,
        unmatchedAmount: Math.max(0, payment.unmatchedAmount - matchAmount),
        ...(narration ? { notes: narration } : {}),
      },
    });

    // Update Invoice: mark as paid
    await tx.invoice.update({
      where: { id: invoice.id },
      data: {
        status: 'paid',
        paidAmount: matchAmount,
        balanceDue: 0,
        ...(tdsAmount > 0 ? { tdsAmount } : {}),
        // Default billingPeriod from invoiceDate (with party offset) if not set
        ...(!invoice.billingPeriod ? {
          billingPeriod: (() => {
            const base = dateToPeriod(invoice.invoiceDate ? new Date(invoice.invoiceDate) : new Date(payment.paymentDate));
            return periodOffset ? applyPeriodOffset(base, periodOffset) : base;
          })(),
        } : {}),
      },
    });

    return { success: true as const, linked: true as const };
  });
}

/** Map invoice category -> P&L display name (cosmetic grouping for UI) */
function categoryToExpenseAccountName(category: string): string {
  switch (category) {
    case 'fabric':
    case 'trims':
    case 'packaging':
      return 'Fabric & Materials';
    case 'marketplace':
      return 'Marketplace Fees';
    case 'software':
      return 'Software & Technology';
    case 'statutory':
      return 'TDS & Statutory';
    case 'salary':
      return 'Salary & Wages';
    case 'customer_order':
      return 'Customer Orders';
    default:
      return 'Operating Expenses';
  }
}

// Re-export for use by pnl module
export { categoryToExpenseAccountName };

// ============================================
// INVOICE — CANCEL
// ============================================

const cancelInvoiceInput = z.object({ id: z.string().uuid() });

export const cancelInvoice = createServerFn({ method: 'POST' })
  .middleware([authMiddleware])
  .inputValidator((input: unknown) => cancelInvoiceInput.parse(input))
  .handler(async ({ data }) => {
    const prisma = await getPrisma();

    const invoice = await prisma.invoice.findUnique({
      where: { id: data.id },
      select: { id: true, status: true },
    });

    if (!invoice) return { success: false as const, error: 'Invoice not found' };
    if (invoice.status === 'cancelled') return { success: false as const, error: 'Already cancelled' };
    if (invoice.status === 'paid') return { success: false as const, error: 'Cannot cancel a paid invoice' };

    return prisma.$transaction(async (tx) => {
      // 1. Clean up allocations (restore unmatched amounts on linked payments)
      const matches = await tx.allocation.findMany({
        where: { invoiceId: data.id },
      });
      if (matches.length > 0) {
        for (const match of matches) {
          await tx.payment.update({
            where: { id: match.paymentId },
            data: {
              matchedAmount: { decrement: match.amount },
              unmatchedAmount: { increment: match.amount },
            },
          });
        }
        await tx.allocation.deleteMany({ where: { invoiceId: data.id } });
      }

      // 2. Cancel the invoice and reset paid amounts
      await tx.invoice.update({
        where: { id: data.id },
        data: { status: 'cancelled', paidAmount: 0, balanceDue: 0 },
      });

      return { success: true as const };
    });
  });
