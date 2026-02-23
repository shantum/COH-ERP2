/**
 * Shared internal types for products server functions.
 * Used by tree.ts and detail.ts for Prisma query result typing.
 */

export interface SkuData {
    id: string;
    skuCode: string;
    variationId: string;
    size: string;
    mrp: number;
    sellingPrice: number | null;
    targetStockQty: number | null;
    currentBalance: number;
    isActive: boolean;
    bomCost: number | null;
    shopifyVariantId: string | null;
}

export interface VariationData {
    id: string;
    productId: string;
    colorName: string;
    colorHex: string | null;
    imageUrl: string | null;
    isActive: boolean;
    hasLining: boolean;
    bomCost: number | null;
    shopifySourceProductId: string | null;
    skus: SkuData[];
}

export interface ProductData {
    id: string;
    name: string;
    styleCode: string | null;
    category: string;
    gender: string;
    productType: string;
    shopifyProductId: string | null;
    imageUrl: string | null;
    status: string;
    isActive: boolean;
    baseProductionTimeMins: number;
    variations: VariationData[];
}
