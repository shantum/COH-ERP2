/**
 * Catalog Router
 * Combined product + inventory view endpoints
 */

import { Router } from 'express';
import type { Request, Response } from 'express';
import { asyncHandler } from '../middleware/asyncHandler.js';
import { authenticateToken } from '../middleware/auth.js';
import { filterConfidentialFields } from '../middleware/permissions.js';
import { calculateAllInventoryBalances } from '../utils/queryPatterns.js';

const router: Router = Router();

// ============================================
// TYPE DEFINITIONS
// ============================================

/**
 * Inventory balance data from calculateAllInventoryBalances
 */
interface InventoryBalance {
    totalInward: number;
    totalOutward: number;
    totalReserved: number;
    currentBalance: number;
    availableBalance: number;
}

/**
 * Shopify inventory cache relation
 */
interface ShopifyInventoryCache {
    availableQty: number | null;
}

/**
 * Fabric type with cost
 */
interface FabricType {
    id: string;
    name: string;
    defaultCostPerUnit?: number | null;
}

/**
 * Fabric with cost and type
 */
interface Fabric {
    id: string;
    colorName: string;
    costPerUnit?: number | null;
    fabricType?: FabricType | null;
}

/**
 * Product with fabric type
 */
interface Product {
    id: string;
    name: string;
    styleCode?: string | null;
    category?: string | null;
    gender?: string | null;
    productType?: string | null;
    imageUrl?: string | null;
    shopifyProductId?: string | null;
    fabricTypeId?: string | null;
    fabricType?: FabricType | null;
    // Costing cascade - product level
    trimsCost?: number | null;
    liningCost?: number | null;
    packagingCost?: number | null;
    baseProductionTimeMins?: number | null;
}

/**
 * Product variation with costing
 */
interface Variation {
    id: string;
    colorName: string;
    hasLining?: boolean | null;
    imageUrl?: string | null;
    fabricId?: string | null;
    product: Product;
    fabric?: Fabric | null;
    // Costing cascade - variation level
    trimsCost?: number | null;
    liningCost?: number | null;
    packagingCost?: number | null;
    laborMinutes?: number | null;
}

/**
 * SKU with full relations for catalog view
 */
interface SkuWithRelations {
    id: string;
    skuCode: string;
    size: string;
    mrp?: number | null;
    isActive: boolean;
    fabricConsumption?: number | null;
    targetStockQty?: number | null;
    // Costing cascade - SKU level
    trimsCost?: number | null;
    liningCost?: number | null;
    packagingCost?: number | null;
    laborMinutes?: number | null;
    // Relations
    variation: Variation;
    shopifyInventoryCache?: ShopifyInventoryCache | null;
}

/**
 * SKU inventory item response
 */
interface SkuInventoryItem {
    // SKU identifiers
    skuId: string;
    skuCode: string;
    size: string;
    mrp: number | null;
    fabricConsumption: number | null;
    trimsCost: number | null;
    liningCost: number | null;
    packagingCost: number | null;
    laborMinutes: number;
    // Raw cascade values for editing
    skuTrimsCost: number | null;
    variationTrimsCost: number | null;
    productTrimsCost: number | null;
    skuLiningCost: number | null;
    variationLiningCost: number | null;
    productLiningCost: number | null;
    skuPackagingCost: number | null;
    variationPackagingCost: number | null;
    productPackagingCost: number | null;
    globalPackagingCost: number;
    skuLaborMinutes: number | null;
    variationLaborMinutes: number | null;
    productLaborMinutes: number | null;
    laborRatePerMin: number;
    // Costing
    fabricCostPerUnit: number;
    fabricCost: number;
    laborCost: number;
    totalCost: number;
    // GST & Pricing
    gstRate: number;
    exGstPrice: number;
    gstAmount: number;
    costMultiple: number | null;
    isActive: boolean;
    // Variation (color-level)
    variationId: string;
    colorName: string;
    hasLining: boolean;
    fabricName: string | null;
    imageUrl: string | null;
    // Product (style-level)
    productId: string;
    productName: string;
    styleCode: string | null;
    category: string | null;
    gender: string | null;
    productType: string | null;
    fabricTypeId: string | null;
    fabricTypeName: string | null;
    fabricId: string | null;
    variationFabricTypeName: string | null;
    // Shopify status
    shopifyProductId: string | null;
    shopifyStatus: string;
    // Inventory
    currentBalance: number;
    reservedBalance: number;
    availableBalance: number;
    totalInward: number;
    totalOutward: number;
    shopifyQty: number | null;
    targetStockQty: number | null;
    status: 'below_target' | 'ok';
}

