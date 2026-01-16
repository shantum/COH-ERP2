/**
 * Tracking Columns
 *
 * Columns: shopifyStatus, shopifyAwb, shopifyCourier, awb, courier, trackingStatus
 */

import type {
    ColDef,
    ICellRendererParams,
    ValueGetterParams,
    ValueSetterParams,
    EditableCallbackParams,
} from 'ag-grid-community';
import type { ColumnBuilderContext } from '../types';
import { CheckCircle, AlertCircle, ChevronDown } from 'lucide-react';
import { TrackingStatusBadge } from '../../../common/grid';
import { COURIER_OPTIONS } from '../constants';
import { editableCellClass } from '../formatting';

/**
 * Build tracking column definitions
 */
export function buildTrackingColumns(ctx: ColumnBuilderContext): ColDef[] {
    const { getHeaderName, handlersRef } = ctx;

    return [
        // Shopify Status
        {
            colId: 'shopifyStatus',
            headerName: getHeaderName('shopifyStatus'),
            width: 80,
            cellRenderer: (params: ICellRendererParams) => {
                // Use actual Shopify fulfillment status from cache (not inferred from tracking)
                const shopifyStatus = params.data?.shopifyStatus;

                // Not a Shopify order or no status
                if (!shopifyStatus || shopifyStatus === '-') return null;

                if (shopifyStatus === 'fulfilled') {
                    return (
                        <span className="px-1.5 py-0.5 rounded text-xs bg-green-100 text-green-700">
                            fulfilled
                        </span>
                    );
                }

                if (shopifyStatus === 'partial') {
                    return (
                        <span className="px-1.5 py-0.5 rounded text-xs bg-yellow-100 text-yellow-700">
                            partial
                        </span>
                    );
                }

                // null/unfulfilled/restocked
                return (
                    <span className="px-1.5 py-0.5 rounded text-xs bg-gray-100 text-gray-600">
                        unfulfilled
                    </span>
                );
            },
            cellClass: 'text-xs',
        },

        // Shopify AWB
        {
            colId: 'shopifyAwb',
            headerName: getHeaderName('shopifyAwb'),
            width: 130,
            valueGetter: (params: ValueGetterParams) => {
                // Only show AWB if Shopify order is actually fulfilled
                const shopifyStatus = params.data?.shopifyStatus;
                if (!shopifyStatus || !['fulfilled', 'partial'].includes(shopifyStatus)) {
                    return '';
                }
                // Use pre-flattened field (O(1)) instead of orderLines.find() (O(n))
                return params.data?.lineAwbNumber || '';
            },
            cellRenderer: (params: ICellRendererParams) => {
                const awb = params.value;
                if (!awb) return null;
                return (
                    <span className="font-mono text-xs text-gray-600" title={awb}>
                        {awb.length > 14 ? awb.substring(0, 14) + '...' : awb}
                    </span>
                );
            },
            cellClass: 'text-xs',
        },

        // Shopify Courier
        {
            colId: 'shopifyCourier',
            headerName: getHeaderName('shopifyCourier'),
            width: 100,
            valueGetter: (params: ValueGetterParams) => {
                // Only show courier if Shopify order is actually fulfilled
                const shopifyStatus = params.data?.shopifyStatus;
                if (!shopifyStatus || !['fulfilled', 'partial'].includes(shopifyStatus)) {
                    return '';
                }
                // Use pre-flattened field (O(1)) instead of orderLines.find() (O(n))
                return params.data?.lineCourier || '';
            },
            cellRenderer: (params: ICellRendererParams) => {
                const courier = params.value;
                if (!courier) return null;
                return <span className="text-xs text-gray-600">{courier}</span>;
            },
            cellClass: 'text-xs',
        },

        // AWB (editable)
        {
            colId: 'awb',
            headerName: getHeaderName('awb'),
            width: 140,
            editable: (params: EditableCallbackParams) => {
                const status = params.data?.lineStatus;
                return ['packed', 'shipped'].includes(status);
            },
            valueGetter: (params: ValueGetterParams) => {
                // Use pre-flattened field (O(1)) instead of orderLines.find() (O(n))
                return params.data?.lineAwbNumber || '';
            },
            valueSetter: (params: ValueSetterParams) => {
                // Double-check status before calling API to prevent stale data issues
                const status = params.data?.lineStatus;
                if (!['packed', 'shipped'].includes(status)) {
                    console.warn('Cannot update AWB - line status is:', status);
                    return false;
                }
                if (params.data?.lineId) {
                    // Call API to persist - cache will be updated via SSE/refetch
                    handlersRef.current.onUpdateLineTracking(params.data.lineId, { awbNumber: params.newValue || '' });
                }
                return true;
            },
            cellRenderer: (params: ICellRendererParams) => {
                const row = params.data;
                if (!row?.lineId) return null;

                // Use pre-flattened fields (O(1)) instead of orderLines.find() (O(n))
                const lineAwb = row.lineAwbNumber || '';
                const expectedAwb = row.shopifyAwb || '';

                // Check if cell is editable
                const isEditable = ['packed', 'shipped'].includes(row.lineStatus);

                // Determine match status
                const hasExpected = !!expectedAwb;
                const hasLine = !!lineAwb;
                const isMatch = hasExpected && hasLine && lineAwb.toLowerCase() === expectedAwb.toLowerCase();
                const isMismatch = hasExpected && hasLine && !isMatch;

                if (!hasLine) {
                    // Show prominent input hint for editable cells
                    if (isEditable) {
                        return (
                            <div className="flex items-center gap-1.5 text-blue-500">
                                <span className="text-xs font-medium">Scan AWB</span>
                                <div className="w-4 h-4 rounded border-2 border-dashed border-blue-300 flex items-center justify-center">
                                    <span className="text-[10px]">⌨</span>
                                </div>
                            </div>
                        );
                    }
                    // Non-editable: show nothing instead of dash
                    return null;
                }

                return (
                    <div className="flex items-center gap-1">
                        <span
                            className={`font-mono text-xs ${isMismatch ? 'text-amber-700 font-medium' : isMatch ? 'text-green-700 font-medium' : 'text-gray-700'}`}
                            title={lineAwb}
                        >
                            {lineAwb.length > 12 ? lineAwb.substring(0, 12) + '...' : lineAwb}
                        </span>
                        {isMatch && <CheckCircle size={12} className="text-green-500 flex-shrink-0" />}
                        {isMismatch && <span title={`Expected: ${expectedAwb}`}><AlertCircle size={12} className="text-amber-500 flex-shrink-0" /></span>}
                    </div>
                );
            },
            cellClass: editableCellClass('lineStatus', ['packed', 'shipped'], 'text-xs'),
        },

        // Courier (editable dropdown)
        {
            colId: 'courier',
            headerName: getHeaderName('courier'),
            width: 100,
            editable: (params: EditableCallbackParams) => {
                const status = params.data?.lineStatus;
                return ['packed', 'shipped'].includes(status);
            },
            cellEditor: 'agSelectCellEditor',
            cellEditorParams: {
                values: COURIER_OPTIONS,
            },
            valueGetter: (params: ValueGetterParams) => {
                // Use pre-flattened field (O(1)) instead of orderLines.find() (O(n))
                return params.data?.lineCourier || '';
            },
            valueSetter: (params: ValueSetterParams) => {
                // Double-check status before calling API to prevent stale data issues
                const status = params.data?.lineStatus;
                if (!['packed', 'shipped'].includes(status)) {
                    console.warn('Cannot update courier - line status is:', status);
                    return false;
                }
                if (params.data?.lineId) {
                    // Call API to persist - cache will be updated via SSE/refetch
                    handlersRef.current.onUpdateLineTracking(params.data.lineId, { courier: params.newValue || '' });
                }
                return true;
            },
            cellRenderer: (params: ICellRendererParams) => {
                const row = params.data;
                if (!row?.lineId) return null;

                // Use pre-flattened field (O(1)) instead of orderLines.find() (O(n))
                const courier = row.lineCourier || '';
                const isEditable = ['packed', 'shipped'].includes(row.lineStatus);

                if (!courier) {
                    if (isEditable) {
                        return (
                            <div className="flex items-center gap-1 text-gray-400">
                                <span className="text-xs">Select</span>
                                <ChevronDown size={12} />
                            </div>
                        );
                    }
                    // Non-editable: show nothing
                    return null;
                }

                return <span className="text-xs font-medium text-blue-700">{courier}</span>;
            },
            cellClass: editableCellClass('lineStatus', ['packed', 'shipped'], 'text-xs'),
        },

        // Tracking Status
        {
            colId: 'trackingStatus',
            headerName: getHeaderName('trackingStatus'),
            width: 110,
            cellRenderer: (params: ICellRendererParams) => {
                const order = params.data?.order;

                // Get tracking status from iThink sync (order level)
                let trackingStatus = order?.trackingStatus;

                // Use pre-computed line fields (O(1)) with order-level fallback
                const shippedAt = params.data?.lineShippedAt || order?.shippedAt;
                const deliveredAt = params.data?.lineDeliveredAt || order?.deliveredAt;

                // If no tracking status from iThink, derive from dates
                if (!trackingStatus) {
                    if (order?.rtoInitiatedAt) {
                        trackingStatus = order?.rtoReceivedAt ? 'rto_received' : 'rto_initiated';
                    } else if (deliveredAt) {
                        trackingStatus = 'delivered';
                    } else if (shippedAt) {
                        trackingStatus = 'in_transit';
                    }
                }

                if (!trackingStatus) return null;

                return (
                    <TrackingStatusBadge
                        status={trackingStatus}
                        daysInTransit={order?.daysInTransit}
                        ofdCount={order?.deliveryAttempts}
                    />
                );
            },
        },
    ];
}
