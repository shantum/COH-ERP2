/**
 * @fileoverview Type definitions for inventory routes
 */

// ============================================
// TYPE DEFINITIONS
// ============================================

/**
 * Transaction reason for source mapping
 */
export type TransactionReason = 'production' | 'return_receipt' | 'rto_received' | 'repack_complete' | 'adjustment' | 'received';

/**
 * Source type for pending queue
 */
export type PendingSource = 'rto' | 'production' | 'returns' | 'repacking';

/**
 * RTO condition values
 */
export type RtoCondition = 'good' | 'unopened' | 'damaged' | 'wrong_product';

/**
 * Allocation type for transaction allocation
 */
export type AllocationType = 'production' | 'rto' | 'adjustment';

/**
 * SKU select fields for queries
 */
export interface SkuSelectFields {
    id: boolean;
    skuCode: boolean;
    size: boolean;
    variation: {
        select: {
            colorName: boolean;
            imageUrl: boolean;
            product: { select: { name: boolean; imageUrl: boolean } };
        };
    };
}

/**
 * SKU with relations from queries
 */
export interface SkuWithRelations {
    id: string;
    skuCode: string;
    size: string;
    mrp?: number | null;
    isCustomSku?: boolean;
    targetStockQty?: number;
    isActive?: boolean;
    fabricConsumption?: number | null;
    writeOffCount?: number;
    variation: {
        id?: string;
        colorName: string;
        imageUrl?: string | null;
        fabricId?: string | null;
        product: {
            id?: string;
            name: string;
            imageUrl?: string | null;
            category?: string | null;
            productType?: string | null;
            gender?: string | null;
            defaultFabricConsumption?: number | null;
        };
        fabric?: {
            id: string;
        } | null;
    };
    shopifyInventoryCache?: {
        availableQty?: number | null;
    } | null;
}

/**
 * Order line with RTO data
 */
export interface RtoOrderLine {
    id: string;
    skuId: string;
    qty: number;
    orderId: string;
    rtoCondition: string | null;
    order: {
        id: string;
        orderNumber: string;
        customerName?: string | null;
        trackingStatus: string;
        rtoInitiatedAt?: Date | null;
        isArchived?: boolean;
        _count?: { orderLines: number };
        orderLines?: Array<{ id: string }>;
        rtoReceivedAt?: Date | null;
        terminalStatus?: string | null;
        terminalAt?: Date | null;
    };
    sku?: SkuWithRelations;
}

/**
 * Production batch data
 */
export interface ProductionBatch {
    id: string;
    batchCode?: string | null;
    batchDate: Date;
    qtyPlanned: number;
    qtyCompleted: number;
    status: string;
    skuId: string;
    sku?: SkuWithRelations;
    completedAt?: Date | null;
    sourceOrderLineId?: string | null;
}

/**
 * Return request line data
 */
export interface ReturnRequestLine {
    id: string;
    skuId: string;
    qty: number;
    requestId: string;
    itemCondition?: string | null;
    inspectedAt?: Date | null;
    inspectedById?: string | null;
    request: {
        id?: string;
        requestNumber: string;
        reasonCategory?: string | null;
        status?: string;
        customer?: {
            firstName?: string | null;
        } | null;
    };
    sku?: SkuWithRelations;
}

/**
 * Repacking queue item data
 */
export interface RepackingQueueItem {
    id: string;
    skuId: string;
    qty: number;
    condition?: string | null;
    status: string;
    inspectionNotes?: string | null;
    qcComments?: string | null;
    processedAt?: Date | null;
    processedById?: string | null;
    returnRequest?: {
        requestNumber: string;
    } | null;
    sku?: SkuWithRelations;
}

/**
 * Inventory transaction data
 */
export interface InventoryTransaction {
    id: string;
    skuId: string;
    txnType: string;
    qty: number;
    reason: string | null;
    referenceId?: string | null;
    notes?: string | null;
    warehouseLocation?: string | null;
    createdAt: Date;
    createdById?: string | null;
    sku?: SkuWithRelations & {
        variation?: {
            colorName: string;
            imageUrl?: string | null;
            product?: {
                name: string;
                imageUrl?: string | null;
            } | null;
        } | null;
    };
    createdBy?: {
        id?: string;
        name?: string | null;
        email?: string;
    } | null;
}

/**
 * Match item for transaction allocation
 */
export interface TransactionMatch {
    type: 'production' | 'rto';
    id: string;
    label: string;
    detail: string;
    date?: Date | null;
    pending?: number;
    orderId?: string;
    atWarehouse?: boolean;
}

/**
 * Previous allocation state
 */
export interface PreviousAllocation {
    type: string;
    referenceId: string | null;
}

/**
 * Pending queue item response
 */
export interface PendingQueueItem {
    id: string;
    skuId: string;
    skuCode: string;
    productName: string;
    colorName: string;
    size: string;
    qty: number;
    imageUrl: string | null;
    contextLabel: string;
    contextValue: string;
    source: string;
    [key: string]: unknown;
}

/**
 * Write-off log data
 */
export interface WriteOffLog {
    id: string;
    skuId: string;
    qty: number;
    reason: string;
    sourceType: string;
    sourceId: string;
    notes?: string | null;
    createdById: string;
}

/**
 * Query parameters for pending queue
 */
export interface PendingQueueQuery {
    search?: string;
    limit?: string;
    offset?: string;
}

/**
 * Query parameters for balance endpoint
 */
export interface BalanceQuery {
    belowTarget?: string;
    search?: string;
    limit?: string;
    offset?: string;
    includeCustomSkus?: string;
}

/**
 * Query parameters for transactions endpoint
 */
export interface TransactionsQuery {
    skuId?: string;
    txnType?: string;
    reason?: string;
    startDate?: string;
    endDate?: string;
    limit?: string;
    offset?: string;
}

/**
 * Query parameters for recent inwards
 */
export interface RecentInwardsQuery {
    limit?: string;
    source?: string;
}

/**
 * Query parameters for inward history
 */
export interface InwardHistoryQuery {
    date?: string;
    limit?: string;
}

/**
 * Request body for instant inward
 */
export interface InstantInwardBody {
    skuCode: string;
}

/**
 * Request body for allocate transaction
 */
export interface AllocateTransactionBody {
    transactionId: string;
    allocationType: AllocationType;
    allocationId?: string;
    rtoCondition?: RtoCondition;
}

/**
 * Request body for RTO inward line
 */
export interface RtoInwardLineBody {
    lineId: string;
    condition: RtoCondition;
    notes?: string;
}

/**
 * Request body for inward/outward transactions
 */
export interface InwardOutwardBody {
    skuId: string;
    qty: number;
    reason: string;
    referenceId?: string;
    notes?: string;
    warehouseLocation?: string;
    adjustmentReason?: string;
}

/**
 * Request body for quick inward
 */
export interface QuickInwardBody {
    skuCode?: string;
    barcode?: string;
    qty: number;
    reason?: string;
    notes?: string;
}

/**
 * Request body for editing inward
 */
export interface EditInwardBody {
    qty?: number;
    notes?: string;
}
