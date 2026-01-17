/**
 * @fileoverview Product Catalog Routes - Manages product hierarchy (Product -> Variation -> SKU)
 *
 * Product Hierarchy:
 * - Product: Base template (e.g., "Kurti") with production time and fabric type
 * - Variation: Color variant (e.g., "Red Kurti") linked to specific fabric
 * - SKU: Size-specific item (e.g., "Red Kurti - M") with unique barcode
 *
 * Costing Cascade (SKU -> Variation -> Product -> Global):
 * - Each level can override costs; null = inherit from next level
 * - Fabric consumption: SKU.fabricConsumption -> Product.defaultFabricConsumption -> 1.5
 * - Labor/Packaging: SKU -> Variation -> Product -> CostConfig defaults
 * - Lining cost: Only non-null when hasLining=true
 *
 * Key Gotchas:
 * - Route order matters: /cost-config must be before /:id
 * - Changing Product.fabricTypeId resets all Variations to Default fabric
 * - Changing Variation.fabricId syncs Product.fabricTypeId if non-Default
 * - COGS endpoint uses costing cascade for final calculations
 */

import { Router } from 'express';
import type { Request, Response } from 'express';
import type { Prisma } from '@prisma/client';
import { authenticateToken } from '../middleware/auth.js';
import { requirePermission, filterConfidentialFields } from '../middleware/permissions.js';
import { asyncHandler } from '../middleware/asyncHandler.js';
import { NotFoundError } from '../utils/errors.js';

const router: Router = Router();

// ============================================
// TYPE DEFINITIONS
// ============================================

/**
 * Query parameters for product list endpoint
 */
interface ProductListQuery {
    category?: string;
    productType?: string;
    isActive?: string;
    search?: string;
}

/**
 * Query parameters for SKU list endpoint
 */
interface SKUListQuery {
    search?: string;
    isActive?: string;
}

/**
 * Request body for creating a product
 */
interface CreateProductBody {
    name: string;
    styleCode?: string;
    category: string;
    productType: string;
    gender?: string;
    fabricTypeId?: string;
    baseProductionTimeMins?: number;
    defaultFabricConsumption?: number;
}

/**
 * Request body for updating a product
 */
interface UpdateProductBody {
    name?: string;
    styleCode?: string;
    category?: string;
    productType?: string;
    gender?: string;
    fabricTypeId?: string;
    baseProductionTimeMins?: number;
    defaultFabricConsumption?: number;
    trimsCost?: number;
    liningCost?: number;
    packagingCost?: number;
    isActive?: boolean;
}

/**
 * Request body for cost config
 */
interface CostConfigBody {
    laborRatePerMin?: number;
    defaultPackagingCost?: number;
    gstThreshold?: number;
    gstRateAbove?: number;
    gstRateBelow?: number;
}

/**
 * Request body for creating a variation
 */
interface CreateVariationBody {
    colorName: string;
    standardColor?: string;
    colorHex: string;
    fabricId: string;
    hasLining?: boolean;
}

/**
 * Request body for updating a variation
 */
interface UpdateVariationBody {
    colorName?: string;
    standardColor?: string;
    colorHex?: string;
    fabricId?: string;
    hasLining?: boolean;
    trimsCost?: number;
    liningCost?: number;
    packagingCost?: number;
    laborMinutes?: number;
    isActive?: boolean;
}

/**
 * Request body for creating a SKU
 */
interface CreateSKUBody {
    skuCode: string;
    size: string;
    fabricConsumption?: number;
    mrp: number;
    targetStockQty?: number;
    targetStockMethod?: string;
}

/**
 * Request body for updating a SKU
 */
interface UpdateSKUBody {
    fabricConsumption?: number;
    mrp?: number;
    targetStockQty?: number;
    targetStockMethod?: string;
    trimsCost?: number;
    liningCost?: number;
    packagingCost?: number;
    laborMinutes?: number;
    isActive?: boolean;
}

/**
 * COGS data structure for a single SKU
 * Uses index signature to be compatible with filterConfidentialFields
 */
