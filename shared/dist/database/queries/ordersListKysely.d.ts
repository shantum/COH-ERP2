/**
 * Kysely Orders List Query
 *
 * High-performance replacement for Prisma's nested includes.
 * Uses CTEs and JSON aggregation for single-query data fetching.
 *
 * Shared between Express server and TanStack Start Server Functions.
 */
/**
 * View names matching the existing tRPC router
 */
export type ViewName = 'open' | 'shipped' | 'cancelled';
/**
 * Shipped view sub-filters
 */
export type ShippedFilter = 'all' | 'rto' | 'cod_pending';
/**
 * Sort fields supported by the query
 */
export type SortField = 'orderDate' | 'archivedAt' | 'shippedAt' | 'createdAt';
/**
 * Query parameters
 */
export interface OrdersListParams {
    view: ViewName;
    page: number;
    limit: number;
    shippedFilter?: ShippedFilter;
    search?: string;
    days?: number;
    sortBy?: SortField;
}
export declare function listOrdersKysely(params: OrdersListParams): Promise<{
    orders: {
        totalLines: number;
        fulfillmentStage: string;
        customerId: string | null;
        channel: string;
        orderNumber: string;
        isExchange: boolean;
        customerName: string;
        customerEmail: string | null;
        customerPhone: string | null;
        shippingAddress: string | null;
        paymentMethod: string | null;
        totalAmount: number;
        internalNotes: string | null;
        isOnHold: boolean;
        isArchived: boolean;
        releasedToShipped: boolean;
        releasedToCancelled: boolean;
        customerNotes: string | null;
        discountCodes: string | null;
        orderId: string;
        orderDate: string;
        shipByDate: string;
        orderStatus: string;
        orderAwbNumber: string | null;
        orderCourier: string | null;
        orderShippedAt: string;
        orderTrackingStatus: string | null;
        codRemittedAt: string;
        archivedAt: string;
        customerTags: string | null;
        customerOrderCount: number;
        customerLtv: number;
        customerTier: string | null;
        customerRtoCount: number;
        shopifyTags: string | null;
        shopifyAwb: string | null;
        shopifyCourier: string | null;
        shopifyTrackingUrl: string | null;
        shopifyStatus: string | null;
        daysInTransit: number;
        daysSinceDelivery: number;
        daysInRto: number;
        rtoStatus: string;
        orderLines: string;
    }[];
    totalCount: number;
}>;
/**
 * Inferred result type from the query
 * Use this for type-safe access to query results
 */
export type OrdersListResult = Awaited<ReturnType<typeof listOrdersKysely>>;
export type OrderRow = OrdersListResult['orders'][number];
/**
 * Transform Kysely query results to FlattenedOrderRow format
 * Matches the structure expected by the frontend AG-Grid
 */
export declare function transformKyselyToRows(orders: OrderRow[]): {
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
    isOnHold: boolean;
    orderAwbNumber: string | null;
    orderCourier: string | null;
    orderShippedAt: string | null;
    orderTrackingStatus: string | null;
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
    skuStock: number;
    fabricBalance: number;
    shopifyStatus: string;
    productionBatch: {
        id: string;
        batchCode: string;
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
    discountCodes: string | null;
    customerNotes: string | null;
    shopifyTags: string | null;
    shopifyAwb: string | null;
    shopifyCourier: string | null;
    shopifyTrackingUrl: string | null;
    customerTags: string[] | null;
}[];
//# sourceMappingURL=ordersListKysely.d.ts.map