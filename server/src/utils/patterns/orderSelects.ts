/**
 * Order Select Patterns
 * Prisma select/include patterns for order queries
 */

// ============================================
// ORDER INCLUDES
// ============================================

/**
 * Order lines include pattern with SKU details
 */
export const ORDER_LINES_INCLUDE = {
    include: {
        sku: {
            include: {
                variation: { include: { product: true, fabric: true } },
            },
        },
        productionBatch: true,
    },
} as const;

/**
 * Base select for order list views - common fields across all list endpoints
 */
export const ORDER_LIST_SELECT = {
    id: true,
    orderNumber: true,
    shopifyOrderId: true,
    channel: true,
    customerId: true,
    customerName: true,
    customerEmail: true,
    customerPhone: true,
    shippingAddress: true,
    orderDate: true,
    internalNotes: true,
    status: true,
    awbNumber: true,
    courier: true,
    shippedAt: true,
    deliveredAt: true,
    totalAmount: true,
    createdAt: true,
    paymentMethod: true,
    // iThink tracking fields
    trackingStatus: true,
    expectedDeliveryDate: true,
    deliveryAttempts: true,
    lastScanStatus: true,
    lastScanLocation: true,
    lastScanAt: true,
    lastTrackingUpdate: true,
    courierStatusCode: true,
    // Relations
    customer: true,
    orderLines: ORDER_LINES_INCLUDE,
} as const;

/**
 * Shopify cache select for open orders (compact version)
 */
export const SHOPIFY_CACHE_SELECT_COMPACT = {
    select: {
        discountCodes: true,
        customerNotes: true,
        paymentMethod: true,
        tags: true,
        trackingNumber: true,
        trackingCompany: true,
        trackingUrl: true,
        shippedAt: true,
        fulfillmentStatus: true,
    },
} as const;

/**
 * Shopify cache select for shipped orders (includes rawData for extraction)
 */
export const SHOPIFY_CACHE_SELECT_FULL = {
    select: {
        rawData: true,
        discountCodes: true,
        paymentMethod: true,
        tags: true,
        trackingNumber: true,
        trackingCompany: true,
        trackingUrl: true,
        fulfillmentStatus: true,
        financialStatus: true,
    },
} as const;

/**
 * Extended select for open orders
 */
export const ORDER_LIST_SELECT_OPEN = {
    ...ORDER_LIST_SELECT,
    shopifyCache: SHOPIFY_CACHE_SELECT_COMPACT,
} as const;

/**
 * Extended select for shipped orders
 */
export const ORDER_LIST_SELECT_SHIPPED = {
    ...ORDER_LIST_SELECT,
    rtoInitiatedAt: true,
    rtoReceivedAt: true,
    codRemittedAt: true,
    codRemittanceUtr: true,
    codRemittedAmount: true,
    shopifyCache: SHOPIFY_CACHE_SELECT_FULL,
} as const;

/**
 * Extended select for RTO orders
 */
export const ORDER_LIST_SELECT_RTO = {
    ...ORDER_LIST_SELECT,
    rtoInitiatedAt: true,
    rtoReceivedAt: true,
} as const;

/**
 * Select for COD pending orders
 */
export const ORDER_LIST_SELECT_COD_PENDING = ORDER_LIST_SELECT;
