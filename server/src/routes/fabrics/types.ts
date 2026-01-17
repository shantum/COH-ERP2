/**
 * @fileoverview Type definitions for fabric routes
 */

// ============================================
// TYPE DEFINITIONS
// ============================================

/**
 * Fabric balance data from calculateFabricBalance
 */
export interface FabricBalance {
    currentBalance: number;
    totalInward: number;
    totalOutward: number;
}

/**
 * Fabric type from Prisma
 */
export interface FabricType {
    id: string;
    name: string;
    composition: string | null;
    unit: string;
    avgShrinkagePct: number | null;
    defaultCostPerUnit: number | null;
    defaultLeadTimeDays: number | null;
    defaultMinOrderQty: number | null;
}

/**
 * Supplier from Prisma
 */
export interface Supplier {
    id: string;
    name: string;
}

/**
 * Fabric with relations from Prisma
 */
export interface FabricWithRelations {
    id: string;
    name: string;
    colorName: string;
    colorHex: string | null;
    standardColor: string | null;
    costPerUnit: number | null;
    leadTimeDays: number | null;
    minOrderQty: number | null;
    isActive: boolean;
    fabricTypeId: string;
    supplierId: string | null;
    fabricType: FabricType;
    supplier: Supplier | null;
    // NEW: Material hierarchy fields (optional for migration)
    materialId?: string | null;
    constructionType?: string | null;
    pattern?: string | null;
    weight?: number | null;
    weightUnit?: string | null;
    composition?: string | null;
    avgShrinkagePct?: number | null;
    defaultLeadTimeDays?: number | null;
    defaultMinOrderQty?: number | null;
    unit?: string | null;
}

/**
 * Fabric without relations (for nested queries)
 */
export interface FabricBasic {
    id: string;
    name: string;
    colorName: string;
    colorHex: string | null;
    standardColor: string | null;
    costPerUnit: number | null;
    leadTimeDays: number | null;
    minOrderQty: number | null;
    isActive: boolean;
    fabricTypeId: string;
    supplierId: string | null;
    // NEW: Material hierarchy fields (optional)
    materialId?: string | null;
    constructionType?: string | null;
    pattern?: string | null;
    weight?: number | null;
    weightUnit?: string | null;
    composition?: string | null;
    avgShrinkagePct?: number | null;
    defaultLeadTimeDays?: number | null;
    defaultMinOrderQty?: number | null;
    unit?: string | null;
}

/**
 * Fabric type with fabrics relation
 */
export interface FabricTypeWithFabrics extends FabricType {
    fabrics: FabricBasic[];
}

/**
 * Type view row for /flat endpoint
 */
export interface TypeViewRow {
    fabricTypeId: string;
    fabricTypeName: string;
    composition: string | null;
    unit: string;
    avgShrinkagePct: number | null;
    defaultCostPerUnit: number | null;
    defaultLeadTimeDays: number | null;
    defaultMinOrderQty: number | null;
    colorCount: number;
    totalStock: number;
    productCount: number;
    consumption7d: number;
    consumption30d: number;
    sales7d: number;
    sales30d: number;
    isTypeRow: true;
}

/**
 * Color view row for /flat endpoint
 */
export interface ColorViewRow {
    fabricId: string;
    colorName: string;
    colorHex: string | null;
    standardColor: string | null;
    fabricTypeId: string;
    fabricTypeName: string;
    composition: string | null;
    unit: string;
    avgShrinkagePct: number | null;
    supplierId: string | null;
    supplierName: string | null;
    costPerUnit: number | null;
    leadTimeDays: number | null;
    minOrderQty: number | null;
    effectiveCostPerUnit: number;
    effectiveLeadTimeDays: number;
    effectiveMinOrderQty: number;
    costInherited: boolean;
    leadTimeInherited: boolean;
    minOrderInherited: boolean;
    typeCostPerUnit: number | null;
    typeLeadTimeDays: number | null;
    typeMinOrderQty: number | null;
    currentBalance: number;
    totalInward: number;
    totalOutward: number;
    avgDailyConsumption: number;
    daysOfStock: number | null;
    reorderPoint: number;
    stockStatus: 'OK' | 'ORDER NOW' | 'ORDER SOON';
    suggestedOrderQty: number;
    sales7d: number;
    sales30d: number;
    isTypeRow: false;
}

/**
 * Order line for sales calculation
 */
export interface OrderLine {
    qty: number;
    unitPrice: number;
}

/**
 * Fabric with fabricType only (for reconciliation queries)
 */
