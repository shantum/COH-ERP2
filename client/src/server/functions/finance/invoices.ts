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
// linkedPaymentId is now linkedBankTransactionId (BankTransaction replaces Payment)
import { dateToPeriod, applyPeriodOffset } from '@coh/shared';

// ============================================
// INVOICE — LIST
// ============================================

export const listInvoices = createServerFn({ method: 'POST' })
  .middleware([authMiddleware])
  .inputValidator((input: unknown) => ListInvoicesInput.parse(input))
  .handler(async ({ data }) => {
    const prisma = await getPrisma();
    const { type, status, category, search, sortBy, sortDir, page = 1, limit = 50 } = data ?? {};
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

    const isFabricFilter = category === 'fabric';

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
          order: { select: { channel: true } },
          _count: { select: { lines: true, allocations: true } },
          // Include fabric colour details when filtering by fabric category
          ...(isFabricFilter ? {
            lines: {
              select: {
                id: true,
                description: true,
                qty: true,
                unit: true,
                rate: true,
                amount: true,
                fabricColourId: true,
                fabricColour: {
                  select: {
                    id: true,
                    colourName: true,
                    code: true,
                    fabric: { select: { id: true, name: true } },
                  },
                },
              },
            },
          } : {}),
        },
        orderBy: sortBy
          ? [{ [sortBy]: sortDir ?? 'desc' }, { createdAt: 'desc' }]
          : [{ createdAt: 'desc' }],
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
        lines: {
          include: {
            fabricColour: {
              select: { id: true, colourName: true, code: true, fabric: { select: { id: true, name: true } } },
            },
            matchedTxn: {
              select: { id: true, qty: true, unit: true, costPerUnit: true, createdAt: true },
            },
            orderLine: {
              select: {
                id: true,
                qty: true,
                unitPrice: true,
                sku: {
                  select: {
                    skuCode: true,
                    size: true,
                    mrp: true,
                    variation: {
                      select: {
                        colorName: true,
                        product: {
                          select: { name: true, hsnCode: true, styleCode: true },
                        },
                      },
                    },
                  },
                },
              },
            },
          },
        },
        allocations: {
          include: {
            bankTransaction: {
              select: { id: true, reference: true, utr: true, bank: true, amount: true, txnDate: true },
            },
            matchedBy: { select: { id: true, name: true } },
          },
        },
        order: {
          select: {
            id: true,
            orderNumber: true,
            channel: true,
            orderDate: true,
            customerName: true,
            customerEmail: true,
            customerPhone: true,
            shippingAddress: true,
            paymentMethod: true,
            paymentConfirmedAt: true,
            settledAt: true,
            settlementRef: true,
            settlementAmount: true,
            paymentGateway: true,
            totalAmount: true,
            customerState: true,
            shopifyCache: {
              select: { paymentGatewayNames: true, confirmationNumber: true, rawData: true },
            },
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

    // Enrich payment info from Shopify rawData when cache columns are empty
    if (rest.order?.shopifyCache) {
      const cache = rest.order.shopifyCache;
      if (!cache.paymentGatewayNames || !cache.confirmationNumber) {
        try {
          const raw = JSON.parse(cache.rawData ?? '{}');
          if (!cache.paymentGatewayNames && raw.payment_gateway_names) {
            cache.paymentGatewayNames = (raw.payment_gateway_names as string[]).join(', ');
          }
          if (!cache.confirmationNumber && raw.confirmation_number) {
            cache.confirmationNumber = raw.confirmation_number as string;
          }
        } catch { /* ignore parse errors */ }
      }
      // Don't send rawData to client
      (cache as Record<string, unknown>).rawData = undefined;
    }

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
        gstRate: data.gstRate ?? null,
        gstAmount: data.gstAmount ?? null,
        totalAmount: data.totalAmount,
        balanceDue: data.totalAmount,
        ...(data.orderId ? { orderId: data.orderId } : {}),
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
                  ...(l.fabricColourId ? { fabricColourId: l.fabricColourId } : {}),
                  ...(l.matchedTxnId ? { matchedTxnId: l.matchedTxnId } : {}),
                  ...(l.matchType ? { matchType: l.matchType } : {}),
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
    if (updateData.gstRate !== undefined) updates.gstRate = updateData.gstRate;
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
// INVOICE — UPDATE NOTES (any non-cancelled)
// ============================================

const updateInvoiceNotesInput = z.object({
  id: z.string().uuid(),
  notes: z.string().nullable(),
});

export const updateInvoiceNotes = createServerFn({ method: 'POST' })
  .middleware([authMiddleware])
  .inputValidator((input: unknown) => updateInvoiceNotesInput.parse(input))
  .handler(async ({ data }) => {
    const prisma = await getPrisma();
    const existing = await prisma.invoice.findUnique({
      where: { id: data.id },
      select: { status: true },
    });
    if (!existing) return { success: false as const, error: 'Invoice not found' };
    if (existing.status === 'cancelled') return { success: false as const, error: 'Cannot edit cancelled invoice' };

    await prisma.invoice.update({
      where: { id: data.id },
      data: { notes: data.notes },
    });
    return { success: true as const };
  });

// ============================================
// INVOICE — UPDATE DUE DATE (any non-cancelled)
// ============================================

export const updateInvoiceDueDate = createServerFn({ method: 'POST' })
  .middleware([authMiddleware])
  .inputValidator((input: unknown) =>
    z.object({ id: z.string().uuid(), dueDate: z.string().nullable() }).parse(input)
  )
  .handler(async ({ data }) => {
    const prisma = await getPrisma();
    const existing = await prisma.invoice.findUnique({
      where: { id: data.id },
      select: { status: true },
    });
    if (!existing) return { success: false as const, error: 'Invoice not found' };
    if (existing.status === 'cancelled') return { success: false as const, error: 'Cannot edit cancelled invoice' };

    await prisma.invoice.update({
      where: { id: data.id },
      data: { dueDate: data.dueDate ? new Date(data.dueDate) : null },
    });
    return { success: true as const };
  });

// ============================================
// INVOICE — CONFIRM (draft -> confirmed)
// ============================================

const confirmInvoiceInput = z.object({
  id: z.string().uuid(),
  linkedBankTransactionId: z.string().uuid().optional(),
});

export const confirmInvoice = createServerFn({ method: 'POST' })
  .middleware([authMiddleware])
  .inputValidator((input: unknown) => confirmInvoiceInput.parse(input))
  .handler(async ({ data, context }) => {
    const prisma = await getPrisma();
    const userId = context.user.id;

    const invoice = await prisma.invoice.findUnique({
      where: { id: data.id },
      select: { id: true, type: true, category: true, status: true, totalAmount: true, gstRate: true, gstAmount: true, subtotal: true, invoiceNumber: true, partyId: true, invoiceDate: true, billingPeriod: true, notes: true, lines: true },
    });

    if (!invoice) return { success: false as const, error: 'Invoice not found' };
    if (invoice.status !== 'draft') return { success: false as const, error: 'Can only confirm draft invoices' };

    // Fetch party details for TDS + TransactionType (advance-clearing vendors + expense account)
    let tdsAmount = 0;
    let expenseAccountOverride: string | null = null;
    let partyName: string | null = null;
    let periodOffset: number | null = null;
    let party: { name: string; tdsApplicable: boolean; tdsRate: number | null; tdsSection: string | null; billingPeriodOffsetMonths: number | null; transactionType: { debitAccountCode: string | null } | null } | null = null;
    if (invoice.type === 'payable' && invoice.partyId) {
      party = await prisma.party.findUnique({
        where: { id: invoice.partyId },
        select: { name: true, tdsApplicable: true, tdsRate: true, tdsSection: true, billingPeriodOffsetMonths: true, transactionType: { select: { debitAccountCode: true } } },
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

    // ---- LINKED BANK TXN PATH (already-paid bill) ----
    if (data.linkedBankTransactionId && invoice.type === 'payable') {
      return confirmInvoiceWithLinkedBankTxn(prisma, invoice, data.linkedBankTransactionId, tdsAmount, userId, expenseAccountOverride, partyName, periodOffset, party);
    }

    // ---- FABRIC: Create FabricColourTransactions for matched lines ----
    if (invoice.category === 'fabric' && invoice.lines) {
      for (const line of invoice.lines) {
        if (!line.fabricColourId) continue;
        if (line.matchedTxnId) continue; // Already linked to an existing transaction

        // Create new inward transaction for unmatched fabric lines
        const newTxn = await prisma.fabricColourTransaction.create({
          data: {
            fabricColourId: line.fabricColourId,
            txnType: 'inward',
            qty: line.qty ?? 0,
            unit: line.unit ?? 'meter',
            reason: 'supplier_receipt',
            costPerUnit: line.rate ?? undefined,
            ...(invoice.partyId ? { partyId: invoice.partyId } : {}),
            referenceId: `invoice:${invoice.id}`,
            notes: `From invoice ${invoice.invoiceNumber ?? invoice.id}${line.description ? ` — ${line.description}` : ''}`,
            createdById: userId,
          },
        });

        // Link the transaction to the invoice line
        await prisma.invoiceLine.update({
          where: { id: line.id },
          data: { matchedTxnId: newTxn.id, matchType: 'new_entry' },
        });
      }
    }

    // ---- NORMAL AP PATH (invoice first, pay later) ----
    const invoiceEntryDate = invoice.invoiceDate ? new Date(invoice.invoiceDate) : new Date();
    let derivedPeriod = dateToPeriod(invoiceEntryDate);
    if (periodOffset) derivedPeriod = applyPeriodOffset(derivedPeriod, periodOffset);
    await prisma.invoice.update({
      where: { id: invoice.id },
      data: {
        status: 'confirmed',
        ...(tdsAmount > 0 ? { tdsAmount, tdsRate: party?.tdsRate ?? null, tdsSection: party?.tdsSection ?? null, balanceDue: invoice.totalAmount - tdsAmount } : {}),
        // Derive gstRate if not already set and we have the amounts to compute it
        ...(!invoice.gstRate && invoice.gstAmount && invoice.gstAmount > 0 && invoice.totalAmount > invoice.gstAmount
          ? { gstRate: Math.round((invoice.gstAmount / (invoice.totalAmount - invoice.gstAmount)) * 10000) / 100 }
          : {}),
        // Default billingPeriod from invoiceDate (with party offset) if not set
        ...(!invoice.billingPeriod ? { billingPeriod: derivedPeriod } : {}),
      },
    });

    return { success: true as const };
  });

/**
 * Confirm an invoice and link it to an existing bank transaction.
 * Creates Allocation (bankTxn -> invoice match), updates bankTxn matched/unmatched amounts,
 * and marks invoice as paid.
 *
 * The match amount uses the net payable (totalAmount - tdsAmount) because TDS is withheld
 * and never paid to the vendor.
 */
async function confirmInvoiceWithLinkedBankTxn(
  prisma: Awaited<ReturnType<typeof getPrisma>>,
  invoice: { id: string; category: string; totalAmount: number; gstRate: number | null; gstAmount: number | null; subtotal: number | null; invoiceNumber: string | null; partyId: string | null; invoiceDate: Date | null; billingPeriod: string | null; notes: string | null },
  bankTransactionId: string,
  tdsAmount: number,
  userId: string,
  _expenseAccountOverride: string | null = null,
  partyName: string | null = null,
  periodOffset: number | null = null,
  party: { tdsRate: number | null; tdsSection: string | null } | null = null,
) {
  // The amount the vendor was actually paid (total minus TDS withheld)
  const matchAmount = invoice.totalAmount - tdsAmount;

  const bankTxn = await prisma.bankTransaction.findUnique({
    where: { id: bankTransactionId },
    select: {
      id: true, amount: true, unmatchedAmount: true, matchedAmount: true,
      status: true, txnDate: true, debitAccountCode: true, notes: true,
    },
  });
  if (!bankTxn) throw new Error('Bank transaction not found');
  if (bankTxn.unmatchedAmount < matchAmount - 0.01) throw new Error('Bank transaction unmatched amount is less than invoice net payable');

  // Inherit invoice notes or auto-generate narration if bank txn doesn't have notes
  let narration: string | null = null;
  if (!bankTxn.notes) {
    narration = invoice.notes || generatePaymentNarration({
      partyName,
      category: invoice.category,
      invoiceNumber: invoice.invoiceNumber,
      billingPeriod: invoice.billingPeriod,
    });
  }

  // Use a transaction to keep all writes atomic
  return prisma.$transaction(async (tx) => {
    // Create allocation (bankTxn -> invoice match)
    await tx.allocation.create({
      data: {
        bankTransactionId,
        invoiceId: invoice.id,
        amount: matchAmount,
        notes: 'Auto-linked on invoice confirm',
        matchedById: userId,
      },
    });

    // Update BankTransaction: matched/unmatched amounts + narration
    await tx.bankTransaction.update({
      where: { id: bankTransactionId },
      data: {
        matchedAmount: bankTxn.matchedAmount + matchAmount,
        unmatchedAmount: Math.max(0, bankTxn.unmatchedAmount - matchAmount),
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
        ...(tdsAmount > 0 ? { tdsAmount, tdsRate: party?.tdsRate ?? null, tdsSection: party?.tdsSection ?? null } : {}),
        // Derive gstRate if not already set
        ...(!invoice.gstRate && invoice.gstAmount && invoice.gstAmount > 0 && invoice.totalAmount > invoice.gstAmount
          ? { gstRate: Math.round((invoice.gstAmount / (invoice.totalAmount - invoice.gstAmount)) * 10000) / 100 }
          : {}),
        // Default billingPeriod from invoiceDate (with party offset) if not set
        ...(!invoice.billingPeriod ? {
          billingPeriod: (() => {
            const base = dateToPeriod(invoice.invoiceDate ? new Date(invoice.invoiceDate) : new Date(bankTxn.txnDate));
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
    case 'marketplace_commission':
      return 'Marketplace Commission';
    case 'marketplace_promo':
      return 'Promotional & Banner';
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
// INVOICE LINES — UPDATE (draft only, for fabric matching)
// ============================================

const UpdateInvoiceLineSchema = z.object({
  id: z.string().uuid(),
  description: z.string().nullable().optional(),
  hsnCode: z.string().nullable().optional(),
  qty: z.number().nullable().optional(),
  unit: z.string().nullable().optional(),
  rate: z.number().nullable().optional(),
  amount: z.number().nullable().optional(),
  gstPercent: z.number().nullable().optional(),
  gstAmount: z.number().nullable().optional(),
  fabricColourId: z.string().uuid().nullable().optional(),
  matchedTxnId: z.string().uuid().nullable().optional(),
  matchType: z.enum(['auto_matched', 'manual_matched', 'new_entry']).nullable().optional(),
});

const updateInvoiceLinesInput = z.object({
  invoiceId: z.string().uuid(),
  lines: z.array(UpdateInvoiceLineSchema).min(1),
});

export const updateInvoiceLines = createServerFn({ method: 'POST' })
  .middleware([authMiddleware])
  .inputValidator((input: unknown) => updateInvoiceLinesInput.parse(input))
  .handler(async ({ data }) => {
    const prisma = await getPrisma();

    const invoice = await prisma.invoice.findUnique({
      where: { id: data.invoiceId },
      select: { status: true },
    });
    if (!invoice) return { success: false as const, error: 'Invoice not found' };
    if (invoice.status !== 'draft') return { success: false as const, error: 'Can only edit draft invoice lines' };

    for (const line of data.lines) {
      const { id: lineId, ...updates } = line;
      const lineData: Record<string, unknown> = {};
      for (const [key, value] of Object.entries(updates)) {
        if (value !== undefined) lineData[key] = value;
      }
      if (Object.keys(lineData).length > 0) {
        const updated = await prisma.invoiceLine.updateMany({
          where: { id: lineId, invoiceId: data.invoiceId },
          data: lineData,
        });
        if (updated.count === 0) {
          return { success: false as const, error: `Line ${lineId} does not belong to this invoice` };
        }
      }
    }

    return { success: true as const };
  });

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
      // 1. Clean up allocations (restore unmatched amounts on linked bank transactions)
      const matches = await tx.allocation.findMany({
        where: { invoiceId: data.id },
      });
      if (matches.length > 0) {
        for (const match of matches) {
          if (match.bankTransactionId) {
            await tx.bankTransaction.update({
              where: { id: match.bankTransactionId },
              data: {
                matchedAmount: { decrement: match.amount },
                unmatchedAmount: { increment: match.amount },
              },
            });
          }
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
