/**
 * Type definitions for OrdersTable component (TanStack Table version)
 */

import type { MutableRefObject } from 'react';
import type { FlattenedOrderRow } from '../../../utils/orderHelpers';
import type { Order } from '../../../types';

/**
 * Data shape for creating a production batch from the orders table.
 * Matches the payload sent from ProductionCell when scheduling production.
 * Uses undefined (not null) for optional fields to match mutation expectations.
 */
export interface CreateBatchData {
    skuId?: string;
    qtyPlanned: number;
    priority?: 'low' | 'normal' | 'high' | 'urgent' | 'order_fulfillment';
    sourceOrderLineId?: string;
    batchDate?: string;
    notes?: string;
}

/**
 * Data shape for updating a production batch (e.g., rescheduling date).
 */
export interface UpdateBatchData {
    batchDate?: string;
}

/**
 * View type for unified order views
 */
export type OrderViewType = 'open' | 'shipped' | 'rto' | 'all' | 'cancelled';

/**
 * Props for customization data
 */
export interface CustomizeLineData {
    lineId: string;
    skuCode: string;
    productName: string;
    colorName: string;
    size: string;
    qty: number;
}

export interface EditCustomizationData extends CustomizeLineData {
    customizationType: string | null;
    customizationValue: string | null;
    customizationNotes: string | null;
}

/**
 * Dynamic values that change frequently - accessed via ref for stable column context.
 * This prevents column definitions from rebuilding on every state change.
 */
export interface DynamicColumnHandlers {
    // UI State (changes on every action)
    allocatingLines: Set<string>;
    isCancellingLine: boolean;
    isUncancellingLine: boolean;
    isCancellingOrder: boolean;
    isDeletingOrder: boolean;

    // Fulfillment handlers (DISABLED — fulfillment now managed in Google Sheets)
    onAllocate?: (lineId: string, orderId: string) => void;
    onUnallocate?: (lineId: string, orderId: string) => void;
    onPick?: (lineId: string) => void;
    onUnpick?: (lineId: string) => void;
    onPack?: (lineId: string) => void;
    onUnpack?: (lineId: string) => void;
    onMarkShippedLine?: (lineId: string, data?: { awbNumber?: string; courier?: string }) => void;
    onUnmarkShippedLine?: (lineId: string) => void;

    // Admin actions (optional)
    isAdmin?: boolean;
    onForceShipLine?: (lineId: string, data: { awbNumber?: string; courier?: string }) => void;

    // Production handlers
    onCreateBatch: (data: CreateBatchData) => void;
    onUpdateBatch: (id: string, data: UpdateBatchData) => void;
    onDeleteBatch: (id: string) => void;

    // Line handlers
    onUpdateLineNotes: (lineId: string, notes: string) => void;
    onCancelLine?: (lineId: string) => void;
    onUncancelLine?: (lineId: string) => void;
    onUpdateLineTracking?: (lineId: string, data: { awbNumber?: string; courier?: string }) => void;

    // Customization handlers
    onCustomize?: (lineId: string, lineData: CustomizeLineData) => void;
    onEditCustomization?: (lineId: string, lineData: EditCustomizationData) => void;
    onRemoveCustomization?: (lineId: string, skuCode: string) => void;

    // Post-ship handlers
    onMarkCodRemitted?: (orderId: string) => void;
    onTrack?: (awbNumber: string, orderNumber: string) => void;

    // Order Info handlers
    onViewOrder: (orderId: string) => void;
    onViewCustomer: (order: Order) => void;
    onUpdateShipByDate?: (orderId: string, date: string | null) => void;

    /**
     * Callback after any inline edit mutation settles (success OR error).
     * CRITICAL for UI/DB sync - use this to invalidate queries and refetch data.
     */
    onSettled?: () => void;
}

/**
 * Context passed to cell components.
 * Contains stable refs and static values.
 */
export interface OrdersTableContext {
    // Header customization (stable - uses useCallback)
    getHeaderName: (colId: string) => string;
    setCustomHeader: (colId: string, value: string) => void;

    // Current view (changes rarely)
    currentView?: OrderViewType;

    // Utilities (stable)
    isDateLocked: (date: string) => boolean;

    // All dynamic handlers accessed via ref for stability
    handlersRef: MutableRefObject<DynamicColumnHandlers>;
}

/**
 * Common cell component props
 */
export interface CellProps {
    row: FlattenedOrderRow;
    handlersRef: MutableRefObject<DynamicColumnHandlers>;
}

/**
 * Props for OrdersTable component
 */
export interface OrdersTableProps {
    rows: FlattenedOrderRow[];
    lockedDates: string[];
    currentView?: OrderViewType;
    // DISABLED: Fulfillment now managed in Google Sheets
    onAllocate?: (lineId: string, orderId: string) => void;
    onUnallocate?: (lineId: string, orderId: string) => void;
    onPick?: (lineId: string) => void;
    onUnpick?: (lineId: string) => void;
    onPack?: (lineId: string) => void;
    onUnpack?: (lineId: string) => void;
    onMarkShippedLine?: (lineId: string, data?: { awbNumber?: string; courier?: string }) => void;
    onUnmarkShippedLine?: (lineId: string) => void;
    onUpdateLineTracking?: (lineId: string, data: { awbNumber?: string; courier?: string }) => void;
    onShip?: (order: Order) => void;
    onCreateBatch: (data: CreateBatchData) => void;
    onUpdateBatch: (id: string, data: UpdateBatchData) => void;
    onDeleteBatch: (id: string) => void;
    onUpdateLineNotes: (lineId: string, notes: string) => void;
    onViewOrder: (orderId: string) => void;
    onEditOrder: (order: Order) => void;
    onCancelOrder?: (id: string, reason?: string) => void;
    onDeleteOrder?: (id: string) => void;
    onCancelLine?: (lineId: string) => void;
    onUncancelLine?: (lineId: string) => void;
    onViewCustomer: (order: Order) => void;
    onCustomize?: (lineId: string, lineData: CustomizeLineData) => void;
    onEditCustomization?: (lineId: string, lineData: EditCustomizationData) => void;
    onRemoveCustomization?: (lineId: string, skuCode: string) => void;
    onUpdateShipByDate?: (orderId: string, date: string | null) => void;
    onForceShipLine?: (lineId: string, data: { awbNumber?: string; courier?: string }) => void;
    // Post-ship action handlers
    onUnship?: (orderId: string) => void;
    onMarkDelivered?: (orderId: string) => void;
    onMarkRto?: (orderId: string) => void;
    onUnarchive?: (orderId: string) => void;
    onTrack?: (awbNumber: string, orderNumber: string) => void;
    onMarkCodRemitted?: (orderId: string) => void;
    onMarkRtoReceived?: (orderId: string) => void;
    /**
     * Callback after any inline edit mutation settles.
     * CRITICAL for UI/DB sync - invalidates queries to refetch data.
     */
    onSettled?: () => void;
    // Loading states
    allocatingLines: Set<string>;
    isCancellingOrder: boolean;
    isCancellingLine: boolean;
    isUncancellingLine: boolean;
    isDeletingOrder: boolean;
    isUnshipping?: boolean;
    isMarkingDelivered?: boolean;
    isMarkingRto?: boolean;
    isUnarchiving?: boolean;
    isAdmin?: boolean;
}
