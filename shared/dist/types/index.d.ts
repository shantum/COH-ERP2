/**
 * Shared TypeScript types for COH ERP
 *
 * These domain types are shared between server and client.
 * UI-specific types remain in client/src/types/index.ts
 */
export interface Role {
    id: string;
    name: string;
    displayName: string;
    description: string | null;
    permissions: string[];
    isBuiltIn: boolean;
    createdAt: string;
    updatedAt: string;
    _count?: {
        users: number;
    };
}
export interface User {
    id: string;
    email: string;
    name: string;
    role: string;
    roleId: string | null;
    isActive: boolean;
    createdAt: string;
    updatedAt?: string;
    userRole?: {
        id: string;
        name: string;
        displayName: string;
    } | null;
    roleName?: string;
    permissions?: string[];
    lastLoginAt?: string | null;
}
export interface CreateUserData {
    email: string;
    password: string;
    name: string;
    roleId?: string;
}
export interface UpdateUserData {
    email?: string;
    name?: string;
    isActive?: boolean;
    password?: string;
}
export interface Product {
    id: string;
    name: string;
    styleCode: string | null;
    category: string;
    productType: string;
    gender: string;
    fabricTypeId: string | null;
    baseProductionTimeMins: number;
    defaultFabricConsumption: number | null;
    imageUrl: string | null;
    isActive: boolean;
    createdAt: string;
    updatedAt: string;
    fabricType?: FabricType;
    variations?: Variation[];
}
export interface Variation {
    id: string;
    productId: string;
    colorName: string;
    standardColor: string | null;
    colorHex: string | null;
    fabricId: string;
    imageUrl: string | null;
    hasLining: boolean;
    isActive: boolean;
    product?: Product;
    fabric?: Fabric;
    skus?: Sku[];
}
export interface Sku {
    id: string;
    skuCode: string;
    variationId: string;
    size: string;
    fabricConsumption: number;
    mrp: number;
    targetStockQty: number;
    targetStockMethod: string;
    isActive: boolean;
    shopifyInventoryItemId: string | null;
    shopifyVariantId: string | null;
    variation?: Variation;
    skuCosting?: SkuCosting;
    isCustomSku?: boolean;
    parentSkuId?: string;
    customizationType?: string;
    customizationValue?: string;
    customizationNotes?: string;
}
export interface SkuCosting {
    skuId: string;
    fabricCost: number;
    laborTimeMins: number;
    laborRatePerMin: number;
    laborCost: number;
    packagingCost: number;
    otherCost: number;
    totalCogs: number;
    lastUpdated: string;
}
export interface FabricType {
    id: string;
    name: string;
    composition: string | null;
    unit: string;
    avgShrinkagePct: number;
}
export interface Fabric {
    id: string;
    fabricTypeId: string;
    name: string;
    colorName: string;
    standardColor: string | null;
    colorHex: string | null;
    costPerUnit: number;
    supplierId: string | null;
    leadTimeDays: number;
    minOrderQty: number;
    isActive: boolean;
    fabricType?: FabricType;
    supplier?: Supplier;
}
export interface Supplier {
    id: string;
    name: string;
    contactName: string | null;
    email: string | null;
    phone: string | null;
    address: string | null;
    isActive: boolean;
    createdAt: string;
}
export interface Customer {
    id: string;
    shopifyCustomerId: string | null;
    email: string;
    phone: string | null;
    firstName: string | null;
    lastName: string | null;
    defaultAddress: string | null;
    tags: string | null;
    acceptsMarketing: boolean;
    firstOrderDate: string | null;
    lastOrderDate: string | null;
    createdAt: string;
    updatedAt: string;
}
export type OrderStatus = 'open' | 'shipped' | 'delivered' | 'cancelled' | 'returned';
export type LineStatus = 'pending' | 'allocated' | 'picked' | 'packed' | 'shipped' | 'cancelled';
export type FulfillmentStage = 'pending' | 'allocated' | 'in_progress' | 'ready_to_ship';
/**
 * Shopify order cache - immutable snapshot of order data from Shopify API.
 * Populated during sync, never modified locally. Used to avoid stale field references.
 */
