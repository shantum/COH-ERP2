/**
 * RazorpayX Webhook Event Handler
 *
 * Processes payout lifecycle events and transaction events from RazorpayX.
 * Creates/updates BankTransactions and Allocations automatically.
 *
 * Events handled:
 * - payout.processed  → Create BankTransaction + link to invoice if reference_id present
 * - payout.reversed   → Create reversal BankTransaction
 * - payout.failed     → Log failure, alert
 * - payout.cancelled  → Log cancellation
 * - payout.queued     → Log status
 * - payout.initiated  → Log status
 * - transaction.created → Import non-payout transactions (deposits, charges, adjustments)
 */

import { createHash, randomUUID } from 'crypto';
import type { PrismaClient, Prisma } from '@prisma/client';
import { dateToPeriod } from '@coh/shared';
import type { RazorpayXPayout, RazorpayXTransaction } from './client.js';
import logger from '../../utils/logger.js';

const log = logger.child({ module: 'razorpayx-webhook' });

// ============================================
// TYPES
// ============================================

export interface RazorpayXFundAccountValidation {
  id: string;
  entity: 'fund_account.validation';
  fund_account: {
    id: string;
    entity: 'fund_account';
    contact_id: string;
    account_type: string;
    bank_account?: {
      ifsc: string;
      bank_name: string;
      name: string;
      notes: string[];
      account_number: string;
    };
  };
  status: 'completed' | 'failed';
  results?: {
    account_status: 'active' | 'invalid' | null;
    registered_name: string | null;
  };
  notes?: Record<string, string>;
  created_at: number;
}

export interface RazorpayXPayoutLink {
  id: string;
  entity: 'payout_link';
  amount: number;
  currency: string;
  status: string;
  purpose: string;
  description: string | null;
  contact: { name: string; email: string | null; contact: string | null };
  receipt: string | null;
  notes: Record<string, string>;
  created_at: number;
}

export interface WebhookEvent {
  entity: 'event';
  account_id: string;
  event: string;
  contains: string[];
  payload: {
    payout?: { entity: RazorpayXPayout };
    transaction?: { entity: RazorpayXTransaction };
    'fund_account.validation'?: { entity: RazorpayXFundAccountValidation };
    payout_link?: { entity: RazorpayXPayoutLink };
    downtime?: { entity: { id: string; entity: string; scheduled: boolean; severity: string; status: string; created_at: number; updated_at: number } };
  };
  created_at: number;
}

export interface HandlerResult {
  action: string;
  payoutId?: string;
  bankTransactionId?: string;
  skipped?: boolean;
  error?: string;
  [key: string]: unknown;
}

// ============================================
// HELPERS
// ============================================

export function sha256(input: string): string {
  return createHash('sha256').update(input).digest('hex');
}

/** Convert paise to INR */
export function paiseToInr(paise: number): number {
  return Math.round(paise) / 100;
}

/** Check if a BankTransaction with this hash already exists */
export async function txnExists(prisma: PrismaClient, txnHash: string): Promise<boolean> {
  const existing = await prisma.bankTransaction.findUnique({
    where: { txnHash },
    select: { id: true },
  });
  return existing !== null;
}

// ============================================
// MAIN DISPATCHER
// ============================================

export async function handleWebhookEvent(
  prisma: PrismaClient,
  event: WebhookEvent,
): Promise<HandlerResult> {
  const eventType = event.event;

  log.info({ event: eventType }, 'Processing RazorpayX webhook event');

  // Payout events (payout.processed, payout.reversed, payout.failed, etc.)
  if (eventType.startsWith('payout.') && !eventType.startsWith('payout_link.') && !eventType.startsWith('payout.downtime.') && event.payload.payout) {
    const payout = event.payload.payout.entity;
    return handlePayoutEvent(prisma, eventType, payout);
  }

  // Transaction events
  if (eventType === 'transaction.created' && event.payload.transaction) {
    const transaction = event.payload.transaction.entity;
    return handleTransactionCreated(prisma, transaction);
  }

  // Fund account validation events
  if (eventType.startsWith('fund_account.validation.')) {
    const validation = event.payload['fund_account.validation']?.entity;
    return handleFundAccountValidation(prisma, eventType, validation);
  }

  // Payout link events
  if (eventType.startsWith('payout_link.')) {
    const payoutLink = event.payload.payout_link?.entity;
    return handlePayoutLinkEvent(eventType, payoutLink);
  }

  // Payout downtime events
  if (eventType.startsWith('payout.downtime.')) {
    const downtimeEntity = event.payload.downtime?.entity;
    return handlePayoutDowntime(eventType, downtimeEntity);
  }

  log.warn({ event: eventType }, 'Unhandled RazorpayX webhook event type');
  return { action: 'ignored', skipped: true };
}

