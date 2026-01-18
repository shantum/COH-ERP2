/**
 * Order utility functions
 * Shared helpers for order-related formatting, parsing, and data transformations
 */

import { SIZE_ORDER } from '../constants/sizes';

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
export function getSkuBalance(inventoryBalance: any[] | undefined, skuId: string): number {
    const inv = inventoryBalance?.find((i: any) => i.skuId === skuId);
    return inv?.availableBalance ?? inv?.currentBalance ?? 0;
}

/**
 * Get fabric balance for a fabric ID
 */
export function getFabricBalance(fabricStock: any[] | undefined, fabricId: string): number {
    const fab = fabricStock?.find((f: any) => f.fabricId === fabricId);
    return fab ? parseFloat(fab.currentBalance) : 0;
}

// Pre-built Maps for O(1) lookups during flattenOrders
let inventoryMap: Map<string, number> | null = null;
let fabricMap: Map<string, number> | null = null;
let lastInventoryRef: any[] | undefined = undefined;
let lastFabricRef: any[] | undefined = undefined;

function getInventoryMap(inventoryBalance: any[] | undefined): Map<string, number> {
    // Rebuild if reference changed OR map is null (first call)
    if (inventoryMap === null || inventoryBalance !== lastInventoryRef) {
        inventoryMap = new Map();
        if (inventoryBalance) {
            for (const item of inventoryBalance) {
                inventoryMap.set(item.skuId, item.availableBalance ?? item.currentBalance ?? 0);
            }
        }
        lastInventoryRef = inventoryBalance;
    }
    return inventoryMap;
}

function getFabricMap(fabricStock: any[] | undefined): Map<string, number> {
    // Rebuild if reference changed OR map is null (first call)
    if (fabricMap === null || fabricStock !== lastFabricRef) {
        fabricMap = new Map();
        if (fabricStock) {
            for (const item of fabricStock) {
                fabricMap.set(item.fabricId, parseFloat(item.currentBalance) || 0);
            }
        }
        lastFabricRef = fabricStock;
    }
    return fabricMap;
}

/**
 * Compute customer order counts from orders
 * Note: LTV is now provided by the server for consistency
 */
export function computeCustomerStats(
    openOrders: any[] | undefined,
    shippedOrders: any[] | undefined
): Record<string, { orderCount: number }> {
    const stats: Record<string, { orderCount: number }> = {};
    const allOrders = [...(openOrders || []), ...(shippedOrders || [])];

    allOrders.forEach(order => {
        const key = order.customerEmail || order.customerName || 'unknown';
        if (!stats[key]) {
            stats[key] = { orderCount: 0 };
        }
        stats[key].orderCount++;
    });

    return stats;
}

/**
 * Enrich server-flattened rows with client-side inventory/fabric data
 * This is O(n) with O(1) Map lookups - much faster than full client-side flatten
 *
 * The server pre-flattens orders into rows (sorting, object creation, field extraction).
 * The client only fills in inventory balances which are queried separately.
 */
