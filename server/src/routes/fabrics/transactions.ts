/**
 * Fabric Transactions and Balance Operations
 * Handles fabric transactions, balance queries, suppliers, and orders
 */

import { Router } from 'express';
import type { Request, Response } from 'express';
import { authenticateToken } from '../../middleware/auth.js';
import { requirePermission, requireAnyPermission } from '../../middleware/permissions.js';
import { asyncHandler } from '../../middleware/asyncHandler.js';
import { calculateFabricBalance } from '../../utils/queryPatterns.js';
import { chunkProcess } from '../../utils/asyncUtils.js';
import { NotFoundError } from '../../utils/errors.js';
import type {
    FabricBalance,
    FabricWithRelations,
    StockStatus,
    StockAnalysisItem,
    FabricOrderWithRelations,
} from './types.js';
import { statusOrder } from './types.js';

const router: Router = Router();

// ============================================
// HELPER FUNCTIONS
// ============================================

/**
 * Calculate average daily fabric consumption over 28 days.
 * Used for reorder point calculations and stock analysis.
 *
 * @param prisma - Prisma client
 * @param fabricId - Fabric ID
 * @returns Average daily consumption (units/day)
 */
async function calculateAvgDailyConsumption(prisma: Request['prisma'], fabricId: string): Promise<number> {
    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 28);

    const result = await prisma.fabricTransaction.aggregate({
        where: {
            fabricId,
            txnType: 'outward',
            createdAt: { gte: thirtyDaysAgo },
        },
        _sum: { qty: true },
    });

    const totalConsumption = Number(result._sum.qty) || 0;
    return totalConsumption / 28;
}

// ============================================
// FABRIC TRANSACTIONS
// ============================================

// Get all fabric transactions (batch endpoint for Ledgers page)
router.get('/transactions/all', authenticateToken, asyncHandler(async (req: Request, res: Response) => {
    const limit = req.query.limit as string | undefined ?? '500';
    const days = req.query.days as string | undefined ?? '30';

    const startDate = new Date();
    startDate.setDate(startDate.getDate() - Number(days));

    const transactions = await req.prisma.fabricTransaction.findMany({
        where: {
            createdAt: { gte: startDate }
        },
        include: {
            fabric: {
                select: {
                    id: true,
                    name: true,
                    colorName: true,
                    fabricType: { select: { id: true, name: true } }
                }
            },
            createdBy: { select: { id: true, name: true } },
            supplier: { select: { id: true, name: true } }
        },
        orderBy: { createdAt: 'desc' },
        take: Number(limit),
    });

    res.json(transactions);
}));

// Get transactions for a fabric
router.get('/:id/transactions', authenticateToken, asyncHandler(async (req: Request, res: Response) => {
    const id = req.params.id as string;
    const limit = req.query.limit as string | undefined ?? '50';
    const offset = req.query.offset as string | undefined ?? '0';

    const transactions = await req.prisma.fabricTransaction.findMany({
        where: { fabricId: id },
        include: {
            createdBy: { select: { id: true, name: true } },
            supplier: { select: { id: true, name: true } }
        },
        orderBy: { createdAt: 'desc' },
        take: Number(limit),
        skip: Number(offset),
    });

    res.json(transactions);
}));

// Create fabric transaction (inward/outward)
router.post('/:id/transactions', authenticateToken, requireAnyPermission('fabrics:inward', 'fabrics:outward'), asyncHandler(async (req: Request, res: Response) => {
    const { txnType, qty, unit, reason, referenceId, notes, costPerUnit, supplierId } = req.body;
    const id = req.params.id as string;

    const transaction = await req.prisma.fabricTransaction.create({
        data: {
            fabricId: id,
            txnType,
            qty,
            unit,
            reason,
            referenceId,
            notes,
            costPerUnit: costPerUnit || null,
            supplierId: supplierId || null,
            createdById: req.user!.id,
        },
        include: {
            createdBy: { select: { id: true, name: true } },
            supplier: { select: { id: true, name: true } },
        },
    });

    res.status(201).json(transaction);
}));

// Delete fabric transaction (requires fabrics:delete:transaction permission)
router.delete('/transactions/:txnId', authenticateToken, requirePermission('fabrics:delete:transaction'), asyncHandler(async (req: Request, res: Response) => {
    const txnId = req.params.txnId as string;
    // Permission check replaces old admin role check

    const transaction = await req.prisma.fabricTransaction.findUnique({
        where: { id: txnId },
    });

    if (!transaction) {
        throw new NotFoundError('Transaction not found', 'FabricTransaction', txnId);
    }

    await req.prisma.fabricTransaction.delete({
        where: { id: txnId },
    });

    res.json({ message: 'Transaction deleted', id: txnId });
}));

// ============================================
// FABRIC BALANCE DASHBOARD
// ============================================