export interface ShopifyOrderCache {
    discountCodes: string | null;
    customerNotes: string | null;
    paymentMethod: string | null;
    tags: string | null;
    trackingNumber: string | null;
    trackingCompany: string | null;
    trackingUrl: string | null;
    shippedAt: string | null;
    totalPrice: number | null;
    subtotalPrice: number | null;
    totalTax: number | null;
    totalDiscounts: number | null;
}
export interface Order {
    id: string;
    orderNumber: string;
    shopifyOrderId: string | null;
    channel: string;
    customerId: string | null;
    customerName: string;
    customerEmail: string | null;
    customerPhone: string | null;
    shippingAddress: string | null;
    orderDate: string;
    shipByDate: string | null;
    customerNotes: string | null;
    internalNotes: string | null;
    status: OrderStatus;
    isArchived: boolean;
    archivedAt: string | null;
    awbNumber: string | null;
    courier: string | null;
    shippedAt: string | null;
    deliveredAt: string | null;
    rtoInitiatedAt: string | null;
    rtoReceivedAt: string | null;
    totalAmount: number;
    discountCode: string | null;
    createdAt: string;
    syncedAt: string | null;
    shopifyFulfillmentStatus: string | null;
    isExchange: boolean;
    originalOrderId: string | null;
    originalOrder?: Order;
    exchangeOrders?: Order[];
    partiallyCancelled: boolean;
    customer?: Customer;
    orderLines?: OrderLine[];
    shopifyCache?: ShopifyOrderCache | null;
    fulfillmentStage?: FulfillmentStage;
    totalLines?: number;
    pendingLines?: number;
    allocatedLines?: number;
    pickedLines?: number;
    packedLines?: number;
}
export interface OrderLine {
    id: string;
    orderId: string;
    shopifyLineId: string | null;
    skuId: string;
    qty: number;
    unitPrice: number;
    lineStatus: LineStatus;
    allocatedAt: string | null;
    pickedAt: string | null;
    packedAt: string | null;
    shippedAt: string | null;
    inventoryTxnId: string | null;
    productionBatchId: string | null;
    notes: string | null;
    rtoCondition: string | null;
    rtoInwardedAt: string | null;
    rtoInwardedById: string | null;
    rtoNotes: string | null;
    isCustomized?: boolean;
    isNonReturnable?: boolean;
    originalSkuId?: string;
    customizedAt?: string;
    sku?: Sku;
    productionBatch?: ProductionBatch;
}
export type TxnType = 'inward' | 'outward' | 'reserved';
export interface InventoryTransaction {
    id: string;
    skuId: string;
    txnType: TxnType;
    qty: number;
    reason: string;
    referenceId: string | null;
    notes: string | null;
    warehouseLocation: string | null;
    createdById: string;
    createdAt: string;
}
/**
 * Inventory balance calculation: currentBalance = SUM(inward) - SUM(outward)
 * availableBalance = currentBalance - SUM(reserved for pending orders)
 */