/**
 * Filter options response
 */
interface FilterOptions {
    genders: string[];
    categories: string[];
    products: Array<{
        id: string;
        name: string;
        gender: string | null;
        category: string | null;
    }>;
    fabricTypes: Array<{
        id: string;
        name: string;
    }>;
    fabrics: Array<{
        id: string;
        name: string;
        colorName: string;
        fabricTypeId: string | null;
        displayName: string;
    }>;
}

// ============================================
// HELPER FUNCTIONS
// ============================================

// Size sort order for proper sorting (XS -> S -> M -> L -> XL -> 2XL -> etc)
const SIZE_ORDER = ['XS', 'S', 'M', 'L', 'XL', '2XL', '3XL', '4XL', 'Free'];

function getSizeIndex(size: string): number {
    const idx = SIZE_ORDER.indexOf(size);
    return idx === -1 ? 999 : idx; // Unknown sizes go to end
}

// ============================================
// ROUTES
// ============================================

/**
 * GET /sku-inventory
 * Returns flat array of all SKUs with product hierarchy, inventory, and costing data
 *
 * FILTERING:
 * - gender, category, productId: Filters on product hierarchy
 * - status: 'below_target' | 'ok' (balance vs targetStockQty)
 * - search: Matches orderNumber, customerName, awbNumber, email, phone (case-insensitive)
 * - limit, offset: Pagination (default: 10000, 0)
 *
 * COSTING CASCADE (null at any level = fallback to next):
 *   trimsCost: SKU → Variation → Product → null
 *   liningCost: SKU → Variation → Product → null (only if hasLining=true)
 *   packagingCost: SKU → Variation → Product → CostConfig.defaultPackagingCost (ALWAYS has value)
 *   laborMinutes: SKU → Variation → Product.baseProductionTimeMins → 60 (ALWAYS has value)
 *   fabricCost: SKU.fabricConsumption * (Fabric.costPerUnit ?? FabricType.defaultCostPerUnit)
 *
 * RESPONSE INCLUDES:
 * - Effective costs (best from hierarchy: trimsCost, liningCost, packagingCost, laborMinutes)
 * - Raw cascade values (all levels: skuTrimsCost, variationTrimsCost, productTrimsCost, globalPackagingCost)
 * - Computed costs (fabricCost, laborCost, totalCost)
 * - GST calculation (catalog-level only, MRP inclusive)
 * - Full product hierarchy (productId, productName, variationId, colorName, fabricName)
 * - Inventory balances (currentBalance, reservedBalance, availableBalance)
 * - Shopify sync status
 */
