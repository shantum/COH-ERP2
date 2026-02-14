/**
 * Bank Import V2 — Post Service
 *
 * Posts categorized BankTransactions to the ledger.
 * Creates LedgerEntry + Payment, links back to BankTransaction.
 */

import { PrismaClient } from '@prisma/client';
import { createLedgerEntry, dateToPeriod } from '../ledgerService.js';

const prisma = new PrismaClient();

export interface DryRunSummary {
  count: number;
  totalDebits: number;
  totalCredits: number;
  byAccount: Record<string, { count: number; total: number }>;
}

export interface PostResult {
  posted: number;
  errors: number;
  errorDetails: string[];
}

export async function getDryRunSummary(options?: { bank?: string }): Promise<DryRunSummary> {
  const where: Record<string, unknown> = { status: 'categorized' };
  if (options?.bank) where.bank = options.bank;

  const txns = await prisma.bankTransaction.findMany({
    where: where as any,
    select: { amount: true, direction: true, debitAccountCode: true, creditAccountCode: true },
  });

  let totalDebits = 0;
  let totalCredits = 0;
  const byAccount: Record<string, { count: number; total: number }> = {};

  for (const txn of txns) {
    if (txn.direction === 'debit') totalDebits += txn.amount;
    else totalCredits += txn.amount;

    const key = `${txn.debitAccountCode} → ${txn.creditAccountCode}`;
    if (!byAccount[key]) byAccount[key] = { count: 0, total: 0 };
    byAccount[key].count++;
    byAccount[key].total += txn.amount;
  }

  return { count: txns.length, totalDebits, totalCredits, byAccount };
}

export async function postTransactions(options?: { bank?: string }): Promise<PostResult> {
  // Get admin user for createdById
  const admin = await prisma.user.findFirst({ where: { role: 'admin' } });
  if (!admin) throw new Error('No admin user found — needed for ledger entry createdById');

  const where: Record<string, unknown> = { status: 'categorized' };
  if (options?.bank) where.bank = options.bank;

  const txns = await prisma.bankTransaction.findMany({
    where: where as any,
    orderBy: { txnDate: 'asc' },
  });

  let posted = 0;
  let errors = 0;
  const errorDetails: string[] = [];
  const BATCH_SIZE = 20;

  for (let i = 0; i < txns.length; i += BATCH_SIZE) {
    const batch = txns.slice(i, i + BATCH_SIZE);

    for (const txn of batch) {
      try {
        if (!txn.debitAccountCode || !txn.creditAccountCode) {
          throw new Error(`Missing account codes: dr=${txn.debitAccountCode} cr=${txn.creditAccountCode}`);
        }

        // Determine description for ledger entry
        const description = txn.narration
          ? txn.narration.slice(0, 100)
          : `${txn.bank} ${txn.direction}: ${txn.amount}`;

        const entryDate = new Date(txn.txnDate);
        const period = dateToPeriod(entryDate);

        // Create ledger entry
        const entry = await createLedgerEntry(prisma as any, {
          entryDate,
          period,
          description,
          sourceType: txn.bank === 'hdfc' ? 'hdfc_statement' : txn.bank === 'razorpayx' ? 'bank_payout' : 'cc_charge',
          sourceId: txn.id,
          lines: [
            { accountCode: txn.debitAccountCode, debit: txn.amount },
            { accountCode: txn.creditAccountCode, credit: txn.amount },
          ],
          createdById: admin.id,
        });

        // Create Payment for outgoing bank transactions (vendor payments)
        let paymentId: string | undefined;
        if (txn.direction === 'debit' && (txn.bank === 'hdfc' || txn.bank === 'razorpayx')) {
          const payment = await prisma.payment.create({
            data: {
              direction: 'outgoing',
              method: 'bank_transfer',
              status: 'confirmed',
              amount: txn.amount,
              unmatchedAmount: txn.amount,
              paymentDate: entryDate,
              referenceNumber: txn.reference ?? txn.utr ?? null,
              counterpartyName: txn.counterpartyName ?? null,
              ledgerEntryId: entry.id,
              createdById: admin.id,
              ...(txn.partyId ? { partyId: txn.partyId } : {}),
            },
          });
          paymentId = payment.id;
        }

        // Update BankTransaction status
        await prisma.bankTransaction.update({
          where: { id: txn.id },
          data: {
            status: 'posted',
            ledgerEntryId: entry.id,
            ...(paymentId ? { paymentId } : {}),
          },
        });

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

  console.log(`\n[BankPost] Done: ${posted} posted, ${errors} errors`);
  return { posted, errors, errorDetails };
}