interface COGSData {
    [key: string]: unknown;
    skuId: string;
    skuCode: string;
    productName: string;
    colorName: string;
    size: string;
    fabricConsumption: number | Prisma.Decimal | null;
    fabricRate: number;
    fabricCost: number;
    laborMins: number | Prisma.Decimal | null;
    laborRatePerMin: number | Prisma.Decimal;
    laborCost: number;
    trimsCost: number;
    liningCost: number;
    packagingCost: number;
    otherCost: number;
    totalCogs: number;
    mrp: number;
    grossMargin: number;
    marginPct: number;
}

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
 * Include configuration for COGS calculation
 */
const cogsSkuInclude = {
    variation: {
        include: {
            product: true,
            fabric: {
                include: { fabricType: true },
            },
        },
    },
    skuCosting: true,
} satisfies Prisma.SkuInclude;

/**
 * Include configuration for SKU list
 */
const skuListInclude = {
    variation: {
        include: {
            product: true,
            fabric: true,
        },
    },
    skuCosting: true,
} satisfies Prisma.SkuInclude;

/**
 * Include configuration for variation with fabric and product
 */
const variationDetailInclude = {
    fabric: { include: { fabricType: true } },
    product: { select: { id: true, fabricTypeId: true } },
} satisfies Prisma.VariationInclude;

// ============================================
// PRODUCT ROUTES
// ============================================

// Get all products with variations and SKUs
router.get('/', authenticateToken, asyncHandler(async (req: Request, res: Response) => {
    const { category, productType, isActive, search } = req.query as ProductListQuery;

    const where: Prisma.ProductWhereInput = {};
    if (category) where.category = category;
    if (productType) where.productType = productType;
    if (isActive !== undefined) where.isActive = isActive === 'true';
    if (search) {
        where.name = { contains: search, mode: 'insensitive' };
    }

    const products = await req.prisma.product.findMany({
        where,
        include: productListInclude,
        orderBy: { createdAt: 'desc' },
    });

    // Filter confidential fields based on user permissions
    const filtered = filterConfidentialFields(products, req.userPermissions);
    res.json(filtered);
}));

// ============================================
// COST CONFIG (must be before /:id routes)
// ============================================

/**
 * GET /cost-config
 * Retrieve global cost configuration (labor rate, packaging, GST thresholds).
 * Creates default config if none exists.
 *
 * @returns {Object} CostConfig with laborRatePerMin, defaultPackagingCost, gstThreshold, etc.
 */
router.get('/cost-config', authenticateToken, asyncHandler(async (req: Request, res: Response) => {
    let config = await req.prisma.costConfig.findFirst();

    if (!config) {
        // Create default config if none exists
        config = await req.prisma.costConfig.create({
            data: { laborRatePerMin: 2.5, defaultPackagingCost: 50 },
        });
    }

    // Filter confidential fields based on user permissions
    const filtered = filterConfidentialFields(config, req.userPermissions);
    res.json(filtered);
}));

/**
 * PUT /cost-config
 * Update global cost configuration. Only provided fields are updated.
 *
 * @param {number} [laborRatePerMin] - Cost per minute of labor
 * @param {number} [defaultPackagingCost] - Default packaging cost per unit
 * @param {number} [gstThreshold] - Order value threshold for GST calculation
 * @param {number} [gstRateAbove] - GST rate for orders above threshold
 * @param {number} [gstRateBelow] - GST rate for orders below threshold
 * @returns {Object} Updated CostConfig
 */
router.put('/cost-config', authenticateToken, requirePermission('products:edit:cost'), asyncHandler(async (req: Request, res: Response) => {
    const { laborRatePerMin, defaultPackagingCost, gstThreshold, gstRateAbove, gstRateBelow } = req.body as CostConfigBody;

    let config = await req.prisma.costConfig.findFirst();

    // Build update data with only provided fields
    const updateData: Prisma.CostConfigUpdateInput = { lastUpdated: new Date() };
    if (laborRatePerMin !== undefined) updateData.laborRatePerMin = laborRatePerMin;
    if (defaultPackagingCost !== undefined) updateData.defaultPackagingCost = defaultPackagingCost;
    if (gstThreshold !== undefined) updateData.gstThreshold = gstThreshold;
    if (gstRateAbove !== undefined) updateData.gstRateAbove = gstRateAbove;
    if (gstRateBelow !== undefined) updateData.gstRateBelow = gstRateBelow;

    if (config) {
        config = await req.prisma.costConfig.update({
            where: { id: config.id },
            data: updateData,
        });
    } else {
        config = await req.prisma.costConfig.create({
            data: { laborRatePerMin, defaultPackagingCost, gstThreshold, gstRateAbove, gstRateBelow },
        });
    }

    res.json(config);
}));

