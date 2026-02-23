/**
 * Inventory Query Helpers
 *
 * Pure functions extracted from the inventory server function to keep
 * server functions thin.  No DB or Node-only deps — safe for any context.
 */

// ---------------------------------------------------------------------------
// Types (mirrors the InventoryAllItem shape from the server function)
// ---------------------------------------------------------------------------

/** Minimal item shape required by filter / stats / sort helpers */
export interface InventoryItemForQuery {
    availableBalance: number;
    status: 'below_target' | 'ok';
    targetStockQty: number | null;
    shopifyQty: number | null;
    shopifyProductStatus: 'active' | 'archived' | 'draft' | null;
    fabricColourBalance: number | null;
    productId: string;
    productName: string;
    imageUrl: string | null;
    colorName: string;
}

export interface InventoryFilterParams {
    belowTarget?: boolean;
    stockFilter?: 'all' | 'in_stock' | 'out_of_stock' | 'low_stock';
    shopifyStatus?: 'all' | 'active' | 'archived' | 'draft';
    discrepancy?: 'all' | 'has_discrepancy' | 'no_discrepancy';
    fabricFilter?: 'all' | 'has_fabric' | 'no_fabric' | 'low_fabric';
}

export interface TopStockedProduct {
    productId: string;
    productName: string;
    imageUrl: string | null;
    totalAvailable: number;
    colors: { colorName: string; available: number }[];
}

export interface InventoryStats {
    totalPieces: number;
    totalSkus: number;
    inStockCount: number;
    lowStockCount: number;
    outOfStockCount: number;
    topStockedProducts: TopStockedProduct[];
}

// ---------------------------------------------------------------------------
// Filter predicate (reusable by both flat + grouped views)
// ---------------------------------------------------------------------------

/**
 * Returns true if the item passes all active filters.
 * Works on any object that satisfies InventoryItemForQuery.
 */
export function inventoryFilterPredicate(
    item: InventoryItemForQuery,
    filters: InventoryFilterParams,
): boolean {
    const { belowTarget, stockFilter, shopifyStatus, discrepancy, fabricFilter } = filters;

    // Legacy below-target filter
    if (belowTarget === true && item.status !== 'below_target') return false;

    // Stock filter
    if (stockFilter && stockFilter !== 'all') {
        switch (stockFilter) {
            case 'in_stock':
                if (item.availableBalance <= 0) return false;
                break;
            case 'out_of_stock':
                if (item.availableBalance > 0) return false;
                break;
            case 'low_stock':
                if (item.availableBalance <= 0 || item.availableBalance >= (item.targetStockQty || 10)) return false;
                break;
        }
    }

    // Shopify product status filter
    if (shopifyStatus && shopifyStatus !== 'all') {
        if (item.shopifyProductStatus !== shopifyStatus) return false;
    }

    // Shopify qty discrepancy filter
    if (discrepancy && discrepancy !== 'all') {
        const hasDiscrepancy = item.shopifyQty !== null && item.shopifyQty !== item.availableBalance;
        if (discrepancy === 'has_discrepancy' && !hasDiscrepancy) return false;
        if (discrepancy === 'no_discrepancy' && hasDiscrepancy) return false;
    }

    // Fabric filter
    if (fabricFilter && fabricFilter !== 'all') {
        switch (fabricFilter) {
            case 'has_fabric':
                if (item.fabricColourBalance === null || item.fabricColourBalance <= 0) return false;
                break;
            case 'no_fabric':
                if (item.fabricColourBalance !== null && item.fabricColourBalance > 0) return false;
                break;
            case 'low_fabric':
                if (item.fabricColourBalance === null || item.fabricColourBalance <= 0 || item.fabricColourBalance >= 10) return false;
                break;
        }
    }

    return true;
}

// ---------------------------------------------------------------------------
// applyInventoryFilters — convenience wrapper that filters an array
// ---------------------------------------------------------------------------

/**
 * Filter an array of inventory items using the shared predicate.
 */
