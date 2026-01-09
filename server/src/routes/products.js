import { Router } from 'express';
import { authenticateToken } from '../middleware/auth.js';

const router = Router();

// Get all products with variations and SKUs
router.get('/', authenticateToken, async (req, res) => {
    try {
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

        res.json(products);
    } catch (error) {
        console.error('Get products error:', error);
        res.status(500).json({ error: 'Failed to fetch products' });
    }
});

// Get single product with full details
router.get('/:id', authenticateToken, async (req, res) => {
    try {
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
            return res.status(404).json({ error: 'Product not found' });
        }

        res.json(product);
    } catch (error) {
        console.error('Get product error:', error);
        res.status(500).json({ error: 'Failed to fetch product' });
    }
});

// Create product
router.post('/', authenticateToken, async (req, res) => {
    try {
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
    } catch (error) {
        console.error('Create product error:', error);
        res.status(500).json({ error: 'Failed to create product' });
    }
});

// Update product
router.put('/:id', authenticateToken, async (req, res) => {
    try {
        const { name, styleCode, category, productType, gender, fabricTypeId, baseProductionTimeMins, defaultFabricConsumption, isActive } = req.body;

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
    } catch (error) {
        console.error('Update product error:', error);
        res.status(500).json({ error: 'Failed to update product' });
    }
});

// Delete product (soft delete)
router.delete('/:id', authenticateToken, async (req, res) => {
    try {
        await req.prisma.product.update({
            where: { id: req.params.id },
            data: { isActive: false },
        });

        res.json({ message: 'Product deactivated' });
    } catch (error) {
        console.error('Delete product error:', error);
        res.status(500).json({ error: 'Failed to delete product' });
    }
});

// ============================================
// VARIATIONS
// ============================================

// Create variation
router.post('/:productId/variations', authenticateToken, async (req, res) => {
    try {
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
    } catch (error) {
        console.error('Create variation error:', error);
        res.status(500).json({ error: 'Failed to create variation' });
    }
});

// Update variation
router.put('/variations/:id', authenticateToken, async (req, res) => {
    try {
        const { colorName, standardColor, colorHex, fabricId, hasLining, isActive } = req.body;

        const variation = await req.prisma.variation.update({
            where: { id: req.params.id },
            data: { colorName, standardColor: standardColor || null, colorHex, fabricId, hasLining, isActive },
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
    } catch (error) {
        console.error('Update variation error:', error);
        res.status(500).json({ error: 'Failed to update variation' });
    }
});

// ============================================
// SKUS
// ============================================

// Get all SKUs with details (flat list)
router.get('/skus/all', authenticateToken, async (req, res) => {
    try {
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

        res.json(skus);
    } catch (error) {
        console.error('Get SKUs error:', error);
        res.status(500).json({ error: 'Failed to fetch SKUs' });
    }
});

// Create SKU
router.post('/variations/:variationId/skus', authenticateToken, async (req, res) => {
    try {
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
    } catch (error) {
        console.error('Create SKU error:', error);
        res.status(500).json({ error: 'Failed to create SKU' });
    }
});

// Update SKU
router.put('/skus/:id', authenticateToken, async (req, res) => {
    try {
        const { fabricConsumption, mrp, targetStockQty, targetStockMethod, isActive } = req.body;

        const sku = await req.prisma.sku.update({
            where: { id: req.params.id },
            data: { fabricConsumption, mrp, targetStockQty, targetStockMethod, isActive },
        });

        res.json(sku);
    } catch (error) {
        console.error('Update SKU error:', error);
        res.status(500).json({ error: 'Failed to update SKU' });
    }
});

// ============================================
// COGS
// ============================================

// Get COGS for all SKUs
router.get('/cogs', authenticateToken, async (req, res) => {
    try {
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

        res.json(cogsData);
    } catch (error) {
        console.error('Get COGS error:', error);
        res.status(500).json({ error: 'Failed to fetch COGS data' });
    }
});

// Update cost config
router.put('/cost-config', authenticateToken, async (req, res) => {
    try {
        const { laborRatePerMin, defaultPackagingCost } = req.body;

        let config = await req.prisma.costConfig.findFirst();

        if (config) {
            config = await req.prisma.costConfig.update({
                where: { id: config.id },
                data: { laborRatePerMin, defaultPackagingCost, lastUpdated: new Date() },
            });
        } else {
            config = await req.prisma.costConfig.create({
                data: { laborRatePerMin, defaultPackagingCost },
            });
        }

        res.json(config);
    } catch (error) {
        console.error('Update cost config error:', error);
        res.status(500).json({ error: 'Failed to update cost config' });
    }
});

export default router;
