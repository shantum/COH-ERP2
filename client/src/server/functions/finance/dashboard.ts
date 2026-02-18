/**
 * Finance Dashboard — Summary & Alerts
 */

'use server';

import { createServerFn } from '@tanstack/react-start';
import { authMiddleware } from '../../middleware/auth';
import { getPrisma } from '@coh/shared/services/db';

// ============================================
// DASHBOARD / SUMMARY
// ============================================

export const getFinanceSummary = createServerFn({ method: 'GET' })
  .middleware([authMiddleware])
  .handler(async () => {
    const prisma = await getPrisma();

    const [apResult, arResult, hdfcBalance, rpxBalance, suspenseResult, payableCount, receivableCount, draftInvoices, pendingBankTxns, unmatchedPayments] = await Promise.all([
      prisma.invoice.aggregate({ where: { type: 'payable', status: { in: ['confirmed', 'partially_paid'] } }, _sum: { balanceDue: true } }),
      prisma.invoice.aggregate({ where: { type: 'receivable', status: { in: ['confirmed', 'partially_paid'] } }, _sum: { balanceDue: true } }),
      prisma.bankTransaction.findFirst({ where: { bank: 'hdfc', closingBalance: { not: null } }, orderBy: { txnDate: 'desc' }, select: { closingBalance: true, txnDate: true } }),
      prisma.bankTransaction.findFirst({ where: { bank: 'razorpayx', closingBalance: { not: null } }, orderBy: { txnDate: 'desc' }, select: { closingBalance: true, txnDate: true } }),
      prisma.payment.aggregate({ where: { direction: 'outgoing', status: 'confirmed', debitAccountCode: 'UNMATCHED_PAYMENTS', unmatchedAmount: { gt: 0.01 } }, _sum: { unmatchedAmount: true } }),
      prisma.invoice.count({ where: { type: 'payable', status: { in: ['confirmed', 'partially_paid'] } } }),
      prisma.invoice.count({ where: { type: 'receivable', status: { in: ['confirmed', 'partially_paid'] } } }),
      // Attention counts
      prisma.invoice.count({ where: { status: 'draft' } }),
      prisma.bankTransaction.count({ where: { status: { in: ['imported', 'categorized'] } } }),
      prisma.payment.count({ where: { status: 'confirmed', unmatchedAmount: { gt: 0.01 } } }),
    ]);

    return {
      success: true as const,
      summary: {
        totalPayable: apResult._sum.balanceDue ?? 0,
        totalReceivable: arResult._sum.balanceDue ?? 0,
        hdfcBalance: hdfcBalance?.closingBalance ?? 0,
        hdfcBalanceDate: hdfcBalance?.txnDate ?? null,
        rpxBalance: rpxBalance?.closingBalance ?? 0,
        rpxBalanceDate: rpxBalance?.txnDate ?? null,
        suspenseBalance: suspenseResult._sum.unmatchedAmount ?? 0,
        openPayableInvoices: payableCount,
        openReceivableInvoices: receivableCount,
        draftInvoices,
        pendingBankTxns,
        unmatchedPayments,
      },
    };
  });

// ============================================
// INTEGRITY CHECKS (flag problems)
// ============================================

type Alert = { severity: 'error' | 'warning'; category: string; message: string; details?: string };

