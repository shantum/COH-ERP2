/**
 * Bank Import V2 — Post Service
 *
 * Confirms BankTransactions — sets unmatchedAmount and marks as posted.
 * No longer creates Payment records (Payment model is being retired).
 */

import { Prisma } from '@prisma/client';
import prisma from '../../lib/prisma.js';
import { AUTO_CLEAR_AMOUNT_THRESHOLD } from '../../config/finance/index.js';
import { generatePaymentNarration, dateToPeriod, applyPeriodOffset } from '@coh/shared';
import logger from '../../utils/logger.js';

const log = logger.child({ module: 'bank-post' });

// ============================================
// TYPES
// ============================================

export interface PostResult {
  posted: number;
  errors: number;
  singleStep: number;
  twoStep: number;
  errorDetails: string[];
}

export interface ConfirmResult {
  success: boolean;
  error?: string;
}

export interface BatchConfirmResult {
  confirmed: number;
  errors: number;
  errorDetails: string[];
}

type PostingType = 'single_step' | 'two_step';

interface PostingDecision {
  type: PostingType;
  debitAccount: string;
  creditAccount: string;
  /** The intended expense account (stored for reference on two-step) */
  intendedDebitAccount: string;
}

// ============================================
// ROUTING LOGIC
// ============================================

/**
 * Decide how to post a transaction:
 * 1. Incoming (credit) → post as-is (Dr BANK, Cr per rules)
 * 2. Outgoing < Rs 100 → single-step (Dr EXPENSE, Cr BANK)
 * 3. Outgoing, party invoiceRequired = false → single-step
 * 4. Everything else → two-step (Dr AP, Cr BANK)
 */
export function decidePosting(
  direction: string,
  amount: number,
  debitAccountCode: string,
  creditAccountCode: string,
  partyInvoiceRequired: boolean | null,
): PostingDecision {
  // Incoming transactions always post directly
  if (direction === 'credit') {
    return {
      type: 'single_step',
      debitAccount: debitAccountCode,
      creditAccount: creditAccountCode,
      intendedDebitAccount: debitAccountCode,
    };
  }

  // Small outgoing amounts — auto-clear, no AP
  if (amount < AUTO_CLEAR_AMOUNT_THRESHOLD) {
    return {
      type: 'single_step',
      debitAccount: debitAccountCode,
      creditAccount: creditAccountCode,
      intendedDebitAccount: debitAccountCode,
    };
  }

  // Party doesn't need invoices (rent, salary, bank charges, etc.)
  if (partyInvoiceRequired === false) {
    return {
      type: 'single_step',
      debitAccount: debitAccountCode,
      creditAccount: creditAccountCode,
      intendedDebitAccount: debitAccountCode,
    };
  }

  // Everything else: route through AP
  return {
    type: 'two_step',
    debitAccount: 'ACCOUNTS_PAYABLE',
    creditAccount: creditAccountCode,
    intendedDebitAccount: debitAccountCode,
  };
}

// ============================================
// CONFIRM SINGLE TRANSACTION
// ============================================

export async function confirmSingleTransaction(txnId: string): Promise<ConfirmResult> {
  // Pre-flight checks outside transaction (read-only)
  const txn = await prisma.bankTransaction.findUnique({ where: { id: txnId } });
  if (!txn) return { success: false, error: 'Transaction not found' };
  if (txn.status === 'posted' || txn.status === 'legacy_posted') {
    return { success: false, error: 'Transaction already confirmed' };
  }
  if (txn.status === 'skipped') {
    return { success: false, error: 'Transaction is skipped — unskip it first' };
  }
  if (!txn.debitAccountCode || !txn.creditAccountCode) {
    return { success: false, error: 'Missing account codes — edit the transaction first' };
  }

  // All mutations in a single transaction for atomicity
  await prisma.$transaction(async (tx) => {
    // Resolve partyId: use linked party, or try matching by counterpartyName
    let partyId = txn.partyId;
    if (!partyId && txn.counterpartyName) {
      const matched = await tx.party.findFirst({
        where: {
          isActive: true,
          OR: [
            { name: { equals: txn.counterpartyName, mode: 'insensitive' } },
            { aliases: { has: txn.counterpartyName } },
            { aliases: { has: txn.counterpartyName.toUpperCase() } },
          ],
        },
        select: { id: true },
      });
      if (matched) {
        partyId = matched.id;
      }
    }

    // Fetch party details for invoiceRequired flag + name for narration + period offset
    const party = partyId
      ? await tx.party.findUnique({ where: { id: partyId }, select: { name: true, invoiceRequired: true, billingPeriodOffsetMonths: true } })
      : null;
    const invoiceRequired = party?.invoiceRequired ?? true;

    const decision = decidePosting(txn.direction, txn.amount, txn.debitAccountCode!, txn.creditAccountCode!, invoiceRequired);
    const entryDate = new Date(txn.txnDate);
    let period = dateToPeriod(entryDate);
    if (party?.billingPeriodOffsetMonths) period = applyPeriodOffset(period, party.billingPeriodOffsetMonths);

    const narration = generatePaymentNarration({
      partyName: party?.name ?? txn.counterpartyName,
      category: txn.category,
    });

    await tx.bankTransaction.update({
      where: { id: txn.id },
      data: {
        status: 'posted',
        unmatchedAmount: txn.amount,
        intendedDebitAccount: decision.intendedDebitAccount,
        postingType: decision.type,
        period,
        ...(!txn.notes && narration ? { notes: narration } : {}),
        ...(partyId && !txn.partyId ? { partyId } : {}),
      },
    });
  });

  return { success: true };
}

