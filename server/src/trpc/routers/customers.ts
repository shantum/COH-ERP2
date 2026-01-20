/**
 * Customers tRPC Router
 * Customer management and statistics procedures
 *
 * Procedures:
 * - list: Query customers with search, tier filter, and pagination (Kysely)
 * - get: Get single customer with order count and recent orders (Kysely)
 * - update: Update customer info (name, email, phone, tags)
 * - getStats: Get customer statistics (LTV, order count, RTO rate, tier) (Kysely)
 */

import { z } from 'zod';
import { TRPCError } from '@trpc/server';
import { router, protectedProcedure } from '../index.js';
import type { CustomerTier } from '../../utils/tierUtils.js';
import {
    listCustomersKysely,
    getCustomerKysely,
    getCustomerStatsKysely,
} from '../../db/queries/index.js';

/**
 * List customers with optional search, tier filter, and pagination
 * Search supports multi-word queries across name, email, and phone
 * Uses Kysely for high-performance queries with denormalized fields
 */
const list = protectedProcedure
    .input(
        z.object({
            search: z.string().optional(),
            tier: z.enum(['bronze', 'silver', 'gold', 'platinum']).optional(),
            limit: z.number().min(1).max(100).default(50),
            offset: z.number().min(0).default(0),
        })
    )
    .query(async ({ input }) => {
        const { search, tier, limit, offset } = input;

        // Use Kysely query with denormalized ltv/orderCount/tier fields
        return listCustomersKysely({
            search,
            tier: tier as CustomerTier | undefined,
            limit,
            offset,
        });
    });

/**
 * Get single customer by ID with order count and recent orders
 * Uses Kysely for high-performance queries
 */
const get = protectedProcedure
    .input(z.object({ id: z.string().uuid() }))
    .query(async ({ input }) => {
        const customer = await getCustomerKysely(input.id);

        if (!customer) {
            throw new TRPCError({
                code: 'NOT_FOUND',
                message: 'Customer not found',
            });
        }

        return customer;
    });

/**
 * Update customer information
 * Only allows updating safe fields (name, email, phone, tags)
 */
const update = protectedProcedure
    .input(
        z.object({
            id: z.string().uuid(),
            firstName: z.string().min(1).max(100).optional(),
            lastName: z.string().min(1).max(100).optional(),
            email: z.string().email().optional(),
            phone: z.string().max(20).optional(),
            tags: z.string().max(500).optional(),
        })
    )
    .mutation(async ({ input, ctx }) => {
        const { id, ...updateData } = input;

        // Check if customer exists
        const existing = await ctx.prisma.customer.findUnique({
            where: { id },
            select: { id: true },
        });

        if (!existing) {
            throw new TRPCError({
                code: 'NOT_FOUND',
                message: 'Customer not found',
            });
        }

        // Check for email uniqueness if email is being updated
        if (updateData.email) {
            const emailExists = await ctx.prisma.customer.findFirst({
                where: {
                    email: updateData.email,
                    id: { not: id },
                },
                select: { id: true },
            });

            if (emailExists) {
                throw new TRPCError({
                    code: 'CONFLICT',
                    message: 'A customer with this email already exists',
                });
            }
        }

        // Filter out undefined values
        const dataToUpdate = Object.fromEntries(
            Object.entries(updateData).filter(([, v]) => v !== undefined)
        );

        if (Object.keys(dataToUpdate).length === 0) {
            throw new TRPCError({
                code: 'BAD_REQUEST',
                message: 'No fields to update',
            });
        }

        const updated = await ctx.prisma.customer.update({
            where: { id },
            data: dataToUpdate,
            select: {
                id: true,
                email: true,
                firstName: true,
                lastName: true,
                phone: true,
                tags: true,
                updatedAt: true,
            },
        });

        return updated;
    });

/**
 * Get customer statistics (LTV, order count, RTO rate, tier)
 * Uses Kysely with denormalized fields for fast lookup
 */
const getStats = protectedProcedure
    .input(z.object({ id: z.string().uuid() }))
    .query(async ({ input }) => {
        const stats = await getCustomerStatsKysely(input.id);

        if (!stats) {
            throw new TRPCError({
                code: 'NOT_FOUND',
                message: 'Customer not found',
            });
        }

        return stats;
    });

/**
 * Customers router - combines all customer procedures
 */
export const customersRouter = router({
    list,
    get,
    update,
    getStats,
});
