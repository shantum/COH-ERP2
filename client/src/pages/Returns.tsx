/**
 * Unified Returns Hub - Line-Level Returns System
 * Single page with 3 tabs: Action Queue, All Returns, Analytics
 *
 * Migrated to line-level returns (OrderLine.return* fields)
 * Replaces legacy ReturnRequest model
 */

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useServerFn } from '@tanstack/react-start';
import {
    getActiveLineReturns,
    getLineReturnActionQueue,
    getOrderForReturn,
    getReturnConfig,
    updateReturnSettings,
    type ReturnConfigResponse,
} from '../server/functions/returns';
import {
    initiateLineReturn,
    scheduleReturnPickup,
    receiveLineReturn,
    processLineReturnRefund,
    completeLineReturn,
    cancelLineReturn,
    createExchangeOrder,
    updateReturnNotes,
} from '../server/functions/returnsMutations';
import {
    processRepackingItem,
    type QueueItem as RepackingQueueItem,
} from '../server/functions/repacking';
import type {
    ActiveReturnLine as ServerActiveReturnLine,
    ReturnActionQueueItem as ServerReturnActionQueueItem,
    OrderForReturn,
} from '@coh/shared/schemas/returns';
import {
    RETURN_REASONS,
    RETURN_CONDITIONS,
    RETURN_RESOLUTIONS,
    toOptions,
    getLabel,
} from '@coh/shared/domain/returns';
import { useState } from 'react';
import {
    Plus, X, Search, Package, Truck, Check,
    PackageCheck, AlertCircle, CheckCircle,
    ArrowRight, DollarSign, XCircle, Settings,
    MessageSquare, Pencil, Save
} from 'lucide-react';
import { CustomerDetailModal } from '../components/orders/CustomerDetailModal';

// ============================================
// TYPES
// ============================================

// Re-export server types with client additions
interface ActiveReturnLine extends ServerActiveReturnLine {
    // Client-computed fields
    ageDays?: number;
}

// ============================================
// CONSTANTS & UI STYLING
// ============================================

// Use shared module for dropdown options (single source of truth)
const reasonOptions = toOptions(RETURN_REASONS);
const conditionOptions = toOptions(RETURN_CONDITIONS);
const resolutionOptions = toOptions(RETURN_RESOLUTIONS);

// UI-specific styling (keyed by shared values)
const RESOLUTION_COLORS: Record<string, string> = {
    refund: 'bg-red-100 text-red-800',
    exchange: 'bg-blue-100 text-blue-800',
    rejected: 'bg-gray-100 text-gray-800',
};

const WRITE_OFF_REASONS = [
    { value: 'damaged', label: 'Damaged - Not Repairable' },
    { value: 'defective', label: 'Manufacturing Defect' },
    { value: 'stained', label: 'Stained / Soiled' },
    { value: 'wrong_product', label: 'Wrong Product Received' },
    { value: 'destroyed', label: 'Destroyed / Unusable' },
    { value: 'other', label: 'Other' },
] as const;

type TabType = 'actions' | 'all' | 'analytics' | 'settings';

// ============================================
// HELPERS
// ============================================

const getStatusBadge = (status: string) => {
    const colors: Record<string, string> = {
        requested: 'bg-yellow-100 text-yellow-800',
        pickup_scheduled: 'bg-blue-100 text-blue-800',
        in_transit: 'bg-purple-100 text-purple-800',
        received: 'bg-green-100 text-green-800',
        complete: 'bg-gray-100 text-gray-800',
        cancelled: 'bg-red-100 text-red-800',
    };
    return colors[status] || 'bg-gray-100 text-gray-800';
};

const getResolutionBadge = (resolution: string | null) => {
    if (!resolution) return { label: 'Pending', color: 'bg-gray-100 text-gray-800' };
    return {
        label: getLabel(RETURN_RESOLUTIONS, resolution),
        color: RESOLUTION_COLORS[resolution] || 'bg-gray-100 text-gray-800',
    };
};

const computeAgeDays = (requestedAt: Date | string | null) => {
    if (!requestedAt) return 0;
    const date = new Date(requestedAt);
    return Math.floor((Date.now() - date.getTime()) / (1000 * 60 * 60 * 24));
};

// ============================================
// MAIN COMPONENT
// ============================================

