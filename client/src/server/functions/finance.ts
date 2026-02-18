/**
 * Finance Server Functions
 *
 * Invoice CRUD, payment CRUD, party management, and transaction types.
 * File uploads go through Express route (needs multer).
 */

'use server';

import { createServerFn } from '@tanstack/react-start';
import { z } from 'zod';
import { authMiddleware } from '../middleware/auth';
import { getPrisma } from '@coh/shared/services/db';
import type { Prisma } from '@prisma/client';
import {
  CreateInvoiceSchema,
  UpdateInvoiceSchema,
  CreateFinancePaymentSchema,
  MatchAllocationSchema,
  ListInvoicesInput,
  ListPaymentsInput,
  ListBankTransactionsInput,
  ListPartiesInput,
  UpdatePartySchema,
  CreatePartySchema,
  CreateTransactionTypeSchema,
  UpdateTransactionTypeSchema,
  BANK_STATUS_FILTER_MAP,
  type BankTxnFilterOption,
  generatePaymentNarration,
} from '@coh/shared/schemas/finance';

/**
 * Convert a Date to IST "YYYY-MM" period string.
 * IST = UTC + 5:30
 */
function dateToPeriod(date: Date): string {
  const ist = new Date(date.getTime() + (5.5 * 60 * 60 * 1000));
  return `${ist.getUTCFullYear()}-${String(ist.getUTCMonth() + 1).padStart(2, '0')}`;
}

// ============================================
// DASHBOARD / SUMMARY
// ============================================

export const getFinanceSummary = createServerFn({ method: 'GET' })
  .middleware([authMiddleware])
  .handler(async () => {
    const prisma = await getPrisma();

    const [apResult, arResult, hdfcBalance, rpxBalance, suspenseResult, payableCount, receivableCount, draftInvoices, pendingBankTxns, unmatchedPayments] = await Promise.all([
      prisma.invoice.aggregate({ where: { type: 'payable', status: { in: ['confirmed', 'partially_paid'] } }, _sum: { balanceDue: true } }),
      prisma.invoice.aggregate({ where: { type: 'receivable', status: { in: ['confirmed', 'partially_paid'] } }, _sum: { balanceDue: true } }),
      prisma.bankTransaction.findFirst({ where: { bank: 'hdfc', closingBalance: { not: null } }, orderBy: { txnDate: 'desc' }, select: { closingBalance: true, txnDate: true } }),
      prisma.bankTransaction.findFirst({ where: { bank: 'razorpayx', closingBalance: { not: null } }, orderBy: { txnDate: 'desc' }, select: { closingBalance: true, txnDate: true } }),
      prisma.payment.aggregate({ where: { direction: 'outgoing', status: 'confirmed', debitAccountCode: 'UNMATCHED_PAYMENTS', unmatchedAmount: { gt: 0.01 } }, _sum: { unmatchedAmount: true } }),
      prisma.invoice.count({ where: { type: 'payable', status: { in: ['confirmed', 'partially_paid'] } } }),
      prisma.invoice.count({ where: { type: 'receivable', status: { in: ['confirmed', 'partially_paid'] } } }),
      // Attention counts
      prisma.invoice.count({ where: { status: 'draft' } }),
      prisma.bankTransaction.count({ where: { status: { in: ['imported', 'categorized'] } } }),
      prisma.payment.count({ where: { status: 'confirmed', unmatchedAmount: { gt: 0.01 } } }),
    ]);

    return {
      success: true as const,
      summary: {
        totalPayable: apResult._sum.balanceDue ?? 0,
        totalReceivable: arResult._sum.balanceDue ?? 0,
        hdfcBalance: hdfcBalance?.closingBalance ?? 0,
        hdfcBalanceDate: hdfcBalance?.txnDate ?? null,
        rpxBalance: rpxBalance?.closingBalance ?? 0,
        rpxBalanceDate: rpxBalance?.txnDate ?? null,
        suspenseBalance: suspenseResult._sum.unmatchedAmount ?? 0,
        openPayableInvoices: payableCount,
        openReceivableInvoices: receivableCount,
        draftInvoices,
        pendingBankTxns,
        unmatchedPayments,
      },
    };
  });

// ============================================
// INTEGRITY CHECKS (flag problems)
// ============================================

type Alert = { severity: 'error' | 'warning'; category: string; message: string; details?: string };

