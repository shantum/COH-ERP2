/**
 * Business Graph Types
 *
 * Entity context and business pulse interfaces for the read-only
 * business graph layer. No new tables — pure derived data from
 * existing models.
 */

// ============================================
// ORDER CONTEXT
// ============================================

export interface OrderContextLine {
  id: string;
  skuCode: string;
  skuId: string;
  size: string;
  qty: number;
  unitPrice: number;
  lineStatus: string | null;
  productName: string;
  colorName: string;
  imageUrl: string | null;
  bomCost: number | null;
  margin: number | null;
  // Shipping
  awbNumber: string | null;
  courier: string | null;
  trackingStatus: string | null;
  shippedAt: string | null;
  deliveredAt: string | null;
  // Returns
  returnStatus: string | null;
  returnQty: number | null;
  returnReasonCategory: string | null;
  returnResolution: string | null;
}

export interface OrderContextPayment {
  id: string;
  amount: number;
  paymentMethod: string | null;
  reference: string | null;
  recordedAt: string;
}

export interface OrderContextCustomer {
  id: string;
  name: string;
  email: string;
  phone: string | null;
  tier: string;
  orderCount: number;
  ltv: number;
  returnCount: number;
  rtoCount: number;
}

export interface OrderContext {
  id: string;
  orderNumber: string;
  orderDate: string;
  channel: string;
  status: string;
  totalAmount: number;
  paymentMethod: string | null;
  paymentStatus: string | null;
  isExchange: boolean;
  shippingAddress: string | null;
  internalNotes: string | null;
  customer: OrderContextCustomer | null;
  lines: OrderContextLine[];
  payments: OrderContextPayment[];
  // Computed
  totalUnits: number;
  totalBomCost: number | null;
  avgMargin: number | null;
  hasReturns: boolean;
  fulfillmentStage: string;
}

// ============================================
// PRODUCT CONTEXT
// ============================================

export interface ProductContextSku {
  id: string;
  skuCode: string;
  size: string;
  mrp: number;
  currentBalance: number;
  targetStockQty: number;
  bomCost: number | null;
  isActive: boolean;
}

export interface ProductContextVariation {
  id: string;
  colorName: string;
  colorHex: string | null;
  imageUrl: string | null;
  skus: ProductContextSku[];
  totalStock: number;
}

export interface ProductContextSalesVelocity {
  last7Days: { units: number; revenue: number };
  last30Days: { units: number; revenue: number };
}

export interface ProductContext {
  id: string;
  name: string;
  imageUrl: string | null;
  isActive: boolean;
  variations: ProductContextVariation[];
  // Aggregated
  totalSkus: number;
  totalStock: number;
  lowStockSkus: number;
  avgBomCost: number | null;
  salesVelocity: ProductContextSalesVelocity;
  returnRate30d: number | null;
}

// ============================================
// CUSTOMER CONTEXT
// ============================================

export interface CustomerContextOrderSummary {
  totalOrders: number;
  totalSpent: number;
  avgOrderValue: number;
  firstOrderDate: string | null;
  lastOrderDate: string | null;
  ordersByStatus: Record<string, number>;
}

export interface CustomerContext {
  id: string;
  email: string;
  firstName: string | null;
  lastName: string | null;
  phone: string | null;
  tier: string;
  ltv: number;
  orderCount: number;
  returnCount: number;
  exchangeCount: number;
  rtoCount: number;
  rtoValue: number;
  acceptsMarketing: boolean;
  createdAt: string;
  orders: CustomerContextOrderSummary;
  returnRate: number | null;
}

// ============================================
// BUSINESS PULSE
// ============================================

export interface PulseRevenue {
  today: number;
  last7Days: number;
  last30Days: number;
  mtd: number;
  todayOrderCount: number;
  last30DaysOrderCount: number;
  newVsReturning: { newCustomers: number; returningCustomers: number };
}

export interface PulseOrderPipeline {
  totalOrders: number;
  pendingLines: number;
  allocatedLines: number;
  pickedLines: number;
  packedLines: number;
  totalUnits: number;
}

export interface PulseInventory {
  totalSkus: number;
  totalUnits: number;
  lowStockSkuCount: number;
}

export interface PulseProduction {
  openBatches: number;
  unitsPlanned: number;
  unitsCompleted: number;
}

export interface PulseCash {
  hdfcBalance: number | null;
  razorpayxBalance: number | null;
}

export interface PulsePayables {
  outstandingCount: number;
  outstandingAmount: number;
}

export interface PulseReceivables {
  outstandingCount: number;
  outstandingAmount: number;
}

export interface PulseFulfillment {
  avgDaysToShip30d: number | null;
}

export interface PulseMaterialHealth {
  lowStockFabricColours: number;
}

export interface PulseTopProduct {
  id: string;
  name: string;
  imageUrl: string | null;
  units: number;
  revenue: number;
}

export interface BusinessPulse {
  generatedAt: string;
  revenue: PulseRevenue;
  orderPipeline: PulseOrderPipeline;
  inventory: PulseInventory;
  production: PulseProduction;
  cash: PulseCash;
  payables: PulsePayables;
  receivables: PulseReceivables;
  returnRate30d: number | null;
  fulfillment: PulseFulfillment;
  materialHealth: PulseMaterialHealth;
  topProducts7d: PulseTopProduct[];
}
