/**
 * Shared Audience Filter Builder
 *
 * Builds Prisma where clauses from AudienceFilters JSON.
 * Used by both Audiences CRUD and Campaign sending.
 */

import { z } from 'zod';
import type { Prisma } from '@prisma/client';

// ============================================
// FILTER SCHEMA
// ============================================

export const audienceFiltersSchema = z.object({
  // Tier
  tiers: z.array(z.string()).optional(),

  // Purchase behavior
  orderCountMin: z.number().int().nonnegative().optional(),
  orderCountMax: z.number().int().nonnegative().optional(),
  ltvMin: z.number().int().nonnegative().optional(),
  ltvMax: z.number().int().nonnegative().optional(),
  lastPurchaseWithin: z.number().int().positive().optional(),     // Days since last purchase
  lastPurchaseBefore: z.number().int().positive().optional(),     // Haven't purchased in N+ days
  firstPurchaseWithin: z.number().int().positive().optional(),    // New customers

  // Tags
  tagsInclude: z.array(z.string()).optional(),
  tagsExclude: z.array(z.string()).optional(),

  // Returns behavior
  returnCountMin: z.number().int().nonnegative().optional(),
  returnCountMax: z.number().int().nonnegative().optional(),

  // Location
  states: z.array(z.string()).optional(),

  // Email engagement
  acceptsMarketing: z.boolean().optional(),

  // Store credit
  hasStoreCredit: z.boolean().optional(),

  // Customer age
  customerSince: z.number().int().positive().optional(),          // Created within N days
});

export type AudienceFilters = z.infer<typeof audienceFiltersSchema>;

// ============================================
// FILTER BUILDER
// ============================================

/**
 * Build a Prisma CustomerWhereInput from audience filters.
 * Always enforces: emailOptOut=false, email not empty.
 */
export function buildAudienceWhere(filters: AudienceFilters): Prisma.CustomerWhereInput {
  const where: Prisma.CustomerWhereInput = {
    emailOptOut: false,
    email: { not: '' },
  };

  const andConditions: Prisma.CustomerWhereInput[] = [];

  // Tier
  if (filters.tiers && filters.tiers.length > 0) {
    where.tier = { in: filters.tiers };
  }

  // Order count
  if (filters.orderCountMin !== undefined || filters.orderCountMax !== undefined) {
    const orderCountFilter: Prisma.IntFilter = {};
    if (filters.orderCountMin !== undefined) orderCountFilter.gte = filters.orderCountMin;
    if (filters.orderCountMax !== undefined) orderCountFilter.lte = filters.orderCountMax;
    where.orderCount = orderCountFilter;
  }

  // LTV
  if (filters.ltvMin !== undefined || filters.ltvMax !== undefined) {
    const ltvFilter: Prisma.IntFilter = {};
    if (filters.ltvMin !== undefined) ltvFilter.gte = filters.ltvMin;
    if (filters.ltvMax !== undefined) ltvFilter.lte = filters.ltvMax;
    where.ltv = ltvFilter;
  }

  // Last purchase within N days (active customers)
  if (filters.lastPurchaseWithin) {
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - filters.lastPurchaseWithin);
    where.lastOrderDate = { gte: cutoff };
  }

  // Last purchase before N days ago (churned customers)
  if (filters.lastPurchaseBefore) {
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - filters.lastPurchaseBefore);
    where.lastOrderDate = { ...(where.lastOrderDate as Prisma.DateTimeNullableFilter || {}), lte: cutoff };
  }

  // First purchase within N days (new customers)
  if (filters.firstPurchaseWithin) {
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - filters.firstPurchaseWithin);
    where.firstOrderDate = { gte: cutoff };
  }

  // Tags include (has ANY of these)
  if (filters.tagsInclude && filters.tagsInclude.length > 0) {
    andConditions.push({
      OR: filters.tagsInclude.map(tag => ({
        tags: { contains: tag, mode: 'insensitive' as const },
      })),
    });
  }

  // Tags exclude (does NOT have any of these)
  if (filters.tagsExclude && filters.tagsExclude.length > 0) {
    for (const tag of filters.tagsExclude) {
      andConditions.push({
        OR: [
          { tags: { equals: null } },
          { tags: { equals: '' } },
          { NOT: { tags: { contains: tag, mode: 'insensitive' as const } } },
        ],
      });
    }
  }

  // Return count
  if (filters.returnCountMin !== undefined || filters.returnCountMax !== undefined) {
    const returnFilter: Prisma.IntFilter = {};
    if (filters.returnCountMin !== undefined) returnFilter.gte = filters.returnCountMin;
    if (filters.returnCountMax !== undefined) returnFilter.lte = filters.returnCountMax;
    where.returnCount = returnFilter;
  }

  // Location (states) — subquery on orders
  if (filters.states && filters.states.length > 0) {
    andConditions.push({
      orders: {
        some: {
          customerState: { in: filters.states, mode: 'insensitive' as const },
        },
      },
    });
  }

  // Accepts marketing
  if (filters.acceptsMarketing !== undefined) {
    where.acceptsMarketing = filters.acceptsMarketing;
  }

  // Store credit
  if (filters.hasStoreCredit === true) {
    where.storeCreditBalance = { gt: 0 };
  } else if (filters.hasStoreCredit === false) {
    where.storeCreditBalance = { equals: 0 };
  }

  // Customer since (created within N days)
  if (filters.customerSince) {
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - filters.customerSince);
    where.createdAt = { gte: cutoff };
  }

  // Combine AND conditions
  if (andConditions.length > 0) {
    where.AND = andConditions;
  }

  return where;
}

/**
 * Convert legacy campaign audience filter to the new AudienceFilters format.
 */
export function legacyToAudienceFilters(legacy: {
  tiers?: string[];
  tags?: string[];
  lastPurchaseDays?: number;
}): AudienceFilters {
  return {
    ...(legacy.tiers && legacy.tiers.length > 0 ? { tiers: legacy.tiers } : {}),
    ...(legacy.tags && legacy.tags.length > 0 ? { tagsInclude: legacy.tags } : {}),
    ...(legacy.lastPurchaseDays ? { lastPurchaseWithin: legacy.lastPurchaseDays } : {}),
  };
}
