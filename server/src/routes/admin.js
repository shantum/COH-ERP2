import { Router } from 'express';
import { authenticateToken } from '../middleware/auth.js';

const router = Router();

// Get database stats
router.get('/stats', authenticateToken, async (req, res) => {
    try {
        const [
            productCount,
            variationCount,
            skuCount,
            orderCount,
            customerCount,
            fabricCount,
            inventoryTxnCount,
        ] = await Promise.all([
            req.prisma.product.count(),
            req.prisma.variation.count(),
            req.prisma.sku.count(),
            req.prisma.order.count(),
            req.prisma.customer.count(),
            req.prisma.fabric.count(),
            req.prisma.inventoryTransaction.count(),
        ]);

        res.json({
            products: productCount,
            variations: variationCount,
            skus: skuCount,
            orders: orderCount,
            customers: customerCount,
            fabrics: fabricCount,
            inventoryTransactions: inventoryTxnCount,
        });
    } catch (error) {
        console.error('Get stats error:', error);
        res.status(500).json({ error: 'Failed to get database stats' });
    }
});

// Clear specific tables
router.post('/clear', authenticateToken, async (req, res) => {
    try {
        const { tables, confirmPhrase } = req.body;

        // Require confirmation phrase
        if (confirmPhrase !== 'DELETE ALL DATA') {
            return res.status(400).json({ error: 'Invalid confirmation phrase' });
        }

        if (!tables || !Array.isArray(tables) || tables.length === 0) {
            return res.status(400).json({ error: 'No tables specified' });
        }

        const results = {};

        // Clear in correct order to respect foreign key constraints
        const clearOrder = [
            'returnRequestLines',
            'returnRequests',
            'orderLines',
            'orders',
            'inventoryTransactions',
            'productInventory',
            'skuCostings',
            'shopifyInventoryCache',
            'skus',
            'variations',
            'products',
            'customers',
            'fabricInventory',
            'fabrics',
            'fabricTypes',
            'productionBatches',
            'tailors',
            'feedback',
            'stockAlerts',
        ];

        for (const table of clearOrder) {
            if (tables.includes(table) || tables.includes('all')) {
                try {
                    let count = 0;
                    switch (table) {
                        case 'returnRequestLines':
                            count = await req.prisma.returnRequestLine.count();
                            await req.prisma.returnRequestLine.deleteMany();
                            break;
                        case 'returnRequests':
                            count = await req.prisma.returnRequest.count();
                            await req.prisma.returnRequest.deleteMany();
                            break;
                        case 'orderLines':
                            count = await req.prisma.orderLine.count();
                            await req.prisma.orderLine.deleteMany();
                            break;
                        case 'orders':
                            count = await req.prisma.order.count();
                            await req.prisma.order.deleteMany();
                            break;
                        case 'inventoryTransactions':
                            count = await req.prisma.inventoryTransaction.count();
                            await req.prisma.inventoryTransaction.deleteMany();
                            break;
                        case 'productInventory':
                            count = await req.prisma.productInventory.count();
                            await req.prisma.productInventory.deleteMany();
                            break;
                        case 'skuCostings':
                            count = await req.prisma.skuCosting.count();
                            await req.prisma.skuCosting.deleteMany();
                            break;
                        case 'shopifyInventoryCache':
                            count = await req.prisma.shopifyInventoryCache.count();
                            await req.prisma.shopifyInventoryCache.deleteMany();
                            break;
                        case 'skus':
                            count = await req.prisma.sku.count();
                            await req.prisma.sku.deleteMany();
                            break;
                        case 'variations':
                            count = await req.prisma.variation.count();
                            await req.prisma.variation.deleteMany();
                            break;
                        case 'products':
                            count = await req.prisma.product.count();
                            await req.prisma.product.deleteMany();
                            break;
                        case 'customers':
                            count = await req.prisma.customer.count();
                            await req.prisma.customer.deleteMany();
                            break;
                        case 'fabricInventory':
                            count = await req.prisma.fabricInventory.count();
                            await req.prisma.fabricInventory.deleteMany();
                            break;
                        case 'fabrics':
                            count = await req.prisma.fabric.count();
                            await req.prisma.fabric.deleteMany();
                            break;
                        case 'fabricTypes':
                            count = await req.prisma.fabricType.count();
                            await req.prisma.fabricType.deleteMany();
                            break;
                        case 'productionBatches':
                            count = await req.prisma.productionBatch.count();
                            await req.prisma.productionBatch.deleteMany();
                            break;
                        case 'tailors':
                            count = await req.prisma.tailor.count();
                            await req.prisma.tailor.deleteMany();
                            break;
                        case 'feedback':
                            count = await req.prisma.feedback.count();
                            await req.prisma.feedback.deleteMany();
                            break;
                        case 'stockAlerts':
                            count = await req.prisma.stockAlert.count();
                            await req.prisma.stockAlert.deleteMany();
                            break;
                    }
                    results[table] = count;
                } catch (tableError) {
                    results[table] = `Error: ${tableError.message}`;
                }
            }
        }

        res.json({
            message: 'Database cleared',
            deleted: results,
        });
    } catch (error) {
        console.error('Clear database error:', error);
        res.status(500).json({ error: 'Failed to clear database' });
    }
});

// Reset and reseed database
router.post('/reseed', authenticateToken, async (req, res) => {
    try {
        const { confirmPhrase } = req.body;

        if (confirmPhrase !== 'RESEED DATABASE') {
            return res.status(400).json({ error: 'Invalid confirmation phrase' });
        }

        // This would typically call your seed script
        // For now, just return instructions
        res.json({
            message: 'To reseed the database, run: npm run db:seed in the server directory',
            note: 'Automatic reseeding from API is disabled for safety',
        });
    } catch (error) {
        console.error('Reseed error:', error);
        res.status(500).json({ error: 'Failed to reseed database' });
    }
});

export default router;
