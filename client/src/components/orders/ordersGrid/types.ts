/**
 * Type definitions for OrdersGrid component
 */

import type { FlattenedOrderRow } from '../../../utils/orderHelpers';

/**
 * Props for OrdersGrid. Handles 20+ action handlers for order fulfillment workflow.
 * - rows: Flattened order data (order header row + multiple line rows per order)
 * - lockedDates: Production dates that cannot be edited in date picker
 * - allocatingLines: Set of lineIds currently being toggled (prevent double-click)
 */
export interface OrdersGridProps {
    rows: FlattenedOrderRow[];
    lockedDates: string[];
    // Allocation actions
    onAllocate: (lineId: string) => void;
    onUnallocate: (lineId: string) => void;
    // Pick actions
    onPick: (lineId: string) => void;
    onUnpick: (lineId: string) => void;
    // Pack actions
    onPack: (lineId: string) => void;
    onUnpack: (lineId: string) => void;
    // Ship actions (spreadsheet workflow)
    onMarkShippedLine: (lineId: string, data?: { awbNumber?: string; courier?: string }) => void;
    onUnmarkShippedLine: (lineId: string) => void;
    onUpdateLineTracking: (lineId: string, data: { awbNumber?: string; courier?: string }) => void;
    onShip?: (order: any) => void;
    // Production batch actions
    onCreateBatch: (data: any) => void;
    onUpdateBatch: (id: string, data: any) => void;
    onDeleteBatch: (id: string) => void;
    // Line/order actions
    onUpdateLineNotes: (lineId: string, notes: string) => void;
    onViewOrder: (orderId: string) => void;
    onEditOrder: (order: any) => void;
    onCancelOrder: (id: string, reason?: string) => void;
    onArchiveOrder: (id: string) => void;
    onDeleteOrder: (id: string) => void;
    onCancelLine: (lineId: string) => void;
    onUncancelLine: (lineId: string) => void;
    // Customer actions
    onSelectCustomer: (customerId: string) => void;
    // Customization actions
    onCustomize?: (lineId: string, lineData: CustomizeLineData) => void;
    onEditCustomization?: (lineId: string, lineData: EditCustomizationData) => void;
    onRemoveCustomization?: (lineId: string, skuCode: string) => void;
    // Ship-by date
    onUpdateShipByDate?: (orderId: string, date: string | null) => void;
    // Loading states
    allocatingLines: Set<string>;
    isCancellingOrder: boolean;
    isCancellingLine: boolean;
    isUncancellingLine: boolean;
    isArchiving: boolean;
    isDeletingOrder: boolean;
}

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
 * Context passed to column builder functions
 * Contains all handlers and state needed to render columns
 */
export interface ColumnBuilderContext {
    // Header customization
    getHeaderName: (colId: string) => string;
    setCustomHeader: (colId: string, value: string) => void;
    // Allocation state
    allocatingLines: Set<string>;
    // Loading states
    isCancellingLine: boolean;
    isUncancellingLine: boolean;
    // Locked dates for production
    isDateLocked: (date: string) => boolean;
    // All handlers from OrdersGridProps
    onAllocate: (lineId: string) => void;
    onUnallocate: (lineId: string) => void;
    onPick: (lineId: string) => void;
    onUnpick: (lineId: string) => void;
    onPack: (lineId: string) => void;
    onUnpack: (lineId: string) => void;
    onMarkShippedLine: (lineId: string, data?: { awbNumber?: string; courier?: string }) => void;
    onUnmarkShippedLine: (lineId: string) => void;
    onUpdateLineTracking: (lineId: string, data: { awbNumber?: string; courier?: string }) => void;
    onCreateBatch: (data: any) => void;
    onUpdateBatch: (id: string, data: any) => void;
    onDeleteBatch: (id: string) => void;
    onUpdateLineNotes: (lineId: string, notes: string) => void;
    onViewOrder: (orderId: string) => void;
    onCancelLine: (lineId: string) => void;
    onUncancelLine: (lineId: string) => void;
    onSelectCustomer: (customerId: string) => void;
    onCustomize?: (lineId: string, lineData: CustomizeLineData) => void;
    onEditCustomization?: (lineId: string, lineData: EditCustomizationData) => void;
    onRemoveCustomization?: (lineId: string, skuCode: string) => void;
    onUpdateShipByDate?: (orderId: string, date: string | null) => void;
}