/**
 * GET /cogs
 * Calculate Cost of Goods Sold (COGS) for all active SKUs using costing cascade.
 *
 * COGS Formula:
 * - fabricCost = fabricConsumption * fabric.costPerUnit
 * - laborCost = baseProductionTimeMins * laborRatePerMin
 * - totalCogs = fabricCost + laborCost + packagingCost + otherCost
 * - marginPct = ((mrp - totalCogs) / mrp) * 100
 *
 * Cascade Logic:
 * - packagingCost: SKU.skuCosting -> CostConfig.defaultPackagingCost (50)
 * - otherCost: SKU.skuCosting -> 0
 *
 * @returns {Array<Object>} Array of COGS data with breakdown per SKU
 */
router.get('/cogs', authenticateToken, asyncHandler(async (req: Request, res: Response) => {
    const costConfig = await req.prisma.costConfig.findFirst();
    const laborRatePerMin = costConfig?.laborRatePerMin || 2.5;
    const defaultPackagingCost = costConfig?.defaultPackagingCost || 50;

    const skus = await req.prisma.sku.findMany({
        where: { isActive: true },
        include: cogsSkuInclude,
    });

    const cogsData: COGSData[] = skus.map((sku) => {
        // Fix: Add null-safe cascade for fabric cost (Fabric.costPerUnit -> FabricType.defaultCostPerUnit -> 0)
        const fabricCostPerUnit = Number(
            sku.variation.fabric?.costPerUnit ??
            sku.variation.fabric?.fabricType?.defaultCostPerUnit ??
            0
        );
        const fabricConsumption = Number(sku.fabricConsumption) || 0;
        const fabricCost = fabricConsumption * fabricCostPerUnit;

        // Fix: Add proper cascade for labor, trims, lining, packaging
        const effectiveLaborMinutes =
            sku.laborMinutes ??
            sku.variation.laborMinutes ??
            sku.variation.product.baseProductionTimeMins ??
            60;

        const effectiveTrimsCost =
            sku.trimsCost ??
            sku.variation.trimsCost ??
            sku.variation.product.trimsCost ??
            0;

        const effectiveLiningCost = sku.variation.hasLining
            ? (sku.liningCost ?? sku.variation.liningCost ?? sku.variation.product.liningCost ?? 0)
            : 0;

        const effectivePackagingCost =
            sku.packagingCost ??
            sku.variation.packagingCost ??
            sku.variation.product.packagingCost ??
            defaultPackagingCost;

        const laborCost = Number(effectiveLaborMinutes) * Number(laborRatePerMin);
        const otherCost = sku.skuCosting?.otherCost || 0;
        const totalCogs = fabricCost + laborCost + Number(effectiveTrimsCost) + Number(effectiveLiningCost) + Number(effectivePackagingCost) + Number(otherCost);
        const mrp = Number(sku.mrp);
        const grossMargin = mrp - totalCogs;
        const marginPct = mrp > 0 ? Math.round((grossMargin / mrp) * 1000) / 10 : 0;

        return {
            skuId: sku.id,
            skuCode: sku.skuCode,
            productName: sku.variation.product.name,
            colorName: sku.variation.colorName,
            size: sku.size,
            fabricConsumption: sku.fabricConsumption,
            fabricRate: fabricCostPerUnit,
            fabricCost: Math.round(fabricCost * 100) / 100,
            laborMins: effectiveLaborMinutes,
            laborRatePerMin: laborRatePerMin,
            laborCost: Math.round(laborCost * 100) / 100,
            trimsCost: Math.round(Number(effectiveTrimsCost) * 100) / 100,
            liningCost: Math.round(Number(effectiveLiningCost) * 100) / 100,
            packagingCost: Math.round(Number(effectivePackagingCost) * 100) / 100,
            otherCost: Math.round(Number(otherCost) * 100) / 100,
            totalCogs: Math.round(totalCogs * 100) / 100,
            mrp: Math.round(mrp * 100) / 100,
            grossMargin: Math.round(grossMargin * 100) / 100,
            marginPct,
        };
    });

    // Filter confidential fields based on user permissions
    const filtered = filterConfidentialFields(cogsData, req.userPermissions);
    res.json(filtered);
}));

