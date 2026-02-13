// Re-export all shared domain types
export type {
  // Users & Permissions
  Role,
  User,
  CreateUserData,
  UpdateUserData,

  // Products
  Product,
  Variation,
  Sku,
  CreateProductData,
  UpdateProductData,
  CreateVariationData,
  UpdateVariationData,
  CreateSkuData,
  UpdateSkuData,

  // Fabrics
  FabricType,
  Fabric,
  Party,
  CreateFabricData,
  CreateFabricTypeData,
  CreatePartyData,
  CreateFabricTransactionData,

  // Customers
  Customer,
  CreateCustomerData,

  // Orders
  OrderStatus,
  LineStatus,
  FulfillmentStage,
  ShopifyOrderCache,
  Order,
  OrderLine,
  CreateOrderData,
  CreateOrderLineData,
  UpdateOrderData,
  ShipOrderData,
  ShipLinesData,
  AddOrderLineData,
  UpdateOrderLineData,
  ShippedSummary,
  ArchivedAnalytics,
  TrackingStatus,
  RtoSummary,

  // Inventory
  TxnType,
  InventoryTransaction,
  InventoryBalance,
  CreateInventoryInwardData,
  CreateInventoryOutwardData,
  QuickInwardData,

  // Production
  BatchStatus,
  Tailor,
  ProductionBatch,
  CreateTailorData,
  CreateBatchData,
  UpdateBatchData,
  CompleteBatchData,

  // Returns
  ReturnStatus,
  ReturnRequest,
  ReturnRequestLine,
  CreateReturnData,
  CreateReturnLineData,
  InitiateReverseData,
  ResolveReturnData,

  // Shopify
  SyncJob,

  // API Response Types
  ApiError,
  PaginatedResponse,

  // Inward Hub
  PendingSources,
  PendingProductionItem,
  PendingReturnItem,
  PendingRtoItem,
  PendingRepackingItem,
  ScanLookupResult,
  ScanMatch,
  RtoScanMatchData,
  RecentInward,
  AllocationMatch,
  RtoCondition,
  QueuePanelItem,
  RtoInwardLineRequest,
  RtoInwardLineResponse,
  PendingQueueResponse,

  // Sales Analytics
  SalesDimension,
  OrderStatusFilter,
  SalesMetricSummary,
  SalesBreakdownItem,
  SalesTimeSeriesPoint,
  SalesAnalyticsResponse,
} from '@coh/shared';

// ============================================
// CLIENT-SPECIFIC UI TYPES
// ============================================

/**
 * These types are specific to the client UI and are not shared with the server.
 */

// ============================================
// AUTH TYPES
// ============================================

/**
 * User object for authentication context
 * Subset of full User type with auth-specific fields
 */
export interface AuthUser {
  id: string;
  email: string;
  name: string;
  role: string;
  roleId?: string;
  roleName?: string;
  permissions?: string[];
  extraAccess?: string[];  // Feature access beyond role
  mustChangePassword?: boolean;
}

/**
 * Authentication state for router context
 */
export interface AuthState {
  user: AuthUser | null;
  isAuthenticated: boolean;
  isLoading: boolean;
}

// Order grid row data - flattened structure for AG-Grid
export interface OrderRowData {
  orderId: string;
  orderNumber: string;
  orderDate: string;
  shipByDate: string | null;
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
  lineStatus: import('@coh/shared').LineStatus;
  skuStock: number;
  fabricBalance: number;
  shopifyStatus: string;
  productionBatch: import('@coh/shared').ProductionBatch | null;
  productionBatchId: string | null;
  productionDate: string | null;
  isFirstLine: boolean;
  totalLines: number;
  fulfillmentStage: import('@coh/shared').FulfillmentStage;
  order: import('@coh/shared').Order;
}

// Shipping address helper type for forms
export interface ShippingAddress {
  address1?: string;
  address2?: string;
  city?: string;
  province?: string;
  country?: string;
  zip?: string;
  phone?: string;
}
