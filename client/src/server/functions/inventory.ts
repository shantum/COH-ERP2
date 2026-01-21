/**
 * Inventory Server Functions
 *
 * TanStack Start Server Functions for inventory data fetching.
 * Bypasses tRPC/Express, calls Kysely directly from the server.
 *
 * IMPORTANT: All database imports are dynamic to prevent Node.js code
 * (pg, Buffer) from being bundled into the client.
 */

import { createServerFn } from '@tanstack/react-start';
import { z } from 'zod';

// Input validation schema
const inventoryListInputSchema = z.object({
    includeCustomSkus: z.boolean().optional().default(false),
    search: z.string().optional(),
    stockFilter: z.enum(['all', 'in_stock', 'low_stock', 'out_of_stock']).optional().default('all'),
    limit: z.number().int().positive().max(10000).optional().default(10000),
    offset: z.number().int().nonnegative().optional().default(0),
});

export type InventoryListInput = z.infer<typeof inventoryListInputSchema>;

/**
 * Inventory item returned by the Server Function
 */
export interface InventoryItem {
    skuId: string;
    skuCode: string;
    productId: string;
    productName: string;
    productType: string;
    gender: string;
    colorName: string;
    variationId: string;
    size: string;
    category: string;
    imageUrl: string | null;
    currentBalance: number;
    reservedBalance: number;
    availableBalance: number;
    totalInward: number;
    totalOutward: number;
    targetStockQty: number;
    status: 'ok' | 'below_target';
    mrp: number;
    shopifyQty: number | null;
    isCustomSku: boolean;
}

/**
 * Response type matching the frontend hook expectations
 */
export interface InventoryListResponse {
    items: InventoryItem[];
    pagination: {
        total: number;
        limit: number;
        offset: number;
        hasMore: boolean;
    };
}

/**
 * Server Function: Get inventory list
 *
 * Fetches inventory directly from database using Kysely.
 * Returns paginated items with balance calculations.
 */
export const getInventoryList = createServerFn({ method: 'GET' })
    .inputValidator((input: unknown) => inventoryListInputSchema.parse(input))
    .handler(async ({ data }): Promise<InventoryListResponse> => {
        console.log('[Server Function] getInventoryList called with:', data);

        try {
            // Dynamic imports - only loaded on server, not bundled into client
            const { createKysely } = await import('@coh/shared/database');
            const { listInventoryKysely } = await import(
                '@coh/shared/database/queries/inventoryListKysely'
            );

            // Initialize Kysely singleton (safe to call multiple times)
            createKysely(process.env.DATABASE_URL);

            // Call Kysely query directly
            const result = await listInventoryKysely({
                includeCustomSkus: data.includeCustomSkus,
                search: data.search,
                stockFilter: data.stockFilter,
                limit: data.limit,
                offset: data.offset,
            });

            console.log(
                '[Server Function] Query returned',
                result.items.length,
                'items, total:',
                result.pagination.total
            );

            return result;
        } catch (error) {
            console.error('[Server Function] Error in getInventoryList:', error);
            throw error;
        }
    });
