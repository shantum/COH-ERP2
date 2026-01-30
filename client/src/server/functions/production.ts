/**
 * Production Queries Server Functions
 *
 * TanStack Start Server Functions for production batch queries.
 * Mirrors tRPC production router queries with Kysely/Prisma implementations.
 *
 * IMPORTANT: All database imports are dynamic to prevent Node.js code
 * (pg, Buffer) from being bundled into the client.
 */

import { createServerFn } from '@tanstack/react-start';
import { z } from 'zod';
import { authMiddleware } from '../middleware/auth';

// ============================================
// EXPORTED RESPONSE TYPES
// ============================================

/** Tailor row from getProductionTailors */
export interface TailorRow {
    id: string;
    name: string;
    specializations: string | null;
    dailyCapacityMins: number;
    isActive: boolean;
}

/** Tailor info nested in batch */
export interface TailorInfo {
    id: string;
    name: string | null;
}

/** Variation info nested in batch SKU */
export interface BatchVariationInfo {
    id: string | null;
    colorName: string | null;
    fabricId: string | null;
    product: {
        id: string | null;
        name: string | null;
    };
    fabric: { id: string; name: string | null } | null;
}

/** SKU info nested in batch */
export interface BatchSkuInfo {
    id: string;
    skuCode: string | null;
    size: string | null;
    isCustomSku: boolean | null;
    customizationType: string | null;
    customizationValue: string | null;
    customizationNotes: string | null;
    variation: BatchVariationInfo;
}

/** Order line info in batch */
export interface BatchOrderLineInfo {
    id: string;
    order: {
        id: string;
        orderNumber: string;
        customerName: string | null;
    };
}

/** Sample batch info */
export interface SampleInfo {
    sampleCode: string | null;
    sampleName: string | null;
    sampleColour: string | null;
    sampleSize: string | null;
}

/** Customization info for custom SKU batches */
export interface CustomizationInfo {
    type: string | null;
    value: string | null;
    notes: string | null;
    sourceOrderLineId: string | null;
    linkedOrder: {
        id: string;
        orderNumber: string;
        customerName: string | null;
    } | null;
}

/** Production batch from getProductionBatches */
export interface ProductionBatchItem {
    id: string;
    batchCode: string | null;
    batchDate: string; // YYYY-MM-DD format to avoid timezone issues
    status: string;
    qtyPlanned: number;
    qtyCompleted: number;
    priority: string;
    notes: string | null;
    sourceOrderLineId: string | null;
    sampleCode: string | null;
    sampleName: string | null;
    sampleColour: string | null;
    sampleSize: string | null;
    tailorId: string | null;
    tailorName: string | null;
    skuId: string | null;
    skuCode: string | null;
    skuSize: string | null;
    isCustomSku: boolean;
    customizationType: string | null;
    customizationValue: string | null;
    customizationNotes: string | null;
    variationId: string | null;
    colorName: string | null;
    productId: string | null;
    productName: string | null;
    fabricId: string | null;
    fabricName: string | null;
    tailor: TailorInfo | null;
    sku: BatchSkuInfo | null;
    orderLines: BatchOrderLineInfo[];
    isSampleBatch: boolean | string | null;
    sampleInfo?: SampleInfo;
    customization?: CustomizationInfo;
}

/** Capacity item from getProductionCapacity */
export interface CapacityItem {
    tailorId: string;
    tailorName: string;
    dailyCapacityMins: number;
    allocatedMins: number;
    availableMins: number;
    utilizationPct: string;
}

/** Requirement item from getProductionRequirements */
export interface ProductionRequirementItem {
    orderLineId: string;
    orderId: string;
    orderNumber: string;
    orderDate: Date;
    customerName: string;
    skuId: string;
    skuCode: string;
    productName: string;
    colorName: string;
    size: string;
    fabricType: string;
    qty: number;
    currentInventory: number;
    scheduledForLine: number;
    shortage: number;
    lineStatus: string;
}

/** Requirements summary */
export interface ProductionRequirementsSummary {
    totalLinesNeedingProduction: number;
    totalUnitsNeeded: number;
    totalOrdersAffected: number;
}

