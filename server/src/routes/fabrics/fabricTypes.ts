/**
 * Fabric Type CRUD Operations
 * Handles fabric type management endpoints
 */

import { Router } from 'express';
import type { Request, Response } from 'express';
import { authenticateToken } from '../../middleware/auth.js';
import { requirePermission } from '../../middleware/permissions.js';
import { asyncHandler } from '../../middleware/asyncHandler.js';
import { BusinessLogicError } from '../../utils/errors.js';

const router: Router = Router();

// ============================================
// FABRIC TYPES
// ============================================

// Get all fabric types (only those with active fabrics)
router.get('/types', authenticateToken, asyncHandler(async (req: Request, res: Response) => {
    const types = await req.prisma.fabricType.findMany({
        where: {
            fabrics: {
                some: { isActive: true },
            },
        },
        include: {
            fabrics: { where: { isActive: true } },
        },
        orderBy: { name: 'asc' },
    });
    res.json(types);
}));

// Create fabric type
router.post('/types', authenticateToken, requirePermission('fabrics:edit:type'), asyncHandler(async (req: Request, res: Response) => {
    const { name, composition, unit, avgShrinkagePct, defaultCostPerUnit, defaultLeadTimeDays, defaultMinOrderQty } = req.body;

    const fabricType = await req.prisma.fabricType.create({
        data: {
            name,
            composition,
            unit,
            avgShrinkagePct: avgShrinkagePct || 0,
            defaultCostPerUnit: defaultCostPerUnit || null,
            defaultLeadTimeDays: defaultLeadTimeDays || null,
            defaultMinOrderQty: defaultMinOrderQty || null,
        },
    });

    res.status(201).json(fabricType);
}));

// Update fabric type
router.put('/types/:id', authenticateToken, requirePermission('fabrics:edit:type'), asyncHandler(async (req: Request, res: Response) => {
    const { name, composition, unit, avgShrinkagePct, defaultCostPerUnit, defaultLeadTimeDays, defaultMinOrderQty } = req.body;
    const id = req.params.id as string;

    // Don't allow renaming the Default fabric type
    const existing = await req.prisma.fabricType.findUnique({ where: { id } });
    if (existing?.name === 'Default' && name && name !== 'Default') {
        throw new BusinessLogicError('Cannot rename the Default fabric type', 'protected_resource');
    }

    const fabricType = await req.prisma.fabricType.update({
        where: { id },
        data: {
            name,
            composition,
            unit,
            avgShrinkagePct,
            defaultCostPerUnit,
            defaultLeadTimeDays,
            defaultMinOrderQty,
        },
    });

    res.json(fabricType);
}));

export default router;