// ============================================
// CONFIRM BATCH
// ============================================

export async function confirmBatch(txnIds: string[]): Promise<BatchConfirmResult> {
  let confirmed = 0;
  let errors = 0;
  const errorDetails: string[] = [];

  for (const txnId of txnIds) {
    try {
      const result = await confirmSingleTransaction(txnId);
      if (result.success) {
        confirmed++;
      } else {
        errors++;
        errorDetails.push(`${txnId}: ${result.error}`);
      }
    } catch (err) {
      errors++;
      const msg = err instanceof Error ? err.message : String(err);
      errorDetails.push(`${txnId}: ${msg}`);
    }
  }

  return { confirmed, errors, errorDetails };
}

// ============================================
// POST TRANSACTIONS (legacy batch — used by /post endpoint)
// ============================================

export async function postTransactions(options?: { bank?: string }): Promise<PostResult> {
  const where: Prisma.BankTransactionWhereInput = {
    status: { in: ['imported', 'categorized'] },
    debitAccountCode: { not: null },
    ...(options?.bank ? { bank: options.bank } : {}),
  };

  const txns = await prisma.bankTransaction.findMany({
    where,
    orderBy: { txnDate: 'asc' },
  });

  // Pre-fetch party flags (invoiceRequired + period offset)
  const partyIds = [...new Set(txns.map(t => t.partyId).filter(Boolean))] as string[];
  const parties = partyIds.length > 0
    ? await prisma.party.findMany({
        where: { id: { in: partyIds } },
        select: { id: true, name: true, invoiceRequired: true, billingPeriodOffsetMonths: true },
      })
    : [];
  const partyMap = new Map(parties.map(p => [p.id, p]));

  let posted = 0;
  let errors = 0;
  let singleStep = 0;
  let twoStep = 0;
  const errorDetails: string[] = [];
  const BATCH_SIZE = 20;

  for (let i = 0; i < txns.length; i += BATCH_SIZE) {
    const batch = txns.slice(i, i + BATCH_SIZE);

    for (const txn of batch) {
      try {
        if (!txn.debitAccountCode || !txn.creditAccountCode) {
          throw new Error(`Missing account codes: dr=${txn.debitAccountCode} cr=${txn.creditAccountCode}`);
        }

        const partyData = txn.partyId ? partyMap.get(txn.partyId) : null;
        const invoiceRequired = partyData?.invoiceRequired ?? true;
        const decision = decidePosting(
          txn.direction,
          txn.amount,
          txn.debitAccountCode,
          txn.creditAccountCode,
          invoiceRequired,
        );

        const entryDate = new Date(txn.txnDate);
        let period = dateToPeriod(entryDate);
        if (partyData?.billingPeriodOffsetMonths) period = applyPeriodOffset(period, partyData.billingPeriodOffsetMonths);

        const narration = txn.narration || generatePaymentNarration({
          partyName: partyData?.name ?? txn.counterpartyName,
          category: txn.category,
        });

        await prisma.bankTransaction.update({
          where: { id: txn.id },
          data: {
            status: 'posted',
            unmatchedAmount: txn.amount,
            intendedDebitAccount: decision.intendedDebitAccount,
            postingType: decision.type,
            period,
            ...(!txn.notes && narration ? { notes: narration } : {}),
          },
        });

        if (decision.type === 'single_step') singleStep++;
        else twoStep++;
        posted++;
      } catch (err) {
        errors++;
        const msg = err instanceof Error ? err.message : String(err);
        errorDetails.push(`${txn.id}: ${msg}`);
        log.error({ txnId: txn.id, error: msg }, 'Error posting transaction');
      }
    }

    if (i + BATCH_SIZE < txns.length) {
      process.stdout.write(`  Posted: ${Math.min(i + BATCH_SIZE, txns.length)}/${txns.length}\r`);
    }
  }

  log.info({ posted, singleStep, twoStep, errors }, 'Posting complete');
  return { posted, errors, singleStep, twoStep, errorDetails };
}