export function enrichRowsWithInventory<T extends { skuId: string | null; skuStock?: number; fabricBalance?: number }>(
    rows: T[],
    inventoryBalance: any[] | undefined,
    fabricStock: any[] | undefined
): T[] {
    if (!rows || rows.length === 0) return rows;

    // Build O(1) lookup maps (reuses cached maps if data hasn't changed)
    const invMap = getInventoryMap(inventoryBalance);
    const fabMap = getFabricMap(fabricStock);

    // If no inventory data, return rows as-is (server defaults skuStock/fabricBalance to 0)
    if (invMap.size === 0 && fabMap.size === 0) {
        return rows;
    }

    // Single O(n) pass to fill inventory data
    // Only overwrite skuStock if we have inventory data (otherwise preserve server value)
    const hasInventoryData = invMap.size > 0;

    return rows.map(row => {
        // Skip rows without SKU (empty orders, etc.)
        if (!row.skuId) return row;

        // Only use client inventory data if available; otherwise preserve server's skuStock
        const skuStock = hasInventoryData ? (invMap.get(row.skuId) ?? 0) : (row.skuStock ?? 0);
        // Note: fabricBalance requires fabric ID which isn't on the row
        // For now, keep server default (0). Could enhance later if needed.
        const fabricBalance = row.fabricBalance ?? 0;

        // Only create new object if values changed
        if (row.skuStock === skuStock && row.fabricBalance === fabricBalance) {
            return row;
        }

        return { ...row, skuStock, fabricBalance };
    });
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

    // Inventory (filled client-side)
    skuStock: number;
    fabricBalance: number;

    // Shopify status
    shopifyStatus: string;

    // Production batch
    productionBatch: {
        id: string;
        batchCode: string;
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
    order: any;

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
    lineLastTrackingUpdate: string | null;
    lineAwbNumber?: string | null;
    lineCourier?: string | null;

    // Enriched fields (from server enrichments)
    daysInTransit?: number | null;
    daysSinceDelivery?: number | null;
    daysInRto?: number | null;
    rtoStatus?: string | null;

    // Shopify cache fields (for columns)
    discountCodes?: string | null;
    customerNotes?: string | null;
    shopifyTags?: string | null;
    shopifyAwb?: string | null;
    shopifyCourier?: string | null;

    // Customer tags
    customerTags?: string[] | null;
}

/**
 * Flatten orders into order line rows for table display
 * Sorted by newest first
 * Note: customerStats parameter kept for API compatibility but no longer used
 * (order count now comes from server via order.customerOrderCount)
 */
export function flattenOrders(
    orders: any[] | undefined,
    _customerStats: Record<string, { orderCount: number }>,
    inventoryBalance: any[] | undefined,
    fabricStock: any[] | undefined
): FlattenedOrderRow[] {
    if (!orders) return [];

    // Build O(1) lookup maps (cached if data hasn't changed)
    const invMap = getInventoryMap(inventoryBalance);
    const fabMap = getFabricMap(fabricStock);

    // Sort orders by date descending (newest first)
    const sortedOrders = [...orders].sort((a, b) =>
        new Date(b.orderDate).getTime() - new Date(a.orderDate).getTime()
    );

    const rows: FlattenedOrderRow[] = [];

    // Debug: log orders with 0 items (only in dev)
    if (import.meta.env.DEV) {
        const zeroItemOrders = sortedOrders.filter(o => !o.orderLines || o.orderLines.length === 0);
        if (zeroItemOrders.length > 0) {
            console.log('[flattenOrders] Orders with 0 items:', zeroItemOrders.map(o => o.orderNumber));
        }
    }

    for (const order of sortedOrders) {
        const orderLines = order.orderLines || [];
        // Use server-provided values (calculated from ALL customer orders)
        const serverLtv = order.customerLtv || 0;
        const serverOrderCount = order.customerOrderCount || 0;

        // Handle orders with no items (test orders)
        if (orderLines.length === 0) {
            rows.push({
                orderId: order.id,
                orderNumber: order.orderNumber,
                orderDate: order.orderDate,
                shipByDate: order.shipByDate || null,
                customerName: order.customerName,
                customerEmail: order.customerEmail || null,
                customerPhone: order.customerPhone || null,
                customerId: order.customerId || null,
                city: parseCity(order.shippingAddress),
                customerOrderCount: serverOrderCount,
                customerLtv: serverLtv,
                customerTier: order.customerTier || null,
                customerRtoCount: order.customerRtoCount || 0,
                totalAmount: order.totalAmount || null,
                paymentMethod: order.paymentMethod || null,
                channel: order.channel || null,
                internalNotes: order.internalNotes || null,
                productName: '(no items)',
                colorName: '-',
                colorHex: null,
                size: '-',
                skuCode: '-',
                skuId: null,
                imageUrl: null,
                qty: 0,
                lineId: null,
                lineStatus: null,
                lineNotes: '',
                skuStock: 0,
                fabricBalance: 0,
                shopifyStatus: order.shopifyCache?.fulfillmentStatus || '-',
                shopifyAwb: order.shopifyCache?.trackingNumber || null,
                shopifyCourier: order.shopifyCache?.trackingCompany || null,
                shopifyTags: order.shopifyCache?.tags || null,
                productionBatch: null,
                productionBatchId: null,
                productionDate: null,
                isFirstLine: true,
                totalLines: 0,
                fulfillmentStage: order.fulfillmentStage || null,
                order: order,
                // Customization fields
                isCustomized: false,
                isNonReturnable: false,
                customSkuCode: null,
                customizationType: null,
                customizationValue: null,
                customizationNotes: null,
                originalSkuCode: null,
                // Line-level tracking (null for empty orders)
                lineShippedAt: null,
                lineDeliveredAt: null,
                lineTrackingStatus: null,
                lineLastTrackingUpdate: null,
            });
            continue;
        }

        const lineCount = orderLines.length;
        for (let idx = 0; idx < lineCount; idx++) {
            const line = orderLines[idx];
            const fabricId = line.sku?.variation?.fabric?.id;
            // O(1) Map lookups instead of O(n) array.find()
            const skuStock = line.skuId ? (invMap.get(line.skuId) ?? 0) : 0;
            const fabricBal = fabricId ? (fabMap.get(fabricId) ?? 0) : 0;
            const productionBatch = line.productionBatch;

            // Extract customization data
            const isCustomized = line.isCustomized || false;
            const isNonReturnable = line.isNonReturnable || false;
            const sku = line.sku;
            const customSkuCode = isCustomized && sku?.isCustomSku ? sku.skuCode : null;
            const customizationType = sku?.customizationType || null;
            const customizationValue = sku?.customizationValue || null;
            const customizationNotes = sku?.customizationNotes || null;
            // originalSkuCode would need to be populated by the backend
            const originalSkuCode = line.originalSkuId ? (line.originalSku?.skuCode || null) : null;

            rows.push({
                orderId: order.id,
                orderNumber: order.orderNumber,
                orderDate: order.orderDate,
                shipByDate: order.shipByDate || null,
                customerName: order.customerName,
                customerEmail: order.customerEmail || null,
                customerPhone: order.customerPhone || null,
                customerId: order.customerId || null,
                city: parseCity(order.shippingAddress),
                customerOrderCount: serverOrderCount,
                customerLtv: serverLtv,
                customerTier: order.customerTier || null,
                customerRtoCount: order.customerRtoCount || 0,
                totalAmount: order.totalAmount || null,
                paymentMethod: order.paymentMethod || null,
                channel: order.channel || null,
                internalNotes: order.internalNotes || null,
                productName: line.sku?.variation?.product?.name || '-',
                colorName: line.sku?.variation?.colorName || '-',
                colorHex: line.sku?.variation?.colorHex || null,
                size: line.sku?.size || '-',
                skuCode: line.sku?.skuCode || '-',
                skuId: line.skuId,
                imageUrl: line.sku?.variation?.imageUrl || line.sku?.variation?.product?.imageUrl || null,
                qty: line.qty,
                lineId: line.id,
                lineStatus: line.lineStatus,
                lineNotes: line.notes || '',
                skuStock,
                fabricBalance: fabricBal,
                shopifyStatus: order.shopifyCache?.fulfillmentStatus || '-',
                shopifyAwb: order.shopifyCache?.trackingNumber || null,
                shopifyCourier: order.shopifyCache?.trackingCompany || null,
                shopifyTags: order.shopifyCache?.tags || null,
                productionBatch,
                productionBatchId: productionBatch?.id || null,
                productionDate: productionBatch?.batchDate?.split('T')[0] || null,
                isFirstLine: idx === 0,
                totalLines: orderLines.length,
                fulfillmentStage: order.fulfillmentStage || null,
                order: order,
                // Customization fields
                isCustomized,
                isNonReturnable,
                customSkuCode,
                customizationType,
                customizationValue,
                customizationNotes,
                originalSkuCode,
                // Line-level tracking (pre-computed for O(1) access in valueGetters)
                lineShippedAt: line.shippedAt || null,
                lineDeliveredAt: line.deliveredAt || null,
                lineTrackingStatus: line.trackingStatus || null,
                lineLastTrackingUpdate: line.lastTrackingUpdate || null,
            });
        }
    }

    return rows;
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
export function getUniqueProducts(allSkus: any[] | undefined): ProductOption[] {
    if (!allSkus) return [];
    const products = new Map<string, ProductOption>();

    allSkus.forEach((sku: any) => {
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
export function getColorsForProduct(allSkus: any[] | undefined, productId: string): ColorOption[] {
    if (!allSkus || !productId) return [];
    const colors = new Map<string, ColorOption>();

    allSkus.forEach((sku: any) => {
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
    allSkus: any[] | undefined,
    variationId: string,
    inventoryBalance: any[] | undefined
): SizeOption[] {
    if (!allSkus || !variationId) return [];

    return allSkus
        .filter((sku: any) => sku.variation?.id === variationId)
        .map((sku: any) => ({
            id: sku.id,
            size: sku.size,
            stock: getSkuBalance(inventoryBalance, sku.id),
            mrp: sku.mrp
        }))
        .sort((a, b) => SIZE_ORDER.indexOf(a.size as any) - SIZE_ORDER.indexOf(b.size as any));
}

// Default column headers for the orders grid (cleaner, more readable names)
export const DEFAULT_HEADERS: Record<string, string> = {
    orderDate: 'Order Date',
    orderAge: 'Age',
    shipByDate: 'Ship By',
    orderNumber: 'Order #',
    customerName: 'Customer',
    city: 'City',
    orderValue: 'Value',
    discountCode: 'Discount',
    tags: 'Tags',
    paymentMethod: 'Payment',
    rtoHistory: 'RTO Risk',
    customerNotes: 'Order Notes',
    customerOrderCount: 'Orders',
    customerLtv: 'LTV',
    customerTags: 'Customer Tags',
    skuCode: 'SKU',
    productName: 'Product',
    customize: 'Custom',
    qty: 'Qty',
    skuStock: 'Stock',
    fabricBalance: 'Fabric',
    allocate: 'Alloc',
    production: 'Production',
    notes: 'Notes',
    pick: 'Pick',
    pack: 'Pack',
    ship: 'Ship',
    cancelLine: 'Cancel',
    shopifyStatus: 'Shopify',
    shopifyAwb: 'Shopify AWB',
    shopifyCourier: 'Shopify Courier',
    awb: 'AWB',
    courier: 'Courier',
    trackingStatus: 'Tracking',
    // Post-ship columns
    shippedAt: 'Shipped',
    deliveredAt: 'Delivered',
    deliveryDays: 'Del Days',
    daysInTransit: 'Transit',
    rtoInitiatedAt: 'RTO Date',
    daysInRto: 'RTO Days',
    daysSinceDelivery: 'Since Del',
    codRemittedAt: 'COD Remitted',
    archivedAt: 'Archived',
    finalStatus: 'Status',
    actions: 'Actions',
};

// Columns shown by default (cleaner initial view)
export const DEFAULT_VISIBLE_COLUMNS = [
    'orderDate', 'orderAge', 'orderNumber', 'customerName', 'paymentMethod', 'rtoHistory', 'productName',
    'qty', 'skuStock', 'allocate', 'production', 'notes', 'pick', 'pack', 'ship', 'cancelLine', 'actions'
];
