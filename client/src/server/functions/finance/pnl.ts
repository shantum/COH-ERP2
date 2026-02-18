/**
 * Finance P&L — Monthly P&L, cash flow, drill-down
 */

'use server';

import { createServerFn } from '@tanstack/react-start';
import { z } from 'zod';
import { authMiddleware } from '../../middleware/auth';
import { getPrisma } from '@coh/shared/services/db';
import type { Prisma } from '@prisma/client';
import { categoryToExpenseAccountName } from './invoices';

// ============================================
// MONTHLY P&L (invoice-based + inventory cost)
// ============================================

export const getMonthlyPnl = createServerFn({ method: 'GET' })
  .middleware([authMiddleware])
  .handler(async () => {
    const prisma = await getPrisma();

    // 1. Revenue: receivable invoices grouped by billing period
    const revenueRows = await prisma.$queryRaw<Array<{
      period: string; amount: number;
    }>>`
      SELECT COALESCE(i."billingPeriod", TO_CHAR(i."invoiceDate" AT TIME ZONE 'Asia/Kolkata', 'YYYY-MM')) AS period,
             SUM(i."totalAmount" - COALESCE(i."gstAmount", 0))::float AS amount
      FROM "Invoice" i
      WHERE i.type = 'receivable'
        AND i.status IN ('confirmed', 'partially_paid', 'paid')
      GROUP BY period
    `;

    // 2. Expenses: payable invoices grouped by billing period + category
    const expenseRows = await prisma.$queryRaw<Array<{
      period: string; category: string; amount: number;
    }>>`
      SELECT COALESCE(i."billingPeriod", TO_CHAR(i."invoiceDate" AT TIME ZONE 'Asia/Kolkata', 'YYYY-MM')) AS period,
             i.category,
             SUM(i."totalAmount" - COALESCE(i."gstAmount", 0))::float AS amount
      FROM "Invoice" i
      WHERE i.type = 'payable'
        AND i.status IN ('confirmed', 'partially_paid', 'paid')
      GROUP BY period, i.category
    `;

    // 3. COGS: outward sale transactions x BOM cost
    const cogsRows = await prisma.$queryRaw<Array<{
      period: string; amount: number;
    }>>`
      SELECT TO_CHAR(it."createdAt" AT TIME ZONE 'Asia/Kolkata', 'YYYY-MM') AS period,
             SUM(it.qty * COALESCE(s."bomCost", 0))::float AS amount
      FROM "InventoryTransaction" it
      JOIN "Sku" s ON s.id = it."skuId"
      WHERE it."txnType" = 'outward' AND it.reason = 'sale'
      GROUP BY period
    `;

    // 4. COGS reversal: RTO/return inward transactions
    const cogsReversalRows = await prisma.$queryRaw<Array<{
      period: string; amount: number;
    }>>`
      SELECT TO_CHAR(it."createdAt" AT TIME ZONE 'Asia/Kolkata', 'YYYY-MM') AS period,
             SUM(it.qty * COALESCE(s."bomCost", 0))::float AS amount
      FROM "InventoryTransaction" it
      JOIN "Sku" s ON s.id = it."skuId"
      WHERE it."txnType" = 'inward' AND it.reason IN ('rto_received', 'return_receipt')
      GROUP BY period
    `;

    // Build per-month P&L
    type AccountLine = { code: string; name: string; amount: number };
    const monthMap = new Map<string, {
      period: string;
      revenueLines: AccountLine[];
      cogsLines: AccountLine[];
      expenseLines: AccountLine[];
      totalRevenue: number;
      totalCogs: number;
      totalExpenses: number;
    }>();

    const getMonth = (period: string) => {
      if (!monthMap.has(period)) {
        monthMap.set(period, {
          period,
          revenueLines: [], cogsLines: [], expenseLines: [],
          totalRevenue: 0, totalCogs: 0, totalExpenses: 0,
        });
      }
      return monthMap.get(period)!;
    };

    // Revenue
    for (const row of revenueRows) {
      if (!row.period) continue;
      const month = getMonth(row.period);
      month.revenueLines.push({ code: 'SALES_REVENUE', name: 'Sales Revenue', amount: row.amount });
      month.totalRevenue += row.amount;
    }

    // Expenses by category
    for (const row of expenseRows) {
      if (!row.period) continue;
      const month = getMonth(row.period);
      const name = categoryToExpenseAccountName(row.category);
      // Merge same display name
      const existing = month.expenseLines.find(l => l.name === name);
      if (existing) {
        existing.amount += row.amount;
      } else {
        month.expenseLines.push({ code: row.category, name, amount: row.amount });
      }
      month.totalExpenses += row.amount;
    }

    // COGS
    for (const row of cogsRows) {
      if (!row.period) continue;
      const month = getMonth(row.period);
      month.cogsLines.push({ code: 'COGS', name: 'Cost of Goods Sold', amount: row.amount });
      month.totalCogs += row.amount;
    }

    // COGS reversal (subtract from COGS)
    for (const row of cogsReversalRows) {
      if (!row.period) continue;
      const month = getMonth(row.period);
      const existing = month.cogsLines.find(l => l.code === 'COGS');
      if (existing) {
        existing.amount -= row.amount;
      } else {
        month.cogsLines.push({ code: 'COGS', name: 'Cost of Goods Sold', amount: -row.amount });
      }
      month.totalCogs -= row.amount;
    }

    const round = (n: number) => Math.round(n * 100) / 100;
    const months = Array.from(monthMap.values())
      .map((m) => ({
        period: m.period,
        revenue: round(m.totalRevenue),
        revenueLines: m.revenueLines.map((l) => ({ ...l, amount: round(l.amount) })).sort((a, b) => b.amount - a.amount),
        cogs: round(m.totalCogs),
        cogsLines: m.cogsLines.map((l) => ({ ...l, amount: round(l.amount) })).sort((a, b) => b.amount - a.amount),
        grossProfit: round(m.totalRevenue - m.totalCogs),
        expenses: m.expenseLines.map((l) => ({ ...l, amount: round(l.amount) })).sort((a, b) => b.amount - a.amount),
        totalExpenses: round(m.totalExpenses),
        netProfit: round(m.totalRevenue - m.totalCogs - m.totalExpenses),
      }))
      .sort((a, b) => b.period.localeCompare(a.period));

    return { success: true as const, months };
  });

