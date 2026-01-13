/**
 * Shared TypeScript types for COH ERP
 *
 * These domain types are shared between server and client.
 * UI-specific types remain in client/src/types/index.ts
 */

// ============================================
// USERS & PERMISSIONS
// ============================================

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

// ============================================
// PRODUCTS
// ============================================

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
  // Custom SKU fields
  isCustomSku?: boolean; // True only for SKU created via order customization (not regular catalog SKUs)
  parentSkuId?: string; // Points to original catalog SKU if this is a custom SKU
  customizationType?: string; // 'length'|'size'|'measurements'|'other' - only populated for custom SKUs
  customizationValue?: string; // User-specified value (e.g., "32 inches" for length adjustment)
  customizationNotes?: string; // Additional notes about customization
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

// ============================================
// FABRICS
// ============================================

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

// ============================================
// CUSTOMERS
// ============================================

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

// ============================================
// ORDERS
// ============================================

export type OrderStatus = 'open' | 'shipped' | 'delivered' | 'cancelled' | 'returned';
export type LineStatus = 'pending' | 'allocated' | 'picked' | 'packed' | 'shipped' | 'cancelled';
export type FulfillmentStage = 'pending' | 'allocated' | 'in_progress' | 'ready_to_ship';

/**
 * Shopify order cache - immutable snapshot of order data from Shopify API.
 * Populated during sync, never modified locally. Used to avoid stale field references.
 */
export interface ShopifyOrderCache {
  discountCodes: string | null; // Comma-separated list of discount codes applied
  customerNotes: string | null; // Customer's special instructions at checkout
  paymentMethod: string | null; // "COD"|"Prepaid"|etc. - determines fulfillment flow
  tags: string | null; // Shopify order tags (e.g., "wholesale", "repeat_customer")
  trackingNumber: string | null; // Shopify's tracked tracking number from fulfillment
  trackingCompany: string | null; // Courier name from Shopify fulfillment
  shippedAt: string | null; // When Shopify marked as fulfilled
  // Generated columns (auto-extracted from rawData by PostgreSQL)
  totalPrice: number | null; // Order total from rawData.total_price
  subtotalPrice: number | null; // Subtotal from rawData.subtotal_price
  totalTax: number | null; // Tax from rawData.total_tax
  totalDiscounts: number | null; // Discounts from rawData.total_discounts
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
  // Exchange order tracking
  isExchange: boolean; // Order created to replace another (paired via originalOrderId)
  originalOrderId: string | null; // References order being exchanged (if isExchange=true)
  originalOrder?: Order;
  exchangeOrders?: Order[]; // All exchanges created for this order
  // Partial cancellation tracking
  partiallyCancelled: boolean; // One or more lines cancelled but order not fully cancelled
  customer?: Customer;
  orderLines?: OrderLine[];
  // Shopify cache data (single source of truth)
  shopifyCache?: ShopifyOrderCache | null; // Immutable snapshot of Shopify order data, updated on sync
  // Enriched fields
  fulfillmentStage?: FulfillmentStage;
  totalLines?: number; // Active (non-cancelled) line count
  pendingLines?: number; // Lines in pending status
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
  // RTO Inward fields
  rtoCondition: string | null; // 'unopened'|'good'|'damaged'|'wrong_product' - only set on inward
  rtoInwardedAt: string | null; // Timestamp when RTO was processed inward
  rtoInwardedById: string | null; // User who processed the RTO inward
  rtoNotes: string | null; // Comments during RTO inward (damage notes, etc.)
  // Customization fields
  isCustomized?: boolean; // Line has custom SKU (size/measurements/other modification)
  isNonReturnable?: boolean; // Cannot be returned after order shipped
  originalSkuId?: string; // Reference to base SKU before customization applied
  customizedAt?: string; // Timestamp when customization created
  sku?: Sku;
  productionBatch?: ProductionBatch;
}

