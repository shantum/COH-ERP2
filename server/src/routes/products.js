/**
 * @fileoverview Product Catalog Routes - Manages product hierarchy (Product → Variation → SKU)
 *
 * Product Hierarchy:
 * - Product: Base template (e.g., "Kurti") with production time and fabric type
 * - Variation: Color variant (e.g., "Red Kurti") linked to specific fabric
 * - SKU: Size-specific item (e.g., "Red Kurti - M") with unique barcode
 *
 * Costing Cascade (SKU → Variation → Product → Global):
 * - Each level can override costs; null = inherit from next level
 * - Fabric consumption: SKU.fabricConsumption → Product.defaultFabricConsumption → 1.5
 * - Labor/Packaging: SKU → Variation → Product → CostConfig defaults
 * - Lining cost: Only non-null when hasLining=true
 *
 * Key Gotchas:
 * - Route order matters: /cost-config must be before /:id
 * - Changing Product.fabricTypeId resets all Variations to Default fabric
 * - Changing Variation.fabricId syncs Product.fabricTypeId if non-Default
 * - COGS endpoint uses costing cascade for final calculations
 */

import { Router } from 'express';
import { authenticateToken } from '../middleware/auth.js';
import { requirePermission, filterConfidentialFields } from '../middleware/permissions.js';
import { asyncHandler } from '../middleware/asyncHandler.js';
import { NotFoundError, ValidationError } from '../utils/errors.js';

const router = Router();

