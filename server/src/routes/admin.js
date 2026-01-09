import { Router } from 'express';
import bcrypt from 'bcryptjs';
import { authenticateToken, requireAdmin } from '../middleware/auth.js';
import { validatePassword } from '../utils/validation.js';
import { DEFAULT_TIER_THRESHOLDS } from '../utils/tierUtils.js';
import logBuffer from '../utils/logBuffer.js';

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

// Clear specific tables (Admin only)
router.post('/clear', requireAdmin, async (req, res) => {
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

        // Use a transaction for PostgreSQL to ensure all deletes succeed or none do
        await req.prisma.$transaction(async (prisma) => {
            // Clear in correct order to respect foreign key constraints
            const deleteOperations = [
                // Return-related (references orders, SKUs)
                { name: 'returnStatusHistory', model: prisma.returnStatusHistory },
                { name: 'returnShipping', model: prisma.returnShipping },
                { name: 'returnRequestLines', model: prisma.returnRequestLine },
                { name: 'returnRequests', model: prisma.returnRequest },
                // Order-related (references customers, SKUs)
                { name: 'orderLines', model: prisma.orderLine },
                { name: 'orders', model: prisma.order },
                // Production (references SKUs)
                { name: 'productionBatches', model: prisma.productionBatch },
                // Inventory (references SKUs)
                { name: 'inventoryTransactions', model: prisma.inventoryTransaction },
                { name: 'shopifyInventoryCache', model: prisma.shopifyInventoryCache },
                { name: 'stockAlerts', model: prisma.stockAlert },
                // Feedback (references SKUs, products, variations)
                { name: 'feedbackProductLinks', model: prisma.feedbackProductLink },
                { name: 'feedbackMedia', model: prisma.feedbackMedia },
                { name: 'feedbackTags', model: prisma.feedbackTag },
                { name: 'feedbackContents', model: prisma.feedbackContent },
                { name: 'feedbackRatings', model: prisma.feedbackRating },
                { name: 'feedback', model: prisma.feedback },
                // SKU related
                { name: 'skuCostings', model: prisma.skuCosting },
                { name: 'skus', model: prisma.sku },
                // Variations and Products
                { name: 'variations', model: prisma.variation },
                { name: 'products', model: prisma.product },
                // Customers
                { name: 'customers', model: prisma.customer },
                // Fabric related
                { name: 'fabricTransactions', model: prisma.fabricTransaction },
                { name: 'fabricOrders', model: prisma.fabricOrder },
                { name: 'fabrics', model: prisma.fabric },
                { name: 'fabricTypes', model: prisma.fabricType },
                // Other
                { name: 'costConfigs', model: prisma.costConfig },
                { name: 'tailors', model: prisma.tailor },
                { name: 'suppliers', model: prisma.supplier },
            ];

            for (const { name, model } of deleteOperations) {
                if (tables.includes(name) || tables.includes('all')) {
                    try {
                        const count = await model.count();
                        await model.deleteMany();
                        results[name] = count;
                    } catch (tableError) {
                        console.error(`Error deleting ${name}:`, tableError.message);
                        results[name] = `Error: ${tableError.message}`;
                    }
                }
            }
        }, {
            timeout: 60000, // 60 second timeout for large deletes
        });

        res.json({
            message: 'Database cleared',
            deleted: results,
        });
    } catch (error) {
        console.error('Clear database error:', error);
        res.status(500).json({ error: `Failed to clear database: ${error.message}` });
    }
});

// Get order channels
router.get('/channels', authenticateToken, async (req, res) => {
    try {
        const setting = await req.prisma.systemSetting.findUnique({
            where: { key: 'order_channels' }
        });

        // Default channels if not configured
        const defaultChannels = [
            { id: 'offline', name: 'Offline' },
            { id: 'shopify', name: 'Shopify' },
            { id: 'nykaa', name: 'Nykaa' },
            { id: 'ajio', name: 'Ajio' },
            { id: 'myntra', name: 'Myntra' },
        ];

        const channels = setting?.value ? JSON.parse(setting.value) : defaultChannels;
        res.json(channels);
    } catch (error) {
        console.error('Get channels error:', error);
        res.status(500).json({ error: 'Failed to get channels' });
    }
});

