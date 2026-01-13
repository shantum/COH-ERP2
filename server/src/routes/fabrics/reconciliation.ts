/**
 * Fabric Reconciliation Workflow
 * Handles physical count reconciliation process
 */

import { Router } from 'express';
import type { Request, Response } from 'express';
import { authenticateToken } from '../../middleware/auth.js';
import { asyncHandler } from '../../middleware/asyncHandler.js';
import { calculateFabricBalance } from '../../utils/queryPatterns.js';
import { chunkProcess } from '../../utils/asyncUtils.js';
import { NotFoundError, ValidationError, BusinessLogicError } from '../../utils/errors.js';
import type {
    FabricBalance,
    FabricWithRelations,
    Reconciliation,
    ReconciliationBasic,
    ReconciliationItemUpdate,
} from './types.js';

const router: Router = Router();

// ============================================
// FABRIC RECONCILIATION
// ============================================

// Get reconciliation history
router.get('/reconciliation/history', authenticateToken, asyncHandler(async (req: Request, res: Response) => {
    const limit = req.query.limit as string | undefined ?? '10';

    const reconciliations = await req.prisma.fabricReconciliation.findMany({
        include: {
            items: true,
        },
        orderBy: { createdAt: 'desc' },
        take: Number(limit),
    }) as unknown as ReconciliationBasic[];

    const history = reconciliations.map(r => ({
        id: r.id,
        date: r.reconcileDate,
        status: r.status,
        itemsCount: r.items.length,
        adjustments: r.items.filter(i => i.variance !== 0 && i.variance !== null).length,
        createdBy: r.createdBy,
        createdAt: r.createdAt,
    }));

    res.json(history);
}));

/**
 * POST /reconciliation/start
 * Initialize fabric reconciliation session with current system balances.
 *
 * @returns {Object} Reconciliation record with items (fabricId, systemQty)
 *
 * Creates draft reconciliation with pre-filled system quantities.
 * User enters physicalQty for each item, system calculates variance.
 */
router.post('/reconciliation/start', authenticateToken, asyncHandler(async (req: Request, res: Response) => {
    // Get all active fabrics with their current balances
    const fabrics = await req.prisma.fabric.findMany({
        where: { isActive: true },
        include: { fabricType: true },
        orderBy: { name: 'asc' },
    }) as FabricWithRelations[];

    // Calculate current balances (batched to prevent connection pool exhaustion)
    const fabricsWithBalance = await chunkProcess(fabrics, async (fabric: FabricWithRelations) => {
        const balance = await calculateFabricBalance(req.prisma, fabric.id) as FabricBalance;
        return {
            fabricId: fabric.id,
            fabricName: fabric.name,
            colorName: fabric.colorName,
            unit: fabric.fabricType.unit,
            systemQty: balance.currentBalance,
        };
    }, 5);

    // Create reconciliation record
    const reconciliation = await req.prisma.fabricReconciliation.create({
        data: {
            createdBy: req.user?.id || null,
            items: {
                create: fabricsWithBalance.map(f => ({
                    fabricId: f.fabricId,
                    systemQty: f.systemQty,
                })),
            },
        },
        include: {
            items: {
                include: {
                    fabric: { include: { fabricType: true } },
                },
            },
        },
    }) as Reconciliation;

    // Format response
    const response = {
        id: reconciliation.id,
        status: reconciliation.status,
        createdAt: reconciliation.createdAt,
        items: reconciliation.items.map(item => ({
            id: item.id,
            fabricId: item.fabricId,
            fabricName: item.fabric.name,
            colorName: item.fabric.colorName,
            unit: item.fabric.fabricType.unit,
            systemQty: item.systemQty,
            physicalQty: item.physicalQty,
            variance: item.variance,
            adjustmentReason: item.adjustmentReason,
            notes: item.notes,
        })),
    };

    res.status(201).json(response);
}));

// Get a specific reconciliation
router.get('/reconciliation/:id', authenticateToken, asyncHandler(async (req: Request, res: Response) => {
    const id = req.params.id as string;

    const reconciliation = await req.prisma.fabricReconciliation.findUnique({
        where: { id },
        include: {
            items: {
                include: {
                    fabric: { include: { fabricType: true } },
                },
            },
        },
    }) as Reconciliation | null;

    if (!reconciliation) {
        throw new NotFoundError('Reconciliation not found', 'FabricReconciliation', id);
    }

    const response = {
        id: reconciliation.id,
        status: reconciliation.status,
        notes: reconciliation.notes,
        createdAt: reconciliation.createdAt,
        items: reconciliation.items.map(item => ({
            id: item.id,
            fabricId: item.fabricId,
            fabricName: item.fabric.name,
            colorName: item.fabric.colorName,
            unit: item.fabric.fabricType.unit,
            systemQty: item.systemQty,
            physicalQty: item.physicalQty,
            variance: item.variance,
            adjustmentReason: item.adjustmentReason,
            notes: item.notes,
        })),
    };

    res.json(response);
}));

/**
 * PUT /reconciliation/:id
 * Update reconciliation items with physical count data.
 *
 * @param {Array<Object>} items - Array of {id, physicalQty, adjustmentReason, notes}
 * @returns {Object} Updated reconciliation with calculated variances
 *
 * Variance Calculation: variance = physicalQty - systemQty
 * Only editable in 'draft' status
 */
