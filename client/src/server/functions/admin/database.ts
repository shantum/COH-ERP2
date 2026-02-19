'use server';

import { createServerFn } from '@tanstack/react-start';
import { z } from 'zod';
import { authMiddleware } from '../../middleware/auth';
import { getPrisma, type PrismaTransaction } from '@coh/shared/services/db';
import { type MutationResult, type JsonValue, requireAdminRole } from './types';

// ============================================
// INTERFACES
// ============================================

export interface DatabaseStats {
    products: number;
    skus: number;
    orders: number;
    customers: number;
    fabrics: number;
    variations: number;
    inventoryTransactions: number;
}

export interface ClearTablesResult {
    deleted: Record<string, number>;
}

export interface TableInfo {
    name: string;
    displayName: string;
    count: number;
}

export interface InspectResult {
    data: Record<string, JsonValue>[];
    total: number;
    table: string;
}

// ============================================
// INPUT SCHEMAS
// ============================================

const clearTablesSchema = z.object({
    tables: z.array(z.string()),
    confirmPhrase: z.string(),
});

const inspectTableSchema = z.object({
    tableName: z.string().min(1, 'Table name is required'),
    limit: z.number().int().positive().max(2000).optional().default(100),
    offset: z.number().int().nonnegative().optional().default(0),
});

// ============================================
// DATABASE STATS SERVER FUNCTIONS
// ============================================

/**
 * Get database statistics
 * Requires admin role
 */
export const getDatabaseStats = createServerFn({ method: 'GET' })
    .middleware([authMiddleware])
    .handler(async ({ context }): Promise<MutationResult<DatabaseStats>> => {
        try {
            requireAdminRole(context.user.role);
        } catch {
            return {
                success: false,
                error: { code: 'FORBIDDEN', message: 'Admin access required' },
            };
        }

        const prisma = await getPrisma();

        const [
            products,
            skus,
            orders,
            customers,
            fabrics,
            variations,
            inventoryTransactions,
        ] = await Promise.all([
            prisma.product.count(),
            prisma.sku.count(),
            prisma.order.count(),
            prisma.customer.count(),
            prisma.fabricColour.count(),
            prisma.variation.count(),
            prisma.inventoryTransaction.count(),
        ]);

        return {
            success: true,
            data: {
                products,
                skus,
                orders,
                customers,
                fabrics,
                variations,
                inventoryTransactions,
            },
        };
    });

// ============================================
// DATABASE CLEAR SERVER FUNCTIONS
// ============================================

/**
 * Clear database tables (danger zone)
 * Requires admin role and confirmation phrase
 */
export const clearTables = createServerFn({ method: 'POST' })
    .middleware([authMiddleware])
    .inputValidator((input: unknown) => clearTablesSchema.parse(input))
    .handler(async ({ data, context }): Promise<MutationResult<ClearTablesResult>> => {
        try {
            requireAdminRole(context.user.role);
        } catch {
            return {
                success: false,
                error: { code: 'FORBIDDEN', message: 'Admin access required' },
            };
        }

        const { tables, confirmPhrase } = data;

        if (confirmPhrase !== 'DELETE ALL DATA') {
            return {
                success: false,
                error: { code: 'BAD_REQUEST', message: 'Invalid confirmation phrase' },
            };
        }

        const prisma = await getPrisma();

        // Wrap all deletes in a transaction for atomicity
        const deleted = await prisma.$transaction(async (tx: PrismaTransaction) => {
            const counts: Record<string, number> = {};

            // Process tables in order to respect foreign key constraints
            if (tables.includes('all') || tables.includes('orders')) {
                // Delete order lines first (child table)
                const orderLinesResult = await tx.orderLine.deleteMany();
                counts.orderLines = orderLinesResult.count;

                const ordersResult = await tx.order.deleteMany();
                counts.orders = ordersResult.count;
            }

            if (tables.includes('all') || tables.includes('inventoryTransactions')) {
                const txnsResult = await tx.inventoryTransaction.deleteMany();
                counts.inventoryTransactions = txnsResult.count;
            }

            if (tables.includes('all') || tables.includes('customers')) {
                const customersResult = await tx.customer.deleteMany();
                counts.customers = customersResult.count;
            }

            if (tables.includes('all') || tables.includes('products')) {
                // Delete in order: SKU BOM → SKU → Variation → Product
                const skuBomResult = await tx.skuBomLine.deleteMany();
                counts.skuBom = skuBomResult.count;

                const skusResult = await tx.sku.deleteMany();
                counts.skus = skusResult.count;

                const variationsResult = await tx.variation.deleteMany();
                counts.variations = variationsResult.count;

                const productsResult = await tx.product.deleteMany();
                counts.products = productsResult.count;
            }

            if (tables.includes('all') || tables.includes('fabrics')) {
                // Delete in order: FabricColour → Fabric → Material
                const coloursResult = await tx.fabricColour.deleteMany();
                counts.fabricColours = coloursResult.count;

                const fabricsResult = await tx.fabric.deleteMany();
                counts.fabrics = fabricsResult.count;

                const materialsResult = await tx.material.deleteMany();
                counts.materials = materialsResult.count;
            }

            return counts;
        });

        return { success: true, data: { deleted } };
    });

