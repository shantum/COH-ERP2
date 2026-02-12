/**
 * Finance Server Functions
 *
 * Invoice CRUD, payment CRUD, ledger queries, and manual journal entries.
 * File uploads go through Express route (needs multer).
 */

'use server';

import { createServerFn } from '@tanstack/react-start';
import { z } from 'zod';
import { authMiddleware } from '../middleware/auth';
import { getPrisma } from '@coh/shared/services/db';
import {
  CreateInvoiceSchema,
  UpdateInvoiceSchema,
  CreateFinancePaymentSchema,
  MatchPaymentInvoiceSchema,
  CreateManualLedgerEntrySchema,
  ListInvoicesInput,
  ListPaymentsInput,
  ListLedgerEntriesInput,
} from '@coh/shared/schemas/finance';

// ============================================
// INLINE LEDGER HELPERS
// (Avoids cross-project import from server/)
// ============================================

interface LedgerLineInput {
  accountCode: string;
  debit?: number;
  credit?: number;
  description?: string;
}

/**
 * Create a balanced journal entry with debit/credit lines.
 * Resolves account codes → IDs, validates balance, creates entry + lines.
 * DB trigger handles balance updates automatically.
 */
async function inlineCreateLedgerEntry(
  prisma: Awaited<ReturnType<typeof getPrisma>>,
  input: {
    entryDate: Date;
    description: string;
    sourceType: string;
    sourceId?: string;
    lines: LedgerLineInput[];
    createdById: string;
    notes?: string;
  }
) {
  const { entryDate, description, sourceType, sourceId, lines, createdById, notes } = input;

  // Validate debits = credits
  const totalDebit = lines.reduce((sum, l) => sum + (l.debit ?? 0), 0);
  const totalCredit = lines.reduce((sum, l) => sum + (l.credit ?? 0), 0);
  if (Math.abs(totalDebit - totalCredit) > 0.01) {
    throw new Error(`Debits (${totalDebit.toFixed(2)}) must equal credits (${totalCredit.toFixed(2)})`);
  }

  // Resolve account codes to IDs
  const accountCodes = [...new Set(lines.map((l) => l.accountCode))];
  const accounts = await prisma.ledgerAccount.findMany({
    where: { code: { in: accountCodes } },
    select: { id: true, code: true },
  });
  const accountMap = new Map(accounts.map((a) => [a.code, a.id]));
  for (const code of accountCodes) {
    if (!accountMap.has(code)) throw new Error(`Unknown account code: ${code}`);
  }

  return prisma.ledgerEntry.create({
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
      lines: { include: { account: { select: { code: true, name: true } } } },
    },
  });
}

/** Create a mirror entry that reverses the original (swaps all debits and credits) */
async function inlineReverseLedgerEntry(
  prisma: Awaited<ReturnType<typeof getPrisma>>,
  entryId: string,
  userId: string
) {
  const original = await prisma.ledgerEntry.findUnique({
    where: { id: entryId },
    include: { lines: true },
  });
  if (!original) throw new Error('Ledger entry not found');
  if (original.isReversed) throw new Error('Entry is already reversed');

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
  });

  await prisma.ledgerEntry.update({
    where: { id: entryId },
    data: { isReversed: true, reversedById: reversal.id },
  });

  return reversal;
}

// ============================================
// DASHBOARD / SUMMARY
// ============================================

