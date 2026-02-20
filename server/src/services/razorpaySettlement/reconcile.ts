/**
 * Razorpay Prepaid Settlement Reconciliation Service
 *
 * Takes a parsed Razorpay settlement report, matches orders + bank transactions
 * against ERP, and on confirmation creates invoices and allocations.
 */

import { Prisma } from '@prisma/client';
import prisma from '../../lib/prisma.js';
import logger from '../../utils/logger.js';
import type { ParsedRazorpayReport, RazorpaySettlementLine, SettlementBatch } from './parseRazorpayReport.js';

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
    matchedCount?: number;
    totalSettlements?: number;
    totalMatchedAmount?: number;
    matches?: Array<{
      settlementId: string;
      bankTxnId: string;
      amount: number;
      narration: string | null;
      txnDate: string;
      utr: string;
    }>;
  };
}

export interface ConfirmResult {
  reportId: string;
  revenueInvoiceId: string;
  commissionInvoiceId: string;
  bankTransactionIds: string[];
}

interface MatchedOrder {
  razorpayOrderId: string;
  erpOrderId: string;
  erpOrderNumber: string;
}

interface BankMatchResult {
  settlementId: string;
  bankTxnId: string;
  amount: number;
  narration: string | null;
  txnDate: string;
  utr: string;
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

// ---------------------------------------------------------------------------
// Order matching — match via Razorpay order_id against ShopifyOrderCache
// ---------------------------------------------------------------------------

async function matchOrders(
  lines: RazorpaySettlementLine[],
): Promise<{
  matched: MatchedOrder[];
  unmatched: string[];
}> {
  // Razorpay is our own payment gateway — the CSV has Razorpay order_ids (order_xxx)
  // but we don't store those on the Order model. Per-order matching isn't critical here;
  // settlement-level bank matching (UTR → HDFC) is what matters for reconciliation.
  // TODO: Add per-order matching if needed (store Razorpay order_id on Order during import)
  const razorpayOrderIds = [...new Set(
    lines.map(l => l.razorpayOrderId).filter(Boolean)
  )];

  log.info(
    { totalRazorpayOrders: razorpayOrderIds.length },
    'Order matching skipped — Razorpay order IDs not stored on Order model',
  );

  return { matched: [], unmatched: razorpayOrderIds };
}

// ---------------------------------------------------------------------------
// Bank matching — match settlement UTRs against HDFC bank transactions
// ---------------------------------------------------------------------------

async function matchBankTransactions(
  settlements: SettlementBatch[],
): Promise<BankMatchResult[]> {
  const results: BankMatchResult[] = [];

  for (const settlement of settlements) {
    if (!settlement.utr || settlement.amount <= 0) continue;

    // Try exact UTR match first
    const byUtr = await prisma.bankTransaction.findFirst({
      where: {
        bank: 'hdfc',
        direction: 'credit',
        utr: settlement.utr,
      },
      select: { id: true, amount: true, narration: true, txnDate: true },
    });

    if (byUtr) {
      results.push({
        settlementId: settlement.settlementId,
        bankTxnId: byUtr.id,
        amount: byUtr.amount,
        narration: byUtr.narration,
        txnDate: byUtr.txnDate.toISOString().split('T')[0],
        utr: settlement.utr,
      });
      continue;
    }

    // Fallback: match by amount ±1% with RAZORPAY narration
    const tolerance = round2(settlement.amount * 0.01);
    const lower = round2(settlement.amount - tolerance);
    const upper = round2(settlement.amount + tolerance);

    const byAmount = await prisma.bankTransaction.findFirst({
      where: {
        bank: 'hdfc',
        direction: 'credit',
        narration: { contains: 'RAZORPAY', mode: 'insensitive' },
        amount: { gte: lower, lte: upper },
        paymentId: null,  // unlinked only
      },
      orderBy: { txnDate: 'desc' },
      select: { id: true, amount: true, narration: true, txnDate: true },
    });

    if (byAmount) {
      results.push({
        settlementId: settlement.settlementId,
        bankTxnId: byAmount.id,
        amount: byAmount.amount,
        narration: byAmount.narration,
        txnDate: byAmount.txnDate.toISOString().split('T')[0],
        utr: settlement.utr,
      });
    }
  }

  log.info(
    { matched: results.length, total: settlements.length },
    'Bank transaction matching complete',
  );

  return results;
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

  // 3. Bank matching — per settlement batch
  const bankResults = await matchBankTransactions(parsed.settlements);

  // 4. Report period — use current month
  const reportPeriod = currentPeriod();

  // 5. Save draft report
  const matchedOrdersJson = JSON.parse(JSON.stringify({
    matched: orderResult.matched,
    unmatched: orderResult.unmatched,
  })) as Prisma.InputJsonValue;

  const bankMatchJson: Prisma.InputJsonValue = bankResults.length > 0
    ? (JSON.parse(JSON.stringify(bankResults)) as Prisma.InputJsonValue)
    : [];

  const totalCommission = round2(parsed.totalFee + parsed.totalTax);

  const report = await prisma.marketplacePayoutReport.create({
    data: {
      marketplace: 'razorpay',
      fileName,
      fileHash: parsed.fileHash,
      reportPeriod,
      grossRevenue: round2(parsed.grossAmount),
      totalCommission,
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

  log.info({ reportId: report.id }, 'Draft report created');

  const totalMatchedAmount = round2(bankResults.reduce((s, b) => s + b.amount, 0));

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
      unmatchedBaseOrders: orderResult.unmatched.slice(0, 20), // limit preview size
    },
    bankMatch: {
      found: bankResults.length > 0,
      matchedCount: bankResults.length,
      totalSettlements: parsed.settlements.length,
      totalMatchedAmount,
      matches: bankResults.slice(0, 10), // limit preview size
    },
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
  const bankMatches = (report.bankMatchResult ?? []) as unknown as BankMatchResult[];

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

    // 6. Match bank transactions and create allocations
    const bankTxnIds: string[] = [];
    for (const bankMatch of bankMatches) {
      if (!bankMatch.bankTxnId) continue;

      await tx.bankTransaction.update({
        where: { id: bankMatch.bankTxnId },
        data: {
          matchedAmount: round2(bankMatch.amount),
          unmatchedAmount: 0,
          notes: `Razorpay settlement ${bankMatch.settlementId} (UTR: ${bankMatch.utr})`,
        },
      });

      await tx.allocation.create({
        data: {
          bankTransactionId: bankMatch.bankTxnId,
          invoiceId: revenueInvoice.id,
          amount: round2(bankMatch.amount),
          notes: `Razorpay settlement ${bankMatch.settlementId}`,
          matchedById: userId,
        },
      });

      bankTxnIds.push(bankMatch.bankTxnId);
    }

    // 7. Update report to confirmed
    await tx.marketplacePayoutReport.update({
      where: { id: reportId },
      data: {
        status: 'confirmed',
        revenueInvoiceId: revenueInvoice.id,
        commissionInvoiceId: commissionInvoice.id,
        ...(bankTxnIds.length > 0 ? { bankTransactionId: bankTxnIds[0] } : {}),
      },
    });

    return {
      reportId,
      revenueInvoiceId: revenueInvoice.id,
      commissionInvoiceId: commissionInvoice.id,
      bankTransactionIds: bankTxnIds,
    };
  });

  log.info(
    {
      reportId,
      revenueInvoiceId: result.revenueInvoiceId,
      commissionInvoiceId: result.commissionInvoiceId,
      bankTxnCount: result.bankTransactionIds.length,
    },
    'Razorpay settlement report confirmed with invoices',
  );

  return result;
}
