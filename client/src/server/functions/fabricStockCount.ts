/**
 * Fabric Stock Count Server Functions
 *
 * Simple pool-based physical count entry for warehouse staff.
 * Staff submit individual counts → admin reviews and applies adjustments.
 *
 * IMPORTANT: All database imports are dynamic to prevent Node.js code
 * from being bundled into the client.
 */

import { createServerFn } from '@tanstack/react-start';
import { z } from 'zod';
import { authMiddleware, adminMiddleware } from '../middleware/auth';
import { getPrisma, type PrismaTransaction } from '@coh/shared/services/db';

// ============================================
// SCHEMAS
// ============================================

const submitStockCountSchema = z.object({
    fabricColourId: z.string().uuid(),
    physicalQty: z.number().min(0),
    notes: z.string().optional(),
});

const deleteStockCountSchema = z.object({
    id: z.string().uuid(),
});

const applyStockCountsSchema = z.object({
    ids: z.array(z.string().uuid()).min(1),
});

const discardStockCountsSchema = z.object({
    ids: z.array(z.string().uuid()).min(1),
});

// ============================================
// QUERY: Fabric colours for counting (lightweight)
// ============================================

export const getFabricColoursForCount = createServerFn({ method: 'GET' })
    .middleware([authMiddleware])
    .handler(async () => {
        const prisma = await getPrisma();

        const colours = await prisma.fabricColour.findMany({
            where: {
                isActive: true,
                fabric: { name: { not: { startsWith: 'Purchased' } } },
            },
            select: {
                id: true,
                colourName: true,
                colourHex: true,
                code: true,
                currentBalance: true,
                fabric: {
                    select: {
                        name: true,
                        unit: true,
                        material: { select: { name: true } },
                    },
                },
                variationBomLines: {
                    select: {
                        variation: {
                            select: {
                                imageUrl: true,
                                product: { select: { name: true } },
                            },
                        },
                    },
                    take: 3,
                },
            },
            orderBy: [
                { fabric: { name: 'asc' } },
                { colourName: 'asc' },
            ],
        });

        return {
            success: true as const,
            items: colours.map((c) => ({
                id: c.id,
                colourName: c.colourName,
                colourHex: c.colourHex,
                code: c.code,
                currentBalance: c.currentBalance,
                fabricName: c.fabric.name,
                materialName: c.fabric.material?.name ?? '',
                unit: c.fabric.unit ?? 'meter',
                thumbnails: c.variationBomLines
                    .filter((b) => b.variation.imageUrl)
                    .map((b) => ({
                        imageUrl: b.variation.imageUrl!,
                        productName: b.variation.product?.name ?? '',
                    })),
            })),
        };
    });

// ============================================
// QUERY: My recent counts (today)
// ============================================

export const getMyRecentCounts = createServerFn({ method: 'GET' })
    .middleware([authMiddleware])
    .handler(async ({ context }) => {
        const prisma = await getPrisma();

        // Today start in IST (UTC+5:30)
        const now = new Date();
        const istOffset = 5.5 * 60 * 60 * 1000;
        const istNow = new Date(now.getTime() + istOffset);
        const istToday = new Date(istNow.getFullYear(), istNow.getMonth(), istNow.getDate());
        const todayUtc = new Date(istToday.getTime() - istOffset);

        const counts = await prisma.fabricStockCount.findMany({
            where: {
                countedById: context.user.id,
                countedAt: { gte: todayUtc },
            },
            include: {
                fabricColour: {
                    select: {
                        colourName: true,
                        colourHex: true,
                        currentBalance: true,
                        fabric: { select: { name: true, unit: true } },
                    },
                },
            },
            orderBy: { countedAt: 'desc' },
        });

        return {
            success: true as const,
            counts: counts.map((c) => ({
                id: c.id,
                fabricColourId: c.fabricColourId,
                colourName: c.fabricColour.colourName,
                colourHex: c.fabricColour.colourHex,
                fabricName: c.fabricColour.fabric.name,
                unit: c.fabricColour.fabric.unit ?? 'meter',
                physicalQty: c.physicalQty,
                systemQty: c.fabricColour.currentBalance,
                status: c.status,
                notes: c.notes,
                countedAt: c.countedAt.toISOString(),
            })),
        };
    });

// ============================================
// MUTATION: Submit a stock count
// ============================================

export const submitStockCount = createServerFn({ method: 'POST' })
    .middleware([authMiddleware])
    .inputValidator((input: unknown) => submitStockCountSchema.parse(input))
    .handler(async ({ data, context }) => {
        const prisma = await getPrisma();

        const count = await prisma.fabricStockCount.create({
            data: {
                fabricColourId: data.fabricColourId,
                physicalQty: data.physicalQty,
                countedById: context.user.id,
                ...(data.notes ? { notes: data.notes } : {}),
            },
        });

        return { success: true as const, id: count.id };
    });

// ============================================
// MUTATION: Delete own pending count
// ============================================

