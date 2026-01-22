/**
 * Kysely Inventory List Query
 *
 * High-performance replacement for Prisma's nested includes.
 * Uses JOINs for SKU → Variation → Product hierarchy.
 *
 * Shared between Express server and TanStack Start Server Functions.
 */
import type { InventorySkuRow, KyselyBalance } from '../../schemas/inventory.js';
export type { InventorySkuRow, KyselyBalance };
export interface InventoryListParams {
    includeCustomSkus?: boolean;
    search?: string;
    stockFilter?: 'all' | 'in_stock' | 'low_stock' | 'out_of_stock';
    limit?: number;
    offset?: number;
}
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
 * List all active SKUs with variation/product metadata and inventory balances
 * Returns paginated rows ready for AG-Grid display
 */
export declare function listInventoryKysely(params?: InventoryListParams): Promise<InventoryListResponse>;
//# sourceMappingURL=inventoryListKysely.d.ts.map