import { useState } from 'react';
import {
    Package, Truck, Check,
    PackageCheck, DollarSign, XCircle,
    MessageSquare, Pencil, Save, CheckCircle, ArrowRight,
    Clock, ExternalLink, AlertTriangle,
} from 'lucide-react';
import type { ReturnActionQueueItem as ServerReturnActionQueueItem } from '@coh/shared/schemas/returns';
import { getStatusBadge, getResolutionBadge, conditionOptions } from '../types';
import { AwbTrackingCell } from '../../../components/AwbTrackingCell';
import { getOptimizedImageUrl } from '../../../utils/imageOptimization';

export interface ActionQueueTabProps {
    items: ServerReturnActionQueueItem[];
    loading: boolean;
    onSchedulePickup: (lineId: string) => void;
    onReceive: (lineId: string, condition: 'good' | 'damaged' | 'defective' | 'wrong_item' | 'used') => void;
    onProcessRefund: (lineId: string, item: ServerReturnActionQueueItem) => void;
    onCreateExchange: (lineId: string) => void;
    onComplete: (lineId: string) => void;
    onCancel: (lineId: string) => void;
    onUpdateNotes: (lineId: string, notes: string) => void;
}

/**
 * Group items by batch number for display
 */
function groupByBatch(items: ServerReturnActionQueueItem[]): Map<string, ServerReturnActionQueueItem[]> {
    const groups = new Map<string, ServerReturnActionQueueItem[]>();

    for (const item of items) {
        // Use batch number if available, otherwise use order number as fallback
        const key = item.returnBatchNumber || `single-${item.id}`;
        const existing = groups.get(key) || [];
        existing.push(item);
        groups.set(key, existing);
    }

    return groups;
}