export const getFinanceAlerts = createServerFn({ method: 'GET' })
  .middleware([authMiddleware])
  .handler(async () => {
    const prisma = await getPrisma();
    const alerts: Alert[] = [];

    // 1. Overpaid invoices: matched payments exceed total
    const overpaid = await prisma.$queryRaw<Array<{
      id: string; invoice_number: string | null; counterparty: string | null;
      total_amount: number; tds_amount: number; paid_amount: number;
    }>>`
      SELECT i.id, i."invoiceNumber" AS invoice_number,
             p.name AS counterparty,
             i."totalAmount"::float AS total_amount,
             COALESCE(i."tdsAmount", 0)::float AS tds_amount,
             i."paidAmount"::float AS paid_amount
      FROM "Invoice" i
      LEFT JOIN "Party" p ON p.id = i."partyId"
      WHERE i.status != 'cancelled'
        AND i."paidAmount" > (i."totalAmount" - COALESCE(i."tdsAmount", 0) + 1)
    `;
    for (const inv of overpaid) {
      alerts.push({
        severity: 'error',
        category: 'Overpaid Invoice',
        message: `${inv.invoice_number || 'No #'} — ${inv.counterparty || 'Unknown'}: paid Rs ${Math.round(inv.paid_amount).toLocaleString('en-IN')} but only Rs ${Math.round(inv.total_amount - inv.tds_amount).toLocaleString('en-IN')} owed`,
      });
    }

    // 2. Over-allocated payments: matched amount > payment amount
    const overallocated = await prisma.$queryRaw<Array<{
      id: string; reference: string | null; counterparty: string | null;
      amount: number; matched_amount: number;
    }>>`
      SELECT pay.id, pay."referenceNumber" AS reference,
             p.name AS counterparty,
             pay.amount::float AS amount,
             pay."matchedAmount"::float AS matched_amount
      FROM "Payment" pay
      LEFT JOIN "Party" p ON p.id = pay."partyId"
      WHERE pay.status != 'cancelled'
        AND pay."matchedAmount" > pay.amount + 1
    `;
    for (const pay of overallocated) {
      alerts.push({
        severity: 'error',
        category: 'Over-allocated Payment',
        message: `${pay.reference || pay.id.slice(0, 8)} — ${pay.counterparty || 'Unknown'}: allocated Rs ${Math.round(pay.matched_amount).toLocaleString('en-IN')} but payment was only Rs ${Math.round(pay.amount).toLocaleString('en-IN')}`,
      });
    }

    // 4. (Removed) Same vendor on multiple banks — too noisy, all false positives.
    // Vendors legitimately use multiple payment channels (bank + CC, RazorpayX + HDFC).
    // Actual duplicate payments are caught by check #3 (reference number matching).

    // 5. Large unmatched payments (>50K, no invoice link)
    const unmatched = await prisma.$queryRaw<Array<{
      id: string; reference: string | null; counterparty: string | null;
      amount: number; unmatched: number; payment_date: Date;
    }>>`
      SELECT pay.id, pay."referenceNumber" AS reference,
             p.name AS counterparty,
             pay.amount::float AS amount,
             pay."unmatchedAmount"::float AS unmatched,
             pay."paymentDate" AS payment_date
      FROM "Payment" pay
      LEFT JOIN "Party" p ON p.id = pay."partyId"
      WHERE pay.status = 'confirmed'
        AND pay.direction = 'outgoing'
        AND pay."unmatchedAmount" > 50000
      ORDER BY pay."unmatchedAmount" DESC
      LIMIT 20
    `;
    for (const pay of unmatched) {
      alerts.push({
        severity: 'warning',
        category: 'Large Unmatched Payment',
        message: `${pay.counterparty || 'Unknown'}: Rs ${Math.round(pay.unmatched).toLocaleString('en-IN')} unmatched (${pay.reference || 'no ref'})`,
        details: `Paid ${new Date(pay.payment_date).toISOString().slice(0, 10)} — needs invoice link to split GST`,
      });
    }

    // 6. Confirmed invoices without billing period (payable only)
    const noPeriod = await prisma.invoice.count({
      where: {
        type: 'payable',
        status: { in: ['confirmed', 'partially_paid', 'paid'] },
        billingPeriod: null,
        category: { in: ['marketing', 'service', 'rent'] },
      },
    });
    if (noPeriod > 0) {
      alerts.push({
        severity: 'warning',
        category: 'Missing Billing Period',
        message: `${noPeriod} confirmed payable invoice(s) have no billing period set`,
      });
    }

    // 8. Suspense balance (unmatched payments in suspense)
    const suspenseTotal = await prisma.payment.aggregate({
      where: { direction: 'outgoing', status: 'confirmed', debitAccountCode: 'UNMATCHED_PAYMENTS', unmatchedAmount: { gt: 0.01 } },
      _sum: { unmatchedAmount: true },
    });
    const suspenseAmt = suspenseTotal._sum.unmatchedAmount ?? 0;
    if (suspenseAmt > 100) {
      alerts.push({
        severity: 'warning',
        category: 'Suspense Balance',
        message: `Rs ${Math.abs(Math.round(suspenseAmt)).toLocaleString('en-IN')} sitting in Unmatched Payments — needs reclassifying`,
        details: 'Create invoices and link to these payments to move money to correct accounts',
      });
    }

    // 9. Duplicate payments (same ref + similar amount + same counterparty)
    // Excludes small amounts (<100) — recurring bank charges share batch-style references (CDT*)
    const dupes = await prisma.$queryRaw<Array<{
      reference: string; counterparty: string; amount: number; cnt: number;
    }>>`
      SELECT pay."referenceNumber" AS reference,
             p.name AS counterparty,
             pay.amount::float AS amount,
             COUNT(*)::int AS cnt
      FROM "Payment" pay
      LEFT JOIN "Party" p ON p.id = pay."partyId"
      WHERE pay.status != 'cancelled'
        AND pay."referenceNumber" IS NOT NULL
        AND pay."referenceNumber" != ''
        AND pay.amount > 100
      GROUP BY pay."referenceNumber", p.name, pay.amount
      HAVING COUNT(*) > 1
      ORDER BY pay.amount DESC
      LIMIT 10
    `;
    for (const d of dupes) {
      alerts.push({
        severity: 'error',
        category: 'Duplicate Payment',
        message: `${d.counterparty || 'Unknown'}: Rs ${Math.round(d.amount).toLocaleString('en-IN')} x${d.cnt} (ref: ${d.reference})`,
      });
    }

    // 10. Invoice paidAmount out of sync with actual Allocation records
    const invoiceMismatch = await prisma.$queryRaw<Array<{
      id: string; invoice_number: string | null; counterparty: string | null;
      paid_amount: number; actual_paid: number;
    }>>`
      SELECT i.id, i."invoiceNumber" AS invoice_number,
             p.name AS counterparty,
             i."paidAmount"::float AS paid_amount,
             COALESCE(SUM(pi.amount), 0)::float AS actual_paid
      FROM "Invoice" i
      LEFT JOIN "Party" p ON p.id = i."partyId"
      LEFT JOIN "Allocation" pi ON pi."invoiceId" = i.id
      WHERE i.status != 'cancelled'
      GROUP BY i.id, i."invoiceNumber", p.name, i."paidAmount"
      HAVING ABS(i."paidAmount" - COALESCE(SUM(pi.amount), 0)) > 1
      LIMIT 10
    `;
    for (const m of invoiceMismatch) {
      alerts.push({
        severity: 'error',
        category: 'Invoice Amount Mismatch',
        message: `${m.invoice_number || 'No #'} — ${m.counterparty || 'Unknown'}: shows Rs ${Math.round(m.paid_amount).toLocaleString('en-IN')} paid but actual matches total Rs ${Math.round(m.actual_paid).toLocaleString('en-IN')}`,
      });
    }

    // 11. Payment matchedAmount out of sync
    const paymentMismatch = await prisma.$queryRaw<Array<{
      id: string; reference: string | null; counterparty: string | null;
      matched_amount: number; actual_matched: number;
    }>>`
      SELECT pay.id, pay."referenceNumber" AS reference,
             p.name AS counterparty,
             pay."matchedAmount"::float AS matched_amount,
             COALESCE(SUM(pi.amount), 0)::float AS actual_matched
      FROM "Payment" pay
      LEFT JOIN "Party" p ON p.id = pay."partyId"
      LEFT JOIN "Allocation" pi ON pi."paymentId" = pay.id
      WHERE pay.status != 'cancelled'
      GROUP BY pay.id, pay."referenceNumber", p.name, pay."matchedAmount"
      HAVING ABS(pay."matchedAmount" - COALESCE(SUM(pi.amount), 0)) > 1
      LIMIT 10
    `;
    for (const m of paymentMismatch) {
      alerts.push({
        severity: 'error',
        category: 'Payment Amount Mismatch',
        message: `${m.counterparty || 'Unknown'} (${m.reference || 'no ref'}): shows Rs ${Math.round(m.matched_amount).toLocaleString('en-IN')} matched but actual total Rs ${Math.round(m.actual_matched).toLocaleString('en-IN')}`,
      });
    }

    // 13. Old draft invoices (>30 days)
    const oldDrafts = await prisma.invoice.count({
      where: {
        status: 'draft',
        createdAt: { lt: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000) },
      },
    });
    if (oldDrafts > 0) {
      alerts.push({
        severity: 'warning',
        category: 'Stale Drafts',
        message: `${oldDrafts} invoice draft(s) older than 30 days — confirm or delete them`,
      });
    }

    return {
      success: true as const,
      alerts,
      counts: {
        errors: alerts.filter((a) => a.severity === 'error').length,
        warnings: alerts.filter((a) => a.severity === 'warning').length,
      },
    };
  });

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
          tdsAmount: true,
          paidAmount: true,
          balanceDue: true,
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
        party: { select: { id: true, name: true, tdsApplicable: true, tdsSection: true, tdsRate: true } },
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
    if (invoice.type === 'payable' && invoice.partyId) {
      const party = await prisma.party.findUnique({
        where: { id: invoice.partyId },
        select: { name: true, tdsApplicable: true, tdsRate: true, transactionType: { select: { debitAccountCode: true } } },
      });
      partyName = party?.name ?? null;
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
      return confirmInvoiceWithLinkedPayment(prisma, invoice, data.linkedPaymentId, tdsAmount, userId, expenseAccountOverride, partyName);
    }

    // ---- NORMAL AP PATH (invoice first, pay later) ----
    const invoiceEntryDate = invoice.invoiceDate ? new Date(invoice.invoiceDate) : new Date();
    await prisma.invoice.update({
      where: { id: invoice.id },
      data: {
        status: 'confirmed',
        ...(tdsAmount > 0 ? { tdsAmount, balanceDue: invoice.totalAmount - tdsAmount } : {}),
        // Default billingPeriod from invoiceDate if not set
        ...(!invoice.billingPeriod ? { billingPeriod: dateToPeriod(invoiceEntryDate) } : {}),
      },
    });

    return { success: true as const };
  });

