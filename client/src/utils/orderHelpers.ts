/**
 * Order utility functions
 * Shared helpers for order-related formatting, parsing, and data transformations
 */

import { SIZE_ORDER, type StandardSize } from '../constants/sizes';

// --- Minimal reference interfaces for type-safe helpers ---

export interface InventoryBalanceRef {
    skuId: string;
    currentBalance: number;
    availableBalance?: number;
}

export interface FabricStockRef {
    fabricId: string;
    currentBalance: number | string;
}

export interface SkuForSelection {
    id: string;
    size: string;
    mrp: number;
    variation?: {
        id: string;
        colorName: string;
        product?: { id: string; name: string };
    };
}


/**
 * Format a date string into separate date and time components
 */
export function formatDateTime(dateStr: string): { date: string; time: string } {
    const date = new Date(dateStr);
    return {
        date: date.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }),
        time: date.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', hour12: false })
    };
}

/**
 * Parse city from a JSON shipping address string
 */
export function parseCity(shippingAddress: string | null): string {
    if (!shippingAddress) return '-';
    try {
        const addr = JSON.parse(shippingAddress);
        return addr.city || '-';
    } catch {
        return '-';
    }
}

/**
 * Get available inventory balance for a SKU
 */
export function getSkuBalance(inventoryBalance: InventoryBalanceRef[] | undefined, skuId: string): number {
    const inv = inventoryBalance?.find((i) => i.skuId === skuId);
    return inv?.availableBalance ?? inv?.currentBalance ?? 0;
}

/**
 * Get fabric balance for a fabric ID
 */
export function getFabricBalance(fabricStock: FabricStockRef[] | undefined, fabricId: string): number {
    const fab = fabricStock?.find((f) => f.fabricId === fabricId);
    return fab ? parseFloat(String(fab.currentBalance)) : 0;
}


export interface FlattenedOrderRow {
    // Order-level fields
    orderId: string;
    orderNumber: string;
    orderDate: string;
    shipByDate: string | null;
    customerName: string;
    customerEmail: string | null;
    customerPhone: string | null;
    customerId: string | null;
    city: string;
    customerOrderCount: number;
    customerLtv: number;
    customerTier: string | null;
    customerRtoCount: number;
    totalAmount: number | null;
    paymentMethod: string | null;
    channel: string | null;
    internalNotes: string | null;

    // Line-level fields
    productName: string;
    colorName: string;
    colorHex: string | null;
    size: string;
    skuCode: string;
    skuId: string | null;
    imageUrl: string | null;
    qty: number;
    lineId: string | null;
    lineStatus: string | null;
    lineNotes: string;
    unitPrice?: number;
    mrp?: number;
    discountPercent?: number;
    bomCost?: number;
    margin?: number;
    fabricColourName?: string | null;
    fabricColourId?: string | null;

    // Inventory (filled client-side)
    skuStock: number;
    fabricBalance: number;

    // Shopify status
    shopifyStatus: string;

    // Production batch
    productionBatch: {
        id: string;
        batchCode: string | null;
        batchDate: string | null;
        status: string;
    } | null;
    productionBatchId: string | null;
    productionDate: string | null;

    // Row metadata
    isFirstLine: boolean;
    totalLines: number;
    fulfillmentStage: string | null;

    // Full order reference (for modals, actions)
    order: Record<string, unknown>;

    // Customization fields
    isCustomized: boolean;
    isNonReturnable: boolean;
    customSkuCode: string | null;
    customizationType: string | null;
    customizationValue: string | null;
    customizationNotes: string | null;
    originalSkuCode: string | null;

    // Line-level tracking (pre-computed for O(1) access)
    lineShippedAt: string | null;
    lineDeliveredAt: string | null;
    lineTrackingStatus: string | null;
    lineLastTrackingUpdate?: string | null;
    lineAwbNumber?: string | null;
    lineCourier?: string | null;

    // Enriched fields (from server enrichments)
    daysInTransit?: number | null;
    daysSinceDelivery?: number | null;
    daysInRto?: number | null;
    rtoStatus?: string | null;

