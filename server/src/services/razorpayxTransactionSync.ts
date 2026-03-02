/**
 * RazorpayX Transaction Sync Worker
 *
 * Polls the RazorpayX Transactions API periodically to import bank transactions.
 * Acts as a catch-all behind real-time webhooks — fills in anything missed
 * (downtime, retries exhausted) and handles transaction types with no webhook
 * equivalent (external credits, bank charges, adjustments).
 *
 * Uses identical hash patterns as webhookHandler.ts + CSV import for full
 * idempotency across all three ingestion paths.
 *
 * Pattern: follows payuSettlementSync.ts — module state, concurrency guard,
 * start/stop/getStatus/triggerSync, trackWorkerRun wrapper.
 */

import { randomUUID } from 'crypto';
import type { Prisma } from '@prisma/client';
import { dateToPeriod } from '@coh/shared';
import prisma from '../lib/prisma.js';
import { isConfigured, listTransactions } from './razorpayx/client.js';
import {
  sha256,
  paiseToInr,
  txnExists,
  resolvePartyId,
  resolvePayoutAccounting,
} from './razorpayx/webhookHandler.js';
import { trackWorkerRun } from '../utils/workerRunTracker.js';
import logger from '../utils/logger.js';

const log = logger.child({ module: 'razorpayx-txn-sync' });

// ============================================
// CONFIG
// ============================================

const SYNC_INTERVAL_MS = 30 * 60 * 1000;   // 30 minutes
const STARTUP_DELAY_MS = 60_000;            // 1 min after boot
const LOOKBACK_DAYS = 7;                    // default window per run
const PAGE_SIZE = 100;                      // max per API call

// ============================================
// TYPES
// ============================================

interface SyncResult {
  startedAt: string;
  txnsFetched: number;
  txnsCreated: number;
  txnsSkipped: number;
  feeTxnsCreated: number;
  errors: number;
  durationMs: number;
  error: string | null;
}

interface SyncStatus {
  isRunning: boolean;
  schedulerActive: boolean;
  intervalMinutes: number;
  lastSyncAt: Date | null;
  lastSyncResult: SyncResult | null;
}

// Rich source shape from API (not captured in the thin client type)
interface ApiTransactionSource {
  id: string;
  entity: string;
  fund_account_id?: string;
  fund_account?: {
    id: string;
    contact_id: string;
    contact?: {
      id: string;
      name: string;
      contact: string | null;
      email: string | null;
      type: string | null;
    };
    account_type: string;
    bank_account?: {
      ifsc: string;
      bank_name: string;
      name: string;
      account_number: string;
    };
  };
  amount?: number;
  fees?: number;
  tax?: number;
  status?: string;
  utr?: string;
  mode?: string;
  purpose?: string;
  notes?: Record<string, string>;
  reference_id?: string;
  created_at?: number;
  // External transaction fields
  description?: string;
}

interface ApiTransaction {
  id: string;
  entity: string;
  account_number: string;
  amount: number;
  currency: string;
  credit: number;
  debit: number;
  balance: number;
  source: ApiTransactionSource;
  created_at: number;
}

// ============================================
// STATE
// ============================================

let syncInterval: NodeJS.Timeout | null = null;
let startupTimeout: NodeJS.Timeout | null = null;
let isRunning = false;
let lastSyncAt: Date | null = null;
let lastSyncResult: SyncResult | null = null;

function makeEmptyResult(): SyncResult {
  return {
    startedAt: new Date().toISOString(),
    txnsFetched: 0,
    txnsCreated: 0,
    txnsSkipped: 0,
    feeTxnsCreated: 0,
    errors: 0,
    durationMs: 0,
    error: null,
  };
}

// ============================================
// CORE SYNC
// ============================================

