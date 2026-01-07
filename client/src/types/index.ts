// Core entity types for COH-ERP2

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

// Shopify order cache - single source of truth for Shopify data
export interface ShopifyOrderCache {
  discountCodes: string | null;
  customerNotes: string | null;
  paymentMethod: string | null;
  tags: string | null;
  trackingNumber: string | null;
  trackingCompany: string | null;
  shippedAt: string | null;
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
  customer?: Customer;
  orderLines?: OrderLine[];
  // Shopify cache data (single source of truth)
  shopifyCache?: ShopifyOrderCache | null;
  // Enriched fields
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

export interface InventoryBalance {
  skuId: string;
  totalInward: number;
  totalOutward: number;
  totalReserved: number;
  currentBalance: number;
  availableBalance: number;
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
// FORM TYPES
// ============================================

export interface CreateOrderData {
  orderNumber?: string;
  channel?: string;
  customerName: string;
  customerEmail?: string;
  customerPhone?: string;
  shippingAddress?: string;
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
}

export interface ShipOrderData {
  awbNumber: string;
  courier: string;
}

// ============================================
// UI HELPER TYPES
// ============================================

export interface OrderRowData {
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
  skuId: string;
  qty: number;
  lineId: string;
  lineStatus: LineStatus;
  skuStock: number;
  fabricBalance: number;
  shopifyStatus: string;
  productionBatch: ProductionBatch | null;
  productionBatchId: string | null;
  productionDate: string | null;
  isFirstLine: boolean;
  totalLines: number;
  fulfillmentStage: FulfillmentStage;
  order: Order;
}

export interface ShippingAddress {
  address1?: string;
  address2?: string;
  city?: string;
  province?: string;
  country?: string;
  zip?: string;
  phone?: string;
}

// ============================================
// API INPUT TYPES
// ============================================

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
  fabricId: string;
  imageUrl?: string | null;
}

export interface UpdateVariationData extends Partial<CreateVariationData> {
  isActive?: boolean;
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