/**
 * Confirm an invoice and link it to an existing payment.
 * Creates Allocation (payment → invoice match), updates payment matched/unmatched amounts,
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
    // Create allocation (payment → invoice match)
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
        // Default billingPeriod from invoiceDate if not set
        ...(!invoice.billingPeriod ? { billingPeriod: dateToPeriod(invoice.invoiceDate ? new Date(invoice.invoiceDate) : new Date(payment.paymentDate)) } : {}),
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

// ============================================
// PAYMENT — LIST
// ============================================

export const listPayments = createServerFn({ method: 'POST' })
  .middleware([authMiddleware])
  .inputValidator((input: unknown) => ListPaymentsInput.parse(input))
  .handler(async ({ data }) => {
    const prisma = await getPrisma();
    const { direction, method, status, matchStatus, search, page = 1, limit = 50 } = data ?? {};
    const skip = (page - 1) * limit;

    const where: Record<string, unknown> = {};
    if (direction) where.direction = direction;
    if (method) where.method = method;
    if (status) where.status = status;
    if (matchStatus === 'unmatched') where.unmatchedAmount = { gt: 0.01 };
    if (matchStatus === 'matched') where.unmatchedAmount = { lte: 0.01 };
    if (search) {
      where.OR = [
        { referenceNumber: { contains: search, mode: 'insensitive' } },
        { party: { name: { contains: search, mode: 'insensitive' } } },
        { notes: { contains: search, mode: 'insensitive' } },
      ];
    }

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

    const payment = await prisma.payment.create({
      data: {
        referenceNumber: data.referenceNumber ?? null,
        direction: data.direction,
        method: data.method,
        status: 'confirmed',
        amount: data.amount,
        unmatchedAmount: data.amount,
        paymentDate: new Date(data.paymentDate),
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

    const [payment, invoice] = await Promise.all([
      prisma.payment.findUnique({ where: { id: data.paymentId }, select: { id: true, unmatchedAmount: true, matchedAmount: true, status: true } }),
      prisma.invoice.findUnique({ where: { id: data.invoiceId }, select: { id: true, balanceDue: true, paidAmount: true, status: true } }),
    ]);

    if (!payment) return { success: false as const, error: 'Payment not found' };
    if (!invoice) return { success: false as const, error: 'Invoice not found' };
    if (payment.status === 'cancelled') return { success: false as const, error: 'Payment is cancelled' };
    if (invoice.status === 'cancelled') return { success: false as const, error: 'Invoice is cancelled' };
    if (data.amount > payment.unmatchedAmount + 0.01) return { success: false as const, error: 'Amount exceeds unmatched payment balance' };
    if (data.amount > invoice.balanceDue + 0.01) return { success: false as const, error: 'Amount exceeds invoice balance due' };

    return prisma.$transaction(async (tx) => {
      await tx.allocation.create({
        data: {
          paymentId: data.paymentId,
          invoiceId: data.invoiceId,
          amount: data.amount,
          notes: data.notes ?? null,
          matchedById: userId,
        },
      });

      const newPaymentMatched = payment.matchedAmount + data.amount;
      const newPaymentUnmatched = payment.unmatchedAmount - data.amount;
      await tx.payment.update({
        where: { id: data.paymentId },
        data: { matchedAmount: newPaymentMatched, unmatchedAmount: Math.max(0, newPaymentUnmatched) },
      });

      const newInvoicePaid = invoice.paidAmount + data.amount;
      const newInvoiceBalance = invoice.balanceDue - data.amount;
      const newStatus = newInvoiceBalance <= 0.01 ? 'paid' : 'partially_paid';
      await tx.invoice.update({
        where: { id: data.invoiceId },
        data: { paidAmount: newInvoicePaid, balanceDue: Math.max(0, newInvoiceBalance), status: newStatus },
      });

      return { success: true as const };
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

    const match = await prisma.allocation.findUnique({
      where: { paymentId_invoiceId: { paymentId: data.paymentId, invoiceId: data.invoiceId } },
    });

    if (!match) return { success: false as const, error: 'Match not found' };

    return prisma.$transaction(async (tx) => {
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
        select: { paidAmount: true, balanceDue: true, status: true },
      });

      if (invoice) {
        const newPaid = invoice.paidAmount - match.amount;
        const newBalance = invoice.balanceDue + match.amount;
        const newStatus = newPaid <= 0.01 ? 'confirmed' : 'partially_paid';
        await tx.invoice.update({
          where: { id: data.invoiceId },
          data: { paidAmount: Math.max(0, newPaid), balanceDue: newBalance, status: newStatus },
        });
      }

      return { success: true as const };
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
// MONTHLY P&L (invoice-based + inventory cost)
// ============================================

export const getMonthlyPnl = createServerFn({ method: 'GET' })
  .middleware([authMiddleware])
  .handler(async () => {
    const prisma = await getPrisma();

    // 1. Revenue: receivable invoices grouped by billing period
    const revenueRows = await prisma.$queryRaw<Array<{
      period: string; amount: number;
    }>>`
      SELECT COALESCE(i."billingPeriod", TO_CHAR(i."invoiceDate" AT TIME ZONE 'Asia/Kolkata', 'YYYY-MM')) AS period,
             SUM(i."totalAmount" - COALESCE(i."gstAmount", 0))::float AS amount
      FROM "Invoice" i
      WHERE i.type = 'receivable'
        AND i.status IN ('confirmed', 'partially_paid', 'paid')
      GROUP BY period
    `;

    // 2. Expenses: payable invoices grouped by billing period + category
    const expenseRows = await prisma.$queryRaw<Array<{
      period: string; category: string; amount: number;
    }>>`
      SELECT COALESCE(i."billingPeriod", TO_CHAR(i."invoiceDate" AT TIME ZONE 'Asia/Kolkata', 'YYYY-MM')) AS period,
             i.category,
             SUM(i."totalAmount" - COALESCE(i."gstAmount", 0))::float AS amount
      FROM "Invoice" i
      WHERE i.type = 'payable'
        AND i.status IN ('confirmed', 'partially_paid', 'paid')
      GROUP BY period, i.category
    `;

    // 3. COGS: outward sale transactions x BOM cost
    const cogsRows = await prisma.$queryRaw<Array<{
      period: string; amount: number;
    }>>`
      SELECT TO_CHAR(it."createdAt" AT TIME ZONE 'Asia/Kolkata', 'YYYY-MM') AS period,
             SUM(it.qty * COALESCE(s."bomCost", 0))::float AS amount
      FROM "InventoryTransaction" it
      JOIN "Sku" s ON s.id = it."skuId"
      WHERE it."txnType" = 'outward' AND it.reason = 'sale'
      GROUP BY period
    `;

    // 4. COGS reversal: RTO/return inward transactions
    const cogsReversalRows = await prisma.$queryRaw<Array<{
      period: string; amount: number;
    }>>`
      SELECT TO_CHAR(it."createdAt" AT TIME ZONE 'Asia/Kolkata', 'YYYY-MM') AS period,
             SUM(it.qty * COALESCE(s."bomCost", 0))::float AS amount
      FROM "InventoryTransaction" it
      JOIN "Sku" s ON s.id = it."skuId"
      WHERE it."txnType" = 'inward' AND it.reason IN ('rto_received', 'return_receipt')
      GROUP BY period
    `;

    // Build per-month P&L
    type AccountLine = { code: string; name: string; amount: number };
    const monthMap = new Map<string, {
      period: string;
      revenueLines: AccountLine[];
      cogsLines: AccountLine[];
      expenseLines: AccountLine[];
      totalRevenue: number;
      totalCogs: number;
      totalExpenses: number;
    }>();

    const getMonth = (period: string) => {
      if (!monthMap.has(period)) {
        monthMap.set(period, {
          period,
          revenueLines: [], cogsLines: [], expenseLines: [],
          totalRevenue: 0, totalCogs: 0, totalExpenses: 0,
        });
      }
      return monthMap.get(period)!;
    };

    // Revenue
    for (const row of revenueRows) {
      if (!row.period) continue;
      const month = getMonth(row.period);
      month.revenueLines.push({ code: 'SALES_REVENUE', name: 'Sales Revenue', amount: row.amount });
      month.totalRevenue += row.amount;
    }

    // Expenses by category
    for (const row of expenseRows) {
      if (!row.period) continue;
      const month = getMonth(row.period);
      const name = categoryToExpenseAccountName(row.category);
      // Merge same display name
      const existing = month.expenseLines.find(l => l.name === name);
      if (existing) {
        existing.amount += row.amount;
      } else {
        month.expenseLines.push({ code: row.category, name, amount: row.amount });
      }
      month.totalExpenses += row.amount;
    }

    // COGS
    for (const row of cogsRows) {
      if (!row.period) continue;
      const month = getMonth(row.period);
      month.cogsLines.push({ code: 'COGS', name: 'Cost of Goods Sold', amount: row.amount });
      month.totalCogs += row.amount;
    }

    // COGS reversal (subtract from COGS)
    for (const row of cogsReversalRows) {
      if (!row.period) continue;
      const month = getMonth(row.period);
      const existing = month.cogsLines.find(l => l.code === 'COGS');
      if (existing) {
        existing.amount -= row.amount;
      } else {
        month.cogsLines.push({ code: 'COGS', name: 'Cost of Goods Sold', amount: -row.amount });
      }
      month.totalCogs -= row.amount;
    }

    const round = (n: number) => Math.round(n * 100) / 100;
    const months = Array.from(monthMap.values())
      .map((m) => ({
        period: m.period,
        revenue: round(m.totalRevenue),
        revenueLines: m.revenueLines.map((l) => ({ ...l, amount: round(l.amount) })).sort((a, b) => b.amount - a.amount),
        cogs: round(m.totalCogs),
        cogsLines: m.cogsLines.map((l) => ({ ...l, amount: round(l.amount) })).sort((a, b) => b.amount - a.amount),
        grossProfit: round(m.totalRevenue - m.totalCogs),
        expenses: m.expenseLines.map((l) => ({ ...l, amount: round(l.amount) })).sort((a, b) => b.amount - a.amount),
        totalExpenses: round(m.totalExpenses),
        netProfit: round(m.totalRevenue - m.totalCogs - m.totalExpenses),
      }))
      .sort((a, b) => b.period.localeCompare(a.period));

    return { success: true as const, months };
  });

// ============================================
// CASH FLOW (bank-transaction-based)
// ============================================

/** Display-name map for account codes (supplements CHART_OF_ACCOUNTS for gaps) */
const ACCOUNT_DISPLAY_NAMES: Record<string, string> = {};
// Populate from CHART_OF_ACCOUNTS at module level
for (const acct of [
  { code: 'BANK_HDFC', name: 'HDFC Bank Account' },
  { code: 'BANK_RAZORPAYX', name: 'RazorpayX Account' },
  { code: 'CASH', name: 'Cash' },
  { code: 'ACCOUNTS_RECEIVABLE', name: 'Accounts Receivable' },
  { code: 'FABRIC_INVENTORY', name: 'Fabric Inventory' },
  { code: 'FINISHED_GOODS', name: 'Finished Goods' },
  { code: 'GST_INPUT', name: 'GST Input' },
  { code: 'ADVANCES_GIVEN', name: 'Advances Given' },
  { code: 'ACCOUNTS_PAYABLE', name: 'Accounts Payable' },
  { code: 'GST_OUTPUT', name: 'GST Output' },
  { code: 'CUSTOMER_ADVANCES', name: 'Customer Advances' },
  { code: 'TDS_PAYABLE', name: 'TDS Payable' },
  { code: 'CREDIT_CARD', name: 'Credit Card' },
  { code: 'SALES_REVENUE', name: 'Sales Revenue' },
  { code: 'COGS', name: 'Cost of Goods Sold' },
  { code: 'OPERATING_EXPENSES', name: 'Operating Expenses' },
  { code: 'MARKETPLACE_FEES', name: 'Marketplace Fees' },
  { code: 'SOFTWARE_TECHNOLOGY', name: 'Software & Technology' },
  { code: 'UNMATCHED_PAYMENTS', name: 'Unmatched Payments' },
  { code: 'OWNER_CAPITAL', name: 'Owner Capital' },
  { code: 'RETAINED_EARNINGS', name: 'Retained Earnings' },
  { code: 'LOAN_GETVANTAGE', name: 'Loan (GetVantage)' },
]) {
  ACCOUNT_DISPLAY_NAMES[acct.code] = acct.name;
}