export const deleteStockCount = createServerFn({ method: 'POST' })
    .middleware([authMiddleware])
    .inputValidator((input: unknown) => deleteStockCountSchema.parse(input))
    .handler(async ({ data, context }) => {
        const prisma = await getPrisma();

        const count = await prisma.fabricStockCount.findUnique({
            where: { id: data.id },
        });

        if (!count) {
            return { success: false as const, error: 'Count not found' };
        }
        if (count.status !== 'pending') {
            return { success: false as const, error: 'Can only delete pending counts' };
        }
        const isAdmin = context.user.role === 'admin' || context.user.role === 'owner'
            || context.permissions?.includes('users:create');
        if (count.countedById !== context.user.id && !isAdmin) {
            return { success: false as const, error: 'Can only delete your own counts' };
        }

        await prisma.fabricStockCount.delete({ where: { id: data.id } });

        return { success: true as const };
    });

// ============================================
// ADMIN QUERY: All pending stock counts
// ============================================

export const getPendingStockCounts = createServerFn({ method: 'GET' })
    .middleware([adminMiddleware])
    .handler(async () => {
        const prisma = await getPrisma();

        const counts = await prisma.fabricStockCount.findMany({
            where: { status: 'pending' },
            include: {
                fabricColour: {
                    select: {
                        colourName: true,
                        colourHex: true,
                        currentBalance: true,
                        fabric: { select: { name: true, unit: true } },
                    },
                },
                countedBy: { select: { name: true } },
            },
            orderBy: { countedAt: 'desc' },
        });

        return {
            success: true as const,
            counts: counts.map((c) => ({
                id: c.id,
                fabricColourId: c.fabricColourId,
                colourName: c.fabricColour.colourName,
                colourHex: c.fabricColour.colourHex,
                fabricName: c.fabricColour.fabric.name,
                unit: c.fabricColour.fabric.unit ?? 'meter',
                physicalQty: c.physicalQty,
                systemQty: c.fabricColour.currentBalance,
                variance: c.physicalQty - c.fabricColour.currentBalance,
                status: c.status,
                notes: c.notes,
                countedAt: c.countedAt.toISOString(),
                countedBy: c.countedBy.name,
            })),
        };
    });

// ============================================
// ADMIN MUTATION: Apply stock counts (create adjustment transactions)
// ============================================

export const applyStockCounts = createServerFn({ method: 'POST' })
    .middleware([adminMiddleware])
    .inputValidator((input: unknown) => applyStockCountsSchema.parse(input))
    .handler(async ({ data, context }) => {
        const prisma = await getPrisma();

        const result = await prisma.$transaction(async (tx: PrismaTransaction) => {
            const counts = await tx.fabricStockCount.findMany({
                where: { id: { in: data.ids }, status: 'pending' },
                include: {
                    fabricColour: {
                        select: {
                            id: true,
                            currentBalance: true,
                            fabric: { select: { unit: true } },
                        },
                    },
                },
            });

            if (counts.length === 0) {
                throw new Error('No pending counts found');
            }

            const affectedIds: string[] = [];
            let adjustmentsMade = 0;

            for (const count of counts) {
                const variance = count.physicalQty - count.fabricColour.currentBalance;

                if (Math.abs(variance) > 0.001) {
                    // Create adjustment transaction
                    const txnType = variance > 0 ? 'inward' : 'outward';
                    await tx.fabricColourTransaction.create({
                        data: {
                            fabricColourId: count.fabricColourId,
                            txnType,
                            qty: Math.abs(variance),
                            unit: count.fabricColour.fabric.unit ?? 'meter',
                            reason: 'stock_count_adjustment',
                            notes: `Physical count: ${count.physicalQty}. System was: ${count.fabricColour.currentBalance}${count.notes ? `. Notes: ${count.notes}` : ''}`,
                            createdById: context.user.id,
                        },
                    });
                    adjustmentsMade++;
                }

                affectedIds.push(count.fabricColourId);
            }

            // Mark counts as applied
            await tx.fabricStockCount.updateMany({
                where: { id: { in: data.ids } },
                data: { status: 'applied' },
            });

            return { adjustmentsMade, affectedIds };
        }, { timeout: 30000 });

        // Invalidate cache
        if (result.affectedIds.length > 0) {
            const { fabricColourBalanceCache } = await import('@coh/shared/services/inventory');
            fabricColourBalanceCache.invalidate(result.affectedIds);
        }

        return {
            success: true as const,
            adjustmentsMade: result.adjustmentsMade,
        };
    });

// ============================================
// ADMIN MUTATION: Discard stock counts
// ============================================

export const discardStockCounts = createServerFn({ method: 'POST' })
    .middleware([adminMiddleware])
    .inputValidator((input: unknown) => discardStockCountsSchema.parse(input))
    .handler(async ({ data }) => {
        const prisma = await getPrisma();

        const result = await prisma.fabricStockCount.updateMany({
            where: { id: { in: data.ids }, status: 'pending' },
            data: { status: 'discarded' },
        });

        return { success: true as const, discarded: result.count };
    });