// Update order channels
router.put('/channels', authenticateToken, async (req, res) => {
    try {
        const { channels } = req.body;

        if (!Array.isArray(channels)) {
            return res.status(400).json({ error: 'Channels must be an array' });
        }

        // Validate channel format
        for (const channel of channels) {
            if (!channel.id || !channel.name) {
                return res.status(400).json({ error: 'Each channel must have id and name' });
            }
        }

        await req.prisma.systemSetting.upsert({
            where: { key: 'order_channels' },
            update: { value: JSON.stringify(channels) },
            create: { key: 'order_channels', value: JSON.stringify(channels) }
        });

        res.json({ success: true, channels });
    } catch (error) {
        console.error('Update channels error:', error);
        res.status(500).json({ error: 'Failed to update channels' });
    }
});

// Get tier thresholds
router.get('/tier-thresholds', authenticateToken, async (req, res) => {
    try {
        const setting = await req.prisma.systemSetting.findUnique({
            where: { key: 'tier_thresholds' }
        });

        const thresholds = setting?.value ? JSON.parse(setting.value) : DEFAULT_TIER_THRESHOLDS;
        res.json(thresholds);
    } catch (error) {
        console.error('Get tier thresholds error:', error);
        res.status(500).json({ error: 'Failed to get tier thresholds' });
    }
});

// Update tier thresholds
router.put('/tier-thresholds', requireAdmin, async (req, res) => {
    try {
        const { platinum, gold, silver } = req.body;

        // Validate thresholds
        if (typeof platinum !== 'number' || typeof gold !== 'number' || typeof silver !== 'number') {
            return res.status(400).json({ error: 'All thresholds must be numbers' });
        }

        if (platinum <= gold || gold <= silver || silver <= 0) {
            return res.status(400).json({
                error: 'Thresholds must be: platinum > gold > silver > 0'
            });
        }

        const thresholds = { platinum, gold, silver };

        await req.prisma.systemSetting.upsert({
            where: { key: 'tier_thresholds' },
            update: { value: JSON.stringify(thresholds) },
            create: { key: 'tier_thresholds', value: JSON.stringify(thresholds) }
        });

        res.json({ success: true, thresholds });
    } catch (error) {
        console.error('Update tier thresholds error:', error);
        res.status(500).json({ error: 'Failed to update tier thresholds' });
    }
});

