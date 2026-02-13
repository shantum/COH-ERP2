/**
 * Finance Server Functions
 *
 * Invoice CRUD, payment CRUD, ledger queries, and manual journal entries.
 * File uploads go through Express route (needs multer).
 */

'use server';

import { createServerFn } from '@tanstack/react-start';
import { z } from 'zod';
import { authMiddleware } from '../middleware/auth';
import { getPrisma } from '@coh/shared/services/db';
import {
  CreateInvoiceSchema,
  UpdateInvoiceSchema,
  CreateFinancePaymentSchema,
  MatchPaymentInvoiceSchema,
  CreateManualLedgerEntrySchema,
  ListInvoicesInput,
  ListPaymentsInput,
  ListLedgerEntriesInput,
} from '@coh/shared/schemas/finance';

// ============================================
// INLINE LEDGER HELPERS
// (Avoids cross-project import from server/)
// ============================================

interface LedgerLineInput {
  accountCode: string;
  debit?: number;
  credit?: number;
  description?: string;
}

/**
 * Convert a Date to IST "YYYY-MM" period string.
 * IST = UTC + 5:30
 */
function dateToPeriod(date: Date): string {
  const ist = new Date(date.getTime() + (5.5 * 60 * 60 * 1000));
  return `${ist.getUTCFullYear()}-${String(ist.getUTCMonth() + 1).padStart(2, '0')}`;
}

/**
 * Create a balanced journal entry with debit/credit lines.
 * Resolves account codes → IDs, validates balance, creates entry + lines.
 * DB trigger handles balance updates automatically.
 */
async function inlineCreateLedgerEntry(
  prisma: Awaited<ReturnType<typeof getPrisma>>,
  input: {
    entryDate: Date;
    period: string;
    description: string;
    sourceType: string;
    sourceId?: string;
    lines: LedgerLineInput[];
    createdById: string;
    notes?: string;
  }
) {
  const { entryDate, period, description, sourceType, sourceId, lines, createdById, notes } = input;

  // Validate minimum 2 lines (debit + credit)
  if (lines.length < 2) {
    throw new Error('A journal entry needs at least 2 lines (debit + credit)');
  }

  // Validate debits = credits
  const totalDebit = lines.reduce((sum, l) => sum + (l.debit ?? 0), 0);
  const totalCredit = lines.reduce((sum, l) => sum + (l.credit ?? 0), 0);
  if (Math.abs(totalDebit - totalCredit) > 0.01) {
    throw new Error(`Debits (${totalDebit.toFixed(2)}) must equal credits (${totalCredit.toFixed(2)})`);
  }

  // Validate each line has exactly one of debit or credit
  for (const line of lines) {
    const d = line.debit ?? 0;
    const c = line.credit ?? 0;
    if (d > 0 && c > 0) {
      throw new Error(`Line "${line.accountCode}" has both debit and credit`);
    }
    if (d === 0 && c === 0) {
      throw new Error(`Line "${line.accountCode}" has zero debit and credit`);
    }
  }

  // Resolve account codes to IDs
  const accountCodes = [...new Set(lines.map((l) => l.accountCode))];
  const accounts = await prisma.ledgerAccount.findMany({
    where: { code: { in: accountCodes } },
    select: { id: true, code: true },
  });
  const accountMap = new Map(accounts.map((a) => [a.code, a.id]));
  for (const code of accountCodes) {
    if (!accountMap.has(code)) throw new Error(`Unknown account code: ${code}`);
  }

  return prisma.ledgerEntry.create({
    data: {
      entryDate,
      period,
      description,
      sourceType,
      sourceId: sourceId ?? null,
      notes: notes ?? null,
      createdById,
      lines: {
        create: lines.map((line) => ({
          accountId: accountMap.get(line.accountCode)!,
          debit: line.debit ?? 0,
          credit: line.credit ?? 0,
          description: line.description ?? null,
        })),
      },
    },
    include: {
      lines: { include: { account: { select: { code: true, name: true } } } },
    },
  });
}

/** Create a mirror entry that reverses the original (swaps all debits and credits) */
async function inlineReverseLedgerEntry(
  prisma: Awaited<ReturnType<typeof getPrisma>>,
  entryId: string,
  userId: string
) {
  const original = await prisma.ledgerEntry.findUnique({
    where: { id: entryId },
    include: { lines: true },
  });
  if (!original) throw new Error('Ledger entry not found');
  if (original.isReversed) throw new Error('Entry is already reversed');

  const reversal = await prisma.ledgerEntry.create({
    data: {
      entryDate: original.entryDate,
      period: original.period,
      description: `Reversal: ${original.description}`,
      sourceType: 'adjustment',
      notes: `Reversal of entry ${original.id}`,
      createdById: userId,
      lines: {
        create: original.lines.map((line) => ({
          accountId: line.accountId,
          debit: line.credit, // swap
          credit: line.debit, // swap
          description: `Reversal: ${line.description ?? ''}`,
        })),
      },
    },
  });

  await prisma.ledgerEntry.update({
    where: { id: entryId },
    data: { isReversed: true, reversedById: reversal.id },
  });

  return reversal;
}

// ============================================
// DASHBOARD / SUMMARY
// ============================================