// Get fabric stock analysis (with reorder recommendations)
router.get('/dashboard/stock-analysis', authenticateToken, asyncHandler(async (req: Request, res: Response) => {
    const fabrics = await req.prisma.fabric.findMany({
        where: { isActive: true },
        include: { fabricType: true, supplier: true },
    }) as FabricWithRelations[];

    const analysis: StockAnalysisItem[] = await chunkProcess(fabrics, async (fabric: FabricWithRelations): Promise<StockAnalysisItem> => {
        const balance = await calculateFabricBalance(req.prisma, fabric.id) as FabricBalance;
        const avgDailyConsumption = await calculateAvgDailyConsumption(req.prisma, fabric.id);

        const daysOfStock = avgDailyConsumption > 0
            ? balance.currentBalance / avgDailyConsumption
            : null;

        const leadTimeDays = fabric.leadTimeDays ?? 14;
        const reorderPoint = avgDailyConsumption * (leadTimeDays + 7);

        let status: StockStatus = 'OK';
        if (balance.currentBalance <= reorderPoint) {
            status = 'ORDER NOW';
        } else if (balance.currentBalance <= avgDailyConsumption * (leadTimeDays + 14)) {
            status = 'ORDER SOON';
        }

        const suggestedOrderQty = Math.max(
            Number(fabric.minOrderQty ?? 10),
            (avgDailyConsumption * 30) - balance.currentBalance + (avgDailyConsumption * leadTimeDays)
        );

        return {
            fabricId: fabric.id,
            fabricName: fabric.name,
            colorName: fabric.colorName,
            unit: fabric.fabricType.unit,
            currentBalance: balance.currentBalance.toFixed(2),
            avgDailyConsumption: avgDailyConsumption.toFixed(3),
            daysOfStock: daysOfStock ? Math.floor(daysOfStock) : null,
            reorderPoint: reorderPoint.toFixed(2),
            status,
            suggestedOrderQty: Math.ceil(suggestedOrderQty),
            leadTimeDays: fabric.leadTimeDays,
            costPerUnit: fabric.costPerUnit,
            supplier: fabric.supplier?.name || 'No supplier',
        };
    }, 5);

    // Sort by status priority
    analysis.sort((a, b) => statusOrder[a.status] - statusOrder[b.status]);

    res.json(analysis);
}));

// ============================================
// SUPPLIERS
// ============================================

router.get('/suppliers/all', authenticateToken, asyncHandler(async (req: Request, res: Response) => {
    const suppliers = await req.prisma.supplier.findMany({
        where: { isActive: true },
        orderBy: { name: 'asc' },
    });
    res.json(suppliers);
}));

router.post('/suppliers', authenticateToken, asyncHandler(async (req: Request, res: Response) => {
    const { name, contactName, email, phone, address } = req.body;

    const supplier = await req.prisma.supplier.create({
        data: { name, contactName, email, phone, address },
    });

    res.status(201).json(supplier);
}));

// ============================================
// FABRIC ORDERS
// ============================================

router.get('/orders/all', authenticateToken, asyncHandler(async (req: Request, res: Response) => {
    const status = req.query.status as string | undefined;
    const where = status ? { status } : {};

    const orders = await req.prisma.fabricOrder.findMany({
        where,
        include: {
            fabric: { include: { fabricType: true } },
            supplier: true,
        },
        orderBy: { orderDate: 'desc' },
    });

    res.json(orders);
}));

router.post('/orders', authenticateToken, asyncHandler(async (req: Request, res: Response) => {
    const { fabricId, supplierId, qtyOrdered, unit, costPerUnit, expectedDate, notes } = req.body;

    const totalCost = Number(qtyOrdered) * Number(costPerUnit);

    const order = await req.prisma.fabricOrder.create({
        data: {
            fabricId,
            supplierId,
            qtyOrdered,
            unit,
            costPerUnit,
            totalCost,
            expectedDate: expectedDate ? new Date(expectedDate) : null,
            notes,
        },
        include: {
            fabric: true,
            supplier: true,
        },
    });

    res.status(201).json(order);
}));

// Mark fabric order received (creates inward transaction)
router.post('/orders/:id/receive', authenticateToken, asyncHandler(async (req: Request, res: Response) => {
    const { qtyReceived, notes } = req.body;
    const id = req.params.id as string;

    const order = await req.prisma.fabricOrder.findUnique({
        where: { id },
        include: { fabric: { include: { fabricType: true } } },
    }) as FabricOrderWithRelations | null;

    if (!order) {
        throw new NotFoundError('Order not found', 'FabricOrder', id);
    }

    // Update order
    const updatedOrder = await req.prisma.fabricOrder.update({
        where: { id },
        data: {
            qtyReceived,
            receivedDate: new Date(),
            status: Number(qtyReceived) >= Number(order.qtyOrdered) ? 'received' : 'partial',
            notes: notes || order.notes,
        },
    });

    // Create inward transaction
    await req.prisma.fabricTransaction.create({
        data: {
            fabricId: order.fabricId,
            txnType: 'inward',
            qty: qtyReceived,
            unit: order.unit,
            reason: 'supplier_receipt',
            referenceId: order.id,
            notes: `Received against PO ${order.id}`,
            createdById: req.user!.id,
        },
    });

    res.json(updatedOrder);
}));

export default router;
