/**
 * Order Line Mutations Server Functions
 *
 * Line-level mutations: updateLine, addLine, updateLineNotes.
 * Extracted from orderMutations.ts for maintainability.
 */

import { createServerFn } from '@tanstack/react-start';
import { z } from 'zod';
import { authMiddleware } from '../middleware/auth';
import { getPrisma, type PrismaTransaction } from '@coh/shared/services/db';
import type { Prisma } from '@prisma/client';
import type {
    MutationResult,
    UpdateLineResult,
    AddLineResult,
    UpdateLineNotesResult,
} from './orderMutations';
import { broadcastUpdate } from './orderMutations';

// ============================================
// INPUT SCHEMAS
// ============================================

const updateLineSchema = z.object({
    lineId: z.string().uuid('Invalid line ID'),
    qty: z.number().int().positive().optional(),
    unitPrice: z.number().nonnegative().optional(),
    notes: z.string().optional(),
    awbNumber: z.string().optional(),
    courier: z.string().optional(),
});

const addLineSchema = z.object({
    orderId: z.string().uuid('Invalid order ID'),
    skuId: z.string().uuid('Invalid SKU ID'),
    qty: z.number().int().positive(),
    unitPrice: z.number().nonnegative(),
});

const updateLineNotesSchema = z.object({
    lineId: z.string().uuid('Invalid line ID'),
    notes: z.string(),
});

// ============================================
// SERVER FUNCTIONS
// ============================================

/**
 * Update order line fields (qty, price, notes, tracking)
 */
export const updateLine = createServerFn({ method: 'POST' })
    .middleware([authMiddleware])
    .inputValidator((input: unknown) => updateLineSchema.parse(input))
    .handler(async ({ data, context }): Promise<MutationResult<UpdateLineResult>> => {
        const prisma = await getPrisma();
        const { lineId, qty, unitPrice, notes, awbNumber, courier } = data;

        const line = await prisma.orderLine.findUnique({
            where: { id: lineId },
            include: { order: true },
        });

        if (!line) {
            return {
                success: false,
                error: { code: 'NOT_FOUND', message: 'Order line not found' },
            };
        }

        // Build update data
        const updateData: Prisma.OrderLineUpdateInput = {};
        if (qty !== undefined) updateData.qty = qty;
        if (unitPrice !== undefined) updateData.unitPrice = unitPrice;
        if (notes !== undefined) updateData.notes = notes;
        if (awbNumber !== undefined) updateData.awbNumber = awbNumber || null;
        if (courier !== undefined) updateData.courier = courier || null;

        const hasQtyOrPrice = qty !== undefined || unitPrice !== undefined;

        // If only updating simple fields, no transaction needed
        if (!hasQtyOrPrice) {
            await prisma.orderLine.update({
                where: { id: lineId },
                data: updateData,
            });
        } else {
            // qty/unitPrice changes need transaction to update order total
            await prisma.$transaction(async (tx: PrismaTransaction) => {
                await tx.orderLine.update({
                    where: { id: lineId },
                    data: updateData,
                });

                const allLines = await tx.orderLine.findMany({
                    where: { orderId: line.orderId },
                });
                const newTotal = allLines.reduce((sum: number, l: { id: string; qty: number; unitPrice: number }) => {
                    const lineQty = l.id === lineId ? (qty ?? l.qty) : l.qty;
                    const linePrice = l.id === lineId ? (unitPrice ?? l.unitPrice) : l.unitPrice;
                    return sum + lineQty * linePrice;
                }, 0);
                await tx.order.update({
                    where: { id: line.orderId },
                    data: { totalAmount: newTotal },
                });
            });
        }

        // Broadcast SSE update
        broadcastUpdate(
            {
                type: 'line_status',
                view: 'open',
                lineId,
                orderId: line.orderId,
                changes: updateData,
            },
            context.user.id
        );

        // Log domain event for significant line changes (status, AWB)
        if (awbNumber !== undefined || qty !== undefined) {
            import('@coh/shared/services/eventLog').then(({ logEvent }) =>
                logEvent({ domain: 'orders', event: 'line.updated', entityType: 'OrderLine', entityId: lineId, summary: `Line updated on order #${line.order.orderNumber}`, meta: { changes: Object.keys(updateData), orderId: line.orderId }, actorId: context.user.id })
            );
        }

        return {
            success: true,
            data: {
                lineId,
                orderId: line.orderId,
                updated: true,
            },
        };
    });