function accountDisplayName(code: string): string {
  return ACCOUNT_DISPLAY_NAMES[code] ?? code.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}

const CATEGORY_DISPLAY: Record<string, string> = {
  marketing: 'Marketing & Ads',
  facebook_ads: 'Facebook Ads',
  google_ads: 'Google Ads',
  agency: 'Agencies',
  photoshoot: 'Photoshoot',
  salary: 'Salary & Wages',
  fabric: 'Fabric',
  trims: 'Trims & Accessories',
  service: 'Service (Print, Wash, etc.)',
  rent: 'Rent',
  logistics: 'Logistics & Shipping',
  packaging: 'Packaging',
  equipment: 'Equipment & Tools',
  marketplace: 'Marketplace Fees',
  statutory: 'Statutory / TDS',
  refund: 'Refunds',
  rzp_fees: 'Razorpay Fees',
  other: 'Other',
  uncategorized: 'Uncategorized',
};

function categoryDisplayName(cat: string | null): string {
  if (!cat) return 'Uncategorized';
  return CATEGORY_DISPLAY[cat] ?? cat.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}

export const getMonthlyCashFlow = createServerFn({ method: 'GET' })
  .middleware([authMiddleware])
  .handler(async () => {
    const prisma = await getPrisma();

    const rows = await prisma.$queryRaw<Array<{
      period: string;
      direction: string;
      account: string;
      category: string | null;
      cnt: number;
      total: number;
    }>>`
      SELECT TO_CHAR(bt."txnDate" AT TIME ZONE 'Asia/Kolkata', 'YYYY-MM') AS period,
             bt.direction,
             CASE WHEN bt.direction = 'credit' THEN bt."creditAccountCode"
                  ELSE bt."debitAccountCode" END AS account,
             bt.category,
             COUNT(*)::int AS cnt,
             SUM(bt.amount)::float AS total
      FROM "BankTransaction" bt
      WHERE bt.status IN ('posted', 'legacy_posted')
        AND NOT (
          bt."debitAccountCode" IN ('BANK_HDFC', 'BANK_RAZORPAYX')
          AND bt."creditAccountCode" IN ('BANK_HDFC', 'BANK_RAZORPAYX')
        )
      GROUP BY period, bt.direction, account, bt.category
      ORDER BY period
    `;

    // Build per-month cash flow
    type ExpenseLine = { code: string; name: string; amount: number; count: number };
    type IncomeLine = { code: string; name: string; amount: number; count: number };
    const monthMap = new Map<string, {
      period: string;
      salesRevenue: number;
      salesCount: number;
      refunds: number;
      refundCount: number;
      incomeLines: IncomeLine[];
      expenseLines: ExpenseLine[];
    }>();

    const getMonth = (period: string) => {
      if (!monthMap.has(period)) {
        monthMap.set(period, {
          period,
          salesRevenue: 0,
          salesCount: 0,
          refunds: 0,
          refundCount: 0,
          incomeLines: [],
          expenseLines: [],
        });
      }
      return monthMap.get(period)!;
    };

    // Bank account codes are the "other side" of double-entry — skip them as categories
    const BANK_ACCOUNTS = new Set(['BANK_HDFC', 'BANK_RAZORPAYX']);

    for (const row of rows) {
      if (!row.period || !row.account) continue;
      if (BANK_ACCOUNTS.has(row.account)) continue; // skip bank-side entries
      const month = getMonth(row.period);

      if (row.direction === 'credit') {
        // Income
        if (row.account === 'SALES_REVENUE') {
          month.salesRevenue += row.total;
          month.salesCount += row.cnt;
        } else {
          const existing = month.incomeLines.find((l) => l.code === row.account);
          if (existing) {
            existing.amount += row.total;
            existing.count += row.cnt;
          } else {
            month.incomeLines.push({ code: row.account, name: accountDisplayName(row.account), amount: row.total, count: row.cnt });
          }
        }
      } else {
        // Expense (debit)
        if (row.account === 'SALES_REVENUE') {
          // Refunds — debit to SALES_REVENUE
          month.refunds += row.total;
          month.refundCount += row.cnt;
        } else {
          // Split OPERATING_EXPENSES by category so marketing gets its own line
          const lineCode = row.account === 'OPERATING_EXPENSES' && row.category
            ? `OPEX_${row.category.toUpperCase()}`
            : row.account;
          const lineName = row.account === 'OPERATING_EXPENSES' && row.category
            ? categoryDisplayName(row.category)
            : accountDisplayName(row.account);

          const existing = month.expenseLines.find((l) => l.code === lineCode);
          if (existing) {
            existing.amount += row.total;
            existing.count += row.cnt;
          } else {
            month.expenseLines.push({ code: lineCode, name: lineName, amount: row.total, count: row.cnt });
          }
        }
      }
    }

    const round = (n: number) => Math.round(n * 100) / 100;

    const months = Array.from(monthMap.values())
      .map((m) => {
        const netSalesRevenue = round(m.salesRevenue - m.refunds);
        const otherIncome = round(m.incomeLines.reduce((s, l) => s + l.amount, 0));
        const totalIncome = round(netSalesRevenue + otherIncome);
        const totalExpenses = round(m.expenseLines.reduce((s, l) => s + l.amount, 0));
        return {
          period: m.period,
          salesRevenue: round(m.salesRevenue),
          salesCount: m.salesCount,
          refunds: round(m.refunds),
          refundCount: m.refundCount,
          netSalesRevenue,
          incomeLines: m.incomeLines.map((l) => ({ ...l, amount: round(l.amount) })).sort((a, b) => b.amount - a.amount),
          otherIncome,
          totalIncome,
          expenses: m.expenseLines.map((l) => ({ ...l, amount: round(l.amount) })).sort((a, b) => b.amount - a.amount),
          totalExpenses,
          netCashFlow: round(totalIncome - totalExpenses),
        };
      })
      .sort((a, b) => b.period.localeCompare(a.period));

    return { success: true as const, months };
  });