/** Production requirements response */
export interface ProductionRequirementsResponse {
    requirements: ProductionRequirementItem[];
    summary: ProductionRequirementsSummary;
}

/** Pending batch from getProductionPendingBySku */
export interface PendingBatchItem {
    id: string;
    batchCode: string | null;
    batchDate: Date | null;
    qtyPlanned: number;
    qtyCompleted: number;
    qtyPending: number;
    status: string;
    tailor: TailorInfo | null;
}

/** Pending by SKU response */
export interface PendingBySkuResponse {
    batches: PendingBatchItem[];
    totalPending: number;
}

// ============================================
// INPUT SCHEMAS
// ============================================

const batchListInputSchema = z.object({
    status: z.enum(['planned', 'in_progress', 'completed', 'cancelled']).optional(),
    tailorId: z.string().optional(),
    startDate: z.string().optional(),
    endDate: z.string().optional(),
    customOnly: z.boolean().optional(),
});

const capacityInputSchema = z.object({
    date: z.string().optional(),
});

const pendingBySkuInputSchema = z.object({
    skuId: z.string(),
});

// ============================================
// DATABASE IMPORTS
// ============================================

import { getKysely, getPrisma } from '@coh/shared/services/db';

// ============================================
// SERVER FUNCTIONS - QUERIES
// ============================================

/**
 * Get all active tailors
 *
 * Uses Kysely for efficient query.
 * Returns tailors ordered by name.
 */
export const getProductionTailors = createServerFn({ method: 'GET' })
    .middleware([authMiddleware])
    .handler(async (): Promise<TailorRow[]> => {
        const db = await getKysely();

        const rows = await db
            .selectFrom('Tailor')
            .select([
                'Tailor.id',
                'Tailor.name',
                'Tailor.specializations',
                'Tailor.dailyCapacityMins',
                'Tailor.isActive',
            ])
            .where('Tailor.isActive', '=', true)
            .orderBy('Tailor.name', 'asc')
            .execute();

        return rows;
    });

/**
 * Get production batches with filters
 *
 * Uses Kysely for efficient JOINs across ProductionBatch, Tailor, Sku, Variation, Product, Fabric.
 * Returns enriched batch data with tailor, sku, and order line information.
 */