// ============================================
// PRODUCTS TREE (for unified Products page)
// ============================================

/**
 * Include configuration for products tree
 */
const productTreeInclude = {
    fabricType: true,
    variations: {
        where: { isActive: true },
        include: {
            fabric: true,
            skus: {
                where: { isActive: true },
                orderBy: { size: 'asc' as const },
            },
        },
        orderBy: { colorName: 'asc' as const },
    },
} satisfies Prisma.ProductInclude;

/**
 * GET /tree
 * Get hierarchical products tree for the unified Products page.
 * Returns Product → Variation → SKU hierarchy with summary counts and stock.
 *
 * @param {string} [search] - Optional search query to filter by name/code
 * @returns {Object} { items: ProductTreeNode[], summary: { products, variations, skus, totalStock } }
 */
router.get('/tree', authenticateToken, asyncHandler(async (req: Request, res: Response) => {
    const { search } = req.query as { search?: string };

    // Build where clause for search
    const productWhere: Prisma.ProductWhereInput = { isActive: true };
    if (search) {
        productWhere.OR = [
            { name: { contains: search, mode: 'insensitive' } },
            { styleCode: { contains: search, mode: 'insensitive' } },
            { category: { contains: search, mode: 'insensitive' } },
            {
                variations: {
                    some: {
                        OR: [
                            { colorName: { contains: search, mode: 'insensitive' } },
                            { skus: { some: { skuCode: { contains: search, mode: 'insensitive' } } } },
                        ],
                    },
                },
            },
        ];
    }

    // Fetch products with variations and SKUs
    const products = await req.prisma.product.findMany({
        where: productWhere,
        include: productTreeInclude,
        orderBy: { name: 'asc' },
    });

    // Get inventory balances for all SKUs
    const allSkuIds = products.flatMap((p: any) => p.variations.flatMap((v: any) => v.skus.map((s: any) => s.id)));
    const inventoryBalances = await req.prisma.inventoryTransaction.groupBy({
        by: ['skuId'],
        where: { skuId: { in: allSkuIds } },
        _sum: { qty: true },
    });
    const balanceMap = new Map(inventoryBalances.map(b => [b.skuId, Number(b._sum.qty) || 0]));

    // Transform to tree structure
    let totalProducts = 0;
    let totalVariations = 0;
    let totalSkus = 0;
    let totalStock = 0;

    const items = products.map((product: any) => {
        totalProducts++;
        let productStock = 0;
        const productVariationCount = product.variations.length;
        let productSkuCount = 0;

        const variationChildren = product.variations.map((variation: any) => {
            totalVariations++;
            let variationStock = 0;

            const skuChildren = variation.skus.map((sku: any) => {
                totalSkus++;
                productSkuCount++;
                const balance = balanceMap.get(sku.id) || 0;
                variationStock += balance;
                totalStock += balance;

                return {
                    id: sku.id,
                    type: 'sku' as const,
                    name: sku.size,
                    isActive: sku.isActive,
                    variationId: variation.id,
                    skuCode: sku.skuCode,
                    barcode: sku.skuCode,
                    size: sku.size,
                    mrp: Number(sku.mrp),
                    fabricConsumption: sku.fabricConsumption ? Number(sku.fabricConsumption) : undefined,
                    currentBalance: balance,
                    availableBalance: balance, // TODO: subtract reserved
                    targetStockQty: sku.targetStockQty,
                    trimsCost: sku.trimsCost ? Number(sku.trimsCost) : null,
                    liningCost: sku.liningCost ? Number(sku.liningCost) : null,
                    packagingCost: sku.packagingCost ? Number(sku.packagingCost) : null,
                    laborMinutes: sku.laborMinutes ? Number(sku.laborMinutes) : null,
                };
            });

            productStock += variationStock;

            // Get variation's average MRP
            const variationMrps = variation.skus.map((s: any) => Number(s.mrp) || 0).filter((m: number) => m > 0);
            const variationAvgMrp = variationMrps.length > 0 ? variationMrps.reduce((a: number, b: number) => a + b, 0) / variationMrps.length : null;

            return {
                id: variation.id,
                type: 'variation' as const,
                name: variation.colorName,
                isActive: variation.isActive,
                productId: product.id,
                productName: product.name,
                colorName: variation.colorName,
                colorHex: variation.colorHex || undefined,
                fabricId: variation.fabricId || undefined,
                fabricName: variation.fabric?.name,
                imageUrl: variation.imageUrl || undefined,
                hasLining: variation.hasLining,
                totalStock: variationStock,
                avgMrp: variationAvgMrp,
                trimsCost: variation.trimsCost ? Number(variation.trimsCost) : null,
                liningCost: variation.liningCost ? Number(variation.liningCost) : null,
                packagingCost: variation.packagingCost ? Number(variation.packagingCost) : null,
                laborMinutes: variation.laborMinutes ? Number(variation.laborMinutes) : null,
                children: skuChildren,
            };
        });

        // Calculate average MRP from SKUs
        const allMrps = product.variations.flatMap((v: any) => v.skus.map((s: any) => Number(s.mrp) || 0)).filter((m: number) => m > 0);
        const avgMrp = allMrps.length > 0 ? allMrps.reduce((a: number, b: number) => a + b, 0) / allMrps.length : null;

        return {
            id: product.id,
            type: 'product' as const,
            name: product.name,
            isActive: product.isActive,
            styleCode: product.styleCode || undefined,
            category: product.category,
            gender: product.gender,
            productType: product.productType || undefined,
            fabricTypeId: product.fabricTypeId || undefined,
            fabricTypeName: product.fabricType?.name,
            imageUrl: product.imageUrl || undefined,
            hasLining: product.variations.some((v: any) => v.hasLining),
            variationCount: productVariationCount,
            skuCount: productSkuCount,
            totalStock: productStock,
            avgMrp: avgMrp,
            trimsCost: product.trimsCost ? Number(product.trimsCost) : null,
            liningCost: product.liningCost ? Number(product.liningCost) : null,
            packagingCost: product.packagingCost ? Number(product.packagingCost) : null,
            laborMinutes: product.baseProductionTimeMins ? Number(product.baseProductionTimeMins) : null,
            children: variationChildren,
        };
    });

    res.json({
        items,
        summary: {
            products: totalProducts,
            variations: totalVariations,
            skus: totalSkus,
            totalStock,
        },
    });
}));

