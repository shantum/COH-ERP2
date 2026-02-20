/**
 * Razorpay Prepaid Settlement Reconciliation Service
 *
 * Takes a parsed Razorpay settlement report, matches orders + bank transactions
 * against ERP, and on confirmation creates invoices and allocations.
 *
 * Follows the same pattern as marketplace payout reconciliation (Nykaa).
 */

import { Prisma } from '@prisma/client';
import prisma from '../../lib/prisma.js';
import logger from '../../utils/logger.js';
import type { ParsedRazorpayReport, RazorpaySettlementLine } from './parseRazorpayReport.js';

const log = logger.child({ module: 'razorpayReconcile' });

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface PreviewResult {
  reportId: string;
  marketplace: string;
  reportPeriod: string;
  summary: {
    grossRevenue: number;
    totalCommission: number;
    bannerDeduction: number;
    shippingCharges: number;
    returnCharges: number;
    tdsAmount: number;
    otherIncome: number;
    netPayout: number;
  };
  orderStats: {
    totalLines: number;
    deliveredCount: number;
    returnCount: number;
    cancelledCount: number;
    matchedOrderCount: number;
    unmatchedOrderCount: number;
    unmatchedBaseOrders: string[];
  };
  bankMatch: {
    found: boolean;
    bankTxnId?: string;
    amount?: number;
    narration?: string;
    txnDate?: string;
  } | null;
}

export interface ConfirmResult {
  reportId: string;
  revenueInvoiceId: string;
  commissionInvoiceId: string;
  bankTransactionId?: string;
}

interface MatchedOrder {
  orderNumber: string;
  erpOrderId: string;
  erpOrderNumber: string;
}