export const getFinanceSummary = createServerFn({ method: 'GET' })
  .middleware([authMiddleware])
  .handler(async () => {
    const prisma = await getPrisma();

    const accounts = await prisma.ledgerAccount.findMany({
      where: { isActive: true },
      select: { code: true, name: true, type: true, balance: true },
      orderBy: { code: 'asc' },
    });

    // Aggregate some useful summaries
    const totalPayable = accounts.find((a) => a.code === 'ACCOUNTS_PAYABLE')?.balance ?? 0;
    const totalReceivable = accounts.find((a) => a.code === 'ACCOUNTS_RECEIVABLE')?.balance ?? 0;

    // Count open invoices
    const [payableCount, receivableCount] = await Promise.all([
      prisma.invoice.count({ where: { type: 'payable', status: { in: ['confirmed', 'partially_paid'] } } }),
      prisma.invoice.count({ where: { type: 'receivable', status: { in: ['confirmed', 'partially_paid'] } } }),
    ]);

    return {
      success: true as const,
      accounts,
      summary: {
        totalPayable,
        totalReceivable,
        openPayableInvoices: payableCount,
        openReceivableInvoices: receivableCount,
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
        { counterpartyName: { contains: search, mode: 'insensitive' } },
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
          counterpartyName: true,
          totalAmount: true,
          tdsAmount: true,
          paidAmount: true,
          balanceDue: true,
          notes: true,
          driveUrl: true,
          createdAt: true,
          party: { select: { id: true, name: true } },
          customer: { select: { id: true, email: true, firstName: true, lastName: true } },
          _count: { select: { lines: true, matchedPayments: true } },
        },
        orderBy: { createdAt: 'desc' },
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
        matchedPayments: {
          include: {
            payment: {
              select: { id: true, referenceNumber: true, method: true, amount: true, paymentDate: true },
            },
            matchedBy: { select: { id: true, name: true } },
          },
        },
        ledgerEntry: {
          include: {
            lines: { include: { account: { select: { code: true, name: true } } } },
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
        ...(data.partyId ? { partyId: data.partyId } : {}),
        ...(data.customerId ? { customerId: data.customerId } : {}),
        counterpartyName: data.counterpartyName ?? null,
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
    if (updateData.counterpartyName !== undefined) updates.counterpartyName = updateData.counterpartyName;
    if (updateData.subtotal !== undefined) updates.subtotal = updateData.subtotal;
    if (updateData.gstAmount !== undefined) updates.gstAmount = updateData.gstAmount;
    if (updateData.totalAmount !== undefined) {
      updates.totalAmount = updateData.totalAmount;
      updates.balanceDue = updateData.totalAmount; // Reset since still draft
    }
    if (updateData.notes !== undefined) updates.notes = updateData.notes;

    await prisma.invoice.update({ where: { id }, data: updates });

    return { success: true as const };
  });

// ============================================
// INVOICE — CONFIRM (draft → confirmed + ledger entry)
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
      select: { id: true, type: true, category: true, status: true, totalAmount: true, gstAmount: true, subtotal: true, counterpartyName: true, invoiceNumber: true, partyId: true },
    });

    if (!invoice) return { success: false as const, error: 'Invoice not found' };
    if (invoice.status !== 'draft') return { success: false as const, error: 'Can only confirm draft invoices' };

    // Calculate TDS for payable invoices with a TDS-enabled party
    let tdsAmount = 0;
    if (invoice.type === 'payable' && invoice.partyId) {
      const party = await prisma.party.findUnique({
        where: { id: invoice.partyId },
        select: { tdsApplicable: true, tdsRate: true },
      });
      if (party?.tdsApplicable && party.tdsRate && party.tdsRate > 0) {
        const subtotal = invoice.totalAmount - (invoice.gstAmount ?? 0);
        tdsAmount = Math.round(subtotal * (party.tdsRate / 100) * 100) / 100;
      }
    }

    // ---- LINKED PAYMENT PATH (already-paid bill) ----
    if (data.linkedPaymentId && invoice.type === 'payable') {
      return confirmInvoiceWithLinkedPayment(prisma, invoice, data.linkedPaymentId, tdsAmount, userId);
    }

    // ---- NORMAL AP PATH (invoice first, pay later) ----
    const lines = buildInvoiceLedgerLines(invoice, tdsAmount);

    const entry = await inlineCreateLedgerEntry(prisma, {
      entryDate: new Date(),
      description: `Invoice ${invoice.invoiceNumber ?? invoice.id} confirmed (${invoice.type})`,
      sourceType: 'invoice_confirmed',
      sourceId: invoice.id,
      lines,
      createdById: userId,
    });

    await prisma.invoice.update({
      where: { id: invoice.id },
      data: {
        status: 'confirmed',
        ledgerEntryId: entry.id,
        ...(tdsAmount > 0 ? { tdsAmount, balanceDue: invoice.totalAmount - tdsAmount } : {}),
      },
    });

    return { success: true as const };
  });

/**
 * Confirm an invoice and link it to an existing payment.
 * Instead of creating AP, posts an adjustment entry to fix expense category / split GST / book TDS.
 *
 * The match amount uses the net payable (totalAmount - tdsAmount) because TDS is withheld
 * and never paid to the vendor. So payment.amount should roughly equal matchAmount.
 */