// ============================================
// CASH FLOW (bank-transaction-based)
// ============================================

/** Display-name map for account codes (supplements CHART_OF_ACCOUNTS for gaps) */
const ACCOUNT_DISPLAY_NAMES: Record<string, string> = {};
// Populate from CHART_OF_ACCOUNTS at module level
for (const acct of [
  { code: 'BANK_HDFC', name: 'HDFC Bank Account' },
  { code: 'BANK_RAZORPAYX', name: 'RazorpayX Account' },
  { code: 'CASH', name: 'Cash' },
  { code: 'ACCOUNTS_RECEIVABLE', name: 'Accounts Receivable' },
  { code: 'FABRIC_INVENTORY', name: 'Fabric Inventory' },
  { code: 'FINISHED_GOODS', name: 'Finished Goods' },
  { code: 'GST_INPUT', name: 'GST Input' },
  { code: 'ADVANCES_GIVEN', name: 'Advances Given' },
  { code: 'ACCOUNTS_PAYABLE', name: 'Accounts Payable' },
  { code: 'GST_OUTPUT', name: 'GST Output' },
  { code: 'CUSTOMER_ADVANCES', name: 'Customer Advances' },
  { code: 'TDS_PAYABLE', name: 'TDS Payable' },
  { code: 'CREDIT_CARD', name: 'Credit Card' },
  { code: 'SALES_REVENUE', name: 'Sales Revenue' },
  { code: 'COGS', name: 'Cost of Goods Sold' },
  { code: 'OPERATING_EXPENSES', name: 'Operating Expenses' },
  { code: 'MARKETPLACE_FEES', name: 'Marketplace Fees' },
  { code: 'SOFTWARE_TECHNOLOGY', name: 'Software & Technology' },
  { code: 'UNMATCHED_PAYMENTS', name: 'Unmatched Payments' },
  { code: 'OWNER_CAPITAL', name: 'Owner Capital' },
  { code: 'RETAINED_EARNINGS', name: 'Retained Earnings' },
  { code: 'LOAN_GETVANTAGE', name: 'Loan (GetVantage)' },
]) {
  ACCOUNT_DISPLAY_NAMES[acct.code] = acct.name;
}