// ============================================
// CASH FLOW DETAIL (drill-down)
// ============================================

const cashFlowDetailInput = z.object({
  period: z.string().regex(/^\d{4}-\d{2}$/),
  direction: z.enum(['credit', 'debit']),
  accountCode: z.string(),
});

export const getCashFlowDetail = createServerFn({ method: 'POST' })
  .middleware([authMiddleware])
  .inputValidator((input: unknown) => cashFlowDetailInput.parse(input))
  .handler(async ({ data }) => {
    const prisma = await getPrisma();

    const periodStart = new Date(`${data.period}-01T00:00:00+05:30`);
    const periodEnd = new Date(periodStart);
    periodEnd.setMonth(periodEnd.getMonth() + 1);

    // Build where — account code filter + inter-bank exclusion must not clobber each other
    const where: Record<string, unknown> = {
      status: { in: ['posted', 'legacy_posted'] },
      direction: data.direction,
      txnDate: { gte: periodStart, lt: periodEnd },
    };

    // Handle OPEX_* composite codes (e.g. OPEX_MARKETING → account=OPERATING_EXPENSES, category=marketing)
    const opexMatch = data.accountCode.match(/^OPEX_(.+)$/);
    const actualAccount = opexMatch ? 'OPERATING_EXPENSES' : data.accountCode;
    if (opexMatch) {
      where.category = opexMatch[1].toLowerCase();
    }

    if (data.direction === 'credit') {
      where.creditAccountCode = actualAccount;
    } else {
      where.debitAccountCode = actualAccount;
    }
    // Exclude inter-bank transfers (both sides are bank accounts)
    where.NOT = {
      debitAccountCode: { in: ['BANK_HDFC', 'BANK_RAZORPAYX'] },
      creditAccountCode: { in: ['BANK_HDFC', 'BANK_RAZORPAYX'] },
    };

    const transactions = await prisma.bankTransaction.findMany({
      where,
      select: {
        id: true,
        narration: true,
        amount: true,
        txnDate: true,
        counterpartyName: true,
        reference: true,
        bank: true,
        category: true,
        party: { select: { name: true } },
      },
      orderBy: { txnDate: 'desc' },
      take: 500,
    });

    // Group by category (for expenses) or party/channel (for income)
    type TxnRow = { id: string; narration: string | null; amount: number; txnDate: Date; counterpartyName: string | null; reference: string | null; bank: string; category: string | null };
    type GroupItem = { label: string; count: number; total: number; transactions: TxnRow[] };
    const mapped: TxnRow[] = transactions.map((t) => ({
      id: t.id,
      narration: t.narration,
      amount: Number(t.amount),
      txnDate: t.txnDate,
      counterpartyName: t.party?.name ?? t.counterpartyName,
      reference: t.reference,
      bank: t.bank,
      category: t.category,
    }));

    const groupMap = new Map<string, GroupItem>();
    for (const t of mapped) {
      // Use party/counterparty for income (channels), category for expenses
      const key = data.direction === 'credit'
        ? (t.counterpartyName || 'Unknown')
        : (t.category || 'uncategorized');
      const label = data.direction === 'credit'
        ? (t.counterpartyName || 'Unknown')
        : categoryDisplayName(t.category);
      if (!groupMap.has(key)) {
        groupMap.set(key, { label, count: 0, total: 0, transactions: [] });
      }
      const group = groupMap.get(key)!;
      group.count++;
      group.total += t.amount;
      group.transactions.push(t);
    }

    const groups = Array.from(groupMap.values())
      .map((g) => ({ ...g, total: Math.round(g.total * 100) / 100 }))
      .sort((a, b) => b.total - a.total);

    return {
      success: true as const,
      groups,
      totalCount: mapped.length,
    };
  });

