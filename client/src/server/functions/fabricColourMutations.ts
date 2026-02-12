/**
 * Fabric Colour Mutations Server Functions
 *
 * TanStack Start Server Functions for fabric colour transaction and reconciliation mutations.
 * Handles transactions (inward/outward) and reconciliation workflow (draft → submit).
 *
 * This is the NEW system replacing FabricTransaction/FabricReconciliation.
 *
 * IMPORTANT: All database imports are dynamic to prevent Node.js code
 * (pg, Buffer) from being bundled into the client.
 */

import { createServerFn } from '@tanstack/react-start';
import { z } from 'zod';
import { authMiddleware } from '../middleware/auth';
import { getPrisma } from '@coh/shared/services/db';
import type { PrismaClient } from '@prisma/client';

// ============================================
// PRISMA TYPE ALIASES
// ============================================

/**
 * Type alias for PrismaClient instance.
 * Used for helper functions that need prisma parameter.
 */
type PrismaInstance = InstanceType<typeof PrismaClient>;

/**
 * Type alias for Prisma transaction client.
 * Used in $transaction callbacks.
 */
type PrismaTransaction = Omit<
    PrismaInstance,
    '$connect' | '$disconnect' | '$on' | '$transaction' | '$use' | '$extends'
>;

// ============================================
// INTERNAL TYPE DEFINITIONS
// ============================================

/**
 * FabricColour with relations
 */
interface FabricColourWithRelations {
    id: string;
    fabricId: string;
    colourName: string;
    fabric: {
        id: string;
        name: string;
        unit: string | null;
        material: {
            id: string;
            name: string;
        } | null;
    };
}

/**
 * Transaction with relations
 */
interface TransactionWithRelations {
    id: string;
    fabricColourId: string;
    txnType: string;
    qty: number;
    unit: string;
    reason: string;
    costPerUnit: number | null;
    referenceId: string | null;
    notes: string | null;
    partyId: string | null;
    createdById: string;
    createdAt: Date;
    createdBy: { id: string; name: string };
    party: { id: string; name: string } | null;
}

/**
 * Reconciliation item with fabric colour relation
 */
interface ReconciliationItemWithFabricColour {
    id: string;
    fabricColourId: string;
    systemQty: number;
    physicalQty: number | null;
    variance: number | null;
    adjustmentReason: string | null;
    notes: string | null;
    fabricColour: FabricColourWithRelations;
}

/**
 * Reconciliation with items relation
 */
interface ReconciliationWithItems {
    id: string;
    status: string;
    createdAt: Date;
    items: ReconciliationItemWithFabricColour[];
}

// ============================================
// RETURN TYPES
// ============================================

type TransactionSuccessResult = {
    success: true;
    transaction: TransactionWithRelations;
};

type TransactionErrorResult = {
    success: false;
    error: {
        code: 'NOT_FOUND' | 'FORBIDDEN' | 'BAD_REQUEST';
        message: string;
    };
};

type DeleteTransactionSuccessResult = {
    success: true;
    id: string;
};

type UpdateReconciliationItemsSuccessResult = {
    success: true;
    data: {
        id: string;
        status: string;
        createdAt: Date;
        items: Array<{
            id: string;
            fabricColourId: string;
            materialName: string;
            fabricName: string;
            colourName: string;
            unit: string;
            systemQty: number;
            physicalQty: number | null;
            variance: number | null;
            adjustmentReason: string | null;
            notes: string | null;
        }>;
    };
};

type UpdateReconciliationItemsErrorResult = {
    success: false;
    error: {
        code: 'NOT_FOUND' | 'BAD_REQUEST';
        message: string;
    };
};

type SubmitReconciliationSuccessResult = {
    success: true;
    data: {
        reconciliationId: string;
        status: string;
        adjustmentsMade: number;
    };
};

type SubmitReconciliationErrorResult = {
    success: false;
    error: {
        code: 'NOT_FOUND' | 'BAD_REQUEST';
        message: string;
    };
};

type DeleteReconciliationSuccessResult = {
    success: true;
    data: {
        reconciliationId: string;
        deleted: boolean;
    };
};

type DeleteReconciliationErrorResult = {
    success: false;
    error: {
        code: 'NOT_FOUND' | 'BAD_REQUEST';
        message: string;
    };
};

// ============================================
// INPUT SCHEMAS
// ============================================

const createTransactionSchema = z.object({
    fabricColourId: z.string().uuid('Invalid fabric colour ID'),
    txnType: z.enum(['inward', 'outward']),
    qty: z.number().positive('Quantity must be positive'),
    unit: z.enum(['meter', 'kg', 'yard']).default('meter'),
    reason: z.string().min(1, 'Reason is required'),
    referenceId: z.string().optional().nullable(),
    notes: z.string().optional().nullable(),
    costPerUnit: z.number().positive().optional().nullable(),
    partyId: z.string().uuid().optional().nullable(),
});