// ============================================
// DATABASE INSPECTOR SERVER FUNCTIONS
// ============================================

/**
 * Get all database tables with counts
 * Requires admin role
 */
export const getTables = createServerFn({ method: 'GET' })
    .middleware([authMiddleware])
    .handler(async ({ context }): Promise<MutationResult<{ tables: TableInfo[] }>> => {
        try {
            requireAdminRole(context.user.role);
        } catch {
            return {
                success: false,
                error: { code: 'FORBIDDEN', message: 'Admin access required' },
            };
        }

        const prisma = await getPrisma();

        // Define table name mappings (Prisma model name to display name)
        const tableConfigs: { model: string; displayName: string }[] = [
            { model: 'order', displayName: 'Order' },
            { model: 'orderLine', displayName: 'Order Line' },
            { model: 'customer', displayName: 'Customer' },
            { model: 'product', displayName: 'Product' },
            { model: 'variation', displayName: 'Variation' },
            { model: 'sku', displayName: 'SKU' },
            { model: 'material', displayName: 'Material' },
            { model: 'fabric', displayName: 'Fabric' },
            { model: 'fabricColour', displayName: 'Fabric Colour' },
            { model: 'inventoryTransaction', displayName: 'Inventory Transaction' },
            { model: 'shopifyOrderCache', displayName: 'Shopify Order Cache' },
            { model: 'shopifyProductCache', displayName: 'Shopify Product Cache' },
            { model: 'user', displayName: 'User' },
            { model: 'role', displayName: 'Role' },
            { model: 'systemSetting', displayName: 'System Setting' },
            { model: 'returnRequest', displayName: 'Return Request' },
            { model: 'trim', displayName: 'Trim' },
            { model: 'externalService', displayName: 'External Service' },
            { model: 'supplier', displayName: 'Supplier' },
        ];

        const tables: TableInfo[] = [];

        // Dynamic model access — Prisma Client doesn't expose a string-indexed type
        const prismaModels = prisma as unknown as Record<string, { count?: () => Promise<number> }>;

        for (const config of tableConfigs) {
            try {
                const count = await prismaModels[config.model]?.count?.() ?? 0;
                tables.push({
                    name: config.model,
                    displayName: config.displayName,
                    count,
                });
            } catch {
                // Skip tables that don't exist or have errors
                tables.push({
                    name: config.model,
                    displayName: config.displayName,
                    count: 0,
                });
            }
        }

        // Sort by count descending
        tables.sort((a, b) => b.count - a.count);

        return { success: true, data: { tables } };
    });

/**
 * Inspect a database table
 * Requires admin role
 */
export const inspectTable = createServerFn({ method: 'GET' })
    .middleware([authMiddleware])
    .inputValidator((input: unknown) => inspectTableSchema.parse(input))
    .handler(async ({ data, context }): Promise<MutationResult<InspectResult>> => {
        try {
            requireAdminRole(context.user.role);
        } catch {
            return {
                success: false,
                error: { code: 'FORBIDDEN', message: 'Admin access required' },
            };
        }

        const prisma = await getPrisma();
        const { tableName, limit, offset } = data;

        // Dynamic model access — Prisma Client doesn't expose a string-indexed type
        type DynamicModel = {
            findMany: (args: Record<string, unknown>) => Promise<Record<string, JsonValue>[]>;
            count: () => Promise<number>;
        };
        const prismaModels = prisma as unknown as Record<string, DynamicModel | undefined>;

        try {
            const model = prismaModels[tableName];

            if (!model || typeof model.findMany !== 'function') {
                return {
                    success: false,
                    error: { code: 'NOT_FOUND', message: `Table '${tableName}' not found` },
                };
            }

            const [rows, total] = await Promise.all([
                model.findMany({
                    take: limit,
                    skip: offset,
                    orderBy: { createdAt: 'desc' },
                }),
                model.count(),
            ]);

            return {
                success: true,
                data: {
                    data: rows,
                    total,
                    table: tableName,
                },
            };
        } catch (err) {
            // Try without ordering if createdAt doesn't exist
            try {
                const model = prismaModels[tableName]!;
                const [rows, total] = await Promise.all([
                    model.findMany({
                        take: limit,
                        skip: offset,
                    }),
                    model.count(),
                ]);

                return {
                    success: true,
                    data: {
                        data: rows,
                        total,
                        table: tableName,
                    },
                };
            } catch {
                return {
                    success: false,
                    error: { code: 'BAD_REQUEST', message: `Failed to query table '${tableName}'` },
                };
            }
        }
    });