function accountDisplayName(code: string): string {
  return ACCOUNT_DISPLAY_NAMES[code] ?? code.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}

const CATEGORY_DISPLAY: Record<string, string> = {
  marketing: 'Marketing & Ads',
  facebook_ads: 'Facebook Ads',
  google_ads: 'Google Ads',
  agency: 'Agencies',
  photoshoot: 'Photoshoot',
  salary: 'Salary & Wages',
  fabric: 'Fabric',
  trims: 'Trims & Accessories',
  service: 'Service (Print, Wash, etc.)',
  rent: 'Rent',
  logistics: 'Logistics & Shipping',
  packaging: 'Packaging',
  equipment: 'Equipment & Tools',
  marketplace: 'Marketplace Fees',
  statutory: 'Statutory / TDS',
  refund: 'Refunds',
  software: 'Software & Technology',
  cc_interest: 'CC Interest & Finance Charges',
  cc_fees: 'CC Fees & Markup',
  rzp_fees: 'Razorpay Fees',
  cod_remittance: 'COD Remittance',
  payu_settlement: 'PayU Settlement',
  other: 'Other',
  uncategorized: 'Uncategorized',
};

function categoryDisplayName(cat: string | null): string {
  if (!cat) return 'Uncategorized';
  return CATEGORY_DISPLAY[cat] ?? cat.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}

export const getMonthlyCashFlow = createServerFn({ method: 'GET' })
  .middleware([authMiddleware])
  .handler(async () => {
    const prisma = await getPrisma();

    const rows = await prisma.$queryRaw<Array<{
      period: string;
      direction: string;
      account: string;
      category: string | null;
      cnt: number;
      total: number;
    }>>`
      SELECT COALESCE(bt.period, TO_CHAR(bt."txnDate" AT TIME ZONE 'Asia/Kolkata', 'YYYY-MM')) AS period,
             bt.direction,
             CASE WHEN bt.direction = 'credit' THEN bt."creditAccountCode"
                  ELSE bt."debitAccountCode" END AS account,
             bt.category,
             COUNT(*)::int AS cnt,
             SUM(bt.amount)::float AS total
      FROM "BankTransaction" bt
      WHERE bt.status IN ('posted', 'legacy_posted')
        AND NOT (
          bt."debitAccountCode" IN ('BANK_HDFC', 'BANK_RAZORPAYX')
          AND bt."creditAccountCode" IN ('BANK_HDFC', 'BANK_RAZORPAYX')
        )
      GROUP BY period, bt.direction, account, bt.category
      ORDER BY period
    `;

    // Build per-month cash flow
    type ExpenseLine = { code: string; name: string; amount: number; count: number };
    type IncomeLine = { code: string; name: string; amount: number; count: number };
    const monthMap = new Map<string, {
      period: string;
      salesRevenue: number;
      salesCount: number;
      refunds: number;
      refundCount: number;
      incomeLines: IncomeLine[];
      expenseLines: ExpenseLine[];
    }>();

    const getMonth = (period: string) => {
      if (!monthMap.has(period)) {
        monthMap.set(period, {
          period,
          salesRevenue: 0,
          salesCount: 0,
          refunds: 0,
          refundCount: 0,
          incomeLines: [],
          expenseLines: [],
        });
      }
      return monthMap.get(period)!;
    };

    // Bank account codes are the "other side" of double-entry — skip them as categories
    const BANK_ACCOUNTS = new Set(['BANK_HDFC', 'BANK_RAZORPAYX']);

    for (const row of rows) {
      if (!row.period || !row.account) continue;
      if (BANK_ACCOUNTS.has(row.account)) continue; // skip bank-side entries
      const month = getMonth(row.period);

      if (row.direction === 'credit') {
        // Income
        if (row.account === 'SALES_REVENUE') {
          month.salesRevenue += row.total;
          month.salesCount += row.cnt;
        } else {
          const existing = month.incomeLines.find((l) => l.code === row.account);
          if (existing) {
            existing.amount += row.total;
            existing.count += row.cnt;
          } else {
            month.incomeLines.push({ code: row.account, name: accountDisplayName(row.account), amount: row.total, count: row.cnt });
          }
        }
      } else {
        // Expense (debit)
        if (row.account === 'SALES_REVENUE') {
          // Refunds — debit to SALES_REVENUE
          month.refunds += row.total;
          month.refundCount += row.cnt;
        } else {
          // Split OPERATING_EXPENSES by category so marketing gets its own line
          const lineCode = row.account === 'OPERATING_EXPENSES' && row.category
            ? `OPEX_${row.category.toUpperCase()}`
            : row.account;
          const lineName = row.account === 'OPERATING_EXPENSES' && row.category
            ? categoryDisplayName(row.category)
            : accountDisplayName(row.account);

          const existing = month.expenseLines.find((l) => l.code === lineCode);
          if (existing) {
            existing.amount += row.total;
            existing.count += row.cnt;
          } else {
            month.expenseLines.push({ code: lineCode, name: lineName, amount: row.total, count: row.cnt });
          }
        }
      }
    }

    const round = (n: number) => Math.round(n * 100) / 100;

    const months = Array.from(monthMap.values())
      .map((m) => {
        const netSalesRevenue = round(m.salesRevenue - m.refunds);
        const otherIncome = round(m.incomeLines.reduce((s, l) => s + l.amount, 0));
        const totalIncome = round(netSalesRevenue + otherIncome);
        const totalExpenses = round(m.expenseLines.reduce((s, l) => s + l.amount, 0));
        return {
          period: m.period,
          salesRevenue: round(m.salesRevenue),
          salesCount: m.salesCount,
          refunds: round(m.refunds),
          refundCount: m.refundCount,
          netSalesRevenue,
          incomeLines: m.incomeLines.map((l) => ({ ...l, amount: round(l.amount) })).sort((a, b) => b.amount - a.amount),
          otherIncome,
          totalIncome,
          expenses: m.expenseLines.map((l) => ({ ...l, amount: round(l.amount) })).sort((a, b) => b.amount - a.amount),
          totalExpenses,
          netCashFlow: round(totalIncome - totalExpenses),
        };
      })
      .sort((a, b) => b.period.localeCompare(a.period));

    return { success: true as const, months };
  });

