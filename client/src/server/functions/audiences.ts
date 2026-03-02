/**
 * Audience Server Functions
 *
 * CRUD, preview, and customer listing for saved audience segments.
 */

import { createServerFn } from '@tanstack/react-start';
import { z } from 'zod';
import type { Prisma } from '@prisma/client';
import { getPrisma } from '@coh/shared/services/db';
import { adminMiddleware } from '../middleware/auth';
import { serverLog } from './serverLog';
import { audienceFiltersSchema, buildAudienceWhere, type AudienceFilters } from './audienceFilters';

// ============================================
// INPUT SCHEMAS
// ============================================

const audienceIdSchema = z.object({
  id: z.string().uuid(),
});

const createAudienceSchema = z.object({
  name: z.string().min(1).max(200),
  description: z.string().max(500).optional(),
  filters: audienceFiltersSchema,
});

const updateAudienceSchema = z.object({
  id: z.string().uuid(),
  name: z.string().min(1).max(200).optional(),
  description: z.string().max(500).optional(),
  filters: audienceFiltersSchema.optional(),
});

const previewSchema = z.object({
  filters: audienceFiltersSchema,
});

const customerListSchema = z.object({
  filters: audienceFiltersSchema,
  limit: z.number().int().positive().max(200).optional().default(50),
  offset: z.number().int().nonnegative().optional().default(0),
});

// ============================================
// TYPES
// ============================================

export interface AudienceListItem {
  id: string;
  name: string;
  description: string | null;
  customerCount: number;
  createdAt: Date;
  updatedAt: Date;
}

export interface AudienceDetail extends AudienceListItem {
  filters: AudienceFilters;
}

export interface AudiencePreviewResult {
  count: number;
  sample: Array<{
    id: string;
    email: string;
    firstName: string | null;
    lastName: string | null;
    tier: string;
    ltv: number;
    orderCount: number;
    lastOrderDate: Date | null;
  }>;
}

// ============================================
// SERVER FUNCTIONS
// ============================================

/** List all audiences */
export const getAudiencesList = createServerFn({ method: 'GET' })
  .middleware([adminMiddleware])
  .handler(async (): Promise<{ audiences: AudienceListItem[] }> => {
    try {
      const prisma = await getPrisma();
      const audiences = await prisma.audience.findMany({
        select: {
          id: true, name: true, description: true, customerCount: true,
          createdAt: true, updatedAt: true,
        },
        orderBy: { createdAt: 'desc' },
      });
      return { audiences };
    } catch (error: unknown) {
      serverLog.error({ domain: 'audiences', fn: 'getAudiencesList' }, 'Failed to list audiences', error);
      throw error;
    }
  });

/** Get audience detail with filters */
export const getAudienceDetail = createServerFn({ method: 'GET' })
  .middleware([adminMiddleware])
  .inputValidator((input: unknown) => audienceIdSchema.parse(input))
  .handler(async ({ data }): Promise<AudienceDetail> => {
    try {
      const prisma = await getPrisma();
      const audience = await prisma.audience.findUniqueOrThrow({
        where: { id: data.id },
      });
      return {
        ...audience,
        filters: audience.filters as AudienceFilters,
      };
    } catch (error: unknown) {
      serverLog.error({ domain: 'audiences', fn: 'getAudienceDetail' }, 'Failed to get audience', error);
      throw error;
    }
  });

/** Create a new audience */
export const createAudience = createServerFn({ method: 'POST' })
  .middleware([adminMiddleware])
  .inputValidator((input: unknown) => createAudienceSchema.parse(input))
  .handler(async ({ data, context }): Promise<{ id: string }> => {
    try {
      const prisma = await getPrisma();

      // Count matching customers
      const where = buildAudienceWhere(data.filters);
      const customerCount = await prisma.customer.count({ where });

      const audience = await prisma.audience.create({
        data: {
          name: data.name,
          ...(data.description ? { description: data.description } : {}),
          filters: data.filters as unknown as Prisma.InputJsonValue,
          customerCount,
          createdById: context.user.id,
        },
        select: { id: true },
      });

      return { id: audience.id };
    } catch (error: unknown) {
      serverLog.error({ domain: 'audiences', fn: 'createAudience' }, 'Failed to create audience', error);
      throw error;
    }
  });

/** Update an audience */
export const updateAudience = createServerFn({ method: 'POST' })
  .middleware([adminMiddleware])
  .inputValidator((input: unknown) => updateAudienceSchema.parse(input))
  .handler(async ({ data }): Promise<{ success: true }> => {
    try {
      const prisma = await getPrisma();
      const { id, ...updates } = data;

      const updateData: Prisma.AudienceUpdateInput = {};
      if (updates.name !== undefined) updateData.name = updates.name;
      if (updates.description !== undefined) updateData.description = updates.description;
      if (updates.filters !== undefined) {
        updateData.filters = updates.filters as unknown as Prisma.InputJsonValue;
        // Recount customers
        const where = buildAudienceWhere(updates.filters);
        updateData.customerCount = await prisma.customer.count({ where });
      }

      await prisma.audience.update({ where: { id }, data: updateData });
      return { success: true };
    } catch (error: unknown) {
      serverLog.error({ domain: 'audiences', fn: 'updateAudience' }, 'Failed to update audience', error);
      throw error;
    }
  });