export const getProductionBatches = createServerFn({ method: 'GET' })
    .middleware([authMiddleware])
    .inputValidator((input: unknown) => batchListInputSchema.parse(input))
    .handler(async ({ data: input }): Promise<ProductionBatchItem[]> => {
        const db = await getKysely();

        // Build the base query with joins
        // Join to BOM system for fabric info (source of truth)
        let query = db
            .selectFrom('ProductionBatch')
            .leftJoin('Tailor', 'Tailor.id', 'ProductionBatch.tailorId')
            .leftJoin('Sku', 'Sku.id', 'ProductionBatch.skuId')
            .leftJoin('Variation', 'Variation.id', 'Sku.variationId')
            .leftJoin('Product', 'Product.id', 'Variation.productId')
            .leftJoin('VariationBomLine', (join) =>
                join
                    .onRef('VariationBomLine.variationId', '=', 'Variation.id')
                    .on('VariationBomLine.fabricColourId', 'is not', null)
            )
            .leftJoin('FabricColour', 'FabricColour.id', 'VariationBomLine.fabricColourId')
            .leftJoin('Fabric', 'Fabric.id', 'FabricColour.fabricId')
            .select([
                'ProductionBatch.id',
                'ProductionBatch.batchCode',
                'ProductionBatch.batchDate',
                'ProductionBatch.status',
                'ProductionBatch.qtyPlanned',
                'ProductionBatch.qtyCompleted',
                'ProductionBatch.priority',
                'ProductionBatch.notes',
                'ProductionBatch.sourceOrderLineId',
                'ProductionBatch.sampleCode',
                'ProductionBatch.sampleName',
                'ProductionBatch.sampleColour',
                'ProductionBatch.sampleSize',
                'ProductionBatch.tailorId',
                'Tailor.name as tailorName',
                'ProductionBatch.skuId',
                'Sku.skuCode',
                'Sku.size as skuSize',
                'Sku.isCustomSku',
                'Sku.customizationType',
                'Sku.customizationValue',
                'Sku.customizationNotes',
                'Variation.id as variationId',
                'Variation.colorName',
                'Product.id as productId',
                'Product.name as productName',
                'Product.styleCode as productStyleCode',
                'FabricColour.fabricId',
                'Fabric.name as fabricName',
            ]);

        // Apply filters
        if (input.status) {
            query = query.where('ProductionBatch.status', '=', input.status) as typeof query;
        }
        if (input.tailorId) {
            query = query.where('ProductionBatch.tailorId', '=', input.tailorId) as typeof query;
        }
        if (input.startDate) {
            query = query.where('ProductionBatch.batchDate', '>=', new Date(input.startDate)) as typeof query;
        }
        if (input.endDate) {
            query = query.where('ProductionBatch.batchDate', '<=', new Date(input.endDate)) as typeof query;
        }
        if (input.customOnly) {
            query = query.where('Sku.isCustomSku', '=', true) as typeof query;
        }

        const rows = await query.orderBy('ProductionBatch.batchDate', 'desc').execute();

        // Transform to match tRPC router output format
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const batches = rows.map((r: any) => {
            // Extract date-only string to avoid timezone interpretation issues
            // Kysely returns Date objects interpreted in server timezone, but we need just the date part
            const batchDateRaw = r.batchDate;
            let batchDateStr: string;
            if (batchDateRaw instanceof Date) {
                // Extract YYYY-MM-DD from the date without timezone conversion
                // Use getFullYear/Month/Date to get the date parts as stored in DB
                const y = batchDateRaw.getFullYear();
                const m = String(batchDateRaw.getMonth() + 1).padStart(2, '0');
                const d = String(batchDateRaw.getDate()).padStart(2, '0');
                batchDateStr = `${y}-${m}-${d}`;
            } else if (typeof batchDateRaw === 'string') {
                // If already a string, extract the date part
                batchDateStr = batchDateRaw.split('T')[0].split(' ')[0];
            } else {
                batchDateStr = new Date().toISOString().split('T')[0];
            }
            return {
                id: r.id,
                batchCode: r.batchCode,
                batchDate: batchDateStr,
                status: r.status,
                qtyPlanned: r.qtyPlanned,
                qtyCompleted: r.qtyCompleted,
                priority: r.priority,
                notes: r.notes,
                sourceOrderLineId: r.sourceOrderLineId,
                sampleCode: r.sampleCode,
                sampleName: r.sampleName,
                sampleColour: r.sampleColour,
                sampleSize: r.sampleSize,
                tailorId: r.tailorId,
                tailorName: r.tailorName,
                skuId: r.skuId,
                skuCode: r.skuCode,
                skuSize: r.skuSize,
                isCustomSku: r.isCustomSku ?? false,
                customizationType: r.customizationType,
                customizationValue: r.customizationValue,
                customizationNotes: r.customizationNotes,
                variationId: r.variationId,
                colorName: r.colorName,
                productId: r.productId,
                productName: r.productName,
                productStyleCode: r.productStyleCode,
                fabricId: r.fabricId,
                fabricName: r.fabricName,
            };
        });

        // Fetch order lines for all batches
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const batchIds = batches.map((b: any) => b.id);
        const orderLines = batchIds.length > 0
            ? await db
                .selectFrom('OrderLine')
                .innerJoin('Order', 'Order.id', 'OrderLine.orderId')
                .select([
                    'OrderLine.productionBatchId as batchId',
                    'OrderLine.id as orderLineId',
                    'Order.id as orderId',
                    'Order.orderNumber',
                    'Order.customerName',
                ])
                .where('OrderLine.productionBatchId', 'in', batchIds)
                .execute()
            : [];

        // Build orderLines lookup by batch ID
        const orderLinesByBatch = new Map<string, typeof orderLines>();
        for (const line of orderLines) {
            const list = orderLinesByBatch.get(line.batchId!) || [];
            list.push(line);
            orderLinesByBatch.set(line.batchId!, list);
        }

        // Enrich batches with customization display info and sample info
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        return batches.map((batch: any) => {
            const isCustom = batch.isCustomSku || false;
            const isSample = !batch.skuId && batch.sampleCode;
            const batchOrderLines = orderLinesByBatch.get(batch.id) || [];
            const linkedOrder = batchOrderLines[0] || null;

            return {
                ...batch,
                tailor: batch.tailorId ? { id: batch.tailorId, name: batch.tailorName } : null,
                sku: batch.skuId
                    ? {
                          id: batch.skuId,
                          skuCode: batch.skuCode,
                          size: batch.skuSize,
                          isCustomSku: batch.isCustomSku,
                          customizationType: batch.customizationType,
                          customizationValue: batch.customizationValue,
                          customizationNotes: batch.customizationNotes,
                          variation: {
                              id: batch.variationId,
                              colorName: batch.colorName,
                              fabricId: batch.fabricId,
                              product: {
                                  id: batch.productId,
                                  name: batch.productName,
                                  styleCode: batch.productStyleCode,
                              },
                              fabric: batch.fabricId
                                  ? { id: batch.fabricId, name: batch.fabricName }
                                  : null,
                          },
                      }
                    : null,
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                orderLines: batchOrderLines.map((ol: any) => ({
                    id: ol.orderLineId,
                    order: {
                        id: ol.orderId,
                        orderNumber: ol.orderNumber,
                        customerName: ol.customerName,
                    },
                })),
                isCustomSku: isCustom,
                isSampleBatch: isSample,
                ...(isSample && {
                    sampleInfo: {
                        sampleCode: batch.sampleCode,
                        sampleName: batch.sampleName,
                        sampleColour: batch.sampleColour,
                        sampleSize: batch.sampleSize,
                    },
                }),
                ...(isCustom && batch.skuId && {
                    customization: {
                        type: batch.customizationType || null,
                        value: batch.customizationValue || null,
                        notes: batch.customizationNotes || null,
                        sourceOrderLineId: batch.sourceOrderLineId,
                        linkedOrder: linkedOrder
                            ? {
                                  id: linkedOrder.orderId,
                                  orderNumber: linkedOrder.orderNumber,
                                  customerName: linkedOrder.customerName,
                              }
                            : null,
                    },
                }),
            };
        });
    });