// ============================================
// INVENTORY
// ============================================

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
  totalInward: number; // Cumulative inward transactions
  totalOutward: number; // Cumulative outward transactions (orders, damages, etc.)
  totalReserved: number; // Quantity reserved for orders in pending/allocated/picked states
  currentBalance: number; // SUM(inward) - SUM(outward): physical inventory
  availableBalance: number; // currentBalance - reserved: can allocate to new orders
  sku?: Sku;
}

// ============================================
// PRODUCTION
// ============================================

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

// ============================================
// RETURNS
// ============================================

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

// ============================================
// SHOPIFY
// ============================================

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

// ============================================
// API RESPONSE TYPES
// ============================================

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

// ============================================
// FORM TYPES (API Input)
// ============================================

export interface CreateOrderData {
  orderNumber?: string;
  channel?: string;
  // Exchange order fields
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

// Products
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

// Fabrics
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

// Inventory
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

// Customers
export interface CreateCustomerData {
  email: string;
  firstName?: string;
  lastName?: string;
  phone?: string;
  defaultAddress?: string;
}

// Returns
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

// Production
export interface CreateTailorData {
  name: string;
  specializations?: string;
  dailyCapacityMins?: number;
}

export interface CreateBatchData {
  batchDate: string;
  tailorId?: string;
  skuId: string;
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

// Order Line
export interface AddOrderLineData {
  skuId: string;
  qty: number;
  unitPrice: number;
}

export interface UpdateOrderLineData {
  qty?: number;
  unitPrice?: number;
  notes?: string;
}

// Shipped Orders Summary
export interface ShippedSummary {
  inTransit: number;
  delivered: number;
  delayed: number;
  rto: number;
  needsAttention: number;
  total: number;
}

// Archived Orders Analytics
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

// Tracking status for shipped orders
export type TrackingStatus = 'in_transit' | 'delivered' | 'delivery_delayed' | 'rto_initiated' | 'rto_received';

// RTO Summary Analytics
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

// ============================================
// INWARD HUB
// ============================================

export interface PendingSources {
  counts: {
    production: number;
    returns: number;
    rto: number;
    rtoUrgent: number;   // Items >14 days - for red badge
    rtoWarning: number;  // Items 7-14 days - for orange badge
    repacking: number;
  };
  // Items now loaded separately via /pending-queue/:source for performance
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

// Enhanced RTO scan match data with order lines for progress display
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
  isAllocated?: boolean; // false for 'received' reason (can be allocated to source)
}

// Allocation match for transaction
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

// ============================================
// RTO CONDITIONS
// ============================================

export type RtoCondition = 'unopened' | 'good' | 'damaged' | 'wrong_product';

// ============================================
// QUEUE PANEL
// ============================================

// Queue Panel Item (generic for all sources)
export interface QueuePanelItem {
  id: string;
  skuId: string;
  skuCode: string;
  productName: string;
  colorName: string;
  size: string;
  qty: number;
  imageUrl?: string;
  // Source-specific context
  contextLabel: string;  // "Batch", "Ticket", "Order"
  contextValue: string;  // "PB-2025-001", "RET-2025-042", "#63735"
  // RTO-specific
  atWarehouse?: boolean;
  daysInRto?: number;
  customerName?: string;
  orderNumber?: string;
  // Returns-specific
  requestNumber?: string;
  // Repacking-specific
  queueItemId?: string;
  condition?: string;
  inspectionNotes?: string;
  returnRequestNumber?: string;
  orderLineId?: string;
  rtoOrderNumber?: string;
  // For click-to-process
  lineId?: string;
  orderId?: string;
  batchId?: string;
}

// RTO Inward Request/Response
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

// Pending Queue Response
export interface PendingQueueResponse {
  source: string;
  items: QueuePanelItem[];
  total: number;
}

// ============================================
// SALES ANALYTICS
// ============================================

export type SalesDimension =
  | 'summary'
  | 'product'
  | 'category'
  | 'gender'
  | 'color'
  | 'standardColor'
  | 'fabricType'
  | 'fabricColor'
  | 'channel';

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
