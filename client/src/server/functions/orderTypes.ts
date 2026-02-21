/**
 * Order Types & Schemas
 *
 * Shared type definitions, interfaces, and Zod schemas for the orders domain.
 * Extracted from orders.ts to reduce file size and improve navigability.
 */

import { z } from 'zod';

// ============================================
// INPUT VALIDATION SCHEMAS
// ============================================

export const searchAllInputSchema = z.object({
    q: z.string().min(2, 'Search query must be at least 2 characters'),
    limit: z.number().int().positive().max(50).default(10),
});

export type SearchAllInput = z.infer<typeof searchAllInputSchema>;

export const ordersListInputSchema = z.object({
    view: z.enum(['all', 'in_transit', 'delivered', 'rto', 'cancelled'] as const),
    page: z.number().int().positive().default(1),
    limit: z.number().int().positive().max(1000).default(250),
    search: z.string().optional(),
    days: z.number().int().positive().optional(),
    sortBy: z.enum(['orderDate', 'archivedAt', 'shippedAt', 'createdAt'] as const).optional(),
});

export type OrdersListInput = z.infer<typeof ordersListInputSchema>;

// ============================================
// RESPONSE TYPES
// ============================================

/**
 * Response type matching useUnifiedOrdersData expectations
 */
export interface OrdersResponse {
    rows: FlattenedOrderRow[];
    view: string;
    hasInventory: boolean;
    pagination: {
        total: number;
        page: number;
        limit: number;
        totalPages: number;
        hasMore: boolean;
    };
}

/**
 * Flattened row for AG-Grid display (one row per order line)
 */
export interface FlattenedOrderRow {
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
    orderStatus: string;
    isArchived: boolean;
    releasedToShipped: boolean;
    releasedToCancelled: boolean;
    isExchange: boolean;
    productName: string;
    colorName: string;
    colorHex: string | null;
    imageUrl: string | null;
    size: string;
    skuCode: string;
    skuId: string | null;
    qty: number;
    lineId: string | null;
    lineStatus: string | null;
    lineNotes: string;
    unitPrice: number;
    mrp: number;
    discountPercent: number;
    bomCost: number;
    margin: number;
    fabricColourName: string | null;
    fabricColourId: string | null;
    skuStock: number;
    fabricBalance: number;
    shopifyStatus: string;
    productionBatch: {
        id: string;
        batchCode: string | null;
        batchDate: string | null;
        status: string;
    } | null;
    productionBatchId: string | null;
    productionDate: string | null;
    isFirstLine: boolean;
    totalLines: number;
    fulfillmentStage: string | null;
    order: {
        id: string;
        orderNumber: string;
        orderLines: Array<{
            id: string;
            lineStatus: string | null;
            qty: number;
            unitPrice: number;
            notes: string | null;
            awbNumber: string | null;
            courier: string | null;
            shippedAt: string | null;
            deliveredAt: string | null;
            trackingStatus: string | null;
            isCustomized: boolean;
            productionBatchId: string | null;
            skuId: string;
        }>;
        lastScanAt?: string | null;
    };
    isCustomized: boolean;
    isNonReturnable: boolean;
    customSkuCode: string | null;
    customizationType: string | null;
    customizationValue: string | null;
    customizationNotes: string | null;
    originalSkuCode: string | null;
    lineShippedAt: string | null;
    lineDeliveredAt: string | null;
    lineTrackingStatus: string | null;
    lineAwbNumber: string | null;
    lineCourier: string | null;
    daysInTransit: number | null;
    daysSinceDelivery: number | null;
    daysInRto: number | null;
    rtoStatus: string | null;
    // Return fields
    returnStatus: string | null;
    returnQty: number | null;
    discountCodes: string | null;
    customerNotes: string | null;
    shopifyTags: string | null;
    shopifyAwb: string | null;
    shopifyCourier: string | null;
    shopifyTrackingUrl: string | null;
    customerTags: string[] | null;
    /** null = no fabric colour linked, false = linked & in stock, true = linked & out of stock */
    isFabricOutOfStock: boolean | null;
}

// ============================================
// VIEW COUNTS
// ============================================

export interface OrderViewCounts {
    all: number;
    in_transit: number;
    delivered: number;
    rto: number;
    cancelled: number;
}

// ============================================
// SEARCH ALL ORDERS
// ============================================

export interface SearchResultOrder {
    id: string;
    orderNumber: string;
    customerId: string | null;
    customerName: string | null;
    customerEmail: string | null;
    customerPhone: string | null;
    status: string;
    paymentMethod: string | null;
    totalAmount: number | null;
    trackingStatus?: string;
    awbNumber?: string;
}

export interface TabResult {
    tab: string;
    tabName: string;
    count: number;
    orders: SearchResultOrder[];
}

export interface SearchAllResponse {
    query: string;
    totalResults: number;
    results: TabResult[];
}

// ============================================
// GET ORDER BY ID
// ============================================

export const getOrderByIdInputSchema = z.object({
    id: z.string().uuid('Invalid order ID'),
});

export type GetOrderByIdInput = z.infer<typeof getOrderByIdInputSchema>;