// ============================================
// P&L ACCOUNT DETAIL (drill-down)
// ============================================

const pnlAccountDetailInput = z.object({
  period: z.string().regex(/^\d{4}-\d{2}$/),
  category: z.string().optional(),
});

export const getPnlAccountDetail = createServerFn({ method: 'POST' })
  .middleware([authMiddleware])
  .inputValidator((input: unknown) => pnlAccountDetailInput.parse(input))
  .handler(async ({ data }) => {
    const prisma = await getPrisma();

    // Invoice-based drill-down by category + period
    const periodStart = new Date(`${data.period}-01`);
    const periodEnd = new Date(periodStart);
    periodEnd.setMonth(periodEnd.getMonth() + 1);

    const where: Prisma.InvoiceWhereInput = {
      status: { in: ['confirmed', 'partially_paid', 'paid'] },
      OR: [
        { billingPeriod: data.period },
        { billingPeriod: null, invoiceDate: { gte: periodStart, lt: periodEnd } },
      ],
      ...(data.category ? { category: data.category } : {}),
    };

    const invoices = await prisma.invoice.findMany({
      where,
      select: {
        id: true,
        invoiceNumber: true,
        category: true,
        totalAmount: true,
        gstAmount: true,
        invoiceDate: true,
        type: true,
        party: { select: { name: true } },
      },
      orderBy: { totalAmount: 'desc' },
      take: 100,
    });

    // Group by category
    type DetailLine = { description: string; amount: number; date: string; counterparty: string | null };
    const categoryMap = new Map<string, { label: string; total: number; lines: DetailLine[] }>();

    for (const inv of invoices) {
      const amount = Math.round((inv.totalAmount - (inv.gstAmount ?? 0)) * 100) / 100;
      const date = inv.invoiceDate ? new Date(inv.invoiceDate).toISOString().slice(0, 10) : '';
      const counterparty = inv.party?.name ?? null;
      const key = inv.category;
      const label = categoryToExpenseAccountName(inv.category);

      if (!categoryMap.has(key)) categoryMap.set(key, { label, total: 0, lines: [] });
      const cat = categoryMap.get(key)!;
      cat.total += amount;
      cat.lines.push({
        description: `${inv.invoiceNumber ?? 'No #'} — ${counterparty ?? 'Unknown'}`,
        amount,
        date,
        counterparty,
      });
    }

    const categories = Array.from(categoryMap.values())
      .map((c) => ({ ...c, total: Math.round(c.total * 100) / 100 }))
      .sort((a, b) => b.total - a.total);

    return { success: true as const, categories };
  });

// ============================================
// PARTY BALANCES (outstanding per vendor)
// ============================================

export const getPartyBalances = createServerFn({ method: 'GET' })
  .middleware([authMiddleware])
  .handler(async () => {
    const prisma = await getPrisma();

    const balances = await prisma.$queryRaw<Array<{
      id: string; name: string;
      total_invoiced: number; total_paid: number; outstanding: number;
    }>>`
      SELECT p.id, p.name,
        COALESCE(SUM(i."totalAmount"), 0)::float AS total_invoiced,
        COALESCE(SUM(i."paidAmount"), 0)::float AS total_paid,
        COALESCE(SUM(i."balanceDue"), 0)::float AS outstanding
      FROM "Party" p
      LEFT JOIN "Invoice" i ON i."partyId" = p.id
        AND i.type = 'payable' AND i.status != 'cancelled'
      WHERE p."isActive" = true
      GROUP BY p.id, p.name
      ORDER BY outstanding DESC
    `;

    return { success: true as const, balances };
  });

// ============================================
// COUNTERPARTY SEARCH (for dropdowns)
// ============================================

