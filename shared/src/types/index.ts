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
  garmentGroup: string;
  productType: string;
  gender: string;
  googleProductCategoryId: number | null;
  attributes: Record<string, unknown> | null;
  baseProductionTimeMins: number;
  defaultFabricConsumption: number | null;
  imageUrl: string | null;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
  variations?: Variation[];
}

export interface Variation {
  id: string;
  productId: string;
  colorName: string;
  standardColor: string | null;
  colorHex: string | null;
  fabricId?: string | null; // Removed from schema — fabric assignment now via BOM (VariationBomLine)
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
  mrp: number;
  targetStockQty: number;
  targetStockMethod: string;
  isActive: boolean;
  shopifyInventoryItemId: string | null;
  shopifyVariantId: string | null;
  variation?: Variation;
  // Custom SKU fields
  isCustomSku?: boolean; // True only for SKU created via order customization (not regular catalog SKUs)
  parentSkuId?: string; // Points to original catalog SKU if this is a custom SKU
  customizationType?: string; // 'length'|'size'|'measurements'|'other' - only populated for custom SKUs
  customizationValue?: string; // User-specified value (e.g., "32 inches" for length adjustment)
  customizationNotes?: string; // Additional notes about customization
}

// ============================================
// FABRICS
// ============================================

export interface Fabric {
  id: string;
  materialId: string;
  name: string;
  colorName: string;
  standardColor: string | null;
  colorHex: string | null;
  costPerUnit: number | null;
  partyId: string | null;
  isActive: boolean;
  party?: Party;
}

export interface Party {
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

export type OrderStatus = 'open' | 'shipped' | 'partially_shipped' | 'delivered' | 'cancelled' | 'returned' | 'archived';
export type LineStatus = 'pending' | 'allocated' | 'picked' | 'packed' | 'shipped' | 'delivered' | 'cancelled';
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
  trackingUrl: string | null; // Shopify tracking URL for the shipment
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
  deliveredAt?: string | null; // Delivery tracking
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
  // Line-level return fields
  returnStatus?: string | null; // 'requested'|'pickup_scheduled'|'in_transit'|'received'|'complete'|'cancelled'
  returnQty?: number | null;
  returnRequestedAt?: string | null;
  returnReasonCategory?: string | null;
  returnReasonDetail?: string | null;
  returnResolution?: string | null; // 'refund'|'exchange'
  returnPickupType?: string | null; // 'arranged_by_us'|'customer_shipped'
  returnAwbNumber?: string | null;
  returnCourier?: string | null;
  returnPickupScheduledAt?: string | null;
  returnReceivedAt?: string | null;
  returnCondition?: string | null; // 'good'|'damaged'|'defective'|'wrong_item'|'used'
  returnConditionNotes?: string | null;
  returnQcResult?: string | null; // 'approved'|'written_off' — from repacking QC cascade
  returnPickupAt?: string | null; // When pickup actually occurred
  returnExchangeOrderId?: string | null;
  returnExchangeSkuId?: string | null; // SKU they're exchanging to
  returnExchangePriceDiff?: number | null; // Price difference for exchange
  returnRefundCompletedAt?: string | null; // When refund was completed
  returnNetAmount?: number | null; // Net refund amount
  returnRefundMethod?: string | null; // 'payment_link'|'bank_transfer'|'store_credit'
  returnNotes?: string | null; // Internal notes about the return
  sku?: Sku;
  productionBatch?: ProductionBatch;
}

// ============================================
// INVENTORY
// ============================================

export type TxnType = 'inward' | 'outward';

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
 * No reservation system — availableBalance equals currentBalance.
 */
export interface InventoryBalance {
  skuId: string;
  totalInward: number;
  totalOutward: number;
  currentBalance: number;
  availableBalance: number;
  hasDataIntegrityIssue?: boolean;
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
}

export interface CreateVariationData {
  colorName: string;
  standardColor?: string | null;
  colorHex?: string | null;
  fabricId?: string | null; // Optional — fabric assignment now via BOM
  imageUrl?: string | null;
  hasLining?: boolean;
}

export interface UpdateVariationData extends Partial<CreateVariationData> {
  isActive?: boolean;
}

export interface CreateSkuData {
  size: string;
  skuCode?: string;
  mrp?: number;
  targetStockQty?: number;
  barcode?: string | null;
}

export interface UpdateSkuData extends Partial<CreateSkuData> {
  isActive?: boolean;
}

export interface CreatePartyData {
  name: string;
  contactName?: string;
  email?: string;
  phone?: string;
  address?: string;
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

// Production
export interface CreateTailorData {
  name: string;
  specializations?: string;
  dailyCapacityMins?: number;
}

export interface CreateBatchData {
  batchDate: string;
  tailorId?: string;
  skuId?: string;        // Either skuId OR sampleName required
  sampleName?: string;   // Name for sample batch (new trial items)
  sampleColour?: string; // Colour for sample batch
  sampleSize?: string;   // Size for sample batch
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
  awbNumber?: string;
  courier?: string;
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
  | 'garmentGroup'
  | 'gender'
  | 'color'
  | 'standardColor'
  | 'material'
  | 'fabric'
  | 'fabricColour'
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
  label: string;
  keyId?: string;
  revenue: number;
  units: number;
  orders: number;
  percentOfTotal: number;
  children?: SalesBreakdownItem[];
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