/**
 * Add a new line to an order
 */
export const addLine = createServerFn({ method: 'POST' })
    .middleware([authMiddleware])
    .inputValidator((input: unknown) => addLineSchema.parse(input))
    .handler(async ({ data, context }): Promise<MutationResult<AddLineResult>> => {
        const prisma = await getPrisma();
        const { orderId, skuId, qty, unitPrice } = data;

        let newLineId: string = '';

        try {
            await prisma.$transaction(async (tx: PrismaTransaction) => {
                // Read fresh state INSIDE transaction to prevent TOCTOU race
                const order = await tx.order.findUnique({
                    where: { id: orderId },
                    select: { id: true, status: true },
                });

                if (!order) throw new Error('NOT_FOUND:Order not found');
                if (order.status === 'shipped' || order.status === 'cancelled') {
                    throw new Error(`BAD_REQUEST:Cannot add lines to ${order.status} orders`);
                }

                const newLine = await tx.orderLine.create({
                    data: {
                        orderId,
                        skuId,
                        qty,
                        unitPrice,
                        lineStatus: 'pending',
                    },
                });
                newLineId = newLine.id;

                const allLines = await tx.orderLine.findMany({
                    where: { orderId },
                });
                const newTotal = allLines.reduce((sum: number, l: { qty: number; unitPrice: number }) => sum + l.qty * l.unitPrice, 0);
                await tx.order.update({
                    where: { id: orderId },
                    data: { totalAmount: newTotal },
                });
            });
        } catch (error: unknown) {
            console.error('[orders] addLine failed:', error);
            const message = error instanceof Error ? error.message : 'Unknown error';
            const [code, msg] = message.includes(':') ? message.split(':', 2) : ['INTERNAL', message];
            return { success: false, error: { code: code as 'NOT_FOUND' | 'BAD_REQUEST' | 'INTERNAL', message: msg as string } };
        }

        // Broadcast SSE update
        broadcastUpdate(
            {
                type: 'order_updated',
                orderId,
                affectedViews: ['open'],
                changes: { lineAdded: newLineId },
            },
            context.user.id
        );

        // Log domain event
        import('@coh/shared/services/eventLog').then(({ logEvent }) =>
            logEvent({ domain: 'orders', event: 'line.added', entityType: 'OrderLine', entityId: newLineId, summary: `Line added to order`, meta: { orderId, skuId, qty, unitPrice }, actorId: context.user.id })
        );

        return {
            success: true,
            data: {
                lineId: newLineId,
                orderId,
                skuId,
                qty,
            },
        };
    });

/**
 * Update notes on a line
 */
export const updateLineNotes = createServerFn({ method: 'POST' })
    .middleware([authMiddleware])
    .inputValidator((input: unknown) => updateLineNotesSchema.parse(input))
    .handler(async ({ data, context }): Promise<MutationResult<UpdateLineNotesResult>> => {
        const prisma = await getPrisma();
        const { lineId, notes } = data;

        // Fetch line
        const line = await prisma.orderLine.findUnique({
            where: { id: lineId },
            select: { id: true, orderId: true },
        });

        if (!line) {
            return {
                success: false,
                error: { code: 'NOT_FOUND', message: 'Order line not found' },
            };
        }

        // Update notes
        await prisma.orderLine.update({
            where: { id: lineId },
            data: { notes },
        });

        // Broadcast SSE update
        broadcastUpdate(
            {
                type: 'line_notes_updated',
                lineId,
                orderId: line.orderId,
                changes: { notes },
            },
            context.user.id
        );

        return {
            success: true,
            data: {
                lineId,
                orderId: line.orderId,
                notes,
            },
        };
    });
