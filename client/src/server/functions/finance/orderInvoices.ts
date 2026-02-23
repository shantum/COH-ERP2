/**
 * Order Invoice Server Functions
 *
 * Handles the order → invoice pipeline:
 * - Get invoice for an order
 * - Confirm invoice (assign number, link payment)
 * - List order invoices
 */

'use server';

import { createServerFn } from '@tanstack/react-start';
import { z } from 'zod';
import { authMiddleware } from '../../middleware/auth';
import { getPrisma } from '@coh/shared/services/db';

// ============================================
// HELPERS
// ============================================

interface SequenceResult {
  currentNumber: number;
  fiscalYear: string;
}

/** Get Indian fiscal year string for a date. Apr-Mar cycle. */
function getFiscalYear(date: Date = new Date()): string {
  const month = date.getMonth();
  const year = date.getFullYear();
  const startYear = month >= 3 ? year : year - 1;
  const endYear = startYear + 1;
  return `${String(startYear).slice(2)}-${String(endYear).slice(2)}`;
}

/**
 * Atomically assign next invoice number via UPDATE ... RETURNING.
 * NOTE: Inlined here because server functions cannot import from @server/.
 */
async function assignNextInvoiceNumber(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  tx: any,
  prefix = 'COH',
): Promise<string> {
  const fiscalYear = getFiscalYear();
  const result = await tx.$queryRaw<SequenceResult[]>`
    UPDATE "InvoiceSequence"
    SET "currentNumber" = "currentNumber" + 1,
        "fiscalYear" = ${fiscalYear}
    WHERE "prefix" = ${prefix}
    RETURNING "currentNumber", "fiscalYear"
  `;
  if (!result || result.length === 0) {
    throw new Error(`InvoiceSequence not found for prefix "${prefix}"`);
  }
  const { currentNumber, fiscalYear: fy } = result[0];
  return `${prefix}/${fy}/${String(currentNumber).padStart(5, '0')}`;
}

// ============================================
// GET ORDER INVOICE
// ============================================

const getOrderInvoiceInput = z.object({
  orderId: z.string().uuid(),
});

export const getOrderInvoice = createServerFn({ method: 'GET' })
  .middleware([authMiddleware])
  .inputValidator((input: unknown) => getOrderInvoiceInput.parse(input))
  .handler(async ({ data }) => {
    const prisma = await getPrisma();

    const invoice = await prisma.invoice.findFirst({
      where: { orderId: data.orderId, category: 'customer_order' },
      include: {
        lines: {
          select: {
            id: true,
            description: true,
            hsnCode: true,
            qty: true,
            rate: true,
            amount: true,
            gstPercent: true,
            gstAmount: true,
            orderLineId: true,
          },
        },
        customer: { select: { id: true, email: true, firstName: true, lastName: true } },
      },
    });

    if (!invoice) return { success: false as const, error: 'No invoice found for this order' };

    const { fileData: _, ...rest } = invoice;
    return { success: true as const, invoice: rest };
  });

// ============================================
// CONFIRM ORDER INVOICE (assign number + mark paid)
// ============================================

const confirmOrderInvoiceInput = z.object({
  invoiceId: z.string().uuid(),
  bankTransactionId: z.string().uuid().optional(),
});