interface BankMatchResult {
  bankTxnId: string;
  amount: number;
  narration: string | null;
  txnDate: string;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Round to 2 decimal places */
function round2(x: number): number {
  return Math.round(x * 100) / 100;
}

/** Get current period as YYYY-MM */
function currentPeriod(): string {
  const now = new Date();
  const yyyy = now.getFullYear();
  const mm = String(now.getMonth() + 1).padStart(2, '0');
  return `${yyyy}-${mm}`;
}

/** Extract unique order numbers from parsed lines (only non-empty) */
function uniqueOrderNumbers(lines: RazorpaySettlementLine[]): string[] {
  const set = new Set<string>();
  for (const line of lines) {
    if (line.orderNumber) {
      set.add(line.orderNumber);
    }
  }
  return Array.from(set);
}

// ---------------------------------------------------------------------------
// Order matching
// ---------------------------------------------------------------------------

async function matchOrders(
  lines: RazorpaySettlementLine[],
): Promise<{
  matched: MatchedOrder[];
  unmatched: string[];
}> {
  const orderNumbers = uniqueOrderNumbers(lines);
  const matched: MatchedOrder[] = [];
  const unmatched: string[] = [];

  if (orderNumbers.length === 0) {
    log.warn('No order numbers found in settlement lines — skipping order matching');
    return { matched, unmatched };
  }

  // Batch lookup to avoid N+1
  const BATCH_SIZE = 50;
  for (let i = 0; i < orderNumbers.length; i += BATCH_SIZE) {
    const batch = orderNumbers.slice(i, i + BATCH_SIZE);

    const results = await prisma.order.findMany({
      where: {
        orderNumber: { in: batch },
      },
      select: { id: true, orderNumber: true },
    });

    const resultMap = new Map(results.map((r) => [r.orderNumber, r]));

    for (const orderNum of batch) {
      const match = resultMap.get(orderNum);
      if (match) {
        matched.push({
          orderNumber: orderNum,
          erpOrderId: match.id,
          erpOrderNumber: match.orderNumber,
        });
      } else {
        unmatched.push(orderNum);
      }
    }
  }

  log.info(
    { matchedCount: matched.length, unmatchedCount: unmatched.length },
    'Order matching complete',
  );

  return { matched, unmatched };
}

// ---------------------------------------------------------------------------
// Bank matching
// ---------------------------------------------------------------------------

async function matchBankTransaction(
  netSettlement: number,
): Promise<BankMatchResult | null> {
  if (netSettlement <= 0) return null;

  const tolerance = round2(netSettlement * 0.01); // 1%
  const lower = round2(netSettlement - tolerance);
  const upper = round2(netSettlement + tolerance);

  const candidates = await prisma.bankTransaction.findMany({
    where: {
      bank: 'hdfc',
      direction: 'credit',
      narration: { contains: 'RAZORPAY', mode: 'insensitive' },
      amount: { gte: lower, lte: upper },
      // Only match unlinked transactions
      paymentId: null,
    },
    orderBy: { txnDate: 'desc' },
    take: 5,
    select: { id: true, amount: true, narration: true, txnDate: true },
  });

  if (candidates.length === 0) return null;

  // Pick the closest match by amount
  let best = candidates[0];
  let bestDiff = Math.abs(best.amount - netSettlement);
  for (let i = 1; i < candidates.length; i++) {
    const diff = Math.abs(candidates[i].amount - netSettlement);
    if (diff < bestDiff) {
      best = candidates[i];
      bestDiff = diff;
    }
  }

  log.info(
    { bankTxnId: best.id, amount: best.amount, diff: bestDiff },
    'Bank transaction matched',
  );

  return {
    bankTxnId: best.id,
    amount: best.amount,
    narration: best.narration,
    txnDate: best.txnDate.toISOString().split('T')[0],
  };
}

// ---------------------------------------------------------------------------
// previewReport
// ---------------------------------------------------------------------------

export async function previewReport(
  parsed: ParsedRazorpayReport,
  fileName: string,
): Promise<PreviewResult> {
  // 1. Dedup check
  const existing = await prisma.marketplacePayoutReport.findFirst({
    where: {
      marketplace: 'razorpay',
      fileHash: parsed.fileHash,
    },
    select: { id: true, status: true },
  });

  if (existing) {
    throw new Error(
      `Report already uploaded (ID: ${existing.id}, status: ${existing.status})`,
    );
  }

  // 2. Order matching
  const orderResult = await matchOrders(parsed.lines);

  // 3. Bank matching
  const bankResult = await matchBankTransaction(parsed.netSettlement);

  // 4. Report period — use current month
  const reportPeriod = currentPeriod();

  // 5. Save draft report
  const matchedOrdersJson = JSON.parse(JSON.stringify({
    matched: orderResult.matched,
    unmatched: orderResult.unmatched,
  })) as Prisma.InputJsonValue;

  const bankMatchJson: Prisma.InputJsonValue | typeof Prisma.DbNull = bankResult
    ? (JSON.parse(JSON.stringify({
        bankTxnId: bankResult.bankTxnId,
        amount: bankResult.amount,
        narration: bankResult.narration,
        txnDate: bankResult.txnDate,
      })) as Prisma.InputJsonValue)
    : Prisma.DbNull;

  const report = await prisma.marketplacePayoutReport.create({
    data: {
      marketplace: 'razorpay',
      fileName,
      fileHash: parsed.fileHash,
      reportPeriod,
      grossRevenue: round2(parsed.grossAmount),
      totalCommission: round2(parsed.totalFee + parsed.totalTax),
      bannerDeduction: 0,
      shippingCharges: 0,
      returnCharges: 0,
      tdsAmount: 0,
      otherIncome: 0,
      netPayout: round2(parsed.netSettlement),
      orderCount: parsed.lines.length,
      deliveredCount: parsed.paymentCount,
      returnCount: parsed.refundCount,
      cancelledCount: parsed.adjustmentCount,
      orderLines: JSON.parse(JSON.stringify(parsed.lines)) as Prisma.InputJsonValue,
      matchedOrders: matchedOrdersJson,
      bankMatchResult: bankMatchJson,
      status: 'draft',
    },
  });

  log.info({ reportId: report.id, settlementId: parsed.settlementId }, 'Draft report created');

  const totalCommission = round2(parsed.totalFee + parsed.totalTax);

  // 6. Return preview
  return {
    reportId: report.id,
    marketplace: 'razorpay',
    reportPeriod,
    summary: {
      grossRevenue: round2(parsed.grossAmount),
      totalCommission,
      bannerDeduction: 0,
      shippingCharges: 0,
      returnCharges: 0,
      tdsAmount: 0,
      otherIncome: 0,
      netPayout: round2(parsed.netSettlement),
    },
    orderStats: {
      totalLines: parsed.lines.length,
      deliveredCount: parsed.paymentCount,
      returnCount: parsed.refundCount,
      cancelledCount: parsed.adjustmentCount,
      matchedOrderCount: orderResult.matched.length,
      unmatchedOrderCount: orderResult.unmatched.length,
      unmatchedBaseOrders: orderResult.unmatched,
    },
    bankMatch: bankResult
      ? {
          found: true,
          bankTxnId: bankResult.bankTxnId,
          amount: bankResult.amount,
          narration: bankResult.narration ?? undefined,
          txnDate: bankResult.txnDate,
        }
      : { found: false },
  };
}

// ---------------------------------------------------------------------------
// confirmReport
// ---------------------------------------------------------------------------

export async function confirmReport(
  reportId: string,
  userId: string,
): Promise<ConfirmResult> {
  // 1. Load draft report
  const report = await prisma.marketplacePayoutReport.findUnique({
    where: { id: reportId },
  });

  if (!report) {
    throw new Error(`Report not found: ${reportId}`);
  }

  if (report.status !== 'draft') {
    throw new Error(
      `Report ${reportId} is not in draft status (current: ${report.status})`,
    );
  }

  // 2. Find or create Razorpay party
  let razorpayParty = await prisma.party.findFirst({
    where: { name: { contains: 'Razorpay', mode: 'insensitive' } },
    select: { id: true },
  });

  if (!razorpayParty) {
    razorpayParty = await prisma.party.create({
      data: { name: 'Razorpay', category: 'marketplace' },
      select: { id: true },
    });
    log.info({ partyId: razorpayParty.id }, 'Created Razorpay party');
  }

  // Extract bank match info
  const bankMatch = report.bankMatchResult as BankMatchResult | null;

  // 3. Run everything in a transaction
  const result = await prisma.$transaction(async (tx) => {
    // 4. Revenue Invoice (receivable)
    const revenueInvoice = await tx.invoice.create({
      data: {
        type: 'receivable',
        category: 'customer_order',
        totalAmount: round2(report.grossRevenue),
        paidAmount: round2(report.grossRevenue),
        balanceDue: 0,
        billingPeriod: report.reportPeriod,
        partyId: razorpayParty.id,
        status: 'paid',
        invoiceDate: new Date(),
        tdsAmount: 0,
        notes: `Razorpay prepaid settlement for ${report.reportPeriod}`,
        createdById: userId,
      },
    });

    // 5. Commission Invoice (payable — gateway fees)
    const commissionInvoice = await tx.invoice.create({
      data: {
        type: 'payable',
        category: 'marketplace_commission',
        totalAmount: round2(report.totalCommission),
        paidAmount: round2(report.totalCommission),
        balanceDue: 0,
        billingPeriod: report.reportPeriod,
        partyId: razorpayParty.id,
        status: 'paid',
        invoiceDate: new Date(),
        notes: `Razorpay gateway fees deducted at source - ${report.reportPeriod}`,
        createdById: userId,
      },
    });

    // 6. Set matchedAmount on bank transaction (if matched) and create allocation
    let bankTxnId: string | undefined;
    if (bankMatch?.bankTxnId) {
      await tx.bankTransaction.update({
        where: { id: bankMatch.bankTxnId },
        data: {
          matchedAmount: round2(report.netPayout),
          unmatchedAmount: 0,
          notes: `Razorpay prepaid settlement for ${report.reportPeriod}`,
        },
      });
      bankTxnId = bankMatch.bankTxnId;
    }

    // 7. Allocation: link bank transaction to revenue invoice
    if (bankTxnId) {
      await tx.allocation.create({
        data: {
          bankTransactionId: bankTxnId,
          invoiceId: revenueInvoice.id,
          amount: round2(report.netPayout),
          notes: 'Razorpay settlement payout allocation',
          matchedById: userId,
        },
      });
    }

    // 8. Update report to confirmed
    await tx.marketplacePayoutReport.update({
      where: { id: reportId },
      data: {
        status: 'confirmed',
        revenueInvoiceId: revenueInvoice.id,
        commissionInvoiceId: commissionInvoice.id,
        ...(bankTxnId ? { bankTransactionId: bankTxnId } : {}),
      },
    });

    return {
      reportId,
      revenueInvoiceId: revenueInvoice.id,
      commissionInvoiceId: commissionInvoice.id,
      ...(bankTxnId ? { bankTransactionId: bankTxnId } : {}),
    };
  });

  log.info(
    {
      reportId,
      revenueInvoiceId: result.revenueInvoiceId,
      commissionInvoiceId: result.commissionInvoiceId,
      bankTransactionId: result.bankTransactionId,
    },
    'Razorpay settlement report confirmed with invoices',
  );

  return result;
}