// Get single product with full details
router.get('/:id', authenticateToken, asyncHandler(async (req: Request, res: Response) => {
    const id = req.params.id as string;
    const product = await req.prisma.product.findUnique({
        where: { id },
        include: productDetailInclude,
    });

    if (!product) {
        throw new NotFoundError('Product not found', 'Product', id);
    }

    // Filter confidential fields based on user permissions
    const filtered = filterConfidentialFields(product, req.userPermissions);
    res.json(filtered);
}));

// Create product
router.post('/', authenticateToken, requirePermission('products:edit'), asyncHandler(async (req: Request, res: Response) => {
    const { name, styleCode, category, productType, gender, fabricTypeId, baseProductionTimeMins, defaultFabricConsumption } = req.body as CreateProductBody;

    const product = await req.prisma.product.create({
        data: {
            name,
            styleCode: styleCode || null,
            category,
            productType,
            gender: gender || 'unisex',
            fabricTypeId: fabricTypeId || null,
            baseProductionTimeMins: baseProductionTimeMins || 60,
            defaultFabricConsumption: defaultFabricConsumption || null,
        },
        include: { fabricType: true },
    });

    res.status(201).json(product);
}));

// Update product
router.put('/:id', authenticateToken, requirePermission('products:edit'), asyncHandler(async (req: Request, res: Response) => {
    const id = req.params.id as string;
    const { name, styleCode, category, productType, gender, fabricTypeId, baseProductionTimeMins, defaultFabricConsumption, trimsCost, liningCost, packagingCost, isActive } = req.body as UpdateProductBody;

    const product = await req.prisma.product.update({
        where: { id },
        data: {
            name,
            styleCode: styleCode || null,
            category,
            productType,
            gender,
            fabricTypeId,
            baseProductionTimeMins,
            defaultFabricConsumption,
            trimsCost: trimsCost !== undefined ? trimsCost : undefined,
            liningCost: liningCost !== undefined ? liningCost : undefined,
            packagingCost: packagingCost !== undefined ? packagingCost : undefined,
            isActive,
        },
        include: { fabricType: true },
    });

    // Note: We no longer auto-reset variation fabrics when product fabric type changes.
    // Variations keep their existing fabric assignments. Users can update fabrics separately.

    res.json(product);
}));

