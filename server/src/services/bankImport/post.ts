/**
 * Bank Import V2 — Post Service
 *
 * Confirms BankTransactions — creates Payment records and marks as posted.
 */

import { PrismaClient } from '@prisma/client';
import { AUTO_CLEAR_AMOUNT_THRESHOLD } from '../../config/finance/index.js';
import { generatePaymentNarration } from '@coh/shared';

const prisma = new PrismaClient();

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
  paymentId?: string;
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
function decidePosting(
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
  const admin = await prisma.user.findFirst({ where: { role: 'admin' } });
  if (!admin) throw new Error('No admin user found — needed for payment createdById');

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

  // Resolve partyId: use linked party, or try matching by counterpartyName
  let partyId = txn.partyId;
  if (!partyId && txn.counterpartyName) {
    const matched = await prisma.party.findFirst({
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
      // Also fix the bank transaction so it has the party link going forward
      await prisma.bankTransaction.update({ where: { id: txn.id }, data: { partyId: matched.id } });
    }
  }

  // Fetch party details for invoiceRequired flag + name for narration
  const party = partyId
    ? await prisma.party.findUnique({ where: { id: partyId }, select: { name: true, invoiceRequired: true } })
    : null;
  const invoiceRequired = party?.invoiceRequired ?? true;

  const decision = decidePosting(txn.direction, txn.amount, txn.debitAccountCode, txn.creditAccountCode, invoiceRequired);
  const entryDate = new Date(txn.txnDate);

  // Generate narration from available context
  const narration = generatePaymentNarration({
    partyName: party?.name ?? txn.counterpartyName,
    category: txn.category,
  });

  let paymentId: string | undefined;
  if (txn.direction === 'debit' && (txn.bank === 'hdfc' || txn.bank === 'razorpayx')) {
    if (txn.paymentId) {
      // Update existing payment — add narration if it doesn't have one
      const existing = await prisma.payment.findUnique({ where: { id: txn.paymentId }, select: { notes: true } });
      await prisma.payment.update({
        where: { id: txn.paymentId },
        data: {
          debitAccountCode: decision.intendedDebitAccount ?? decision.debitAccount,
          ...(!existing?.notes && narration ? { notes: narration } : {}),
        },
      });
      paymentId = txn.paymentId;
    } else {
      const payment = await prisma.payment.create({
        data: {
          direction: 'outgoing',
          method: 'bank_transfer',
          status: 'confirmed',
          amount: txn.amount,
          unmatchedAmount: txn.amount,
          paymentDate: entryDate,
          referenceNumber: txn.reference ?? txn.utr ?? null,
          debitAccountCode: decision.intendedDebitAccount ?? decision.debitAccount,
          createdById: admin.id,
          ...(partyId ? { partyId } : {}),
          ...(narration ? { notes: narration } : {}),
        },
      });
      paymentId = payment.id;
    }
  }

  await prisma.bankTransaction.update({
    where: { id: txn.id },
    data: {
      status: 'posted',
      intendedDebitAccount: decision.intendedDebitAccount,
      postingType: decision.type,
      ...(paymentId && !txn.paymentId ? { paymentId } : {}),
    },
  });

  return { success: true, paymentId };
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
  // Get admin user for createdById
  const admin = await prisma.user.findFirst({ where: { role: 'admin' } });
  if (!admin) throw new Error('No admin user found — needed for payment createdById');

  const where: Record<string, unknown> = {
    status: { in: ['imported', 'categorized'] },
    debitAccountCode: { not: null },
  };
  if (options?.bank) where.bank = options.bank;

  const txns = await prisma.bankTransaction.findMany({
    where: where as any,
    orderBy: { txnDate: 'asc' },
  });

  // Pre-fetch party invoiceRequired flags
  const partyIds = [...new Set(txns.map(t => t.partyId).filter(Boolean))] as string[];
  const parties = partyIds.length > 0
    ? await prisma.party.findMany({
        where: { id: { in: partyIds } },
        select: { id: true, invoiceRequired: true },
      })
    : [];
  const partyMap = new Map(parties.map(p => [p.id, p.invoiceRequired]));

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

        const invoiceRequired = txn.partyId ? (partyMap.get(txn.partyId) ?? true) : true;
        const decision = decidePosting(
          txn.direction,
          txn.amount,
          txn.debitAccountCode,
          txn.creditAccountCode,
          invoiceRequired,
        );

        const entryDate = new Date(txn.txnDate);

        // Create or re-use Payment for outgoing bank transactions
        let paymentId: string | undefined;
        if (txn.direction === 'debit' && (txn.bank === 'hdfc' || txn.bank === 'razorpayx')) {
          if (txn.paymentId) {
            // Re-use existing Payment (preserved from old import) — just update debitAccountCode
            await prisma.payment.update({
              where: { id: txn.paymentId },
              data: { debitAccountCode: decision.intendedDebitAccount ?? decision.debitAccount },
            });
            paymentId = txn.paymentId;
          } else {
            const payment = await prisma.payment.create({
              data: {
                direction: 'outgoing',
                method: 'bank_transfer',
                status: 'confirmed',
                amount: txn.amount,
                unmatchedAmount: txn.amount,
                paymentDate: entryDate,
                referenceNumber: txn.reference ?? txn.utr ?? null,
                debitAccountCode: decision.intendedDebitAccount ?? decision.debitAccount,
                createdById: admin.id,
                ...(txn.partyId ? { partyId: txn.partyId } : {}),
              },
            });
            paymentId = payment.id;
          }
        }

        // Update BankTransaction status + AP routing metadata
        await prisma.bankTransaction.update({
          where: { id: txn.id },
          data: {
            status: 'posted',
            intendedDebitAccount: decision.intendedDebitAccount,
            postingType: decision.type,
            ...(paymentId && !txn.paymentId ? { paymentId } : {}),
          },
        });

        if (decision.type === 'single_step') singleStep++;
        else twoStep++;
        posted++;
      } catch (err) {
        errors++;
        const msg = err instanceof Error ? err.message : String(err);
        errorDetails.push(`${txn.id}: ${msg}`);
        console.error(`[BankPost] Error posting txn ${txn.id}:`, msg);
      }
    }

    if (i + BATCH_SIZE < txns.length) {
      process.stdout.write(`  Posted: ${Math.min(i + BATCH_SIZE, txns.length)}/${txns.length}\r`);
    }
  }

  console.log(`\n[BankPost] Done: ${posted} posted (${singleStep} single-step, ${twoStep} two-step), ${errors} errors`);
  return { posted, errors, singleStep, twoStep, errorDetails };
}