/**
 * Get locked production dates
 *
 * Reads from ConfigStorage table where key='production_locked_dates'.
 * Returns array of date strings in YYYY-MM-DD format.
 */
export const getProductionLockedDates = createServerFn({ method: 'GET' })
    .middleware([authMiddleware])
    .handler(async (): Promise<string[]> => {
        const prisma = await getPrisma();

        // Locked dates are stored in SystemSetting table
        const setting = await prisma.systemSetting.findUnique({
            where: { key: 'locked_production_dates' }
        });

        return setting?.value ? JSON.parse(setting.value) as string[] : [];
    });

/**
 * Get tailor capacity for a specific date
 *
 * Uses Kysely to calculate capacity utilization per tailor.
 * Returns allocated/available minutes and utilization percentage.
 */
export const getProductionCapacity = createServerFn({ method: 'GET' })
    .middleware([authMiddleware])
    .inputValidator((input: unknown) => capacityInputSchema.parse(input))
    .handler(async ({ data: input }): Promise<CapacityItem[]> => {
        const db = await getKysely();

        const targetDate = input.date ? new Date(input.date) : new Date();
        const startOfDay = new Date(targetDate);
        startOfDay.setHours(0, 0, 0, 0);
        const endOfDay = new Date(targetDate);
        endOfDay.setHours(23, 59, 59, 999);

        // Get tailors
        const tailors = await db
            .selectFrom('Tailor')
            .select(['Tailor.id', 'Tailor.name', 'Tailor.dailyCapacityMins'])
            .where('Tailor.isActive', '=', true)
            .execute();

        // Get batches for the day with production time
        const batches = await db
            .selectFrom('ProductionBatch')
            .leftJoin('Sku', 'Sku.id', 'ProductionBatch.skuId')
            .leftJoin('Variation', 'Variation.id', 'Sku.variationId')
            .leftJoin('Product', 'Product.id', 'Variation.productId')
            .select([
                'ProductionBatch.tailorId',
                'ProductionBatch.qtyPlanned',
                'Product.baseProductionTimeMins',
            ])
            .where('ProductionBatch.batchDate', '>=', startOfDay)
            .where('ProductionBatch.batchDate', '<=', endOfDay)
            .where('ProductionBatch.status', '!=', 'cancelled')
            .execute();

        // Calculate capacity for each tailor
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        return tailors.map((tailor: any) => {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const tailorBatches = batches.filter((b: any) => b.tailorId === tailor.id);
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const allocatedMins = tailorBatches.reduce((sum: number, b: any) => {
                const timePer = b.baseProductionTimeMins || 0;
                return sum + timePer * b.qtyPlanned;
            }, 0);

            return {
                tailorId: tailor.id,
                tailorName: tailor.name,
                dailyCapacityMins: tailor.dailyCapacityMins,
                allocatedMins,
                availableMins: Math.max(0, tailor.dailyCapacityMins - allocatedMins),
                utilizationPct: ((allocatedMins / tailor.dailyCapacityMins) * 100).toFixed(0),
            };
        });
    });

