/**
 * Balance Query Routes
 * Handles inventory balance calculations and lookups
 */

import { Router } from 'express';
import type { Request, Response } from 'express';
import { authenticateToken } from '../../middleware/auth.js';
import { asyncHandler } from '../../middleware/asyncHandler.js';
import {
    calculateInventoryBalance,
    calculateAllInventoryBalances,
    calculateAllFabricBalances,
    getEffectiveFabricConsumption,
} from '../../utils/queryPatterns.js';
import { NotFoundError } from '../../utils/errors.js';
import type {
    SkuWithRelations,
    BalanceQuery,
} from './types.js';

const router: Router = Router();

// ============================================
// INVENTORY DASHBOARD
// ============================================

/**
 * GET /balance
 * Retrieve inventory balances for all SKUs with filtering and pagination.
 *
 * @param {boolean} [belowTarget] - Filter to SKUs below target stock (applied in memory)
 * @param {string} [search] - Search SKU code or product name (database-level)
 * @param {number} [limit=10000] - Max results (default high for complete inventory view)
 * @param {number} [offset=0] - Pagination offset
 * @param {boolean} [includeCustomSkus=false] - Include made-to-order custom SKUs
 * @returns {Object} {items: Array, pagination: Object}
 *
 * Default Exclusion: Custom SKUs hidden by default (made-to-order, not stocked)
 * Performance: Uses calculateAllInventoryBalances() to avoid N+1 queries
 */
router.get('/balance', authenticateToken, asyncHandler(async (req: Request, res: Response) => {
    // Default to all SKUs (high limit) since inventory view needs complete picture
    // Use explicit limit param for paginated requests
    const { belowTarget, search, limit = '10000', offset = '0', includeCustomSkus = 'false' } = req.query as BalanceQuery;
    const take = Number(limit);
    const skip = Number(offset);
    const shouldIncludeCustomSkus = includeCustomSkus === 'true';

    // Build SKU filter - by default exclude custom SKUs from standard inventory view
    // Move search filtering to database level for better performance
    const skuWhere: Record<string, unknown> = {
        isActive: true,
        ...(shouldIncludeCustomSkus ? {} : { isCustomSku: false }),
        // Server-side search on SKU code and product name
        ...(search && {
            OR: [
                { skuCode: { contains: search, mode: 'insensitive' } },
                { variation: { product: { name: { contains: search, mode: 'insensitive' } } } }
            ]
        })
    };

    const skus = await req.prisma.sku.findMany({
        where: skuWhere,
        include: {
            variation: {
                include: {
                    product: true,
                    fabric: true,
                },
            },
            shopifyInventoryCache: true,
        },
    }) as SkuWithRelations[];

    // Calculate all balances in a single query (fixes N+1)
    // Use excludeCustomSkus option to match SKU filtering
    const skuIds = skus.map(sku => sku.id);
    const balanceMap = await calculateAllInventoryBalances(req.prisma, skuIds, {
        excludeCustomSkus: !shouldIncludeCustomSkus
    });

    interface BalanceItem {
        skuId: string;
        skuCode: string;
        productId?: string;
        productName: string;
        productType?: string | null;
        gender?: string | null;
        colorName: string;
        variationId?: string;
        size: string;
        category?: string | null;
        imageUrl: string | null;
        currentBalance: number;
        reservedBalance: number;
        availableBalance: number;
        totalInward: number;
        totalOutward: number;
        targetStockQty?: number;
        status: string;
        mrp?: number | null;
        shopifyQty: number | null;
        isCustomSku: boolean;
    }

    const balances: BalanceItem[] = skus.map((sku) => {
        const balance = balanceMap.get(sku.id) || { totalInward: 0, totalOutward: 0, totalReserved: 0, currentBalance: 0, availableBalance: 0 };

        // Get image URL from variation or product
        const imageUrl = sku.variation.imageUrl || sku.variation.product.imageUrl || null;

        return {
            skuId: sku.id,
            skuCode: sku.skuCode,
            productId: sku.variation.product.id,
            productName: sku.variation.product.name,
            productType: sku.variation.product.productType,
            gender: sku.variation.product.gender,
            colorName: sku.variation.colorName,
            variationId: sku.variation.id,
            size: sku.size,
            category: sku.variation.product.category,
            imageUrl,
            currentBalance: balance.currentBalance,
            reservedBalance: balance.totalReserved,
            availableBalance: balance.availableBalance,
            totalInward: balance.totalInward,
            totalOutward: balance.totalOutward,
            targetStockQty: sku.targetStockQty,
            status: balance.availableBalance < (sku.targetStockQty || 0) ? 'below_target' : 'ok',
            mrp: sku.mrp,
            shopifyQty: sku.shopifyInventoryCache?.availableQty ?? null,
            // Custom SKU fields (only present when includeCustomSkus=true)
            isCustomSku: sku.isCustomSku || false,
        };
    });

    let filteredBalances = balances;

    // Filter by below target status (done in memory since it requires calculated balance)
    if (belowTarget === 'true') {
        filteredBalances = balances.filter((b) => b.status === 'below_target');
    }

    // Note: search filtering is now done at database level (see skuWhere above)

    // Sort by status (below_target first)
    filteredBalances.sort((a, b) => {
        if (a.status === 'below_target' && b.status !== 'below_target') return -1;
        if (a.status !== 'below_target' && b.status === 'below_target') return 1;
        return a.skuCode.localeCompare(b.skuCode);
    });

    // Apply pagination after filtering and sorting
    const totalCount = filteredBalances.length;
    const paginatedBalances = filteredBalances.slice(skip, skip + take);

    res.json({
        items: paginatedBalances,
        pagination: {
            total: totalCount,
            limit: take,
            offset: skip,
            hasMore: skip + paginatedBalances.length < totalCount,
        }
    });
}));