// Delete product (soft delete)
router.delete('/:id', authenticateToken, requirePermission('products:delete'), asyncHandler(async (req: Request, res: Response) => {
    const id = req.params.id as string;
    await req.prisma.product.update({
        where: { id },
        data: { isActive: false },
    });

    res.json({ message: 'Product deactivated' });
}));

// ============================================
// VARIATIONS
// ============================================

/**
 * POST /:productId/variations
 * Create color variation for a product.
 *
 * @param {string} productId - Parent product ID (route param)
 * @param {string} colorName - Display name (e.g., "Maroon")
 * @param {string} [standardColor] - Standardized color name for grouping
 * @param {string} colorHex - Hex color code
 * @param {string} fabricId - Fabric ID (must match product's fabricType)
 * @param {boolean} [hasLining=false] - Whether variation uses lining
 * @returns {Object} Created variation with fabric relation
 */
router.post('/:productId/variations', authenticateToken, asyncHandler(async (req: Request, res: Response) => {
    const productId = req.params.productId as string;
    const { colorName, standardColor, colorHex, fabricId, hasLining } = req.body as CreateVariationBody;

    const variation = await req.prisma.variation.create({
        data: {
            productId,
            colorName,
            standardColor: standardColor || null,
            colorHex,
            fabricId,
            hasLining: hasLining || false,
        },
        include: { fabric: true },
    });

    res.status(201).json(variation);
}));

/**
 * PUT /variations/:id
 * Update variation details. Auto-syncs Product.fabricTypeId when fabric changes.
 *
 * @param {string} [colorName] - Display name
 * @param {string} [standardColor] - Standardized color name
 * @param {string} [colorHex] - Hex color code
 * @param {string} [fabricId] - Fabric ID (triggers Product sync if non-Default)
 * @param {boolean} [hasLining] - Whether variation uses lining
 * @param {number} [trimsCost] - Override trims cost (null = inherit from Product)
 * @param {number} [liningCost] - Override lining cost (null = inherit from Product)
 * @param {number} [packagingCost] - Override packaging cost
 * @param {number} [laborMinutes] - Override labor time
 * @param {boolean} [isActive] - Active status
 * @returns {Object} Updated variation
 *
 * Side Effect: If fabricId changes to non-Default type, Product.fabricTypeId is updated
 */
router.put('/variations/:id', authenticateToken, asyncHandler(async (req: Request, res: Response) => {
    const id = req.params.id as string;
    const { colorName, standardColor, colorHex, fabricId, hasLining, trimsCost, liningCost, packagingCost, laborMinutes, isActive } = req.body as UpdateVariationBody;

    const variation = await req.prisma.variation.update({
        where: { id },
        data: {
            colorName,
            standardColor: standardColor || null,
            colorHex,
            fabricId,
            hasLining,
            trimsCost: trimsCost !== undefined ? trimsCost : undefined,
            liningCost: liningCost !== undefined ? liningCost : undefined,
            packagingCost: packagingCost !== undefined ? packagingCost : undefined,
            laborMinutes: laborMinutes !== undefined ? laborMinutes : undefined,
            isActive,
        },
        include: variationDetailInclude,
    });

    // Sync product's fabricType when variation's fabric changes
    // If the new fabric has a non-Default type, update the product to match
    if (fabricId && variation.fabric?.fabricTypeId) {
        const isDefaultType = variation.fabric.fabricType?.name === 'Default';
        if (!isDefaultType && variation.product.fabricTypeId !== variation.fabric.fabricTypeId) {
            await req.prisma.product.update({
                where: { id: variation.product.id },
                data: { fabricTypeId: variation.fabric.fabricTypeId },
            });
        }
    }

    res.json(variation);
}));

