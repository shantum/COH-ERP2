/**
 * Products tRPC Router
 * Product catalog queries for products, variations, and SKUs
 *
 * Procedures:
 * - list: Protected query to list products with search, category filter, and pagination
 * - get: Protected query to get single product by ID with full details
 * - getVariation: Protected query to get single variation by ID with SKUs
 * - getSku: Protected query to get single SKU by ID with variation and product info
 */

import { z } from 'zod';
import { TRPCError } from '@trpc/server';
import { router, protectedProcedure } from '../index.js';
import type { Prisma } from '@prisma/client';

// ============================================
// PRISMA INCLUDE CONFIGURATIONS
// ============================================

/**
 * Include configuration for product list with variations and SKUs
 */
const productListInclude = {
    fabricType: true,
    variations: {
        include: {
            fabric: true,
            skus: true,
        },
    },
} satisfies Prisma.ProductInclude;

/**
 * Include configuration for single product with full details
 */
const productDetailInclude = {
    fabricType: true,
    variations: {
        include: {
            fabric: {
                include: { fabricType: true },
            },
            skus: {
                include: { skuCosting: true },
            },
        },
    },
} satisfies Prisma.ProductInclude;

/**
 * Include configuration for variation with full details
 */
const variationDetailInclude = {
    fabric: {
        include: { fabricType: true },
    },
    product: {
        include: { fabricType: true },
    },
    skus: {
        include: { skuCosting: true },
    },
} satisfies Prisma.VariationInclude;

/**
 * Include configuration for SKU with variation and product info
 */
const skuDetailInclude = {
    variation: {
        include: {
            product: {
                include: { fabricType: true },
            },
            fabric: {
                include: { fabricType: true },
            },
        },
    },
    skuCosting: true,
} satisfies Prisma.SkuInclude;

// ============================================
// PROCEDURES
// ============================================

/**
 * List products with optional search, category filter, and pagination
 * Includes variations and SKUs for each product
 */
const list = protectedProcedure
    .input(
        z.object({
            search: z.string().optional(),
            category: z.string().optional(),
            isActive: z.boolean().optional(),
            page: z.number().int().min(1).default(1),
            limit: z.number().int().min(1).max(1000).default(50),
        }).optional()
    )
    .query(async ({ input, ctx }) => {
        const { search, category, isActive, page = 1, limit = 50 } = input ?? {};

        // Build where clause
        const where: Prisma.ProductWhereInput = {};
        if (category) where.category = category;
        if (isActive !== undefined) where.isActive = isActive;
        if (search) {
            where.name = { contains: search, mode: 'insensitive' };
        }

        // Get total count for pagination
        const total = await ctx.prisma.product.count({ where });

        // Get paginated products
        const products = await ctx.prisma.product.findMany({
            where,
            include: productListInclude,
            orderBy: { createdAt: 'desc' },
            skip: (page - 1) * limit,
            take: limit,
        });

        return {
            products,
            pagination: {
                page,
                limit,
                total,
                totalPages: Math.ceil(total / limit),
            },
        };
    });

/**
 * Get single product by ID with full details
 * Includes variations with fabrics, SKUs with costing
 */
const get = protectedProcedure
    .input(z.object({ id: z.string().uuid() }))
    .query(async ({ input, ctx }) => {
        const product = await ctx.prisma.product.findUnique({
            where: { id: input.id },
            include: productDetailInclude,
        });

        if (!product) {
            throw new TRPCError({
                code: 'NOT_FOUND',
                message: `Product not found: ${input.id}`,
            });
        }

        return product;
    });

/**
 * Get single variation by ID with SKUs
 * Includes fabric details and parent product
 */
const getVariation = protectedProcedure
    .input(z.object({ id: z.string().uuid() }))
    .query(async ({ input, ctx }) => {
        const variation = await ctx.prisma.variation.findUnique({
            where: { id: input.id },
            include: variationDetailInclude,
        });

        if (!variation) {
            throw new TRPCError({
                code: 'NOT_FOUND',
                message: `Variation not found: ${input.id}`,
            });
        }

        return variation;
    });

/**
 * Get single SKU by ID with variation and product info
 * Includes costing details and full hierarchy
 */
const getSku = protectedProcedure
    .input(z.object({ id: z.string().uuid() }))
    .query(async ({ input, ctx }) => {
        const sku = await ctx.prisma.sku.findUnique({
            where: { id: input.id },
            include: skuDetailInclude,
        });

        if (!sku) {
            throw new TRPCError({
                code: 'NOT_FOUND',
                message: `SKU not found: ${input.id}`,
            });
        }

        return sku;
    });

// ============================================
// ROUTER EXPORT
// ============================================

/**
 * Products router - combines all product procedures
 */
export const productsRouter = router({
    list,
    get,
    getVariation,
    getSku,
});