/**
 * Get production requirements from open orders
 *
 * Analyzes pending order lines to identify production shortages.
 * Uses Prisma for complex nested includes on orders.
 */
export const getProductionRequirements = createServerFn({ method: 'GET' })
    .middleware([authMiddleware])
    .handler(async (): Promise<ProductionRequirementsResponse> => {
        const prisma = await getPrisma();

        // Get all open orders with their lines (only pending)
        const openOrders = await prisma.order.findMany({
            where: { status: 'open' },
            include: {
                orderLines: {
                    where: { lineStatus: 'pending' },
                    include: {
                        sku: {
                            include: {
                                variation: {
                                    include: {
                                        product: true,
                                    }
                                }
                            }
                        }
                    }
                },
                customer: true
            },
            orderBy: { orderDate: 'asc' }
        });

        // Collect unique SKU IDs from pending order lines
        const pendingSkuIds = new Set<string>();
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        openOrders.forEach((order: any) => {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            order.orderLines.forEach((line: any) => {
                pendingSkuIds.add(line.skuId);
            });
        });

        // Import inventory balance calculator
        const { calculateAllInventoryBalances } = await import('@coh/shared/services/db/queries');

        // Get current inventory only for pending SKUs
        const balanceMap = pendingSkuIds.size > 0
            ? await calculateAllInventoryBalances(prisma, Array.from(pendingSkuIds))
            : new Map<string, { availableBalance: number }>();

        const inventoryBalance: Record<string, number> = {};
        for (const [skuId, balance] of balanceMap) {
            inventoryBalance[skuId] = balance.availableBalance;
        }

        // Get planned/in-progress production batches
        const plannedBatches = pendingSkuIds.size > 0
            ? await prisma.productionBatch.findMany({
                where: {
                    status: { in: ['planned', 'in_progress'] },
                    skuId: { in: Array.from(pendingSkuIds) }
                },
                select: { skuId: true, qtyPlanned: true, qtyCompleted: true, sourceOrderLineId: true }
            })
            : [];

        // Calculate scheduled production per SKU
        const scheduledProduction: Record<string, number> = {};
        const scheduledByOrderLine: Record<string, number> = {};
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        plannedBatches.forEach((batch: any) => {
            if (batch.skuId) {
                if (!scheduledProduction[batch.skuId]) scheduledProduction[batch.skuId] = 0;
                scheduledProduction[batch.skuId] += (batch.qtyPlanned - batch.qtyCompleted);
            }
            if (batch.sourceOrderLineId) {
                scheduledByOrderLine[batch.sourceOrderLineId] = (scheduledByOrderLine[batch.sourceOrderLineId] || 0) + batch.qtyPlanned;
            }
        });

        // Build order-wise requirements
        interface RequirementItem {
            orderLineId: string;
            orderId: string;
            orderNumber: string;
            orderDate: Date;
            customerName: string;
            skuId: string;
            skuCode: string;
            productName: string;
            colorName: string;
            size: string;
            fabricType: string;
            qty: number;
            currentInventory: number;
            scheduledForLine: number;
            shortage: number;
            lineStatus: string;
        }

        const requirements: RequirementItem[] = [];

        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        openOrders.forEach((order: any) => {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            order.orderLines.forEach((line: any) => {
                const sku = line.sku;
                const currentInventory = inventoryBalance[line.skuId] || 0;
                const scheduledForThisLine = scheduledByOrderLine[line.id] || 0;

                // Skip if inventory already covers this line
                if (currentInventory >= line.qty) {
                    return;
                }

                const shortage = Math.max(0, line.qty - scheduledForThisLine);

                if (shortage > 0) {
                    const customer = order.customer as { firstName?: string | null; lastName?: string | null } | null;
                    const customerName = customer
                        ? [customer.firstName, customer.lastName].filter(Boolean).join(' ') || 'Unknown'
                        : 'Unknown';

                    requirements.push({
                        orderLineId: line.id,
                        orderId: order.id,
                        orderNumber: order.orderNumber,
                        orderDate: order.orderDate,
                        customerName,
                        skuId: line.skuId,
                        skuCode: sku.skuCode,
                        productName: sku.variation.product.name,
                        colorName: sku.variation.colorName || '',
                        size: sku.size || '',
                        fabricType: 'N/A', // NOTE: FabricType removed - now derived from BOM materials
                        qty: line.qty,
                        currentInventory,
                        scheduledForLine: scheduledForThisLine,
                        shortage,
                        lineStatus: line.lineStatus
                    });
                }
            });
        });

        // Sort by order date
        requirements.sort((a, b) => new Date(a.orderDate).getTime() - new Date(b.orderDate).getTime());

        return {
            requirements,
            summary: {
                totalLinesNeedingProduction: requirements.length,
                totalUnitsNeeded: requirements.reduce((sum, r) => sum + r.shortage, 0),
                totalOrdersAffected: new Set(requirements.map(r => r.orderId)).size
            }
        };
    });