export function ActionQueueTab({
    items,
    loading,
    onSchedulePickup,
    onReceive,
    onProcessRefund,
    onCreateExchange,
    onComplete,
    onCancel,
    onUpdateNotes,
}: ActionQueueTabProps) {
    const [receiveConditionMap, setReceiveConditionMap] = useState<Record<string, string>>({});
    const [editingNotesId, setEditingNotesId] = useState<string | null>(null);
    const [editingNotesValue, setEditingNotesValue] = useState('');

    const startEditNotes = (lineId: string, currentNotes: string | null) => {
        setEditingNotesId(lineId);
        setEditingNotesValue(currentNotes || '');
    };

    const saveNotes = (lineId: string) => {
        onUpdateNotes(lineId, editingNotesValue);
        setEditingNotesId(null);
        setEditingNotesValue('');
    };

    const cancelEditNotes = () => {
        setEditingNotesId(null);
        setEditingNotesValue('');
    };

    if (loading) {
        return <div className="text-center py-12">Loading action queue...</div>;
    }

    if (items.length === 0) {
        return (
            <div className="text-center py-12 text-gray-500">
                <CheckCircle size={48} className="mx-auto mb-4 text-green-500" />
                <p className="text-lg font-medium">All caught up!</p>
                <p className="text-sm">No pending actions at the moment.</p>
            </div>
        );
    }

    // Group items by batch number
    const batches = groupByBatch(items);

    return (
        <div className="space-y-4">
            {Array.from(batches.entries()).map(([batchKey, batchItems]) => {
                const firstItem = batchItems[0];
                const isBatch = batchItems.length > 1;
                const batchNumber = firstItem.returnBatchNumber;

                // Check if all items in batch need pickup (for batch-level button)
                const allNeedPickup = batchItems.every(i => i.actionNeeded === 'schedule_pickup');

                return (
                    <div key={batchKey} className="border border-gray-200 rounded-lg bg-white overflow-hidden shadow-sm">
                        {/* Batch Header - always show for batch items */}
                        {(isBatch || batchNumber) && (
                            <div className="px-4 py-3 bg-gradient-to-r from-gray-50 to-white border-b border-gray-200">
                                <div className="flex items-center justify-between">
                                    <div className="flex items-center gap-3">
                                        <span className="font-semibold text-gray-800">
                                            {batchNumber ? `Batch ${batchNumber}` : firstItem.orderNumber}
                                        </span>
                                        <span className="px-2 py-0.5 bg-gray-100 text-gray-600 text-xs rounded-full">
                                            {batchItems.length} item{batchItems.length > 1 ? 's' : ''}
                                        </span>
                                        <span className="text-sm text-gray-500">
                                            {firstItem.customerName}
                                        </span>
                                    </div>
                                    {/* Batch-level action button */}
                                    {allNeedPickup && (
                                        <button
                                            onClick={() => onSchedulePickup(firstItem.id)}
                                            className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 flex items-center gap-2 text-sm font-medium shadow-sm"
                                        >
                                            <Truck size={16} />
                                            Schedule Pickup{isBatch ? ' for Batch' : ''}
                                        </button>
                                    )}
                                </div>
                            </div>
                        )}

                        {/* Items in batch */}
                        <div className={isBatch ? 'divide-y divide-gray-100' : ''}>
                            {batchItems.map((item) => (
                                <div key={item.id} className="p-4">
                                    {/* Main row - Product info and action */}
                                    <div className="flex items-start gap-4">
                                        {/* Product Image */}
                                        <div className="w-14 h-14 bg-gray-100 rounded-lg flex-shrink-0 overflow-hidden">
                                            {item.imageUrl ? (
                                                <img
                                                    src={getOptimizedImageUrl(item.imageUrl, 'md') || item.imageUrl}
                                                    alt={item.productName || ''}
                                                    className="w-full h-full object-cover"
                                                    loading="lazy"
                                                />
                                            ) : (
                                                <div className="w-full h-full flex items-center justify-center">
                                                    <Package size={20} className="text-gray-400" />
                                                </div>
                                            )}
                                        </div>

                                        {/* Product Details */}
                                        <div className="flex-1 min-w-0">
                                            {/* Status badges row */}
                                            <div className="flex items-center gap-2 mb-1 flex-wrap">
                                                <span className={`px-2 py-0.5 text-xs font-medium rounded ${getStatusBadge(item.returnStatus)}`}>
                                                    {item.returnStatus?.replace(/_/g, ' ')}
                                                </span>
                                                <span className={`px-2 py-0.5 text-xs font-medium rounded ${getResolutionBadge(item.returnResolution).color}`}>
                                                    {getResolutionBadge(item.returnResolution).label}
                                                </span>
                                                {item.returnQcResult && (
                                                    <span className={`px-2 py-0.5 text-xs font-medium rounded ${
                                                        item.returnQcResult === 'approved'
                                                            ? 'bg-green-100 text-green-700'
                                                            : 'bg-red-100 text-red-700'
                                                    }`}>
                                                        QC: {item.returnQcResult === 'approved' ? 'Approved' : 'Written Off'}
                                                    </span>
                                                )}
                                                {item.returnQcResult === 'written_off' && item.returnResolution === 'exchange' && (
                                                    <span className="px-2 py-0.5 text-xs bg-orange-100 text-orange-700 rounded flex items-center gap-1">
                                                        <AlertTriangle size={10} />
                                                        QC failed — review exchange
                                                    </span>
                                                )}
                                                {item.returnExchangeOrderId && (
                                                    <a
                                                        href={`/orders?modal=view&orderId=${item.returnExchangeOrderId}`}
                                                        className="px-2 py-0.5 text-xs bg-blue-100 text-blue-700 rounded flex items-center gap-1 hover:bg-blue-200"
                                                    >
                                                        <ExternalLink size={10} />
                                                        Exchange: {item.returnExchangeOrderNumber || 'View'}
                                                    </a>
                                                )}
                                                {item.returnAwbNumber && (
                                                    <AwbTrackingCell
                                                        awbNumber={item.returnAwbNumber}
                                                        courier={item.returnCourier}
                                                    />
                                                )}
                                            </div>

                                            {/* Product name */}
                                            <div className="text-sm font-medium text-gray-800 truncate">
                                                {item.productName} - {item.colorName} - {item.size}
                                            </div>

                                            {/* SKU and qty */}
                                            <div className="text-xs text-gray-500 mt-0.5">
                                                {item.skuCode} • Qty: {item.returnQty}
                                                {item.returnReasonCategory && (
                                                    <> • {item.returnReasonCategory.replace(/_/g, ' ')}</>
                                                )}
                                            </div>

                                            {/* Time since request */}
                                            <div className="text-xs text-gray-400 mt-1">
                                                {item.daysSinceRequest === 0 ? 'Requested today' : `Requested ${item.daysSinceRequest}d ago`}
                                            </div>
                                        </div>

                                        {/* Action Area - Compact */}
                                        <div className="flex items-center gap-2 flex-shrink-0">
                                            {/* Receive action - inline select + button */}
                                            {item.actionNeeded === 'receive' && (
                                                <>
                                                    <select
                                                        value={receiveConditionMap[item.id] || ''}
                                                        onChange={(e) =>
                                                            setReceiveConditionMap({ ...receiveConditionMap, [item.id]: e.target.value })
                                                        }
                                                        className="px-2 py-1.5 border border-gray-300 rounded-lg text-sm bg-white min-w-[130px]"
                                                    >
                                                        <option value="">Condition...</option>
                                                        {conditionOptions.map((c) => (
                                                            <option key={c.value} value={c.value}>
                                                                {c.label}
                                                            </option>
                                                        ))}
                                                    </select>
                                                    <button
                                                        onClick={() => {
                                                            const condition = receiveConditionMap[item.id] as 'good' | 'damaged' | 'defective' | 'wrong_item' | 'used' | undefined;
                                                            if (condition) {
                                                                onReceive(item.id, condition);
                                                            } else {
                                                                alert('Please select a condition');
                                                            }
                                                        }}
                                                        disabled={!receiveConditionMap[item.id]}
                                                        className="px-3 py-1.5 bg-green-600 text-white rounded-lg hover:bg-green-700 disabled:bg-gray-300 disabled:cursor-not-allowed flex items-center gap-1.5 text-sm font-medium"
                                                    >
                                                        <PackageCheck size={14} />
                                                        Receive
                                                    </button>
                                                </>
                                            )}

                                            {/* Schedule pickup - show if this item needs it (batch header button is just a convenience) */}
                                            {item.actionNeeded === 'schedule_pickup' && (
                                                <button
                                                    onClick={() => onSchedulePickup(item.id)}
                                                    className="px-3 py-1.5 bg-blue-600 text-white rounded-lg hover:bg-blue-700 flex items-center gap-1.5 text-sm font-medium"
                                                >
                                                    <Truck size={14} />
                                                    Schedule Pickup
                                                </button>
                                            )}

                                            {item.actionNeeded === 'process_refund' && (
                                                <button
                                                    onClick={() => onProcessRefund(item.id, item)}
                                                    className="px-3 py-1.5 bg-purple-600 text-white rounded-lg hover:bg-purple-700 flex items-center gap-1.5 text-sm font-medium"
                                                >
                                                    <DollarSign size={14} />
                                                    Process Refund
                                                </button>
                                            )}

                                            {item.actionNeeded === 'awaiting_qc' && (
                                                <span className="px-3 py-1.5 bg-amber-50 text-amber-700 rounded-lg flex items-center gap-1.5 text-sm font-medium border border-amber-200">
                                                    <Clock size={14} />
                                                    Awaiting QC
                                                </span>
                                            )}

                                            {item.actionNeeded === 'create_exchange' && (
                                                <button
                                                    onClick={() => onCreateExchange(item.id)}
                                                    className="px-3 py-1.5 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 flex items-center gap-1.5 text-sm font-medium"
                                                >
                                                    <ArrowRight size={14} />
                                                    Create Exchange
                                                </button>
                                            )}

                                            {item.actionNeeded === 'complete' && (
                                                <button
                                                    onClick={() => onComplete(item.id)}
                                                    className="px-3 py-1.5 bg-gray-700 text-white rounded-lg hover:bg-gray-800 flex items-center gap-1.5 text-sm font-medium"
                                                >
                                                    <Check size={14} />
                                                    Complete
                                                </button>
                                            )}

                                            {/* Cancel - secondary button */}
                                            <button
                                                onClick={() => onCancel(item.id)}
                                                className="px-2 py-1.5 text-red-600 hover:bg-red-50 rounded-lg text-sm"
                                                title="Cancel return"
                                            >
                                                <XCircle size={16} />
                                            </button>
                                        </div>
                                    </div>

                                    {/* Notes Section - Compact */}
                                    <div className="mt-3 pt-2 border-t border-gray-50">
                                        {editingNotesId === item.id ? (
                                            <div className="flex gap-2 items-start">
                                                <MessageSquare size={14} className="text-gray-400 mt-2 shrink-0" />
                                                <textarea
                                                    value={editingNotesValue}
                                                    onChange={(e) => setEditingNotesValue(e.target.value)}
                                                    placeholder="Add notes..."
                                                    className="flex-1 px-2 py-1.5 border border-gray-200 rounded text-sm resize-none focus:outline-none focus:ring-1 focus:ring-blue-500"
                                                    rows={2}
                                                    autoFocus
                                                />
                                                <button
                                                    onClick={() => saveNotes(item.id)}
                                                    className="px-2 py-1 bg-blue-600 text-white rounded text-xs hover:bg-blue-700"
                                                >
                                                    <Save size={12} />
                                                </button>
                                                <button
                                                    onClick={cancelEditNotes}
                                                    className="px-2 py-1 text-gray-500 hover:text-gray-700 text-xs"
                                                >
                                                    ✕
                                                </button>
                                            </div>
                                        ) : (
                                            <div className="flex items-center gap-2 text-xs">
                                                <MessageSquare size={12} className="text-gray-400 shrink-0" />
                                                {item.returnNotes ? (
                                                    <span className="text-gray-600 flex-1 truncate">{item.returnNotes}</span>
                                                ) : (
                                                    <span className="text-gray-400 italic flex-1">No notes</span>
                                                )}
                                                <button
                                                    onClick={() => startEditNotes(item.id, item.returnNotes)}
                                                    className="text-gray-400 hover:text-blue-600 p-0.5"
                                                    title="Edit notes"
                                                >
                                                    <Pencil size={12} />
                                                </button>
                                            </div>
                                        )}
                                    </div>
                                </div>
                            ))}
                        </div>
                    </div>
                );
            })}
        </div>
    );
}
