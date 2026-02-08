/**
 * @module routes/admin
 * @description Admin-only operations: user/role management, system settings, DB inspection, logs, and background jobs
 *
 * User Management: CRUD for users, password resets, role assignment
 * Role & Permissions: Assign roles, manage per-user permission overrides (forces re-login via tokenVersion increment)
 * System Settings: Order channels, tier thresholds (platinum/gold/silver LTV breakpoints)
 * DB Inspector: Browse any Prisma table with pagination (dev tool)
 * Logs: View server.jsonl logs (24hr retention), filter by level/search
 * Background Jobs: Shopify sync (24hr lookback), tracking sync (30min), cache cleanup (daily 2AM), auto-archive (startup)
 *
 * Protection Logic:
 * - Cannot delete/disable last admin user
 * - Cannot change last Owner role
 * - Role changes increment tokenVersion (forces re-login to get new permissions)
 *
 * @see middleware/permissions.js - Permission checking logic
 * @see utils/tierUtils.js - Customer tier calculation
 */

import { Router } from 'express';
import type { Request, Response } from 'express';
import type { PrismaClient } from '@prisma/client';
// @ts-ignore - types are available in server context but might fail in client composite build
import bcrypt from 'bcryptjs';
import fs from 'fs';
import { authenticateToken, requireAdmin } from '../middleware/auth.js';
import { requirePermission } from '../middleware/permissions.js';
import { validatePassword } from '@coh/shared';
import { DEFAULT_TIER_THRESHOLDS, updateAllCustomerTiers } from '../utils/tierUtils.js';
import logBuffer from '../utils/logBuffer.js';
import { chunkProcess } from '../utils/asyncUtils.js';
import scheduledSync from '../services/scheduledSync.js';
import trackingSync from '../services/trackingSync.js';
import { runAllCleanup, getCacheStats } from '../utils/cacheCleanup.js';
import { invalidateUserTokens } from '../middleware/permissions.js';
import { asyncHandler } from '../middleware/asyncHandler.js';
import { ValidationError, NotFoundError, ConflictError, BusinessLogicError } from '../utils/errors.js';
import sheetOffloadWorker from '../services/sheetOffloadWorker.js';
import { ENABLE_SHEET_DELETION } from '../config/sync/sheets.js';

const router: Router = Router();

// ============================================
// INTERFACES
// ============================================

/** Channel configuration */
interface Channel {
    id: string;
    name: string;
}

/** Tier thresholds */
interface TierThresholds {
    platinum: number;
    gold: number;
    silver: number;
}

/** Permission override */
interface PermissionOverride {
    permission: string;
    granted: boolean;
}

/** User creation/update body */
interface CreateUserBody {
    email: string;
    password: string;
    name: string;
    role?: string;
    roleId?: string;
}

interface UpdateUserBody {
    email?: string;
    name?: string;
    role?: string;
    isActive?: boolean;
    password?: string;
}

/** Background job status */
interface BackgroundJob {
    id: string;
    name: string;
    description: string;
    enabled: boolean;
    intervalMinutes?: number;
    schedule?: string;
    isRunning?: boolean;
    lastRunAt?: string | Date | null;
    lastResult?: unknown;
    config?: Record<string, unknown>;
    stats?: unknown;
    note?: string;
}

/** Grid preferences */
interface GridPreferences {
    visibleColumns?: string[];
    columnOrder?: string[];
    columnWidths?: Record<string, number>;
    updatedAt?: string;
    updatedBy?: string;
}

/** Delete operation model interface */
interface DeleteModel {
    count: () => Promise<number>;
    deleteMany: () => Promise<{ count: number }>;
}

/** Delete operation config */
interface DeleteOperation {
    name: string;
    model: DeleteModel;
}

/** Password validation result */
interface PasswordValidationResult {
    isValid: boolean;
    errors: string[];
}

/** Sync status from scheduledSync service */
interface ShopifySyncStatus {
    isRunning: boolean;
    schedulerActive: boolean;
    intervalMinutes: number;
    lookbackHours: number;
    lastSyncAt: Date | null;
    lastSyncResult: unknown;
}

/** Sync status from trackingSync service */
interface TrackingSyncStatus {
    isRunning: boolean;
    schedulerActive: boolean;
    intervalMinutes: number;
    lastSyncAt: Date | null;
    lastSyncResult: unknown;
}

/** Cache cleanup result */
interface CleanupResult {
    orderCache: { deletedCount: number; errors: string[] };
    productCache: { deletedCount: number; errors: string[] };
    webhookLogs: { deletedCount: number; errors: string[] };
    failedSyncItems: { deletedCount: number; errors: string[] };
    syncJobs: { deletedCount: number; errors: string[] };
    summary: {
        totalDeleted: number;
        totalErrors: number;
        durationMs: number;
    };
}

/** Clear tables request body */
interface ClearTablesBody {
    tables: string[];
    confirmPhrase: string;
}

/** Channels update body */
interface ChannelsUpdateBody {
    channels: Channel[];
}

/** Tier thresholds update body */
interface TierThresholdsUpdateBody {
    platinum: number;
    gold: number;
    silver: number;
}

/** Role assignment body */
interface RoleAssignmentBody {
    roleId: string;
}

/** Permissions update body */
interface PermissionsUpdateBody {
    overrides: PermissionOverride[];
}

/** Background job trigger params */
type JobId = 'shopify_sync' | 'tracking_sync' | 'cache_cleanup' | 'ingest_inward' | 'ingest_outward' | 'move_shipped_to_outward';

/** Background job update body */
interface JobUpdateBody {
    enabled: boolean;
}

// Type for Prisma model with dynamic access
type PrismaModelDelegate = {
    findMany: (args?: unknown) => Promise<unknown[]>;
    count: (args?: unknown) => Promise<number>;
};

// Extended logBuffer type to access private logFilePath
interface LogBufferWithPath {
    getLogs: typeof logBuffer.getLogs;
    getStats: typeof logBuffer.getStats;
    clearLogs: typeof logBuffer.clearLogs;
    logFilePath: string;
}

/**
 * Get database entity counts for dashboard
 * @route GET /api/admin/stats
 * @returns {Object} { products, variations, skus, orders, customers, fabrics, inventoryTransactions }
 */
router.get('/stats', authenticateToken, asyncHandler(async (req: Request, res: Response) => {
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
}));

/**
 * Bulk delete data from specified tables (requires 'DELETE ALL DATA' phrase)
 * @route POST /api/admin/clear
 * @param {string[]} body.tables - Table names to clear (or ['all'])
 * @param {string} body.confirmPhrase - Must be exactly 'DELETE ALL DATA'
 * @returns {Object} { message, deleted: { tableName: count } }
 * @description Respects FK constraints (deletes children first). Uses transaction for atomicity.
 */