// ============================================
// PAYOUT EVENT HANDLERS
// ============================================

async function handlePayoutEvent(
  prisma: PrismaClient,
  eventType: string,
  payout: RazorpayXPayout,
): Promise<HandlerResult> {
  const payoutId = payout.id;

  switch (eventType) {
    case 'payout.processed':
      return handlePayoutProcessed(prisma, payout);

    case 'payout.reversed':
      return handlePayoutReversed(prisma, payout);

    case 'payout.failed':
    case 'payout.rejected':
      return handlePayoutFailed(prisma, payout, eventType);

    case 'payout.cancelled':
      return handlePayoutCancelled(prisma, payout);

    case 'payout.queued':
    case 'payout.initiated':
    case 'payout.pending':
    case 'payout.updated':
      log.info({ payoutId, status: payout.status }, 'Payout status update');
      return { action: 'status_logged', payoutId };

    default:
      log.warn({ eventType, payoutId }, 'Unknown payout event');
      return { action: 'ignored', payoutId, skipped: true };
  }
}

/**
 * payout.processed — Money has been delivered.
 * Create a BankTransaction (debit) and optionally link to invoice.
 */
async function handlePayoutProcessed(
  prisma: PrismaClient,
  payout: RazorpayXPayout,
): Promise<HandlerResult> {
  const payoutId = payout.id;
  const txnHash = sha256(`razorpayx_payout|${payoutId}`);

  // Idempotency: skip if we already have this transaction (from CSV import or prior webhook)
  if (await txnExists(prisma, txnHash)) {
    log.info({ payoutId }, 'Payout already imported, skipping');
    return { action: 'already_exists', payoutId, skipped: true };
  }

  const amountInr = paiseToInr(payout.amount);
  const feesInr = paiseToInr(payout.fees);
  const taxInr = paiseToInr(payout.tax);
  const processedAt = new Date(payout.created_at * 1000);
  const contactName = payout.fund_account?.bank_account?.name ?? '';
  const purpose = payout.purpose ?? '';

  // Try to find linked Party via:
  // 1. reference_id in notes.partyId
  // 2. razorpayContactId on Party
  // 3. Name matching (fallback)
  const partyId = await resolvePartyId(prisma, payout);

  // Determine accounting codes based on purpose
  const { debitAccount, creditAccount, category } = resolvePayoutAccounting(purpose, partyId !== null);

  const bankTxnId = randomUUID();

  // Create BankTransaction
  await prisma.bankTransaction.create({
    data: {
      id: bankTxnId,
      bank: 'razorpayx',
      txnHash,
      rawData: payout as unknown as Prisma.JsonObject,
      txnDate: processedAt,
      amount: amountInr,
      direction: 'debit',
      narration: `${purpose}: ${contactName}`.trim(),
      reference: payoutId,
      utr: payout.utr ?? undefined,
      counterpartyName: contactName || undefined,
      period: dateToPeriod(processedAt),
      legacySourceId: payoutId,
      debitAccountCode: debitAccount,
      creditAccountCode: creditAccount,
      category,
      ...(partyId ? { partyId } : {}),
      status: 'categorized',
      matchedAmount: 0,
      unmatchedAmount: 0,
    },
  });

  log.info({
    payoutId,
    bankTxnId,
    amount: amountInr,
    utr: payout.utr,
    partyId,
  }, 'Created BankTransaction from payout webhook');

  // If we have payout fees, create a separate transaction for the fee
  if (feesInr > 0) {
    const feeHash = sha256(`razorpayx_fee|${payoutId}`);
    if (!(await txnExists(prisma, feeHash))) {
      await prisma.bankTransaction.create({
        data: {
          id: randomUUID(),
          bank: 'razorpayx',
          txnHash: feeHash,
          rawData: { type: 'payout_fee', payoutId, fees: feesInr, tax: taxInr } as Prisma.JsonObject,
          txnDate: processedAt,
          amount: feesInr,
          direction: 'debit',
          narration: `RazorpayX fee: ${payoutId}`,
          reference: `fee_${payoutId}`,
          period: dateToPeriod(processedAt),
          legacySourceId: `fee_${payoutId}`,
          debitAccountCode: 'MARKETPLACE_FEES',
          creditAccountCode: 'BANK_RAZORPAYX',
          category: 'bank_charges',
          status: 'categorized',
          matchedAmount: 0,
          unmatchedAmount: 0,
        },
      });
      log.info({ payoutId, fee: feesInr }, 'Created fee BankTransaction');
    }
  }

  // Try to auto-match to invoice if reference_id or notes contain invoiceId
  const invoiceId = payout.reference_id || payout.notes?.invoiceId;
  let allocationId: string | undefined;

  if (invoiceId) {
    allocationId = await tryAutoMatchInvoice(prisma, bankTxnId, invoiceId, amountInr);
  }

  return {
    action: 'payout_imported',
    payoutId,
    bankTransactionId: bankTxnId,
    amount: amountInr,
    ...(allocationId ? { allocationId } : {}),
  };
}