router.get('/sku-inventory', authenticateToken, asyncHandler(async (req: Request, res: Response) => {
    const {
        gender,
        category,
        productId,
        status,
        search,
        limit = 10000,
        offset = 0
    } = req.query;

    // Build SKU filter
    const skuWhere: Record<string, unknown> = {
        isActive: true,
        isCustomSku: false, // Exclude custom SKUs from catalog view
    };

    // Add variation/product filters
    const variationWhere: Record<string, unknown> = {};
    const productWhere: Record<string, unknown> = {};

    if (gender) {
        productWhere.gender = gender;
    }
    if (category) {
        productWhere.category = category;
    }
    if (productId) {
        variationWhere.productId = productId;
    }

    // Search filter (SKU code, product name, or color name)
    if (search) {
        skuWhere.OR = [
            { skuCode: { contains: search, mode: 'insensitive' } },
            { variation: { colorName: { contains: search, mode: 'insensitive' } } },
            { variation: { product: { name: { contains: search, mode: 'insensitive' } } } },
        ];
    }

    // Apply nested filters if any
    if (Object.keys(productWhere).length > 0) {
        variationWhere.product = productWhere;
    }
    if (Object.keys(variationWhere).length > 0) {
        skuWhere.variation = variationWhere;
    }

    // Fetch all SKUs with full product hierarchy
    const skus = await req.prisma.sku.findMany({
        where: skuWhere,
        include: {
            variation: {
                include: {
                    product: {
                        include: {
                            fabricType: true,
                        },
                    },
                    fabric: {
                        include: {
                            fabricType: true,
                        },
                    },
                },
            },
            shopifyInventoryCache: true,
        },
        orderBy: [
            { variation: { product: { name: 'asc' } } },
            { variation: { colorName: 'asc' } },
            { size: 'asc' },
        ],
        take: Number(limit),
        skip: Number(offset),
    }) as unknown as SkuWithRelations[];

    // Calculate all inventory balances in single batch query
    const skuIds = skus.map(sku => sku.id);
    const balanceMap = await calculateAllInventoryBalances(req.prisma, skuIds, {
        excludeCustomSkus: true,
    });

    // Fetch global cost config for default packaging cost, labor rate, and GST settings
    const costConfig = await req.prisma.costConfig.findFirst();
    const globalPackagingCost = costConfig?.defaultPackagingCost || 50;
    const laborRatePerMin = costConfig?.laborRatePerMin || 2.5;
    // GST configuration (for catalog pricing only - order pricing calculated separately)
    const gstThreshold = costConfig?.gstThreshold || 2500;
    const gstRateAbove = costConfig?.gstRateAbove || 18;
    const gstRateBelow = costConfig?.gstRateBelow || 5;

    // Batch fetch Shopify product cache for status lookup
    const shopifyProductIds = [...new Set(
        skus.map(sku => sku.variation.product.shopifyProductId).filter(Boolean)
    )] as string[];
    const shopifyStatusMap = new Map<string, string>();
    if (shopifyProductIds.length > 0) {
        const shopifyCache = await req.prisma.shopifyProductCache.findMany({
            where: { id: { in: shopifyProductIds } },
            select: { id: true, rawData: true },
        });
        shopifyCache.forEach(cache => {
            try {
                const data = JSON.parse(cache.rawData as string);
                shopifyStatusMap.set(cache.id, data.status || 'unknown');
            } catch {
                shopifyStatusMap.set(cache.id, 'unknown');
            }
        });
    }

    // Map to flat response structure
    let items: SkuInventoryItem[] = skus.map((sku) => {
        const balance: InventoryBalance = balanceMap.get(sku.id) || {
            totalInward: 0,
            totalOutward: 0,
            totalReserved: 0,
            currentBalance: 0,
            availableBalance: 0,
        };

        const product = sku.variation.product;
        const variation = sku.variation;

        // Cascade trims cost: SKU -> Variation -> Product
        const effectiveTrimsCost = sku.trimsCost ?? variation.trimsCost ?? product.trimsCost ?? null;

        // Cascade lining cost: SKU -> Variation -> Product (only applies if hasLining is true)
        const effectiveLiningCost = variation.hasLining
            ? (sku.liningCost ?? variation.liningCost ?? product.liningCost ?? null)
            : null;

        // Cascade packaging cost: SKU -> Variation -> Product -> Global default
        const effectivePackagingCost = sku.packagingCost ?? variation.packagingCost ?? product.packagingCost ?? globalPackagingCost;

        // Cascade labor minutes: SKU -> Variation -> Product.baseProductionTimeMins
        const effectiveLaborMinutes = sku.laborMinutes ?? variation.laborMinutes ?? product.baseProductionTimeMins ?? 60;

        // Calculate fabric cost and total cost (handle NaN safely)
        // Cascade: Fabric.costPerUnit -> FabricType.defaultCostPerUnit
        const fabricCostPerUnit = Number(variation.fabric?.costPerUnit ?? variation.fabric?.fabricType?.defaultCostPerUnit) || 0;
        const fabricCost = (Number(sku.fabricConsumption) || 0) * fabricCostPerUnit;
        const laborCost = (Number(effectiveLaborMinutes) || 0) * laborRatePerMin;
        const totalCost = (fabricCost || 0) + (laborCost || 0) + (effectiveTrimsCost || 0) + (effectiveLiningCost || 0) + (effectivePackagingCost || 0);

        // GST calculations (catalog pricing - MRP is inclusive of GST)
        const mrp = Number(sku.mrp) || 0;
        const gstRate = mrp >= gstThreshold ? gstRateAbove : gstRateBelow;
        const exGstPrice = mrp > 0 ? Math.round((mrp / (1 + gstRate / 100)) * 100) / 100 : 0;
        const gstAmount = Math.round((mrp - exGstPrice) * 100) / 100;
        const costMultiple = totalCost > 0 ? Math.round((mrp / totalCost) * 100) / 100 : null;

        return {
            // SKU identifiers
            skuId: sku.id,
            skuCode: sku.skuCode,
            size: sku.size,
            mrp: sku.mrp ?? null,
            fabricConsumption: sku.fabricConsumption ?? null,
            trimsCost: effectiveTrimsCost,
            liningCost: effectiveLiningCost,
            packagingCost: effectivePackagingCost,
            laborMinutes: effectiveLaborMinutes,
            // Raw values for editing (to know where override exists)
            skuTrimsCost: sku.trimsCost ?? null,
            variationTrimsCost: variation.trimsCost ?? null,
            productTrimsCost: product.trimsCost ?? null,
            skuLiningCost: sku.liningCost ?? null,
            variationLiningCost: variation.liningCost ?? null,
            productLiningCost: product.liningCost ?? null,
            skuPackagingCost: sku.packagingCost ?? null,
            variationPackagingCost: variation.packagingCost ?? null,
            productPackagingCost: product.packagingCost ?? null,
            globalPackagingCost,
            skuLaborMinutes: sku.laborMinutes ?? null,
            variationLaborMinutes: variation.laborMinutes ?? null,
            productLaborMinutes: product.baseProductionTimeMins ?? null,
            laborRatePerMin,
            // Costing
            fabricCostPerUnit,
            fabricCost: Math.round(fabricCost * 100) / 100,
            laborCost: Math.round(laborCost * 100) / 100,
            totalCost: Math.round(totalCost * 100) / 100,
            // GST & Pricing (catalog-level calculations)
            gstRate,
            exGstPrice,
            gstAmount,
            costMultiple,
            isActive: sku.isActive,

            // Variation (color-level)
            variationId: variation.id,
            colorName: variation.colorName,
            hasLining: variation.hasLining || false,
            // Full fabric name: "Fabric Type - Color" (e.g., "Linen 60 Lea - Blue")
            fabricName: variation.fabric
                ? `${variation.fabric.fabricType?.name || 'Unknown'} - ${variation.fabric.colorName}`
                : null,
            imageUrl: variation.imageUrl || product.imageUrl || null,

            // Product (style-level)
            productId: product.id,
            productName: product.name,
            styleCode: product.styleCode ?? null,
            category: product.category ?? null,
            gender: product.gender ?? null,
            productType: product.productType ?? null,
            fabricTypeId: product.fabricTypeId || null,
            fabricTypeName: product.fabricType?.name || null,
            fabricId: variation.fabricId || null,
            // Fabric's fabric type (may differ from product's fabricType)
            variationFabricTypeName: variation.fabric?.fabricType?.name || null,

            // Shopify status
            shopifyProductId: product.shopifyProductId || null,
            shopifyStatus: product.shopifyProductId
                ? (shopifyStatusMap.get(product.shopifyProductId) || 'not_cached')
                : 'not_linked',

            // Inventory
            currentBalance: balance.currentBalance,
            reservedBalance: balance.totalReserved,
            availableBalance: balance.availableBalance,
            totalInward: balance.totalInward,
            totalOutward: balance.totalOutward,
            shopifyQty: sku.shopifyInventoryCache?.availableQty ?? null,
            targetStockQty: sku.targetStockQty ?? null,
            status: balance.availableBalance < (sku.targetStockQty ?? 0) ? 'below_target' : 'ok',
        };
    });

    // Filter by stock status (done in memory since it requires calculated balance)
    if (status === 'below_target') {
        items = items.filter(item => item.status === 'below_target');
    } else if (status === 'ok') {
        items = items.filter(item => item.status === 'ok');
    }

    // Sort by product name, color, then size (with custom size order)
    items.sort((a, b) => {
        // First by product name
        const nameCompare = a.productName.localeCompare(b.productName);
        if (nameCompare !== 0) return nameCompare;

        // Then by color name
        const colorCompare = a.colorName.localeCompare(b.colorName);
        if (colorCompare !== 0) return colorCompare;

        // Finally by size (custom order: XS, S, M, L, XL, 2XL, 3XL, 4XL, Free)
        return getSizeIndex(a.size) - getSizeIndex(b.size);
    });

    // Get total count for pagination info
    const totalCount = await req.prisma.sku.count({
        where: skuWhere,
    });

    // Filter confidential fields based on user permissions
    const filteredItems = filterConfidentialFields(
        items as unknown as Record<string, unknown>[],
        req.userPermissions
    ) as unknown as SkuInventoryItem[];

    res.json({
        items: filteredItems,
        pagination: {
            total: totalCount,
            limit: Number(limit),
            offset: Number(offset),
            hasMore: Number(offset) + items.length < totalCount,
        },
    });
}));