// Reset and reseed database (Admin only)
router.post('/reseed', requireAdmin, async (req, res) => {
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

// ============================================
// USER MANAGEMENT (Admin only)
// ============================================

// List all users
router.get('/users', requireAdmin, async (req, res) => {
    try {
        const users = await req.prisma.user.findMany({
            select: {
                id: true,
                email: true,
                name: true,
                role: true,
                isActive: true,
                createdAt: true,
            },
            orderBy: { createdAt: 'desc' },
        });
        res.json(users);
    } catch (error) {
        console.error('List users error:', error);
        res.status(500).json({ error: 'Failed to list users' });
    }
});

// Get single user
router.get('/users/:id', requireAdmin, async (req, res) => {
    try {
        const user = await req.prisma.user.findUnique({
            where: { id: req.params.id },
            select: {
                id: true,
                email: true,
                name: true,
                role: true,
                isActive: true,
                createdAt: true,
            },
        });

        if (!user) {
            return res.status(404).json({ error: 'User not found' });
        }

        res.json(user);
    } catch (error) {
        console.error('Get user error:', error);
        res.status(500).json({ error: 'Failed to get user' });
    }
});

// Create new user
router.post('/users', requireAdmin, async (req, res) => {
    try {
        const { email, password, name, role = 'staff' } = req.body;

        // Validate input
        if (!email || !password || !name) {
            return res.status(400).json({ error: 'Email, password, and name are required' });
        }

        // Validate password strength
        const passwordValidation = validatePassword(password);
        if (!passwordValidation.isValid) {
            return res.status(400).json({ error: passwordValidation.errors[0] });
        }

        // Validate role
        const validRoles = ['admin', 'staff'];
        if (!validRoles.includes(role)) {
            return res.status(400).json({ error: 'Invalid role. Must be admin or staff' });
        }

        // Check if email already exists
        const existing = await req.prisma.user.findUnique({ where: { email } });
        if (existing) {
            return res.status(400).json({ error: 'Email already in use' });
        }

        // Hash password
        const hashedPassword = await bcrypt.hash(password, 10);

        // Create user
        const user = await req.prisma.user.create({
            data: {
                email,
                password: hashedPassword,
                name,
                role,
            },
            select: {
                id: true,
                email: true,
                name: true,
                role: true,
                isActive: true,
                createdAt: true,
            },
        });

        res.status(201).json(user);
    } catch (error) {
        console.error('Create user error:', error);
        res.status(500).json({ error: 'Failed to create user' });
    }
});

// Update user
router.put('/users/:id', requireAdmin, async (req, res) => {
    try {
        const { email, name, role, isActive, password } = req.body;

        // Get existing user
        const existing = await req.prisma.user.findUnique({
            where: { id: req.params.id },
        });

        if (!existing) {
            return res.status(404).json({ error: 'User not found' });
        }

        // Prevent disabling the last admin
        if (existing.role === 'admin' && isActive === false) {
            const adminCount = await req.prisma.user.count({
                where: { role: 'admin', isActive: true },
            });
            if (adminCount <= 1) {
                return res.status(400).json({ error: 'Cannot disable the last admin user' });
            }
        }

        // Prevent changing role of last admin
        if (existing.role === 'admin' && role && role !== 'admin') {
            const adminCount = await req.prisma.user.count({
                where: { role: 'admin', isActive: true },
            });
            if (adminCount <= 1) {
                return res.status(400).json({ error: 'Cannot change role of the last admin user' });
            }
        }

        // Check email uniqueness if changing
        if (email && email !== existing.email) {
            const emailExists = await req.prisma.user.findUnique({ where: { email } });
            if (emailExists) {
                return res.status(400).json({ error: 'Email already in use' });
            }
        }

        // Build update data
        const updateData = {};
        if (email) updateData.email = email;
        if (name) updateData.name = name;
        if (role) updateData.role = role;
        if (typeof isActive === 'boolean') updateData.isActive = isActive;
        if (password) {
            const passwordValidation = validatePassword(password);
            if (!passwordValidation.isValid) {
                return res.status(400).json({ error: passwordValidation.errors[0] });
            }
            updateData.password = await bcrypt.hash(password, 10);
        }

        const user = await req.prisma.user.update({
            where: { id: req.params.id },
            data: updateData,
            select: {
                id: true,
                email: true,
                name: true,
                role: true,
                isActive: true,
                createdAt: true,
            },
        });

        res.json(user);
    } catch (error) {
        console.error('Update user error:', error);
        res.status(500).json({ error: 'Failed to update user' });
    }
});

// Delete user
router.delete('/users/:id', requireAdmin, async (req, res) => {
    try {
        const user = await req.prisma.user.findUnique({
            where: { id: req.params.id },
        });

        if (!user) {
            return res.status(404).json({ error: 'User not found' });
        }

        // Prevent deleting the last admin
        if (user.role === 'admin') {
            const adminCount = await req.prisma.user.count({
                where: { role: 'admin' },
            });
            if (adminCount <= 1) {
                return res.status(400).json({ error: 'Cannot delete the last admin user' });
            }
        }

        // Prevent self-deletion
        if (user.id === req.user.id) {
            return res.status(400).json({ error: 'Cannot delete your own account' });
        }

        await req.prisma.user.delete({
            where: { id: req.params.id },
        });

        res.json({ message: 'User deleted successfully' });
    } catch (error) {
        console.error('Delete user error:', error);
        res.status(500).json({ error: 'Failed to delete user' });
    }
});

// ============================================
// DATABASE INSPECTOR (Admin only)
// ============================================

// Inspect orders table
router.get('/inspect/orders', authenticateToken, async (req, res) => {
    try {
        const limit = Math.min(parseInt(req.query.limit) || 50, 5000);
        const offset = parseInt(req.query.offset) || 0;

        const [data, total] = await Promise.all([
            req.prisma.order.findMany({
                take: limit,
                skip: offset,
                orderBy: { createdAt: 'desc' },
                include: {
                    orderLines: {
                        include: { sku: { select: { skuCode: true } } }
                    },
                    customer: { select: { email: true, firstName: true, lastName: true } }
                }
            }),
            req.prisma.order.count()
        ]);

        res.json({ data, total, limit, offset });
    } catch (error) {
        console.error('Inspect orders error:', error);
        res.status(500).json({ error: 'Failed to inspect orders' });
    }
});

// Inspect customers table
router.get('/inspect/customers', authenticateToken, async (req, res) => {
    try {
        const limit = Math.min(parseInt(req.query.limit) || 50, 5000);
        const offset = parseInt(req.query.offset) || 0;

        const [data, total] = await Promise.all([
            req.prisma.customer.findMany({
                take: limit,
                skip: offset,
                orderBy: { createdAt: 'desc' }
            }),
            req.prisma.customer.count()
        ]);

        res.json({ data, total, limit, offset });
    } catch (error) {
        console.error('Inspect customers error:', error);
        res.status(500).json({ error: 'Failed to inspect customers' });
    }
});

// Inspect products table
router.get('/inspect/products', authenticateToken, async (req, res) => {
    try {
        const limit = Math.min(parseInt(req.query.limit) || 50, 5000);
        const offset = parseInt(req.query.offset) || 0;

        const [data, total] = await Promise.all([
            req.prisma.product.findMany({
                take: limit,
                skip: offset,
                orderBy: { createdAt: 'desc' },
                include: {
                    variations: {
                        include: { skus: true }
                    }
                }
            }),
            req.prisma.product.count()
        ]);

        res.json({ data, total, limit, offset });
    } catch (error) {
        console.error('Inspect products error:', error);
        res.status(500).json({ error: 'Failed to inspect products' });
    }
});

// Inspect SKUs table
router.get('/inspect/skus', authenticateToken, async (req, res) => {
    try {
        const limit = Math.min(parseInt(req.query.limit) || 50, 5000);
        const offset = parseInt(req.query.offset) || 0;

        const [data, total] = await Promise.all([
            req.prisma.sku.findMany({
                take: limit,
                skip: offset,
                orderBy: { createdAt: 'desc' },
                include: {
                    variation: {
                        include: { product: { select: { name: true, styleCode: true } } }
                    }
                }
            }),
            req.prisma.sku.count()
        ]);

        res.json({ data, total, limit, offset });
    } catch (error) {
        console.error('Inspect SKUs error:', error);
        res.status(500).json({ error: 'Failed to inspect SKUs' });
    }
});

// Inspect Shopify Order Cache table
router.get('/inspect/shopify-order-cache', authenticateToken, async (req, res) => {
    try {
        const limit = Math.min(parseInt(req.query.limit) || 50, 5000);
        const offset = parseInt(req.query.offset) || 0;

        const [data, total] = await Promise.all([
            req.prisma.shopifyOrderCache.findMany({
                take: limit,
                skip: offset,
                orderBy: { lastWebhookAt: 'desc' }
            }),
            req.prisma.shopifyOrderCache.count()
        ]);

        res.json({ data, total, limit, offset });
    } catch (error) {
        console.error('Inspect Shopify Order Cache error:', error);
        res.status(500).json({ error: 'Failed to inspect Shopify order cache' });
    }
});

// Inspect Shopify Product Cache table
router.get('/inspect/shopify-product-cache', authenticateToken, async (req, res) => {
    try {
        const limit = Math.min(parseInt(req.query.limit) || 50, 5000);
        const offset = parseInt(req.query.offset) || 0;

        const [data, total] = await Promise.all([
            req.prisma.shopifyProductCache.findMany({
                take: limit,
                skip: offset,
                orderBy: { lastWebhookAt: 'desc' }
            }),
            req.prisma.shopifyProductCache.count()
        ]);

        res.json({ data, total, limit, offset });
    } catch (error) {
        console.error('Inspect Shopify Product Cache error:', error);
        res.status(500).json({ error: 'Failed to inspect Shopify product cache' });
    }
});

// Get all table names from Prisma - for dynamic table selector
router.get('/inspect/tables', authenticateToken, async (req, res) => {
    try {
        // Get all model names from Prisma client
        // The _dmmf property contains the data model meta information
        const modelNames = Object.keys(req.prisma).filter(key =>
            !key.startsWith('_') &&
            !key.startsWith('$') &&
            typeof req.prisma[key] === 'object' &&
            req.prisma[key]?.findMany
        );

        // Convert to display format with counts
        const tablesWithCounts = await Promise.all(
            modelNames.map(async (name) => {
                try {
                    const count = await req.prisma[name].count();
                    return {
                        name,
                        displayName: name.replace(/([A-Z])/g, ' $1').trim(),
                        count
                    };
                } catch {
                    return { name, displayName: name.replace(/([A-Z])/g, ' $1').trim(), count: 0 };
                }
            })
        );

        // Sort by name
        tablesWithCounts.sort((a, b) => a.displayName.localeCompare(b.displayName));

        res.json({ tables: tablesWithCounts });
    } catch (error) {
        console.error('Get tables error:', error);
        res.status(500).json({ error: 'Failed to get table list' });
    }
});

// Generic table inspector - inspect any table
router.get('/inspect/table/:tableName', authenticateToken, async (req, res) => {
    try {
        const { tableName } = req.params;
        const limit = Math.min(parseInt(req.query.limit) || 50, 5000);
        const offset = parseInt(req.query.offset) || 0;

        // Validate table exists in Prisma
        if (!req.prisma[tableName] || typeof req.prisma[tableName].findMany !== 'function') {
            return res.status(404).json({ error: `Table '${tableName}' not found` });
        }

        // Try to find a suitable orderBy field
        let orderBy = { createdAt: 'desc' };

        // Get the data
        const [data, total] = await Promise.all([
            req.prisma[tableName].findMany({
                take: limit,
                skip: offset,
                orderBy
            }).catch(() =>
                // If createdAt doesn't exist, try without ordering
                req.prisma[tableName].findMany({
                    take: limit,
                    skip: offset
                })
            ),
            req.prisma[tableName].count()
        ]);

        res.json({ data, total, limit, offset, tableName });
    } catch (error) {
        console.error(`Inspect table ${req.params.tableName} error:`, error);
        res.status(500).json({ error: `Failed to inspect table: ${error.message}` });
    }
});

// ============================================
// SERVER LOGS VIEWER
// ============================================

// Get server logs
router.get('/logs', authenticateToken, (req, res) => {
    try {
        const level = req.query.level || 'all';
        const limit = Math.min(parseInt(req.query.limit) || 100, 1000);
        const offset = parseInt(req.query.offset) || 0;
        const search = req.query.search || null;

        const result = logBuffer.getLogs({ level, limit, offset, search });
        res.json(result);
    } catch (error) {
        console.error('Get logs error:', error);
        res.status(500).json({ error: 'Failed to get logs' });
    }
});

// Get log statistics
router.get('/logs/stats', authenticateToken, (req, res) => {
    try {
        const stats = logBuffer.getStats();
        res.json(stats);
    } catch (error) {
        console.error('Get log stats error:', error);
        res.status(500).json({ error: 'Failed to get log stats' });
    }
});

// Clear logs (Admin only)
router.delete('/logs', requireAdmin, (req, res) => {
    try {
        logBuffer.clearLogs();
        res.json({ message: 'Logs cleared successfully' });
    } catch (error) {
        console.error('Clear logs error:', error);
        res.status(500).json({ error: 'Failed to clear logs' });
    }
});

export default router;
