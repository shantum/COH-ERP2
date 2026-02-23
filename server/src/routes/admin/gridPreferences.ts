import { Router } from 'express';
import type { Request, Response } from 'express';
import { authenticateToken, requireAdmin } from '../../middleware/auth.js';
import { asyncHandler } from '../../middleware/asyncHandler.js';
import type { GridPreferences, UserGridPreferencesResponse } from './types.js';

const router = Router();

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

export default router;
