import { Router } from 'express';
import { authenticateToken } from '../middleware/auth.js';

const router = Router();

// Get all products with variations and SKUs
router.get('/', async (req, res) => {
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
router.get('/:id', async (req, res) => {
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
        const { colorName, standardColor, colorHex, fabricId } = req.body;

        const variation = await req.prisma.variation.create({
            data: {
                productId: req.params.productId,
                colorName,
                standardColor: standardColor || null,
                colorHex,
                fabricId,
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
        const { colorName, standardColor, colorHex, fabricId, isActive } = req.body;

        const variation = await req.prisma.variation.update({
            where: { id: req.params.id },
            data: { colorName, standardColor: standardColor || null, colorHex, fabricId, isActive },
            include: { fabric: true },
        });

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
router.get('/skus/all', async (req, res) => {
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
        const { skuCode, size, fabricConsumption, mrp, targetStockQty, targetStockMethod, barcode } = req.body;

        // Check for duplicate barcode
        if (barcode && barcode.trim()) {
            const existingBarcode = await req.prisma.sku.findFirst({
                where: { barcode: barcode.trim() },
            });
            if (existingBarcode) {
                return res.status(400).json({ error: `Barcode ${barcode} is already in use by SKU ${existingBarcode.skuCode}` });
            }
        }

        const sku = await req.prisma.sku.create({
            data: {
                variationId: req.params.variationId,
                skuCode,
                size,
                fabricConsumption: fabricConsumption || 1.5,
                mrp,
                targetStockQty: targetStockQty || 10,
                targetStockMethod: targetStockMethod || 'day14',
                barcode: barcode?.trim() || null,
            },
        });

        res.status(201).json(sku);
    } catch (error) {
        console.error('Create SKU error:', error);
        if (error.code === 'P2002' && error.meta?.target?.includes('barcode')) {
            return res.status(400).json({ error: 'This barcode is already in use' });
        }
        res.status(500).json({ error: 'Failed to create SKU' });
    }
});

// Update SKU
router.put('/skus/:id', authenticateToken, async (req, res) => {
    try {
        const { fabricConsumption, mrp, targetStockQty, targetStockMethod, isActive, barcode } = req.body;

        // Convert empty barcode to null to avoid unique constraint issues
        const sanitizedBarcode = barcode && barcode.trim() ? barcode.trim() : null;

        // Check for duplicate barcode (excluding current SKU)
        if (sanitizedBarcode) {
            const existingBarcode = await req.prisma.sku.findFirst({
                where: {
                    barcode: sanitizedBarcode,
                    NOT: { id: req.params.id }
                },
            });
            if (existingBarcode) {
                return res.status(400).json({ error: `Barcode ${sanitizedBarcode} is already in use by SKU ${existingBarcode.skuCode}` });
            }
        }

        const sku = await req.prisma.sku.update({
            where: { id: req.params.id },
            data: { fabricConsumption, mrp, targetStockQty, targetStockMethod, isActive, barcode: sanitizedBarcode },
        });

        res.json(sku);
    } catch (error) {
        console.error('Update SKU error:', error);
        if (error.code === 'P2002' && error.meta?.target?.includes('barcode')) {
            return res.status(400).json({ error: 'This barcode is already in use' });
        }
        res.status(500).json({ error: 'Failed to update SKU' });
    }
});

// ============================================
// COGS
// ============================================

// Get COGS for all SKUs
router.get('/cogs', async (req, res) => {
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