const deleteTransactionSchema = z.object({
    txnId: z.string().uuid('Invalid transaction ID'),
});

const updateTransactionSchema = z.object({
    id: z.string().uuid('Invalid transaction ID'),
    qty: z.number().positive('Quantity must be positive').optional(),
    costPerUnit: z.number().positive('Cost must be positive').optional().nullable(),
    partyId: z.string().uuid().optional().nullable(),
    notes: z.string().max(500).optional().nullable(),
});

const updateFabricColourReconciliationItemsInputSchema = z.object({
    reconciliationId: z.string().uuid('Invalid reconciliation ID'),
    items: z.array(
        z.object({
            id: z.string().uuid('Invalid item ID'),
            physicalQty: z.number().nullable(),
            systemQty: z.number(),
            adjustmentReason: z.string().nullable().optional(),
            notes: z.string().nullable().optional(),
        })
    ),
});

const submitFabricColourReconciliationInputSchema = z.object({
    reconciliationId: z.string().uuid('Invalid reconciliation ID'),
});

const deleteFabricColourReconciliationInputSchema = z.object({
    reconciliationId: z.string().uuid('Invalid reconciliation ID'),
});

// ============================================
// TRANSACTION MUTATIONS
// ============================================

/**
 * Create a fabric colour transaction (inward/outward)
 *
 * Records stock movement for a specific fabric colour.
 * Requires authentication to get createdById from JWT.
 */
export const createFabricColourTransaction = createServerFn({ method: 'POST' })
    .middleware([authMiddleware])
    .inputValidator((input: unknown) => createTransactionSchema.parse(input))
    .handler(async ({ data, context }): Promise<TransactionSuccessResult> => {
        const prisma = await getPrisma();

        try {
            const transaction = await prisma.fabricColourTransaction.create({
                data: {
                    fabricColourId: data.fabricColourId,
                    txnType: data.txnType,
                    qty: data.qty,
                    unit: data.unit,
                    reason: data.reason,
                    referenceId: data.referenceId || null,
                    notes: data.notes || null,
                    costPerUnit: data.costPerUnit ?? null,
                    partyId: data.partyId || null,
                    createdById: context.user.id,
                },
                include: {
                    createdBy: { select: { id: true, name: true } },
                    party: { select: { id: true, name: true } },
                },
            });

            // Invalidate fabric colour balance cache
            const { fabricColourBalanceCache } = await import('@coh/shared/services/inventory');
            fabricColourBalanceCache.invalidate([data.fabricColourId]);

            return {
                success: true,
                transaction,
            };
        } finally {
            await prisma.$disconnect();
        }
    });

/**
 * Delete a fabric colour transaction (admin only)
 *
 * Supports both soft delete (mark as deleted) or hard delete (remove from DB).
 * Defaults to hard delete for consistency with old FabricTransaction behavior.
 */
export const deleteFabricColourTransaction = createServerFn({ method: 'POST' })
    .middleware([authMiddleware])
    .inputValidator((input: unknown) => deleteTransactionSchema.parse(input))
    .handler(async ({ data, context }): Promise<DeleteTransactionSuccessResult | TransactionErrorResult> => {
        const prisma = await getPrisma();

        try {
            // Check if user is admin
            if (context.user.role !== 'admin') {
                return {
                    success: false,
                    error: {
                        code: 'FORBIDDEN' as const,
                        message: 'Only admins can delete transactions',
                    },
                };
            }

            const transaction = await prisma.fabricColourTransaction.findUnique({
                where: { id: data.txnId },
            });

            if (!transaction) {
                return {
                    success: false,
                    error: {
                        code: 'NOT_FOUND' as const,
                        message: 'Transaction not found',
                    },
                };
            }

            // Hard delete (matches old FabricTransaction behavior)
            await prisma.fabricColourTransaction.delete({
                where: { id: data.txnId },
            });

            // Invalidate fabric colour balance cache
            const { fabricColourBalanceCache } = await import('@coh/shared/services/inventory');
            fabricColourBalanceCache.invalidate([transaction.fabricColourId]);

            return {
                success: true,
                id: data.txnId,
            };
        } finally {
            await prisma.$disconnect();
        }
    });

/**
 * Update a fabric colour transaction
 *
 * Allows editing qty, costPerUnit, partyId, and notes.
 * Cannot change fabricColourId or txnType after creation.
 */