// Get all products with variations and SKUs
router.get('/', authenticateToken, asyncHandler(async (req, res) => {
    const { category, productType, isActive, search } = req.query;

    const where = {};
    if (category) where.category = category;
    if (productType) where.productType = productType;
    if (isActive !== undefined) where.isActive = isActive === 'true';
    if (search) {
        where.name = { contains: search, mode: 'insensitive' };
    }

    const products = await req.prisma.product.findMany({
        where,
        include: {
            fabricType: true,
            variations: {
                include: {
                    fabric: true,
                    skus: true,
                },
            },
        },
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
router.get('/cost-config', authenticateToken, asyncHandler(async (req, res) => {
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
router.put('/cost-config', authenticateToken, requirePermission('products:edit:cost'), asyncHandler(async (req, res) => {
    const { laborRatePerMin, defaultPackagingCost, gstThreshold, gstRateAbove, gstRateBelow } = req.body;

    let config = await req.prisma.costConfig.findFirst();

    // Build update data with only provided fields
    const updateData = { lastUpdated: new Date() };
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
 * - packagingCost: SKU.skuCosting → CostConfig.defaultPackagingCost (50)
 * - otherCost: SKU.skuCosting → 0
 *
 * @returns {Array<Object>} Array of COGS data with breakdown per SKU
 */
router.get('/cogs', authenticateToken, asyncHandler(async (req, res) => {
    const costConfig = await req.prisma.costConfig.findFirst();
    const laborRatePerMin = costConfig?.laborRatePerMin || 2.5;
    const defaultPackagingCost = costConfig?.defaultPackagingCost || 50;

    const skus = await req.prisma.sku.findMany({
        where: { isActive: true },
        include: {
            variation: {
                include: {
                    product: true,
                    fabric: true,
                },
            },
            skuCosting: true,
        },
    });

    const cogsData = skus.map((sku) => {
        const fabricCost = Number(sku.fabricConsumption) * Number(sku.variation.fabric.costPerUnit);
        const laborMins = sku.variation.product.baseProductionTimeMins;
        const laborCost = laborMins * Number(laborRatePerMin);
        const packagingCost = sku.skuCosting?.packagingCost || defaultPackagingCost;
        const otherCost = sku.skuCosting?.otherCost || 0;
        const totalCogs = fabricCost + laborCost + Number(packagingCost) + Number(otherCost);
        const mrp = Number(sku.mrp);
        const grossMargin = mrp - totalCogs;
        const marginPct = mrp > 0 ? ((grossMargin / mrp) * 100).toFixed(1) : 0;

        return {
            skuId: sku.id,
            skuCode: sku.skuCode,
            productName: sku.variation.product.name,
            colorName: sku.variation.colorName,
            size: sku.size,
            fabricConsumption: sku.fabricConsumption,
            fabricRate: sku.variation.fabric.costPerUnit,
            fabricCost: fabricCost.toFixed(2),
            laborMins,
            laborRatePerMin: laborRatePerMin,
            laborCost: laborCost.toFixed(2),
            packagingCost: Number(packagingCost).toFixed(2),
            otherCost: Number(otherCost).toFixed(2),
            totalCogs: totalCogs.toFixed(2),
            mrp: mrp.toFixed(2),
            grossMargin: grossMargin.toFixed(2),
            marginPct,
        };
    });

    // Filter confidential fields based on user permissions
    const filtered = filterConfidentialFields(cogsData, req.userPermissions);
    res.json(filtered);
}));

// Get single product with full details
router.get('/:id', authenticateToken, asyncHandler(async (req, res) => {
    const product = await req.prisma.product.findUnique({
        where: { id: req.params.id },
        include: {
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
        },
    });

    if (!product) {
        throw new NotFoundError('Product not found', 'Product', req.params.id);
    }

    // Filter confidential fields based on user permissions
    const filtered = filterConfidentialFields(product, req.userPermissions);
    res.json(filtered);
}));

// Create product
router.post('/', authenticateToken, requirePermission('products:edit'), asyncHandler(async (req, res) => {
    const { name, styleCode, category, productType, gender, fabricTypeId, baseProductionTimeMins, defaultFabricConsumption } = req.body;

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
router.put('/:id', authenticateToken, requirePermission('products:edit'), asyncHandler(async (req, res) => {
    const { name, styleCode, category, productType, gender, fabricTypeId, baseProductionTimeMins, defaultFabricConsumption, trimsCost, liningCost, packagingCost, isActive } = req.body;

    // Get current product with variations to check if fabricTypeId is changing
    const currentProduct = await req.prisma.product.findUnique({
        where: { id: req.params.id },
        select: {
            fabricTypeId: true,
            variations: {
                select: {
                    id: true,
                    fabric: {
                        select: { colorName: true },
                    },
                },
            },
        },
    });

    const fabricTypeChanged = fabricTypeId && currentProduct?.fabricTypeId !== fabricTypeId;

    const product = await req.prisma.product.update({
        where: { id: req.params.id },
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

    // If fabric type changed at product level, reset all variation fabrics to Default
    if (fabricTypeChanged && currentProduct?.variations?.length > 0) {
        // Get the Default fabric
        const defaultFabric = await req.prisma.fabric.findFirst({
            where: { fabricType: { name: 'Default' } },
            select: { id: true },
        });

        if (defaultFabric) {
            // Reset all variations to Default fabric
            await req.prisma.variation.updateMany({
                where: { productId: req.params.id },
                data: { fabricId: defaultFabric.id },
            });
        }
    }

    res.json(product);
}));

// Delete product (soft delete)
router.delete('/:id', authenticateToken, requirePermission('products:delete'), asyncHandler(async (req, res) => {
    await req.prisma.product.update({
        where: { id: req.params.id },
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
router.post('/:productId/variations', authenticateToken, asyncHandler(async (req, res) => {
    const { colorName, standardColor, colorHex, fabricId, hasLining } = req.body;

    const variation = await req.prisma.variation.create({
        data: {
            productId: req.params.productId,
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
router.put('/variations/:id', authenticateToken, asyncHandler(async (req, res) => {
    const { colorName, standardColor, colorHex, fabricId, hasLining, trimsCost, liningCost, packagingCost, laborMinutes, isActive } = req.body;

    const variation = await req.prisma.variation.update({
        where: { id: req.params.id },
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
        include: {
            fabric: { include: { fabricType: true } },
            product: { select: { id: true, fabricTypeId: true } },
        },
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
router.get('/skus/all', authenticateToken, asyncHandler(async (req, res) => {
    const { search, isActive } = req.query;

    const where = {};
    if (isActive !== undefined) where.isActive = isActive === 'true';
    if (search) {
        where.OR = [
            { skuCode: { contains: search, mode: 'insensitive' } },
            { variation: { product: { name: { contains: search, mode: 'insensitive' } } } },
        ];
    }

    const skus = await req.prisma.sku.findMany({
        where,
        include: {
            variation: {
                include: {
                    product: true,
                    fabric: true,
                },
            },
            skuCosting: true,
        },
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
router.post('/variations/:variationId/skus', authenticateToken, asyncHandler(async (req, res) => {
    const { skuCode, size, fabricConsumption, mrp, targetStockQty, targetStockMethod } = req.body;

    const sku = await req.prisma.sku.create({
        data: {
            variationId: req.params.variationId,
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
router.put('/skus/:id', authenticateToken, asyncHandler(async (req, res) => {
    const { fabricConsumption, mrp, targetStockQty, targetStockMethod, trimsCost, liningCost, packagingCost, laborMinutes, isActive } = req.body;

    const sku = await req.prisma.sku.update({
        where: { id: req.params.id },
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