export function applyInventoryFilters<T extends InventoryItemForQuery>(
    items: T[],
    filters: InventoryFilterParams,
): T[] {
    return items.filter((item) => inventoryFilterPredicate(item, filters));
}

// ---------------------------------------------------------------------------
// sortInventoryItems
// ---------------------------------------------------------------------------

type SortColumn = 'stock' | 'shopify' | 'fabric';
type SortOrder = 'asc' | 'desc';

/**
 * Sort inventory items in-place by the given column and order.
 * Returns the same array reference (mutated) for chaining convenience.
 */
export function sortInventoryItems<T extends InventoryItemForQuery>(
    items: T[],
    sortBy: SortColumn = 'stock',
    sortOrder: SortOrder = 'desc',
): T[] {
    items.sort((a, b) => {
        let aVal: number;
        let bVal: number;

        switch (sortBy) {
            case 'shopify':
                aVal = a.shopifyQty ?? (sortOrder === 'desc' ? -Infinity : Infinity);
                bVal = b.shopifyQty ?? (sortOrder === 'desc' ? -Infinity : Infinity);
                break;
            case 'fabric':
                aVal = a.fabricColourBalance ?? (sortOrder === 'desc' ? -Infinity : Infinity);
                bVal = b.fabricColourBalance ?? (sortOrder === 'desc' ? -Infinity : Infinity);
                break;
            case 'stock':
            default:
                aVal = a.availableBalance;
                bVal = b.availableBalance;
                break;
        }

        return sortOrder === 'asc' ? aVal - bVal : bVal - aVal;
    });

    return items;
}

// ---------------------------------------------------------------------------
// computeInventoryStats
// ---------------------------------------------------------------------------

/**
 * Compute aggregated inventory stats from an array of filtered items.
 * Pure function — no side effects.
 */
export function computeInventoryStats<T extends InventoryItemForQuery>(
    items: T[],
): InventoryStats {
    let totalPieces = 0;
    let inStockCount = 0;
    let lowStockCount = 0;
    let outOfStockCount = 0;

    const productStockMap = new Map<string, {
        productId: string;
        productName: string;
        imageUrl: string | null;
        totalAvailable: number;
        colorMap: Map<string, number>;
    }>();

    for (const item of items) {
        totalPieces += item.availableBalance;

        if (item.availableBalance === 0) {
            outOfStockCount++;
        } else if (item.status === 'below_target') {
            lowStockCount++;
        } else {
            inStockCount++;
        }

        // Aggregate for top stocked products
        if (item.productId && item.availableBalance > 0) {
            let product = productStockMap.get(item.productId);
            if (!product) {
                product = {
                    productId: item.productId,
                    productName: item.productName,
                    imageUrl: item.imageUrl,
                    totalAvailable: 0,
                    colorMap: new Map(),
                };
                productStockMap.set(item.productId, product);
            }
            product.totalAvailable += item.availableBalance;

            const colorKey = item.colorName || 'Unknown';
            product.colorMap.set(colorKey, (product.colorMap.get(colorKey) || 0) + item.availableBalance);

            if (!product.imageUrl && item.imageUrl) {
                product.imageUrl = item.imageUrl;
            }
        }
    }

    // Build top 5 stocked products
    const topStockedProducts: TopStockedProduct[] = Array.from(productStockMap.values())
        .sort((a, b) => b.totalAvailable - a.totalAvailable)
        .slice(0, 5)
        .map((p) => ({
            productId: p.productId,
            productName: p.productName,
            imageUrl: p.imageUrl,
            totalAvailable: p.totalAvailable,
            colors: Array.from(p.colorMap.entries())
                .map(([colorName, available]) => ({ colorName, available }))
                .sort((a, b) => b.available - a.available)
                .slice(0, 3),
        }));

    return {
        totalPieces,
        totalSkus: items.length,
        inStockCount,
        lowStockCount,
        outOfStockCount,
        topStockedProducts,
    };
}