export const updateFabricColourTransaction = createServerFn({ method: 'POST' })
    .middleware([authMiddleware])
    .inputValidator((input: unknown) => updateTransactionSchema.parse(input))
    .handler(async ({ data }): Promise<TransactionSuccessResult | TransactionErrorResult> => {
        const prisma = await getPrisma();

        try {
            const existing = await prisma.fabricColourTransaction.findUnique({
                where: { id: data.id },
            });

            if (!existing) {
                return {
                    success: false,
                    error: {
                        code: 'NOT_FOUND' as const,
                        message: 'Transaction not found',
                    },
                };
            }

            // Build update data - only include fields that were provided
            const updateData: Record<string, unknown> = {};
            if (data.qty !== undefined) updateData.qty = data.qty;
            if (data.costPerUnit !== undefined) updateData.costPerUnit = data.costPerUnit;
            if (data.partyId !== undefined) updateData.partyId = data.partyId;
            if (data.notes !== undefined) updateData.notes = data.notes;

            const transaction = await prisma.fabricColourTransaction.update({
                where: { id: data.id },
                data: updateData,
                include: {
                    createdBy: { select: { id: true, name: true } },
                    party: { select: { id: true, name: true } },
                },
            });

            // Invalidate fabric colour balance cache (only if qty changed)
            if (data.qty !== undefined) {
                const { fabricColourBalanceCache } = await import('@coh/shared/services/inventory');
                fabricColourBalanceCache.invalidate([transaction.fabricColourId]);
            }

            return {
                success: true,
                transaction,
            };
        } finally {
            await prisma.$disconnect();
        }
    });

// ============================================
// RECONCILIATION MUTATIONS
// ============================================

/**
 * Update reconciliation items (physical quantities, reasons, notes)
 *
 * Only draft reconciliations can be updated.
 * Variance is auto-calculated as physicalQty - systemQty.
 */
export const updateFabricColourReconciliationItems = createServerFn({ method: 'POST' })
    .middleware([authMiddleware])
    .inputValidator((input: unknown) => updateFabricColourReconciliationItemsInputSchema.parse(input))
    .handler(async ({ data }): Promise<UpdateReconciliationItemsSuccessResult | UpdateReconciliationItemsErrorResult> => {
        const prisma = await getPrisma();

        try {
            const { reconciliationId, items } = data;

            const reconciliation = await prisma.fabricColourReconciliation.findUnique({
                where: { id: reconciliationId },
            });

            if (!reconciliation) {
                return {
                    success: false,
                    error: {
                        code: 'NOT_FOUND' as const,
                        message: 'Reconciliation not found',
                    },
                };
            }

            if (reconciliation.status !== 'draft') {
                return {
                    success: false,
                    error: {
                        code: 'BAD_REQUEST' as const,
                        message: 'Cannot update submitted reconciliation',
                    },
                };
            }

            // Update all items in parallel using Promise.all
            // Each item needs unique variance calculation, so we batch the promises
            await Promise.all(
                items.map((item) => {
                    const variance =
                        item.physicalQty !== null && item.physicalQty !== undefined
                            ? item.physicalQty - item.systemQty
                            : null;

                    return prisma.fabricColourReconciliationItem.update({
                        where: { id: item.id },
                        data: {
                            physicalQty: item.physicalQty,
                            variance,
                            adjustmentReason: item.adjustmentReason || null,
                            notes: item.notes || null,
                        },
                    });
                })
            );

            // Reload reconciliation with updated items
            const updated = await prisma.fabricColourReconciliation.findUnique({
                where: { id: reconciliationId },
                include: {
                    items: {
                        include: {
                            fabricColour: {
                                include: {
                                    fabric: {
                                        include: { material: true },
                                    },
                                },
                            },
                        },
                    },
                },
            });

            const typedUpdated = updated as unknown as ReconciliationWithItems;

            return {
                success: true,
                data: {
                    id: typedUpdated.id,
                    status: typedUpdated.status,
                    createdAt: typedUpdated.createdAt,
                    items: typedUpdated.items.map((item) => ({
                        id: item.id,
                        fabricColourId: item.fabricColourId,
                        materialName: item.fabricColour.fabric.material?.name || 'Unknown',
                        fabricName: item.fabricColour.fabric.name,
                        colourName: item.fabricColour.colourName,
                        unit: item.fabricColour.fabric.unit || 'meter',
                        systemQty: Number(item.systemQty),
                        physicalQty: item.physicalQty !== null ? Number(item.physicalQty) : null,
                        variance: item.variance !== null ? Number(item.variance) : null,
                        adjustmentReason: item.adjustmentReason,
                        notes: item.notes,
                    })),
                },
            };
        } finally {
            await prisma.$disconnect();
        }
    });

