/**
 * Finance Parties — Balances, search, CRUD
 */

'use server';

import { createServerFn } from '@tanstack/react-start';
import { z } from 'zod';
import { authMiddleware, adminMiddleware } from '../../middleware/auth';
import { getPrisma } from '@coh/shared/services/db';
import type { Prisma } from '@prisma/client';
import {
  ListPartiesInput,
  UpdatePartySchema,
  CreatePartySchema,
} from '@coh/shared/schemas/finance';

// ============================================
// PARTY BALANCES (outstanding per vendor)
// ============================================

export const getPartyBalances = createServerFn({ method: 'GET' })
  .middleware([authMiddleware])
  .handler(async () => {
    const prisma = await getPrisma();

    const balances = await prisma.$queryRaw<Array<{
      id: string; name: string;
      total_invoiced: number; total_paid: number; outstanding: number;
    }>>`
      SELECT p.id, p.name,
        COALESCE(SUM(i."totalAmount"), 0)::float AS total_invoiced,
        COALESCE(SUM(i."paidAmount"), 0)::float AS total_paid,
        COALESCE(SUM(i."balanceDue"), 0)::float AS outstanding
      FROM "Party" p
      LEFT JOIN "Invoice" i ON i."partyId" = p.id
        AND i.type = 'payable' AND i.status != 'cancelled'
      WHERE p."isActive" = true
      GROUP BY p.id, p.name
      ORDER BY outstanding DESC
    `;

    return { success: true as const, balances };
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

// ============================================
// PARTY — LIST
// ============================================

export const listFinanceParties = createServerFn({ method: 'POST' })
  .middleware([authMiddleware])
  .inputValidator((input: unknown) => ListPartiesInput.parse(input))
  .handler(async ({ data: input }) => {
    const prisma = await getPrisma();
    const { transactionTypeId, search, page = 1, limit = 200 } = input ?? {};
    const skip = (page - 1) * limit;

    const where: Prisma.PartyWhereInput = {
      ...(transactionTypeId ? { transactionTypeId } : {}),
      ...(search ? {
        OR: [
          { name: { contains: search, mode: 'insensitive' } },
          { aliases: { has: search.toUpperCase() } },
          { contactName: { contains: search, mode: 'insensitive' } },
        ],
      } : {}),
    };

    const [parties, total] = await Promise.all([
      prisma.party.findMany({
        where,
        select: {
          id: true,
          name: true,
          category: true,
          aliases: true,
          tdsApplicable: true,
          tdsSection: true,
          tdsRate: true,
          invoiceRequired: true,
          paymentTermsDays: true,
          billingPeriodOffsetMonths: true,
          isActive: true,
          contactName: true,
          email: true,
          phone: true,
          gstin: true,
          pan: true,
          transactionTypeId: true,
          transactionType: {
            select: { id: true, name: true, expenseCategory: true },
          },
        },
        orderBy: { name: 'asc' },
        skip,
        take: limit,
      }),
      prisma.party.count({ where }),
    ]);

    return { success: true as const, parties, total, page, limit };
  });

// ============================================
// PARTY — GET SINGLE
// ============================================

export const getFinanceParty = createServerFn({ method: 'GET' })
  .middleware([authMiddleware])
  .inputValidator((input: unknown) => z.object({ id: z.string().uuid() }).parse(input))
  .handler(async ({ data: { id } }) => {
    const prisma = await getPrisma();
    const party = await prisma.party.findUnique({
      where: { id },
      include: {
        transactionType: true,
      },
    });
    if (!party) return { success: false as const, error: 'Party not found' };
    return { success: true as const, party };
  });

// ============================================
// PARTY — UPDATE
// ============================================

export const updateFinanceParty = createServerFn({ method: 'POST' })
  .middleware([adminMiddleware])
  .inputValidator((input: unknown) => UpdatePartySchema.parse(input))
  .handler(async ({ data, context }) => {
    const prisma = await getPrisma();
    const { id, ...updates } = data;
    const userId = context.user.id;

    // Fetch old values to diff tracked fields
    const oldParty = await prisma.party.findUnique({
      where: { id },
      select: { transactionTypeId: true, tdsApplicable: true, tdsSection: true, tdsRate: true, invoiceRequired: true },
    });
    if (!oldParty) return { success: false as const, error: 'Party not found' };

    const party = await prisma.$transaction(async (tx) => {
      const updated = await tx.party.update({
        where: { id },
        data: updates as Prisma.PartyUpdateInput,
        include: { transactionType: { select: { id: true, name: true } } },
      });

      // Log changes for tracked fields
      const trackedFields = ['transactionTypeId', 'tdsApplicable', 'tdsSection', 'tdsRate', 'invoiceRequired'] as const;
      const updatesRec = updates as Record<string, unknown>;
      const logs: { partyId: string; fieldName: string; oldValue: string | null; newValue: string | null; changedById: string }[] = [];
      for (const field of trackedFields) {
        if (field in updates) {
          const oldVal = oldParty[field];
          const newVal = updatesRec[field];
          if (String(oldVal ?? '') !== String(newVal ?? '')) {
            logs.push({
              partyId: id,
              fieldName: field,
              oldValue: oldVal != null ? String(oldVal) : null,
              newValue: newVal != null ? String(newVal) : null,
              changedById: userId,
            });
          }
        }
      }
      if (logs.length > 0) {
        await tx.partyChangeLog.createMany({ data: logs });
      }

      return updated;
    });

    return { success: true as const, party };
  });

// ============================================
// PARTY — CREATE
// ============================================

export const createFinanceParty = createServerFn({ method: 'POST' })
  .middleware([adminMiddleware])
  .inputValidator((input: unknown) => CreatePartySchema.parse(input))
  .handler(async ({ data, context }) => {
    const prisma = await getPrisma();
    const userId = context.user.id;

    const party = await prisma.$transaction(async (tx) => {
      const created = await tx.party.create({
        data: {
          name: data.name,
          category: data.category,
          ...(data.transactionTypeId ? { transactionTypeId: data.transactionTypeId } : {}),
          aliases: data.aliases ?? [],
          tdsApplicable: data.tdsApplicable ?? false,
          tdsSection: data.tdsSection ?? null,
          tdsRate: data.tdsRate ?? null,
          invoiceRequired: data.invoiceRequired ?? true,
          paymentTermsDays: data.paymentTermsDays ?? null,
          billingPeriodOffsetMonths: data.billingPeriodOffsetMonths ?? null,
          contactName: data.contactName ?? null,
          email: data.email ?? null,
          phone: data.phone ?? null,
          gstin: data.gstin ?? null,
          pan: data.pan ?? null,
        },
        include: {
          transactionType: { select: { id: true, name: true } },
        },
      });

      await tx.partyChangeLog.create({
        data: {
          partyId: created.id,
          fieldName: '__created',
          newValue: created.name,
          changedById: userId,
        },
      });

      return created;
    });

    return { success: true as const, party };
  });
