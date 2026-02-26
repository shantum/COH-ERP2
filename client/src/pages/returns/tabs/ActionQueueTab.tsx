import { useState, useMemo } from 'react';
import {
    Package, Truck, Check,
    PackageCheck, DollarSign,
    MessageSquare, Pencil, CheckCircle, ArrowRight,
    ExternalLink, AlertTriangle, ListTodo,
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

// Action filter options with labels and colors
const ACTION_FILTERS = [
    { value: 'all', label: 'All', icon: null },
    { value: 'schedule_pickup', label: 'Pickup', icon: Truck },
    { value: 'receive', label: 'Receive', icon: PackageCheck },
    { value: 'process_refund', label: 'Refund', icon: DollarSign },
    { value: 'create_exchange', label: 'Exchange', icon: ArrowRight },
    { value: 'complete', label: 'Complete', icon: Check },
] as const;

type ActionFilter = typeof ACTION_FILTERS[number]['value'];

/**
 * Group items by order number + AWB (same shipment = same card).
 * Falls back to order number alone, then item id for orphans.
 */
function groupByBatch(items: ServerReturnActionQueueItem[]): Map<string, ServerReturnActionQueueItem[]> {
    const groups = new Map<string, ServerReturnActionQueueItem[]>();

    for (const item of items) {
        const key = item.orderNumber
            ? `${item.orderNumber}:${item.returnAwbNumber || 'no-awb'}`
            : `single-${item.id}`;
        const existing = groups.get(key) || [];
        existing.push(item);
        groups.set(key, existing);
    }

    return groups;
}

/**
 * Compute summary stats from action queue items
 */
function computeStats(items: ServerReturnActionQueueItem[]) {
    const byAction: Record<string, number> = {};
    let oldest = 0;
    let todayCount = 0;

    for (const item of items) {
        byAction[item.actionNeeded] = (byAction[item.actionNeeded] || 0) + 1;
        if (item.daysSinceRequest > oldest) oldest = item.daysSinceRequest;
        if (item.daysSinceRequest === 0) todayCount++;
    }

    return { byAction, oldest, todayCount, total: items.length };
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
    const [actionFilter, setActionFilter] = useState<ActionFilter>('all');

    const stats = useMemo(() => computeStats(items), [items]);

    const filteredItems = useMemo(() => {
        if (actionFilter === 'all') return items;
        return items.filter(i => i.actionNeeded === actionFilter);
    }, [items, actionFilter]);

    const batches = useMemo(() => groupByBatch(filteredItems), [filteredItems]);

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

    return (
        <div className="space-y-4">
            {/* Summary Stats */}
            <div className="grid grid-cols-4 gap-3">
                <div className="relative overflow-hidden rounded-xl bg-gradient-to-br from-gray-900 to-gray-700 px-4 py-3.5 text-white">
                    <div className="flex items-center justify-between">
                        <div>
                            <div className="text-xs font-medium text-gray-300 uppercase tracking-wide">Pending</div>
                            <div className="text-3xl font-extrabold mt-0.5 tabular-nums">{stats.total}</div>
                        </div>
                        <ListTodo size={28} className="text-white/20" />
                    </div>
                </div>
                <div className="relative overflow-hidden rounded-xl bg-gradient-to-br from-blue-500 to-blue-600 px-4 py-3.5 text-white">
                    <div className="flex items-center justify-between">
                        <div>
                            <div className="text-xs font-medium text-blue-100 uppercase tracking-wide">Today</div>
                            <div className="text-3xl font-extrabold mt-0.5 tabular-nums">{stats.todayCount}</div>
                        </div>
                        <Package size={28} className="text-white/20" />
                    </div>
                </div>
                <div className={`relative overflow-hidden rounded-xl px-4 py-3.5 text-white ${
                    stats.oldest > 7
                        ? 'bg-gradient-to-br from-red-500 to-red-600'
                        : stats.oldest > 3
                            ? 'bg-gradient-to-br from-amber-500 to-amber-600'
                            : 'bg-gradient-to-br from-emerald-500 to-emerald-600'
                }`}>
                    <div className="flex items-center justify-between">
                        <div>
                            <div className={`text-xs font-medium uppercase tracking-wide ${
                                stats.oldest > 7 ? 'text-red-100' : stats.oldest > 3 ? 'text-amber-100' : 'text-emerald-100'
                            }`}>Oldest</div>
                            <div className="text-3xl font-extrabold mt-0.5 tabular-nums">{stats.oldest}<span className="text-lg font-bold ml-0.5">d</span></div>
                        </div>
                        <AlertTriangle size={28} className="text-white/20" />
                    </div>
                </div>
                <div className="relative overflow-hidden rounded-xl bg-gradient-to-br from-violet-500 to-purple-600 px-4 py-3.5 text-white">
                    <div className="flex items-center justify-between">
                        <div>
                            <div className="text-xs font-medium text-violet-100 uppercase tracking-wide">To Receive</div>
                            <div className="text-3xl font-extrabold mt-0.5 tabular-nums">{stats.byAction['receive'] || 0}</div>
                        </div>
                        <PackageCheck size={28} className="text-white/20" />
                    </div>
                </div>
            </div>

            {/* Action Filter Tabs */}
            <div className="flex items-center gap-1.5 overflow-x-auto pb-1">
                {ACTION_FILTERS.map(({ value, label, icon: Icon }) => {
                    const count = value === 'all' ? items.length : (stats.byAction[value] || 0);
                    if (value !== 'all' && count === 0) return null;
                    const isActive = actionFilter === value;
                    return (
                        <button
                            key={value}
                            onClick={() => setActionFilter(value)}
                            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full text-sm font-medium whitespace-nowrap transition-colors ${
                                isActive
                                    ? 'bg-gray-900 text-white'
                                    : 'bg-white border border-gray-200 text-gray-600 hover:bg-gray-50'
                            }`}
                        >
                            {Icon && <Icon size={14} />}
                            {label}
                            <span className={`text-xs ${isActive ? 'text-gray-300' : 'text-gray-400'}`}>
                                {count}
                            </span>
                        </button>
                    );
                })}
            </div>

            {/* Filtered empty state */}
            {filteredItems.length === 0 && (
                <div className="text-center py-8 text-gray-400 text-sm">
                    No items matching this filter.
                </div>
            )}

            {Array.from(batches.entries()).map(([batchKey, batchItems]) => {
                const firstItem = batchItems[0];
                const isBatch = batchItems.length > 1;
                const allNeedPickup = batchItems.every(i => i.actionNeeded === 'schedule_pickup');

                return (
                    <div key={batchKey} className="rounded-xl border border-gray-200 bg-white shadow-sm overflow-hidden">
                        {/* Order Header — always show */}
                        <div className="flex items-center justify-between px-5 py-2.5 border-b border-gray-100 bg-gray-50/60">
                            <div className="flex items-center gap-2.5 text-sm">
                                <span className="font-semibold text-gray-900">
                                    #{firstItem.orderNumber}
                                </span>
                                <span className="text-gray-400">·</span>
                                <span className="text-gray-500">{firstItem.customerName}</span>
                                {isBatch && (
                                    <>
                                        <span className="text-gray-400">·</span>
                                        <span className="text-gray-500">{batchItems.length} items</span>
                                    </>
                                )}
                            </div>
                            <div className="flex items-center gap-3">
                                {firstItem.returnAwbNumber && (
                                    <AwbTrackingCell
                                        awbNumber={firstItem.returnAwbNumber}
                                        courier={firstItem.returnCourier}
                                    />
                                )}
                                {allNeedPickup && (
                                    <button
                                        onClick={() => onSchedulePickup(firstItem.id)}
                                        className="px-3.5 py-1.5 bg-blue-600 text-white rounded-lg hover:bg-blue-700 flex items-center gap-2 text-xs font-semibold shadow-sm transition-colors"
                                    >
                                        <Truck size={14} />
                                        Schedule Pickup{isBatch ? ' All' : ''}
                                    </button>
                                )}
                            </div>
                        </div>

                        {/* Items */}
                        <div className={isBatch ? 'divide-y divide-gray-100' : ''}>
                            {batchItems.map((item) => {
                                const ageBadge = item.daysSinceRequest > 7
                                    ? 'bg-red-50 text-red-600 border-red-100'
                                    : item.daysSinceRequest > 3
                                        ? 'bg-amber-50 text-amber-600 border-amber-100'
                                        : 'bg-gray-50 text-gray-500 border-gray-100';

                                return (
                                    <div key={item.id} className="group px-5 py-4 hover:bg-gray-50/40 transition-colors">
                                        <div className="flex gap-4">
                                            {/* Left: Image */}
                                            <div className="w-16 h-16 rounded-xl bg-gray-100 flex-shrink-0 overflow-hidden ring-1 ring-gray-200/60">
                                                {item.imageUrl ? (
                                                    <img
                                                        src={getOptimizedImageUrl(item.imageUrl, 'md') || item.imageUrl}
                                                        alt={item.productName || ''}
                                                        className="w-full h-full object-cover"
                                                        loading="lazy"
                                                    />
                                                ) : (
                                                    <div className="w-full h-full flex items-center justify-center">
                                                        <Package size={22} className="text-gray-300" />
                                                    </div>
                                                )}
                                            </div>

                                            {/* Center: Info */}
                                            <div className="flex-1 min-w-0">
                                                {/* Row 1: Product name + age */}
                                                <div className="flex items-start justify-between gap-3">
                                                    <h3 className="text-sm font-semibold text-gray-900 leading-snug">
                                                        {item.productName}
                                                        <span className="font-normal text-gray-400"> · </span>
                                                        <span className="font-medium text-gray-600">{item.colorName}</span>
                                                        <span className="font-normal text-gray-400"> · </span>
                                                        <span className="font-medium text-gray-600">{item.size}</span>
                                                    </h3>
                                                    <span className={`text-[11px] font-medium px-2 py-0.5 rounded-full border whitespace-nowrap flex-shrink-0 ${ageBadge}`}>
                                                        {item.daysSinceRequest === 0 ? 'Today' : `${item.daysSinceRequest}d ago`}
                                                    </span>
                                                </div>

                                                {/* Row 2: SKU · Qty · Reason */}
                                                <div className="text-xs text-gray-500 mt-0.5 flex items-center gap-1.5">
                                                    <span className="font-mono text-gray-400">{item.skuCode}</span>
                                                    <span className="text-gray-300">·</span>
                                                    <span>Qty {item.returnQty}</span>
                                                    {item.returnReasonCategory && (
                                                        <>
                                                            <span className="text-gray-300">·</span>
                                                            <span className="italic">{item.returnReasonCategory.replace(/_/g, ' ')}</span>
                                                        </>
                                                    )}
                                                </div>

                                                {/* Row 3: Badges */}
                                                <div className="flex items-center gap-1.5 mt-2 flex-wrap">
                                                    <span className={`px-2 py-0.5 text-[11px] font-semibold rounded-md ${getStatusBadge(item.returnStatus)}`}>
                                                        {item.returnStatus?.replace(/_/g, ' ')}
                                                    </span>
                                                    <span className={`px-2 py-0.5 text-[11px] font-semibold rounded-md ${getResolutionBadge(item.returnResolution).color}`}>
                                                        {getResolutionBadge(item.returnResolution).label}
                                                    </span>
                                                    {item.returnQcResult && (
                                                        <span className={`px-2 py-0.5 text-[11px] font-semibold rounded-md ${
                                                            item.returnQcResult === 'approved'
                                                                ? 'bg-green-100 text-green-700'
                                                                : 'bg-red-100 text-red-700'
                                                        }`}>
                                                            QC: {item.returnQcResult === 'approved' ? 'Pass' : 'Fail'}
                                                        </span>
                                                    )}
                                                    {item.returnQcResult === 'written_off' && item.returnResolution === 'exchange' && (
                                                        <span className="px-2 py-0.5 text-[11px] font-semibold rounded-md bg-orange-100 text-orange-700 flex items-center gap-1">
                                                            <AlertTriangle size={10} />
                                                            Review exchange
                                                        </span>
                                                    )}
                                                    {item.returnExchangeOrderId && (
                                                        <a
                                                            href={`/orders?modal=view&orderId=${item.returnExchangeOrderId}`}
                                                            className="px-2 py-0.5 text-[11px] font-semibold rounded-md bg-blue-50 text-blue-600 hover:bg-blue-100 flex items-center gap-1 transition-colors"
                                                        >
                                                            <ExternalLink size={10} />
                                                            {item.returnExchangeOrderNumber || 'Exchange'}
                                                        </a>
                                                    )}
                                                </div>

                                                {/* Notes (inline, only if present or editing) */}
                                                {editingNotesId === item.id ? (
                                                    <div className="flex gap-2 items-start mt-2">
                                                        <textarea
                                                            value={editingNotesValue}
                                                            onChange={(e) => setEditingNotesValue(e.target.value)}
                                                            placeholder="Add notes..."
                                                            className="flex-1 px-2.5 py-1.5 border border-gray-200 rounded-lg text-xs resize-none focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-300"
                                                            rows={2}
                                                            autoFocus
                                                        />
                                                        <button
                                                            onClick={() => saveNotes(item.id)}
                                                            className="px-2.5 py-1.5 bg-blue-600 text-white rounded-lg text-xs font-medium hover:bg-blue-700 transition-colors"
                                                        >
                                                            Save
                                                        </button>
                                                        <button
                                                            onClick={cancelEditNotes}
                                                            className="px-2 py-1.5 text-gray-400 hover:text-gray-600 text-xs"
                                                        >
                                                            Cancel
                                                        </button>
                                                    </div>
                                                ) : (
                                                    <div
                                                        className="mt-1.5 flex items-center gap-1.5 cursor-pointer group/notes"
                                                        onClick={() => startEditNotes(item.id, item.returnNotes)}
                                                    >
                                                        {item.returnNotes ? (
                                                            <>
                                                                <MessageSquare size={11} className="text-gray-400 shrink-0" />
                                                                <span className="text-xs text-gray-500 truncate">{item.returnNotes}</span>
                                                                <Pencil size={10} className="text-gray-300 group-hover/notes:text-blue-500 shrink-0 transition-colors" />
                                                            </>
                                                        ) : (
                                                            <span className="text-xs text-gray-300 group-hover/notes:text-blue-500 flex items-center gap-1 transition-colors">
                                                                <MessageSquare size={11} />
                                                                Add note
                                                            </span>
                                                        )}
                                                    </div>
                                                )}
                                            </div>

                                            {/* Right: Action */}
                                            <div className="flex flex-col items-end gap-2 flex-shrink-0 pt-0.5">
                                                {item.actionNeeded === 'receive' && (
                                                    <div className="flex items-center gap-2">
                                                        <select
                                                            value={receiveConditionMap[item.id] || ''}
                                                            onChange={(e) =>
                                                                setReceiveConditionMap({ ...receiveConditionMap, [item.id]: e.target.value })
                                                            }
                                                            className="h-9 px-2.5 border border-gray-200 rounded-lg text-sm bg-white focus:outline-none focus:ring-2 focus:ring-green-500/20 focus:border-green-300 min-w-[120px]"
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
                                                            className="h-9 px-4 bg-green-600 text-white rounded-lg hover:bg-green-700 disabled:bg-gray-200 disabled:text-gray-400 disabled:cursor-not-allowed flex items-center gap-1.5 text-sm font-semibold shadow-sm transition-colors"
                                                        >
                                                            <PackageCheck size={15} />
                                                            Receive
                                                        </button>
                                                    </div>
                                                )}

                                                {item.actionNeeded === 'schedule_pickup' && (
                                                    <button
                                                        onClick={() => onSchedulePickup(item.id)}
                                                        className="h-9 px-4 bg-blue-600 text-white rounded-lg hover:bg-blue-700 flex items-center gap-1.5 text-sm font-semibold shadow-sm transition-colors"
                                                    >
                                                        <Truck size={15} />
                                                        Schedule Pickup
                                                    </button>
                                                )}

                                                {item.actionNeeded === 'process_refund' && (
                                                    <button
                                                        onClick={() => onProcessRefund(item.id, item)}
                                                        className="h-9 px-4 bg-purple-600 text-white rounded-lg hover:bg-purple-700 flex items-center gap-1.5 text-sm font-semibold shadow-sm transition-colors"
                                                    >
                                                        <DollarSign size={15} />
                                                        Process Refund
                                                    </button>
                                                )}


                                                {item.actionNeeded === 'create_exchange' && (
                                                    <button
                                                        onClick={() => onCreateExchange(item.id)}
                                                        className="h-9 px-4 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 flex items-center gap-1.5 text-sm font-semibold shadow-sm transition-colors"
                                                    >
                                                        <ArrowRight size={15} />
                                                        Create Exchange
                                                    </button>
                                                )}

                                                {item.actionNeeded === 'complete' && (
                                                    <button
                                                        onClick={() => onComplete(item.id)}
                                                        className="h-9 px-4 bg-gray-800 text-white rounded-lg hover:bg-gray-900 flex items-center gap-1.5 text-sm font-semibold shadow-sm transition-colors"
                                                    >
                                                        <Check size={15} />
                                                        Complete
                                                    </button>
                                                )}

                                                <button
                                                    onClick={() => onCancel(item.id)}
                                                    className="text-xs text-gray-400 hover:text-red-500 transition-colors opacity-0 group-hover:opacity-100"
                                                    title="Cancel return"
                                                >
                                                    Cancel
                                                </button>
                                            </div>
                                        </div>
                                    </div>
                                );
                            })}
                        </div>
                    </div>
                );
            })}
        </div>
    );
}