/**
 * payout.reversed — Money returned after processing.
 * Create a credit BankTransaction to reverse the original debit.
 */
async function handlePayoutReversed(
  prisma: PrismaClient,
  payout: RazorpayXPayout,
): Promise<HandlerResult> {
  const payoutId = payout.id;
  const reversalHash = sha256(`razorpayx_reversal|${payoutId}`);

  if (await txnExists(prisma, reversalHash)) {
    return { action: 'reversal_already_exists', payoutId, skipped: true };
  }

  const amountInr = paiseToInr(payout.amount);
  const processedAt = new Date(payout.created_at * 1000);
  const contactName = payout.fund_account?.bank_account?.name ?? '';

  const bankTxnId = randomUUID();

  // Create reversal as a credit (money coming back)
  await prisma.bankTransaction.create({
    data: {
      id: bankTxnId,
      bank: 'razorpayx',
      txnHash: reversalHash,
      rawData: payout as unknown as Prisma.JsonObject,
      txnDate: processedAt,
      amount: amountInr,
      direction: 'credit',
      narration: `Reversal: ${payout.purpose}: ${contactName}`.trim(),
      reference: `rev_${payoutId}`,
      utr: payout.utr ?? undefined,
      counterpartyName: contactName || undefined,
      period: dateToPeriod(processedAt),
      legacySourceId: `rev_${payoutId}`,
      debitAccountCode: 'BANK_RAZORPAYX',
      creditAccountCode: 'UNMATCHED_PAYMENTS',
      status: 'categorized',
      matchedAmount: 0,
      unmatchedAmount: 0,
    },
  });

  // If original payout had an allocation, undo it
  const invoiceId = payout.reference_id || payout.notes?.invoiceId;
  if (invoiceId) {
    await undoInvoiceAllocation(prisma, payoutId, invoiceId);
  }

  log.info({ payoutId, bankTxnId, amount: amountInr }, 'Created reversal BankTransaction');

  return { action: 'reversal_imported', payoutId, bankTransactionId: bankTxnId };
}

/**
 * payout.failed / payout.rejected — Payout didn't go through.
 * No BankTransaction needed. Log the failure reason.
 */
async function handlePayoutFailed(
  prisma: PrismaClient,
  payout: RazorpayXPayout,
  eventType: string,
): Promise<HandlerResult> {
  const reason = payout.failure_reason
    || payout.status_details?.description
    || 'Unknown failure';

  log.warn({
    payoutId: payout.id,
    status: payout.status,
    reason,
    amount: paiseToInr(payout.amount),
    referenceId: payout.reference_id,
  }, `Payout ${eventType.split('.')[1]}`);

  return {
    action: eventType.split('.')[1] ?? 'failed',
    payoutId: payout.id,
    reason,
  };
}

/**
 * payout.cancelled — Payout was cancelled before processing.
 */
async function handlePayoutCancelled(
  prisma: PrismaClient,
  payout: RazorpayXPayout,
): Promise<HandlerResult> {
  log.info({
    payoutId: payout.id,
    amount: paiseToInr(payout.amount),
    referenceId: payout.reference_id,
  }, 'Payout cancelled');

  return { action: 'cancelled', payoutId: payout.id };
}

// ============================================
// TRANSACTION EVENT HANDLER
// ============================================