async function confirmInvoiceWithLinkedPayment(
  prisma: Awaited<ReturnType<typeof getPrisma>>,
  invoice: { id: string; category: string; totalAmount: number; gstAmount: number | null; subtotal: number | null; invoiceNumber: string | null },
  paymentId: string,
  tdsAmount: number,
  userId: string,
) {
  // The amount the vendor was actually paid (total minus TDS withheld)
  const matchAmount = invoice.totalAmount - tdsAmount;

  // Look up the payment and its ledger entry lines
  const payment = await prisma.payment.findUnique({
    where: { id: paymentId },
    select: {
      id: true, amount: true, unmatchedAmount: true, matchedAmount: true, status: true,
      ledgerEntryId: true,
      ledgerEntry: { include: { lines: { include: { account: { select: { code: true } } } } } },
    },
  });
  if (!payment) throw new Error('Payment not found');
  if (payment.status === 'cancelled') throw new Error('Payment is cancelled');
  if (!payment.ledgerEntry) throw new Error('Payment has no ledger entry — cannot determine original account');
  if (payment.unmatchedAmount < matchAmount - 0.01) throw new Error('Payment unmatched amount is less than invoice net payable');

  // Find what account the bank import originally debited
  const originalDebitLine = payment.ledgerEntry.lines.find(l => l.debit > 0 && l.account.code !== 'BANK' && l.account.code !== 'CASH');
  const originalAccount = originalDebitLine?.account.code ?? 'OPERATING_EXPENSES';

  // Figure out the correct expense account from the invoice category
  const correctExpense = categoryToExpenseAccount(invoice.category);
  const gstAmount = invoice.gstAmount ?? 0;
  const netAmount = invoice.totalAmount - gstAmount;

  // Build adjustment lines (only if something needs fixing)
  const needsAdjustment = originalAccount !== correctExpense || gstAmount > 0 || tdsAmount > 0;

  // Use a transaction to keep all writes atomic
  return prisma.$transaction(async (tx) => {
    let adjustmentEntryId: string | null = null;

    if (needsAdjustment) {
      const adjustmentLines: LedgerLineInput[] = [];

      // Debit the correct expense account for the net amount
      adjustmentLines.push({ accountCode: correctExpense, debit: netAmount, description: `${invoice.category} expense (invoice ${invoice.invoiceNumber ?? invoice.id})` });

      // Debit GST if the invoice has it
      if (gstAmount > 0) {
        adjustmentLines.push({ accountCode: 'GST_INPUT', debit: gstAmount, description: 'GST input credit (from invoice)' });
      }

      // Credit the original account (reverse what the bank import debited)
      adjustmentLines.push({ accountCode: originalAccount, credit: matchAmount, description: `Reclassify from ${originalAccount}` });

      // Credit TDS if applicable
      if (tdsAmount > 0) {
        adjustmentLines.push({ accountCode: 'TDS_PAYABLE', credit: tdsAmount, description: 'TDS deducted at source' });
      }

      const adjEntry = await inlineCreateLedgerEntry(tx as any, {
        entryDate: new Date(),
        description: `Invoice ${invoice.invoiceNumber ?? invoice.id} linked to payment — reclassification`,
        sourceType: 'invoice_payment_linked',
        sourceId: invoice.id,
        lines: adjustmentLines,
        createdById: userId,
      });
      adjustmentEntryId = adjEntry.id;
    }

    // Create PaymentInvoice match record
    await tx.paymentInvoice.create({
      data: {
        paymentId,
        invoiceId: invoice.id,
        amount: matchAmount,
        notes: 'Auto-linked on invoice confirm',
        matchedById: userId,
      },
    });

    // Update Payment: matched/unmatched amounts
    await tx.payment.update({
      where: { id: paymentId },
      data: {
        matchedAmount: payment.matchedAmount + matchAmount,
        unmatchedAmount: Math.max(0, payment.unmatchedAmount - matchAmount),
      },
    });

    // Update Invoice: mark as paid, link adjustment entry if one was created
    // Note: ledgerEntryId has a @unique constraint, so only set it if we made a new entry
    await tx.invoice.update({
      where: { id: invoice.id },
      data: {
        status: 'paid',
        paidAmount: matchAmount,
        balanceDue: 0,
        ...(adjustmentEntryId ? { ledgerEntryId: adjustmentEntryId } : {}),
        ...(tdsAmount > 0 ? { tdsAmount } : {}),
      },
    });

    return { success: true as const, linked: true as const };
  });
}

/**
 * Build ledger lines for an invoice confirmation.
 * Payable: Dr expense account, Cr ACCOUNTS_PAYABLE (less TDS), Cr TDS_PAYABLE
 * Receivable: Dr ACCOUNTS_RECEIVABLE, Cr SALES_REVENUE
 */