export const getFinanceAlerts = createServerFn({ method: 'GET' })
  .middleware([authMiddleware])
  .handler(async () => {
    const prisma = await getPrisma();
    const alerts: Alert[] = [];

    // 1. Overpaid invoices: matched payments exceed total
    const overpaid = await prisma.$queryRaw<Array<{
      id: string; invoice_number: string | null; counterparty: string | null;
      total_amount: number; tds_amount: number; paid_amount: number;
    }>>`
      SELECT i.id, i."invoiceNumber" AS invoice_number,
             p.name AS counterparty,
             i."totalAmount"::float AS total_amount,
             COALESCE(i."tdsAmount", 0)::float AS tds_amount,
             i."paidAmount"::float AS paid_amount
      FROM "Invoice" i
      LEFT JOIN "Party" p ON p.id = i."partyId"
      WHERE i.status != 'cancelled'
        AND i."paidAmount" > (i."totalAmount" - COALESCE(i."tdsAmount", 0) + 1)
    `;
    for (const inv of overpaid) {
      alerts.push({
        severity: 'error',
        category: 'Overpaid Invoice',
        message: `${inv.invoice_number || 'No #'} — ${inv.counterparty || 'Unknown'}: paid Rs ${Math.round(inv.paid_amount).toLocaleString('en-IN')} but only Rs ${Math.round(inv.total_amount - inv.tds_amount).toLocaleString('en-IN')} owed`,
      });
    }

    // 2. Over-allocated payments: matched amount > payment amount
    const overallocated = await prisma.$queryRaw<Array<{
      id: string; reference: string | null; counterparty: string | null;
      amount: number; matched_amount: number;
    }>>`
      SELECT pay.id, pay."referenceNumber" AS reference,
             p.name AS counterparty,
             pay.amount::float AS amount,
             pay."matchedAmount"::float AS matched_amount
      FROM "Payment" pay
      LEFT JOIN "Party" p ON p.id = pay."partyId"
      WHERE pay.status != 'cancelled'
        AND pay."matchedAmount" > pay.amount + 1
    `;
    for (const pay of overallocated) {
      alerts.push({
        severity: 'error',
        category: 'Over-allocated Payment',
        message: `${pay.reference || pay.id.slice(0, 8)} — ${pay.counterparty || 'Unknown'}: allocated Rs ${Math.round(pay.matched_amount).toLocaleString('en-IN')} but payment was only Rs ${Math.round(pay.amount).toLocaleString('en-IN')}`,
      });
    }

    // 4. (Removed) Same vendor on multiple banks — too noisy, all false positives.
    // Vendors legitimately use multiple payment channels (bank + CC, RazorpayX + HDFC).
    // Actual duplicate payments are caught by check #3 (reference number matching).

    // 5. Large unmatched payments (>50K, no invoice link)
    const unmatched = await prisma.$queryRaw<Array<{
      id: string; reference: string | null; counterparty: string | null;
      amount: number; unmatched: number; payment_date: Date;
    }>>`
      SELECT pay.id, pay."referenceNumber" AS reference,
             p.name AS counterparty,
             pay.amount::float AS amount,
             pay."unmatchedAmount"::float AS unmatched,
             pay."paymentDate" AS payment_date
      FROM "Payment" pay
      LEFT JOIN "Party" p ON p.id = pay."partyId"
      WHERE pay.status = 'confirmed'
        AND pay.direction = 'outgoing'
        AND pay."unmatchedAmount" > 50000
      ORDER BY pay."unmatchedAmount" DESC
      LIMIT 20
    `;
    for (const pay of unmatched) {
      alerts.push({
        severity: 'warning',
        category: 'Large Unmatched Payment',
        message: `${pay.counterparty || 'Unknown'}: Rs ${Math.round(pay.unmatched).toLocaleString('en-IN')} unmatched (${pay.reference || 'no ref'})`,
        details: `Paid ${new Date(pay.payment_date).toISOString().slice(0, 10)} — needs invoice link to split GST`,
      });
    }

    // 6. Confirmed invoices without billing period (payable only)
    const noPeriod = await prisma.invoice.count({
      where: {
        type: 'payable',
        status: { in: ['confirmed', 'partially_paid', 'paid'] },
        billingPeriod: null,
        category: { in: ['marketing', 'service', 'rent'] },
      },
    });
    if (noPeriod > 0) {
      alerts.push({
        severity: 'warning',
        category: 'Missing Billing Period',
        message: `${noPeriod} confirmed payable invoice(s) have no billing period set`,
      });
    }

    // 8. Suspense balance (unmatched payments in suspense)
    const suspenseTotal = await prisma.payment.aggregate({
      where: { direction: 'outgoing', status: 'confirmed', debitAccountCode: 'UNMATCHED_PAYMENTS', unmatchedAmount: { gt: 0.01 } },
      _sum: { unmatchedAmount: true },
    });
    const suspenseAmt = suspenseTotal._sum.unmatchedAmount ?? 0;
    if (suspenseAmt > 100) {
      alerts.push({
        severity: 'warning',
        category: 'Suspense Balance',
        message: `Rs ${Math.abs(Math.round(suspenseAmt)).toLocaleString('en-IN')} sitting in Unmatched Payments — needs reclassifying`,
        details: 'Create invoices and link to these payments to move money to correct accounts',
      });
    }

    // 9. Duplicate payments (same ref + similar amount + same counterparty)
    // Excludes small amounts (<100) — recurring bank charges share batch-style references (CDT*)
    const dupes = await prisma.$queryRaw<Array<{
      reference: string; counterparty: string; amount: number; cnt: number;
    }>>`
      SELECT pay."referenceNumber" AS reference,
             p.name AS counterparty,
             pay.amount::float AS amount,
             COUNT(*)::int AS cnt
      FROM "Payment" pay
      LEFT JOIN "Party" p ON p.id = pay."partyId"
      WHERE pay.status != 'cancelled'
        AND pay."referenceNumber" IS NOT NULL
        AND pay."referenceNumber" != ''
        AND pay.amount > 100
      GROUP BY pay."referenceNumber", p.name, pay.amount
      HAVING COUNT(*) > 1
      ORDER BY pay.amount DESC
      LIMIT 10
    `;
    for (const d of dupes) {
      alerts.push({
        severity: 'error',
        category: 'Duplicate Payment',
        message: `${d.counterparty || 'Unknown'}: Rs ${Math.round(d.amount).toLocaleString('en-IN')} x${d.cnt} (ref: ${d.reference})`,
      });
    }

    // 10. Invoice paidAmount out of sync with actual Allocation records
    const invoiceMismatch = await prisma.$queryRaw<Array<{
      id: string; invoice_number: string | null; counterparty: string | null;
      paid_amount: number; actual_paid: number;
    }>>`
      SELECT i.id, i."invoiceNumber" AS invoice_number,
             p.name AS counterparty,
             i."paidAmount"::float AS paid_amount,
             COALESCE(SUM(pi.amount), 0)::float AS actual_paid
      FROM "Invoice" i
      LEFT JOIN "Party" p ON p.id = i."partyId"
      LEFT JOIN "Allocation" pi ON pi."invoiceId" = i.id
      WHERE i.status != 'cancelled'
      GROUP BY i.id, i."invoiceNumber", p.name, i."paidAmount"
      HAVING ABS(i."paidAmount" - COALESCE(SUM(pi.amount), 0)) > 1
      LIMIT 10
    `;
    for (const m of invoiceMismatch) {
      alerts.push({
        severity: 'error',
        category: 'Invoice Amount Mismatch',
        message: `${m.invoice_number || 'No #'} — ${m.counterparty || 'Unknown'}: shows Rs ${Math.round(m.paid_amount).toLocaleString('en-IN')} paid but actual matches total Rs ${Math.round(m.actual_paid).toLocaleString('en-IN')}`,
      });
    }

    // 11. Payment matchedAmount out of sync
    const paymentMismatch = await prisma.$queryRaw<Array<{
      id: string; reference: string | null; counterparty: string | null;
      matched_amount: number; actual_matched: number;
    }>>`
      SELECT pay.id, pay."referenceNumber" AS reference,
             p.name AS counterparty,
             pay."matchedAmount"::float AS matched_amount,
             COALESCE(SUM(pi.amount), 0)::float AS actual_matched
      FROM "Payment" pay
      LEFT JOIN "Party" p ON p.id = pay."partyId"
      LEFT JOIN "Allocation" pi ON pi."paymentId" = pay.id
      WHERE pay.status != 'cancelled'
      GROUP BY pay.id, pay."referenceNumber", p.name, pay."matchedAmount"
      HAVING ABS(pay."matchedAmount" - COALESCE(SUM(pi.amount), 0)) > 1
      LIMIT 10
    `;
    for (const m of paymentMismatch) {
      alerts.push({
        severity: 'error',
        category: 'Payment Amount Mismatch',
        message: `${m.counterparty || 'Unknown'} (${m.reference || 'no ref'}): shows Rs ${Math.round(m.matched_amount).toLocaleString('en-IN')} matched but actual total Rs ${Math.round(m.actual_matched).toLocaleString('en-IN')}`,
      });
    }

    // 13. Old draft invoices (>30 days)
    const oldDrafts = await prisma.invoice.count({
      where: {
        status: 'draft',
        createdAt: { lt: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000) },
      },
    });
    if (oldDrafts > 0) {
      alerts.push({
        severity: 'warning',
        category: 'Stale Drafts',
        message: `${oldDrafts} invoice draft(s) older than 30 days — confirm or delete them`,
      });
    }

    return {
      success: true as const,
      alerts,
      counts: {
        errors: alerts.filter((a) => a.severity === 'error').length,
        warnings: alerts.filter((a) => a.severity === 'warning').length,
      },
    };
  });