/**
 * Submit reconciliation and create adjustment transactions
 *
 * Creates FabricColourTransaction records for each variance:
 * - Positive variance (more physical than system): inward transaction
 * - Negative variance (less physical than system): outward transaction
 *
 * Only draft reconciliations can be submitted.
 */
export const submitFabricColourReconciliation = createServerFn({ method: 'POST' })
    .middleware([authMiddleware])
    .inputValidator((input: unknown) => submitFabricColourReconciliationInputSchema.parse(input))
    .handler(async ({ data, context }): Promise<SubmitReconciliationSuccessResult | SubmitReconciliationErrorResult> => {
        const prisma = await getPrisma();

        try {
            const { reconciliationId } = data;

            const reconciliation = await prisma.fabricColourReconciliation.findUnique({
                where: { id: reconciliationId },
                include: {
                    items: {
                        include: {
                            fabricColour: {
                                include: {
                                    fabric: {
                                        include: { material: true },
                                    },
                                },
                            },
                        },
                    },
                },
            });

            if (!reconciliation) {
                return {
                    success: false,
                    error: {
                        code: 'NOT_FOUND' as const,
                        message: 'Reconciliation not found',
                    },
                };
            }

            if (reconciliation.status !== 'draft') {
                return {
                    success: false,
                    error: {
                        code: 'BAD_REQUEST' as const,
                        message: 'Reconciliation already submitted',
                    },
                };
            }

            const typedReconciliation = reconciliation as unknown as ReconciliationWithItems;

            // Process items with variances in a transaction
            const itemsWithVariance = typedReconciliation.items.filter(
                (item) => item.variance !== null && item.variance !== 0
            );

            let transactionsCreated = 0;

            await prisma.$transaction(async (tx: PrismaTransaction) => {
                for (const item of itemsWithVariance) {
                    const variance = Number(item.variance);
                    const txnType = variance > 0 ? 'inward' : 'outward';
                    const qty = Math.abs(variance);

                    await tx.fabricColourTransaction.create({
                        data: {
                            fabricColourId: item.fabricColourId,
                            txnType,
                            qty,
                            unit: item.fabricColour.fabric.unit || 'meter',
                            reason: `reconciliation_${item.adjustmentReason || 'adjustment'}`,
                            referenceId: reconciliationId,
                            notes: item.notes || `Reconciliation adjustment`,
                            createdById: context.user.id,
                        },
                    });
                    transactionsCreated++;
                }

                // Mark reconciliation as submitted
                await tx.fabricColourReconciliation.update({
                    where: { id: reconciliationId },
                    data: { status: 'submitted' },
                });
            });

            // Invalidate fabric colour balance cache for all affected colours
            if (itemsWithVariance.length > 0) {
                const { fabricColourBalanceCache } = await import('@coh/shared/services/inventory');
                const affectedIds = itemsWithVariance.map((item) => item.fabricColourId);
                fabricColourBalanceCache.invalidate(affectedIds);
            }

            return {
                success: true,
                data: {
                    reconciliationId,
                    status: 'submitted',
                    adjustmentsMade: transactionsCreated,
                },
            };
        } finally {
            await prisma.$disconnect();
        }
    });

/**
 * Delete a draft reconciliation
 *
 * Only draft reconciliations can be deleted.
 * Cascade deletes all reconciliation items.
 */
export const deleteFabricColourReconciliation = createServerFn({ method: 'POST' })
    .middleware([authMiddleware])
    .inputValidator((input: unknown) => deleteFabricColourReconciliationInputSchema.parse(input))
    .handler(async ({ data }): Promise<DeleteReconciliationSuccessResult | DeleteReconciliationErrorResult> => {
        const prisma = await getPrisma();

        try {
            const { reconciliationId } = data;

            const reconciliation = await prisma.fabricColourReconciliation.findUnique({
                where: { id: reconciliationId },
            });

            if (!reconciliation) {
                return {
                    success: false,
                    error: {
                        code: 'NOT_FOUND' as const,
                        message: 'Reconciliation not found',
                    },
                };
            }

            if (reconciliation.status !== 'draft') {
                return {
                    success: false,
                    error: {
                        code: 'BAD_REQUEST' as const,
                        message: 'Cannot delete submitted reconciliation',
                    },
                };
            }

            // Delete reconciliation (cascade deletes items)
            await prisma.fabricColourReconciliation.delete({
                where: { id: reconciliationId },
            });

            return {
                success: true,
                data: {
                    reconciliationId,
                    deleted: true,
                },
            };
        } finally {
            await prisma.$disconnect();
        }
    });