const searchCounterpartiesInput = z.object({
  query: z.string().min(1),
  type: z.enum(['party', 'customer']).optional(),
});

export const searchCounterparties = createServerFn({ method: 'GET' })
  .middleware([authMiddleware])
  .inputValidator((input: unknown) => searchCounterpartiesInput.parse(input))
  .handler(async ({ data }) => {
    const prisma = await getPrisma();
    const results: Array<{ id: string; name: string; type: string }> = [];

    if (!data.type || data.type === 'party') {
      const parties = await prisma.party.findMany({
        where: { name: { contains: data.query, mode: 'insensitive' }, isActive: true },
        select: { id: true, name: true },
        take: 10,
      });
      results.push(...parties.map((p) => ({ id: p.id, name: p.name, type: 'party' as const })));
    }

    if (!data.type || data.type === 'customer') {
      const customers = await prisma.customer.findMany({
        where: {
          OR: [
            { email: { contains: data.query, mode: 'insensitive' } },
            { firstName: { contains: data.query, mode: 'insensitive' } },
            { lastName: { contains: data.query, mode: 'insensitive' } },
          ],
        },
        select: { id: true, email: true, firstName: true, lastName: true },
        take: 10,
      });
      results.push(
        ...customers.map((c) => ({
          id: c.id,
          name: [c.firstName, c.lastName].filter(Boolean).join(' ') || c.email,
          type: 'customer' as const,
        }))
      );
    }

    return { success: true as const, results };
  });

// ============================================
// BANK TRANSACTIONS — LIST
// ============================================

export const listBankTransactions = createServerFn({ method: 'POST' })
  .middleware([authMiddleware])
  .inputValidator((input: unknown) => ListBankTransactionsInput.parse(input))
  .handler(async ({ data }) => {
    const prisma = await getPrisma();
    const { bank, status, batchId, search, page = 1, limit = 50 } = data ?? {};
    const skip = (page - 1) * limit;

    const where: Record<string, unknown> = {};
    if (bank) where.bank = bank;
    if (status) {
      // Expand simplified filter values to DB status values
      const filterMap = BANK_STATUS_FILTER_MAP[status as BankTxnFilterOption];
      if (filterMap) {
        where.status = { in: filterMap };
      } else {
        where.status = status;
      }
    }
    if (batchId) where.batchId = batchId;
    if (search) {
      where.OR = [
        { narration: { contains: search, mode: 'insensitive' } },
        { counterpartyName: { contains: search, mode: 'insensitive' } },
        { reference: { contains: search, mode: 'insensitive' } },
      ];
    }

    const [transactions, total] = await Promise.all([
      prisma.bankTransaction.findMany({
        where,
        select: {
          id: true,
          bank: true,
          txnDate: true,
          amount: true,
          direction: true,
          narration: true,
          reference: true,
          counterpartyName: true,
          debitAccountCode: true,
          creditAccountCode: true,
          status: true,
          skipReason: true,
          category: true,
          partyId: true,
          party: { select: { id: true, name: true } },
          batchId: true,
          createdAt: true,
        },
        orderBy: { txnDate: 'desc' },
        skip,
        take: limit,
      }),
      prisma.bankTransaction.count({ where }),
    ]);

    return { success: true as const, transactions, total, page, limit };
  });

// ============================================
// TRANSACTION TYPE + PARTY MANAGEMENT
// ============================================

export const listTransactionTypes = createServerFn({ method: 'GET' })
  .middleware([authMiddleware])
  .handler(async () => {
    const prisma = await getPrisma();
    const types = await prisma.transactionType.findMany({
      where: { isActive: true },
      orderBy: { name: 'asc' },
      select: {
        id: true,
        name: true,
        description: true,
        debitAccountCode: true,
        creditAccountCode: true,
        defaultGstRate: true,
        defaultTdsApplicable: true,
        defaultTdsSection: true,
        defaultTdsRate: true,
        invoiceRequired: true,
        expenseCategory: true,
        _count: { select: { parties: true } },
      },
    });
    return { success: true as const, types };
  });

export const listFinanceParties = createServerFn({ method: 'POST' })
  .middleware([authMiddleware])
  .inputValidator((input: unknown) => ListPartiesInput.parse(input))
  .handler(async ({ data: input }) => {
    const prisma = await getPrisma();
    const { transactionTypeId, search, page = 1, limit = 200 } = input ?? {};
    const skip = (page - 1) * limit;

    const where: Prisma.PartyWhereInput = {
      ...(transactionTypeId ? { transactionTypeId } : {}),
      ...(search ? {
        OR: [
          { name: { contains: search, mode: 'insensitive' } },
          { aliases: { has: search.toUpperCase() } },
          { contactName: { contains: search, mode: 'insensitive' } },
        ],
      } : {}),
    };

    const [parties, total] = await Promise.all([
      prisma.party.findMany({
        where,
        select: {
          id: true,
          name: true,
          category: true,
          aliases: true,
          tdsApplicable: true,
          tdsSection: true,
          tdsRate: true,
          invoiceRequired: true,
          isActive: true,
          contactName: true,
          email: true,
          phone: true,
          gstin: true,
          pan: true,
          transactionTypeId: true,
          transactionType: {
            select: { id: true, name: true, expenseCategory: true },
          },
        },
        orderBy: { name: 'asc' },
        skip,
        take: limit,
      }),
      prisma.party.count({ where }),
    ]);

    return { success: true as const, parties, total, page, limit };
  });

export const getFinanceParty = createServerFn({ method: 'GET' })
  .middleware([authMiddleware])
  .inputValidator((input: unknown) => z.object({ id: z.string().uuid() }).parse(input))
  .handler(async ({ data: { id } }) => {
    const prisma = await getPrisma();
    const party = await prisma.party.findUnique({
      where: { id },
      include: {
        transactionType: true,
      },
    });
    if (!party) return { success: false as const, error: 'Party not found' };
    return { success: true as const, party };
  });

export const updateFinanceParty = createServerFn({ method: 'POST' })
  .middleware([authMiddleware])
  .inputValidator((input: unknown) => UpdatePartySchema.parse(input))
  .handler(async ({ data, context }) => {
    const prisma = await getPrisma();
    const { id, ...updates } = data;
    const userId = context.user.id;

    // Fetch old values to diff tracked fields
    const oldParty = await prisma.party.findUnique({
      where: { id },
      select: { transactionTypeId: true, tdsApplicable: true, tdsSection: true, tdsRate: true, invoiceRequired: true },
    });
    if (!oldParty) return { success: false as const, error: 'Party not found' };

    const party = await prisma.$transaction(async (tx) => {
      const updated = await tx.party.update({
        where: { id },
        data: updates as Prisma.PartyUpdateInput,
        include: { transactionType: { select: { id: true, name: true } } },
      });

      // Log changes for tracked fields
      const trackedFields = ['transactionTypeId', 'tdsApplicable', 'tdsSection', 'tdsRate', 'invoiceRequired'] as const;
      const updatesRec = updates as Record<string, unknown>;
      const logs: { partyId: string; fieldName: string; oldValue: string | null; newValue: string | null; changedById: string }[] = [];
      for (const field of trackedFields) {
        if (field in updates) {
          const oldVal = oldParty[field];
          const newVal = updatesRec[field];
          if (String(oldVal ?? '') !== String(newVal ?? '')) {
            logs.push({
              partyId: id,
              fieldName: field,
              oldValue: oldVal != null ? String(oldVal) : null,
              newValue: newVal != null ? String(newVal) : null,
              changedById: userId,
            });
          }
        }
      }
      if (logs.length > 0) {
        await tx.partyChangeLog.createMany({ data: logs });
      }

      return updated;
    });

    return { success: true as const, party };
  });