/**
 * transaction.created — New account transaction (deposits, charges, adjustments).
 * Only imports transactions that are NOT from payouts (those come via payout events).
 */
async function handleTransactionCreated(
  prisma: PrismaClient,
  transaction: RazorpayXTransaction,
): Promise<HandlerResult> {
  const txnId = transaction.id;
  const sourceEntity = transaction.source?.entity;

  // Skip payout transactions — those are handled by payout.processed events
  if (sourceEntity === 'payout') {
    return { action: 'skipped_payout_txn', skipped: true };
  }

  const txnHash = sha256(`razorpayx_txn|${txnId}`);

  if (await txnExists(prisma, txnHash)) {
    return { action: 'already_exists', skipped: true };
  }

  const amountInr = paiseToInr(transaction.amount);
  const isCredit = transaction.credit > 0;
  const txnDate = new Date(transaction.created_at * 1000);

  // Determine accounting by source type
  let debitAccount: string;
  let creditAccount: string;
  let narration: string;
  let category: string | undefined;

  if (isCredit) {
    // Money coming in (transfer from HDFC, external deposit, reversal)
    debitAccount = 'BANK_RAZORPAYX';
    creditAccount = 'UNMATCHED_PAYMENTS';
    narration = `Deposit: ${sourceEntity ?? 'external'} (${txnId})`;
  } else {
    // Money going out (bank charges, adjustments)
    debitAccount = 'OPERATING_EXPENSES';
    creditAccount = 'BANK_RAZORPAYX';
    narration = `Charge: ${sourceEntity ?? 'external'} (${txnId})`;
    category = 'bank_charges';
  }

  const bankTxnId = randomUUID();

  await prisma.bankTransaction.create({
    data: {
      id: bankTxnId,
      bank: 'razorpayx',
      txnHash,
      rawData: transaction as unknown as Prisma.JsonObject,
      txnDate,
      amount: amountInr,
      direction: isCredit ? 'credit' : 'debit',
      narration,
      reference: txnId,
      period: dateToPeriod(txnDate),
      legacySourceId: txnId,
      debitAccountCode: debitAccount,
      creditAccountCode: creditAccount,
      ...(category ? { category } : {}),
      status: 'categorized',
      matchedAmount: 0,
      unmatchedAmount: 0,
    },
  });

  log.info({
    txnId,
    bankTxnId,
    amount: amountInr,
    direction: isCredit ? 'credit' : 'debit',
    source: sourceEntity,
  }, 'Created BankTransaction from transaction webhook');

  return { action: 'transaction_imported', bankTransactionId: bankTxnId };
}

// ============================================
// INVOICE MATCHING HELPERS
// ============================================

/**
 * Resolve Party ID from payout metadata.
 * Priority: notes.partyId → razorpayContactId lookup → name match
 */
export async function resolvePartyId(
  prisma: PrismaClient,
  payout: RazorpayXPayout,
): Promise<string | null> {
  // 1. Direct partyId in notes
  if (payout.notes?.partyId) {
    const party = await prisma.party.findUnique({
      where: { id: payout.notes.partyId },
      select: { id: true },
    });
    if (party) return party.id;
  }

  // 2. Lookup by razorpayContactId (if we synced contacts)
  if (payout.fund_account?.contact_id) {
    const party = await prisma.party.findFirst({
      where: { razorpayContactId: payout.fund_account.contact_id },
      select: { id: true },
    });
    if (party) return party.id;
  }

  // 3. Fuzzy name match on counterparty
  const contactName = payout.fund_account?.bank_account?.name;
  if (contactName) {
    const party = await prisma.party.findFirst({
      where: {
        isActive: true,
        OR: [
          { name: { equals: contactName, mode: 'insensitive' } },
          { aliases: { has: contactName.toUpperCase() } },
        ],
      },
      select: { id: true },
    });
    if (party) return party.id;
  }

  return null;
}

/**
 * Map payout purpose to chart of accounts.
 */
