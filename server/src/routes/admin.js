import { Router } from 'express';
import bcrypt from 'bcryptjs';
import { authenticateToken, requireAdmin } from '../middleware/auth.js';
import { validatePassword } from '../utils/validation.js';

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
            { id: 'amazon', name: 'Amazon' },
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

export default router;
