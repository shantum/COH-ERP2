/**
 * Finance Bank Transactions — List
 */

'use server';

import { createServerFn } from '@tanstack/react-start';
import { authMiddleware } from '../../middleware/auth';
import { getPrisma } from '@coh/shared/services/db';
import {
  ListBankTransactionsInput,
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