/** Delete an audience */
export const deleteAudience = createServerFn({ method: 'POST' })
  .middleware([adminMiddleware])
  .inputValidator((input: unknown) => audienceIdSchema.parse(input))
  .handler(async ({ data }): Promise<{ success: true }> => {
    try {
      const prisma = await getPrisma();

      // Unlink any campaigns using this audience
      await prisma.emailCampaign.updateMany({
        where: { audienceId: data.id },
        data: { audienceId: null },
      });

      await prisma.audience.delete({ where: { id: data.id } });
      return { success: true };
    } catch (error: unknown) {
      serverLog.error({ domain: 'audiences', fn: 'deleteAudience' }, 'Failed to delete audience', error);
      throw error;
    }
  });

/** Preview audience — count + sample customers */
export const previewAudience = createServerFn({ method: 'POST' })
  .middleware([adminMiddleware])
  .inputValidator((input: unknown) => previewSchema.parse(input))
  .handler(async ({ data }): Promise<AudiencePreviewResult> => {
    try {
      const prisma = await getPrisma();
      const where = buildAudienceWhere(data.filters);

      const [count, sample] = await Promise.all([
        prisma.customer.count({ where }),
        prisma.customer.findMany({
          where,
          select: {
            id: true, email: true, firstName: true, lastName: true,
            tier: true, ltv: true, orderCount: true, lastOrderDate: true,
          },
          take: 10,
          orderBy: { ltv: 'desc' },
        }),
      ]);

      return { count, sample };
    } catch (error: unknown) {
      serverLog.error({ domain: 'audiences', fn: 'previewAudience' }, 'Failed to preview audience', error);
      throw error;
    }
  });

/** Get paginated customer list for an audience filter */
export const getAudienceCustomers = createServerFn({ method: 'POST' })
  .middleware([adminMiddleware])
  .inputValidator((input: unknown) => customerListSchema.parse(input))
  .handler(async ({ data }) => {
    try {
      const prisma = await getPrisma();
      const where = buildAudienceWhere(data.filters);

      const [total, rawCustomers] = await Promise.all([
        prisma.customer.count({ where }),
        prisma.customer.findMany({
          where,
          select: {
            id: true, email: true, firstName: true, lastName: true,
            tier: true, ltv: true, orderCount: true, lastOrderDate: true,
            returnCount: true, storeCreditBalance: true, acceptsMarketing: true,
          },
          take: data.limit,
          skip: data.offset,
          orderBy: { ltv: 'desc' },
        }),
      ]);

      // Convert Decimal to number for serialization
      const customers = rawCustomers.map(c => ({
        ...c,
        storeCreditBalance: Number(c.storeCreditBalance),
      }));

      return {
        customers,
        pagination: { total, limit: data.limit, offset: data.offset, hasMore: data.offset + data.limit < total },
      };
    } catch (error: unknown) {
      serverLog.error({ domain: 'audiences', fn: 'getAudienceCustomers' }, 'Failed to get customers', error);
      throw error;
    }
  });

/** Get distinct customer states from orders (for location filter dropdown) */
export const getDistinctStates = createServerFn({ method: 'GET' })
  .middleware([adminMiddleware])
  .handler(async (): Promise<{ states: string[] }> => {
    try {
      const prisma = await getPrisma();
      const results = await prisma.order.findMany({
        where: { customerState: { not: null } },
        select: { customerState: true },
        distinct: ['customerState'],
        orderBy: { customerState: 'asc' },
      });
      const states = results
        .map(r => r.customerState)
        .filter((s): s is string => !!s && s.trim() !== '');
      return { states };
    } catch (error: unknown) {
      serverLog.error({ domain: 'audiences', fn: 'getDistinctStates' }, 'Failed to get states', error);
      throw error;
    }
  });

/** Get distinct tags from customers (for tags filter dropdown) */
export const getDistinctTags = createServerFn({ method: 'GET' })
  .middleware([adminMiddleware])
  .handler(async (): Promise<{ tags: string[] }> => {
    try {
      const prisma = await getPrisma();
      const results = await prisma.customer.findMany({
        where: { tags: { not: null } },
        select: { tags: true },
        distinct: ['tags'],
      });

      // Tags are comma-separated — collect all unique ones
      const tagSet = new Set<string>();
      for (const r of results) {
        if (r.tags) {
          for (const tag of r.tags.split(',')) {
            const trimmed = tag.trim().toLowerCase();
            if (trimmed) tagSet.add(trimmed);
          }
        }
      }

      return { tags: Array.from(tagSet).sort() };
    } catch (error: unknown) {
      serverLog.error({ domain: 'audiences', fn: 'getDistinctTags' }, 'Failed to get tags', error);
      throw error;
    }
  });