export const getFinanceSummary = createServerFn({ method: 'GET' })
  .middleware([authMiddleware])
  .handler(async () => {
    const prisma = await getPrisma();

    const accounts = await prisma.ledgerAccount.findMany({
      where: { isActive: true },
      select: { code: true, name: true, type: true, balance: true },
      orderBy: { code: 'asc' },
    });

    // Aggregate some useful summaries
    const totalPayable = accounts.find((a) => a.code === 'ACCOUNTS_PAYABLE')?.balance ?? 0;
    const totalReceivable = accounts.find((a) => a.code === 'ACCOUNTS_RECEIVABLE')?.balance ?? 0;

    // Count open invoices
    const [payableCount, receivableCount] = await Promise.all([
      prisma.invoice.count({ where: { type: 'payable', status: { in: ['confirmed', 'partially_paid'] } } }),
      prisma.invoice.count({ where: { type: 'receivable', status: { in: ['confirmed', 'partially_paid'] } } }),
    ]);

    return {
      success: true as const,
      accounts,
      summary: {
        totalPayable,
        totalReceivable,
        openPayableInvoices: payableCount,
        openReceivableInvoices: receivableCount,
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
             COALESCE(p.name, i."counterpartyName") AS counterparty,
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
             COALESCE(p.name, pay."counterpartyName") AS counterparty,
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

    // 3. Payments missing ledger entries
    const noEntry = await prisma.payment.count({
      where: { status: 'confirmed', ledgerEntryId: null },
    });
    if (noEntry > 0) {
      alerts.push({
        severity: 'error',
        category: 'Missing Ledger Entry',
        message: `${noEntry} confirmed payment(s) have no ledger entry`,
      });
    }

    // 4. Same vendor double-booked from different banks in same period
    const doubles = await prisma.$queryRaw<Array<{
      period: string; vendor: string; source_count: number; total: number; sources: string;
    }>>`
      WITH tagged AS (
        SELECT le.period, le."sourceType",
               ROUND(lel.debit::numeric) AS amount,
               CASE
                 WHEN le.description ILIKE '%facebook%' OR le.description ILIKE '%meta ads%' THEN 'Facebook'
                 WHEN (le.description ILIKE '%google india%' OR le.description ILIKE '%google ads%')
                      AND le.description NOT ILIKE '%play%' AND le.description NOT ILIKE '%service%' THEN 'Google Ads'
                 ELSE NULL
               END AS vendor
        FROM "LedgerEntryLine" lel
        JOIN "LedgerEntry" le ON le.id = lel."entryId"
        JOIN "LedgerAccount" la ON la.id = lel."accountId"
        WHERE la.type IN ('expense', 'direct_cost')
          AND le."isReversed" = false
          AND lel.debit > 0
          AND le."sourceType" IN ('bank_payout', 'hdfc_statement')
      )
      SELECT period, vendor,
             COUNT(DISTINCT "sourceType")::int AS source_count,
             SUM(amount)::float AS total,
             STRING_AGG(DISTINCT "sourceType", ' + ') AS sources
      FROM tagged
      WHERE vendor IS NOT NULL
      GROUP BY period, vendor
      HAVING COUNT(DISTINCT "sourceType") > 1
      ORDER BY period DESC
    `;
    for (const d of doubles) {
      alerts.push({
        severity: 'warning',
        category: 'Double-booked Vendor',
        message: `${d.vendor} in ${d.period}: Rs ${Math.round(d.total).toLocaleString('en-IN')} from ${d.sources}`,
        details: 'Same vendor paid from both HDFC and RazorpayX — check if one is a duplicate',
      });
    }

    // 5. Large unmatched payments (>50K, no invoice link)
    const unmatched = await prisma.$queryRaw<Array<{
      id: string; reference: string | null; counterparty: string | null;
      amount: number; unmatched: number; payment_date: Date;
    }>>`
      SELECT pay.id, pay."referenceNumber" AS reference,
             COALESCE(p.name, pay."counterpartyName") AS counterparty,
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

    // 7. Unbalanced ledger entries (debits != credits)
    const unbalanced = await prisma.$queryRaw<Array<{
      id: string; description: string; entry_date: Date;
      total_debit: number; total_credit: number;
    }>>`
      SELECT le.id, le.description, le."entryDate" AS entry_date,
             COALESCE(SUM(lel.debit), 0)::float AS total_debit,
             COALESCE(SUM(lel.credit), 0)::float AS total_credit
      FROM "LedgerEntry" le
      JOIN "LedgerEntryLine" lel ON lel."entryId" = le.id
      WHERE le."isReversed" = false
      GROUP BY le.id, le.description, le."entryDate"
      HAVING ABS(SUM(lel.debit) - SUM(lel.credit)) > 0.50
      ORDER BY ABS(SUM(lel.debit) - SUM(lel.credit)) DESC
      LIMIT 10
    `;
    for (const ub of unbalanced) {
      const diff = Math.abs(ub.total_debit - ub.total_credit);
      alerts.push({
        severity: 'error',
        category: 'Unbalanced Entry',
        message: `"${ub.description.slice(0, 50)}" — off by Rs ${Math.round(diff).toLocaleString('en-IN')}`,
        details: `Dr ${Math.round(ub.total_debit).toLocaleString('en-IN')} vs Cr ${Math.round(ub.total_credit).toLocaleString('en-IN')}`,
      });
    }

    // 8. Suspense balance (money in UNMATCHED_PAYMENTS needing reclassification)
    const suspense = await prisma.ledgerAccount.findFirst({
      where: { code: 'UNMATCHED_PAYMENTS' },
      select: { balance: true },
    });
    if (suspense && Math.abs(suspense.balance) > 100) {
      alerts.push({
        severity: 'warning',
        category: 'Suspense Balance',
        message: `Rs ${Math.abs(Math.round(suspense.balance)).toLocaleString('en-IN')} sitting in Unmatched Payments — needs reclassifying`,
        details: 'Create invoices and link to these payments to move money to correct accounts',
      });
    }

    // 9. Duplicate payments (same ref + similar amount + same counterparty)
    const dupes = await prisma.$queryRaw<Array<{
      reference: string; counterparty: string; amount: number; cnt: number;
    }>>`
      SELECT pay."referenceNumber" AS reference,
             COALESCE(p.name, pay."counterpartyName") AS counterparty,
             pay.amount::float AS amount,
             COUNT(*)::int AS cnt
      FROM "Payment" pay
      LEFT JOIN "Party" p ON p.id = pay."partyId"
      WHERE pay.status != 'cancelled'
        AND pay."referenceNumber" IS NOT NULL
        AND pay."referenceNumber" != ''
      GROUP BY pay."referenceNumber", COALESCE(p.name, pay."counterpartyName"), pay.amount
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

    // 10. Invoice paidAmount out of sync with actual PaymentInvoice records
    const invoiceMismatch = await prisma.$queryRaw<Array<{
      id: string; invoice_number: string | null; counterparty: string | null;
      paid_amount: number; actual_paid: number;
    }>>`
      SELECT i.id, i."invoiceNumber" AS invoice_number,
             COALESCE(p.name, i."counterpartyName") AS counterparty,
             i."paidAmount"::float AS paid_amount,
             COALESCE(SUM(pi.amount), 0)::float AS actual_paid
      FROM "Invoice" i
      LEFT JOIN "Party" p ON p.id = i."partyId"
      LEFT JOIN "PaymentInvoice" pi ON pi."invoiceId" = i.id
      WHERE i.status != 'cancelled'
      GROUP BY i.id, i."invoiceNumber", p.name, i."counterpartyName", i."paidAmount"
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
             COALESCE(p.name, pay."counterpartyName") AS counterparty,
             pay."matchedAmount"::float AS matched_amount,
             COALESCE(SUM(pi.amount), 0)::float AS actual_matched
      FROM "Payment" pay
      LEFT JOIN "Party" p ON p.id = pay."partyId"
      LEFT JOIN "PaymentInvoice" pi ON pi."paymentId" = pay.id
      WHERE pay.status != 'cancelled'
      GROUP BY pay.id, pay."referenceNumber", p.name, pay."counterpartyName", pay."matchedAmount"
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

    // 12. Confirmed invoices with no ledger entry AND no linked payment
    const orphanInvoices = await prisma.$queryRaw<Array<{
      id: string; invoice_number: string | null; counterparty: string | null;
      total_amount: number; status: string;
    }>>`
      SELECT i.id, i."invoiceNumber" AS invoice_number,
             COALESCE(p.name, i."counterpartyName") AS counterparty,
             i."totalAmount"::float AS total_amount,
             i.status
      FROM "Invoice" i
      LEFT JOIN "Party" p ON p.id = i."partyId"
      LEFT JOIN "PaymentInvoice" pi ON pi."invoiceId" = i.id
      WHERE i.status IN ('confirmed', 'partially_paid', 'paid')
        AND i."ledgerEntryId" IS NULL
        AND pi.id IS NULL
      LIMIT 10
    `;
    for (const inv of orphanInvoices) {
      alerts.push({
        severity: 'error',
        category: 'Orphan Invoice',
        message: `${inv.invoice_number || 'No #'} — ${inv.counterparty || 'Unknown'}: ${inv.status} but no ledger entry and no payment link`,
        details: `Rs ${Math.round(inv.total_amount).toLocaleString('en-IN')}`,
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

    // 14. Reversed entries still linked to invoices/payments
    const reversedStillLinked = await prisma.$queryRaw<Array<{
      id: string; description: string; linked_to: string;
    }>>`
      SELECT le.id, le.description,
             CASE
               WHEN i.id IS NOT NULL THEN 'Invoice ' || COALESCE(i."invoiceNumber", i.id::text)
               WHEN pay.id IS NOT NULL THEN 'Payment ' || COALESCE(pay."referenceNumber", pay.id::text)
               ELSE 'Unknown'
             END AS linked_to
      FROM "LedgerEntry" le
      LEFT JOIN "Invoice" i ON i."ledgerEntryId" = le.id
      LEFT JOIN "Payment" pay ON pay."ledgerEntryId" = le.id
      WHERE le."isReversed" = true
        AND (i.id IS NOT NULL OR pay.id IS NOT NULL)
      LIMIT 10
    `;
    for (const r of reversedStillLinked) {
      alerts.push({
        severity: 'error',
        category: 'Reversed But Linked',
        message: `"${r.description.slice(0, 40)}" was reversed but still linked to ${r.linked_to}`,
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

// ============================================
// INVOICE — LIST
// ============================================

export const listInvoices = createServerFn({ method: 'POST' })
  .middleware([authMiddleware])
  .inputValidator((input: unknown) => ListInvoicesInput.parse(input))
  .handler(async ({ data }) => {
    const prisma = await getPrisma();
    const { type, status, category, search, page = 1, limit = 50 } = data ?? {};
    const skip = (page - 1) * limit;

    const where: Record<string, unknown> = {};
    if (type) where.type = type;
    if (status) where.status = status;
    if (category) where.category = category;
    if (search) {
      where.OR = [
        { invoiceNumber: { contains: search, mode: 'insensitive' } },
        { counterpartyName: { contains: search, mode: 'insensitive' } },
        { notes: { contains: search, mode: 'insensitive' } },
      ];
    }

    const [invoices, total] = await Promise.all([
      prisma.invoice.findMany({
        where,
        select: {
          id: true,
          invoiceNumber: true,
          type: true,
          category: true,
          status: true,
          invoiceDate: true,
          dueDate: true,
          counterpartyName: true,
          totalAmount: true,
          tdsAmount: true,
          paidAmount: true,
          balanceDue: true,
          notes: true,
          driveUrl: true,
          createdAt: true,
          party: { select: { id: true, name: true, bankAccountName: true, bankAccountNumber: true, bankIfsc: true, phone: true, email: true } },
          customer: { select: { id: true, email: true, firstName: true, lastName: true } },
          _count: { select: { lines: true, matchedPayments: true } },
        },
        orderBy: [{ invoiceDate: 'desc' }, { createdAt: 'desc' }],
        skip,
        take: limit,
      }),
      prisma.invoice.count({ where }),
    ]);

    return { success: true as const, invoices, total, page, limit };
  });

// ============================================
// INVOICE — GET SINGLE
// ============================================

const getInvoiceInput = z.object({ id: z.string().uuid() });

export const getInvoice = createServerFn({ method: 'GET' })
  .middleware([authMiddleware])
  .inputValidator((input: unknown) => getInvoiceInput.parse(input))
  .handler(async ({ data }) => {
    const prisma = await getPrisma();

    const invoice = await prisma.invoice.findUnique({
      where: { id: data.id },
      include: {
        lines: true,
        matchedPayments: {
          include: {
            payment: {
              select: { id: true, referenceNumber: true, method: true, amount: true, paymentDate: true },
            },
            matchedBy: { select: { id: true, name: true } },
          },
        },
        ledgerEntry: {
          include: {
            lines: { include: { account: { select: { code: true, name: true } } } },
          },
        },
        party: { select: { id: true, name: true, tdsApplicable: true, tdsSection: true, tdsRate: true } },
        customer: { select: { id: true, email: true, firstName: true, lastName: true } },
        createdBy: { select: { id: true, name: true } },
      },
    });

    if (!invoice) return { success: false as const, error: 'Invoice not found' };

    // Strip file binary from response
    const { fileData: _, ...rest } = invoice;
    return { success: true as const, invoice: rest };
  });

// ============================================
// INVOICE — CREATE (draft)
// ============================================

export const createInvoice = createServerFn({ method: 'POST' })
  .middleware([authMiddleware])
  .inputValidator((input: unknown) => CreateInvoiceSchema.parse(input))
  .handler(async ({ data, context }) => {
    const prisma = await getPrisma();
    const userId = context.user.id;

    const invoice = await prisma.invoice.create({
      data: {
        invoiceNumber: data.invoiceNumber ?? null,
        type: data.type,
        category: data.category,
        status: 'draft',
        invoiceDate: data.invoiceDate ? new Date(data.invoiceDate) : null,
        dueDate: data.dueDate ? new Date(data.dueDate) : null,
        billingPeriod: data.billingPeriod ?? null,
        ...(data.partyId ? { partyId: data.partyId } : {}),
        ...(data.customerId ? { customerId: data.customerId } : {}),
        counterpartyName: data.counterpartyName ?? null,
        subtotal: data.subtotal ?? null,
        gstAmount: data.gstAmount ?? null,
        totalAmount: data.totalAmount,
        balanceDue: data.totalAmount,
        ...(data.orderId ? { orderId: data.orderId } : {}),
        ...(data.fabricInvoiceId ? { fabricInvoiceId: data.fabricInvoiceId } : {}),
        notes: data.notes ?? null,
        createdById: userId,
        ...(data.lines && data.lines.length > 0
          ? {
              lines: {
                create: data.lines.map((l) => ({
                  description: l.description ?? null,
                  hsnCode: l.hsnCode ?? null,
                  qty: l.qty ?? null,
                  unit: l.unit ?? null,
                  rate: l.rate ?? null,
                  amount: l.amount ?? null,
                  gstPercent: l.gstPercent ?? null,
                  gstAmount: l.gstAmount ?? null,
                })),
              },
            }
          : {}),
      },
      select: { id: true, invoiceNumber: true, status: true, totalAmount: true },
    });

    return { success: true as const, invoice };
  });

// ============================================
// INVOICE — UPDATE (draft only)
// ============================================

export const updateInvoice = createServerFn({ method: 'POST' })
  .middleware([authMiddleware])
  .inputValidator((input: unknown) => UpdateInvoiceSchema.parse(input))
  .handler(async ({ data }) => {
    const prisma = await getPrisma();

    const existing = await prisma.invoice.findUnique({
      where: { id: data.id },
      select: { status: true },
    });
    if (!existing) return { success: false as const, error: 'Invoice not found' };
    if (existing.status !== 'draft') return { success: false as const, error: 'Can only edit draft invoices' };

    const { id, ...updateData } = data;
    const updates: Record<string, unknown> = {};

    if (updateData.invoiceNumber !== undefined) updates.invoiceNumber = updateData.invoiceNumber;
    if (updateData.category !== undefined) updates.category = updateData.category;
    if (updateData.invoiceDate !== undefined) updates.invoiceDate = updateData.invoiceDate ? new Date(updateData.invoiceDate) : null;
    if (updateData.dueDate !== undefined) updates.dueDate = updateData.dueDate ? new Date(updateData.dueDate) : null;
    if (updateData.partyId !== undefined) updates.partyId = updateData.partyId;
    if (updateData.customerId !== undefined) updates.customerId = updateData.customerId;
    if (updateData.counterpartyName !== undefined) updates.counterpartyName = updateData.counterpartyName;
    if (updateData.subtotal !== undefined) updates.subtotal = updateData.subtotal;
    if (updateData.gstAmount !== undefined) updates.gstAmount = updateData.gstAmount;
    if (updateData.totalAmount !== undefined) {
      updates.totalAmount = updateData.totalAmount;
      updates.balanceDue = updateData.totalAmount; // Reset since still draft
    }
    if (updateData.notes !== undefined) updates.notes = updateData.notes;
    if (updateData.billingPeriod !== undefined) updates.billingPeriod = updateData.billingPeriod;

    await prisma.invoice.update({ where: { id }, data: updates });

    return { success: true as const };
  });

// ============================================
// INVOICE — CONFIRM (draft → confirmed + ledger entry)
// ============================================

const confirmInvoiceInput = z.object({
  id: z.string().uuid(),
  linkedPaymentId: z.string().uuid().optional(),
});

export const confirmInvoice = createServerFn({ method: 'POST' })
  .middleware([authMiddleware])
  .inputValidator((input: unknown) => confirmInvoiceInput.parse(input))
  .handler(async ({ data, context }) => {
    const prisma = await getPrisma();
    const userId = context.user.id;

    const invoice = await prisma.invoice.findUnique({
      where: { id: data.id },
      select: { id: true, type: true, category: true, status: true, totalAmount: true, gstAmount: true, subtotal: true, counterpartyName: true, invoiceNumber: true, partyId: true, invoiceDate: true, billingPeriod: true },
    });

    if (!invoice) return { success: false as const, error: 'Invoice not found' };
    if (invoice.status !== 'draft') return { success: false as const, error: 'Can only confirm draft invoices' };

    // Calculate TDS for payable invoices with a TDS-enabled party
    let tdsAmount = 0;
    if (invoice.type === 'payable' && invoice.partyId) {
      const party = await prisma.party.findUnique({
        where: { id: invoice.partyId },
        select: { tdsApplicable: true, tdsRate: true },
      });
      if (party?.tdsApplicable && party.tdsRate && party.tdsRate > 0) {
        const subtotal = invoice.totalAmount - (invoice.gstAmount ?? 0);
        tdsAmount = Math.round(subtotal * (party.tdsRate / 100) * 100) / 100;
      }
    }

    // ---- LINKED PAYMENT PATH (already-paid bill) ----
    if (data.linkedPaymentId && invoice.type === 'payable') {
      return confirmInvoiceWithLinkedPayment(prisma, invoice, data.linkedPaymentId, tdsAmount, userId);
    }

    // ---- NORMAL AP PATH (invoice first, pay later) ----
    const lines = buildInvoiceLedgerLines(invoice, tdsAmount);

    return prisma.$transaction(async (tx) => {
      const invoiceEntryDate = invoice.invoiceDate ? new Date(invoice.invoiceDate) : new Date();
      const entry = await inlineCreateLedgerEntry(tx as typeof prisma, {
        entryDate: invoiceEntryDate,
        period: invoice.billingPeriod ?? dateToPeriod(invoiceEntryDate),
        description: `Invoice ${invoice.invoiceNumber ?? invoice.id} confirmed (${invoice.type})`,
        sourceType: 'invoice_confirmed',
        sourceId: invoice.id,
        lines,
        createdById: userId,
      });

      await tx.invoice.update({
        where: { id: invoice.id },
        data: {
          status: 'confirmed',
          ledgerEntryId: entry.id,
          ...(tdsAmount > 0 ? { tdsAmount, balanceDue: invoice.totalAmount - tdsAmount } : {}),
        },
      });

      return { success: true as const };
    });
  });

/**
 * Confirm an invoice and link it to an existing payment.
 * Instead of creating AP, posts an adjustment entry to fix expense category / split GST / book TDS.
 *
 * The match amount uses the net payable (totalAmount - tdsAmount) because TDS is withheld
 * and never paid to the vendor. So payment.amount should roughly equal matchAmount.
 */
async function confirmInvoiceWithLinkedPayment(
  prisma: Awaited<ReturnType<typeof getPrisma>>,
  invoice: { id: string; category: string; totalAmount: number; gstAmount: number | null; subtotal: number | null; invoiceNumber: string | null; invoiceDate: Date | null; billingPeriod: string | null },
  paymentId: string,
  tdsAmount: number,
  userId: string,
) {
  // The amount the vendor was actually paid (total minus TDS withheld)
  const matchAmount = invoice.totalAmount - tdsAmount;

  // Look up the payment and its ledger entry lines
  const payment = await prisma.payment.findUnique({
    where: { id: paymentId },
    select: {
      id: true, amount: true, unmatchedAmount: true, matchedAmount: true, status: true,
      paymentDate: true, ledgerEntryId: true,
      ledgerEntry: { include: { lines: { include: { account: { select: { code: true } } } } } },
    },
  });
  if (!payment) throw new Error('Payment not found');
  if (payment.status === 'cancelled') throw new Error('Payment is cancelled');
  if (!payment.ledgerEntry) throw new Error('Payment has no ledger entry — cannot determine original account');
  if (payment.unmatchedAmount < matchAmount - 0.01) throw new Error('Payment unmatched amount is less than invoice net payable');

  // Find what account the bank import originally debited (skip bank/cash accounts)
  const bankCodes = new Set(['BANK_HDFC', 'BANK_RAZORPAYX', 'CASH']);
  const originalDebitLine = payment.ledgerEntry.lines.find(l => l.debit > 0 && !bankCodes.has(l.account.code));
  const originalAccount = originalDebitLine?.account.code ?? 'OPERATING_EXPENSES';

  // Figure out the correct expense account from the invoice category
  const correctExpense = categoryToExpenseAccount(invoice.category);
  const gstAmount = invoice.gstAmount ?? 0;
  const netAmount = invoice.totalAmount - gstAmount;

  // Build adjustment lines (only if something needs fixing)
  const needsAdjustment = originalAccount !== correctExpense || gstAmount > 0 || tdsAmount > 0;

  // Determine the correct P&L period for this invoice
  const invoiceEntryDate = invoice.invoiceDate ? new Date(invoice.invoiceDate) : new Date(payment.paymentDate);
  const invoicePeriod = invoice.billingPeriod ?? dateToPeriod(invoiceEntryDate);

  // Use a transaction to keep all writes atomic
  return prisma.$transaction(async (tx) => {
    let adjustmentEntryId: string | null = null;

    if (needsAdjustment) {
      const adjustmentLines: LedgerLineInput[] = [];

      // Debit the correct expense account for the net amount
      adjustmentLines.push({ accountCode: correctExpense, debit: netAmount, description: `${invoice.category} expense (invoice ${invoice.invoiceNumber ?? invoice.id})` });

      // Debit GST if the invoice has it
      if (gstAmount > 0) {
        adjustmentLines.push({ accountCode: 'GST_INPUT', debit: gstAmount, description: 'GST input credit (from invoice)' });
      }

      // Credit the original account (reverse what the bank import debited)
      adjustmentLines.push({ accountCode: originalAccount, credit: matchAmount, description: `Reclassify from ${originalAccount}` });

      // Credit TDS if applicable
      if (tdsAmount > 0) {
        adjustmentLines.push({ accountCode: 'TDS_PAYABLE', credit: tdsAmount, description: 'TDS deducted at source' });
      }

      const adjEntry = await inlineCreateLedgerEntry(tx as typeof prisma, {
        entryDate: invoiceEntryDate,
        period: invoicePeriod,
        description: `Invoice ${invoice.invoiceNumber ?? invoice.id} linked to payment — reclassification`,
        sourceType: 'invoice_payment_linked',
        sourceId: invoice.id,
        lines: adjustmentLines,
        createdById: userId,
      });
      adjustmentEntryId = adjEntry.id;
    }

    // Update the payment's ledger entry period to match the invoice's billing period
    // This moves the expense from the cash-basis month to the accrual-basis month
    if (payment.ledgerEntryId) {
      await tx.ledgerEntry.update({
        where: { id: payment.ledgerEntryId },
        data: { period: invoicePeriod },
      });
    }

    // Create PaymentInvoice match record
    await tx.paymentInvoice.create({
      data: {
        paymentId,
        invoiceId: invoice.id,
        amount: matchAmount,
        notes: 'Auto-linked on invoice confirm',
        matchedById: userId,
      },
    });

    // Update Payment: matched/unmatched amounts
    await tx.payment.update({
      where: { id: paymentId },
      data: {
        matchedAmount: payment.matchedAmount + matchAmount,
        unmatchedAmount: Math.max(0, payment.unmatchedAmount - matchAmount),
      },
    });

    // Update Invoice: mark as paid, link adjustment entry if one was created
    // Note: ledgerEntryId has a @unique constraint, so only set it if we made a new entry
    await tx.invoice.update({
      where: { id: invoice.id },
      data: {
        status: 'paid',
        paidAmount: matchAmount,
        balanceDue: 0,
        ...(adjustmentEntryId ? { ledgerEntryId: adjustmentEntryId } : {}),
        ...(tdsAmount > 0 ? { tdsAmount } : {}),
      },
    });

    return { success: true as const, linked: true as const };
  });
}

/**
 * Build ledger lines for an invoice confirmation.
 * Payable: Dr expense account, Cr ACCOUNTS_PAYABLE (less TDS), Cr TDS_PAYABLE
 * Receivable: Dr ACCOUNTS_RECEIVABLE, Cr SALES_REVENUE
 */
function buildInvoiceLedgerLines(invoice: {
  type: string;
  category: string;
  totalAmount: number;
  gstAmount: number | null;
}, tdsAmount = 0) {
  const { type, category, totalAmount, gstAmount } = invoice;
  const netAmount = totalAmount - (gstAmount ?? 0);

  if (type === 'payable') {
    // Figure out which expense account to debit based on category
    const expenseAccount = categoryToExpenseAccount(category);
    const lines = [
      { accountCode: expenseAccount, debit: netAmount, description: `${category} expense` },
      { accountCode: 'ACCOUNTS_PAYABLE', credit: totalAmount - tdsAmount, description: 'Amount owed to vendor' },
    ];
    if (gstAmount && gstAmount > 0) {
      lines.push({ accountCode: 'GST_INPUT', debit: gstAmount, description: 'GST input credit' });
    }
    if (tdsAmount > 0) {
      lines.push({ accountCode: 'TDS_PAYABLE', credit: tdsAmount, description: 'TDS deducted at source' });
    }
    return lines;
  }

  // Receivable
  const lines = [
    { accountCode: 'ACCOUNTS_RECEIVABLE', debit: totalAmount, description: 'Amount due from customer' },
    { accountCode: 'SALES_REVENUE', credit: netAmount, description: 'Revenue' },
  ];
  if (gstAmount && gstAmount > 0) {
    lines.push({ accountCode: 'GST_OUTPUT', credit: gstAmount, description: 'GST output liability' });
  }
  return lines;
}

/** Map invoice category → ledger expense account code */
function categoryToExpenseAccount(category: string): string {
  switch (category) {
    case 'fabric':
      return 'FABRIC_INVENTORY';
    case 'trims':
    case 'packaging':
      return 'FABRIC_INVENTORY'; // Raw materials bucket
    case 'service':
      return 'OPERATING_EXPENSES';
    case 'logistics':
      return 'OPERATING_EXPENSES';
    case 'rent':
    case 'salary':
    case 'equipment':
      return 'OPERATING_EXPENSES';
    case 'marketing':
      return 'OPERATING_EXPENSES';
    case 'marketplace':
      return 'MARKETPLACE_FEES';
    case 'statutory':
      return 'TDS_PAYABLE';
    default:
      return 'OPERATING_EXPENSES';
  }
}

// ============================================
// INVOICE — CANCEL
// ============================================

const cancelInvoiceInput = z.object({ id: z.string().uuid() });

export const cancelInvoice = createServerFn({ method: 'POST' })
  .middleware([authMiddleware])
  .inputValidator((input: unknown) => cancelInvoiceInput.parse(input))
  .handler(async ({ data, context }) => {
    const prisma = await getPrisma();
    const userId = context.user.id;

    const invoice = await prisma.invoice.findUnique({
      where: { id: data.id },
      select: { id: true, status: true, ledgerEntryId: true },
    });

    if (!invoice) return { success: false as const, error: 'Invoice not found' };
    if (invoice.status === 'cancelled') return { success: false as const, error: 'Already cancelled' };
    if (invoice.status === 'paid') return { success: false as const, error: 'Cannot cancel a paid invoice' };

    return prisma.$transaction(async (tx) => {
      // 1. Clean up payment matches (restore unmatched amounts on linked payments)
      const matches = await tx.paymentInvoice.findMany({
        where: { invoiceId: data.id },
      });
      if (matches.length > 0) {
        for (const match of matches) {
          await tx.payment.update({
            where: { id: match.paymentId },
            data: {
              matchedAmount: { decrement: match.amount },
              unmatchedAmount: { increment: match.amount },
            },
          });
        }
        await tx.paymentInvoice.deleteMany({ where: { invoiceId: data.id } });
      }

      // 2. Reverse ledger entry if one exists
      if (invoice.ledgerEntryId) {
        await inlineReverseLedgerEntry(tx as typeof prisma, invoice.ledgerEntryId, userId);
      }

      // 3. Cancel the invoice and reset paid amounts
      await tx.invoice.update({
        where: { id: data.id },
        data: { status: 'cancelled', paidAmount: 0, balanceDue: 0 },
      });

      return { success: true as const };
    });
  });

// ============================================
// PAYMENT — LIST
// ============================================

export const listPayments = createServerFn({ method: 'POST' })
  .middleware([authMiddleware])
  .inputValidator((input: unknown) => ListPaymentsInput.parse(input))
  .handler(async ({ data }) => {
    const prisma = await getPrisma();
    const { direction, method, status, matchStatus, search, page = 1, limit = 50 } = data ?? {};
    const skip = (page - 1) * limit;

    const where: Record<string, unknown> = {};
    if (direction) where.direction = direction;
    if (method) where.method = method;
    if (status) where.status = status;
    if (matchStatus === 'unmatched') where.unmatchedAmount = { gt: 0.01 };
    if (matchStatus === 'matched') where.unmatchedAmount = { lte: 0.01 };
    if (search) {
      where.OR = [
        { referenceNumber: { contains: search, mode: 'insensitive' } },
        { counterpartyName: { contains: search, mode: 'insensitive' } },
        { notes: { contains: search, mode: 'insensitive' } },
      ];
    }

    const [payments, total] = await Promise.all([
      prisma.payment.findMany({
        where,
        select: {
          id: true,
          referenceNumber: true,
          direction: true,
          method: true,
          status: true,
          amount: true,
          matchedAmount: true,
          unmatchedAmount: true,
          paymentDate: true,
          counterpartyName: true,
          notes: true,
          createdAt: true,
          party: { select: { id: true, name: true } },
          customer: { select: { id: true, email: true, firstName: true, lastName: true } },
          _count: { select: { matchedInvoices: true } },
        },
        orderBy: { paymentDate: 'desc' },
        skip,
        take: limit,
      }),
      prisma.payment.count({ where }),
    ]);

    return { success: true as const, payments, total, page, limit };
  });

// ============================================
// PAYMENT — CREATE (+ auto ledger entry)
// ============================================

export const createFinancePayment = createServerFn({ method: 'POST' })
  .middleware([authMiddleware])
  .inputValidator((input: unknown) => CreateFinancePaymentSchema.parse(input))
  .handler(async ({ data, context }) => {
    const prisma = await getPrisma();
    const userId = context.user.id;
    const lines = buildPaymentLedgerLines(data);
    const sourceType = data.direction === 'outgoing' ? 'payment_outgoing' : 'payment_received';

    return prisma.$transaction(async (tx) => {
      const paymentEntryDate = new Date(data.paymentDate);
      const entry = await inlineCreateLedgerEntry(tx as typeof prisma, {
        entryDate: paymentEntryDate,
        period: dateToPeriod(paymentEntryDate),
        description: `Payment ${data.direction}: ${data.counterpartyName ?? data.method} — ${data.amount}`,
        sourceType,
        sourceId: `payment_${data.referenceNumber ?? data.paymentDate}_${data.counterpartyName ?? 'unknown'}_${data.amount}`,
        lines,
        createdById: userId,
      });

      const payment = await tx.payment.create({
        data: {
          referenceNumber: data.referenceNumber ?? null,
          direction: data.direction,
          method: data.method,
          status: 'confirmed',
          amount: data.amount,
          unmatchedAmount: data.amount,
          paymentDate: new Date(data.paymentDate),
          ...(data.partyId ? { partyId: data.partyId } : {}),
          ...(data.customerId ? { customerId: data.customerId } : {}),
          counterpartyName: data.counterpartyName ?? null,
          ledgerEntryId: entry.id,
          notes: data.notes ?? null,
          createdById: userId,
        },
        select: { id: true, referenceNumber: true, amount: true, direction: true },
      });

      return { success: true as const, payment };
    });
  });

/**
 * Build ledger lines for a payment.
 * Outgoing: Dr ACCOUNTS_PAYABLE, Cr BANK
 * Incoming: Dr BANK, Cr ACCOUNTS_RECEIVABLE
 */
function buildPaymentLedgerLines(data: {
  direction: string;
  method: string;
  amount: number;
}) {
  // Route to the correct bank account:
  // Cash → CASH, outgoing (vendor payouts) → BANK_RAZORPAYX, incoming → BANK_HDFC
  const cashAccount = data.method === 'cash' ? 'CASH'
    : data.direction === 'outgoing' ? 'BANK_RAZORPAYX'
    : 'BANK_HDFC';

  if (data.direction === 'outgoing') {
    return [
      { accountCode: 'ACCOUNTS_PAYABLE', debit: data.amount, description: 'Vendor payment' },
      { accountCode: cashAccount, credit: data.amount, description: `Paid via ${data.method}` },
    ];
  }

  return [
    { accountCode: cashAccount, debit: data.amount, description: `Received via ${data.method}` },
    { accountCode: 'ACCOUNTS_RECEIVABLE', credit: data.amount, description: 'Customer payment' },
  ];
}

// ============================================
// PAYMENT — MATCH TO INVOICE
// ============================================

export const matchPaymentToInvoice = createServerFn({ method: 'POST' })
  .middleware([authMiddleware])
  .inputValidator((input: unknown) => MatchPaymentInvoiceSchema.parse(input))
  .handler(async ({ data, context }) => {
    const prisma = await getPrisma();
    const userId = context.user.id;

    const [payment, invoice] = await Promise.all([
      prisma.payment.findUnique({ where: { id: data.paymentId }, select: { id: true, unmatchedAmount: true, matchedAmount: true, status: true } }),
      prisma.invoice.findUnique({ where: { id: data.invoiceId }, select: { id: true, balanceDue: true, paidAmount: true, status: true } }),
    ]);

    if (!payment) return { success: false as const, error: 'Payment not found' };
    if (!invoice) return { success: false as const, error: 'Invoice not found' };
    if (payment.status === 'cancelled') return { success: false as const, error: 'Payment is cancelled' };
    if (invoice.status === 'cancelled') return { success: false as const, error: 'Invoice is cancelled' };
    if (data.amount > payment.unmatchedAmount + 0.01) return { success: false as const, error: 'Amount exceeds unmatched payment balance' };
    if (data.amount > invoice.balanceDue + 0.01) return { success: false as const, error: 'Amount exceeds invoice balance due' };

    return prisma.$transaction(async (tx) => {
      await tx.paymentInvoice.create({
        data: {
          paymentId: data.paymentId,
          invoiceId: data.invoiceId,
          amount: data.amount,
          notes: data.notes ?? null,
          matchedById: userId,
        },
      });

      const newPaymentMatched = payment.matchedAmount + data.amount;
      const newPaymentUnmatched = payment.unmatchedAmount - data.amount;
      await tx.payment.update({
        where: { id: data.paymentId },
        data: { matchedAmount: newPaymentMatched, unmatchedAmount: Math.max(0, newPaymentUnmatched) },
      });

      const newInvoicePaid = invoice.paidAmount + data.amount;
      const newInvoiceBalance = invoice.balanceDue - data.amount;
      const newStatus = newInvoiceBalance <= 0.01 ? 'paid' : 'partially_paid';
      await tx.invoice.update({
        where: { id: data.invoiceId },
        data: { paidAmount: newInvoicePaid, balanceDue: Math.max(0, newInvoiceBalance), status: newStatus },
      });

      return { success: true as const };
    });
  });

// ============================================
// PAYMENT — UNMATCH
// ============================================

const unmatchInput = z.object({
  paymentId: z.string().uuid(),
  invoiceId: z.string().uuid(),
});

export const unmatchPayment = createServerFn({ method: 'POST' })
  .middleware([authMiddleware])
  .inputValidator((input: unknown) => unmatchInput.parse(input))
  .handler(async ({ data }) => {
    const prisma = await getPrisma();

    const match = await prisma.paymentInvoice.findUnique({
      where: { paymentId_invoiceId: { paymentId: data.paymentId, invoiceId: data.invoiceId } },
    });

    if (!match) return { success: false as const, error: 'Match not found' };

    return prisma.$transaction(async (tx) => {
      await tx.paymentInvoice.delete({
        where: { paymentId_invoiceId: { paymentId: data.paymentId, invoiceId: data.invoiceId } },
      });

      await tx.payment.update({
        where: { id: data.paymentId },
        data: {
          matchedAmount: { decrement: match.amount },
          unmatchedAmount: { increment: match.amount },
        },
      });

      const invoice = await tx.invoice.findUnique({
        where: { id: data.invoiceId },
        select: { paidAmount: true, balanceDue: true, status: true },
      });

      if (invoice) {
        const newPaid = invoice.paidAmount - match.amount;
        const newBalance = invoice.balanceDue + match.amount;
        const newStatus = newPaid <= 0.01 ? 'confirmed' : 'partially_paid';
        await tx.invoice.update({
          where: { id: data.invoiceId },
          data: { paidAmount: Math.max(0, newPaid), balanceDue: newBalance, status: newStatus },
        });
      }

      return { success: true as const };
    });
  });

// ============================================
// LEDGER — LIST ENTRIES
// ============================================

export const listLedgerEntries = createServerFn({ method: 'POST' })
  .middleware([authMiddleware])
  .inputValidator((input: unknown) => ListLedgerEntriesInput.parse(input))
  .handler(async ({ data }) => {
    const prisma = await getPrisma();
    const { accountCode, sourceType, search, page = 1, limit = 50 } = data ?? {};
    const skip = (page - 1) * limit;

    const where: Record<string, unknown> = {};
    if (sourceType) where.sourceType = sourceType;
    if (search) {
      where.OR = [
        { description: { contains: search, mode: 'insensitive' } },
        { notes: { contains: search, mode: 'insensitive' } },
      ];
    }
    if (accountCode) {
      where.lines = { some: { account: { code: accountCode } } };
    }

    const [entries, total] = await Promise.all([
      prisma.ledgerEntry.findMany({
        where,
        include: {
          lines: {
            include: { account: { select: { code: true, name: true, type: true } } },
          },
          createdBy: { select: { id: true, name: true } },
        },
        orderBy: { entryDate: 'desc' },
        skip,
        take: limit,
      }),
      prisma.ledgerEntry.count({ where }),
    ]);

    return { success: true as const, entries, total, page, limit };
  });

// ============================================
// LEDGER — MANUAL ENTRY
// ============================================

export const createManualEntry = createServerFn({ method: 'POST' })
  .middleware([authMiddleware])
  .inputValidator((input: unknown) => CreateManualLedgerEntrySchema.parse(input))
  .handler(async ({ data, context }) => {
    const prisma = await getPrisma();
    const userId = context.user.id;
    const manualEntryDate = new Date(data.entryDate);
    const entry = await inlineCreateLedgerEntry(prisma, {
      entryDate: manualEntryDate,
      period: dateToPeriod(manualEntryDate),
      description: data.description,
      sourceType: 'manual',
      lines: data.lines.map((l) => ({
        accountCode: l.accountCode,
        debit: l.debit,
        credit: l.credit,
        description: l.description,
      })),
      createdById: userId,
      notes: data.notes,
    });

    return { success: true as const, entry: { id: entry.id } };
  });

// ============================================
// LEDGER — REVERSE ENTRY
// ============================================

const reverseEntryInput = z.object({ id: z.string().uuid() });

export const reverseEntry = createServerFn({ method: 'POST' })
  .middleware([authMiddleware])
  .inputValidator((input: unknown) => reverseEntryInput.parse(input))
  .handler(async ({ data, context }) => {
    const prisma = await getPrisma();
    const userId = context.user.id;
    const reversal = await inlineReverseLedgerEntry(prisma, data.id, userId);
    return { success: true as const, reversal: { id: reversal.id } };
  });

// ============================================
// FIND UNMATCHED PAYMENTS (for invoice linking)
// ============================================

const findUnmatchedPaymentsInput = z.object({
  counterpartyName: z.string().optional(),
  amountMin: z.number().optional(),
  amountMax: z.number().optional(),
}).optional();

export const findUnmatchedPayments = createServerFn({ method: 'POST' })
  .middleware([authMiddleware])
  .inputValidator((input: unknown) => findUnmatchedPaymentsInput.parse(input))
  .handler(async ({ data }) => {
    const prisma = await getPrisma();
    const { counterpartyName, amountMin, amountMax } = data ?? {};

    const where: Record<string, unknown> = {
      direction: 'outgoing',
      status: 'confirmed',
      unmatchedAmount: { gt: 0.01 },
    };

    if (counterpartyName) {
      // Look up Party aliases so we match all known names (e.g. "Google India Pvt. Ltd." + "GOOGLE INDIA DIGITAL")
      const party = await prisma.party.findFirst({
        where: { name: { equals: counterpartyName, mode: 'insensitive' } },
        select: { aliases: true },
      });
      const allNames = [counterpartyName, ...(party?.aliases ?? [])];
      where.OR = allNames.map((n) => ({ counterpartyName: { contains: n, mode: 'insensitive' } }));
    }
    if (amountMin !== undefined || amountMax !== undefined) {
      where.amount = {
        ...(amountMin !== undefined ? { gte: amountMin } : {}),
        ...(amountMax !== undefined ? { lte: amountMax } : {}),
      };
    }

    const payments = await prisma.payment.findMany({
      where,
      select: {
        id: true,
        amount: true,
        unmatchedAmount: true,
        paymentDate: true,
        referenceNumber: true,
        counterpartyName: true,
        method: true,
        notes: true,
        ledgerEntry: {
          select: {
            lines: {
              select: {
                account: { select: { code: true, name: true } },
                debit: true,
              },
              where: { debit: { gt: 0 } },
            },
          },
        },
      },
      orderBy: { paymentDate: 'desc' },
      take: 20,
    });

    return { success: true as const, payments };
  });

// ============================================
// MONTHLY P&L (accrual basis, grouped by period)
// ============================================

export const getMonthlyPnl = createServerFn({ method: 'GET' })
  .middleware([authMiddleware])
  .handler(async () => {
    const prisma = await getPrisma();

    // Raw query: group by period + account type, excluding reversed entries
    const rows = await prisma.$queryRaw<Array<{
      period: string;
      account_type: string;
      account_code: string;
      account_name: string;
      total_debit: number;
      total_credit: number;
    }>>`
      SELECT
        le."period",
        la."type" AS account_type,
        la."code" AS account_code,
        la."name" AS account_name,
        COALESCE(SUM(lel."debit"), 0)::float AS total_debit,
        COALESCE(SUM(lel."credit"), 0)::float AS total_credit
      FROM "LedgerEntryLine" lel
      JOIN "LedgerEntry" le ON le.id = lel."entryId"
      JOIN "LedgerAccount" la ON la.id = lel."accountId"
      WHERE le."isReversed" = false
        AND la."type" IN ('income', 'direct_cost', 'expense')
      GROUP BY le."period", la."type", la."code", la."name"
      ORDER BY le."period" DESC, la."type", la."code"
    `;

    // Build per-month P&L with account-level breakdowns
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

    for (const row of rows) {
      if (!monthMap.has(row.period)) {
        monthMap.set(row.period, {
          period: row.period,
          revenueLines: [], cogsLines: [], expenseLines: [],
          totalRevenue: 0, totalCogs: 0, totalExpenses: 0,
        });
      }
      const month = monthMap.get(row.period)!;

      if (row.account_type === 'income') {
        const amount = row.total_credit - row.total_debit;
        if (Math.abs(amount) > 0.01) {
          month.revenueLines.push({ code: row.account_code, name: row.account_name, amount });
          month.totalRevenue += amount;
        }
      } else if (row.account_type === 'direct_cost') {
        const amount = row.total_debit - row.total_credit;
        if (Math.abs(amount) > 0.01) {
          month.cogsLines.push({ code: row.account_code, name: row.account_name, amount });
          month.totalCogs += amount;
        }
      } else if (row.account_type === 'expense') {
        const amount = row.total_debit - row.total_credit;
        if (Math.abs(amount) > 0.01) {
          month.expenseLines.push({ code: row.account_code, name: row.account_name, amount });
          month.totalExpenses += amount;
        }
      }
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
// P&L ACCOUNT DETAIL (drill-down)
// ============================================

const pnlAccountDetailInput = z.object({
  period: z.string().regex(/^\d{4}-\d{2}$/),
  accountCode: z.string(),
});

export const getPnlAccountDetail = createServerFn({ method: 'POST' })
  .middleware([authMiddleware])
  .inputValidator((input: unknown) => pnlAccountDetailInput.parse(input))
  .handler(async ({ data }) => {
    const prisma = await getPrisma();

    // Get individual entries for this account + period
    const rows = await prisma.$queryRaw<Array<{
      entry_id: string;
      description: string;
      source_type: string;
      entry_date: Date;
      debit: number;
      credit: number;
      invoice_category: string | null;
      counterparty: string | null;
    }>>`
      SELECT
        le.id AS entry_id,
        le.description,
        le."sourceType" AS source_type,
        le."entryDate" AS entry_date,
        lel.debit::float AS debit,
        lel.credit::float AS credit,
        i.category AS invoice_category,
        COALESCE(p.name, i."counterpartyName", pay."counterpartyName") AS counterparty
      FROM "LedgerEntryLine" lel
      JOIN "LedgerEntry" le ON le.id = lel."entryId"
      JOIN "LedgerAccount" la ON la.id = lel."accountId"
      LEFT JOIN "Invoice" i ON i."ledgerEntryId" = le.id
      LEFT JOIN "Payment" pay ON pay."ledgerEntryId" = le.id
      LEFT JOIN "Party" p ON p.id = COALESCE(i."partyId", pay."partyId")
      WHERE le."isReversed" = false
        AND la.code = ${data.accountCode}
        AND le.period = ${data.period}
        AND (lel.debit > 0.01 OR lel.credit > 0.01)
      ORDER BY GREATEST(lel.debit, lel.credit) DESC
    `;

    // Categorize each entry
    type DetailLine = { description: string; amount: number; date: string; counterparty: string | null };
    const categoryMap = new Map<string, { label: string; total: number; lines: DetailLine[] }>();

    const addToCategory = (key: string, label: string, line: DetailLine) => {
      if (!categoryMap.has(key)) categoryMap.set(key, { label, total: 0, lines: [] });
      const cat = categoryMap.get(key)!;
      cat.total += line.amount;
      cat.lines.push(line);
    };

    for (const row of rows) {
      const amount = Math.round(Math.max(row.debit, row.credit) * 100) / 100;
      const date = new Date(row.entry_date).toISOString().slice(0, 10);
      const line: DetailLine = { description: row.description, amount, date, counterparty: row.counterparty };

      // Use invoice category if available
      if (row.invoice_category) {
        addToCategory(row.invoice_category, row.invoice_category, line);
        continue;
      }

      // Parse description prefix for bank entries
      const desc = row.description;
      if (desc.startsWith('Salary:') || desc.startsWith('Salary ')) {
        addToCategory('salary', 'Salary & Wages', line);
      } else if (desc.startsWith('Vendor:')) {
        // Extract purpose from "Vendor: <purpose> — <name>"
        const purpose = desc.replace(/^Vendor:\s*/, '').split('—')[0].trim().toLowerCase();
        if (purpose.includes('marketing') || purpose.includes('social media') || purpose.includes('photoshoot') || purpose.includes('styling') || purpose.includes('model')) {
          addToCategory('marketing', 'Marketing & Creative', line);
        } else if (purpose.includes('rent') || purpose.includes('architect')) {
          addToCategory('rent', 'Rent & Premises', line);
        } else if (purpose.includes('tds') || purpose.includes('pf') || purpose.includes('statutory')) {
          addToCategory('statutory', 'Statutory (TDS/PF)', line);
        } else if (purpose.includes('salary') || purpose.includes('wage')) {
          addToCategory('salary', 'Salary & Wages', line);
        } else {
          addToCategory('service', 'Services & Professional', line);
        }
      } else if (desc.startsWith('CC HDFC:') || desc.startsWith('CC ICICI:')) {
        addToCategory('cc_charges', 'Credit Card Charges', line);
      } else if (desc.includes('PF deposit') || desc.includes('CBDT') || desc.includes('TDS')) {
        addToCategory('statutory', 'Statutory (TDS/PF)', line);
      } else if (desc.includes('Google') || desc.includes('Facebook') || desc.includes('Meta')) {
        addToCategory('marketing', 'Marketing & Creative', line);
      } else if (desc.includes('Reimbursement')) {
        addToCategory('reimbursement', 'Reimbursements', line);
      } else if (desc.includes('Standing Instruction') || desc.includes(' SI ')) {
        addToCategory('bank_charges', 'Bank & SI Charges', line);
      } else {
        addToCategory('other', 'Other', line);
      }
    }

    // Sort categories by total descending
    const categories = Array.from(categoryMap.values())
      .map((c) => ({ ...c, total: Math.round(c.total * 100) / 100 }))
      .sort((a, b) => b.total - a.total);

    return { success: true as const, categories };
  });

// ============================================
// COUNTERPARTY SEARCH (for dropdowns)
// ============================================

const searchCounterpartiesInput = z.object({
  query: z.string().min(1),
  type: z.enum(['party', 'customer']).optional(),
});

export const searchCounterparties = createServerFn({ method: 'GET' })
  .middleware([authMiddleware])
  .inputValidator((input: unknown) => searchCounterpartiesInput.parse(input))
  .handler(async ({ data }) => {
    const prisma = await getPrisma();
    const results: Array<{ id: string; name: string; type: string }> = [];

    if (!data.type || data.type === 'party') {
      const parties = await prisma.party.findMany({
        where: { name: { contains: data.query, mode: 'insensitive' }, isActive: true },
        select: { id: true, name: true },
        take: 10,
      });
      results.push(...parties.map((p) => ({ id: p.id, name: p.name, type: 'party' as const })));
    }

    if (!data.type || data.type === 'customer') {
      const customers = await prisma.customer.findMany({
        where: {
          OR: [
            { email: { contains: data.query, mode: 'insensitive' } },
            { firstName: { contains: data.query, mode: 'insensitive' } },
            { lastName: { contains: data.query, mode: 'insensitive' } },
          ],
        },
        select: { id: true, email: true, firstName: true, lastName: true },
        take: 10,
      });
      results.push(
        ...customers.map((c) => ({
          id: c.id,
          name: [c.firstName, c.lastName].filter(Boolean).join(' ') || c.email,
          type: 'customer' as const,
        }))
      );
    }

    return { success: true as const, results };
  });