// ============================================
// SKUS
// ============================================

// Get all SKUs with details (flat list)
router.get('/skus/all', authenticateToken, asyncHandler(async (req: Request, res: Response) => {
    const { search, isActive } = req.query as SKUListQuery;

    const where: Prisma.SkuWhereInput = {};
    if (isActive !== undefined) where.isActive = isActive === 'true';
    if (search) {
        where.OR = [
            { skuCode: { contains: search, mode: 'insensitive' } },
            { variation: { product: { name: { contains: search, mode: 'insensitive' } } } },
        ];
    }

    const skus = await req.prisma.sku.findMany({
        where,
        include: skuListInclude,
        orderBy: { skuCode: 'asc' },
    });

    // Filter confidential fields based on user permissions
    const filtered = filterConfidentialFields(skus, req.userPermissions);
    res.json(filtered);
}));

/**
 * POST /variations/:variationId/skus
 * Create SKU (size-specific sellable unit) for a variation.
 *
 * @param {string} variationId - Parent variation ID (route param)
 * @param {string} skuCode - Unique SKU code (also used as barcode)
 * @param {string} size - Size (e.g., "M", "L", "XL")
 * @param {number} [fabricConsumption=1.5] - Meters of fabric per unit
 * @param {number} mrp - Maximum Retail Price
 * @param {number} [targetStockQty=10] - Target inventory level
 * @param {string} [targetStockMethod='day14'] - Replenishment calculation method
 * @returns {Object} Created SKU
 */
router.post('/variations/:variationId/skus', authenticateToken, asyncHandler(async (req: Request, res: Response) => {
    const variationId = req.params.variationId as string;
    const { skuCode, size, fabricConsumption, mrp, targetStockQty, targetStockMethod } = req.body as CreateSKUBody;

    const sku = await req.prisma.sku.create({
        data: {
            variationId,
            skuCode,
            size,
            fabricConsumption: fabricConsumption || 1.5,
            mrp,
            targetStockQty: targetStockQty || 10,
            targetStockMethod: targetStockMethod || 'day14',
        },
    });

    res.status(201).json(sku);
}));

/**
 * PUT /skus/:id
 * Update SKU details. Cost fields use costing cascade (null = inherit from Variation/Product).
 *
 * @param {number} [fabricConsumption] - Meters of fabric per unit
 * @param {number} [mrp] - Maximum Retail Price
 * @param {number} [targetStockQty] - Target inventory level
 * @param {string} [targetStockMethod] - Replenishment method
 * @param {number} [trimsCost] - Override trims cost (null = inherit)
 * @param {number} [liningCost] - Override lining cost (null = inherit)
 * @param {number} [packagingCost] - Override packaging cost (null = inherit)
 * @param {number} [laborMinutes] - Override labor time (null = inherit)
 * @param {boolean} [isActive] - Active status
 * @returns {Object} Updated SKU
 */
router.put('/skus/:id', authenticateToken, asyncHandler(async (req: Request, res: Response) => {
    const id = req.params.id as string;
    const { fabricConsumption, mrp, targetStockQty, targetStockMethod, trimsCost, liningCost, packagingCost, laborMinutes, isActive } = req.body as UpdateSKUBody;

    const sku = await req.prisma.sku.update({
        where: { id },
        data: {
            fabricConsumption,
            mrp,
            targetStockQty,
            targetStockMethod,
            trimsCost: trimsCost !== undefined ? trimsCost : undefined,
            liningCost: liningCost !== undefined ? liningCost : undefined,
            packagingCost: packagingCost !== undefined ? packagingCost : undefined,
            laborMinutes: laborMinutes !== undefined ? laborMinutes : undefined,
            isActive,
        },
    });

    res.json(sku);
}));

export default router;