export default function Returns() {
    const queryClient = useQueryClient();
    const [tab, setTab] = useState<TabType>('actions');
    const [successMessage, setSuccessMessage] = useState('');
    const [error, setError] = useState('');

    // Modals
    const [showInitiateModal, setShowInitiateModal] = useState(false);
    const [selectedCustomerId, setSelectedCustomerId] = useState<string | null>(null);

    // Initiate Return Modal state
    const [orderSearchTerm, setOrderSearchTerm] = useState('');
    const [searchedOrder, setSearchedOrder] = useState<OrderForReturn | null>(null);
    const [selectedLines, setSelectedLines] = useState<Set<string>>(new Set());
    const [returnQtyMap, setReturnQtyMap] = useState<Record<string, number>>({});
    const [returnReasonCategory, setReturnReasonCategory] = useState('');
    const [returnReasonDetail, setReturnReasonDetail] = useState('');
    const [returnResolution, setReturnResolution] = useState<'refund' | 'exchange' | 'rejected'>('refund');
    const [returnNotes, setReturnNotes] = useState('');
    const [exchangeSkuId, setExchangeSkuId] = useState('');

    // QC Modal state
    const [qcModalItem, setQcModalItem] = useState<RepackingQueueItem | null>(null);
    const [qcAction, setQcAction] = useState<'ready' | 'write_off'>('ready');
    const [qcComments, setQcComments] = useState('');
    const [writeOffReason, setWriteOffReason] = useState('');

    // ============================================
    // QUERIES
    // ============================================

    const getActiveLineReturnsFn = useServerFn(getActiveLineReturns);
    const getLineReturnActionQueueFn = useServerFn(getLineReturnActionQueue);
    const getOrderForReturnFn = useServerFn(getOrderForReturn);
    const getReturnConfigFn = useServerFn(getReturnConfig);

    const { data: activeReturns = [], isLoading: loadingReturns } = useQuery({
        queryKey: ['returns', 'active'],
        queryFn: async () => {
            const data = await getActiveLineReturnsFn();
            return data.map((item: ServerActiveReturnLine) => ({
                ...item,
                ageDays: computeAgeDays(item.returnRequestedAt),
            }));
        },
        enabled: tab === 'all',
    });

    const { data: actionQueue = [], isLoading: loadingQueue } = useQuery({
        queryKey: ['returns', 'action-queue'],
        queryFn: () => getLineReturnActionQueueFn(),
        enabled: tab === 'actions',
        refetchInterval: 30000, // Refresh every 30 seconds
    });

    const { data: returnConfig, isLoading: loadingConfig, refetch: refetchConfig } = useQuery({
        queryKey: ['returns', 'config'],
        queryFn: () => getReturnConfigFn(),
        enabled: tab === 'settings',
    });

    // ============================================
    // MUTATIONS
    // ============================================

    const initiateReturnFn = useServerFn(initiateLineReturn);
    const schedulePickupFn = useServerFn(scheduleReturnPickup);
    const receiveReturnFn = useServerFn(receiveLineReturn);
    const processRefundFn = useServerFn(processLineReturnRefund);
    const completeReturnFn = useServerFn(completeLineReturn);
    const cancelReturnFn = useServerFn(cancelLineReturn);
    const createExchangeFn = useServerFn(createExchangeOrder);
    const updateNotesFn = useServerFn(updateReturnNotes);
    const processRepackingItemFn = useServerFn(processRepackingItem);

    const initiateMutation = useMutation({
        mutationFn: initiateReturnFn,
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ['returns'] });
            setSuccessMessage('Return initiated successfully');
            setTimeout(() => setSuccessMessage(''), 3000);
            setShowInitiateModal(false);
            resetInitiateForm();
        },
        onError: (err: Error) => {
            setError(err.message);
            setTimeout(() => setError(''), 5000);
        },
    });

    const schedulePickupMutation = useMutation({
        mutationFn: schedulePickupFn,
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ['returns'] });
            setSuccessMessage('Pickup scheduled successfully');
            setTimeout(() => setSuccessMessage(''), 3000);
        },
        onError: (err: Error) => {
            setError(err.message);
            setTimeout(() => setError(''), 5000);
        },
    });

    const receiveMutation = useMutation({
        mutationFn: receiveReturnFn,
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ['returns'] });
            queryClient.invalidateQueries({ queryKey: ['repacking-queue'] });
            setSuccessMessage('Return received and added to QC queue');
            setTimeout(() => setSuccessMessage(''), 3000);
        },
        onError: (err: Error) => {
            setError(err.message);
            setTimeout(() => setError(''), 5000);
        },
    });

    const processRefundMutation = useMutation({
        mutationFn: processRefundFn,
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ['returns'] });
            setSuccessMessage('Refund processed successfully');
            setTimeout(() => setSuccessMessage(''), 3000);
        },
        onError: (err: Error) => {
            setError(err.message);
            setTimeout(() => setError(''), 5000);
        },
    });

    const completeMutation = useMutation({
        mutationFn: completeReturnFn,
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ['returns'] });
            setSuccessMessage('Return completed');
            setTimeout(() => setSuccessMessage(''), 3000);
        },
        onError: (err: Error) => {
            setError(err.message);
            setTimeout(() => setError(''), 5000);
        },
    });

    const cancelMutation = useMutation({
        mutationFn: cancelReturnFn,
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ['returns'] });
            setSuccessMessage('Return cancelled');
            setTimeout(() => setSuccessMessage(''), 3000);
        },
        onError: (err: Error) => {
            setError(err.message);
            setTimeout(() => setError(''), 5000);
        },
    });

    const createExchangeMutation = useMutation({
        mutationFn: createExchangeFn,
        onSuccess: (data) => {
            // Handle structured result
            if (!data.success) {
                setError(data.error.message);
                setTimeout(() => setError(''), 5000);
                return;
            }
            queryClient.invalidateQueries({ queryKey: ['returns'] });
            setSuccessMessage(`Exchange order ${data.data?.exchangeOrderNumber} created`);
            setTimeout(() => setSuccessMessage(''), 3000);
        },
        onError: (err: Error) => {
            setError(err.message);
            setTimeout(() => setError(''), 5000);
        },
    });

    const processQcMutation = useMutation({
        mutationFn: processRepackingItemFn,
        onSuccess: (data) => {
            queryClient.invalidateQueries({ queryKey: ['repacking-queue'] });
            setSuccessMessage(data.message);
            setTimeout(() => setSuccessMessage(''), 3000);
            setQcModalItem(null);
        },
        onError: (err: Error) => {
            setError(err.message);
            setTimeout(() => setError(''), 5000);
        },
    });

    const updateNotesMutation = useMutation({
        mutationFn: updateNotesFn,
        onSuccess: (data) => {
            if (!data.success) {
                setError(data.error.message);
                setTimeout(() => setError(''), 5000);
                return;
            }
            queryClient.invalidateQueries({ queryKey: ['returns'] });
            setSuccessMessage('Notes updated');
            setTimeout(() => setSuccessMessage(''), 2000);
        },
        onError: (err: Error) => {
            setError(err.message);
            setTimeout(() => setError(''), 5000);
        },
    });

    // ============================================
    // HANDLERS
    // ============================================

    const handleSearchOrder = async () => {
        if (!orderSearchTerm.trim()) return;
        try {
            const order = await getOrderForReturnFn({ data: { orderNumber: orderSearchTerm.trim() } });
            setSearchedOrder(order);
            setError('');
        } catch (err) {
            setError(err instanceof Error ? err.message : 'Order not found');
            setSearchedOrder(null);
            setTimeout(() => setError(''), 5000);
        }
    };

    const handleToggleLine = (lineId: string) => {
        const newSelected = new Set(selectedLines);
        if (newSelected.has(lineId)) {
            newSelected.delete(lineId);
        } else {
            newSelected.add(lineId);
        }
        setSelectedLines(newSelected);
    };

    const handleInitiateReturn = () => {
        if (selectedLines.size === 0) {
            setError('Please select at least one line');
            setTimeout(() => setError(''), 3000);
            return;
        }

        if (!returnReasonCategory) {
            setError('Please select a reason category');
            setTimeout(() => setError(''), 3000);
            return;
        }

        if (returnResolution === 'exchange' && !exchangeSkuId) {
            setError('Please select an exchange SKU');
            setTimeout(() => setError(''), 3000);
            return;
        }

        // For each selected line, initiate return
        selectedLines.forEach((lineId) => {
            const qty = returnQtyMap[lineId] || 1;
            initiateMutation.mutate({ data: {
                orderLineId: lineId,
                returnQty: qty,
                returnReasonCategory: returnReasonCategory as 'fit_size' | 'product_quality' | 'product_different' | 'wrong_item_sent' | 'damaged_in_transit' | 'changed_mind' | 'other',
                returnReasonDetail,
                returnResolution,
                returnNotes,
                ...(returnResolution === 'exchange' && exchangeSkuId ? { exchangeSkuId } : {}),
            }});
        });
    };

    const resetInitiateForm = () => {
        setOrderSearchTerm('');
        setSearchedOrder(null);
        setSelectedLines(new Set());
        setReturnQtyMap({});
        setReturnReasonCategory('');
        setReturnReasonDetail('');
        setReturnResolution('refund');
        setReturnNotes('');
        setExchangeSkuId('');
    };

    const handleSchedulePickup = (lineId: string) => {
        schedulePickupMutation.mutate({ data: {
            orderLineId: lineId,
            pickupType: 'arranged_by_us',
        }});
    };

    const handleReceive = (lineId: string, condition: 'good' | 'damaged' | 'defective' | 'wrong_item' | 'used') => {
        receiveMutation.mutate({ data: {
            orderLineId: lineId,
            condition,
        }});
    };

    const handleProcessRefund = (lineId: string) => {
        // For now, simplified - in full implementation would show modal to enter amounts
        const grossAmount = 1000; // Placeholder
        processRefundMutation.mutate({ data: {
            orderLineId: lineId,
            grossAmount,
            discountClawback: 0,
            deductions: 0,
        }});
    };

    const handleComplete = (lineId: string) => {
        completeMutation.mutate({ data: { orderLineId: lineId }});
    };

    const handleCancel = (lineId: string) => {
        const reason = prompt('Reason for cancellation:');
        if (reason !== null) {
            cancelMutation.mutate({ data: { orderLineId: lineId, reason }});
        }
    };

    const handleCreateExchange = (lineId: string) => {
        // For now, simplified - in full implementation would show modal to select SKU
        const skuId = prompt('Exchange SKU ID:');
        if (skuId) {
            createExchangeMutation.mutate({ data: {
                orderLineId: lineId,
                exchangeSkuId: skuId,
                exchangeQty: 1,
            }});
        }
    };

    const handleProcessQc = () => {
        if (!qcModalItem) return;
        processQcMutation.mutate({ data: {
            itemId: qcModalItem.id,
            action: qcAction,
            ...(qcAction === 'write_off' ? { writeOffReason } : {}),
            qcComments,
        }});
    };

    const handleUpdateNotes = (lineId: string, notes: string) => {
        updateNotesMutation.mutate({ data: { orderLineId: lineId, returnNotes: notes }});
    };

    // ============================================
    // RENDER
    // ============================================

    return (
        <div className="p-6">
            {/* Header */}
            <div className="flex items-center justify-between mb-6">
                <div>
                    <h1 className="text-2xl font-bold">Returns Management</h1>
                    <p className="text-sm text-gray-500 mt-1">
                        Manage customer returns, exchanges, and QC
                    </p>
                </div>
                <button
                    onClick={() => setShowInitiateModal(true)}
                    className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 flex items-center gap-2"
                >
                    <Plus size={16} />
                    Initiate Return
                </button>
            </div>

            {/* Success/Error Messages */}
            {successMessage && (
                <div className="mb-4 p-3 bg-green-100 text-green-800 rounded-lg flex items-center gap-2">
                    <CheckCircle size={16} />
                    {successMessage}
                </div>
            )}
            {error && (
                <div className="mb-4 p-3 bg-red-100 text-red-800 rounded-lg flex items-center gap-2">
                    <AlertCircle size={16} />
                    {error}
                </div>
            )}

            {/* Tabs */}
            <div className="border-b border-gray-200 mb-6">
                <nav className="flex gap-4">
                    <button
                        onClick={() => setTab('actions')}
                        className={`px-4 py-2 border-b-2 font-medium ${
                            tab === 'actions'
                                ? 'border-blue-600 text-blue-600'
                                : 'border-transparent text-gray-500 hover:text-gray-700'
                        }`}
                    >
                        Action Queue
                        {actionQueue.length > 0 && (
                            <span className="ml-2 px-2 py-0.5 bg-red-100 text-red-800 text-xs rounded-full">
                                {actionQueue.length}
                            </span>
                        )}
                    </button>
                    <button
                        onClick={() => setTab('all')}
                        className={`px-4 py-2 border-b-2 font-medium ${
                            tab === 'all'
                                ? 'border-blue-600 text-blue-600'
                                : 'border-transparent text-gray-500 hover:text-gray-700'
                        }`}
                    >
                        All Returns
                        {activeReturns.length > 0 && (
                            <span className="ml-2 px-2 py-0.5 bg-gray-100 text-gray-800 text-xs rounded-full">
                                {activeReturns.length}
                            </span>
                        )}
                    </button>
                    <button
                        onClick={() => setTab('analytics')}
                        className={`px-4 py-2 border-b-2 font-medium ${
                            tab === 'analytics'
                                ? 'border-blue-600 text-blue-600'
                                : 'border-transparent text-gray-500 hover:text-gray-700'
                        }`}
                    >
                        Analytics
                    </button>
                    <button
                        onClick={() => setTab('settings')}
                        className={`px-4 py-2 border-b-2 font-medium flex items-center gap-1 ${
                            tab === 'settings'
                                ? 'border-blue-600 text-blue-600'
                                : 'border-transparent text-gray-500 hover:text-gray-700'
                        }`}
                    >
                        <Settings size={16} />
                        Settings
                    </button>
                </nav>
            </div>

            {/* Tab Content */}
            {tab === 'actions' && (
                <ActionQueueTab
                    items={actionQueue}
                    loading={loadingQueue}
                    onSchedulePickup={handleSchedulePickup}
                    onReceive={handleReceive}
                    onProcessRefund={handleProcessRefund}
                    onCreateExchange={handleCreateExchange}
                    onComplete={handleComplete}
                    onCancel={handleCancel}
                    onUpdateNotes={handleUpdateNotes}
                />
            )}

            {tab === 'all' && (
                <AllReturnsTab
                    returns={activeReturns}
                    loading={loadingReturns}
                    onViewCustomer={(customerId) => setSelectedCustomerId(customerId)}
                    onCancel={handleCancel}
                    onUpdateNotes={handleUpdateNotes}
                />
            )}

            {tab === 'analytics' && <AnalyticsTab />}

            {tab === 'settings' && (
                <SettingsTab config={returnConfig} loading={loadingConfig} onRefresh={() => refetchConfig()} />
            )}

            {/* Initiate Return Modal */}
            {showInitiateModal && (
                <InitiateReturnModal
                    orderSearchTerm={orderSearchTerm}
                    setOrderSearchTerm={setOrderSearchTerm}
                    searchedOrder={searchedOrder}
                    selectedLines={selectedLines}
                    returnQtyMap={returnQtyMap}
                    setReturnQtyMap={setReturnQtyMap}
                    returnReasonCategory={returnReasonCategory}
                    setReturnReasonCategory={setReturnReasonCategory}
                    returnReasonDetail={returnReasonDetail}
                    setReturnReasonDetail={setReturnReasonDetail}
                    returnResolution={returnResolution}
                    setReturnResolution={setReturnResolution}
                    returnNotes={returnNotes}
                    setReturnNotes={setReturnNotes}
                    exchangeSkuId={exchangeSkuId}
                    setExchangeSkuId={setExchangeSkuId}
                    onSearchOrder={handleSearchOrder}
                    onToggleLine={handleToggleLine}
                    onInitiate={handleInitiateReturn}
                    onClose={() => {
                        setShowInitiateModal(false);
                        resetInitiateForm();
                    }}
                />
            )}

            {/* QC Modal */}
            {qcModalItem && (
                <QcModal
                    item={qcModalItem}
                    action={qcAction}
                    setAction={setQcAction}
                    comments={qcComments}
                    setComments={setQcComments}
                    writeOffReason={writeOffReason}
                    setWriteOffReason={setWriteOffReason}
                    onProcess={handleProcessQc}
                    onClose={() => setQcModalItem(null)}
                />
            )}

            {/* Customer Detail Modal */}
            {selectedCustomerId && (
                <CustomerDetailModal
                    customerId={selectedCustomerId}
                    onClose={() => setSelectedCustomerId(null)}
                />
            )}
        </div>
    );
}