// ============================================
// CASH FLOW DETAIL (drill-down)
// ============================================

const cashFlowDetailInput = z.object({
  period: z.string().regex(/^\d{4}-\d{2}$/),
  direction: z.enum(['credit', 'debit']),
  accountCode: z.string(),
});

export const getCashFlowDetail = createServerFn({ method: 'POST' })
  .middleware([authMiddleware])
  .inputValidator((input: unknown) => cashFlowDetailInput.parse(input))
  .handler(async ({ data }) => {
    const prisma = await getPrisma();

    // Build where — use stored period column (falls back to date range for any un-backfilled rows)
    const periodStart = new Date(`${data.period}-01T00:00:00+05:30`);
    const periodEnd = new Date(periodStart);
    periodEnd.setMonth(periodEnd.getMonth() + 1);

    const where: Record<string, unknown> = {
      status: { in: ['posted', 'legacy_posted'] },
      direction: data.direction,
      OR: [
        { period: data.period },
        { period: null, txnDate: { gte: periodStart, lt: periodEnd } },
      ],
    };

    // Handle OPEX_* composite codes (e.g. OPEX_MARKETING -> account=OPERATING_EXPENSES, category=marketing)
    const opexMatch = data.accountCode.match(/^OPEX_(.+)$/);
    const actualAccount = opexMatch ? 'OPERATING_EXPENSES' : data.accountCode;
    if (opexMatch) {
      where.category = opexMatch[1].toLowerCase();
    }

    if (data.direction === 'credit') {
      where.creditAccountCode = actualAccount;
    } else {
      where.debitAccountCode = actualAccount;
    }
    // Exclude inter-bank transfers (both sides are bank accounts)
    where.NOT = {
      debitAccountCode: { in: ['BANK_HDFC', 'BANK_RAZORPAYX'] },
      creditAccountCode: { in: ['BANK_HDFC', 'BANK_RAZORPAYX'] },
    };

    const transactions = await prisma.bankTransaction.findMany({
      where,
      select: {
        id: true,
        narration: true,
        amount: true,
        txnDate: true,
        counterpartyName: true,
        reference: true,
        bank: true,
        category: true,
        party: { select: { name: true } },
      },
      orderBy: { txnDate: 'desc' },
      take: 500,
    });

    // Group by category (for expenses) or party/channel (for income)
    type TxnRow = { id: string; narration: string | null; amount: number; txnDate: Date; counterpartyName: string | null; reference: string | null; bank: string; category: string | null };
    type GroupItem = { label: string; count: number; total: number; transactions: TxnRow[] };
    const mapped: TxnRow[] = transactions.map((t) => ({
      id: t.id,
      narration: t.narration,
      amount: Number(t.amount),
      txnDate: t.txnDate,
      counterpartyName: t.party?.name ?? t.counterpartyName,
      reference: t.reference,
      bank: t.bank,
      category: t.category,
    }));

    const groupMap = new Map<string, GroupItem>();
    for (const t of mapped) {
      // Use party/counterparty for income (channels), category for expenses
      const key = data.direction === 'credit'
        ? (t.counterpartyName || 'Unknown')
        : (t.category || 'uncategorized');
      const label = data.direction === 'credit'
        ? (t.counterpartyName || 'Unknown')
        : categoryDisplayName(t.category);
      if (!groupMap.has(key)) {
        groupMap.set(key, { label, count: 0, total: 0, transactions: [] });
      }
      const group = groupMap.get(key)!;
      group.count++;
      group.total += t.amount;
      group.transactions.push(t);
    }

    const groups = Array.from(groupMap.values())
      .map((g) => ({ ...g, total: Math.round(g.total * 100) / 100 }))
      .sort((a, b) => b.total - a.total);

    return {
      success: true as const,
      groups,
      totalCount: mapped.length,
    };
  });