/**
 * Get pending production batches for a specific SKU
 *
 * Uses Kysely to fetch planned/in_progress batches for a SKU.
 * Returns batches with pending quantities and totals.
 */
export const getProductionPendingBySku = createServerFn({ method: 'GET' })
    .middleware([authMiddleware])
    .inputValidator((input: unknown) => pendingBySkuInputSchema.parse(input))
    .handler(async ({ data: input }): Promise<PendingBySkuResponse> => {
        const db = await getKysely();

        const rows = await db
            .selectFrom('ProductionBatch')
            .leftJoin('Tailor', 'Tailor.id', 'ProductionBatch.tailorId')
            .select([
                'ProductionBatch.id',
                'ProductionBatch.batchCode',
                'ProductionBatch.batchDate',
                'ProductionBatch.qtyPlanned',
                'ProductionBatch.qtyCompleted',
                'ProductionBatch.status',
                'Tailor.id as tailorId',
                'Tailor.name as tailorName',
            ])
            .where('ProductionBatch.skuId', '=', input.skuId)
            .where('ProductionBatch.status', 'in', ['planned', 'in_progress'])
            .orderBy('ProductionBatch.batchDate', 'asc')
            .execute();

        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const batches = rows.map((r: any) => ({
            id: r.id,
            batchCode: r.batchCode,
            batchDate: r.batchDate,
            qtyPlanned: r.qtyPlanned,
            qtyCompleted: r.qtyCompleted,
            qtyPending: r.qtyPlanned - r.qtyCompleted,
            status: r.status,
            tailor: r.tailorId ? { id: r.tailorId, name: r.tailorName } : null,
        }));

        return {
            batches,
            totalPending: batches.reduce((sum: number, b: { qtyPending: number }) => sum + b.qtyPending, 0),
        };
    });