async function runSync(): Promise<SyncResult> {
  const result = makeEmptyResult();
  const startTime = Date.now();

  if (!isConfigured()) {
    result.error = 'RazorpayX not configured — skipping sync';
    log.warn(result.error);
    result.durationMs = Date.now() - startTime;
    return result;
  }

  try {
    const now = Math.floor(Date.now() / 1000);
    const from = now - LOOKBACK_DAYS * 86400;

    // Paginate through all transactions in the lookback window
    let skip = 0;
    let hasMore = true;

    while (hasMore) {
      const response = await listTransactions({ count: PAGE_SIZE, skip, from, to: now });
      // Cast items to our rich type (API returns more than the thin client type)
      const items = response.items as unknown as ApiTransaction[];

      result.txnsFetched += items.length;

      for (const txn of items) {
        try {
          await processTransaction(txn, result);
        } catch (err) {
          result.errors++;
          log.error({ err, txnId: txn.id }, 'Failed to process transaction');
        }
      }

      hasMore = items.length === PAGE_SIZE;
      skip += items.length;
    }

    lastSyncAt = new Date();
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    result.error = msg;
    result.errors++;
    log.error({ err }, 'RazorpayX transaction sync failed');
  }

  result.durationMs = Date.now() - startTime;
  lastSyncResult = result;

  log.info({
    fetched: result.txnsFetched,
    created: result.txnsCreated,
    skipped: result.txnsSkipped,
    fees: result.feeTxnsCreated,
    errors: result.errors,
    durationMs: result.durationMs,
  }, 'RazorpayX transaction sync complete');

  return result;
}

/**
 * Process a single API transaction.
 * Payout transactions use the same hash as webhook handler + CSV import.
 * Non-payout transactions (external credits, charges) use txn-based hash.
 */
async function processTransaction(txn: ApiTransaction, result: SyncResult): Promise<void> {
  const source = txn.source;
  const isPayout = source.entity === 'payout';

  if (isPayout) {
    await processPayoutTransaction(txn, result);
  } else {
    await processNonPayoutTransaction(txn, result);
  }
}

/**
 * Process a payout transaction — creates BankTransaction for the payout
 * and a separate fee transaction if fees > 0.
 */