/**
 * Order detail for UnifiedOrderModal
 * Includes all fields needed for view/edit/ship operations.
 */
export interface OrderDetail {
    id: string;
    orderNumber: string;
    orderDate: string;
    shipByDate: string | null;
    customerName: string;
    customerEmail: string | null;
    customerPhone: string | null;
    customerId: string | null;
    shippingAddress: string | null;
    totalAmount: number | null;
    paymentMethod: string | null;
    paymentStatus: string | null;
    channel: string | null;
    internalNotes: string | null;
    status: string;
    isArchived: boolean;
    releasedToShipped: boolean;
    releasedToCancelled: boolean;
    isExchange: boolean;
    codRemittedAt: string | null;
    customer: {
        id: string;
        email: string;
        firstName: string | null;
        lastName: string | null;
        phone: string | null;
        tags: string | null;
        orderCount: number;
        ltv: number;
        tier: string | null;
        rtoCount: number;
    } | null;
    shopifyCache: {
        fulfillmentStatus: string | null;
        discountCodes: string | null;
        customerNotes: string | null;
        tags: string | null;
        trackingNumber: string | null;
        trackingCompany: string | null;
        trackingUrl: string | null;
    } | null;
    orderLines: Array<{
        id: string;
        skuId: string;
        qty: number;
        unitPrice: number;
        lineStatus: string | null;
        notes: string | null;
        awbNumber: string | null;
        courier: string | null;
        shippedAt: string | null;
        deliveredAt: string | null;
        trackingStatus: string | null;
        rtoInitiatedAt: string | null;
        rtoReceivedAt: string | null;
        lastScanAt: string | null;
        lastScanLocation: string | null;
        expectedDeliveryDate: string | null;
        isCustomized: boolean;
        isNonReturnable: boolean;
        productionBatchId: string | null;
        sku: {
            id: string;
            skuCode: string;
            size: string;
            mrp: number | null;
            isCustomSku: boolean;
            customizationType: string | null;
            customizationValue: string | null;
            customizationNotes: string | null;
            variation: {
                id: string;
                colorName: string;
                colorHex: string | null;
                imageUrl: string | null;
                product: {
                    id: string;
                    name: string;
                    imageUrl: string | null;
                };
            };
        };
        productionBatch: {
            id: string;
            batchCode: string | null;
            batchDate: string | null;
            status: string;
        } | null;
    }>;
}

// ============================================
// SEARCH UNIFIED
// ============================================

export const searchUnifiedInputSchema = z.object({
    q: z.string().min(2, 'Search query must be at least 2 characters'),
    page: z.number().int().positive().default(1),
    pageSize: z.number().int().positive().max(500).default(100),
});

export type SearchUnifiedInput = z.infer<typeof searchUnifiedInputSchema>;

export interface SearchUnifiedResponse {
    data: FlattenedOrderRow[];
    pagination: {
        page: number;
        pageSize: number;
        total: number;
        totalPages: number;
    };
    searchQuery: string;
}

// ============================================
// ORDER FOR EXCHANGE
// ============================================

export const getOrderForExchangeSchema = z.object({
    orderNumber: z.string().min(1, 'Order number is required'),
});

export type GetOrderForExchangeInput = z.infer<typeof getOrderForExchangeSchema>;

/**
 * Order data returned for exchange creation
 */
export interface OrderForExchange {
    id: string;
    orderNumber: string;
    customerId: string | null;
    customerName: string;
    customerEmail: string | null;
    customerPhone: string | null;
    shippingAddress: string | null;
    totalAmount: number;
    orderDate: string;
    /** Number of existing exchanges for this order (for order number preview) */
    exchangeCount: number;
    orderLines: Array<{
        id: string;
        skuId: string;
        qty: number;
        unitPrice: number;
        lineStatus: string | null;
        sku: {
            id: string;
            skuCode: string;
            size: string;
            variation: {
                colorName: string;
                imageUrl: string | null;
                product: {
                    name: string;
                    imageUrl: string | null;
                };
            };
        };
    }>;
}

export interface GetOrderForExchangeResult {
    success: boolean;
    data?: OrderForExchange;
    error?: string;
}

// ============================================
// ANALYTICS TYPES
// ============================================

export interface CustomerStats {
    newCustomers: number;
    returningCustomers: number;
    newPercent: number;
    returningPercent: number;
}

export interface RevenueData {
    total: number;
    orderCount: number;
    change: number | null;
    customers?: CustomerStats;
}

export interface TopProduct {
    id: string;
    name: string;
    imageUrl: string | null;
    qty: number;
    orderCount: number;
    salesValue: number;
    variants: Array<{ name: string; qty: number }>;
}

export interface OrdersAnalyticsResponse {
    totalOrders: number;
    pendingOrders: number;
    allocatedOrders: number;
    readyToShip: number;
    totalUnits: number;
    paymentSplit: {
        cod: { count: number; amount: number };
        prepaid: { count: number; amount: number };
    };
    topProducts: TopProduct[];
    revenue: {
        today: RevenueData;
        yesterday: RevenueData;
        last7Days: RevenueData;
        last30Days: RevenueData;
        lastMonth: RevenueData;
        thisMonth: RevenueData;
    };
}