router.put('/reconciliation/:id', authenticateToken, asyncHandler(async (req: Request, res: Response) => {
    const { items } = req.body as { items: ReconciliationItemUpdate[] };
    const id = req.params.id as string;

    const reconciliation = await req.prisma.fabricReconciliation.findUnique({
        where: { id },
    });

    if (!reconciliation) {
        throw new NotFoundError('Reconciliation not found', 'FabricReconciliation', id);
    }

    if (reconciliation.status !== 'draft') {
        throw new BusinessLogicError('Cannot update submitted reconciliation', 'invalid_status');
    }

    // Update each item
    for (const item of items) {
        const variance = item.physicalQty !== null && item.physicalQty !== undefined
            ? item.physicalQty - item.systemQty
            : null;

        await req.prisma.fabricReconciliationItem.update({
            where: { id: item.id },
            data: {
                physicalQty: item.physicalQty,
                variance,
                adjustmentReason: item.adjustmentReason || null,
                notes: item.notes || null,
            },
        });
    }

    // Return updated reconciliation
    const updated = await req.prisma.fabricReconciliation.findUnique({
        where: { id },
        include: {
            items: {
                include: {
                    fabric: { include: { fabricType: true } },
                },
            },
        },
    }) as Reconciliation;

    res.json({
        id: updated.id,
        status: updated.status,
        items: updated.items.map(item => ({
            id: item.id,
            fabricId: item.fabricId,
            fabricName: item.fabric.name,
            colorName: item.fabric.colorName,
            unit: item.fabric.fabricType.unit,
            systemQty: item.systemQty,
            physicalQty: item.physicalQty,
            variance: item.variance,
            adjustmentReason: item.adjustmentReason,
            notes: item.notes,
        })),
    });
}));

/**
 * POST /reconciliation/:id/submit
 * Finalize reconciliation and create fabric adjustment transactions.
 *
 * @returns {Object} {status: 'submitted', adjustmentsMade: number, transactions: Array}
 *
 * Transaction Logic:
 * - variance > 0: Creates 'inward' transaction (found more than expected)
 * - variance < 0: Creates 'outward' transaction (found less than expected)
 * - variance = 0: No transaction created
 *
 * Validation:
 * - All items must have physicalQty entered
 * - Variances require adjustmentReason
 * - Only 'draft' reconciliations can be submitted
 */
router.post('/reconciliation/:id/submit', authenticateToken, asyncHandler(async (req: Request, res: Response) => {
    const id = req.params.id as string;

    const reconciliation = await req.prisma.fabricReconciliation.findUnique({
        where: { id },
        include: {
            items: {
                include: {
                    fabric: { include: { fabricType: true } },
                },
            },
        },
    }) as Reconciliation | null;

    if (!reconciliation) {
        throw new NotFoundError('Reconciliation not found', 'FabricReconciliation', id);
    }

    if (reconciliation.status !== 'draft') {
        throw new BusinessLogicError('Reconciliation already submitted', 'invalid_status');
    }

    interface TransactionRecord {
        fabricId: string;
        fabricName: string;
        txnType: string;
        qty: number;
        reason: string;
    }

    const transactions: TransactionRecord[] = [];

    // Create adjustment transactions for variances
    for (const item of reconciliation.items) {
        if (item.variance === null || item.variance === 0) continue;

        if (item.physicalQty === null) {
            throw new ValidationError(`Physical quantity not entered for ${item.fabric.name}`);
        }

        if (!item.adjustmentReason && item.variance !== 0) {
            throw new ValidationError(`Adjustment reason required for ${item.fabric.name} (variance: ${item.variance})`);
        }

        const txnType = item.variance > 0 ? 'inward' : 'outward';
        const qty = Math.abs(item.variance);
        const reason = `reconciliation_${item.adjustmentReason}`;

        const txn = await req.prisma.fabricTransaction.create({
            data: {
                fabricId: item.fabricId,
                txnType,
                qty,
                unit: item.fabric.fabricType.unit,
                reason,
                referenceId: reconciliation.id,
                notes: item.notes || `Reconciliation adjustment: ${item.adjustmentReason}`,
                createdById: req.user!.id,
            },
        });

        transactions.push({
            fabricId: item.fabricId,
            fabricName: item.fabric.name,
            txnType,
            qty,
            reason: item.adjustmentReason || '',
        });

        // Link transaction to item
        await req.prisma.fabricReconciliationItem.update({
            where: { id: item.id },
            data: { txnId: txn.id },
        });
    }

    // Mark reconciliation as submitted
    await req.prisma.fabricReconciliation.update({
        where: { id },
        data: { status: 'submitted' },
    });

    res.json({
        id: reconciliation.id,
        status: 'submitted',
        adjustmentsMade: transactions.length,
        transactions,
    });
}));

// Delete a draft reconciliation
router.delete('/reconciliation/:id', authenticateToken, asyncHandler(async (req: Request, res: Response) => {
    const id = req.params.id as string;

    const reconciliation = await req.prisma.fabricReconciliation.findUnique({
        where: { id },
    });

    if (!reconciliation) {
        throw new NotFoundError('Reconciliation not found', 'FabricReconciliation', id);
    }

    if (reconciliation.status !== 'draft') {
        throw new BusinessLogicError('Cannot delete submitted reconciliation', 'invalid_status');
    }

    await req.prisma.fabricReconciliation.delete({
        where: { id },
    });

    res.json({ message: 'Reconciliation deleted' });
}));

export default router;