async function processPayoutTransaction(txn: ApiTransaction, result: SyncResult): Promise<void> {
  const source = txn.source;
  const payoutId = source.id;
  const txnHash = sha256(`razorpayx_payout|${payoutId}`);

  // Skip if already imported (by webhook, CSV, or prior sync)
  if (await txnExists(prisma, txnHash)) {
    result.txnsSkipped++;
    return;
  }

  const amountInr = paiseToInr(txn.amount);
  const feesInr = source.fees ? paiseToInr(source.fees) : 0;
  const taxInr = source.tax ? paiseToInr(source.tax) : 0;
  const txnDate = new Date(txn.created_at * 1000);
  const contactName = source.fund_account?.contact?.name ?? source.fund_account?.bank_account?.name ?? '';
  const purpose = source.purpose ?? source.fund_account?.contact?.type ?? '';
  const utr = source.utr || undefined;

  // Resolve party via the same logic as webhook handler
  // Build a minimal payout shape for resolvePartyId
  const payoutForParty = {
    notes: source.notes ?? {},
    fund_account: source.fund_account ? {
      contact_id: source.fund_account.contact_id,
      bank_account: source.fund_account.bank_account ? {
        name: source.fund_account.bank_account.name,
        ifsc: source.fund_account.bank_account.ifsc,
        account_number: source.fund_account.bank_account.account_number,
      } : undefined,
    } : undefined,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any;
  const partyId = await resolvePartyId(prisma, payoutForParty);

  const { debitAccount, creditAccount, category } = resolvePayoutAccounting(purpose, partyId !== null);

  await prisma.bankTransaction.create({
    data: {
      id: randomUUID(),
      bank: 'razorpayx',
      txnHash,
      rawData: txn as unknown as Prisma.JsonObject,
      txnDate,
      amount: amountInr,
      direction: 'debit',
      narration: `${purpose}: ${contactName}`.trim(),
      reference: payoutId,
      utr,
      counterpartyName: contactName || undefined,
      closingBalance: paiseToInr(txn.balance),
      period: dateToPeriod(txnDate),
      legacySourceId: payoutId,
      debitAccountCode: debitAccount,
      creditAccountCode: creditAccount,
      ...(category ? { category } : {}),
      ...(partyId ? { partyId } : {}),
      status: 'categorized',
      matchedAmount: 0,
      unmatchedAmount: 0,
    },
  });

  result.txnsCreated++;

  // Create separate fee transaction if fees > 0
  if (feesInr > 0) {
    const feeHash = sha256(`razorpayx_fee|${payoutId}`);
    if (!(await txnExists(prisma, feeHash))) {
      await prisma.bankTransaction.create({
        data: {
          id: randomUUID(),
          bank: 'razorpayx',
          txnHash: feeHash,
          rawData: { type: 'payout_fee', payoutId, fees: feesInr, tax: taxInr } as Prisma.JsonObject,
          txnDate,
          amount: feesInr,
          direction: 'debit',
          narration: `RazorpayX fee: ${payoutId}`,
          reference: `fee_${payoutId}`,
          period: dateToPeriod(txnDate),
          legacySourceId: `fee_${payoutId}`,
          debitAccountCode: 'MARKETPLACE_FEES',
          creditAccountCode: 'BANK_RAZORPAYX',
          category: 'bank_charges',
          status: 'categorized',
          matchedAmount: 0,
          unmatchedAmount: 0,
        },
      });
      result.feeTxnsCreated++;
    }
  }

  log.info({ payoutId, amount: amountInr, utr, contactName }, 'Synced payout transaction');
}

/**
 * Process a non-payout transaction (external credits, bank charges, adjustments).
 * Uses txn-id-based hash, same as webhook handler's handleTransactionCreated.
 */
async function processNonPayoutTransaction(txn: ApiTransaction, result: SyncResult): Promise<void> {
  const txnHash = sha256(`razorpayx_txn|${txn.id}`);

  if (await txnExists(prisma, txnHash)) {
    result.txnsSkipped++;
    return;
  }

  const amountInr = paiseToInr(txn.amount);
  const isCredit = txn.credit > 0;
  const txnDate = new Date(txn.created_at * 1000);

  // Extract description from external source if available
  const sourceDesc = txn.source.description ?? '';
  const sourceUtr = txn.source.utr ?? undefined;

  let debitAccount: string;
  let creditAccount: string;
  let narration: string;
  let category: string | undefined;

  if (isCredit) {
    debitAccount = 'BANK_RAZORPAYX';
    creditAccount = 'UNMATCHED_PAYMENTS';
    narration = sourceDesc || `Deposit: ${txn.source.entity} (${txn.id})`;
  } else {
    debitAccount = 'OPERATING_EXPENSES';
    creditAccount = 'BANK_RAZORPAYX';
    narration = sourceDesc || `Charge: ${txn.source.entity} (${txn.id})`;
    category = 'bank_charges';
  }

  await prisma.bankTransaction.create({
    data: {
      id: randomUUID(),
      bank: 'razorpayx',
      txnHash,
      rawData: txn as unknown as Prisma.JsonObject,
      txnDate,
      amount: amountInr,
      direction: isCredit ? 'credit' : 'debit',
      narration,
      reference: txn.id,
      ...(sourceUtr ? { utr: sourceUtr } : {}),
      closingBalance: paiseToInr(txn.balance),
      period: dateToPeriod(txnDate),
      legacySourceId: txn.id,
      debitAccountCode: debitAccount,
      creditAccountCode: creditAccount,
      ...(category ? { category } : {}),
      status: 'categorized',
      matchedAmount: 0,
      unmatchedAmount: 0,
    },
  });

  result.txnsCreated++;
  log.info({
    txnId: txn.id,
    amount: amountInr,
    direction: isCredit ? 'credit' : 'debit',
    source: txn.source.entity,
  }, 'Synced non-payout transaction');
}

// ============================================
// WORKER LIFECYCLE
// ============================================

function start(): void {
  if (syncInterval) return; // already running

  log.info({ intervalMinutes: SYNC_INTERVAL_MS / 60000, startupDelayMs: STARTUP_DELAY_MS }, 'RazorpayX transaction sync starting');

  startupTimeout = setTimeout(() => {
    startupTimeout = null;
    trackWorkerRun('razorpayx_txn_sync', wrappedSync, 'startup');
  }, STARTUP_DELAY_MS);

  syncInterval = setInterval(() => {
    trackWorkerRun('razorpayx_txn_sync', wrappedSync, 'scheduled');
  }, SYNC_INTERVAL_MS);
}

function stop(): void {
  if (startupTimeout) { clearTimeout(startupTimeout); startupTimeout = null; }
  if (syncInterval) { clearInterval(syncInterval); syncInterval = null; }
  log.info('RazorpayX transaction sync stopped');
}

function getStatus(): SyncStatus {
  return {
    isRunning,
    schedulerActive: syncInterval !== null,
    intervalMinutes: SYNC_INTERVAL_MS / 60000,
    lastSyncAt,
    lastSyncResult,
  };
}

async function wrappedSync(): Promise<SyncResult> {
  if (isRunning) {
    log.info('Sync already running, skipping');
    return lastSyncResult ?? makeEmptyResult();
  }
  isRunning = true;
  try {
    return await runSync();
  } finally {
    isRunning = false;
  }
}

async function triggerSync(): Promise<SyncResult> {
  return trackWorkerRun('razorpayx_txn_sync', wrappedSync, 'manual');
}

export default { start, stop, getStatus, triggerSync };