/**
 * GET /filters
 * Returns filter options for catalog page UI (genders, categories, products, fabric types, fabrics)
 *
 * Used to populate dropdowns in filter bar. Data sourced from active products only.
 * Helps users narrow down SKU inventory across multiple dimensions.
 */
router.get('/filters', authenticateToken, asyncHandler(async (req: Request, res: Response) => {
    const [products, fabricTypes, fabrics] = await Promise.all([
        req.prisma.product.findMany({
            where: { isActive: true },
            select: {
                id: true,
                name: true,
                gender: true,
                category: true,
            },
            orderBy: { name: 'asc' },
        }),
        req.prisma.fabricType.findMany({
            select: {
                id: true,
                name: true,
            },
            orderBy: { name: 'asc' },
        }),
        req.prisma.fabric.findMany({
            where: { isActive: true },
            select: {
                id: true,
                name: true,
                colorName: true,
                fabricTypeId: true,
            },
            orderBy: [{ name: 'asc' }, { colorName: 'asc' }],
        }),
    ]);

    // Extract unique genders and categories
    const genders = [...new Set(products.map(p => p.gender).filter((g): g is string => Boolean(g)))].sort();
    const categories = [...new Set(products.map(p => p.category).filter((c): c is string => Boolean(c)))].sort();

    const response: FilterOptions = {
        genders,
        categories,
        products: products.map(p => ({
            id: p.id,
            name: p.name,
            gender: p.gender,
            category: p.category,
        })),
        fabricTypes: fabricTypes.map(ft => ({
            id: ft.id,
            name: ft.name,
        })),
        fabrics: fabrics.map(f => ({
            id: f.id,
            name: f.name,
            colorName: f.colorName,
            fabricTypeId: f.fabricTypeId,
            displayName: f.name, // Fabric name already includes type + color
        })),
    };

    res.json(response);
}));

export default router;