function buildInvoiceLedgerLines(invoice: {
  type: string;
  category: string;
  totalAmount: number;
  gstAmount: number | null;
}, tdsAmount = 0) {
  const { type, category, totalAmount, gstAmount } = invoice;
  const netAmount = totalAmount - (gstAmount ?? 0);

  if (type === 'payable') {
    // Figure out which expense account to debit based on category
    const expenseAccount = categoryToExpenseAccount(category);
    const lines = [
      { accountCode: expenseAccount, debit: netAmount, description: `${category} expense` },
      { accountCode: 'ACCOUNTS_PAYABLE', credit: totalAmount - tdsAmount, description: 'Amount owed to vendor' },
    ];
    if (gstAmount && gstAmount > 0) {
      lines.push({ accountCode: 'GST_INPUT', debit: gstAmount, description: 'GST input credit' });
    }
    if (tdsAmount > 0) {
      lines.push({ accountCode: 'TDS_PAYABLE', credit: tdsAmount, description: 'TDS deducted at source' });
    }
    return lines;
  }

  // Receivable
  const lines = [
    { accountCode: 'ACCOUNTS_RECEIVABLE', debit: totalAmount, description: 'Amount due from customer' },
    { accountCode: 'SALES_REVENUE', credit: netAmount, description: 'Revenue' },
  ];
  if (gstAmount && gstAmount > 0) {
    lines.push({ accountCode: 'GST_OUTPUT', credit: gstAmount, description: 'GST output liability' });
  }
  return lines;
}

/** Map invoice category → ledger expense account code */
function categoryToExpenseAccount(category: string): string {
  switch (category) {
    case 'fabric':
      return 'FABRIC_INVENTORY';
    case 'trims':
    case 'packaging':
      return 'FABRIC_INVENTORY'; // Raw materials bucket
    case 'service':
      return 'OPERATING_EXPENSES';
    case 'logistics':
      return 'OPERATING_EXPENSES';
    case 'rent':
    case 'salary':
    case 'equipment':
      return 'OPERATING_EXPENSES';
    case 'marketing':
      return 'OPERATING_EXPENSES';
    case 'marketplace':
      return 'MARKETPLACE_FEES';
    default:
      return 'OPERATING_EXPENSES';
  }
}

// ============================================
// INVOICE — CANCEL
// ============================================

const cancelInvoiceInput = z.object({ id: z.string().uuid() });

export const cancelInvoice = createServerFn({ method: 'POST' })
  .middleware([authMiddleware])
  .inputValidator((input: unknown) => cancelInvoiceInput.parse(input))
  .handler(async ({ data, context }) => {
    const prisma = await getPrisma();
    const userId = context.user.id;

    const invoice = await prisma.invoice.findUnique({
      where: { id: data.id },
      select: { id: true, status: true, ledgerEntryId: true },
    });

    if (!invoice) return { success: false as const, error: 'Invoice not found' };
    if (invoice.status === 'cancelled') return { success: false as const, error: 'Already cancelled' };
    if (invoice.status === 'paid') return { success: false as const, error: 'Cannot cancel a paid invoice' };

    // Reverse ledger entry if one exists
    if (invoice.ledgerEntryId) {
      await inlineReverseLedgerEntry(prisma, invoice.ledgerEntryId, userId);
    }

    await prisma.invoice.update({
      where: { id: data.id },
      data: { status: 'cancelled' },
    });

    return { success: true as const };
  });

// ============================================
// PAYMENT — LIST
// ============================================