// ============================================
// P&L ACCOUNT DETAIL (drill-down)
// ============================================

const pnlAccountDetailInput = z.object({
  period: z.string().regex(/^\d{4}-\d{2}$/),
  category: z.string().optional(),
});

export const getPnlAccountDetail = createServerFn({ method: 'POST' })
  .middleware([authMiddleware])
  .inputValidator((input: unknown) => pnlAccountDetailInput.parse(input))
  .handler(async ({ data }) => {
    const prisma = await getPrisma();

    // Invoice-based drill-down by category + period
    const periodStart = new Date(`${data.period}-01`);
    const periodEnd = new Date(periodStart);
    periodEnd.setMonth(periodEnd.getMonth() + 1);

    const where: Prisma.InvoiceWhereInput = {
      status: { in: ['confirmed', 'partially_paid', 'paid'] },
      OR: [
        { billingPeriod: data.period },
        { billingPeriod: null, invoiceDate: { gte: periodStart, lt: periodEnd } },
      ],
      ...(data.category ? { category: data.category } : {}),
    };

    const invoices = await prisma.invoice.findMany({
      where,
      select: {
        id: true,
        invoiceNumber: true,
        category: true,
        totalAmount: true,
        gstAmount: true,
        invoiceDate: true,
        type: true,
        party: { select: { name: true } },
      },
      orderBy: { totalAmount: 'desc' },
      take: 100,
    });

    // Group by category
    type DetailLine = { description: string; amount: number; date: string; counterparty: string | null };
    const categoryMap = new Map<string, { label: string; total: number; lines: DetailLine[] }>();

    for (const inv of invoices) {
      const amount = Math.round((inv.totalAmount - (inv.gstAmount ?? 0)) * 100) / 100;
      const date = inv.invoiceDate ? new Date(inv.invoiceDate).toISOString().slice(0, 10) : '';
      const counterparty = inv.party?.name ?? null;
      const key = inv.category;
      const label = categoryToExpenseAccountName(inv.category);

      if (!categoryMap.has(key)) categoryMap.set(key, { label, total: 0, lines: [] });
      const cat = categoryMap.get(key)!;
      cat.total += amount;
      cat.lines.push({
        description: `${inv.invoiceNumber ?? 'No #'} — ${counterparty ?? 'Unknown'}`,
        amount,
        date,
        counterparty,
      });
    }

    const categories = Array.from(categoryMap.values())
      .map((c) => ({ ...c, total: Math.round(c.total * 100) / 100 }))
      .sort((a, b) => b.total - a.total);

    return { success: true as const, categories };
  });
