/**
 * Finance Bank Transactions — List
 */

'use server';

import { createServerFn } from '@tanstack/react-start';
import { authMiddleware } from '../../middleware/auth';
import { getPrisma } from '@coh/shared/services/db';
import {
  ListBankTransactionsInput,
  ListBankTransactionsUnifiedInput,
  BANK_STATUS_FILTER_MAP,
  type BankTxnFilterOption,
} from '@coh/shared/schemas/finance';

// ============================================
// BANK TRANSACTIONS — LIST
// ============================================

export const listBankTransactions = createServerFn({ method: 'POST' })
  .middleware([authMiddleware])
  .inputValidator((input: unknown) => ListBankTransactionsInput.parse(input))
  .handler(async ({ data }) => {
    const prisma = await getPrisma();
    const { bank, status, batchId, search, page = 1, limit = 50 } = data ?? {};
    const skip = (page - 1) * limit;

    const where: Record<string, unknown> = {};
    if (bank) where.bank = bank;
    if (status) {
      // Expand simplified filter values to DB status values
      const filterMap = BANK_STATUS_FILTER_MAP[status as BankTxnFilterOption];
      if (filterMap) {
        where.status = { in: filterMap };
      } else {
        where.status = status;
      }
    }
    if (batchId) where.batchId = batchId;
    if (search) {
      where.OR = [
        { narration: { contains: search, mode: 'insensitive' } },
        { counterpartyName: { contains: search, mode: 'insensitive' } },
        { reference: { contains: search, mode: 'insensitive' } },
      ];
    }
    if (data?.dateFrom) where.txnDate = { ...(where.txnDate as object ?? {}), gte: new Date(data.dateFrom) };
    if (data?.dateTo) where.txnDate = { ...(where.txnDate as object ?? {}), lte: new Date(data.dateTo + 'T23:59:59') };

    const [transactions, total] = await Promise.all([
      prisma.bankTransaction.findMany({
        where,
        select: {
          id: true,
          bank: true,
          txnDate: true,
          amount: true,
          direction: true,
          narration: true,
          reference: true,
          counterpartyName: true,
          debitAccountCode: true,
          creditAccountCode: true,
          status: true,
          skipReason: true,
          category: true,
          period: true,
          partyId: true,
          party: { select: { id: true, name: true } },
          batchId: true,
          createdAt: true,
        },
        orderBy: { txnDate: 'desc' },
        skip,
        take: limit,
      }),
      prisma.bankTransaction.count({ where }),
    ]);

    return { success: true as const, transactions, total, page, limit };
  });

// ============================================
// BANK TRANSACTIONS — UNIFIED LIST (merges old listBankTransactions + listPayments)
// ============================================

export const listBankTransactionsUnified = createServerFn({ method: 'POST' })
  .middleware([authMiddleware])
  .inputValidator((input: unknown) => ListBankTransactionsUnifiedInput.parse(input))
  .handler(async ({ data }) => {
    const prisma = await getPrisma();
    const { bank, status, direction, matchStatus, category, search, page = 1, limit = 50 } = data ?? {};
    const skip = (page - 1) * limit;

    const where: Record<string, unknown> = {};
    if (bank) where.bank = bank;

    // Status filter: expand simplified filter values to DB status values
    if (status && status !== 'all') {
      const filterMap = BANK_STATUS_FILTER_MAP[status as BankTxnFilterOption];
      if (filterMap) {
        where.status = { in: filterMap };
      } else {
        where.status = status;
      }
    }

    // Match status (only meaningful for confirmed txns)
    if (matchStatus === 'unmatched') where.unmatchedAmount = { gt: 0.01 };
    if (matchStatus === 'matched') where.unmatchedAmount = { lte: 0.01 };

    if (direction) where.direction = direction;

    const andClauses: Record<string, unknown>[] = [];
    if (category) {
      andClauses.push({
        OR: [
          { party: { category } },
          { category },
        ],
      });
    }
    if (search) {
      andClauses.push({
        OR: [
          { narration: { contains: search, mode: 'insensitive' } },
          { counterpartyName: { contains: search, mode: 'insensitive' } },
          { reference: { contains: search, mode: 'insensitive' } },
          { party: { name: { contains: search, mode: 'insensitive' } } },
          { notes: { contains: search, mode: 'insensitive' } },
        ],
      });
    }
    if (data?.dateFrom) where.txnDate = { ...(where.txnDate as object ?? {}), gte: new Date(data.dateFrom) };
    if (data?.dateTo) where.txnDate = { ...(where.txnDate as object ?? {}), lte: new Date(data.dateTo + 'T23:59:59') };
    if (andClauses.length) where.AND = andClauses;

    const [transactions, total] = await Promise.all([
      prisma.bankTransaction.findMany({
        where,
        select: {
          id: true,
          bank: true,
          txnDate: true,
          amount: true,
          direction: true,
          narration: true,
          reference: true,
          utr: true,
          counterpartyName: true,
          debitAccountCode: true,
          creditAccountCode: true,
          status: true,
          skipReason: true,
          category: true,
          period: true,
          notes: true,
          matchedAmount: true,
          unmatchedAmount: true,
          driveUrl: true,
          fileName: true,
          partyId: true,
          party: {
            select: {
              id: true,
              name: true,
              category: true,
              gstin: true,
              tdsApplicable: true,
              tdsRate: true,
              transactionType: { select: { name: true, expenseCategory: true, defaultGstRate: true } },
            },
          },
          allocations: {
            select: {
              invoice: {
                select: {
                  id: true,
                  invoiceNumber: true,
                  invoiceDate: true,
                  billingPeriod: true,
                  driveUrl: true,
                  notes: true,
                },
              },
            },
            take: 3,
          },
          _count: { select: { allocations: true } },
          batchId: true,
          createdAt: true,
        },
        orderBy: { txnDate: 'desc' },
        skip,
        take: limit,
      }),
      prisma.bankTransaction.count({ where }),
    ]);

    return { success: true as const, transactions, total, page, limit };
  });