export const createFinanceParty = createServerFn({ method: 'POST' })
  .middleware([authMiddleware])
  .inputValidator((input: unknown) => CreatePartySchema.parse(input))
  .handler(async ({ data }) => {
    const prisma = await getPrisma();

    const party = await prisma.party.create({
      data: {
        name: data.name,
        category: data.category,
        ...(data.transactionTypeId ? { transactionTypeId: data.transactionTypeId } : {}),
        aliases: data.aliases ?? [],
        tdsApplicable: data.tdsApplicable ?? false,
        tdsSection: data.tdsSection ?? null,
        tdsRate: data.tdsRate ?? null,
        invoiceRequired: data.invoiceRequired ?? true,
        contactName: data.contactName ?? null,
        email: data.email ?? null,
        phone: data.phone ?? null,
        gstin: data.gstin ?? null,
        pan: data.pan ?? null,
      },
      include: {
        transactionType: { select: { id: true, name: true } },
      },
    });

    return { success: true as const, party };
  });

// ============================================
// TRANSACTION TYPE — CRUD
// ============================================

export const getTransactionType = createServerFn({ method: 'GET' })
  .middleware([authMiddleware])
  .inputValidator((input: unknown) => z.object({ id: z.string().uuid() }).parse(input))
  .handler(async ({ data }) => {
    const prisma = await getPrisma();
    const tt = await prisma.transactionType.findUnique({
      where: { id: data.id },
      include: {
        _count: { select: { parties: true } },
        changeLogs: {
          orderBy: { createdAt: 'desc' },
          take: 50,
          include: { changedBy: { select: { name: true } } },
        },
      },
    });
    if (!tt) return { success: false as const, error: 'Transaction type not found' };
    return { success: true as const, transactionType: tt };
  });

export const createTransactionType = createServerFn({ method: 'POST' })
  .middleware([authMiddleware])
  .inputValidator((input: unknown) => CreateTransactionTypeSchema.parse(input))
  .handler(async ({ data, context }) => {
    const prisma = await getPrisma();
    const userId = context.user.id;

    const tt = await prisma.$transaction(async (tx) => {
      const created = await tx.transactionType.create({
        data: {
          name: data.name,
          ...(data.description ? { description: data.description } : {}),
          ...(data.debitAccountCode ? { debitAccountCode: data.debitAccountCode } : {}),
          ...(data.creditAccountCode ? { creditAccountCode: data.creditAccountCode } : {}),
          ...(data.defaultGstRate != null ? { defaultGstRate: data.defaultGstRate } : {}),
          defaultTdsApplicable: data.defaultTdsApplicable ?? false,
          ...(data.defaultTdsSection ? { defaultTdsSection: data.defaultTdsSection } : {}),
          ...(data.defaultTdsRate != null ? { defaultTdsRate: data.defaultTdsRate } : {}),
          invoiceRequired: data.invoiceRequired ?? true,
          ...(data.expenseCategory ? { expenseCategory: data.expenseCategory } : {}),
        },
      });

      await tx.transactionTypeChangeLog.create({
        data: {
          transactionTypeId: created.id,
          fieldName: '__created',
          newValue: created.name,
          changedById: userId,
        },
      });

      return created;
    });

    return { success: true as const, transactionType: tt };
  });

export const updateTransactionType = createServerFn({ method: 'POST' })
  .middleware([authMiddleware])
  .inputValidator((input: unknown) => UpdateTransactionTypeSchema.parse(input))
  .handler(async ({ data, context }) => {
    const prisma = await getPrisma();
    const userId = context.user.id;
    const { id, ...updates } = data;

    const old = await prisma.transactionType.findUnique({ where: { id } });
    if (!old) return { success: false as const, error: 'Transaction type not found' };

    const tt = await prisma.$transaction(async (tx) => {
      const updated = await tx.transactionType.update({
        where: { id },
        data: updates as Prisma.TransactionTypeUpdateInput,
        include: { _count: { select: { parties: true } } },
      });

      // Diff and log each changed field
      const fields = ['name', 'description', 'debitAccountCode', 'creditAccountCode', 'defaultGstRate', 'defaultTdsApplicable', 'defaultTdsSection', 'defaultTdsRate', 'invoiceRequired', 'expenseCategory', 'isActive'] as const;
      const oldRec = old as Record<string, unknown>;
      const updatesRec = updates as Record<string, unknown>;
      const logs: { transactionTypeId: string; fieldName: string; oldValue: string | null; newValue: string | null; changedById: string }[] = [];
      for (const field of fields) {
        if (field in updates) {
          const oldVal = oldRec[field];
          const newVal = updatesRec[field];
          if (String(oldVal ?? '') !== String(newVal ?? '')) {
            logs.push({
              transactionTypeId: id,
              fieldName: field,
              oldValue: oldVal != null ? String(oldVal) : null,
              newValue: newVal != null ? String(newVal) : null,
              changedById: userId,
            });
          }
        }
      }
      if (logs.length > 0) {
        await tx.transactionTypeChangeLog.createMany({ data: logs });
      }

      return updated;
    });

    return { success: true as const, transactionType: tt };
  });

export const deleteTransactionType = createServerFn({ method: 'POST' })
  .middleware([authMiddleware])
  .inputValidator((input: unknown) => z.object({ id: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }) => {
    const prisma = await getPrisma();
    const userId = context.user.id;

    const tt = await prisma.transactionType.findUnique({
      where: { id: data.id },
      include: { _count: { select: { parties: { where: { isActive: true } } } } },
    });
    if (!tt) return { success: false as const, error: 'Transaction type not found' };
    if (tt._count.parties > 0) {
      return { success: false as const, error: `Cannot deactivate: ${tt._count.parties} active parties are using this type` };
    }

    await prisma.$transaction(async (tx) => {
      await tx.transactionType.update({ where: { id: data.id }, data: { isActive: false } });
      await tx.transactionTypeChangeLog.create({
        data: {
          transactionTypeId: data.id,
          fieldName: '__deactivated',
          oldValue: 'true',
          newValue: 'false',
          changedById: userId,
        },
      });
    });

    return { success: true as const };
  });

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
