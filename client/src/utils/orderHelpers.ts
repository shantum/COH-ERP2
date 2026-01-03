/**
 * Order utility functions
 * Shared helpers for order-related formatting, parsing, and data transformations
 */

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

/**
 * Compute customer stats (order count and LTV) from orders
 */
export function computeCustomerStats(
    openOrders: any[] | undefined,
    shippedOrders: any[] | undefined
): Record<string, { orderCount: number; ltv: number }> {
    const stats: Record<string, { orderCount: number; ltv: number }> = {};
    const allOrders = [...(openOrders || []), ...(shippedOrders || [])];

    allOrders.forEach(order => {
        const key = order.customerEmail || order.customerName || 'unknown';
        if (!stats[key]) {
            stats[key] = { orderCount: 0, ltv: 0 };
        }
        stats[key].orderCount++;
        stats[key].ltv += Number(order.totalAmount) || 0;
    });

    return stats;
}

export interface FlattenedOrderRow {
    orderId: string;
    orderNumber: string;
    orderDate: string;
    customerName: string;
    city: string;
    customerOrderCount: number;
    customerLtv: number;
    productName: string;
    colorName: string;
    size: string;
    skuCode: string;
    skuId: string | null;
    qty: number;
    lineId: string | null;
    lineStatus: string | null;
    skuStock: number;
    fabricBalance: number;
    shopifyStatus: string;
    productionBatch: any;
    productionBatchId: string | null;
    productionDate: string | null;
    isFirstLine: boolean;
    totalLines: number;
    fulfillmentStage: string;
    order: any;
}

/**
 * Flatten orders into order line rows for table display
 * Sorted by newest first
 */
export function flattenOrders(
    orders: any[] | undefined,
    customerStats: Record<string, { orderCount: number; ltv: number }>,
    inventoryBalance: any[] | undefined,
    fabricStock: any[] | undefined
): FlattenedOrderRow[] {
    if (!orders) return [];

    // Sort orders by date descending (newest first)
    const sortedOrders = [...orders].sort((a, b) =>
        new Date(b.orderDate).getTime() - new Date(a.orderDate).getTime()
    );

    const rows: FlattenedOrderRow[] = [];

    sortedOrders.forEach(order => {
        const customerKey = order.customerEmail || order.customerName || 'unknown';
        const custStats = customerStats[customerKey] || { orderCount: 0, ltv: 0 };
        const orderLines = order.orderLines || [];

        // Handle orders with no items (test orders)
        if (orderLines.length === 0) {
            rows.push({
                orderId: order.id,
                orderNumber: order.orderNumber,
                orderDate: order.orderDate,
                customerName: order.customerName,
                city: parseCity(order.shippingAddress),
                customerOrderCount: custStats.orderCount,
                customerLtv: custStats.ltv,
                productName: '(no items)',
                colorName: '-',
                size: '-',
                skuCode: '-',
                skuId: null,
                qty: 0,
                lineId: null,
                lineStatus: null,
                skuStock: 0,
                fabricBalance: 0,
                shopifyStatus: order.shopifyFulfillmentStatus || '-',
                productionBatch: null,
                productionBatchId: null,
                productionDate: null,
                isFirstLine: true,
                totalLines: 0,
                fulfillmentStage: order.fulfillmentStage,
                order: order
            });
            return;
        }

        orderLines.forEach((line: any, idx: number) => {
            const fabricId = line.sku?.variation?.fabric?.id;
            const skuStock = getSkuBalance(inventoryBalance, line.skuId);
            const fabricBal = fabricId ? getFabricBalance(fabricStock, fabricId) : 0;
            const productionBatch = line.productionBatch;

            rows.push({
                orderId: order.id,
                orderNumber: order.orderNumber,
                orderDate: order.orderDate,
                customerName: order.customerName,
                city: parseCity(order.shippingAddress),
                customerOrderCount: custStats.orderCount,
                customerLtv: custStats.ltv,
                productName: line.sku?.variation?.product?.name || '-',
                colorName: line.sku?.variation?.colorName || '-',
                size: line.sku?.size || '-',
                skuCode: line.sku?.skuCode || '-',
                skuId: line.skuId,
                qty: line.qty,
                lineId: line.id,
                lineStatus: line.lineStatus,
                skuStock,
                fabricBalance: fabricBal,
                shopifyStatus: order.shopifyFulfillmentStatus || '-',
                productionBatch,
                productionBatchId: productionBatch?.id || null,
                productionDate: productionBatch?.batchDate?.split('T')[0] || null,
                isFirstLine: idx === 0,
                totalLines: orderLines.length,
                fulfillmentStage: order.fulfillmentStage,
                order: order
            });
        });
    });

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

    const sizeOrder = ['XS', 'S', 'M', 'L', 'XL', '2XL', '3XL', '4XL', 'Free'];

    return allSkus
        .filter((sku: any) => sku.variation?.id === variationId)
        .map((sku: any) => ({
            id: sku.id,
            size: sku.size,
            stock: getSkuBalance(inventoryBalance, sku.id),
            mrp: sku.mrp
        }))
        .sort((a, b) => sizeOrder.indexOf(a.size) - sizeOrder.indexOf(b.size));
}

// Default column headers for the orders grid
export const DEFAULT_HEADERS: Record<string, string> = {
    orderDate: 'Date',
    orderNumber: 'Order',
    customerName: 'Customer',
    city: 'City',
    paymentMethod: 'Pay',
    customerNotes: 'Order Notes',
    customerOrderCount: '#',
    customerLtv: 'LTV',
    skuCode: 'SKU',
    productName: 'Item',
    qty: 'Q',
    skuStock: 'St',
    fabricBalance: 'Fab',
    allocate: 'A',
    production: 'Production',
    notes: 'Notes',
    pick: 'P',
    ship: 'S',
    awb: 'AWB',
    courier: 'Courier',
    actions: '...',
};