export function resolvePayoutAccounting(purpose: string, hasParty: boolean): {
  debitAccount: string;
  creditAccount: string;
  category: string | undefined;
} {
  const creditAccount = 'BANK_RAZORPAYX';

  switch (purpose) {
    case 'salary':
      return { debitAccount: 'OPERATING_EXPENSES', creditAccount, category: 'salary' };
    case 'refund':
      return { debitAccount: 'SALES_REVENUE', creditAccount, category: 'refund' };
    case 'vendor bill':
      // Vendor bills with known party go through their TransactionType,
      // but at webhook time we default to ACCOUNTS_PAYABLE.
      // The categorization step will refine this.
      return {
        debitAccount: hasParty ? 'ACCOUNTS_PAYABLE' : 'UNMATCHED_PAYMENTS',
        creditAccount,
        category: 'vendor_bill',
      };
    case 'utility bill':
      return { debitAccount: 'OPERATING_EXPENSES', creditAccount, category: 'utility' };
    default:
      return { debitAccount: 'UNMATCHED_PAYMENTS', creditAccount, category: undefined };
  }
}

/**
 * Try to match a BankTransaction to an Invoice and create an Allocation.
 * Only matches if the invoice exists, is payable, and the amounts align.
 */
async function tryAutoMatchInvoice(
  prisma: PrismaClient,
  bankTxnId: string,
  invoiceId: string,
  amount: number,
): Promise<string | undefined> {
  try {
    const invoice = await prisma.invoice.findUnique({
      where: { id: invoiceId },
      select: {
        id: true,
        type: true,
        status: true,
        totalAmount: true,
        tdsAmount: true,
        paidAmount: true,
        balanceDue: true,
      },
    });

    if (!invoice) {
      log.warn({ invoiceId, bankTxnId }, 'Invoice not found for auto-match');
      return undefined;
    }

    // Only auto-match payable invoices that aren't already fully paid
    if (invoice.type !== 'payable' || invoice.status === 'paid' || invoice.status === 'cancelled') {
      log.info({ invoiceId, status: invoice.status }, 'Invoice not eligible for auto-match');
      return undefined;
    }

    // Amount tolerance: exact match or within ₹1 (paise rounding)
    const expectedAmount = invoice.balanceDue;
    if (Math.abs(amount - expectedAmount) > 1) {
      log.info({
        invoiceId,
        payoutAmount: amount,
        balanceDue: expectedAmount,
      }, 'Amount mismatch — skipping auto-match');
      return undefined;
    }

    // Need a user ID for matchedById — use admin user for automated matches
    const admin = await prisma.user.findFirst({ where: { role: 'admin' } });
    if (!admin) {
      log.error('No admin user found for auto-match matchedById');
      return undefined;
    }

    // Create allocation and update both records in a transaction
    const allocationId = randomUUID();

    await prisma.$transaction([
      prisma.allocation.create({
        data: {
          id: allocationId,
          bankTransactionId: bankTxnId,
          invoiceId,
          amount,
          matchedById: admin.id,
        },
      }),
      prisma.bankTransaction.update({
        where: { id: bankTxnId },
        data: {
          matchedAmount: amount,
          unmatchedAmount: 0,
          matchedInvoiceId: invoiceId,
          status: 'posted',
        },
      }),
      prisma.invoice.update({
        where: { id: invoiceId },
        data: {
          paidAmount: { increment: amount },
          balanceDue: { decrement: amount },
          status: (invoice.balanceDue - amount) <= 1 ? 'paid' : 'partially_paid',
        },
      }),
    ]);

    log.info({ allocationId, invoiceId, bankTxnId, amount }, 'Auto-matched payout to invoice');
    return allocationId;
  } catch (err) {
    log.error({ err, invoiceId, bankTxnId }, 'Failed to auto-match invoice');
    return undefined;
  }
}

/**
 * Undo an invoice allocation when a payout is reversed.
 */
async function undoInvoiceAllocation(
  prisma: PrismaClient,
  payoutId: string,
  invoiceId: string,
): Promise<void> {
  try {
    // Find the original BankTransaction for this payout
    const originalTxnHash = sha256(`razorpayx_payout|${payoutId}`);
    const originalTxn = await prisma.bankTransaction.findUnique({
      where: { txnHash: originalTxnHash },
      select: { id: true },
    });

    if (!originalTxn) return;

    // Find allocation linking this bank txn to the invoice
    const allocation = await prisma.allocation.findFirst({
      where: { bankTransactionId: originalTxn.id, invoiceId },
      select: { id: true, amount: true },
    });

    if (!allocation) return;

    // Reverse the allocation
    await prisma.$transaction([
      prisma.allocation.delete({ where: { id: allocation.id } }),
      prisma.invoice.update({
        where: { id: invoiceId },
        data: {
          paidAmount: { decrement: allocation.amount },
          balanceDue: { increment: allocation.amount },
          status: 'confirmed', // Reopen
        },
      }),
      prisma.bankTransaction.update({
        where: { id: originalTxn.id },
        data: {
          matchedAmount: { decrement: allocation.amount },
          unmatchedAmount: { increment: allocation.amount },
          matchedInvoiceId: null,
        },
      }),
    ]);

    log.info({ payoutId, invoiceId, amount: allocation.amount }, 'Reversed invoice allocation');
  } catch (err) {
    log.error({ err, payoutId, invoiceId }, 'Failed to undo invoice allocation');
  }
}

