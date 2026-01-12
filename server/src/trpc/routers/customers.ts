/**
 * Customers tRPC Router
 * Customer management and statistics procedures
 *
 * Procedures:
 * - list: Query customers with search, tier filter, and pagination
 * - get: Get single customer with order count and recent orders
 * - update: Update customer info (name, email, phone, tags)
 * - getStats: Get customer statistics (LTV, order count, RTO rate, tier)
 */

import { z } from 'zod';
import { TRPCError } from '@trpc/server';
import { router, protectedProcedure } from '../index.js';
import {
    getTierThresholds,
    calculateTier,
    calculateLTV,
    type CustomerTier,
    type OrderForLTV,
} from '../../utils/tierUtils.js';
import type { Prisma } from '@prisma/client';

/**
 * List customers with optional search, tier filter, and pagination
 * Search supports multi-word queries across name, email, and phone
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
    .query(async ({ input, ctx }) => {
        const { search, tier, limit, offset } = input;

        // Get tier thresholds for calculation
        const thresholds = await getTierThresholds(ctx.prisma);

        // Build where clause
        const where: Prisma.CustomerWhereInput = {};

        if (search) {
            // Support multi-word search: all words must match across name/email/phone
            const words = search.trim().toLowerCase().split(/\s+/).filter(Boolean);

            if (words.length === 1) {
                where.OR = [
                    { email: { contains: words[0], mode: 'insensitive' } },
                    { firstName: { contains: words[0], mode: 'insensitive' } },
                    { lastName: { contains: words[0], mode: 'insensitive' } },
                    { phone: { contains: words[0], mode: 'insensitive' } },
                ];
            } else {
                where.AND = words.map((word) => ({
                    OR: [
                        { email: { contains: word, mode: 'insensitive' } },
                        { firstName: { contains: word, mode: 'insensitive' } },
                        { lastName: { contains: word, mode: 'insensitive' } },
                        { phone: { contains: word, mode: 'insensitive' } },
                    ],
                }));
            }
        }

        // Get customers with order data for metrics
        const customers = await ctx.prisma.customer.findMany({
            where,
            select: {
                id: true,
                email: true,
                firstName: true,
                lastName: true,
                phone: true,
                tier: true,
                createdAt: true,
                orders: {
                    select: {
                        id: true,
                        totalAmount: true,
                        status: true,
                        orderDate: true,
                        customerPhone: true,
                    },
                },
                _count: {
                    select: { orders: true },
                },
            },
            orderBy: { createdAt: 'desc' },
            take: limit,
            skip: offset,
        });

        // Enrich with calculated metrics
        const enriched = customers.map((customer) => {
            const validOrders = customer.orders.filter((o) => o.status !== 'cancelled');
            const lifetimeValue = calculateLTV(validOrders as OrderForLTV[]);
            const totalOrders = validOrders.length;

            // Calculate or use stored tier
            const calculatedTier = calculateTier(lifetimeValue, thresholds);
            const customerTier: CustomerTier = (customer.tier as CustomerTier) || calculatedTier;

            // Get phone from customer or fallback to order
            const phone =
                customer.phone ||
                customer.orders.find((o) => o.customerPhone)?.customerPhone ||
                null;

            return {
                id: customer.id,
                email: customer.email,
                firstName: customer.firstName,
                lastName: customer.lastName,
                phone,
                totalOrders,
                lifetimeValue,
                customerTier,
                createdAt: customer.createdAt,
            };
        });

        // Filter by tier if specified (post-query since tier may be calculated)
        const result = tier ? enriched.filter((c) => c.customerTier === tier) : enriched;

        // Get total count for pagination
        const totalCount = await ctx.prisma.customer.count({ where });

        return {
            customers: result,
            pagination: {
                total: totalCount,
                limit,
                offset,
                hasMore: offset + limit < totalCount,
            },
        };
    });

/**
 * Get single customer by ID with order count and recent orders
 */
const get = protectedProcedure
    .input(z.object({ id: z.string().uuid() }))
    .query(async ({ input, ctx }) => {
        const customer = await ctx.prisma.customer.findUnique({
            where: { id: input.id },
            include: {
                orders: {
                    select: {
                        id: true,
                        orderNumber: true,
                        totalAmount: true,
                        status: true,
                        orderDate: true,
                    },
                    orderBy: { orderDate: 'desc' },
                    take: 10, // Recent orders only
                },
                _count: {
                    select: { orders: true },
                },
            },
        });

        if (!customer) {
            throw new TRPCError({
                code: 'NOT_FOUND',
                message: 'Customer not found',
            });
        }

        return {
            id: customer.id,
            email: customer.email,
            firstName: customer.firstName,
            lastName: customer.lastName,
            phone: customer.phone,
            tier: customer.tier,
            tags: customer.tags,
            createdAt: customer.createdAt,
            updatedAt: customer.updatedAt,
            ordersCount: customer._count.orders,
            recentOrders: customer.orders,
        };
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
 */
const getStats = protectedProcedure
    .input(z.object({ id: z.string().uuid() }))
    .query(async ({ input, ctx }) => {
        const customer = await ctx.prisma.customer.findUnique({
            where: { id: input.id },
            select: {
                id: true,
                tier: true,
                orders: {
                    select: {
                        id: true,
                        totalAmount: true,
                        status: true,
                        orderDate: true,
                        trackingStatus: true,
                        paymentMethod: true,
                    },
                },
                returnRequests: {
                    select: {
                        id: true,
                        requestType: true,
                    },
                },
            },
        });

        if (!customer) {
            throw new TRPCError({
                code: 'NOT_FOUND',
                message: 'Customer not found',
            });
        }

        const thresholds = await getTierThresholds(ctx.prisma);

        // Calculate metrics
        const validOrders = customer.orders.filter((o) => o.status !== 'cancelled');
        const lifetimeValue = calculateLTV(validOrders as OrderForLTV[]);
        const orderCount = validOrders.length;
        const avgOrderValue = orderCount > 0 ? lifetimeValue / orderCount : 0;

        // RTO count (COD orders only - prepaid RTOs are refunded)
        const rtoCount = customer.orders.filter(
            (o) => o.trackingStatus?.startsWith('rto') && o.paymentMethod === 'COD'
        ).length;

        // RTO rate as percentage
        const rtoRate = orderCount > 0 ? (rtoCount / orderCount) * 100 : 0;

        // Return/exchange counts
        const returns = customer.returnRequests.filter((r) => r.requestType === 'return').length;
        const exchanges = customer.returnRequests.filter((r) => r.requestType === 'exchange').length;
        const returnRate = orderCount > 0 ? (returns / orderCount) * 100 : 0;

        // Calculate or use stored tier
        const calculatedTier = calculateTier(lifetimeValue, thresholds);
        const customerTier: CustomerTier = (customer.tier as CustomerTier) || calculatedTier;

        // Order date stats
        const sortedOrders = validOrders.sort(
            (a, b) => new Date(a.orderDate).getTime() - new Date(b.orderDate).getTime()
        );
        const firstOrderDate = sortedOrders.length > 0 ? sortedOrders[0].orderDate : null;
        const lastOrderDate =
            sortedOrders.length > 0 ? sortedOrders[sortedOrders.length - 1].orderDate : null;

        return {
            customerId: customer.id,
            lifetimeValue,
            orderCount,
            avgOrderValue: Math.round(avgOrderValue),
            rtoCount,
            rtoRate: parseFloat(rtoRate.toFixed(1)),
            returns,
            exchanges,
            returnRate: parseFloat(returnRate.toFixed(1)),
            tier: customerTier,
            firstOrderDate,
            lastOrderDate,
        };
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
