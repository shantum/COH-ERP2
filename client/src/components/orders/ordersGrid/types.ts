/**
 * Type definitions for OrdersGrid component
 */

import type { MutableRefObject } from 'react';
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
 * Dynamic values that change frequently - accessed via ref for stable column context
 * This prevents column definitions from rebuilding on every state change.
 */
export interface DynamicColumnHandlers {
    // UI State (changes on every action)
    allocatingLines: Set<string>;
    isCancellingLine: boolean;
    isUncancellingLine: boolean;
    isCancellingOrder: boolean;
    isDeletingOrder: boolean;

    // Fulfillment handlers
    onAllocate: (lineId: string) => void;
    onUnallocate: (lineId: string) => void;
    onPick: (lineId: string) => void;
    onUnpick: (lineId: string) => void;
    onPack: (lineId: string) => void;
    onUnpack: (lineId: string) => void;
    onMarkShippedLine: (lineId: string, data?: { awbNumber?: string; courier?: string }) => void;
    onUnmarkShippedLine: (lineId: string) => void;

    // Admin actions (optional)
    isAdmin?: boolean;
    // Line-level force ship (ships single line without packed validation)
    onForceShipLine?: (lineId: string, data: { awbNumber: string; courier: string }) => void;

    // Production handlers
    onCreateBatch: (data: any) => void;
    onUpdateBatch: (id: string, data: any) => void;
    onDeleteBatch: (id: string) => void;

    // Line handlers
    onUpdateLineNotes: (lineId: string, notes: string) => void;
    onCancelLine: (lineId: string) => void;
    onUncancelLine: (lineId: string) => void;
    onUpdateLineTracking: (lineId: string, data: { awbNumber?: string; courier?: string }) => void;

    // Customization handlers
    onCustomize?: (lineId: string, lineData: CustomizeLineData) => void;
    onEditCustomization?: (lineId: string, lineData: EditCustomizationData) => void;
    onRemoveCustomization?: (lineId: string, skuCode: string) => void;

    // Post-ship handlers
    onMarkCodRemitted?: (orderId: string) => void;
    onTrack?: (awbNumber: string, orderNumber: string) => void;

    // Order Info handlers
    onViewOrder: (orderId: string) => void;
    onSelectCustomer: (customerId: string) => void;
    onUpdateShipByDate?: (orderId: string, date: string | null) => void;
}

/**
 * Context passed to column builder functions
 * Contains stable refs and static values - does NOT rebuild on handler changes.
 *
 * PERFORMANCE: Dynamic values accessed via handlersRef.current to avoid
 * column definition rebuilds on every state change.
 */
export interface ColumnBuilderContext {
    // Header customization (stable - uses useCallback)
    getHeaderName: (colId: string) => string;
    setCustomHeader: (colId: string, value: string) => void;

    // Current view (changes rarely)
    currentView?: 'open' | 'shipped' | 'rto' | 'cod_pending' | 'archived' | 'cancelled';

    // Utilities (stable)
    isDateLocked: (date: string) => boolean;

    // All dynamic handlers accessed via ref for stability
    // CellRenderers should use: ctx.handlersRef.current.onAllocate(lineId)
    handlersRef: MutableRefObject<DynamicColumnHandlers>;
}

/**
 * Legacy ColumnBuilderContext with all props directly accessible.
 * Used during migration - cellRenderers can access both patterns.
 * @deprecated Use handlersRef.current.xxx instead of direct access
 */
export interface LegacyColumnBuilderContext extends ColumnBuilderContext, DynamicColumnHandlers {}