export interface FabricWithFabricType {
    id: string;
    name: string;
    colorName: string;
    colorHex: string | null;
    standardColor: string | null;
    costPerUnit: number | null;
    leadTimeDays: number | null;
    minOrderQty: number | null;
    isActive: boolean;
    fabricTypeId: string;
    supplierId: string | null;
    fabricType: FabricType;
    // NEW: Material hierarchy fields (optional)
    materialId?: string | null;
    constructionType?: string | null;
    pattern?: string | null;
    weight?: number | null;
    weightUnit?: string | null;
    composition?: string | null;
    avgShrinkagePct?: number | null;
    defaultLeadTimeDays?: number | null;
    defaultMinOrderQty?: number | null;
    unit?: string | null;
}

/**
 * Reconciliation item from Prisma
 */
export interface ReconciliationItem {
    id: string;
    fabricId: string;
    systemQty: number;
    physicalQty: number | null;
    variance: number | null;
    adjustmentReason: string | null;
    notes: string | null;
    txnId: string | null;
    fabric: FabricWithFabricType;
}

/**
 * Reconciliation record from Prisma (full with fabric relations)
 */
export interface Reconciliation {
    id: string;
    status: string;
    notes: string | null;
    createdBy: string | null;
    reconcileDate: Date;
    createdAt: Date;
    items: ReconciliationItem[];
}

/**
 * Reconciliation item without fabric (for history query)
 */
export interface ReconciliationItemBasic {
    id: string;
    fabricId: string;
    systemQty: number;
    physicalQty: number | null;
    variance: number | null;
    adjustmentReason: string | null;
    notes: string | null;
    txnId: string | null;
}

/**
 * Reconciliation record for history query (items without fabric)
 */
export interface ReconciliationBasic {
    id: string;
    status: string;
    notes: string | null;
    createdBy: string | null;
    reconcileDate: Date;
    createdAt: Date;
    items: ReconciliationItemBasic[];
}

/**
 * Stock status type
 */
export type StockStatus = 'OK' | 'ORDER NOW' | 'ORDER SOON';

/**
 * Status order for sorting
 */
export const statusOrder: Record<StockStatus, number> = { 'ORDER NOW': 0, 'ORDER SOON': 1, 'OK': 2 };

/**
 * Order line with SKU relations for top fabrics report
 */
export interface OrderLineWithRelations {
    qty: number;
    unitPrice: number | string;
    orderId: string;
    sku: {
        variation: {
            fabric: {
                id: string;
                colorName: string;
                colorHex: string | null;
                fabricType: FabricType | null;
            } | null;
            product: {
                id: string;
                fabricType: FabricType | null;
            };
        };
    } | null;
}

/**
 * Fabric stats for aggregation
 */
export interface FabricStats {
    id: string;
    name: string;
    colorHex: string | null;
    typeName: string;
    composition: string | null;
    units: number;
    revenue: number;
    orderCount: Set<string>;
    productCount: Set<string>;
}

/**
 * Type stats for aggregation
 */
export interface TypeStats {
    id: string;
    name: string;
    composition: string | null;
    units: number;
    revenue: number;
    orderCount: Set<string>;
    productCount: Set<string>;
    colors: Record<string, { name: string; revenue: number }>;
}

/**
 * Fabric with counts for delete operation
 */
export interface FabricWithCounts {
    id: string;
    fabricTypeId: string;
    _count: {
        transactions: number;
        variations: number;
    };
}

/**
 * Fabric type with fabric count
 */
export interface FabricTypeWithCount {
    id: string;
    name: string;
    _count: {
        fabrics: number;
    };
}

/**
 * Stock analysis item
 */
export interface StockAnalysisItem {
    fabricId: string;
    fabricName: string;
    colorName: string;
    unit: string;
    currentBalance: string;
    avgDailyConsumption: string;
    daysOfStock: number | null;
    reorderPoint: string;
    status: StockStatus;
    suggestedOrderQty: number;
    leadTimeDays: number | null;
    costPerUnit: number | null;
    supplier: string;
}

/**
 * Fabric order with relations
 */
export interface FabricOrderWithRelations {
    id: string;
    fabricId: string;
    qtyOrdered: number | string;
    unit: string;
    notes: string | null;
    fabric: {
        fabricType: FabricType;
    };
}

/**
 * Reconciliation item update input
 */
export interface ReconciliationItemUpdate {
    id: string;
    physicalQty: number | null;
    systemQty: number;
    adjustmentReason?: string | null;
    notes?: string | null;
}