export interface InventoryBalance {
    skuId: string;
    totalInward: number;
    totalOutward: number;
    totalReserved: number;
    currentBalance: number;
    availableBalance: number;
    sku?: Sku;
}
export type BatchStatus = 'planned' | 'in_progress' | 'completed' | 'cancelled';
export interface Tailor {
    id: string;
    name: string;
    specializations: string | null;
    dailyCapacityMins: number;
    isActive: boolean;
    createdAt: string;
}
export interface ProductionBatch {
    id: string;
    batchCode: string | null;
    batchDate: string;
    tailorId: string | null;
    skuId: string;
    qtyPlanned: number;
    qtyCompleted: number;
    priority: string;
    sourceOrderLineId: string | null;
    status: BatchStatus;
    notes: string | null;
    createdAt: string;
    completedAt: string | null;
    tailor?: Tailor;
    sku?: Sku;
}
export type ReturnStatus = 'requested' | 'reverse_initiated' | 'in_transit' | 'received' | 'inspected' | 'resolved' | 'cancelled';
export interface ReturnRequest {
    id: string;
    requestNumber: string;
    requestType: 'return' | 'exchange';
    originalOrderId: string;
    customerId: string | null;
    status: ReturnStatus;
    reasonCategory: string;
    reasonDetails: string | null;
    resolutionType: string | null;
    resolutionNotes: string | null;
    createdAt: string;
    updatedAt: string;
    originalOrder?: Order;
    customer?: Customer;
    lines?: ReturnRequestLine[];
}
export interface ReturnRequestLine {
    id: string;
    requestId: string;
    originalOrderLineId: string | null;
    skuId: string;
    qty: number;
    exchangeSkuId: string | null;
    exchangeQty: number | null;
    itemCondition: string | null;
    inspectionNotes: string | null;
    sku?: Sku;
    exchangeSku?: Sku;
}
export interface SyncJob {
    id: string;
    jobType: 'orders' | 'customers' | 'products';
    status: 'pending' | 'running' | 'completed' | 'failed' | 'cancelled';
    dateFilter: string | null;
    daysBack: number | null;
    totalRecords: number | null;
    processed: number;
    created: number;
    updated: number;
    skipped: number;
    errors: number;
    lastProcessedId: string | null;
    currentBatch: number;
    errorLog: string | null;
    lastError: string | null;
    startedAt: string | null;
    completedAt: string | null;
    createdAt: string;
    updatedAt: string;
}
export interface ApiError {
    error: string;
    details?: string;
}
export interface PaginatedResponse<T> {
    data: T[];
    total: number;
    page: number;
    limit: number;
}
export interface CreateOrderData {
    orderNumber?: string;
    channel?: string;
    isExchange?: boolean;
    originalOrderId?: string;
    customerName: string;
    customerEmail?: string;
    customerPhone?: string;
    shippingAddress?: string;
    shipByDate?: string;
    customerNotes?: string;
    internalNotes?: string;
    totalAmount: number;
    lines: CreateOrderLineData[];
}
export interface CreateOrderLineData {
    skuId: string;
    qty: number;
    unitPrice: number;
}
export interface UpdateOrderData {
    customerName?: string;
    customerEmail?: string;
    customerPhone?: string;
    shippingAddress?: string;
    internalNotes?: string;
    shipByDate?: string | null;
}
export interface ShipOrderData {
    awbNumber: string;
    courier: string;
}
export interface ShipLinesData {
    lineIds: string[];
    awbNumber: string;
    courier: string;
}
export interface CreateProductData {
    name: string;
    styleCode?: string | null;
    category: string;
    productType: string;
    gender: string;
    fabricTypeId?: string | null;
    baseProductionTimeMins?: number;
    defaultFabricConsumption?: number | null;
    imageUrl?: string | null;
}
export interface UpdateProductData extends Partial<CreateProductData> {
    isActive?: boolean;
    trimsCost?: number | null;
    packagingCost?: number | null;
}
export interface CreateVariationData {
    colorName: string;
    standardColor?: string | null;
    colorHex?: string | null;
    fabricId: string;
    imageUrl?: string | null;
    hasLining?: boolean;
}
export interface UpdateVariationData extends Partial<CreateVariationData> {
    isActive?: boolean;
    trimsCost?: number | null;
    packagingCost?: number | null;
}
export interface CreateSkuData {
    size: string;
    skuCode?: string;
    fabricConsumption?: number;
    mrp?: number;
    targetStockQty?: number;
    barcode?: string | null;
}
export interface UpdateSkuData extends Partial<CreateSkuData> {
    isActive?: boolean;
    trimsCost?: number | null;
    packagingCost?: number | null;
}
export interface CreateFabricData {
    fabricTypeId: string;
    name: string;
    colorName: string;
    standardColor?: string;
    colorHex?: string;
    costPerUnit: number;
    supplierId?: string;
    leadTimeDays?: number;
    minOrderQty?: number;
}
export interface CreateFabricTypeData {
    name: string;
    composition?: string;
    unit: string;
    avgShrinkagePct?: number;
}
export interface CreateSupplierData {
    name: string;
    contactName?: string;
    email?: string;
    phone?: string;
    address?: string;
}
export interface CreateFabricTransactionData {
    txnType: 'inward' | 'outward';
    qty: number;
    unit: string;
    reason: string;
    referenceId?: string;
    notes?: string;
    costPerUnit?: number;
    supplierId?: string;
}
export interface CreateInventoryInwardData {
    skuId: string;
    qty: number;
    reason: string;
    referenceId?: string;
    notes?: string;
    warehouseLocation?: string;
}
export interface CreateInventoryOutwardData {
    skuId: string;
    qty: number;
    reason: string;
    referenceId?: string;
    notes?: string;
    warehouseLocation?: string;
}
export interface QuickInwardData {
    skuCode: string;
    qty: number;
    reason?: string;
    notes?: string;
}
export interface CreateCustomerData {
    email: string;
    firstName?: string;
    lastName?: string;
    phone?: string;
    defaultAddress?: string;
}
export interface CreateReturnData {
    originalOrderId: string;
    requestType: 'return' | 'exchange';
    reasonCategory: string;
    reasonDetails?: string;
    lines: CreateReturnLineData[];
}
export interface CreateReturnLineData {
    originalOrderLineId?: string;
    skuId: string;
    qty: number;
    exchangeSkuId?: string;
    exchangeQty?: number;
}
export interface InitiateReverseData {
    carrier?: string;
    trackingNumber?: string;
}
export interface ResolveReturnData {
    resolutionType: 'refund' | 'exchange' | 'store_credit' | 'rejected';
    resolutionNotes?: string;
}
export interface CreateTailorData {
    name: string;
    specializations?: string;
    dailyCapacityMins?: number;
}
export interface CreateBatchData {
    batchDate: string;
    tailorId?: string;
    skuId?: string;
    sampleName?: string;
    sampleColour?: string;
    sampleSize?: string;
    qtyPlanned: number;
    priority?: string;
    sourceOrderLineId?: string;
    notes?: string;
}
export interface UpdateBatchData {
    batchDate?: string;
    tailorId?: string;
    qtyPlanned?: number;
    priority?: string;
    notes?: string;
}
export interface CompleteBatchData {
    qtyCompleted: number;
}
export interface AddOrderLineData {
    skuId: string;
    qty: number;
    unitPrice: number;
}
export interface UpdateOrderLineData {
    qty?: number;
    unitPrice?: number;
    notes?: string;
    awbNumber?: string;
    courier?: string;
}
export interface ShippedSummary {
    inTransit: number;
    delivered: number;
    delayed: number;
    rto: number;
    needsAttention: number;
    total: number;
}
export interface ArchivedAnalytics {
    orderCount: number;
    totalRevenue: number;
    avgValue: number;
    channelSplit: Array<{
        channel: string;
        count: number;
        percentage: number;
    }>;
    topProducts: Array<{
        name: string;
        units: number;
        revenue: number;
    }>;
}
export type TrackingStatus = 'in_transit' | 'delivered' | 'delivery_delayed' | 'rto_initiated' | 'rto_received';
export interface RtoSummary {
    pendingReceipt: number;
    received: number;
    total: number;
    transitBreakdown: {
        within7Days: number;
        within14Days: number;
        over14Days: number;
    };
    avgDaysInTransit: number;
    paymentBreakdown: {
        prepaid: number;
        cod: number;
    };
    totalValue: number;
    prepaidValue: number;
    codValue: number;
    needsAttention: number;
}
export interface PendingSources {
    counts: {
        production: number;
        returns: number;
        rto: number;
        rtoUrgent: number;
        rtoWarning: number;
        repacking: number;
    };
    items?: {
        production: PendingProductionItem[];
        returns: PendingReturnItem[];
        rto: PendingRtoItem[];
        repacking: PendingRepackingItem[];
    };
}
export interface PendingProductionItem {
    batchId: string;
    batchCode: string;
    skuId: string;
    skuCode: string;
    productName: string;
    colorName: string;
    size: string;
    qtyPlanned: number;
    qtyCompleted: number;
    qtyPending: number;
    batchDate: string;
}
export interface PendingReturnItem {
    requestId: string;
    requestNumber: string;
    lineId: string;
    skuId: string;
    skuCode: string;
    productName: string;
    colorName: string;
    size: string;
    qty: number;
    customerName: string;
    reasonCategory: string;
}
export interface PendingRtoItem {
    lineId: string;
    orderId: string;
    orderNumber: string;
    skuId: string;
    skuCode: string;
    productName: string;
    colorName: string;
    size: string;
    qty: number;
    customerName: string;
    trackingStatus: string;
    atWarehouse: boolean;
    rtoInitiatedAt: string | null;
    daysInRto?: number;
    urgency?: 'urgent' | 'warning' | 'normal';
}
export interface PendingRepackingItem {
    queueId: string;
    skuId: string;
    skuCode: string;
    productName: string;
    colorName: string;
    size: string;
    qty: number;
    condition: string;
    returnRequestNumber: string | null;
}
export interface ScanLookupResult {
    sku: {
        id: string;
        skuCode: string;
        barcode: string | null;
        productName: string;
        colorName: string;
        size: string;
        mrp: number;
        imageUrl: string | null;
    };
    currentBalance: number;
    availableBalance: number;
    matches: ScanMatch[];
    recommendedSource: 'production' | 'return' | 'rto' | 'repacking' | 'adjustment';
}
export interface ScanMatch {
    source: string;
    priority: number;
    data: PendingProductionItem | PendingReturnItem | RtoScanMatchData | PendingRepackingItem;
}
export interface RtoScanMatchData {
    lineId: string;
    orderId: string;
    orderNumber: string;
    customerName: string;
    trackingStatus: string;
    atWarehouse: boolean;
    rtoInitiatedAt: string | null;
    qty: number;
    orderLines: Array<{
        lineId: string;
        skuCode: string;
        qty: number;
        rtoCondition: string | null;
        isCurrentLine: boolean;
    }>;
}
export interface RecentInward {
    id: string;
    skuId?: string;
    skuCode: string;
    productName: string;
    colorName: string;
    size: string;
    qty: number;
    reason: string;
    source: string;
    notes: string | null;
    createdAt: string;
    createdBy?: string;
    isAllocated?: boolean;
}
export interface AllocationMatch {
    type: 'production' | 'rto';
    id: string;
    label: string;
    detail: string;
    date?: string;
    pending?: number;
    orderId?: string;
    atWarehouse?: boolean;
}
export type RtoCondition = 'unopened' | 'good' | 'damaged' | 'wrong_product';
export interface QueuePanelItem {
    id: string;
    skuId: string;
    skuCode: string;
    productName: string;
    colorName: string;
    size: string;
    qty: number;
    imageUrl?: string;
    contextLabel: string;
    contextValue: string;
    atWarehouse?: boolean;
    daysInRto?: number;
    customerName?: string;
    orderNumber?: string;
    requestNumber?: string;
    queueItemId?: string;
    condition?: string;
    inspectionNotes?: string;
    returnRequestNumber?: string;
    orderLineId?: string;
    rtoOrderNumber?: string;
    lineId?: string;
    orderId?: string;
    batchId?: string;
}
export interface RtoInwardLineRequest {
    lineId: string;
    condition: RtoCondition;
    notes?: string;
}
export interface RtoInwardLineResponse {
    success: boolean;
    message: string;
    line: {
        lineId: string;
        orderId: string;
        orderNumber: string;
        skuCode: string;
        productName: string;
        colorName: string;
        size: string;
        qty: number;
        condition: RtoCondition;
        notes: string | null;
    };
    inventoryAdded: boolean;
    newBalance: number;
    progress: {
        totalLines: number;
        processedLines: number;
        allComplete: boolean;
    };
}
export interface PendingQueueResponse {
    source: string;
    items: QueuePanelItem[];
    total: number;
}
export type SalesDimension = 'summary' | 'product' | 'category' | 'gender' | 'color' | 'standardColor' | 'fabricType' | 'fabricColor' | 'channel';
export type OrderStatusFilter = 'all' | 'shipped' | 'delivered';
export interface SalesMetricSummary {
    totalRevenue: number;
    totalUnits: number;
    totalOrders: number;
    avgOrderValue: number;
}
export interface SalesBreakdownItem {
    key: string;
    keyId?: string;
    revenue: number;
    units: number;
    orders: number;
    percentOfTotal: number;
}
export interface SalesTimeSeriesPoint {
    date: string;
    revenue: number;
    units: number;
    orders: number;
}
export interface SalesAnalyticsResponse {
    summary: SalesMetricSummary;
    timeSeries?: SalesTimeSeriesPoint[];
    breakdown?: SalesBreakdownItem[];
    period: {
        startDate: string;
        endDate: string;
    };
}
//# sourceMappingURL=index.d.ts.map