    // Return status fields
    returnStatus?: string | null; // 'requested'|'approved'|'inspected'|'refunded'|'archived'|'rejected'|'cancelled'
    returnQty?: number | null;

    // Shopify cache fields (for columns)
    discountCodes?: string | null;
    customerNotes?: string | null;
    shopifyTags?: string | null;
    shopifyAwb?: string | null;
    shopifyCourier?: string | null;

    // Customer tags
    customerTags?: string[] | null;

    // Fabric out of stock status: null = no fabric linked, false = linked & in stock, true = linked & OOS
    isFabricOutOfStock?: boolean | null;

    // Order-level line summary (for one-row-per-order display)
    lines: OrderLineSummary[];
    totalQty: number;
}

export interface OrderLineSummary {
    lineId: string;
    productName: string;
    colorName: string;
    size: string;
    skuCode: string;
    imageUrl: string | null;
    qty: number;
    unitPrice: number;
    lineStatus: string | null;
    awbNumber: string | null;
    courier: string | null;
    trackingStatus: string | null;
}


/**
 * Filter rows by search query and date range
 */
export function filterRows(
    rows: FlattenedOrderRow[],
    searchQuery: string,
    dateRange: string,
    isOpenTab: boolean
): FlattenedOrderRow[] {
    let filtered = rows;

    // Filter by search query (order number)
    if (searchQuery.trim()) {
        const query = searchQuery.toLowerCase();
        filtered = filtered.filter(row => row.orderNumber?.toLowerCase().includes(query));
    }

    // Filter by date range (open orders only)
    if (isOpenTab && dateRange) {
        const days = parseInt(dateRange);
        const fromDate = new Date();
        fromDate.setDate(fromDate.getDate() - days);
        fromDate.setHours(0, 0, 0, 0);
        filtered = filtered.filter(row => new Date(row.orderDate) >= fromDate);
    }

    return filtered;
}

// SKU selection helpers for order creation

export interface ProductOption {
    id: string;
    name: string;
}

export interface ColorOption {
    id: string;
    name: string;
}

export interface SizeOption {
    id: string;
    size: string;
    stock: number;
    mrp: number;
}

/**
 * Get unique products from SKU list
 */
export function getUniqueProducts(allSkus: SkuForSelection[] | undefined): ProductOption[] {
    if (!allSkus) return [];
    const products = new Map<string, ProductOption>();

    allSkus.forEach((sku) => {
        const product = sku.variation?.product;
        if (product && !products.has(product.id)) {
            products.set(product.id, { id: product.id, name: product.name });
        }
    });

    return Array.from(products.values()).sort((a, b) => a.name.localeCompare(b.name));
}

/**
 * Get colors/variations for a specific product
 */
export function getColorsForProduct(allSkus: SkuForSelection[] | undefined, productId: string): ColorOption[] {
    if (!allSkus || !productId) return [];
    const colors = new Map<string, ColorOption>();

    allSkus.forEach((sku) => {
        if (sku.variation?.product?.id === productId) {
            const variation = sku.variation;
            if (!colors.has(variation.id)) {
                colors.set(variation.id, { id: variation.id, name: variation.colorName });
            }
        }
    });

    return Array.from(colors.values()).sort((a, b) => a.name.localeCompare(b.name));
}

/**
 * Get sizes for a specific variation, with stock info
 */
export function getSizesForVariation(
    allSkus: SkuForSelection[] | undefined,
    variationId: string,
    inventoryBalance: InventoryBalanceRef[] | undefined
): SizeOption[] {
    if (!allSkus || !variationId) return [];

    return allSkus
        .filter((sku) => sku.variation?.id === variationId)
        .map((sku) => ({
            id: sku.id,
            size: sku.size,
            stock: getSkuBalance(inventoryBalance, sku.id),
            mrp: sku.mrp
        }))
        .sort((a, b) => SIZE_ORDER.indexOf(a.size as StandardSize) - SIZE_ORDER.indexOf(b.size as StandardSize));
}