/**
 * GET /balance/:skuId
 * Get balance for single SKU with detailed breakdown
 */
router.get('/balance/:skuId', authenticateToken, asyncHandler(async (req: Request, res: Response) => {
    const skuId = req.params.skuId as string;

    const sku = await req.prisma.sku.findUnique({
        where: { id: skuId },
        include: {
            variation: {
                include: {
                    product: true,
                    fabric: true,
                },
            },
        },
    }) as SkuWithRelations | null;

    if (!sku) {
        throw new NotFoundError('SKU not found', 'SKU', skuId);
    }

    const balance = await calculateInventoryBalance(req.prisma, sku.id);

    res.json({
        sku,
        ...balance,
        targetStockQty: sku.targetStockQty,
        status: balance.currentBalance < (sku.targetStockQty || 0) ? 'below_target' : 'ok',
    });
}));

/**
 * GET /alerts
 * Stock alerts for SKUs below target
 * Shows fabric availability and production capacity
 */
router.get('/alerts', authenticateToken, asyncHandler(async (req: Request, res: Response) => {
    // Exclude custom SKUs from alerts - they don't need stock replenishment
    const skus = await req.prisma.sku.findMany({
        where: {
            isActive: true,
            isCustomSku: false
        },
        include: {
            variation: {
                include: {
                    product: true,
                    fabric: true,
                },
            },
        },
    }) as SkuWithRelations[];

    // Calculate all balances in single queries (fixes N+1)
    // excludeCustomSkus=true ensures we don't get balances for custom SKUs
    const skuIds = skus.map(sku => sku.id);
    const inventoryBalanceMap = await calculateAllInventoryBalances(req.prisma, skuIds, {
        excludeCustomSkus: true
    });
    const fabricBalanceMap = await calculateAllFabricBalances(req.prisma);

    interface AlertItem {
        skuId: string;
        skuCode: string;
        productName: string;
        colorName: string;
        size: string;
        currentBalance: number;
        targetStockQty: number;
        shortage: number;
        fabricNeeded: string;
        fabricAvailable: string;
        canProduce: number;
        consumptionPerUnit: string;
        status: string;
    }

    const alerts: AlertItem[] = [];

    for (const sku of skus) {
        const balance = inventoryBalanceMap.get(sku.id) || { currentBalance: 0 };
        const targetStockQty = sku.targetStockQty || 0;

        if (balance.currentBalance < targetStockQty) {
            const shortage = targetStockQty - balance.currentBalance;

            // Get effective fabric consumption (SKU or Product-level fallback)
            const consumptionPerUnit = getEffectiveFabricConsumption(sku);
            const fabricNeeded = shortage * consumptionPerUnit;

            // Get fabric availability from pre-calculated map
            const fabricId = sku.variation.fabricId;
            const fabricBalance = fabricId ? (fabricBalanceMap.get(fabricId) || { currentBalance: 0 }) : { currentBalance: 0 };
            const fabricAvailable = fabricBalance.currentBalance;

            const canProduce = Math.floor(fabricAvailable / consumptionPerUnit);

            alerts.push({
                skuId: sku.id,
                skuCode: sku.skuCode,
                productName: sku.variation.product.name,
                colorName: sku.variation.colorName,
                size: sku.size,
                currentBalance: balance.currentBalance,
                targetStockQty,
                shortage,
                fabricNeeded: fabricNeeded.toFixed(2),
                fabricAvailable: fabricAvailable.toFixed(2),
                canProduce,
                consumptionPerUnit: consumptionPerUnit.toFixed(2),
                status: canProduce >= shortage ? 'can_produce' : 'fabric_needed',
            });
        }
    }

    // Sort by severity (larger shortage first)
    alerts.sort((a, b) => b.shortage - a.shortage);

    res.json(alerts);
}));

export default router;
