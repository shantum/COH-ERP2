/**
 * Marketplace Payout Reconciliation Service
 *
 * Takes a parsed Nykaa report, matches orders + bank transactions against ERP,
 * and on confirmation creates invoices, payments, and allocations.
 */

import { Prisma } from '@prisma/client';
import prisma from '../../lib/prisma.js';
import logger from '../../utils/logger.js';
import type { ParsedNykaaReport, NykaaOrderLine } from './parseNykaaReport.js';

const log = logger.child({ module: 'marketplaceReconcile' });

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
  promoInvoiceId?: string;
  bankTransactionId?: string;
}

interface MatchedOrder {
  baseOrderNo: string;
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

/** Extract unique base order numbers from parsed lines */
function uniqueBaseOrders(lines: NykaaOrderLine[]): string[] {
  const set = new Set<string>();
  for (const line of lines) {
    if (line.baseOrderNo) {
      set.add(line.baseOrderNo);
    }
  }
  return Array.from(set);
}

// ---------------------------------------------------------------------------
// Order matching
// ---------------------------------------------------------------------------

async function matchOrders(
  lines: NykaaOrderLine[],
): Promise<{
  matched: MatchedOrder[];
  unmatched: string[];
}> {
  const baseOrders = uniqueBaseOrders(lines);
  const matched: MatchedOrder[] = [];
  const unmatched: string[] = [];

  // Batch lookup: fetch all nykaa orders whose orderNumber starts with any of the base order numbers.
  // To avoid N+1 queries we batch in groups.
  const BATCH_SIZE = 50;
  for (let i = 0; i < baseOrders.length; i += BATCH_SIZE) {
    const batch = baseOrders.slice(i, i + BATCH_SIZE);

    // Build OR conditions for startsWith matching
    const results = await prisma.order.findMany({
      where: {
        channel: 'nykaa',
        OR: batch.map((baseNo) => ({
          orderNumber: { startsWith: baseNo },
        })),
      },
      select: { id: true, orderNumber: true },
    });

    // Map results back to base order numbers
    for (const baseNo of batch) {
      const match = results.find((r) =>
        r.orderNumber.startsWith(baseNo),
      );
      if (match) {
        matched.push({
          baseOrderNo: baseNo,
          erpOrderId: match.id,
          erpOrderNumber: match.orderNumber,
        });
      } else {
        unmatched.push(baseNo);
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
  netPayout: number,
): Promise<BankMatchResult | null> {
  if (netPayout <= 0) return null;

  const tolerance = round2(netPayout * 0.01); // 1%
  const lower = round2(netPayout - tolerance);
  const upper = round2(netPayout + tolerance);

  const candidates = await prisma.bankTransaction.findMany({
    where: {
      bank: 'hdfc',
      direction: 'credit',
      narration: { contains: 'NYKAA', mode: 'insensitive' },
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
  let bestDiff = Math.abs(best.amount - netPayout);
  for (let i = 1; i < candidates.length; i++) {
    const diff = Math.abs(candidates[i].amount - netPayout);
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
  parsed: ParsedNykaaReport,
  fileName: string,
): Promise<PreviewResult> {
  // 1. Dedup check
  const existing = await prisma.marketplacePayoutReport.findFirst({
    where: {
      marketplace: parsed.marketplace,
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
  const orderResult = await matchOrders(parsed.orderLines);

  // 3. Bank matching
  const bankResult = await matchBankTransaction(parsed.netPayout);

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
      marketplace: parsed.marketplace,
      fileName,
      fileHash: parsed.fileHash,
      reportPeriod,
      grossRevenue: round2(parsed.grossRevenue),
      totalCommission: round2(parsed.totalCommission),
      bannerDeduction: round2(parsed.bannerDeduction),
      shippingCharges: round2(parsed.shippingCharges),
      returnCharges: round2(parsed.returnCharges),
      tdsAmount: round2(parsed.tdsAmount),
      otherIncome: round2(parsed.otherIncome),
      netPayout: round2(parsed.netPayout),
      orderCount: parsed.orderLines.length,
      deliveredCount: parsed.deliveredCount,
      returnCount: parsed.returnCount,
      cancelledCount: parsed.cancelledCount,
      orderLines: JSON.parse(JSON.stringify(parsed.orderLines)) as Prisma.InputJsonValue,
      matchedOrders: matchedOrdersJson,
      bankMatchResult: bankMatchJson,
      status: 'draft',
    },
  });

  log.info({ reportId: report.id, marketplace: parsed.marketplace }, 'Draft report created');

  // 6. Return preview
  return {
    reportId: report.id,
    marketplace: parsed.marketplace,
    reportPeriod,
    summary: {
      grossRevenue: round2(parsed.grossRevenue),
      totalCommission: round2(parsed.totalCommission),
      bannerDeduction: round2(parsed.bannerDeduction),
      shippingCharges: round2(parsed.shippingCharges),
      returnCharges: round2(parsed.returnCharges),
      tdsAmount: round2(parsed.tdsAmount),
      otherIncome: round2(parsed.otherIncome),
      netPayout: round2(parsed.netPayout),
    },
    orderStats: {
      totalLines: parsed.orderLines.length,
      deliveredCount: parsed.deliveredCount,
      returnCount: parsed.returnCount,
      cancelledCount: parsed.cancelledCount,
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

  // 2. Find or create Nykaa party
  let nykaaParty = await prisma.party.findFirst({
    where: { name: { contains: 'Nykaa', mode: 'insensitive' } },
    select: { id: true },
  });

  if (!nykaaParty) {
    nykaaParty = await prisma.party.create({
      data: { name: 'Nykaa Fashion', category: 'marketplace' },
      select: { id: true },
    });
    log.info({ partyId: nykaaParty.id }, 'Created Nykaa party');
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
        partyId: nykaaParty.id,
        status: 'paid',
        invoiceDate: new Date(),
        tdsAmount: round2(report.tdsAmount),
        notes: `Nykaa ${report.marketplace} payout for ${report.reportPeriod}`,
        createdById: userId,
      },
    });

    // 5. Commission Invoice (payable)
    const commissionInvoice = await tx.invoice.create({
      data: {
        type: 'payable',
        category: 'marketplace_commission',
        totalAmount: round2(report.totalCommission),
        paidAmount: round2(report.totalCommission),
        balanceDue: 0,
        billingPeriod: report.reportPeriod,
        partyId: nykaaParty.id,
        status: 'paid',
        invoiceDate: new Date(),
        notes: `Commission deducted at source - Nykaa ${report.marketplace} ${report.reportPeriod}`,
        createdById: userId,
      },
    });

    // 6. Promo Invoice (payable, only if bannerDeduction > 0)
    let promoInvoice: { id: string } | null = null;
    if (report.bannerDeduction > 0) {
      promoInvoice = await tx.invoice.create({
        data: {
          type: 'payable',
          category: 'marketplace_promo',
          totalAmount: round2(report.bannerDeduction),
          paidAmount: round2(report.bannerDeduction),
          balanceDue: 0,
          billingPeriod: report.reportPeriod,
          partyId: nykaaParty.id,
          status: 'paid',
          invoiceDate: new Date(),
          notes: `Banner/promotional deduction - Nykaa ${report.marketplace} ${report.reportPeriod}`,
          createdById: userId,
        },
      });
    }

    // 7. Set matchedAmount on bank transaction (if matched) and create allocation
    let bankTxnId: string | undefined;
    if (bankMatch?.bankTxnId) {
      await tx.bankTransaction.update({
        where: { id: bankMatch.bankTxnId },
        data: {
          matchedAmount: round2(report.netPayout),
          unmatchedAmount: 0,
          notes: `Nykaa ${report.marketplace} net payout for ${report.reportPeriod}`,
        },
      });
      bankTxnId = bankMatch.bankTxnId;
    }

    // 8. Allocation: link bank transaction to revenue invoice
    if (bankTxnId) {
      await tx.allocation.create({
        data: {
          bankTransactionId: bankTxnId,
          invoiceId: revenueInvoice.id,
          amount: round2(report.netPayout),
          notes: `Marketplace net payout allocation`,
          matchedById: userId,
        },
      });
    }

    // 11. Update report to confirmed
    await tx.marketplacePayoutReport.update({
      where: { id: reportId },
      data: {
        status: 'confirmed',
        revenueInvoiceId: revenueInvoice.id,
        commissionInvoiceId: commissionInvoice.id,
        ...(promoInvoice ? { promoInvoiceId: promoInvoice.id } : {}),
        ...(bankTxnId ? { bankTransactionId: bankTxnId } : {}),
      },
    });

    return {
      reportId,
      revenueInvoiceId: revenueInvoice.id,
      commissionInvoiceId: commissionInvoice.id,
      ...(promoInvoice ? { promoInvoiceId: promoInvoice.id } : {}),
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
    'Report confirmed with invoices',
  );

  return result;
}