router.post('/clear', requireAdmin, asyncHandler(async (req: Request, res: Response) => {
    const { tables, confirmPhrase } = req.body as ClearTablesBody;

    // Require confirmation phrase
    if (confirmPhrase !== 'DELETE ALL DATA') {
        throw new ValidationError('Invalid confirmation phrase');
    }

    if (!tables || !Array.isArray(tables) || tables.length === 0) {
        throw new ValidationError('No tables specified');
    }

    const results: Record<string, number | string> = {};

    // Use a transaction for PostgreSQL to ensure all deletes succeed or none do
    await req.prisma.$transaction(async (prisma) => {
        // Clear in correct order to respect foreign key constraints
        const deleteOperations: DeleteOperation[] = [
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
            // NOTE: fabricTransaction and fabricType removed - using FabricColour hierarchy now
            { name: 'fabricOrders', model: prisma.fabricOrder },
            { name: 'fabrics', model: prisma.fabric },
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
                    const errorMessage = tableError instanceof Error ? tableError.message : String(tableError);
                    console.error(`Error deleting ${name}:`, errorMessage);
                    results[name] = `Error: ${errorMessage}`;
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
}));

// Get order channels
router.get('/channels', authenticateToken, asyncHandler(async (req: Request, res: Response) => {
    const setting = await req.prisma.systemSetting.findUnique({
        where: { key: 'order_channels' }
    });

    // Default channels if not configured
    const defaultChannels: Channel[] = [
        { id: 'offline', name: 'Offline' },
        { id: 'shopify', name: 'Shopify' },
        { id: 'nykaa', name: 'Nykaa' },
        { id: 'ajio', name: 'Ajio' },
        { id: 'myntra', name: 'Myntra' },
    ];

    const channels = setting?.value ? JSON.parse(setting.value) as Channel[] : defaultChannels;
    res.json(channels);
}));

// Update order channels
router.put('/channels', authenticateToken, asyncHandler(async (req: Request, res: Response) => {
    const { channels } = req.body as ChannelsUpdateBody;

    if (!Array.isArray(channels)) {
        throw new ValidationError('Channels must be an array');
    }

    // Validate channel format
    for (const channel of channels) {
        if (!channel.id || !channel.name) {
            throw new ValidationError('Each channel must have id and name');
        }
    }

    await req.prisma.systemSetting.upsert({
        where: { key: 'order_channels' },
        update: { value: JSON.stringify(channels) },
        create: { key: 'order_channels', value: JSON.stringify(channels) }
    });

    res.json({ success: true, channels });
}));

// Get sidebar section order
router.get('/sidebar-order', authenticateToken, asyncHandler(async (req: Request, res: Response) => {
    const setting = await req.prisma.systemSetting.findUnique({
        where: { key: 'sidebar_section_order' }
    });

    // Return null if not configured (frontend will use default)
    const order = setting?.value ? JSON.parse(setting.value) as string[] : null;
    res.json(order);
}));

// Update sidebar section order (admin only)
router.put('/sidebar-order', authenticateToken, requireAdmin, asyncHandler(async (req: Request, res: Response) => {
    const { order } = req.body as { order: string[] };

    if (!Array.isArray(order)) {
        throw new ValidationError('Order must be an array of section labels');
    }

    // Validate all items are strings
    for (const label of order) {
        if (typeof label !== 'string') {
            throw new ValidationError('Each item in order must be a string');
        }
    }

    await req.prisma.systemSetting.upsert({
        where: { key: 'sidebar_section_order' },
        update: { value: JSON.stringify(order) },
        create: { key: 'sidebar_section_order', value: JSON.stringify(order) }
    });

    res.json({ success: true, order });
}));

// Get tier thresholds
router.get('/tier-thresholds', authenticateToken, asyncHandler(async (req: Request, res: Response) => {
    const setting = await req.prisma.systemSetting.findUnique({
        where: { key: 'tier_thresholds' }
    });

    const thresholds = setting?.value ? JSON.parse(setting.value) as TierThresholds : DEFAULT_TIER_THRESHOLDS;
    res.json(thresholds);
}));

// Update tier thresholds
router.put('/tier-thresholds', requireAdmin, asyncHandler(async (req: Request, res: Response) => {
    const { platinum, gold, silver } = req.body as TierThresholdsUpdateBody;

    // Validate thresholds
    if (typeof platinum !== 'number' || typeof gold !== 'number' || typeof silver !== 'number') {
        throw new ValidationError('All thresholds must be numbers');
    }

    if (platinum <= gold || gold <= silver || silver <= 0) {
        throw new ValidationError('Thresholds must be: platinum > gold > silver > 0');
    }

    const thresholds: TierThresholds = { platinum, gold, silver };

    await req.prisma.systemSetting.upsert({
        where: { key: 'tier_thresholds' },
        update: { value: JSON.stringify(thresholds) },
        create: { key: 'tier_thresholds', value: JSON.stringify(thresholds) }
    });

    res.json({ success: true, thresholds });
}));

/**
 * Batch update all customer tiers based on LTV
 * @route POST /api/admin/update-customer-tiers
 * @returns {Object} { total, updated, upgrades: [{ customerId, oldTier, newTier, ltv }] }
 * @description Recalculates tier for all customers. Use after threshold changes or data migration.
 */
router.post('/update-customer-tiers', requireAdmin, asyncHandler(async (req: Request, res: Response) => {
    const result = await updateAllCustomerTiers(req.prisma);

    res.json({
        message: `Updated ${result.updated} of ${result.total} customer tiers`,
        ...result
    });
}));

// Reset and reseed database (Admin only)
router.post('/reseed', requireAdmin, asyncHandler(async (req: Request, res: Response) => {
    const { confirmPhrase } = req.body as { confirmPhrase: string };

    if (confirmPhrase !== 'RESEED DATABASE') {
        throw new ValidationError('Invalid confirmation phrase');
    }

    // This would typically call your seed script
    // For now, just return instructions
    res.json({
        message: 'To reseed the database, run: npm run db:seed in the server directory',
        note: 'Automatic reseeding from API is disabled for safety',
    });
}));

// ============================================
// ROLE MANAGEMENT (for new permissions system)
// ============================================

/**
 * List all roles with their permissions
 * @route GET /api/admin/roles
 * @returns {Object[]} roles - [{ id, name, displayName, permissions, createdAt }]
 */
router.get('/roles', authenticateToken, asyncHandler(async (req: Request, res: Response) => {
    const roles = await req.prisma.role.findMany({
        orderBy: { createdAt: 'asc' },
    });
    res.json(roles);
}));

// Get single role with user count
router.get('/roles/:id', authenticateToken, asyncHandler(async (req: Request, res: Response) => {
    const id = req.params.id as string;
    const role = await req.prisma.role.findUnique({
        where: { id },
        include: {
            _count: { select: { users: true } },
        },
    });

    if (!role) {
        throw new NotFoundError('Role not found', 'Role', id);
    }

    res.json(role);
}));

/**
 * Assign role to user (increments tokenVersion to force re-login)
 * @route PUT /api/admin/users/:id/role
 * @param {string} body.roleId - Role UUID to assign
 * @returns {Object} user - Updated user with roleName
 * @description Prevents changing last Owner role. Forces re-login to apply new permissions.
 */
router.put('/users/:id/role', requireAdmin, asyncHandler(async (req: Request, res: Response) => {
    const { roleId } = req.body as RoleAssignmentBody;
    const id = req.params.id as string;

    if (!roleId) {
        throw new ValidationError('roleId is required');
    }

    const user = await req.prisma.user.findUnique({
        where: { id },
    });

    if (!user) {
        throw new NotFoundError('User not found', 'User', id);
    }

    const role = await req.prisma.role.findUnique({
        where: { id: roleId },
    });

    if (!role) {
        throw new NotFoundError('Role not found', 'Role', roleId);
    }

    // Prevent changing the last Owner's role
    // First get the user's current role to check if they're an owner
    const userWithRole = await req.prisma.user.findUnique({
        where: { id },
        include: { userRole: true },
    });

    if (userWithRole?.userRole?.name === 'owner') {
        const ownerRole = await req.prisma.role.findFirst({ where: { name: 'owner' } });
        if (ownerRole) {
            const ownerCount = await req.prisma.user.count({
                where: { roleId: ownerRole.id, isActive: true },
            });
            if (ownerCount <= 1 && roleId !== ownerRole.id) {
                throw new BusinessLogicError('Cannot change role of the last Owner', 'last_owner_protection');
            }
        }
    }

    // Update user role and invalidate their tokens
    const updated = await req.prisma.$transaction(async (tx) => {
        const result = await tx.user.update({
            where: { id },
            data: {
                roleId,
                tokenVersion: { increment: 1 }, // Force re-login
            },
            include: {
                userRole: { select: { id: true, name: true, displayName: true } },
            },
        });
        return result;
    });

    console.log(`[Admin] Role changed for user ${user.email}: ${role.displayName}`);

    res.json({
        ...updated,
        roleName: updated.userRole?.displayName,
    });
}));

/**
 * Get user's effective permissions (role + overrides)
 * @route GET /api/admin/users/:id/permissions
 * @returns {Object} { userId, roleId, roleName, rolePermissions[], overrides: [{ permission, granted }] }
 */
router.get('/users/:id/permissions', requireAdmin, asyncHandler(async (req: Request, res: Response) => {
    const id = req.params.id as string;
    const user = await req.prisma.user.findUnique({
        where: { id },
        include: {
            userRole: { select: { id: true, name: true, displayName: true, permissions: true } },
            permissionOverrides: true,
        },
    });

    if (!user) {
        throw new NotFoundError('User not found', 'User', id);
    }

    // Get role permissions as array
    const rolePermissions = Array.isArray(user.userRole?.permissions)
        ? user.userRole.permissions as string[]
        : [];

    // Build map of overrides: permission -> granted
    const overrideMap = new Map<string, boolean>();
    for (const override of user.permissionOverrides) {
        overrideMap.set(override.permission, override.granted);
    }

    res.json({
        userId: user.id,
        roleId: user.userRole?.id || null,
        roleName: user.userRole?.displayName || null,
        rolePermissions,
        overrides: user.permissionOverrides.map(o => ({
            permission: o.permission,
            granted: o.granted,
        })),
    });
}));

/**
 * Update per-user permission overrides (increments tokenVersion)
 * @route PUT /api/admin/users/:id/permissions
 * @param {Object[]} body.overrides - [{ permission: 'orders:read', granted: true }]
 * @description Only stores overrides that differ from role defaults. Auto-deletes overrides matching role. Forces re-login.
 */
router.put('/users/:id/permissions', requireAdmin, asyncHandler(async (req: Request, res: Response) => {
    const { overrides } = req.body as PermissionsUpdateBody;
    const id = req.params.id as string;

    if (!Array.isArray(overrides)) {
        throw new ValidationError('overrides must be an array');
    }

    // Validate each override
    for (const override of overrides) {
        if (!override.permission || typeof override.permission !== 'string') {
            throw new ValidationError('Each override must have a permission string');
        }
        if (typeof override.granted !== 'boolean') {
            throw new ValidationError('Each override must have a granted boolean');
        }
    }

    const user = await req.prisma.user.findUnique({
        where: { id },
        include: {
            userRole: { select: { id: true, permissions: true } },
        },
    });

    if (!user) {
        throw new NotFoundError('User not found', 'User', id);
    }

    // Get role permissions for comparison
    const rolePermissions = new Set<string>(
        Array.isArray(user.userRole?.permissions) ? user.userRole.permissions as string[] : []
    );

    // Determine which overrides to create/update and which to delete
    const toUpsert: PermissionOverride[] = [];
    const toDelete: string[] = [];

    for (const override of overrides) {
        const roleHasPermission = rolePermissions.has(override.permission);

        // If override matches role default, we should delete it (no need to store)
        if ((override.granted && roleHasPermission) || (!override.granted && !roleHasPermission)) {
            toDelete.push(override.permission);
        } else {
            // Override differs from role default, store it
            toUpsert.push(override);
        }
    }

    // Execute in transaction
    await req.prisma.$transaction(async (tx) => {
        // Delete overrides that now match role defaults
        if (toDelete.length > 0) {
            await tx.userPermissionOverride.deleteMany({
                where: {
                    userId: id,
                    permission: { in: toDelete },
                },
            });
        }

        // Upsert overrides that differ from role defaults
        for (const override of toUpsert) {
            await tx.userPermissionOverride.upsert({
                where: {
                    userId_permission: {
                        userId: id,
                        permission: override.permission,
                    },
                },
                update: { granted: override.granted },
                create: {
                    userId: id,
                    permission: override.permission,
                    granted: override.granted,
                },
            });
        }

        // Increment token version to force re-login with new permissions
        await tx.user.update({
            where: { id },
            data: { tokenVersion: { increment: 1 } },
        });
    });

    // Fetch updated overrides
    const updatedOverrides = await req.prisma.userPermissionOverride.findMany({
        where: { userId: id },
    });

    console.log(`[Admin] Permission overrides updated for user ${user.email}: ${toUpsert.length} set, ${toDelete.length} cleared`);

    res.json({
        message: 'Permission overrides updated successfully',
        overrides: updatedOverrides.map(o => ({
            permission: o.permission,
            granted: o.granted,
        })),
    });
}));

// ============================================
// USER MANAGEMENT (Admin only)
// ============================================

/**
 * List all users with their roles
 * @route GET /api/admin/users
 * @returns {Object[]} users - [{ id, email, name, role, roleId, isActive, createdAt, roleName }]
 */
router.get('/users', requireAdmin, asyncHandler(async (req: Request, res: Response) => {
    const users = await req.prisma.user.findMany({
        select: {
            id: true,
            email: true,
            name: true,
            role: true,
            roleId: true,
            isActive: true,
            createdAt: true,
            userRole: {
                select: {
                    id: true,
                    name: true,
                    displayName: true,
                }
            },
        },
        orderBy: { createdAt: 'desc' },
    });

    // Transform to include roleName for frontend
    const usersWithRoleName = users.map(u => ({
        ...u,
        roleName: u.userRole?.displayName || u.role,
    }));

    res.json(usersWithRoleName);
}));

// Get single user
router.get('/users/:id', requireAdmin, asyncHandler(async (req: Request, res: Response) => {
    const id = req.params.id as string;
    const user = await req.prisma.user.findUnique({
        where: { id },
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
        throw new NotFoundError('User not found', 'User', id);
    }

    res.json(user);
}));

/**
 * Create new user (validates password strength)
 * @route POST /api/admin/users
 * @param {string} body.email - Unique email
 * @param {string} body.password - Password (min 8 chars, complexity required)
 * @param {string} body.name - Full name
 * @param {string} [body.role='staff'] - Legacy role ('admin' or 'staff')
 * @param {string} [body.roleId] - New permissions system role UUID
 * @returns {Object} user - Created user
 */
router.post('/users', requireAdmin, asyncHandler(async (req: Request, res: Response) => {
    const { email, password, name, role = 'staff', roleId } = req.body as CreateUserBody;

    // Validate input
    if (!email || !password || !name) {
        throw new ValidationError('Email, password, and name are required');
    }

    // Validate password strength
    const passwordValidation = validatePassword(password) as PasswordValidationResult;
    if (!passwordValidation.isValid) {
        throw new ValidationError(passwordValidation.errors[0]);
    }

    // Validate role (legacy string role)
    const validRoles = ['admin', 'staff'];
    if (!validRoles.includes(role)) {
        throw new ValidationError('Invalid role. Must be admin or staff');
    }

    // Validate roleId if provided
    if (roleId) {
        const roleExists = await req.prisma.role.findUnique({ where: { id: roleId } });
        if (!roleExists) {
            throw new ValidationError('Invalid roleId - role not found');
        }
    }

    // Check if email already exists
    const existing = await req.prisma.user.findUnique({ where: { email } });
    if (existing) {
        throw new ConflictError('Email already in use', 'duplicate_email');
    }

    // Hash password
    const hashedPassword = await bcrypt.hash(password, 10);

    // Create user with roleId if provided
    const user = await req.prisma.user.create({
        data: {
            email,
            password: hashedPassword,
            name,
            role,
            roleId: roleId || null,
        },
        select: {
            id: true,
            email: true,
            name: true,
            role: true,
            roleId: true,
            isActive: true,
            createdAt: true,
            userRole: {
                select: {
                    id: true,
                    name: true,
                    displayName: true,
                }
            },
        },
    });

    // Transform to include roleName for frontend
    res.status(201).json({
        ...user,
        roleName: user.userRole?.displayName || user.role,
    });
}));

/**
 * Update user details (protects last admin)
 * @route PUT /api/admin/users/:id
 * @param {string} [body.email] - New email
 * @param {string} [body.name] - New name
 * @param {string} [body.role] - New role
 * @param {boolean} [body.isActive] - Active status
 * @param {string} [body.password] - New password (re-hashed)
 * @description Cannot disable/demote last admin user.
 */
router.put('/users/:id', requireAdmin, asyncHandler(async (req: Request, res: Response) => {
    const { email, name, role, isActive, password } = req.body as UpdateUserBody;
    const id = req.params.id as string;

    // Get existing user
    const existing = await req.prisma.user.findUnique({
        where: { id },
    });

    if (!existing) {
        throw new NotFoundError('User not found', 'User', id);
    }

    // Prevent disabling the last admin
    if (existing.role === 'admin' && isActive === false) {
        const adminCount = await req.prisma.user.count({
            where: { role: 'admin', isActive: true },
        });
        if (adminCount <= 1) {
            throw new BusinessLogicError('Cannot disable the last admin user', 'last_admin_protection');
        }
    }

    // Prevent changing role of last admin
    if (existing.role === 'admin' && role && role !== 'admin') {
        const adminCount = await req.prisma.user.count({
            where: { role: 'admin', isActive: true },
        });
        if (adminCount <= 1) {
            throw new BusinessLogicError('Cannot change role of the last admin user', 'last_admin_protection');
        }
    }

    // Check email uniqueness if changing
    if (email && email !== existing.email) {
        const emailExists = await req.prisma.user.findUnique({ where: { email } });
        if (emailExists) {
            throw new ConflictError('Email already in use', 'duplicate_email');
        }
    }

    // Build update data
    const updateData: {
        email?: string;
        name?: string;
        role?: string;
        isActive?: boolean;
        password?: string;
    } = {};
    if (email) updateData.email = email;
    if (name) updateData.name = name;
    if (role) updateData.role = role;
    if (typeof isActive === 'boolean') updateData.isActive = isActive;
    if (password) {
        const passwordValidation = validatePassword(password) as PasswordValidationResult;
        if (!passwordValidation.isValid) {
            throw new ValidationError(passwordValidation.errors[0]);
        }
        updateData.password = await bcrypt.hash(password, 10);
    }

    const user = await req.prisma.user.update({
        where: { id },
        data: updateData,
        select: {
            id: true,
            email: true,
            name: true,
            role: true,
            roleId: true,
            isActive: true,
            createdAt: true,
            userRole: {
                select: {
                    id: true,
                    name: true,
                    displayName: true,
                }
            },
        },
    });

    // Transform to include roleName for frontend
    res.json({
        ...user,
        roleName: user.userRole?.displayName || user.role,
    });
}));

/**
 * Delete user (protects last admin and prevents self-deletion)
 * @route DELETE /api/admin/users/:id
 * @description Cannot delete last admin or self.
 */
router.delete('/users/:id', requireAdmin, asyncHandler(async (req: Request, res: Response) => {
    const id = req.params.id as string;
    const user = await req.prisma.user.findUnique({
        where: { id },
    });

    if (!user) {
        throw new NotFoundError('User not found', 'User', id);
    }

    // Prevent deleting the last admin
    if (user.role === 'admin') {
        const adminCount = await req.prisma.user.count({
            where: { role: 'admin' },
        });
        if (adminCount <= 1) {
            throw new BusinessLogicError('Cannot delete the last admin user', 'last_admin_protection');
        }
    }

    // Prevent self-deletion
    if (user.id === req.user?.id) {
        throw new BusinessLogicError('Cannot delete your own account', 'self_deletion_prevention');
    }

    await req.prisma.user.delete({
        where: { id },
    });

    res.json({ message: 'User deleted successfully' });
}));

// ============================================
// DATABASE INSPECTOR (Admin only)
// ============================================

// Inspect orders table
router.get('/inspect/orders', authenticateToken, asyncHandler(async (req: Request, res: Response) => {
    const limit = Math.min(parseInt(req.query.limit as string) || 50, 5000);
    const offset = parseInt(req.query.offset as string) || 0;

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
}));

// Inspect customers table
router.get('/inspect/customers', authenticateToken, asyncHandler(async (req: Request, res: Response) => {
    const limit = Math.min(parseInt(req.query.limit as string) || 50, 5000);
    const offset = parseInt(req.query.offset as string) || 0;

    const [data, total] = await Promise.all([
        req.prisma.customer.findMany({
            take: limit,
            skip: offset,
            orderBy: { createdAt: 'desc' }
        }),
        req.prisma.customer.count()
    ]);

    res.json({ data, total, limit, offset });
}));

// Inspect products table
router.get('/inspect/products', authenticateToken, asyncHandler(async (req: Request, res: Response) => {
    const limit = Math.min(parseInt(req.query.limit as string) || 50, 5000);
    const offset = parseInt(req.query.offset as string) || 0;

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
}));

// Inspect SKUs table
router.get('/inspect/skus', authenticateToken, asyncHandler(async (req: Request, res: Response) => {
    const limit = Math.min(parseInt(req.query.limit as string) || 50, 5000);
    const offset = parseInt(req.query.offset as string) || 0;

    const [data, total] = await Promise.all([
        req.prisma.sku.findMany({
            take: limit,
            skip: offset,
            orderBy: { skuCode: 'desc' },
            include: {
                variation: {
                    include: { product: { select: { name: true, styleCode: true } } }
                }
            }
        }),
        req.prisma.sku.count()
    ]);

    res.json({ data, total, limit, offset });
}));

// Inspect Shopify Order Cache table
router.get('/inspect/shopify-order-cache', authenticateToken, asyncHandler(async (req: Request, res: Response) => {
    const limit = Math.min(parseInt(req.query.limit as string) || 50, 5000);
    const offset = parseInt(req.query.offset as string) || 0;

    const [data, total] = await Promise.all([
        req.prisma.shopifyOrderCache.findMany({
            take: limit,
            skip: offset,
            orderBy: { lastWebhookAt: 'desc' }
        }),
        req.prisma.shopifyOrderCache.count()
    ]);

    res.json({ data, total, limit, offset });
}));

// Inspect Shopify Product Cache table
router.get('/inspect/shopify-product-cache', authenticateToken, asyncHandler(async (req: Request, res: Response) => {
    const limit = Math.min(parseInt(req.query.limit as string) || 50, 5000);
    const offset = parseInt(req.query.offset as string) || 0;

    const [data, total] = await Promise.all([
        req.prisma.shopifyProductCache.findMany({
            take: limit,
            skip: offset,
            orderBy: { lastWebhookAt: 'desc' }
        }),
        req.prisma.shopifyProductCache.count()
    ]);

    res.json({ data, total, limit, offset });
}));

// Get all table names from Prisma - for dynamic table selector
router.get('/inspect/tables', authenticateToken, asyncHandler(async (req: Request, res: Response) => {
    // Get all model names from Prisma client
    // The _dmmf property contains the data model meta information
    const prismaAny = req.prisma as unknown as Record<string, unknown>;
    const modelNames = Object.keys(req.prisma).filter(key =>
        !key.startsWith('_') &&
        !key.startsWith('$') &&
        typeof prismaAny[key] === 'object' &&
        (prismaAny[key] as PrismaModelDelegate | null)?.findMany
    );

    // Convert to display format with counts (batched to prevent connection pool exhaustion)
    const tablesWithCounts = await chunkProcess(modelNames, async (name: string) => {
        try {
            const model = prismaAny[name] as PrismaModelDelegate;
            const count = await model.count();
            return {
                name,
                displayName: name.replace(/([A-Z])/g, ' $1').trim(),
                count
            };
        } catch {
            return { name, displayName: name.replace(/([A-Z])/g, ' $1').trim(), count: 0 };
        }
    }, 5);

    // Sort by name
    tablesWithCounts.sort((a, b) => a.displayName.localeCompare(b.displayName));

    res.json({ tables: tablesWithCounts });
}));

// Generic table inspector - inspect any table
router.get('/inspect/table/:tableName', authenticateToken, asyncHandler(async (req: Request, res: Response) => {
    const tableName = req.params.tableName as string;
    const limit = Math.min(parseInt(req.query.limit as string) || 50, 5000);
    const offset = parseInt(req.query.offset as string) || 0;

    // Validate table exists in Prisma
    const prismaAny = req.prisma as unknown as Record<string, unknown>;
    const model = prismaAny[tableName] as PrismaModelDelegate | undefined;
    if (!model || typeof model.findMany !== 'function') {
        throw new NotFoundError(`Table '${tableName}' not found`, 'Table', tableName);
    }

    // Try to find a suitable orderBy field
    const orderBy = { createdAt: 'desc' as const };

    // Get the data
    const [data, total] = await Promise.all([
        model.findMany({
            take: limit,
            skip: offset,
            orderBy
        }).catch(() =>
            // If createdAt doesn't exist, try without ordering
            model.findMany({
                take: limit,
                skip: offset
            })
        ),
        model.count()
    ]);

    res.json({ data, total, limit, offset, tableName });
}));

// ============================================
// SERVER LOGS VIEWER
// ============================================

/**
 * Fetch server logs (from server.jsonl, 24hr retention)
 * @route GET /api/admin/logs?level=error&limit=100&offset=0&search=term
 * @param {string} [query.level] - Filter by level ('error', 'warn', 'info', 'all')
 * @param {number} [query.limit=100] - Max logs to return (max 1000)
 * @param {number} [query.offset=0] - Skip N logs
 * @param {string} [query.search] - Search term
 * @returns {Object} { logs: [], total, level, limit, offset }
 */
router.get('/logs', authenticateToken, asyncHandler(async (req: Request, res: Response) => {
    const level = (req.query.level as string) || 'all';
    const limit = Math.min(parseInt(req.query.limit as string) || 100, 1000);
    const offset = parseInt(req.query.offset as string) || 0;
    const search = (req.query.search as string) || null;

    const result = logBuffer.getLogs({ level: level as 'error' | 'warn' | 'info' | 'all', limit, offset, search });
    res.json(result);
}));

// Get log statistics
router.get('/logs/stats', authenticateToken, asyncHandler(async (req: Request, res: Response) => {
    const stats = logBuffer.getStats() as unknown as Record<string, unknown>;

    // Add storage metadata
    stats.isPersistent = true;
    stats.storageType = 'file';

    // Access logFilePath via type assertion (it's private but accessed in original code)
    const logBufferWithPath = logBuffer as unknown as LogBufferWithPath;
    stats.logFilePath = logBufferWithPath.logFilePath;

    // Get file size if available
    try {
        if (fs.existsSync(logBufferWithPath.logFilePath)) {
            const fileStats = fs.statSync(logBufferWithPath.logFilePath);
            stats.fileSizeBytes = fileStats.size;
            stats.fileSizeKB = Math.round(fileStats.size / 1024);
            stats.fileSizeMB = (fileStats.size / (1024 * 1024)).toFixed(2);
        }
    } catch (fsError) {
        // File size not critical, continue without it
    }

    res.json(stats);
}));

// Clear logs (Admin only)
router.delete('/logs', requireAdmin, asyncHandler(async (req: Request, res: Response) => {
    logBuffer.clearLogs();
    res.json({ message: 'Logs cleared successfully' });
}));

// ============================================
// BACKGROUND JOBS MANAGEMENT
// ============================================

/**
 * Get status of all background jobs with last run times
 * @route GET /api/admin/background-jobs
 * @returns {Object} { jobs: [{ id, name, description, enabled, intervalMinutes?, schedule?, isRunning, lastRunAt, lastResult }] }
 * @description Jobs: shopify_sync (24hr lookback), tracking_sync (30min updates), cache_cleanup (daily 2AM), auto_archive (on startup).
 */
router.get('/background-jobs', authenticateToken, asyncHandler(async (req: Request, res: Response) => {
    // Get sync service statuses
    const shopifyStatus = scheduledSync.getStatus();
    const trackingStatus = trackingSync.getStatus();
    const offloadStatus = sheetOffloadWorker.getStatus();

    // Get cache stats for cleanup job context
    const cacheStats = await getCacheStats();

    // Get any stored settings from database
    const settings = await req.prisma.systemSetting.findUnique({
        where: { key: 'background_jobs' }
    });
    const savedSettings = settings?.value ? JSON.parse(settings.value) as Record<string, unknown> : {};

    const jobs: BackgroundJob[] = [
        {
            id: 'shopify_sync',
            name: 'Shopify Order Sync',
            description: 'Fetches orders from the last 24 hours from Shopify and processes any that were missed by webhooks. Ensures ERP stays in sync with Shopify.',
            enabled: shopifyStatus.schedulerActive,
            intervalMinutes: shopifyStatus.intervalMinutes,
            isRunning: shopifyStatus.isRunning,
            lastRunAt: shopifyStatus.lastSyncAt,
            lastResult: shopifyStatus.lastSyncResult,
            config: {
                lookbackHours: shopifyStatus.lookbackHours || 24,
            }
        },
        {
            id: 'tracking_sync',
            name: 'Tracking Status Sync',
            description: 'Updates delivery status for shipped orders via iThink Logistics API. Tracks deliveries, RTOs, and updates order status automatically.',
            enabled: trackingStatus.schedulerActive,
            intervalMinutes: trackingStatus.intervalMinutes,
            isRunning: trackingStatus.isRunning,
            lastRunAt: trackingStatus.lastSyncAt,
            lastResult: trackingStatus.lastSyncResult,
        },
        {
            id: 'cache_cleanup',
            name: 'Cache Cleanup',
            description: 'Removes old Shopify cache entries, webhook logs, and completed sync records to prevent database bloat. Runs daily at 2 AM.',
            enabled: savedSettings.cacheCleanupEnabled !== false,
            schedule: 'Daily at 2:00 AM',
            lastRunAt: savedSettings.lastCacheCleanupAt as string | null || null,
            lastResult: savedSettings.lastCacheCleanupResult || null,
            stats: cacheStats,
        },
        {
            id: 'auto_archive',
            name: 'Auto-Archive Old Orders',
            description: 'Archives shipped/delivered orders older than 90 days on server startup. Reduces clutter in active order views.',
            enabled: true,
            schedule: 'On server startup',
            lastRunAt: savedSettings.lastAutoArchiveAt as string | null || null,
            note: 'Runs automatically when server starts',
        },
        {
            id: 'ingest_inward',
            name: 'Ingest Inward',
            description: 'Reads Inward (Live) buffer tab and creates INWARD inventory transactions in ERP. Updates sheet balances after ingestion.',
            enabled: offloadStatus.schedulerActive,
            intervalMinutes: offloadStatus.intervalMs / 60000,
            isRunning: offloadStatus.ingestInward.isRunning,
            lastRunAt: offloadStatus.ingestInward.lastRunAt,
            lastResult: offloadStatus.ingestInward.lastResult,
            config: {
                deletionEnabled: ENABLE_SHEET_DELETION,
            },
            stats: {
                recentRuns: offloadStatus.ingestInward.recentRuns,
            },
        },
        {
            id: 'move_shipped_to_outward',
            name: 'Move Shipped → Outward',
            description: 'Moves shipped orders from "Orders from COH" to "Outward (Live)". Finds rows where Shipped=TRUE and Outward Done≠1, writes to Outward (Live), then deletes source rows.',
            enabled: true,
            isRunning: offloadStatus.moveShipped.isRunning,
            lastRunAt: offloadStatus.moveShipped.lastRunAt,
            lastResult: offloadStatus.moveShipped.lastResult,
            note: 'Manual trigger only — no scheduled interval',
            stats: {
                recentRuns: offloadStatus.moveShipped.recentRuns,
            },
        },
        {
            id: 'ingest_outward',
            name: 'Ingest Outward',
            description: 'Reads Outward (Live) buffer tab, creates OUTWARD inventory transactions, and links shipped entries to OrderLines. Updates sheet balances after ingestion.',
            enabled: offloadStatus.schedulerActive,
            intervalMinutes: offloadStatus.intervalMs / 60000,
            isRunning: offloadStatus.ingestOutward.isRunning,
            lastRunAt: offloadStatus.ingestOutward.lastRunAt,
            lastResult: offloadStatus.ingestOutward.lastResult,
            config: {
                deletionEnabled: ENABLE_SHEET_DELETION,
            },
            stats: {
                recentRuns: offloadStatus.ingestOutward.recentRuns,
            },
        }
    ];

    res.json({ jobs });
}));

/**
 * Manually trigger background job
 * @route POST /api/admin/background-jobs/:jobId/trigger
 * @param {string} jobId - 'shopify_sync', 'tracking_sync', 'cache_cleanup'
 * @returns {Object} { message, result }
 * @description Saves cache_cleanup result to SystemSetting for persistence.
 */
router.post('/background-jobs/:jobId/trigger', requireAdmin, asyncHandler(async (req: Request, res: Response) => {
    const { jobId } = req.params as { jobId: JobId };

    switch (jobId) {
        case 'shopify_sync': {
            const result = await scheduledSync.triggerSync();
            res.json({
                message: 'Shopify sync triggered',
                result,
            });
            break;
        }
        case 'tracking_sync': {
            const result = await trackingSync.triggerSync();
            res.json({
                message: 'Tracking sync triggered',
                result,
            });
            break;
        }
        case 'cache_cleanup': {
            const result = await runAllCleanup() as CleanupResult;

            // Save result to settings
            const existingSettings = await req.prisma.systemSetting.findUnique({
                where: { key: 'background_jobs' }
            });
            const savedSettings = existingSettings?.value ? JSON.parse(existingSettings.value) as Record<string, unknown> : {};
            savedSettings.lastCacheCleanupAt = new Date().toISOString();
            savedSettings.lastCacheCleanupResult = result.summary;

            await req.prisma.systemSetting.upsert({
                where: { key: 'background_jobs' },
                update: { value: JSON.stringify(savedSettings) },
                create: { key: 'background_jobs', value: JSON.stringify(savedSettings) }
            });

            res.json({
                message: 'Cache cleanup completed',
                result,
            });
            break;
        }
        case 'ingest_inward': {
            const result = await sheetOffloadWorker.triggerIngestInward();
            res.json({ message: 'Ingest inward triggered', result });
            break;
        }
        case 'ingest_outward': {
            const result = await sheetOffloadWorker.triggerIngestOutward();
            res.json({ message: 'Ingest outward triggered', result });
            break;
        }
        case 'move_shipped_to_outward': {
            const result = await sheetOffloadWorker.triggerMoveShipped();
            res.json({ message: 'Move shipped → outward completed', result });
            break;
        }
        default:
            throw new ValidationError(`Unknown job: ${jobId}`);
    }
}));

/**
 * Update background job settings
 * Currently just tracks enabled/disabled state for cache cleanup
 * (Shopify and tracking sync are controlled by their services)
 */
router.put('/background-jobs/:jobId', requireAdmin, asyncHandler(async (req: Request, res: Response) => {
    const { jobId } = req.params;
    const { enabled } = req.body as JobUpdateBody;

    // Get existing settings
    const existingSettings = await req.prisma.systemSetting.findUnique({
        where: { key: 'background_jobs' }
    });
    const savedSettings = existingSettings?.value ? JSON.parse(existingSettings.value) as Record<string, unknown> : {};

    switch (jobId) {
        case 'cache_cleanup':
            savedSettings.cacheCleanupEnabled = enabled;
            break;
        // Note: shopify_sync and tracking_sync are always running
        // They can only be stopped/started at server level
        default:
            throw new ValidationError(`Cannot update settings for ${jobId}. Sync services are managed at server level.`);
    }

    await req.prisma.systemSetting.upsert({
        where: { key: 'background_jobs' },
        update: { value: JSON.stringify(savedSettings) },
        create: { key: 'background_jobs', value: JSON.stringify(savedSettings) }
    });

    res.json({
        message: 'Job settings updated',
        jobId,
        enabled,
    });
}));

// ============================================
// GRID COLUMN PREFERENCES (Synced across users)
// ============================================

/**
 * Get grid column preferences for a specific grid
 * @route GET /api/admin/grid-preferences/:gridId
 * @param {string} gridId - Grid identifier (e.g., 'ordersGrid', 'shippedGrid')
 * @returns {Object} { visibleColumns, columnOrder, columnWidths }
 * @description Returns server-stored preferences for all users to use
 */
router.get('/grid-preferences/:gridId', authenticateToken, asyncHandler(async (req: Request, res: Response) => {
    const { gridId } = req.params;
    const key = `grid_preferences_${gridId}`;

    const setting = await req.prisma.systemSetting.findUnique({
        where: { key }
    });

    if (!setting?.value) {
        return res.json(null); // No preferences set, use defaults
    }

    res.json(JSON.parse(setting.value) as GridPreferences);
}));

/**
 * Save grid column preferences (admin only)
 * @route PUT /api/admin/grid-preferences/:gridId
 * @param {string} gridId - Grid identifier
 * @body {Object} { visibleColumns, columnOrder, columnWidths }
 * @description Saves preferences that will be used by all users
 */
router.put('/grid-preferences/:gridId', requireAdmin, asyncHandler(async (req: Request, res: Response) => {
    const { gridId } = req.params;
    const { visibleColumns, columnOrder, columnWidths } = req.body as GridPreferences;
    const key = `grid_preferences_${gridId}`;

    const preferences: GridPreferences = {
        visibleColumns,
        columnOrder,
        columnWidths,
        updatedAt: new Date().toISOString(),
        updatedBy: req.user?.email || 'admin',
    };

    await req.prisma.systemSetting.upsert({
        where: { key },
        update: { value: JSON.stringify(preferences) },
        create: { key, value: JSON.stringify(preferences) }
    });

    res.json({
        message: 'Grid preferences saved',
        gridId,
        preferences,
    });
}));

// ============================================
// USER-SPECIFIC GRID PREFERENCES
// ============================================

interface UserGridPreferencesResponse {
    visibleColumns: string[];
    columnOrder: string[];
    columnWidths: Record<string, number>;
    adminVersion: string | null;
}

/**
 * Get current user's grid preferences
 * @route GET /api/admin/grid-preferences/:gridId/user
 * @param {string} gridId - Grid identifier
 * @returns {Object|null} User's preferences or null if not set
 */
router.get('/grid-preferences/:gridId/user', authenticateToken, asyncHandler(async (req: Request, res: Response) => {
    const gridId = req.params.gridId as string;
    const userId = req.user?.id;

    if (!userId) {
        return res.status(401).json({ error: 'User not authenticated' });
    }

    const userPref = await req.prisma.userGridPreference.findUnique({
        where: { userId_gridId: { userId, gridId } }
    });

    if (!userPref) {
        return res.json(null);
    }

    const response: UserGridPreferencesResponse = {
        visibleColumns: JSON.parse(userPref.visibleColumns),
        columnOrder: JSON.parse(userPref.columnOrder),
        columnWidths: JSON.parse(userPref.columnWidths),
        adminVersion: userPref.adminVersion?.toISOString() ?? null,
    };

    res.json(response);
}));

/**
 * Save current user's grid preferences
 * @route PUT /api/admin/grid-preferences/:gridId/user
 * @param {string} gridId - Grid identifier
 * @body {Object} { visibleColumns, columnOrder, columnWidths, adminVersion? }
 */
router.put('/grid-preferences/:gridId/user', authenticateToken, asyncHandler(async (req: Request, res: Response) => {
    const gridId = req.params.gridId as string;
    const userId = req.user?.id;
    const { visibleColumns, columnOrder, columnWidths, adminVersion } = req.body;

    if (!userId) {
        return res.status(401).json({ error: 'User not authenticated' });
    }

    if (!visibleColumns || !columnOrder || !columnWidths) {
        return res.status(400).json({ error: 'Missing required fields: visibleColumns, columnOrder, columnWidths' });
    }

    const userPref = await req.prisma.userGridPreference.upsert({
        where: { userId_gridId: { userId, gridId } },
        update: {
            visibleColumns: JSON.stringify(visibleColumns),
            columnOrder: JSON.stringify(columnOrder),
            columnWidths: JSON.stringify(columnWidths),
            adminVersion: adminVersion ? new Date(adminVersion) : undefined,
        },
        create: {
            userId,
            gridId,
            visibleColumns: JSON.stringify(visibleColumns),
            columnOrder: JSON.stringify(columnOrder),
            columnWidths: JSON.stringify(columnWidths),
            adminVersion: adminVersion ? new Date(adminVersion) : null,
        }
    });

    res.json({
        message: 'User preferences saved',
        gridId,
        updatedAt: userPref.updatedAt.toISOString(),
    });
}));

/**
 * Delete current user's grid preferences (reset to admin defaults)
 * @route DELETE /api/admin/grid-preferences/:gridId/user
 * @param {string} gridId - Grid identifier
 */
router.delete('/grid-preferences/:gridId/user', authenticateToken, asyncHandler(async (req: Request, res: Response) => {
    const gridId = req.params.gridId as string;
    const userId = req.user?.id;

    if (!userId) {
        return res.status(401).json({ error: 'User not authenticated' });
    }

    await req.prisma.userGridPreference.deleteMany({
        where: { userId, gridId }
    });

    res.json({
        message: 'User preferences deleted, will use admin defaults',
        gridId,
    });
}));

// ============================================
// SHEET OFFLOAD — STATUS & BUFFER COUNTS
// ============================================

/**
 * Get sheet offload worker status including pending buffer counts
 * @route GET /api/admin/sheet-offload/status
 */
router.get('/sheet-offload/status', requireAdmin, asyncHandler(async (_req: Request, res: Response) => {
    const status = sheetOffloadWorker.getStatus();
    const bufferCounts = await sheetOffloadWorker.getBufferCounts();

    res.json({
        ingestInward: status.ingestInward,
        ingestOutward: status.ingestOutward,
        moveShipped: status.moveShipped,
        schedulerActive: status.schedulerActive,
        intervalMs: status.intervalMs,
        bufferCounts,
    });
}));

/**
 * Manually trigger ingest inward
 * @route POST /api/admin/sheet-offload/trigger
 * @deprecated Use /api/admin/background-jobs/ingest_inward/trigger instead
 */
router.post('/sheet-offload/trigger', requireAdmin, asyncHandler(async (_req: Request, res: Response) => {
    const inwardResult = await sheetOffloadWorker.triggerIngestInward();
    const outwardResult = await sheetOffloadWorker.triggerIngestOutward();

    res.json({
        message: 'Sheet offload sync completed',
        inwardResult,
        outwardResult,
    });
}));

// ============================================
// SHEET MONITOR — INVENTORY & INGESTION STATS
// ============================================

/**
 * Get sheet monitor stats: inventory totals, ingestion counts, recent sheet transactions
 * @route GET /api/admin/sheet-monitor/stats
 */
router.get('/sheet-monitor/stats', requireAdmin, asyncHandler(async (req: Request, res: Response) => {
    const prisma = req.prisma;

    const [
        totalSkus,
        balanceAgg,
        inStockCount,
        inwardLiveCount,
        outwardLiveCount,
        historicalInwardCount,
        historicalOutwardCount,
        recentTransactions,
    ] = await Promise.all([
        prisma.sku.count(),
        prisma.sku.aggregate({ _sum: { currentBalance: true } }),
        prisma.sku.count({ where: { currentBalance: { gt: 0 } } }),
        prisma.inventoryTransaction.count({ where: { referenceId: { startsWith: 'sheet:inward-live' } } }),
        prisma.inventoryTransaction.count({ where: { referenceId: { startsWith: 'sheet:outward-live' } } }),
        prisma.inventoryTransaction.count({
            where: {
                OR: [
                    { referenceId: { startsWith: 'sheet:inward-final' } },
                    { referenceId: { startsWith: 'sheet:inward-archive' } },
                ],
            },
        }),
        prisma.inventoryTransaction.count({
            where: {
                OR: [
                    { referenceId: { startsWith: 'sheet:outward:' } },
                    { referenceId: { startsWith: 'sheet:ms-outward' } },
                    { referenceId: { startsWith: 'sheet:orders-outward' } },
                ],
            },
        }),
        prisma.inventoryTransaction.findMany({
            where: {
                OR: [
                    { referenceId: { startsWith: 'sheet:inward-live' } },
                    { referenceId: { startsWith: 'sheet:outward-live' } },
                ],
            },
            select: {
                id: true,
                txnType: true,
                qty: true,
                reason: true,
                referenceId: true,
                createdAt: true,
                sku: { select: { skuCode: true } },
            },
            orderBy: { createdAt: 'desc' },
            take: 20,
        }),
    ]);

    res.json({
        inventory: {
            totalSkus,
            totalBalance: balanceAgg._sum.currentBalance ?? 0,
            inStock: inStockCount,
            outOfStock: totalSkus - inStockCount,
        },
        ingestion: {
            totalInwardLive: inwardLiveCount,
            totalOutwardLive: outwardLiveCount,
            historicalInward: historicalInwardCount,
            historicalOutward: historicalOutwardCount,
        },
        recentTransactions: recentTransactions.map(t => ({
            id: t.id,
            skuCode: t.sku.skuCode,
            txnType: t.txnType,
            quantity: t.qty,
            reason: t.reason,
            referenceId: t.referenceId,
            createdAt: t.createdAt.toISOString(),
        })),
    });
}));

export default router;
