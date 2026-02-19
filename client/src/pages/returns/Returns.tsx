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
} from '../../server/functions/returns';
import {
    initiateLineReturn,
    scheduleReturnPickup,
    receiveLineReturn,
    processLineReturnRefund,
    completeLineReturn,
    cancelLineReturn,
    createExchangeOrder,
    updateReturnNotes,
} from '../../server/functions/returnsMutations';
import {
    processRepackingItem,
    type QueueItem as RepackingQueueItem,
} from '../../server/functions/repacking';
import type {
    ActiveReturnLine as ServerActiveReturnLine,
    ReturnActionQueueItem as ServerReturnActionQueueItem,
    OrderForReturn,
} from '@coh/shared/schemas/returns';
import { useState, lazy, Suspense } from 'react';
import {
    Plus, AlertCircle, CheckCircle, Settings,
} from 'lucide-react';

import { computeAgeDays } from './types';
import type { TabType } from './types';
import { ActionQueueTab } from './tabs/ActionQueueTab';
import { AllReturnsTab } from './tabs/AllReturnsTab';
import { AnalyticsTab } from './tabs/AnalyticsTab';
import { SettingsTab } from './tabs/SettingsTab';
import { InitiateReturnModal } from './modals/InitiateReturnModal';
import { QcModal } from './modals/QcModal';
import { ProcessRefundModal } from './modals/ProcessRefundModal';

// Lazy load modal - only loaded when user opens it
const CustomerDetailModal = lazy(() => import('../../components/orders/CustomerDetailModal'));

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
    const [returnPickupType, setReturnPickupType] = useState<'arranged_by_us' | 'customer_shipped'>('arranged_by_us');
    const [returnNotes, setReturnNotes] = useState('');
    const [exchangeSkuId, setExchangeSkuId] = useState('');

    // QC Modal state
    const [qcModalItem, setQcModalItem] = useState<RepackingQueueItem | null>(null);
    const [qcAction, setQcAction] = useState<'ready' | 'write_off'>('ready');
    const [qcComments, setQcComments] = useState('');
    const [writeOffReason, setWriteOffReason] = useState('');

    // Refund Modal state
    const [refundModalItem, setRefundModalItem] = useState<ServerReturnActionQueueItem | null>(null);

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

        // Batch all selected lines into single mutation call
        const lines = Array.from(selectedLines).map((lineId) => ({
            orderLineId: lineId,
            returnQty: returnQtyMap[lineId] || 1,
        }));

        initiateMutation.mutate({ data: {
            lines,
            returnReasonCategory: returnReasonCategory as 'fit_size' | 'product_quality' | 'product_different' | 'wrong_item_sent' | 'damaged_in_transit' | 'changed_mind' | 'other',
            returnReasonDetail,
            returnResolution,
            returnNotes,
            pickupType: returnPickupType,
            ...(returnResolution === 'exchange' && exchangeSkuId ? { exchangeSkuId } : {}),
        }});
    };

    const resetInitiateForm = () => {
        setOrderSearchTerm('');
        setSearchedOrder(null);
        setSelectedLines(new Set());
        setReturnQtyMap({});
        setReturnReasonCategory('');
        setReturnReasonDetail('');
        setReturnResolution('refund');
        setReturnPickupType('arranged_by_us');
        setReturnNotes('');
        setExchangeSkuId('');
    };

    const handleSchedulePickup = (lineId: string) => {
        schedulePickupMutation.mutate({ data: {
            orderLineId: lineId,
            pickupType: 'arranged_by_us',
            scheduleWithIthink: true,  // Actually book with iThink Logistics
        }});
    };

    const handleReceive = (lineId: string, condition: 'good' | 'damaged' | 'defective' | 'wrong_item' | 'used') => {
        receiveMutation.mutate({ data: {
            orderLineId: lineId,
            condition,
        }});
    };

    const handleProcessRefund = (lineId: string, item?: ServerReturnActionQueueItem) => {
        // Open refund modal with item details
        if (item) {
            setRefundModalItem(item);
        } else {
            // Fallback: find item in action queue
            const foundItem = actionQueue.find(q => q.id === lineId);
            if (foundItem) {
                setRefundModalItem(foundItem);
            } else {
                setError('Could not find return item details');
                setTimeout(() => setError(''), 3000);
            }
        }
    };

    const handleSubmitRefund = (
        lineId: string,
        grossAmount: number,
        discountClawback: number,
        deductions: number,
        deductionNotes?: string,
        refundMethod?: 'payment_link' | 'bank_transfer' | 'store_credit'
    ) => {
        processRefundMutation.mutate({
            data: {
                orderLineId: lineId,
                grossAmount,
                discountClawback,
                deductions,
                ...(deductionNotes ? { deductionNotes } : {}),
                ...(refundMethod ? { refundMethod } : {}),
            },
        });
        setRefundModalItem(null);
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
                    returnPickupType={returnPickupType}
                    setReturnPickupType={setReturnPickupType}
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

            {/* Refund Modal */}
            {refundModalItem && (
                <ProcessRefundModal
                    item={refundModalItem}
                    onSubmit={handleSubmitRefund}
                    onClose={() => setRefundModalItem(null)}
                />
            )}

            {/* Customer Detail Modal (lazy loaded) */}
            <Suspense fallback={null}>
                {selectedCustomerId && (
                    <CustomerDetailModal
                        customerId={selectedCustomerId}
                        onClose={() => setSelectedCustomerId(null)}
                    />
                )}
            </Suspense>
        </div>
    );
}