// ============================================
// ACTION QUEUE TAB
// ============================================

interface ActionQueueTabProps {
    items: ServerReturnActionQueueItem[];
    loading: boolean;
    onSchedulePickup: (lineId: string) => void;
    onReceive: (lineId: string, condition: 'good' | 'damaged' | 'defective' | 'wrong_item' | 'used') => void;
    onProcessRefund: (lineId: string) => void;
    onCreateExchange: (lineId: string) => void;
    onComplete: (lineId: string) => void;
    onCancel: (lineId: string) => void;
    onUpdateNotes: (lineId: string, notes: string) => void;
}

function ActionQueueTab({
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

    return (
        <div className="space-y-4">
            {items.map((item) => (
                <div key={item.id} className="border border-gray-200 rounded-lg p-4 bg-white">
                    <div className="flex items-start justify-between">
                        <div className="flex gap-4">
                            <div className="w-16 h-16 bg-gray-100 rounded flex items-center justify-center">
                                {item.imageUrl ? (
                                    <img
                                        src={item.imageUrl}
                                        alt={item.productName || ''}
                                        className="w-full h-full object-cover rounded"
                                    />
                                ) : (
                                    <Package size={24} className="text-gray-400" />
                                )}
                            </div>
                            <div>
                                <div className="flex items-center gap-2 mb-1">
                                    <span className="font-medium">{item.orderNumber}</span>
                                    <span className={`px-2 py-0.5 text-xs rounded ${getStatusBadge(item.returnStatus)}`}>
                                        {item.returnStatus}
                                    </span>
                                    <span className={`px-2 py-0.5 text-xs rounded ${getResolutionBadge(item.returnResolution).color}`}>
                                        {getResolutionBadge(item.returnResolution).label}
                                    </span>
                                </div>
                                <div className="text-sm text-gray-600">
                                    {item.productName} - {item.colorName} - {item.size}
                                </div>
                                <div className="text-sm text-gray-500">
                                    SKU: {item.skuCode} | Qty: {item.returnQty} | Customer: {item.customerName}
                                </div>
                                {item.returnReasonCategory && (
                                    <div className="text-xs text-gray-500 mt-1">
                                        Reason: {item.returnReasonCategory}
                                        {item.returnReasonDetail && ` - ${item.returnReasonDetail}`}
                                    </div>
                                )}
                                <div className="text-xs text-gray-400 mt-1">
                                    Requested {item.daysSinceRequest} days ago
                                </div>
                            </div>
                        </div>

                        {/* Action Buttons */}
                        <div className="flex flex-col gap-2 shrink-0">
                            {item.actionNeeded === 'schedule_pickup' && (
                                <button
                                    onClick={() => onSchedulePickup(item.id)}
                                    className="px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700 flex items-center gap-2"
                                >
                                    <Truck size={16} />
                                    Schedule Pickup
                                </button>
                            )}

                            {item.actionNeeded === 'receive' && (
                                <div className="flex flex-col gap-2">
                                    <select
                                        value={receiveConditionMap[item.id] || ''}
                                        onChange={(e) =>
                                            setReceiveConditionMap({ ...receiveConditionMap, [item.id]: e.target.value })
                                        }
                                        className="px-3 py-2 border border-gray-300 rounded text-sm"
                                    >
                                        <option value="">Select Condition</option>
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
                                        className="px-4 py-2 bg-green-600 text-white rounded hover:bg-green-700 flex items-center gap-2"
                                    >
                                        <PackageCheck size={16} />
                                        Receive
                                    </button>
                                </div>
                            )}

                            {item.actionNeeded === 'process_refund' && (
                                <button
                                    onClick={() => onProcessRefund(item.id)}
                                    className="px-4 py-2 bg-purple-600 text-white rounded hover:bg-purple-700 flex items-center gap-2"
                                >
                                    <DollarSign size={16} />
                                    Process Refund
                                </button>
                            )}

                            {item.actionNeeded === 'create_exchange' && (
                                <button
                                    onClick={() => onCreateExchange(item.id)}
                                    className="px-4 py-2 bg-indigo-600 text-white rounded hover:bg-indigo-700 flex items-center gap-2"
                                >
                                    <ArrowRight size={16} />
                                    Create Exchange
                                </button>
                            )}

                            {item.actionNeeded === 'complete' && (
                                <button
                                    onClick={() => onComplete(item.id)}
                                    className="px-4 py-2 bg-gray-600 text-white rounded hover:bg-gray-700 flex items-center gap-2"
                                >
                                    <Check size={16} />
                                    Complete
                                </button>
                            )}

                            <button
                                onClick={() => onCancel(item.id)}
                                className="px-4 py-2 bg-red-100 text-red-800 rounded hover:bg-red-200 flex items-center gap-2"
                            >
                                <XCircle size={16} />
                                Cancel
                            </button>
                        </div>
                    </div>

                    {/* Notes Section */}
                    <div className="mt-3 pt-3 border-t border-gray-100">
                        {editingNotesId === item.id ? (
                            <div className="flex gap-2">
                                <textarea
                                    value={editingNotesValue}
                                    onChange={(e) => setEditingNotesValue(e.target.value)}
                                    placeholder="Add notes about this return..."
                                    className="flex-1 px-3 py-2 border border-gray-300 rounded-lg text-sm resize-none"
                                    rows={2}
                                    autoFocus
                                />
                                <div className="flex flex-col gap-1">
                                    <button
                                        onClick={() => saveNotes(item.id)}
                                        className="px-3 py-1 bg-blue-600 text-white rounded text-sm hover:bg-blue-700 flex items-center gap-1"
                                    >
                                        <Save size={14} />
                                        Save
                                    </button>
                                    <button
                                        onClick={cancelEditNotes}
                                        className="px-3 py-1 bg-gray-100 text-gray-600 rounded text-sm hover:bg-gray-200"
                                    >
                                        Cancel
                                    </button>
                                </div>
                            </div>
                        ) : (
                            <div className="flex items-start gap-2">
                                <MessageSquare size={14} className="text-gray-400 mt-0.5 shrink-0" />
                                {item.returnNotes ? (
                                    <p className="text-sm text-gray-600 flex-1">{item.returnNotes}</p>
                                ) : (
                                    <p className="text-sm text-gray-400 italic flex-1">No notes</p>
                                )}
                                <button
                                    onClick={() => startEditNotes(item.id, item.returnNotes)}
                                    className="text-gray-400 hover:text-blue-600 p-1"
                                    title="Edit notes"
                                >
                                    <Pencil size={14} />
                                </button>
                            </div>
                        )}
                    </div>
                </div>
            ))}
        </div>
    );
}

// ============================================
// ALL RETURNS TAB
// ============================================

interface AllReturnsTabProps {
    returns: ActiveReturnLine[];
    loading: boolean;
    onViewCustomer: (customerId: string) => void;
    onCancel: (lineId: string) => void;
    onUpdateNotes: (lineId: string, notes: string) => void;
}

function AllReturnsTab({ returns, loading, onViewCustomer, onCancel, onUpdateNotes }: AllReturnsTabProps) {
    const [statusFilter, setStatusFilter] = useState<string>('all');
    const [searchTerm, setSearchTerm] = useState('');
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
        return <div className="text-center py-12">Loading returns...</div>;
    }

    const filteredReturns = returns.filter((ret) => {
        if (statusFilter !== 'all' && ret.returnStatus !== statusFilter) return false;
        if (searchTerm) {
            const term = searchTerm.toLowerCase();
            return (
                ret.orderNumber.toLowerCase().includes(term) ||
                ret.skuCode.toLowerCase().includes(term) ||
                ret.customerName.toLowerCase().includes(term)
            );
        }
        return true;
    });

    return (
        <div>
            {/* Filters */}
            <div className="flex gap-4 mb-4">
                <input
                    type="text"
                    placeholder="Search order, SKU, customer..."
                    value={searchTerm}
                    onChange={(e) => setSearchTerm(e.target.value)}
                    className="flex-1 px-4 py-2 border border-gray-300 rounded-lg"
                />
                <select
                    value={statusFilter}
                    onChange={(e) => setStatusFilter(e.target.value)}
                    className="px-4 py-2 border border-gray-300 rounded-lg"
                >
                    <option value="all">All Statuses</option>
                    <option value="requested">Requested</option>
                    <option value="pickup_scheduled">Pickup Scheduled</option>
                    <option value="in_transit">In Transit</option>
                    <option value="received">Received</option>
                </select>
            </div>

            {/* Table */}
            {filteredReturns.length === 0 ? (
                <div className="text-center py-12 text-gray-500">No returns found</div>
            ) : (
                <div className="border border-gray-200 rounded-lg overflow-hidden">
                    <table className="w-full">
                        <thead className="bg-gray-50">
                            <tr>
                                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Order</th>
                                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Product</th>
                                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Qty</th>
                                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Status</th>
                                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Resolution</th>
                                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Customer</th>
                                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Age</th>
                                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Notes</th>
                                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Actions</th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-gray-200">
                            {filteredReturns.map((ret) => (
                                <tr key={ret.id} className="hover:bg-gray-50">
                                    <td className="px-4 py-3 text-sm">{ret.orderNumber}</td>
                                    <td className="px-4 py-3 text-sm">
                                        <div>{ret.productName}</div>
                                        <div className="text-xs text-gray-500">
                                            {ret.colorName} - {ret.size} ({ret.skuCode})
                                        </div>
                                    </td>
                                    <td className="px-4 py-3 text-sm">{ret.returnQty}</td>
                                    <td className="px-4 py-3 text-sm">
                                        <span className={`px-2 py-1 text-xs rounded ${getStatusBadge(ret.returnStatus)}`}>
                                            {ret.returnStatus}
                                        </span>
                                    </td>
                                    <td className="px-4 py-3 text-sm">
                                        <span className={`px-2 py-1 text-xs rounded ${getResolutionBadge(ret.returnResolution).color}`}>
                                            {getResolutionBadge(ret.returnResolution).label}
                                        </span>
                                    </td>
                                    <td className="px-4 py-3 text-sm">
                                        <button
                                            onClick={() => ret.customerId && onViewCustomer(ret.customerId)}
                                            className="text-blue-600 hover:underline"
                                        >
                                            {ret.customerName}
                                        </button>
                                    </td>
                                    <td className="px-4 py-3 text-sm text-gray-500">{ret.ageDays}d</td>
                                    <td className="px-4 py-3 text-sm max-w-[200px]">
                                        {editingNotesId === ret.id ? (
                                            <div className="flex gap-1">
                                                <input
                                                    type="text"
                                                    value={editingNotesValue}
                                                    onChange={(e) => setEditingNotesValue(e.target.value)}
                                                    className="flex-1 px-2 py-1 border border-gray-300 rounded text-sm min-w-0"
                                                    autoFocus
                                                    onKeyDown={(e) => {
                                                        if (e.key === 'Enter') saveNotes(ret.id);
                                                        if (e.key === 'Escape') cancelEditNotes();
                                                    }}
                                                />
                                                <button
                                                    onClick={() => saveNotes(ret.id)}
                                                    className="p-1 text-green-600 hover:bg-green-50 rounded"
                                                    title="Save"
                                                >
                                                    <Save size={14} />
                                                </button>
                                                <button
                                                    onClick={cancelEditNotes}
                                                    className="p-1 text-gray-400 hover:bg-gray-100 rounded"
                                                    title="Cancel"
                                                >
                                                    <X size={14} />
                                                </button>
                                            </div>
                                        ) : (
                                            <div className="flex items-center gap-1 group">
                                                <span className="truncate text-gray-600">
                                                    {ret.returnNotes || <span className="text-gray-400 italic">-</span>}
                                                </span>
                                                <button
                                                    onClick={() => startEditNotes(ret.id, ret.returnNotes)}
                                                    className="p-1 text-gray-400 hover:text-blue-600 opacity-0 group-hover:opacity-100 transition-opacity"
                                                    title="Edit notes"
                                                >
                                                    <Pencil size={12} />
                                                </button>
                                            </div>
                                        )}
                                    </td>
                                    <td className="px-4 py-3 text-sm">
                                        <button
                                            onClick={() => onCancel(ret.id)}
                                            className="text-red-600 hover:underline text-xs"
                                        >
                                            Cancel
                                        </button>
                                    </td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
            )}
        </div>
    );
}

// ============================================
// ANALYTICS TAB
// ============================================

function AnalyticsTab() {
    return (
        <div className="text-center py-12 text-gray-500">
            <p>Analytics coming soon...</p>
        </div>
    );
}

// ============================================
// SETTINGS TAB
// ============================================

interface SettingsTabProps {
    config: ReturnConfigResponse | undefined;
    loading: boolean;
    onRefresh: () => void;
}

function SettingsTab({ config, loading, onRefresh }: SettingsTabProps) {
    const queryClient = useQueryClient();
    const updateSettingsFn = useServerFn(updateReturnSettings);

    // Editable state
    const [windowDays, setWindowDays] = useState(14);
    const [windowWarningDays, setWindowWarningDays] = useState(12);
    const [autoRejectAfterDays, setAutoRejectAfterDays] = useState<number | null>(null);
    const [allowExpiredOverride, setAllowExpiredOverride] = useState(true);
    const [hasChanges, setHasChanges] = useState(false);

    // Sync state with config
    useState(() => {
        if (config) {
            setWindowDays(config.windowDays);
            setWindowWarningDays(config.windowWarningDays);
            setAutoRejectAfterDays(config.autoRejectAfterDays);
            setAllowExpiredOverride(config.allowExpiredOverride ?? true);
        }
    });

    // Update local state when config changes
    if (config && !hasChanges) {
        if (windowDays !== config.windowDays) setWindowDays(config.windowDays);
        if (windowWarningDays !== config.windowWarningDays) setWindowWarningDays(config.windowWarningDays);
        if (autoRejectAfterDays !== config.autoRejectAfterDays) setAutoRejectAfterDays(config.autoRejectAfterDays);
        if (allowExpiredOverride !== (config.allowExpiredOverride ?? true)) setAllowExpiredOverride(config.allowExpiredOverride ?? true);
    }

    const saveMutation = useMutation({
        mutationFn: () => updateSettingsFn({
            data: {
                windowDays,
                windowWarningDays,
                autoRejectAfterDays,
                allowExpiredOverride,
            },
        }),
        onSuccess: () => {
            setHasChanges(false);
            queryClient.invalidateQueries({ queryKey: ['returns', 'config'] });
            onRefresh();
        },
    });

    const handleChange = (setter: (val: any) => void, value: any) => {
        setter(value);
        setHasChanges(true);
    };

    const handleReset = () => {
        if (config) {
            setWindowDays(config.windowDays);
            setWindowWarningDays(config.windowWarningDays);
            setAutoRejectAfterDays(config.autoRejectAfterDays);
            setAllowExpiredOverride(config.allowExpiredOverride ?? true);
            setHasChanges(false);
        }
    };

    if (loading) {
        return <div className="text-center py-12">Loading settings...</div>;
    }

    if (!config) {
        return <div className="text-center py-12 text-gray-500">Failed to load settings</div>;
    }

    const daysRemaining = windowDays - windowWarningDays;

    return (
        <div className="space-y-6">
            {/* Return Window Settings - Editable */}
            <div className="bg-white border border-gray-200 rounded-lg p-6">
                <div className="flex items-center justify-between mb-4">
                    <h3 className="text-lg font-semibold">Return Policy</h3>
                    {hasChanges && (
                        <div className="flex items-center gap-2">
                            <button
                                onClick={handleReset}
                                className="px-3 py-1.5 text-sm text-gray-600 hover:text-gray-800"
                            >
                                Reset
                            </button>
                            <button
                                onClick={() => saveMutation.mutate()}
                                disabled={saveMutation.isPending}
                                className="px-4 py-1.5 text-sm bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50"
                            >
                                {saveMutation.isPending ? 'Saving...' : 'Save Changes'}
                            </button>
                        </div>
                    )}
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
                    <div>
                        <label className="block text-sm font-medium text-gray-700 mb-1">
                            Return Window
                        </label>
                        <div className="flex items-center gap-2">
                            <input
                                type="number"
                                value={windowDays}
                                onChange={(e) => handleChange(setWindowDays, parseInt(e.target.value) || 14)}
                                min={1}
                                max={365}
                                className="w-20 px-3 py-2 border border-gray-300 rounded-lg text-sm"
                            />
                            <span className="text-sm text-gray-500">days</span>
                        </div>
                        <p className="text-xs text-gray-500 mt-1">
                            From delivery date
                        </p>
                    </div>

                    <div>
                        <label className="block text-sm font-medium text-gray-700 mb-1">
                            Warning After
                        </label>
                        <div className="flex items-center gap-2">
                            <input
                                type="number"
                                value={windowWarningDays}
                                onChange={(e) => handleChange(setWindowWarningDays, parseInt(e.target.value) || 0)}
                                min={0}
                                max={windowDays - 1}
                                className="w-20 px-3 py-2 border border-gray-300 rounded-lg text-sm"
                            />
                            <span className="text-sm text-gray-500">days</span>
                        </div>
                        <p className="text-xs text-gray-500 mt-1">
                            Shows warning at {daysRemaining} day{daysRemaining !== 1 ? 's' : ''} remaining
                        </p>
                    </div>

                    <div>
                        <label className="block text-sm font-medium text-gray-700 mb-1">
                            Auto-Reject After
                        </label>
                        <div className="flex items-center gap-2">
                            <input
                                type="number"
                                value={autoRejectAfterDays ?? ''}
                                onChange={(e) => handleChange(
                                    setAutoRejectAfterDays,
                                    e.target.value ? parseInt(e.target.value) : null
                                )}
                                min={windowDays}
                                placeholder="Never"
                                className="w-20 px-3 py-2 border border-gray-300 rounded-lg text-sm"
                            />
                            <span className="text-sm text-gray-500">days</span>
                        </div>
                        <p className="text-xs text-gray-500 mt-1">
                            Leave empty to allow overrides
                        </p>
                    </div>

                    <div>
                        <label className="block text-sm font-medium text-gray-700 mb-1">
                            Allow Expired Override
                        </label>
                        <label className="flex items-center gap-2 mt-2">
                            <input
                                type="checkbox"
                                checked={allowExpiredOverride}
                                onChange={(e) => handleChange(setAllowExpiredOverride, e.target.checked)}
                                className="rounded border-gray-300"
                            />
                            <span className="text-sm text-gray-600">
                                Allow returns after window
                            </span>
                        </label>
                    </div>
                </div>

                {saveMutation.isError && (
                    <div className="mt-4 p-3 bg-red-50 border border-red-200 rounded-lg text-sm text-red-700">
                        {(saveMutation.error as Error)?.message || 'Failed to save settings'}
                    </div>
                )}
            </div>

            {/* Read-only Options Display */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                {/* Reason Categories */}
                <div className="bg-white border border-gray-200 rounded-lg p-4">
                    <h4 className="text-sm font-medium text-gray-700 mb-3">Return Reasons</h4>
                    <div className="flex flex-wrap gap-1.5">
                        {config.reasonCategories.map((reason) => (
                            <span key={reason.value} className="px-2 py-0.5 bg-blue-50 text-blue-700 rounded text-xs">
                                {reason.label}
                            </span>
                        ))}
                    </div>
                </div>

                {/* Item Conditions */}
                <div className="bg-white border border-gray-200 rounded-lg p-4">
                    <h4 className="text-sm font-medium text-gray-700 mb-3">Item Conditions</h4>
                    <div className="flex flex-wrap gap-1.5">
                        {config.conditions.map((condition) => (
                            <span key={condition.value} className="px-2 py-0.5 bg-green-50 text-green-700 rounded text-xs">
                                {condition.label}
                            </span>
                        ))}
                    </div>
                </div>

                {/* Resolution Types */}
                <div className="bg-white border border-gray-200 rounded-lg p-4">
                    <h4 className="text-sm font-medium text-gray-700 mb-3">Resolutions</h4>
                    <div className="flex flex-wrap gap-1.5">
                        {config.resolutions.map((resolution) => (
                            <span key={resolution.value} className="px-2 py-0.5 bg-purple-50 text-purple-700 rounded text-xs">
                                {resolution.label}
                            </span>
                        ))}
                    </div>
                </div>

                {/* Refund Methods */}
                <div className="bg-white border border-gray-200 rounded-lg p-4">
                    <h4 className="text-sm font-medium text-gray-700 mb-3">Refund Methods</h4>
                    <div className="flex flex-wrap gap-1.5">
                        {config.refundMethods.map((method) => (
                            <span key={method.value} className="px-2 py-0.5 bg-indigo-50 text-indigo-700 rounded text-xs">
                                {method.label}
                            </span>
                        ))}
                    </div>
                </div>
            </div>

            {/* Non-Returnable Reasons */}
            <div className="bg-white border border-gray-200 rounded-lg p-4">
                <h4 className="text-sm font-medium text-gray-700 mb-3">Non-Returnable Product Reasons</h4>
                <div className="flex flex-wrap gap-1.5">
                    {config.nonReturnableReasons.map((reason) => (
                        <span key={reason.value} className="px-2 py-0.5 bg-red-50 text-red-700 rounded text-xs">
                            {reason.label}
                        </span>
                    ))}
                </div>
            </div>
        </div>
    );
}

// ============================================
// INITIATE RETURN MODAL
// ============================================

interface InitiateReturnModalProps {
    orderSearchTerm: string;
    setOrderSearchTerm: (val: string) => void;
    searchedOrder: OrderForReturn | null;
    selectedLines: Set<string>;
    returnQtyMap: Record<string, number>;
    setReturnQtyMap: (map: Record<string, number>) => void;
    returnReasonCategory: string;
    setReturnReasonCategory: (val: string) => void;
    returnReasonDetail: string;
    setReturnReasonDetail: (val: string) => void;
    returnResolution: 'refund' | 'exchange' | 'rejected';
    setReturnResolution: (val: 'refund' | 'exchange' | 'rejected') => void;
    returnNotes: string;
    setReturnNotes: (val: string) => void;
    exchangeSkuId: string;
    setExchangeSkuId: (val: string) => void;
    onSearchOrder: () => void;
    onToggleLine: (lineId: string) => void;
    onInitiate: () => void;
    onClose: () => void;
}

function InitiateReturnModal({
    orderSearchTerm,
    setOrderSearchTerm,
    searchedOrder,
    selectedLines,
    returnQtyMap,
    setReturnQtyMap,
    returnReasonCategory,
    setReturnReasonCategory,
    returnReasonDetail,
    setReturnReasonDetail,
    returnResolution,
    setReturnResolution,
    returnNotes,
    setReturnNotes,
    exchangeSkuId,
    setExchangeSkuId,
    onSearchOrder,
    onToggleLine,
    onInitiate,
    onClose,
}: InitiateReturnModalProps) {
    return (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
            <div className="bg-white rounded-lg max-w-4xl w-full max-h-[90vh] overflow-y-auto">
                <div className="p-6 border-b border-gray-200 flex items-center justify-between sticky top-0 bg-white">
                    <h2 className="text-xl font-bold">Initiate Return</h2>
                    <button onClick={onClose} className="text-gray-500 hover:text-gray-700">
                        <X size={24} />
                    </button>
                </div>

                <div className="p-6 space-y-6">
                    {/* Step 1: Search Order */}
                    <div>
                        <label className="block text-sm font-medium mb-2">Search Order</label>
                        <div className="flex gap-2">
                            <input
                                type="text"
                                placeholder="Enter order number..."
                                value={orderSearchTerm}
                                onChange={(e) => setOrderSearchTerm(e.target.value)}
                                onKeyPress={(e) => e.key === 'Enter' && onSearchOrder()}
                                className="flex-1 px-4 py-2 border border-gray-300 rounded-lg"
                            />
                            <button
                                onClick={onSearchOrder}
                                className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700"
                            >
                                <Search size={16} />
                            </button>
                        </div>
                    </div>

                    {/* Step 2: Select Lines */}
                    {searchedOrder && (
                        <div>
                            <h3 className="text-sm font-medium mb-2">
                                Order {searchedOrder.orderNumber} - {searchedOrder.customerName}
                            </h3>
                            <div className="space-y-2">
                                {searchedOrder.lines.map((line) => {
                                    const hasWarning = line.eligibility.eligible && line.eligibility.warning;
                                    const borderClass = !line.eligibility.eligible
                                        ? 'border-red-200 bg-red-50'
                                        : hasWarning
                                        ? 'border-yellow-200 bg-yellow-50 hover:border-yellow-300 cursor-pointer'
                                        : 'border-gray-200 hover:border-blue-300 cursor-pointer';

                                    return (
                                        <div
                                            key={line.id}
                                            className={`p-3 border rounded-lg ${borderClass}`}
                                            onClick={() => line.eligibility.eligible && onToggleLine(line.id)}
                                        >
                                            <div className="flex items-center gap-3">
                                                {line.eligibility.eligible && (
                                                    <input
                                                        type="checkbox"
                                                        checked={selectedLines.has(line.id)}
                                                        onChange={() => onToggleLine(line.id)}
                                                        className="w-4 h-4"
                                                    />
                                                )}
                                                <div className="flex-1">
                                                    <div className="font-medium">
                                                        {line.productName} - {line.colorName} - {line.size}
                                                    </div>
                                                    <div className="text-sm text-gray-500">
                                                        SKU: {line.skuCode} | Qty: {line.qty}
                                                        {line.eligibility.daysRemaining !== null && (
                                                            <span className="ml-2">
                                                                ({line.eligibility.daysRemaining >= 0
                                                                    ? `${line.eligibility.daysRemaining}d left`
                                                                    : `${Math.abs(line.eligibility.daysRemaining)}d overdue`})
                                                            </span>
                                                        )}
                                                    </div>
                                                    {!line.eligibility.eligible && (
                                                        <div className="text-sm text-red-600 mt-1">
                                                            Not eligible: {line.eligibility.reason}
                                                        </div>
                                                    )}
                                                    {hasWarning && (
                                                        <div className="text-sm text-yellow-700 mt-1 flex items-center gap-1">
                                                            <AlertCircle size={14} />
                                                            Warning: {line.eligibility.warning?.replace(/_/g, ' ')}
                                                        </div>
                                                    )}
                                                </div>
                                                {selectedLines.has(line.id) && (
                                                    <input
                                                        type="number"
                                                        min="1"
                                                        max={line.qty}
                                                        value={returnQtyMap[line.id] || 1}
                                                        onChange={(e) =>
                                                            setReturnQtyMap({
                                                                ...returnQtyMap,
                                                                [line.id]: parseInt(e.target.value, 10),
                                                            })
                                                        }
                                                        className="w-20 px-2 py-1 border border-gray-300 rounded"
                                                        onClick={(e) => e.stopPropagation()}
                                                    />
                                                )}
                                            </div>
                                        </div>
                                    );
                                })}
                            </div>
                        </div>
                    )}

                    {/* Step 3: Return Details */}
                    {selectedLines.size > 0 && (
                        <div className="space-y-4">
                            <div>
                                <label className="block text-sm font-medium mb-2">Reason Category</label>
                                <select
                                    value={returnReasonCategory}
                                    onChange={(e) => setReturnReasonCategory(e.target.value)}
                                    className="w-full px-4 py-2 border border-gray-300 rounded-lg"
                                >
                                    <option value="">Select reason...</option>
                                    {reasonOptions.map((cat) => (
                                        <option key={cat.value} value={cat.value}>
                                            {cat.label}
                                        </option>
                                    ))}
                                </select>
                            </div>

                            <div>
                                <label className="block text-sm font-medium mb-2">Reason Detail (Optional)</label>
                                <textarea
                                    value={returnReasonDetail}
                                    onChange={(e) => setReturnReasonDetail(e.target.value)}
                                    className="w-full px-4 py-2 border border-gray-300 rounded-lg"
                                    rows={2}
                                />
                            </div>

                            <div>
                                <label className="block text-sm font-medium mb-2">Resolution</label>
                                <div className="flex gap-2">
                                    {resolutionOptions.map((res) => (
                                        <button
                                            key={res.value}
                                            onClick={() => setReturnResolution(res.value as any)}
                                            className={`px-4 py-2 rounded-lg border ${
                                                returnResolution === res.value
                                                    ? 'border-blue-600 bg-blue-50 text-blue-700'
                                                    : 'border-gray-300'
                                            }`}
                                        >
                                            {res.label}
                                        </button>
                                    ))}
                                </div>
                            </div>

                            {returnResolution === 'exchange' && (
                                <div>
                                    <label className="block text-sm font-medium mb-2">Exchange SKU ID</label>
                                    <input
                                        type="text"
                                        value={exchangeSkuId}
                                        onChange={(e) => setExchangeSkuId(e.target.value)}
                                        className="w-full px-4 py-2 border border-gray-300 rounded-lg"
                                        placeholder="Enter SKU ID for exchange..."
                                    />
                                </div>
                            )}

                            <div>
                                <label className="block text-sm font-medium mb-2">Notes (Optional)</label>
                                <textarea
                                    value={returnNotes}
                                    onChange={(e) => setReturnNotes(e.target.value)}
                                    className="w-full px-4 py-2 border border-gray-300 rounded-lg"
                                    rows={2}
                                />
                            </div>
                        </div>
                    )}
                </div>

                <div className="p-6 border-t border-gray-200 flex justify-end gap-2 sticky bottom-0 bg-white">
                    <button onClick={onClose} className="px-4 py-2 border border-gray-300 rounded-lg hover:bg-gray-50">
                        Cancel
                    </button>
                    <button
                        onClick={onInitiate}
                        disabled={selectedLines.size === 0 || !returnReasonCategory}
                        className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50"
                    >
                        Initiate Return
                    </button>
                </div>
            </div>
        </div>
    );
}

// ============================================
// QC MODAL
// ============================================

interface QcModalProps {
    item: RepackingQueueItem;
    action: 'ready' | 'write_off';
    setAction: (action: 'ready' | 'write_off') => void;
    comments: string;
    setComments: (val: string) => void;
    writeOffReason: string;
    setWriteOffReason: (val: string) => void;
    onProcess: () => void;
    onClose: () => void;
}

function QcModal({
    item,
    action,
    setAction,
    comments,
    setComments,
    writeOffReason,
    setWriteOffReason,
    onProcess,
    onClose,
}: QcModalProps) {
    return (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
            <div className="bg-white rounded-lg max-w-lg w-full">
                <div className="p-6 border-b border-gray-200 flex items-center justify-between">
                    <h2 className="text-xl font-bold">Quality Check</h2>
                    <button onClick={onClose} className="text-gray-500 hover:text-gray-700">
                        <X size={24} />
                    </button>
                </div>

                <div className="p-6 space-y-4">
                    <div>
                        <div className="font-medium">{item.productName}</div>
                        <div className="text-sm text-gray-500">
                            {item.colorName} - {item.size} ({item.skuCode})
                        </div>
                        <div className="text-sm text-gray-500">Qty: {item.qty}</div>
                    </div>

                    <div>
                        <label className="block text-sm font-medium mb-2">Decision</label>
                        <div className="flex gap-2">
                            <button
                                onClick={() => setAction('ready')}
                                className={`flex-1 px-4 py-2 rounded-lg border ${
                                    action === 'ready'
                                        ? 'border-green-600 bg-green-50 text-green-700'
                                        : 'border-gray-300'
                                }`}
                            >
                                Ready to Sell
                            </button>
                            <button
                                onClick={() => setAction('write_off')}
                                className={`flex-1 px-4 py-2 rounded-lg border ${
                                    action === 'write_off'
                                        ? 'border-red-600 bg-red-50 text-red-700'
                                        : 'border-gray-300'
                                }`}
                            >
                                Write Off
                            </button>
                        </div>
                    </div>

                    {action === 'write_off' && (
                        <div>
                            <label className="block text-sm font-medium mb-2">Write-off Reason</label>
                            <select
                                value={writeOffReason}
                                onChange={(e) => setWriteOffReason(e.target.value)}
                                className="w-full px-4 py-2 border border-gray-300 rounded-lg"
                            >
                                <option value="">Select reason...</option>
                                {WRITE_OFF_REASONS.map((r) => (
                                    <option key={r.value} value={r.value}>
                                        {r.label}
                                    </option>
                                ))}
                            </select>
                        </div>
                    )}

                    <div>
                        <label className="block text-sm font-medium mb-2">QC Comments (Optional)</label>
                        <textarea
                            value={comments}
                            onChange={(e) => setComments(e.target.value)}
                            className="w-full px-4 py-2 border border-gray-300 rounded-lg"
                            rows={3}
                        />
                    </div>
                </div>

                <div className="p-6 border-t border-gray-200 flex justify-end gap-2">
                    <button onClick={onClose} className="px-4 py-2 border border-gray-300 rounded-lg hover:bg-gray-50">
                        Cancel
                    </button>
                    <button
                        onClick={onProcess}
                        className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700"
                    >
                        Process
                    </button>
                </div>
            </div>
        </div>
    );
}
