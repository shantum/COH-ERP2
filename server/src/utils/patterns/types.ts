/**
 * Type Definitions and Constants
 * Shared types for inventory, orders, and transactions
 */

import type { PrismaClient } from '@prisma/client';
import type { CustomerTier } from '../tierUtils.js';

// ============================================
// PRISMA TYPES
// ============================================

/**
 * Prisma transaction client type
 * Used for functions that can accept either PrismaClient or a transaction
 */
export type PrismaTransactionClient = Omit<
    PrismaClient,
    '$connect' | '$disconnect' | '$on' | '$transaction' | '$use' | '$extends'
>;

/**
 * Union type for prisma client or transaction
 */
export type PrismaOrTransaction = PrismaClient | PrismaTransactionClient;

// ============================================
// TRANSACTION CONSTANTS
// ============================================

/**
 * Inventory transaction types
 * NOTE: RESERVED type removed in simplification - allocate now creates OUTWARD directly
 */
export const TXN_TYPE = {
    INWARD: 'inward',
    OUTWARD: 'outward',
} as const;

export type TxnType = typeof TXN_TYPE[keyof typeof TXN_TYPE];

/**
 * Inventory transaction reasons
 */
export const TXN_REASON = {
    ORDER_ALLOCATION: 'order_allocation',
    PRODUCTION: 'production',
    SALE: 'sale',
    RETURN_RECEIPT: 'return_receipt',
    RTO_RECEIVED: 'rto_received',
    DAMAGE: 'damage',
    ADJUSTMENT: 'adjustment',
    TRANSFER: 'transfer',
    WRITE_OFF: 'write_off',
} as const;

export type TxnReason = typeof TXN_REASON[keyof typeof TXN_REASON];

/**
 * Reference types for inventory transactions
 */
export const TXN_REFERENCE_TYPE = {
    ORDER_LINE: 'order_line',
    PRODUCTION_BATCH: 'production_batch',
    RETURN_REQUEST_LINE: 'return_request_line',
    REPACKING_QUEUE_ITEM: 'repacking_queue_item',
    WRITE_OFF_LOG: 'write_off_log',
    MANUAL_ADJUSTMENT: 'manual_adjustment',
} as const;

export type TxnReferenceType = typeof TXN_REFERENCE_TYPE[keyof typeof TXN_REFERENCE_TYPE];

/**
 * Fabric transaction types
 */
export const FABRIC_TXN_TYPE = {
    INWARD: 'inward',
    OUTWARD: 'outward',
} as const;

export type FabricTxnType = typeof FABRIC_TXN_TYPE[keyof typeof FABRIC_TXN_TYPE];

// ============================================
// INVENTORY BALANCE TYPES
// ============================================

// Re-export shared domain types for backwards compatibility
export type {
    InventoryBalance,
    InventoryBalanceWithSkuId,
    FabricBalance,
    FabricBalanceWithId,
} from '@coh/shared/domain';

// Server-specific options (includes Prisma-specific options like excludeCustomSkus)
export interface InventoryBalanceOptions {
    allowNegative?: boolean;
    excludeCustomSkus?: boolean;
}

// ============================================
// VALIDATION TYPES
// ============================================

export interface OutwardValidationResult {
    allowed: boolean;
    reason?: string;
    currentBalance: number;
    availableBalance: number;
}

export interface SkuValidationResult {
    valid: boolean;
    sku?: SkuWithRelations;
    error?: string;
}

export interface SkuWithRelations {
    id: string;
    skuCode: string;
    isActive: boolean;
    variation?: {
        product?: {
            isActive: boolean;
        } | null;
    } | null;
    [key: string]: unknown;
}

export interface SkuValidationParams {
    skuId?: string;
    skuCode?: string;
    barcode?: string;
}

export interface TransactionDependency {
    type: string;
    message: string;
    [key: string]: unknown;
}

export interface TransactionDeletionValidation {
    canDelete: boolean;
    reason?: string | null;
    dependencies?: TransactionDependency[];
    transaction?: {
        id: string;
        skuCode?: string;
        txnType: string;
        qty: number;
        reason: string | null;
    };
}

// ============================================
// ORDER TYPES
// ============================================

export type LineStatus = 'pending' | 'allocated' | 'picked' | 'packed' | 'cancelled' | 'shipped';

export type FulfillmentStage = 'pending' | 'allocated' | 'in_progress' | 'ready_to_ship';

export interface LineStatusCounts {
    totalLines: number;
    pendingLines: number;
    allocatedLines: number;
    pickedLines: number;
    packedLines: number;
}

export interface OrderLineForFulfillment {
    lineStatus: LineStatus | string;
}

export interface EnrichmentOptions {
    includeFulfillmentStage?: boolean;
    includeLineStatusCounts?: boolean;
}

export interface OrderForEnrichment {
    customerId: string | null;
    orderLines?: OrderLineForFulfillment[];
    [key: string]: unknown;
}

export interface EnrichedOrder extends OrderForEnrichment {
    customerLtv: number;
    customerOrderCount: number;
    customerRtoCount: number;
    customerTier: CustomerTier;
    fulfillmentStage?: FulfillmentStage;
    totalLines?: number;
    pendingLines?: number;
    allocatedLines?: number;
    pickedLines?: number;
    packedLines?: number;
}

export interface OrderWithShopifyCache {
    shopifyCache?: ShopifyCache | null;
    shippingAddress?: string | null;
    [key: string]: unknown;
}

export interface OrderLineWithAddress {
    shippingAddress?: string | null;
    [key: string]: unknown;
}

export interface ShopifyCache {
    rawData?: string | null;
    discountCodes?: string | null;
    customerNotes?: string | null;
    fulfillmentStatus?: string | null;
    financialStatus?: string | null;
    paymentMethod?: string | null;
    tags?: string | null;
    trackingNumber?: string | null;
    trackingCompany?: string | null;
    trackingUrl?: string | null;
    shippedAt?: Date | string | null;
    shipmentStatus?: string | null;
    deliveredAt?: Date | string | null;
    fulfillmentUpdatedAt?: Date | string | null;
    shippingAddress1?: string | null;
    shippingAddress2?: string | null;
    shippingCity?: string | null;
    shippingState?: string | null;
    shippingProvince?: string | null;
    shippingProvinceCode?: string | null;
    shippingCountry?: string | null;
    shippingCountryCode?: string | null;
    shippingZip?: string | null;
    shippingName?: string | null;
    shippingPhone?: string | null;
}

export interface EnrichedShopifyCache extends Omit<ShopifyCache, 'rawData'> {}

// ============================================
// TRANSACTION HELPER TYPES
// ============================================

export interface CreateReservedTransactionParams {
    skuId: string;
    qty: number;
    orderLineId: string;
    userId: string;
}

export interface CreateSaleTransactionParams {
    skuId: string;
    qty: number;
    orderLineId: string;
    userId: string;
}

// ============================================
// CUSTOMIZATION TYPES
// ============================================

export interface CustomizationData {
    type: 'length' | 'size' | 'measurements' | 'other';
    value: string;
    notes?: string;
}

export interface CreateCustomSkuResult {
    customSku: {
        id: string;
        skuCode: string;
        [key: string]: unknown;
    };
    orderLine: {
        id: string;
        [key: string]: unknown;
    };
    originalSkuCode: string;
}

export interface RemoveCustomizationOptions {
    force?: boolean;
}

export interface RemoveCustomizationResult {
    success: boolean;
    orderLine: {
        id: string;
        [key: string]: unknown;
    };
    deletedCustomSkuCode: string;
    forcedCleanup: boolean;
    deletedTransactions: number;
    deletedBatches: number;
}
