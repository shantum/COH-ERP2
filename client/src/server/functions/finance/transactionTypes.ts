/**
 * Finance Transaction Types — CRUD
 */

'use server';

import { createServerFn } from '@tanstack/react-start';
import { z } from 'zod';
import { authMiddleware } from '../../middleware/auth';
import { getPrisma } from '@coh/shared/services/db';
import type { Prisma } from '@prisma/client';
import {
  CreateTransactionTypeSchema,
  UpdateTransactionTypeSchema,
} from '@coh/shared/schemas/finance';

// ============================================
// TRANSACTION TYPE — LIST
// ============================================

export const listTransactionTypes = createServerFn({ method: 'GET' })
  .middleware([authMiddleware])
  .handler(async () => {
    const prisma = await getPrisma();
    const types = await prisma.transactionType.findMany({
      where: { isActive: true },
      orderBy: { name: 'asc' },
      select: {
        id: true,
        name: true,
        description: true,
        debitAccountCode: true,
        creditAccountCode: true,
        defaultGstRate: true,
        defaultTdsApplicable: true,
        defaultTdsSection: true,
        defaultTdsRate: true,
        invoiceRequired: true,
        expenseCategory: true,
        _count: { select: { parties: true } },
      },
    });
    return { success: true as const, types };
  });

// ============================================
// TRANSACTION TYPE — GET SINGLE
// ============================================

export const getTransactionType = createServerFn({ method: 'GET' })
  .middleware([authMiddleware])
  .inputValidator((input: unknown) => z.object({ id: z.string().uuid() }).parse(input))
  .handler(async ({ data }) => {
    const prisma = await getPrisma();
    const tt = await prisma.transactionType.findUnique({
      where: { id: data.id },
      include: {
        _count: { select: { parties: true } },
        changeLogs: {
          orderBy: { createdAt: 'desc' },
          take: 50,
          include: { changedBy: { select: { name: true } } },
        },
      },
    });
    if (!tt) return { success: false as const, error: 'Transaction type not found' };
    return { success: true as const, transactionType: tt };
  });

// ============================================
// TRANSACTION TYPE — CREATE
// ============================================

export const createTransactionType = createServerFn({ method: 'POST' })
  .middleware([authMiddleware])
  .inputValidator((input: unknown) => CreateTransactionTypeSchema.parse(input))
  .handler(async ({ data, context }) => {
    const prisma = await getPrisma();
    const userId = context.user.id;

    const tt = await prisma.$transaction(async (tx) => {
      const created = await tx.transactionType.create({
        data: {
          name: data.name,
          ...(data.description ? { description: data.description } : {}),
          ...(data.debitAccountCode ? { debitAccountCode: data.debitAccountCode } : {}),
          ...(data.creditAccountCode ? { creditAccountCode: data.creditAccountCode } : {}),
          ...(data.defaultGstRate != null ? { defaultGstRate: data.defaultGstRate } : {}),
          defaultTdsApplicable: data.defaultTdsApplicable ?? false,
          ...(data.defaultTdsSection ? { defaultTdsSection: data.defaultTdsSection } : {}),
          ...(data.defaultTdsRate != null ? { defaultTdsRate: data.defaultTdsRate } : {}),
          invoiceRequired: data.invoiceRequired ?? true,
          ...(data.expenseCategory ? { expenseCategory: data.expenseCategory } : {}),
        },
      });

      await tx.transactionTypeChangeLog.create({
        data: {
          transactionTypeId: created.id,
          fieldName: '__created',
          newValue: created.name,
          changedById: userId,
        },
      });

      return created;
    });

    return { success: true as const, transactionType: tt };
  });

// ============================================
// TRANSACTION TYPE — UPDATE
// ============================================

export const updateTransactionType = createServerFn({ method: 'POST' })
  .middleware([authMiddleware])
  .inputValidator((input: unknown) => UpdateTransactionTypeSchema.parse(input))
  .handler(async ({ data, context }) => {
    const prisma = await getPrisma();
    const userId = context.user.id;
    const { id, ...updates } = data;

    const old = await prisma.transactionType.findUnique({ where: { id } });
    if (!old) return { success: false as const, error: 'Transaction type not found' };

    const tt = await prisma.$transaction(async (tx) => {
      const updated = await tx.transactionType.update({
        where: { id },
        data: updates as Prisma.TransactionTypeUpdateInput,
        include: { _count: { select: { parties: true } } },
      });

      // Diff and log each changed field
      const fields = ['name', 'description', 'debitAccountCode', 'creditAccountCode', 'defaultGstRate', 'defaultTdsApplicable', 'defaultTdsSection', 'defaultTdsRate', 'invoiceRequired', 'expenseCategory', 'isActive'] as const;
      const oldRec = old as Record<string, unknown>;
      const updatesRec = updates as Record<string, unknown>;
      const logs: { transactionTypeId: string; fieldName: string; oldValue: string | null; newValue: string | null; changedById: string }[] = [];
      for (const field of fields) {
        if (field in updates) {
          const oldVal = oldRec[field];
          const newVal = updatesRec[field];
          if (String(oldVal ?? '') !== String(newVal ?? '')) {
            logs.push({
              transactionTypeId: id,
              fieldName: field,
              oldValue: oldVal != null ? String(oldVal) : null,
              newValue: newVal != null ? String(newVal) : null,
              changedById: userId,
            });
          }
        }
      }
      if (logs.length > 0) {
        await tx.transactionTypeChangeLog.createMany({ data: logs });
      }

      return updated;
    });

    return { success: true as const, transactionType: tt };
  });

// ============================================
// TRANSACTION TYPE — DELETE (soft)
// ============================================

export const deleteTransactionType = createServerFn({ method: 'POST' })
  .middleware([authMiddleware])
  .inputValidator((input: unknown) => z.object({ id: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }) => {
    const prisma = await getPrisma();
    const userId = context.user.id;

    const tt = await prisma.transactionType.findUnique({
      where: { id: data.id },
      include: { _count: { select: { parties: { where: { isActive: true } } } } },
    });
    if (!tt) return { success: false as const, error: 'Transaction type not found' };
    if (tt._count.parties > 0) {
      return { success: false as const, error: `Cannot deactivate: ${tt._count.parties} active parties are using this type` };
    }

    await prisma.$transaction(async (tx) => {
      await tx.transactionType.update({ where: { id: data.id }, data: { isActive: false } });
      await tx.transactionTypeChangeLog.create({
        data: {
          transactionTypeId: data.id,
          fieldName: '__deactivated',
          oldValue: 'true',
          newValue: 'false',
          changedById: userId,
        },
      });
    });

    return { success: true as const };
  });