export const confirmOrderInvoice = createServerFn({ method: 'POST' })
  .middleware([authMiddleware])
  .inputValidator((input: unknown) => confirmOrderInvoiceInput.parse(input))
  .handler(async ({ data, context }) => {
    const prisma = await getPrisma();
    const userId = context.user.id;

    const invoice = await prisma.invoice.findUnique({
      where: { id: data.invoiceId },
      select: {
        id: true,
        status: true,
        category: true,
        totalAmount: true,
        orderId: true,
      },
    });

    if (!invoice) return { success: false as const, error: 'Invoice not found' };
    if (invoice.status !== 'draft') return { success: false as const, error: 'Can only confirm draft invoices' };
    if (invoice.category !== 'customer_order') return { success: false as const, error: 'Not a customer order invoice' };

    return prisma.$transaction(async (tx) => {
      // Validate bank transaction before any mutations
      let bankTxn: { id: string; matchedAmount: number; unmatchedAmount: number; status: string } | null = null;
      if (data.bankTransactionId) {
        bankTxn = await tx.bankTransaction.findUnique({
          where: { id: data.bankTransactionId },
          select: { id: true, matchedAmount: true, unmatchedAmount: true, status: true },
        });

        if (!bankTxn) {
          return { success: false as const, error: 'Bank transaction not found' };
        }
        if (bankTxn.status !== 'posted' && bankTxn.status !== 'legacy_posted') {
          return { success: false as const, error: 'Bank transaction is not posted' };
        }
        if (bankTxn.unmatchedAmount < invoice.totalAmount - 0.01) {
          return { success: false as const, error: `Bank transaction unmatched balance (${bankTxn.unmatchedAmount.toFixed(2)}) is less than invoice amount (${invoice.totalAmount.toFixed(2)})` };
        }
      }

      // Assign sequential invoice number (atomic, gap-free)
      const invoiceNumber = await assignNextInvoiceNumber(tx);

      // Update invoice: confirm + assign number
      await tx.invoice.update({
        where: { id: invoice.id },
        data: {
          status: 'paid',
          invoiceNumber,
          paidAmount: invoice.totalAmount,
          balanceDue: 0,
        },
      });

      // Create allocation if bank transaction provided
      if (data.bankTransactionId && bankTxn) {
        await tx.allocation.create({
          data: {
            bankTransactionId: data.bankTransactionId,
            invoiceId: invoice.id,
            amount: invoice.totalAmount,
            notes: 'Order payment — auto-linked on confirm',
            matchedById: userId,
          },
        });

        await tx.bankTransaction.update({
          where: { id: data.bankTransactionId },
          data: {
            matchedAmount: bankTxn.matchedAmount + invoice.totalAmount,
            unmatchedAmount: Math.max(0, bankTxn.unmatchedAmount - invoice.totalAmount),
          },
        });
      }

      // Update order payment status
      if (invoice.orderId) {
        await tx.order.update({
          where: { id: invoice.orderId },
          data: {
            paymentConfirmedAt: new Date(),
            paymentConfirmedBy: userId,
          },
        });
      }

      return { success: true as const, invoiceNumber };
    });
  });

// ============================================
// LIST ORDER INVOICES
// ============================================

const listOrderInvoicesInput = z.object({
  status: z.enum(['draft', 'confirmed', 'paid', 'cancelled']).optional(),
  search: z.string().optional(),
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().positive().max(200).default(50),
}).optional();

export const listOrderInvoices = createServerFn({ method: 'POST' })
  .middleware([authMiddleware])
  .inputValidator((input: unknown) => (listOrderInvoicesInput ?? z.undefined()).parse(input))
  .handler(async ({ data }) => {
    const prisma = await getPrisma();
    const { status, search, page = 1, limit = 50 } = data ?? {};
    const skip = (page - 1) * limit;

    const where: Record<string, unknown> = {
      category: 'customer_order',
      type: 'receivable',
    };

    if (status) where.status = status;
    if (search) {
      where.OR = [
        { invoiceNumber: { contains: search, mode: 'insensitive' } },
        { order: { orderNumber: { contains: search, mode: 'insensitive' } } },
        { customer: { firstName: { contains: search, mode: 'insensitive' } } },
      ];
    }

    const [invoices, total] = await Promise.all([
      prisma.invoice.findMany({
        where,
        select: {
          id: true,
          invoiceNumber: true,
          status: true,
          invoiceDate: true,
          subtotal: true,
          gstAmount: true,
          gstType: true,
          cgstAmount: true,
          sgstAmount: true,
          igstAmount: true,
          totalAmount: true,
          paidAmount: true,
          balanceDue: true,
          billingPeriod: true,
          createdAt: true,
          order: {
            select: {
              id: true,
              orderNumber: true,
              customerName: true,
              paymentMethod: true,
              customerState: true,
            },
          },
          customer: { select: { id: true, firstName: true, lastName: true } },
        },
        orderBy: [{ invoiceDate: 'desc' }, { createdAt: 'desc' }],
        skip,
        take: limit,
      }),
      prisma.invoice.count({ where }),
    ]);

    return { success: true as const, invoices, total, page, limit };
  });
