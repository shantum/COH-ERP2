/**
 * Fulfillment Columns
 *
 * Columns: allocate, production, notes, pick, pack, ship, cancelLine
 */

import type {
    ColDef,
    ICellRendererParams,
    ValueGetterParams,
    ValueSetterParams,
    EditableCallbackParams,
    CellClassParams,
} from 'ag-grid-community';
import type { ColumnBuilderContext } from '../types';
import { Check, X } from 'lucide-react';
import { ProductionDatePopover } from '../cellRenderers';

/**
 * Build fulfillment action column definitions
 *
 * PERFORMANCE: Dynamic handlers accessed via handlersRef.current to avoid
 * column rebuilds on every state change. The ref is stable, but its .current
 * value is updated every render with latest handlers.
 */
export function buildFulfillmentColumns(ctx: ColumnBuilderContext): ColDef[] {
    // Static values accessed directly
    const { getHeaderName, isDateLocked, handlersRef } = ctx;

    return [
        // Allocate
        {
            colId: 'allocate',
            headerName: getHeaderName('allocate'),
            width: 50,
            cellRenderer: (params: ICellRendererParams) => {
                const row = params.data;
                if (!row || row.lineStatus === 'cancelled') return null;

                // Access dynamic values via ref for latest state
                const { allocatingLines, onAllocate, onUnallocate } = handlersRef.current;

                const hasStock = row.skuStock >= row.qty;
                const isAllocated =
                    row.lineStatus === 'allocated' ||
                    row.lineStatus === 'picked' ||
                    row.lineStatus === 'packed';
                const isPending = row.lineStatus === 'pending';

                // Allow allocation for any pending line with stock (including customized)
                const canAllocate = isPending && hasStock;
                const isToggling = allocatingLines.has(row.lineId);

                if (isAllocated) {
                    return (
                        <button
                            onClick={(e) => {
                                e.stopPropagation();
                                if (row.lineStatus === 'allocated') onUnallocate(row.lineId);
                            }}
                            disabled={isToggling || row.lineStatus !== 'allocated'}
                            className={`w-5 h-5 rounded border-2 flex items-center justify-center mx-auto transition-all ${row.lineStatus === 'allocated'
                                ? 'bg-purple-500 border-purple-500 text-white hover:bg-purple-600 shadow-sm'
                                : 'bg-purple-200 border-purple-200 text-purple-600'
                                }`}
                            title={row.lineStatus === 'allocated' ? 'Click to unallocate' : `Status: ${row.lineStatus}`}
                        >
                            <Check size={12} strokeWidth={3} />
                        </button>
                    );
                }

                // Show checkbox - active if can allocate, inactive otherwise
                return (
                    <button
                        onClick={(e) => {
                            e.stopPropagation();
                            if (canAllocate) onAllocate(row.lineId);
                        }}
                        disabled={isToggling || !canAllocate}
                        className={`w-5 h-5 rounded border-2 flex items-center justify-center mx-auto transition-all ${canAllocate
                            ? 'border-purple-400 bg-white hover:bg-purple-100 hover:border-purple-500 cursor-pointer shadow-sm'
                            : 'border-gray-200 bg-gray-100 cursor-not-allowed opacity-40'
                            }`}
                        title={canAllocate ? 'Click to allocate' : 'No stock available'}
                    >
                        {isToggling ? <span className="animate-spin text-xs">·</span> : null}
                    </button>
                );
            },
            cellClass: 'text-center',
        },

        // Production
        {
            colId: 'production',
            headerName: getHeaderName('production'),
            width: 90,
            cellRenderer: (params: ICellRendererParams) => {
                const row = params.data;
                if (!row) return null;

                // Access dynamic values via ref for latest state
                const { onCreateBatch, onUpdateBatch, onDeleteBatch } = handlersRef.current;

                const hasStock = row.skuStock >= row.qty;
                const allLinesAllocated = row.order?.orderLines?.every(
                    (line: any) =>
                        line.lineStatus === 'allocated' ||
                        line.lineStatus === 'picked' ||
                        line.lineStatus === 'packed'
                );
                const isAllocated =
                    row.lineStatus === 'allocated' ||
                    row.lineStatus === 'picked' ||
                    row.lineStatus === 'packed';

                // For customized lines, always show production (must produce custom items)
                // The condition is: pending + (has batch OR no stock OR is customized)
                if (row.lineStatus === 'pending' && (row.productionBatchId || !hasStock || row.isCustomized)) {
                    return (
                        <ProductionDatePopover
                            currentDate={row.productionDate}
                            isLocked={isDateLocked}
                            hasExistingBatch={!!row.productionBatchId}
                            onSelectDate={(date) => {
                                if (row.productionBatchId) {
                                    // Update existing batch
                                    onUpdateBatch(row.productionBatchId, { batchDate: date });
                                } else {
                                    // Create new batch
                                    onCreateBatch({
                                        skuId: row.skuId,
                                        qtyPlanned: row.qty,
                                        priority: 'order_fulfillment',
                                        sourceOrderLineId: row.lineId,
                                        batchDate: date,
                                        notes: `For ${row.orderNumber}`,
                                    });
                                }
                            }}
                            onClear={() => {
                                if (row.productionBatchId) {
                                    onDeleteBatch(row.productionBatchId);
                                }
                            }}
                        />
                    );
                } else if (allLinesAllocated) {
                    return <span className="text-green-700 font-medium text-xs">ready</span>;
                } else if (isAllocated) {
                    return <span className="text-green-600 text-xs">alloc</span>;
                } else if (hasStock) {
                    return <span className="text-gray-300">-</span>;
                }
                return null;
            },
        },

        // Notes (editable)
        {
            colId: 'notes',
            headerName: getHeaderName('notes'),
            width: 120,
            editable: (params: EditableCallbackParams) => !!params.data?.lineId,
            valueGetter: (params: ValueGetterParams) => params.data?.lineNotes || '',
            valueSetter: (params: ValueSetterParams) => {
                if (params.data?.lineId) {
                    handlersRef.current.onUpdateLineNotes(params.data.lineId, params.newValue || '');
                }
                return true;
            },
            cellClass: (params: CellClassParams) => {
                return params.data?.lineNotes
                    ? 'text-xs text-yellow-700 bg-yellow-50'
                    : 'text-xs text-gray-400';
            },
            cellRenderer: (params: ICellRendererParams) => {
                const row = params.data;
                if (!row?.lineId) return null;
                const notes = row.lineNotes || '';
                if (!notes)
                    return <span className="text-gray-300">—</span>;
                return (
                    <span title={notes}>
                        {notes.length > 15 ? notes.substring(0, 15) + '...' : notes}
                    </span>
                );
            },
        },

        // Pick
        {
            colId: 'pick',
            headerName: getHeaderName('pick'),
            width: 35,
            cellRenderer: (params: ICellRendererParams) => {
                const row = params.data;
                if (!row || row.lineStatus === 'cancelled') return null;

                // Access dynamic values via ref for latest state
                const { allocatingLines, onPick, onUnpick } = handlersRef.current;

                const isToggling = allocatingLines.has(row.lineId);
                const canPick = row.lineStatus === 'allocated';
                // Include shipped in picked state (it must have been picked)
                const isPicked = ['picked', 'packed', 'shipped'].includes(row.lineStatus);

                if (isPicked) {
                    return (
                        <button
                            onClick={(e) => {
                                e.stopPropagation();
                                if (row.lineStatus === 'picked') onUnpick(row.lineId);
                            }}
                            disabled={isToggling || row.lineStatus !== 'picked'}
                            className={`w-5 h-5 rounded border-2 flex items-center justify-center mx-auto transition-all ${row.lineStatus === 'picked'
                                ? 'bg-teal-500 border-teal-500 text-white hover:bg-teal-600 shadow-sm'
                                : 'bg-teal-200 border-teal-200 text-teal-600'
                                }`}
                            title={row.lineStatus === 'picked' ? 'Click to unpick' : row.lineStatus === 'shipped' ? 'Shipped' : 'Packed'}
                        >
                            <Check size={12} strokeWidth={3} />
                        </button>
                    );
                }

                // Show checkbox - active if allocated, inactive otherwise
                return (
                    <button
                        onClick={(e) => {
                            e.stopPropagation();
                            if (canPick) onPick(row.lineId);
                        }}
                        disabled={isToggling || !canPick}
                        className={`w-5 h-5 rounded border-2 flex items-center justify-center mx-auto transition-all ${canPick
                            ? 'border-teal-400 bg-white hover:bg-teal-100 hover:border-teal-500 cursor-pointer shadow-sm'
                            : 'border-gray-200 bg-gray-100 cursor-not-allowed opacity-40'
                            }`}
                        title={canPick ? 'Click to pick' : 'Not allocated yet'}
                    >
                        {isToggling ? <span className="animate-spin text-xs">·</span> : null}
                    </button>
                );
            },
            cellClass: 'text-center',
        },

        // Pack
        {
            colId: 'pack',
            headerName: getHeaderName('pack'),
            width: 35,
            cellRenderer: (params: ICellRendererParams) => {
                const row = params.data;
                if (!row || row.lineStatus === 'cancelled') return null;

                // Access dynamic values via ref for latest state
                const { allocatingLines, onPack, onUnpack } = handlersRef.current;

                const isToggling = allocatingLines.has(row.lineId);
                const canPack = row.lineStatus === 'picked';
                // Include shipped in packed state (it must have been packed)
                const isPacked = ['packed', 'shipped'].includes(row.lineStatus);

                if (isPacked) {
                    const isShipped = row.lineStatus === 'shipped';
                    return (
                        <button
                            onClick={(e) => {
                                e.stopPropagation();
                                if (!isShipped) onUnpack(row.lineId);
                            }}
                            disabled={isToggling || isShipped}
                            className={`w-5 h-5 rounded border-2 flex items-center justify-center mx-auto transition-all ${
                                isShipped
                                    ? 'bg-blue-200 border-blue-200 text-blue-600 cursor-not-allowed'
                                    : 'bg-blue-500 border-blue-500 text-white hover:bg-blue-600 shadow-sm'
                            }`}
                            title={isShipped ? 'Already shipped' : 'Click to unpack'}
                        >
                            <Check size={12} strokeWidth={3} />
                        </button>
                    );
                }

                // Show checkbox - active if picked, inactive otherwise
                return (
                    <button
                        onClick={(e) => {
                            e.stopPropagation();
                            if (canPack) onPack(row.lineId);
                        }}
                        disabled={isToggling || !canPack}
                        className={`w-5 h-5 rounded border-2 flex items-center justify-center mx-auto transition-all ${canPack
                            ? 'border-blue-400 bg-white hover:bg-blue-100 hover:border-blue-500 cursor-pointer shadow-sm'
                            : 'border-gray-200 bg-gray-100 cursor-not-allowed opacity-40'
                            }`}
                        title={canPack ? 'Click to pack' : 'Not picked yet'}
                    >
                        {isToggling ? <span className="animate-spin text-xs">·</span> : null}
                    </button>
                );
            },
            cellClass: 'text-center',
        },

        // Ship
        {
            colId: 'ship',
            headerName: getHeaderName('ship'),
            width: 35,
            cellRenderer: (params: ICellRendererParams) => {
                const row = params.data;
                if (!row || row.lineStatus === 'cancelled') return null;

                // Access dynamic values via ref for latest state
                const { allocatingLines, onMarkShippedLine, onUnmarkShippedLine, isAdmin, onForceShipOrder } = handlersRef.current;

                const isPacked = row.lineStatus === 'packed';
                const isShipped = row.lineStatus === 'shipped';
                const isToggling = allocatingLines.has(row.lineId);

                // Already shipped - show green filled checkbox (can unship)
                if (isShipped) {
                    return (
                        <button
                            onClick={(e) => {
                                e.stopPropagation();
                                if (isToggling) return;
                                onUnmarkShippedLine(row.lineId);
                            }}
                            disabled={isToggling}
                            className="w-5 h-5 rounded border-2 bg-green-500 border-green-500 text-white flex items-center justify-center mx-auto shadow-sm hover:bg-green-600 cursor-pointer disabled:opacity-50"
                            title="Click to unship"
                        >
                            {isToggling ? <span className="animate-spin text-xs">·</span> : <Check size={12} strokeWidth={3} />}
                        </button>
                    );
                }

                // Packed - show empty checkbox (can ship)
                // Clicking will trigger ship with Shopify AWB or prompt for AWB
                if (isPacked) {
                    const shopifyAwb = row.shopifyAwb || row.awbNumber;
                    return (
                        <button
                            onClick={(e) => {
                                e.stopPropagation();
                                if (isToggling) return;
                                if (shopifyAwb) {
                                    // Has AWB - ship directly
                                    onMarkShippedLine(row.lineId, { awbNumber: shopifyAwb, courier: row.courier || 'Unknown' });
                                } else {
                                    // No AWB - prompt for it
                                    const awb = prompt('AWB Number (required):');
                                    if (!awb?.trim()) return;
                                    const courier = prompt('Courier:') || 'Unknown';
                                    onMarkShippedLine(row.lineId, { awbNumber: awb.trim(), courier });
                                }
                            }}
                            disabled={isToggling}
                            className="w-5 h-5 rounded border-2 border-green-400 bg-white hover:bg-green-100 hover:border-green-500 flex items-center justify-center mx-auto cursor-pointer shadow-sm disabled:opacity-50"
                            title={shopifyAwb ? `Ship with AWB: ${shopifyAwb}` : 'Click to ship (will prompt for AWB)'}
                        >
                            {isToggling ? <span className="animate-spin text-xs">·</span> : null}
                        </button>
                    );
                }

                // Admin can force ship any line
                if (isAdmin && onForceShipOrder) {
                    return (
                        <button
                            onClick={(e) => {
                                e.stopPropagation();
                                const awbNumber = prompt('AWB Number (required):');
                                if (!awbNumber?.trim()) return;
                                const courier = prompt('Courier (required):');
                                if (!courier?.trim()) return;
                                if (confirm(`Force ship this order?\n\nThis will mark ALL lines as shipped WITHOUT inventory deduction.\nAWB: ${awbNumber}\nCourier: ${courier}`)) {
                                    onForceShipOrder(row.orderId, { awbNumber: awbNumber.trim(), courier: courier.trim() });
                                }
                            }}
                            className="w-5 h-5 rounded border-2 border-amber-400 bg-amber-50 hover:bg-amber-100 hover:border-amber-500 flex items-center justify-center mx-auto cursor-pointer shadow-sm"
                            title="Admin: Force ship (no inventory)"
                        />
                    );
                }

                // Not packed yet - show disabled checkbox
                return (
                    <div
                        className="w-5 h-5 rounded border-2 border-gray-200 bg-gray-100 flex items-center justify-center mx-auto opacity-40"
                        title="Pack first"
                    />
                );
            },
            cellClass: 'text-center',
        },

        // Cancel Line
        {
            colId: 'cancelLine',
            headerName: getHeaderName('cancelLine'),
            width: 35,
            cellRenderer: (params: ICellRendererParams) => {
                const row = params.data;
                if (!row || !row.lineId) return null;

                // Access dynamic values via ref for latest state
                const { allocatingLines, onCancelLine, onUncancelLine } = handlersRef.current;

                const isCancelled = row.lineStatus === 'cancelled';
                const isToggling = allocatingLines.has(row.lineId);

                // Cancelled - show red X (can restore)
                if (isCancelled) {
                    return (
                        <button
                            onClick={(e) => {
                                e.stopPropagation();
                                onUncancelLine(row.lineId);
                            }}
                            disabled={isToggling}
                            className="w-5 h-5 rounded border-2 bg-red-500 border-red-500 text-white flex items-center justify-center mx-auto hover:bg-red-600 hover:border-red-600 shadow-sm disabled:opacity-50"
                            title="Click to restore line"
                        >
                            {isToggling ? <span className="animate-spin text-xs">·</span> : <X size={12} strokeWidth={3} />}
                        </button>
                    );
                }

                // Not cancelled - show empty checkbox (can cancel)
                return (
                    <button
                        onClick={(e) => {
                            e.stopPropagation();
                            onCancelLine(row.lineId);
                        }}
                        disabled={isToggling}
                        className="w-5 h-5 rounded border-2 border-red-300 bg-white hover:bg-red-50 hover:border-red-400 flex items-center justify-center mx-auto cursor-pointer shadow-sm disabled:opacity-50"
                        title="Click to cancel line"
                    >
                        {isToggling ? <span className="animate-spin text-xs">·</span> : null}
                    </button>
                );
            },
            cellClass: 'text-center',
        },
    ];
}
