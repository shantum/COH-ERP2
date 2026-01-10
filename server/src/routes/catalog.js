/**
 * Catalog Router
 * Combined product + inventory view endpoints
 */

import { Router } from 'express';
import { authenticateToken } from '../middleware/auth.js';
import { calculateAllInventoryBalances } from '../utils/queryPatterns.js';

const router = Router();

// Size sort order for proper sorting (XS -> S -> M -> L -> XL -> 2XL -> etc)
const SIZE_ORDER = ['XS', 'S', 'M', 'L', 'XL', '2XL', '3XL', '4XL', 'Free'];
const getSizeIndex = (size) => {
    const idx = SIZE_ORDER.indexOf(size);
    return idx === -1 ? 999 : idx; // Unknown sizes go to end
};

/**
 * GET /sku-inventory
 * Returns flat array of all SKUs with product hierarchy and inventory data
 * Supports filtering by gender, category, productId, status, search
 */
router.get('/sku-inventory', authenticateToken, async (req, res) => {
    try {
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
        const skuWhere = {
            isActive: true,
            isCustomSku: false, // Exclude custom SKUs from catalog view
        };

        // Add variation/product filters
        const variationWhere = {};
        const productWhere = {};

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
        });

        // Calculate all inventory balances in single batch query
        const skuIds = skus.map(sku => sku.id);
        const balanceMap = await calculateAllInventoryBalances(req.prisma, skuIds, {
            excludeCustomSkus: true,
        });

        // Fetch global cost config for default packaging cost
        const costConfig = await req.prisma.costConfig.findFirst();
        const globalPackagingCost = costConfig?.defaultPackagingCost || 50;

        // Batch fetch Shopify product cache for status lookup
        const shopifyProductIds = [...new Set(
            skus.map(sku => sku.variation.product.shopifyProductId).filter(Boolean)
        )];
        const shopifyStatusMap = new Map();
        if (shopifyProductIds.length > 0) {
            const shopifyCache = await req.prisma.shopifyProductCache.findMany({
                where: { id: { in: shopifyProductIds } },
                select: { id: true, rawData: true },
            });
            shopifyCache.forEach(cache => {
                try {
                    const data = JSON.parse(cache.rawData);
                    shopifyStatusMap.set(cache.id, data.status || 'unknown');
                } catch {
                    shopifyStatusMap.set(cache.id, 'unknown');
                }
            });
        }

        // Map to flat response structure
        let items = skus.map((sku) => {
            const balance = balanceMap.get(sku.id) || {
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

            // Cascade packaging cost: SKU -> Variation -> Product -> Global default
            const effectivePackagingCost = sku.packagingCost ?? variation.packagingCost ?? product.packagingCost ?? globalPackagingCost;

            // Calculate fabric cost and total cost
            const fabricCostPerUnit = variation.fabric?.costPerUnit ? Number(variation.fabric.costPerUnit) : 0;
            const fabricCost = sku.fabricConsumption ? Number(sku.fabricConsumption) * fabricCostPerUnit : 0;
            const totalCost = fabricCost + (effectiveTrimsCost || 0) + effectivePackagingCost;

            return {
                // SKU identifiers
                skuId: sku.id,
                skuCode: sku.skuCode,
                size: sku.size,
                mrp: sku.mrp,
                fabricConsumption: sku.fabricConsumption,
                trimsCost: effectiveTrimsCost,
                packagingCost: effectivePackagingCost,
                // Raw values for editing (to know where override exists)
                skuTrimsCost: sku.trimsCost,
                variationTrimsCost: variation.trimsCost,
                productTrimsCost: product.trimsCost,
                skuPackagingCost: sku.packagingCost,
                variationPackagingCost: variation.packagingCost,
                productPackagingCost: product.packagingCost,
                globalPackagingCost,
                // Costing
                fabricCostPerUnit,
                fabricCost: fabricCost > 0 ? Math.round(fabricCost * 100) / 100 : null,
                totalCost: totalCost > 0 ? Math.round(totalCost * 100) / 100 : null,
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
                styleCode: product.styleCode,
                category: product.category,
                gender: product.gender,
                productType: product.productType,
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
                targetStockQty: sku.targetStockQty,
                status: balance.availableBalance < sku.targetStockQty ? 'below_target' : 'ok',
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

        res.json({
            items,
            pagination: {
                total: totalCount,
                limit: Number(limit),
                offset: Number(offset),
                hasMore: Number(offset) + items.length < totalCount,
            },
        });
    } catch (error) {
        console.error('Get catalog SKU inventory error:', error);
        res.status(500).json({ error: 'Failed to fetch catalog data' });
    }
});

/**
 * GET /filters
 * Returns filter options for the catalog (genders, categories, products, fabric types, fabrics)
 */
router.get('/filters', authenticateToken, async (req, res) => {
    try {
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
        const genders = [...new Set(products.map(p => p.gender))].filter(Boolean).sort();
        const categories = [...new Set(products.map(p => p.category))].filter(Boolean).sort();

        res.json({
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
        });
    } catch (error) {
        console.error('Get catalog filters error:', error);
        res.status(500).json({ error: 'Failed to fetch filter options' });
    }
});

export default router;