export const listPayments = createServerFn({ method: 'POST' })
  .middleware([authMiddleware])
  .inputValidator((input: unknown) => ListPaymentsInput.parse(input))
  .handler(async ({ data }) => {
    const prisma = await getPrisma();
    const { direction, method, status, search, page = 1, limit = 50 } = data ?? {};
    const skip = (page - 1) * limit;

    const where: Record<string, unknown> = {};
    if (direction) where.direction = direction;
    if (method) where.method = method;
    if (status) where.status = status;
    if (search) {
      where.OR = [
        { referenceNumber: { contains: search, mode: 'insensitive' } },
        { counterpartyName: { contains: search, mode: 'insensitive' } },
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
          counterpartyName: true,
          notes: true,
          createdAt: true,
          party: { select: { id: true, name: true } },
          customer: { select: { id: true, email: true, firstName: true, lastName: true } },
          _count: { select: { matchedInvoices: true } },
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
// PAYMENT — CREATE (+ auto ledger entry)
// ============================================

export const createFinancePayment = createServerFn({ method: 'POST' })
  .middleware([authMiddleware])
  .inputValidator((input: unknown) => CreateFinancePaymentSchema.parse(input))
  .handler(async ({ data, context }) => {
    const prisma = await getPrisma();
    const userId = context.user.id;
    // Build ledger lines
    const lines = buildPaymentLedgerLines(data);

    // Create ledger entry first
    const entry = await inlineCreateLedgerEntry(prisma, {
      entryDate: new Date(data.paymentDate),
      description: `Payment ${data.direction}: ${data.counterpartyName ?? data.method} — ${data.amount}`,
      sourceType: data.direction === 'outgoing' ? 'payment_outgoing' : 'payment_received',
      lines,
      createdById: userId,
    });

    // Create payment record
    const payment = await prisma.payment.create({
      data: {
        referenceNumber: data.referenceNumber ?? null,
        direction: data.direction,
        method: data.method,
        status: 'confirmed',
        amount: data.amount,
        unmatchedAmount: data.amount, // Starts fully unmatched
        paymentDate: new Date(data.paymentDate),
        ...(data.partyId ? { partyId: data.partyId } : {}),
        ...(data.customerId ? { customerId: data.customerId } : {}),
        counterpartyName: data.counterpartyName ?? null,
        ledgerEntryId: entry.id,
        notes: data.notes ?? null,
        createdById: userId,
      },
      select: { id: true, referenceNumber: true, amount: true, direction: true },
    });

    return { success: true as const, payment };
  });

/**
 * Build ledger lines for a payment.
 * Outgoing: Dr ACCOUNTS_PAYABLE, Cr BANK
 * Incoming: Dr BANK, Cr ACCOUNTS_RECEIVABLE
 */
function buildPaymentLedgerLines(data: {
  direction: string;
  method: string;
  amount: number;
}) {
  const cashAccount = data.method === 'cash' ? 'CASH' : 'BANK';

  if (data.direction === 'outgoing') {
    return [
      { accountCode: 'ACCOUNTS_PAYABLE', debit: data.amount, description: 'Vendor payment' },
      { accountCode: cashAccount, credit: data.amount, description: `Paid via ${data.method}` },
    ];
  }

  return [
    { accountCode: cashAccount, debit: data.amount, description: `Received via ${data.method}` },
    { accountCode: 'ACCOUNTS_RECEIVABLE', credit: data.amount, description: 'Customer payment' },
  ];
}

// ============================================
// PAYMENT — MATCH TO INVOICE
// ============================================

export const matchPaymentToInvoice = createServerFn({ method: 'POST' })
  .middleware([authMiddleware])
  .inputValidator((input: unknown) => MatchPaymentInvoiceSchema.parse(input))
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

    // Create the match
    await prisma.paymentInvoice.create({
      data: {
        paymentId: data.paymentId,
        invoiceId: data.invoiceId,
        amount: data.amount,
        notes: data.notes ?? null,
        matchedById: userId,
      },
    });

    // Update denormalized amounts
    const newPaymentMatched = payment.matchedAmount + data.amount;
    const newPaymentUnmatched = payment.unmatchedAmount - data.amount;
    await prisma.payment.update({
      where: { id: data.paymentId },
      data: { matchedAmount: newPaymentMatched, unmatchedAmount: Math.max(0, newPaymentUnmatched) },
    });

    const newInvoicePaid = invoice.paidAmount + data.amount;
    const newInvoiceBalance = invoice.balanceDue - data.amount;
    const newStatus = newInvoiceBalance <= 0.01 ? 'paid' : 'partially_paid';
    await prisma.invoice.update({
      where: { id: data.invoiceId },
      data: { paidAmount: newInvoicePaid, balanceDue: Math.max(0, newInvoiceBalance), status: newStatus },
    });

    return { success: true as const };
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

    const match = await prisma.paymentInvoice.findUnique({
      where: { paymentId_invoiceId: { paymentId: data.paymentId, invoiceId: data.invoiceId } },
    });

    if (!match) return { success: false as const, error: 'Match not found' };

    // Remove the match
    await prisma.paymentInvoice.delete({
      where: { paymentId_invoiceId: { paymentId: data.paymentId, invoiceId: data.invoiceId } },
    });

    // Update denormalized amounts
    await prisma.payment.update({
      where: { id: data.paymentId },
      data: {
        matchedAmount: { decrement: match.amount },
        unmatchedAmount: { increment: match.amount },
      },
    });

    const invoice = await prisma.invoice.findUnique({
      where: { id: data.invoiceId },
      select: { paidAmount: true, balanceDue: true, status: true },
    });

    if (invoice) {
      const newPaid = invoice.paidAmount - match.amount;
      const newBalance = invoice.balanceDue + match.amount;
      const newStatus = newPaid <= 0.01 ? 'confirmed' : 'partially_paid';
      await prisma.invoice.update({
        where: { id: data.invoiceId },
        data: { paidAmount: Math.max(0, newPaid), balanceDue: newBalance, status: newStatus },
      });
    }

    return { success: true as const };
  });

// ============================================
// LEDGER — LIST ENTRIES
// ============================================

export const listLedgerEntries = createServerFn({ method: 'POST' })
  .middleware([authMiddleware])
  .inputValidator((input: unknown) => ListLedgerEntriesInput.parse(input))
  .handler(async ({ data }) => {
    const prisma = await getPrisma();
    const { accountCode, sourceType, search, page = 1, limit = 50 } = data ?? {};
    const skip = (page - 1) * limit;

    const where: Record<string, unknown> = {};
    if (sourceType) where.sourceType = sourceType;
    if (search) {
      where.OR = [
        { description: { contains: search, mode: 'insensitive' } },
        { notes: { contains: search, mode: 'insensitive' } },
      ];
    }
    if (accountCode) {
      where.lines = { some: { account: { code: accountCode } } };
    }

    const [entries, total] = await Promise.all([
      prisma.ledgerEntry.findMany({
        where,
        include: {
          lines: {
            include: { account: { select: { code: true, name: true, type: true } } },
          },
          createdBy: { select: { id: true, name: true } },
        },
        orderBy: { entryDate: 'desc' },
        skip,
        take: limit,
      }),
      prisma.ledgerEntry.count({ where }),
    ]);

    return { success: true as const, entries, total, page, limit };
  });

// ============================================
// LEDGER — MANUAL ENTRY
// ============================================

export const createManualEntry = createServerFn({ method: 'POST' })
  .middleware([authMiddleware])
  .inputValidator((input: unknown) => CreateManualLedgerEntrySchema.parse(input))
  .handler(async ({ data, context }) => {
    const prisma = await getPrisma();
    const userId = context.user.id;
    const entry = await inlineCreateLedgerEntry(prisma, {
      entryDate: new Date(data.entryDate),
      description: data.description,
      sourceType: 'manual',
      lines: data.lines.map((l) => ({
        accountCode: l.accountCode,
        debit: l.debit,
        credit: l.credit,
        description: l.description,
      })),
      createdById: userId,
      notes: data.notes,
    });

    return { success: true as const, entry: { id: entry.id } };
  });

// ============================================
// LEDGER — REVERSE ENTRY
// ============================================

const reverseEntryInput = z.object({ id: z.string().uuid() });

export const reverseEntry = createServerFn({ method: 'POST' })
  .middleware([authMiddleware])
  .inputValidator((input: unknown) => reverseEntryInput.parse(input))
  .handler(async ({ data, context }) => {
    const prisma = await getPrisma();
    const userId = context.user.id;
    const reversal = await inlineReverseLedgerEntry(prisma, data.id, userId);
    return { success: true as const, reversal: { id: reversal.id } };
  });

// ============================================
// FIND UNMATCHED PAYMENTS (for invoice linking)
// ============================================

const findUnmatchedPaymentsInput = z.object({
  counterpartyName: z.string().optional(),
  amountMin: z.number().optional(),
  amountMax: z.number().optional(),
}).optional();

export const findUnmatchedPayments = createServerFn({ method: 'POST' })
  .middleware([authMiddleware])
  .inputValidator((input: unknown) => findUnmatchedPaymentsInput.parse(input))
  .handler(async ({ data }) => {
    const prisma = await getPrisma();
    const { counterpartyName, amountMin, amountMax } = data ?? {};

    const where: Record<string, unknown> = {
      direction: 'outgoing',
      status: 'confirmed',
      unmatchedAmount: { gt: 0.01 },
    };

    if (counterpartyName) {
      where.counterpartyName = { contains: counterpartyName, mode: 'insensitive' };
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
        counterpartyName: true,
        method: true,
        notes: true,
        ledgerEntry: {
          select: {
            lines: {
              select: {
                account: { select: { code: true, name: true } },
                debit: true,
              },
              where: { debit: { gt: 0 } },
            },
          },
        },
      },
      orderBy: { paymentDate: 'desc' },
      take: 20,
    });

    return { success: true as const, payments };
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
