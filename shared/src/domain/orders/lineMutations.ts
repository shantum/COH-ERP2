/**
 * Order Line Mutations - Domain Types
 *
 * Type definitions for line-level mutation operations.
 * These types are shared between the Express tRPC router and
 * (future) TanStack Start Server Functions.
 *
 * NOTE: The actual mutation implementations live in the server package
 * (server/src/routes/orders/mutations/lineOps.ts) and use Prisma.
 * This file only contains shared type definitions.
 */

// ============================================
// RESULT TYPES
// ============================================

export interface MutationResult<T> {
    success: boolean;
    data?: T;
    error?: {
        code: 'NOT_FOUND' | 'BAD_REQUEST' | 'CONFLICT';
        message: string;
    };
}

// ============================================
// MARK LINE DELIVERED
// ============================================

export interface MarkLineDeliveredInput {
    lineId: string;
    deliveredAt?: string; // ISO string
}

export interface MarkLineDeliveredResult {
    lineId: string;
    orderId: string;
    deliveredAt: Date;
    orderTerminal: boolean;
}

// ============================================
// MARK LINE RTO
// ============================================

export interface MarkLineRtoInput {
    lineId: string;
}

export interface MarkLineRtoResult {
    lineId: string;
    orderId: string;
    rtoInitiatedAt: Date;
}

// ============================================
// RECEIVE LINE RTO
// ============================================

export interface ReceiveLineRtoInput {
    lineId: string;
    condition?: 'good' | 'unopened' | 'damaged' | 'wrong_product';
}

export interface ReceiveLineRtoResult {
    lineId: string;
    orderId: string;
    rtoReceivedAt: Date;
    condition: string;
    orderTerminal: boolean;
    inventoryRestored: boolean;
}

// ============================================
// CANCEL LINE
// ============================================

export interface CancelLineInput {
    lineId: string;
    reason?: string;
}

export interface CancelLineResult {
    lineId: string;
    orderId: string;
    lineStatus: 'cancelled';
    inventoryReleased: boolean;
    skuId: string | null;
}

// ============================================
// ADJUST LINE QTY
// ============================================

export interface AdjustLineQtyInput {
    lineId: string;
    newQty: number;
    newUnitPrice?: number;
    userId?: string;
}

export interface AdjustLineQtyResult {
    lineId: string;
    orderId: string;
    oldQty: number;
    newQty: number;
    inventoryAdjusted: boolean;
    skuId: string | null;
    newOrderTotal: number;
}