// ============================================
// FUND ACCOUNT VALIDATION HANDLERS
// ============================================

/**
 * fund_account.validation.completed / fund_account.validation.failed
 *
 * RazorpayX validates bank accounts via penny testing.
 * On completion, we can store the validation result (registered_name, active status).
 */
async function handleFundAccountValidation(
  prisma: PrismaClient,
  eventType: string,
  validation: RazorpayXFundAccountValidation | undefined,
): Promise<HandlerResult> {
  if (!validation) {
    return { action: 'ignored', skipped: true };
  }

  const contactId = validation.fund_account?.contact_id;
  const fundAccountId = validation.fund_account?.id;
  const isSuccess = eventType === 'fund_account.validation.completed' && validation.status === 'completed';
  const registeredName = validation.results?.account_status === 'active'
    ? validation.results.registered_name
    : null;

  log.info({
    eventType,
    fundAccountId,
    contactId,
    status: validation.status,
    accountStatus: validation.results?.account_status,
    registeredName,
  }, 'Fund account validation result');

  // If validation succeeded and we have a registered name, update the Party's bank name
  if (isSuccess && registeredName && contactId) {
    try {
      const party = await prisma.party.findFirst({
        where: { razorpayContactId: contactId },
        select: { id: true, bankAccountName: true },
      });

      if (party && !party.bankAccountName) {
        await prisma.party.update({
          where: { id: party.id },
          data: { bankAccountName: registeredName },
        });
        log.info({ partyId: party.id, registeredName }, 'Updated Party bank account name from validation');
      }
    } catch (err) {
      log.error({ err, contactId }, 'Failed to update party from validation');
    }
  }

  if (!isSuccess) {
    log.warn({
      fundAccountId,
      contactId,
      status: validation.status,
      accountStatus: validation.results?.account_status,
    }, 'Fund account validation failed — bank details may be incorrect');
  }

  return {
    action: isSuccess ? 'validation_completed' : 'validation_failed',
    fundAccountId,
    contactId,
    registeredName,
  };
}

// ============================================
// PAYOUT LINK HANDLERS
// ============================================

/**
 * payout_link.* events — Payout links lifecycle.
 *
 * We don't currently create payout links from the ERP, so these are
 * logged for visibility. Can be extended later if we add payout link support.
 */
function handlePayoutLinkEvent(
  eventType: string,
  payoutLink: RazorpayXPayoutLink | undefined,
): HandlerResult {
  if (!payoutLink) {
    return { action: 'ignored', skipped: true };
  }

  const status = eventType.replace('payout_link.', '');

  log.info({
    event: eventType,
    payoutLinkId: payoutLink.id,
    status,
    amount: payoutLink.amount / 100,
    contactName: payoutLink.contact?.name,
    receipt: payoutLink.receipt,
  }, `Payout link ${status}`);

  return {
    action: `payout_link_${status}`,
    payoutLinkId: payoutLink.id,
    amount: payoutLink.amount / 100,
  };
}

// ============================================
// DOWNTIME HANDLERS
// ============================================

/**
 * payout.downtime.started / payout.downtime.resolved
 *
 * RazorpayX informs when payout processing is down.
 * Log at warn level so it shows up in monitoring.
 */
function handlePayoutDowntime(
  eventType: string,
  downtime?: { id: string; entity: string; scheduled: boolean; severity: string; status: string; created_at: number; updated_at: number },
): HandlerResult {
  const isStarted = eventType === 'payout.downtime.started';

  if (isStarted) {
    log.warn({ eventType, downtime }, 'RazorpayX payout downtime STARTED — payouts may be delayed');
  } else {
    log.info({ eventType, downtime }, 'RazorpayX payout downtime RESOLVED');
  }

  return {
    action: isStarted ? 'downtime_started' : 'downtime_resolved',
    severity: downtime?.severity,
  };
}
