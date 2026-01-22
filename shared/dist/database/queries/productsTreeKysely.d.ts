/**
 * Kysely Products Tree Query
 *
 * High-performance replacement for Prisma's nested includes.
 * Uses CTEs and JSON aggregation for single-query data fetching.
 *
 * Shared between Express server and TanStack Start Server Functions.
 */
/**
 * Query parameters for products tree
 */
export interface ProductsTreeParams {
    search?: string;
}
/**
 * SKU node in the tree
 */
export interface SkuNode {
    id: string;
    type: 'sku';
    name: string;
    isActive: boolean;
    variationId: string;
    skuCode: string;
    barcode: string;
    size: string;
    mrp: number;
    fabricConsumption?: number;
    currentBalance: number;
    availableBalance: number;
    targetStockQty?: number;
    trimsCost: number | null;
    liningCost: number | null;
    packagingCost: number | null;
    laborMinutes: number | null;
}
/**
 * Variation node in the tree
 */
export interface VariationNode {
    id: string;
    type: 'variation';
    name: string;
    isActive: boolean;
    productId: string;
    productName: string;
    colorName: string;
    colorHex?: string;
    fabricId?: string;
    fabricName?: string;
    imageUrl?: string;
    hasLining: boolean;
    totalStock: number;
    avgMrp: number | null;
    trimsCost: number | null;
    liningCost: number | null;
    packagingCost: number | null;
    laborMinutes: number | null;
    children: SkuNode[];
}
/**
 * Product node in the tree
 */
export interface ProductNode {
    id: string;
    type: 'product';
    name: string;
    isActive: boolean;
    styleCode?: string;
    category: string;
    gender?: string;
    productType?: string;
    fabricTypeId?: string;
    fabricTypeName?: string;
    imageUrl?: string;
    hasLining: boolean;
    variationCount: number;
    skuCount: number;
    totalStock: number;
    avgMrp: number | null;
    trimsCost: number | null;
    liningCost: number | null;
    packagingCost: number | null;
    laborMinutes: number | null;
    children: VariationNode[];
}
/**
 * Full response type
 */
export interface ProductsTreeResponse {
    items: ProductNode[];
    summary: {
        products: number;
        variations: number;
        skus: number;
        totalStock: number;
    };
}
/**
 * Fetch products tree using Kysely
 *
 * Uses a single optimized query with JSON aggregation instead of N+1 queries.
 * Returns hierarchical data ready for TanStack Table tree display.
 */
export declare function listProductsTreeKysely(params?: ProductsTreeParams): Promise<ProductsTreeResponse>;
//# sourceMappingURL=productsTreeKysely.d.ts.map