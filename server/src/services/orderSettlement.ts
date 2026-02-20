/**
 * Order Settlement Service
 *
 * Settles an Order's customer_order invoice when COD remittance is processed.
 * Called from both the CSV upload handler (remittance.ts) and the API sync handler (remittanceSync.ts).
 *
 * Handles:
 * - Auto-confirming draft invoices (assigns invoice number)
 * - Creating Allocation records linking bank transactions to invoices
 * - Updating BankTransaction matched/unmatched amounts
 * - Updating Invoice paidAmount/balanceDue/status
 */

import type { PrismaClient } from '@prisma/client';
import { assignNextInvoiceNumber } from '../services/invoiceNumberGenerator.js';
import logger from '../utils/logger.js';

type PrismaTransactionClient = Parameters<Parameters<PrismaClient['$transaction']>[0]>[0];

const log = logger.child({ module: 'orderSettlement' });

export interface SettleResult {
  invoiceId: string;
  invoiceNumber?: string;
  allocationId?: string;
  action: 'confirmed' | 'allocated' | 'confirmed_and_allocated' | 'already_settled' | 'no_invoice';
}

/**
 * Settle an order's customer_order invoice when COD remittance is received.
 *
 * @param tx - Prisma transaction client (caller owns the transaction boundary)
 * @param opts.orderId - The order to settle
 * @param opts.bankTransactionId - Bank transaction to allocate against (optional)
 * @param opts.amount - Settlement amount
 * @param opts.userId - User performing the settlement (for matchedById)
 * @param opts.settlementRef - Reference string for traceability (e.g. "COD-REM-456")
 */
export async function settleOrderInvoice(
  tx: PrismaTransactionClient,
  opts: {
    orderId: string;
    bankTransactionId?: string | null;
    amount: number;
    userId: string;
    settlementRef?: string;
  },
): Promise<SettleResult> {
  const { orderId, bankTransactionId, amount, userId, settlementRef } = opts;

  // 1. Find the order's customer_order invoice
  const invoice = await tx.invoice.findFirst({
    where: { orderId, category: 'customer_order' },
  });

  if (!invoice) {
    log.warn({ orderId }, 'No customer_order invoice found for order');
    return { invoiceId: '', action: 'no_invoice' };
  }

  // 2. If already paid, nothing to do
  if (invoice.status === 'paid') {
    log.info({ orderId, invoiceId: invoice.id }, 'Invoice already paid — skipping');
    return { invoiceId: invoice.id, action: 'already_settled' };
  }

  let wasConfirmed = false;
  let invoiceNumber: string | undefined;

  // 3. If draft, auto-confirm
  if (invoice.status === 'draft') {
    invoiceNumber = await assignNextInvoiceNumber(tx);

    await tx.invoice.update({
      where: { id: invoice.id },
      data: {
        status: 'confirmed',
        invoiceNumber,
        ...(invoice.invoiceDate ? {} : { invoiceDate: new Date() }),
      },
    });

    wasConfirmed = true;
    log.info({ orderId, invoiceId: invoice.id, invoiceNumber }, 'Auto-confirmed draft invoice');
  }

  // 4. If no bankTransactionId, just confirm (allocation happens later via bank import)
  if (!bankTransactionId) {
    return {
      invoiceId: invoice.id,
      ...(invoiceNumber ? { invoiceNumber } : {}),
      action: wasConfirmed ? 'confirmed' : 'already_settled',
    };
  }

  // 5. Duplicate check — avoid double allocation for same bank txn + invoice
  const existingAllocation = await tx.allocation.findFirst({
    where: { bankTransactionId, invoiceId: invoice.id },
  });

  if (existingAllocation) {
    log.info(
      { orderId, invoiceId: invoice.id, bankTransactionId },
      'Allocation already exists — skipping',
    );
    return { invoiceId: invoice.id, action: 'already_settled' };
  }

  // 6. Create allocation
  const allocation = await tx.allocation.create({
    data: {
      bankTransactionId,
      invoiceId: invoice.id,
      amount,
      matchedById: userId,
      ...(settlementRef ? { notes: settlementRef } : {}),
    },
  });

  // 7. Update BankTransaction matched/unmatched amounts
  await tx.bankTransaction.update({
    where: { id: bankTransactionId },
    data: {
      matchedAmount: { increment: amount },
      unmatchedAmount: { decrement: amount },
    },
  });

  // 8. Update Invoice paidAmount, balanceDue, status
  const newPaidAmount = invoice.paidAmount + amount;
  const newBalanceDue = Math.max(0, invoice.totalAmount - newPaidAmount);
  const newStatus = newBalanceDue <= 0.01 ? 'paid' : 'partially_paid';

  await tx.invoice.update({
    where: { id: invoice.id },
    data: {
      paidAmount: newPaidAmount,
      balanceDue: newBalanceDue,
      status: newStatus,
    },
  });

  log.info(
    { orderId, invoiceId: invoice.id, allocationId: allocation.id, amount, newStatus },
    'Order invoice settled',
  );

  return {
    invoiceId: invoice.id,
    allocationId: allocation.id,
    ...(invoiceNumber ? { invoiceNumber } : {}),
    action: wasConfirmed ? 'confirmed_and_allocated' : 'allocated',
  };
}
