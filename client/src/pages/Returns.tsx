/**
 * Unified Returns Hub
 * Single page with 5 tabs: Action Queue, Tickets, Receive, QC Queue, Analytics
 */

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { returnsApi, customersApi, ordersApi, repackingApi } from '../services/api';
import { useState, useRef, useEffect } from 'react';
import {
    AlertTriangle, Plus, X, Search, Package, Truck, Check, Trash2,
    Crown, Medal, Eye, Scan, PackageCheck, History,
    AlertCircle, CheckCircle, RotateCcw, ArrowRight,
    DollarSign, Clock
} from 'lucide-react';
import { CustomerDetailModal } from '../components/orders/CustomerDetailModal';

// ============================================
// TYPES
// ============================================

interface OrderItem {
    orderLineId: string;
    skuId: string;
    skuCode: string;
    barcode: string | null;
    productName: string;
    colorName: string;
    size: string;
    qty: number;
    unitPrice?: number;
    imageUrl: string | null;
}

interface OrderDetails {
    id: string;
    orderNumber: string;
    shopifyOrderNumber: string | null;
    orderDate: string;
    shippedAt: string | null;
    deliveredAt: string | null;
    customer: {
        id: string;
        name: string;
        email: string;
        phone: string | null;
    } | null;
    items: OrderItem[];
}

interface ReturnLine {
    id: string;
    skuId: string;
    qty: number;
    unitPrice?: number;
    itemCondition: string | null;
    inspectionNotes?: string | null;
    sku: {
        id?: string;
        skuCode: string;
        barcode?: string | null;
        size: string;
        variation: {
            colorName: string;
            imageUrl: string | null;
            product: {
                name: string;
                imageUrl: string | null;
            };
        };
    };
}

interface ReturnRequest {
    id: string;
    requestNumber: string;
    requestType: 'return' | 'exchange';
    resolution?: string;
    status: string;
    reasonCategory: string;
    reasonDetails: string | null;
    createdAt: string;
    originalOrderId: string;
    originalOrder: {
        id: string;
        orderNumber: string;
        orderDate?: string;
        shippedAt?: string;
        deliveredAt?: string;
        customerName?: string;
    } | null;
    exchangeOrderId: string | null;
    exchangeOrder: {
        id: string;
        orderNumber: string;
        status: string;
        awbNumber?: string;
        courier?: string;
    } | null;
    reverseInTransitAt?: string | null;
    reverseReceived: boolean;
    reverseReceivedAt: string | null;
    forwardShippedAt?: string | null;
    forwardDelivered: boolean;
    forwardDeliveredAt: string | null;
    returnValue?: number;
    replacementValue?: number;
    valueDifference?: number;
    refundAmount?: number;
    customerId: string | null;
    customer: { id: string; name: string; firstName: string; lastName: string; email: string } | null;
    lines: ReturnLine[];
    shipping: Array<{ awbNumber: string; courier: string; direction?: string; notes?: string }>;
    reverseShipping?: { courier: string; awbNumber: string } | null;
    ageDays: number;
    customerLtv: number;
    customerOrderCount: number;
    customerTier: 'platinum' | 'gold' | 'silver' | 'bronze';
    matchingLine?: ReturnLine;
}

interface QueueItem {
    id: string;
    skuId: string;
    qty: number;
    condition: string;
    status: string;
    inspectionNotes: string | null;
    qcComments: string | null;
    writeOffReason: string | null;
    createdAt: string;
    processedAt: string | null;
    returnRequestId: string | null;
    returnRequest: {
        requestNumber: string;
        requestType: string;
        reasonCategory: string;
    } | null;
    processedBy: {
        id: string;
        name: string;
    } | null;
    skuCode: string;
    productName: string;
    colorName: string;
    size: string;
    imageUrl: string | null;
}

interface SkuInfo {
    id: string;
    skuCode: string;
    barcode: string | null;
    productName: string;
    colorName: string;
    size: string;
    imageUrl: string | null;
}

// ============================================
// CONSTANTS
// ============================================

const REASON_CATEGORIES = [
    { value: 'size_issue', label: 'Size Issue' },
    { value: 'color_mismatch', label: 'Color Mismatch' },
    { value: 'quality_defect', label: 'Quality Defect' },
    { value: 'wrong_item', label: 'Wrong Item Received' },
    { value: 'changed_mind', label: 'Changed Mind' },
    { value: 'damaged_in_transit', label: 'Damaged in Transit' },
    { value: 'other', label: 'Other' },
];

const CONDITIONS = [
    { value: 'good', label: 'Good Condition', description: 'Item is in resellable condition', color: 'green' },
    { value: 'used', label: 'Used / Worn', description: 'Item shows signs of use', color: 'yellow' },
    { value: 'damaged', label: 'Damaged', description: 'Item is damaged', color: 'red' },
    { value: 'wrong_product', label: 'Wrong Product', description: 'Different item than expected', color: 'orange' },
];

const WRITE_OFF_REASONS = [
    { value: 'damaged', label: 'Damaged - Not Repairable' },
    { value: 'defective', label: 'Manufacturing Defect' },
    { value: 'stained', label: 'Stained / Soiled' },
    { value: 'wrong_product', label: 'Wrong Product Received' },
    { value: 'destroyed', label: 'Destroyed / Unusable' },
    { value: 'other', label: 'Other' },
];

type TabType = 'actions' | 'tickets' | 'receive' | 'queue' | 'analytics';

// ============================================
// HELPERS
// ============================================

const formatDate = (dateString: string | null | undefined) => {
    if (!dateString) return null;
    const date = new Date(dateString);
    return date.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
};

const getStatusBadge = (status: string) => {
    const colors: Record<string, string> = {
        pending_pickup: 'bg-yellow-100 text-yellow-800',
        requested: 'bg-yellow-100 text-yellow-800',
        reverse_initiated: 'bg-blue-100 text-blue-800',
        in_transit: 'bg-purple-100 text-purple-800',
        received: 'bg-green-100 text-green-800',
        processing: 'bg-teal-100 text-teal-800',
        inspected: 'bg-teal-100 text-teal-800',
        completed: 'bg-gray-100 text-gray-800',
        resolved: 'bg-gray-100 text-gray-800',
        cancelled: 'bg-red-100 text-red-800',
    };
    return colors[status] || 'bg-gray-100 text-gray-800';
};

const getResolutionBadge = (resolution: string | undefined, requestType: string) => {
    if (!resolution) {
        return requestType === 'return'
            ? { label: 'Refund', color: 'bg-red-100 text-red-800' }
            : { label: 'Exchange', color: 'bg-blue-100 text-blue-800' };
    }
    const badges: Record<string, { label: string; color: string }> = {
        refund: { label: 'Refund', color: 'bg-red-100 text-red-800' },
        exchange_same: { label: 'Exchange', color: 'bg-blue-100 text-blue-800' },
        exchange_up: { label: 'Exchange +', color: 'bg-purple-100 text-purple-800' },
        exchange_down: { label: 'Exchange -', color: 'bg-indigo-100 text-indigo-800' },
    };
    return badges[resolution] || { label: resolution, color: 'bg-gray-100 text-gray-800' };
};

const getTierIcon = (tier: string) => {
    if (tier === 'platinum') return <Crown size={12} className="text-purple-600" />;
    if (tier === 'gold') return <Medal size={12} className="text-yellow-600" />;
    if (tier === 'silver') return <Medal size={12} className="text-gray-400" />;
    return null;
};

const getTierBadge = (tier: string) => {
    const colors: Record<string, string> = {
        platinum: 'bg-purple-100 text-purple-800',
        gold: 'bg-yellow-100 text-yellow-800',
        silver: 'bg-gray-100 text-gray-700',
        bronze: 'bg-orange-50 text-orange-700',
    };
    return colors[tier] || colors.bronze;
};

// ============================================
// MAIN COMPONENT
// ============================================

export default function Returns() {
    const queryClient = useQueryClient();
    const [tab, setTab] = useState<TabType>('actions');
    const [showModal, setShowModal] = useState(false);
    const [selectedRequest, setSelectedRequest] = useState<ReturnRequest | null>(null);
    const [deleteRequest, setDeleteRequest] = useState<ReturnRequest | null>(null);
    const [selectedCustomerId, setSelectedCustomerId] = useState<string | null>(null);
    const [selectedOrderId, setSelectedOrderId] = useState<string | null>(null);
    const [successMessage, setSuccessMessage] = useState('');
    const [error, setError] = useState('');

    // Receive tab state
    const [scanInput, setScanInput] = useState('');
    const [scannedSku, setScannedSku] = useState<SkuInfo | null>(null);
    const [matchingTickets, setMatchingTickets] = useState<ReturnRequest[]>([]);
    const [selectedTicket, setSelectedTicket] = useState<ReturnRequest | null>(null);
    const [selectedLine, setSelectedLine] = useState<ReturnLine | null>(null);
    const [selectedCondition, setSelectedCondition] = useState<string>('');
    const inputRef = useRef<HTMLInputElement>(null);

    // QC Modal state
    const [qcModalItem, setQcModalItem] = useState<QueueItem | null>(null);
    const [qcAction, setQcAction] = useState<'ready' | 'write_off'>('ready');
    const [qcComments, setQcComments] = useState('');
    const [writeOffReason, setWriteOffReason] = useState('');
    const [historyFilter, setHistoryFilter] = useState<'all' | 'ready' | 'write_off'>('all');
    const [queueSearchTerm, setQueueSearchTerm] = useState('');

    // ============================================
    // QUERIES
    // ============================================

    const { data: returns = [], isLoading } = useQuery({
        queryKey: ['returns'],
        queryFn: () => returnsApi.getAll().then((r) => r.data),
    });

    const { data: pendingTickets = [], isLoading: loadingTickets } = useQuery({
        queryKey: ['returns', 'pending'],
        queryFn: () => returnsApi.getPending().then((r) => r.data),
    });

    const { data: queueItems = [], isLoading: loadingQueue } = useQuery({
        queryKey: ['repacking-queue'],
        queryFn: async () => {
            const res = await repackingApi.getQueue({ limit: 100 });
            return (res.data as QueueItem[]).filter(item => item.returnRequestId);
        },
    });

    const { data: historyItems = [], isLoading: loadingHistory } = useQuery({
        queryKey: ['repacking-history', historyFilter],
        queryFn: async () => {
            const params = historyFilter === 'all' ? {} : { status: historyFilter as 'ready' | 'write_off' };
            const res = await repackingApi.getQueueHistory({ ...params, limit: 100 });
            return (res.data as QueueItem[]).filter(item => item.returnRequestId);
        },
        enabled: tab === 'queue',
    });

    const { data: analytics } = useQuery({
        queryKey: ['returnAnalytics'],
        queryFn: () => returnsApi.getAnalyticsByProduct().then((r) => r.data),
        enabled: tab === 'analytics',
    });

    // Action queue dashboard data
    const { data: actionQueue } = useQuery({
        queryKey: ['actionQueue'],
        queryFn: () => returnsApi.getActionQueue().then((r) => r.data),
        enabled: tab === 'actions',
        refetchInterval: 30000, // Refresh every 30 seconds
    });

    const { data: customerDetail, isLoading: loadingCustomer } = useQuery({
        queryKey: ['customer', selectedCustomerId],
        queryFn: () => customersApi.getById(selectedCustomerId!).then((r) => r.data),
        enabled: !!selectedCustomerId,
    });

    const { data: orderDetail, isLoading: loadingOrder } = useQuery({
        queryKey: ['order', selectedOrderId],
        queryFn: () => ordersApi.getById(selectedOrderId!).then((r) => r.data),
        enabled: !!selectedOrderId,
    });

    // ============================================
    // COMPUTED VALUES
    // ============================================

    // Action queue items
    const qcPendingCount = queueItems.length;
    const exchangesReadyToShip = returns?.filter((r: ReturnRequest) =>
        (r.resolution?.startsWith('exchange') || r.requestType === 'exchange') &&
        r.reverseInTransitAt &&
        !r.forwardShippedAt &&
        !r.forwardDelivered
    ) || [];
    const refundsPending = returns?.filter((r: ReturnRequest) =>
        (r.resolution === 'refund' || r.requestType === 'return') &&
        r.status === 'received' &&
        !r.refundAmount
    ) || [];

    const filteredQueueItems = queueSearchTerm.trim()
        ? queueItems.filter((item) => {
            const term = queueSearchTerm.toLowerCase();
            return (
                item.skuCode?.toLowerCase().includes(term) ||
                item.productName?.toLowerCase().includes(term) ||
                item.colorName?.toLowerCase().includes(term) ||
                item.returnRequest?.requestNumber?.toLowerCase().includes(term)
            );
        })
        : queueItems;

    // ============================================
    // MUTATIONS
    // ============================================

    const deleteMutation = useMutation({
        mutationFn: (id: string) => returnsApi.delete(id),
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ['returns'] });
            setDeleteRequest(null);
        },
    });

    const searchMutation = useMutation({
        mutationFn: (code: string) => returnsApi.findBySkuCode(code),
        onSuccess: (res) => {
            const { sku, tickets } = res.data;
            setScannedSku(sku);
            setMatchingTickets(tickets);
            setError('');

            if (tickets.length === 0) {
                setError('No pending return tickets found for this item. Create a return request first.');
            } else if (tickets.length === 1) {
                const ticket = tickets[0];
                const line = ticket.matchingLine || ticket.lines.find((l: ReturnLine) => l.skuId === sku.id && !l.itemCondition);
                setSelectedTicket(ticket);
                setSelectedLine(line);
            }
        },
        onError: (err: any) => {
            setError(err.response?.data?.error || 'Failed to search');
            setScannedSku(null);
            setMatchingTickets([]);
        },
    });

    const receiveMutation = useMutation({
        mutationFn: ({ requestId, lineId, condition }: { requestId: string; lineId: string; condition: string }) =>
            returnsApi.receiveItem(requestId, { lineId, condition: condition as any }),
        onSuccess: (res) => {
            setSuccessMessage(`${res.data.sku.skuCode} received and added to QC queue`);
            queryClient.invalidateQueries({ queryKey: ['returns'] });
            queryClient.invalidateQueries({ queryKey: ['repacking-queue'] });
            resetReceiveState();
            inputRef.current?.focus();
        },
        onError: (err: any) => {
            setError(err.response?.data?.error || 'Failed to receive item');
        },
    });

    const processMutation = useMutation({
        mutationFn: ({ itemId, action, qcComments, writeOffReason }: {
            itemId: string;
            action: 'ready' | 'write_off';
            qcComments?: string;
            writeOffReason?: string
        }) => repackingApi.process({ itemId, action, qcComments, writeOffReason }),
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ['repacking-queue'] });
            queryClient.invalidateQueries({ queryKey: ['repacking-history'] });
            setSuccessMessage('Item processed successfully');
            closeQcModal();
        },
        onError: (err: any) => {
            setError(err.response?.data?.error || 'Failed to process item');
        },
    });

    const undoMutation = useMutation({
        mutationFn: (itemId: string) => repackingApi.undoProcess(itemId),
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ['repacking-queue'] });
            queryClient.invalidateQueries({ queryKey: ['repacking-history'] });
            setSuccessMessage('Item moved back to QC queue');
        },
        onError: (err: any) => {
            setError(err.response?.data?.error || 'Failed to undo');
        },
    });

    const removeFromQueueMutation = useMutation({
        mutationFn: (itemId: string) => repackingApi.deleteQueueItem(itemId),
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ['repacking-queue'] });
            queryClient.invalidateQueries({ queryKey: ['returns', 'pending'] });
            setSuccessMessage('Item removed from QC queue');
        },
        onError: (err: any) => {
            setError(err.response?.data?.error || 'Failed to remove item');
        },
    });

    // ============================================
    // EFFECTS
    // ============================================

    useEffect(() => {
        if (tab === 'receive') {
            inputRef.current?.focus();
        }
    }, [tab]);

    useEffect(() => {
        if (successMessage) {
            const timer = setTimeout(() => setSuccessMessage(''), 3000);
            return () => clearTimeout(timer);
        }
    }, [successMessage]);

    // ============================================
    // HANDLERS
    // ============================================

    const handleScan = () => {
        if (!scanInput.trim()) return;
        searchMutation.mutate(scanInput.trim());
        setScanInput('');
    };

    const handleSelectTicket = (ticket: ReturnRequest) => {
        const line = ticket.matchingLine || ticket.lines.find((l) => l.sku?.id === scannedSku?.id && !l.itemCondition);
        setSelectedTicket(ticket);
        setSelectedLine(line || null);
    };

    const handleReceive = () => {
        if (!selectedTicket || !selectedLine || !selectedCondition) {
            setError('Please select a condition');
            return;
        }
        receiveMutation.mutate({
            requestId: selectedTicket.id,
            lineId: selectedLine.id,
            condition: selectedCondition,
        });
    };

    const resetReceiveState = () => {
        setScannedSku(null);
        setMatchingTickets([]);
        setSelectedTicket(null);
        setSelectedLine(null);
        setSelectedCondition('');
        setError('');
    };

    const openQcModal = (item: QueueItem, action: 'ready' | 'write_off') => {
        setQcModalItem(item);
        setQcAction(action);
        setQcComments('');
        setWriteOffReason(action === 'write_off' ? 'damaged' : '');
    };

    const closeQcModal = () => {
        setQcModalItem(null);
        setQcAction('ready');
        setQcComments('');
        setWriteOffReason('');
    };

    const handleQcSubmit = () => {
        if (!qcModalItem) return;
        if (qcAction === 'write_off' && !writeOffReason) {
            setError('Please select a write-off reason');
            return;
        }
        processMutation.mutate({
            itemId: qcModalItem.id,
            action: qcAction,
            qcComments: qcComments || undefined,
            writeOffReason: qcAction === 'write_off' ? writeOffReason : undefined,
        });
    };

    const canDelete = (r: ReturnRequest) => {
        const hasReceivedItems = r.lines?.some((l) => l.itemCondition !== null);
        return !hasReceivedItems && !['resolved', 'completed'].includes(r.status);
    };

    // ============================================
    // RENDER
    // ============================================

    if (isLoading) {
        return (
            <div className="flex justify-center p-8">
                <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary-600"></div>
            </div>
        );
    }

    return (
        <div className="space-y-4 md:space-y-6">
            {/* Header */}
            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
                <h1 className="text-xl md:text-2xl font-bold text-gray-900">Returns Hub</h1>
                <button className="btn-primary w-full sm:w-auto justify-center" onClick={() => setShowModal(true)}>
                    <Plus size={16} className="mr-2" />
                    New Return Request
                </button>
            </div>

            {/* Tabs */}
            <div className="flex gap-1 border-b overflow-x-auto">
                <button
                    className={`px-4 py-2 font-medium whitespace-nowrap flex items-center gap-2 ${tab === 'actions' ? 'text-primary-600 border-b-2 border-primary-600' : 'text-gray-500'}`}
                    onClick={() => setTab('actions')}
                >
                    <Clock size={16} />
                    Action Queue
                    {(qcPendingCount + exchangesReadyToShip.length + refundsPending.length) > 0 && (
                        <span className="bg-red-500 text-white text-xs px-1.5 py-0.5 rounded-full">
                            {qcPendingCount + exchangesReadyToShip.length + refundsPending.length}
                        </span>
                    )}
                </button>
                <button
                    className={`px-4 py-2 font-medium whitespace-nowrap flex items-center gap-2 ${tab === 'tickets' ? 'text-primary-600 border-b-2 border-primary-600' : 'text-gray-500'}`}
                    onClick={() => setTab('tickets')}
                >
                    <Package size={16} />
                    All Tickets ({returns?.length || 0})
                </button>
                <button
                    className={`px-4 py-2 font-medium whitespace-nowrap flex items-center gap-2 ${tab === 'receive' ? 'text-primary-600 border-b-2 border-primary-600' : 'text-gray-500'}`}
                    onClick={() => setTab('receive')}
                >
                    <Scan size={16} />
                    Receive Items
                </button>
                <button
                    className={`px-4 py-2 font-medium whitespace-nowrap flex items-center gap-2 ${tab === 'queue' ? 'text-primary-600 border-b-2 border-primary-600' : 'text-gray-500'}`}
                    onClick={() => setTab('queue')}
                >
                    <PackageCheck size={16} />
                    QC Queue
                    {qcPendingCount > 0 && (
                        <span className="bg-yellow-500 text-white text-xs px-1.5 py-0.5 rounded-full">
                            {qcPendingCount}
                        </span>
                    )}
                </button>
                <button
                    className={`px-4 py-2 font-medium whitespace-nowrap flex items-center gap-2 ${tab === 'analytics' ? 'text-primary-600 border-b-2 border-primary-600' : 'text-gray-500'}`}
                    onClick={() => setTab('analytics')}
                >
                    <AlertTriangle size={16} />
                    Analytics
                </button>
            </div>

            {/* Messages */}
            {successMessage && (
                <div className="p-4 bg-green-50 border border-green-200 rounded-lg flex items-center gap-3">
                    <CheckCircle className="text-green-500" size={20} />
                    <span className="text-green-800">{successMessage}</span>
                </div>
            )}
            {error && (
                <div className="p-4 bg-red-50 border border-red-200 rounded-lg flex items-center gap-3">
                    <AlertCircle className="text-red-500" size={20} />
                    <span className="text-red-800">{error}</span>
                    <button onClick={() => setError('')} className="ml-auto text-red-500 hover:text-red-700">
                        <X size={18} />
                    </button>
                </div>
            )}

            {/* ============================================ */}
            {/* TAB 1: ACTION QUEUE */}
            {/* ============================================ */}
            {tab === 'actions' && (
                <div className="space-y-6">
                    {/* Stats Cards */}
                    <div className="grid grid-cols-4 gap-4">
                        <div className="card bg-yellow-50 border-yellow-200">
                            <div className="text-yellow-600 text-sm font-medium">Pickup Pending</div>
                            <div className="text-2xl font-bold text-yellow-800">
                                {actionQueue?.summary?.pendingPickup || 0}
                            </div>
                        </div>
                        <div className="card bg-purple-50 border-purple-200">
                            <div className="text-purple-600 text-sm font-medium">In Transit</div>
                            <div className="text-2xl font-bold text-purple-800">
                                {actionQueue?.summary?.inTransit || 0}
                            </div>
                        </div>
                        <div className="card bg-blue-50 border-blue-200">
                            <div className="text-blue-600 text-sm font-medium">QC Pending</div>
                            <div className="text-2xl font-bold text-blue-800">{actionQueue?.summary?.qcPending || qcPendingCount}</div>
                        </div>
                        <div className="card bg-green-50 border-green-200">
                            <div className="text-green-600 text-sm font-medium">Resolution Needed</div>
                            <div className="text-2xl font-bold text-green-800">
                                {(actionQueue?.summary?.exchangesReadyToShip || 0) + (actionQueue?.summary?.refundsPending || 0)}
                            </div>
                        </div>
                    </div>

                    {/* Action Sections */}
                    {(actionQueue?.actions?.shipReplacements?.length > 0 || exchangesReadyToShip.length > 0) && (
                        <div className="card">
                            <h3 className="font-semibold text-gray-900 mb-4 flex items-center gap-2">
                                <Truck size={18} className="text-blue-600" />
                                Ship Replacements ({actionQueue?.actions?.shipReplacements?.length || exchangesReadyToShip.length} ready)
                                <span className="text-xs font-normal text-gray-500">Reverse pickup confirmed</span>
                            </h3>
                            <div className="space-y-3">
                                {(actionQueue?.actions?.shipReplacements || []).slice(0, 5).map((item: { id: string; requestNumber: string; resolution: string; valueDifference?: number; customer?: { name: string }; originalOrder?: { orderNumber: string }; reverseAwb?: string }) => (
                                    <div key={item.id} className="flex items-center justify-between p-3 bg-blue-50 rounded-lg border border-blue-100">
                                        <div className="flex items-center gap-3">
                                            <div>
                                                <div className="font-medium">{item.requestNumber}</div>
                                                <div className="text-sm text-gray-600">
                                                    {item.customer?.name} • Order #{item.originalOrder?.orderNumber}
                                                </div>
                                                {item.reverseAwb && (
                                                    <div className="text-xs text-gray-500">AWB: {item.reverseAwb}</div>
                                                )}
                                            </div>
                                            <span className={`badge ${getResolutionBadge(item.resolution, 'exchange').color}`}>
                                                {getResolutionBadge(item.resolution, 'exchange').label}
                                            </span>
                                            {item.valueDifference && item.valueDifference > 0 && (
                                                <span className="text-sm text-purple-700 font-medium">
                                                    +₹{item.valueDifference}
                                                </span>
                                            )}
                                        </div>
                                        <div className="flex gap-2">
                                            <button
                                                onClick={() => {
                                                    const r = returns?.find((ret: ReturnRequest) => ret.id === item.id);
                                                    if (r) setSelectedRequest(r);
                                                }}
                                                className="btn-sm bg-blue-600 text-white hover:bg-blue-700"
                                            >
                                                <Package size={14} className="mr-1" />
                                                Ship Replacement
                                            </button>
                                        </div>
                                    </div>
                                ))}
                            </div>
                        </div>
                    )}

                    {(actionQueue?.summary?.qcPending || qcPendingCount) > 0 && (
                        <div className="card">
                            <h3 className="font-semibold text-gray-900 mb-4 flex items-center gap-2">
                                <PackageCheck size={18} className="text-yellow-600" />
                                Process QC ({actionQueue?.summary?.qcPending || qcPendingCount} items)
                            </h3>
                            <div className="flex items-center justify-between p-3 bg-yellow-50 rounded-lg border border-yellow-100">
                                <div className="text-gray-700">
                                    {actionQueue?.summary?.qcPending || qcPendingCount} item{(actionQueue?.summary?.qcPending || qcPendingCount) > 1 ? 's' : ''} waiting for quality check
                                </div>
                                <button
                                    onClick={() => setTab('queue')}
                                    className="btn-sm bg-yellow-600 text-white hover:bg-yellow-700"
                                >
                                    Go to QC Queue
                                    <ArrowRight size={14} className="ml-1" />
                                </button>
                            </div>
                        </div>
                    )}

                    {(actionQueue?.actions?.processRefunds?.length > 0 || refundsPending.length > 0) && (
                        <div className="card">
                            <h3 className="font-semibold text-gray-900 mb-4 flex items-center gap-2">
                                <DollarSign size={18} className="text-green-600" />
                                Process Refunds ({actionQueue?.actions?.processRefunds?.length || refundsPending.length} pending)
                            </h3>
                            <div className="space-y-3">
                                {(actionQueue?.actions?.processRefunds || []).slice(0, 5).map((item: { id: string; requestNumber: string; returnValue?: number; customer?: { name: string }; originalOrder?: { orderNumber: string; totalAmount?: number }; lines?: Array<{ skuCode?: string; productName?: string; qty?: number; mrp?: number }> }) => (
                                    <div key={item.id} className="flex items-center justify-between p-3 bg-green-50 rounded-lg border border-green-100">
                                        <div className="flex items-center gap-3">
                                            <div>
                                                <div className="font-medium">{item.requestNumber}</div>
                                                <div className="text-sm text-gray-600">
                                                    {item.customer?.name} • Order #{item.originalOrder?.orderNumber}
                                                </div>
                                                {item.lines && item.lines.length > 0 && (
                                                    <div className="text-xs text-gray-500">
                                                        {item.lines.map(l => `${l.skuCode} (${l.qty})`).join(', ')}
                                                    </div>
                                                )}
                                            </div>
                                            <span className="text-sm font-medium text-green-700">
                                                ₹{item.returnValue || item.lines?.reduce((sum, l) => sum + ((l.mrp || 0) * (l.qty || 1)), 0) || 0}
                                            </span>
                                        </div>
                                        <button
                                            onClick={() => {
                                                const r = returns?.find((ret: ReturnRequest) => ret.id === item.id);
                                                if (r) setSelectedRequest(r);
                                            }}
                                            className="btn-sm bg-green-600 text-white hover:bg-green-700"
                                        >
                                            <DollarSign size={14} className="mr-1" />
                                            Process Refund
                                        </button>
                                    </div>
                                ))}
                            </div>
                        </div>
                    )}

                    {qcPendingCount === 0 && exchangesReadyToShip.length === 0 && refundsPending.length === 0 && (
                        <div className="card text-center py-12">
                            <CheckCircle size={48} className="mx-auto text-green-400 mb-4" />
                            <h3 className="text-lg font-medium text-gray-900">All caught up!</h3>
                            <p className="text-gray-500 mt-2">No pending actions at the moment.</p>
                        </div>
                    )}
                </div>
            )}

            {/* ============================================ */}
            {/* TAB 2: ALL TICKETS */}
            {/* ============================================ */}
            {tab === 'tickets' && (
                <div className="card overflow-x-auto">
                    <table className="w-full">
                        <thead>
                            <tr className="border-b">
                                <th className="table-header">Request #</th>
                                <th className="table-header">Type</th>
                                <th className="table-header">Order</th>
                                <th className="table-header">Customer</th>
                                <th className="table-header">Item</th>
                                <th className="table-header">Reason</th>
                                <th className="table-header">AWB</th>
                                <th className="table-header text-right">Age</th>
                                <th className="table-header">Status</th>
                                <th className="table-header">Actions</th>
                            </tr>
                        </thead>
                        <tbody>
                            {returns?.map((r: ReturnRequest) => (
                                <tr key={r.id} className="border-b last:border-0 hover:bg-gray-50">
                                    <td className="table-cell">
                                        <button
                                            onClick={() => setSelectedRequest(r)}
                                            className="font-medium text-primary-600 hover:text-primary-800 hover:underline"
                                        >
                                            {r.requestNumber}
                                        </button>
                                    </td>
                                    <td className="table-cell">
                                        <span className={`badge ${getResolutionBadge(r.resolution, r.requestType).color}`}>
                                            {getResolutionBadge(r.resolution, r.requestType).label}
                                        </span>
                                    </td>
                                    <td className="table-cell">
                                        <button
                                            onClick={() => setSelectedOrderId(r.originalOrder?.id || null)}
                                            className="text-primary-600 hover:text-primary-800 hover:underline font-medium"
                                        >
                                            {r.originalOrder?.orderNumber}
                                        </button>
                                    </td>
                                    <td className="table-cell">
                                        {r.customer ? (
                                            <button
                                                onClick={() => setSelectedCustomerId(r.customer?.id || null)}
                                                className="flex items-center gap-1.5 text-primary-600 hover:text-primary-800 hover:underline"
                                            >
                                                {getTierIcon(r.customerTier)}
                                                <span className="text-sm">{r.customer.firstName || r.customer.name?.split(' ')[0]}</span>
                                                {r.customerLtv > 0 && (
                                                    <span className={`badge text-xs ${getTierBadge(r.customerTier)}`}>
                                                        ₹{(r.customerLtv / 1000).toFixed(0)}k
                                                    </span>
                                                )}
                                            </button>
                                        ) : (
                                            <span className="text-gray-400">-</span>
                                        )}
                                    </td>
                                    <td className="table-cell">
                                        {r.lines?.slice(0, 1).map((l, i) => {
                                            const imageUrl = l.sku?.variation?.imageUrl || l.sku?.variation?.product?.imageUrl;
                                            return (
                                                <div key={i} className="flex items-center gap-2">
                                                    {imageUrl && (
                                                        <img src={imageUrl} alt="" className="w-10 h-10 object-cover rounded" />
                                                    )}
                                                    <div className="min-w-0">
                                                        <div className="text-sm font-medium truncate max-w-[150px]">
                                                            {l.sku?.variation?.product?.name}
                                                        </div>
                                                        <div className="text-xs text-gray-500">
                                                            {l.sku?.variation?.colorName} / {l.sku?.size}
                                                            {l.itemCondition && <Check size={10} className="inline ml-1 text-green-500" />}
                                                        </div>
                                                    </div>
                                                </div>
                                            );
                                        })}
                                        {r.lines?.length > 1 && (
                                            <div className="text-xs text-gray-400 mt-1">+{r.lines.length - 1} more</div>
                                        )}
                                    </td>
                                    <td className="table-cell text-sm">{r.reasonCategory?.replace(/_/g, ' ')}</td>
                                    <td className="table-cell text-xs">{r.shipping?.[0]?.awbNumber || '-'}</td>
                                    <td className="table-cell text-right">{r.ageDays}d</td>
                                    <td className="table-cell">
                                        <span className={`badge ${getStatusBadge(r.status)}`}>
                                            {r.status.replace(/_/g, ' ')}
                                        </span>
                                    </td>
                                    <td className="table-cell">
                                        <div className="flex gap-1">
                                            <button
                                                onClick={() => setSelectedRequest(r)}
                                                className="p-1 text-gray-400 hover:text-primary-600"
                                                title="View / Edit"
                                            >
                                                <Eye size={14} />
                                            </button>
                                            {canDelete(r) && (
                                                <button
                                                    onClick={() => setDeleteRequest(r)}
                                                    className="p-1 text-gray-400 hover:text-red-600"
                                                    title="Delete"
                                                >
                                                    <Trash2 size={14} />
                                                </button>
                                            )}
                                        </div>
                                    </td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                    {returns?.length === 0 && (
                        <p className="text-center py-8 text-gray-500">No returns found</p>
                    )}
                </div>
            )}

            {/* ============================================ */}
            {/* TAB 3: RECEIVE ITEMS */}
            {/* ============================================ */}
            {tab === 'receive' && (
                <>
                    {/* Scan Input */}
                    <div className="card">
                        <div className="flex items-center gap-4">
                            <Scan size={24} className="text-gray-400" />
                            <input
                                ref={inputRef}
                                type="text"
                                className="input flex-1 text-lg"
                                placeholder="Scan barcode or enter SKU code..."
                                value={scanInput}
                                onChange={(e) => setScanInput(e.target.value)}
                                onKeyDown={(e) => e.key === 'Enter' && handleScan()}
                                autoFocus
                            />
                            <button
                                className="btn-primary"
                                onClick={handleScan}
                                disabled={!scanInput.trim() || searchMutation.isPending}
                            >
                                {searchMutation.isPending ? 'Searching...' : 'Search'}
                            </button>
                        </div>
                    </div>

                    <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                        {/* Left: Scanned Item & Matching Tickets */}
                        <div className="space-y-4">
                            {scannedSku && (
                                <div className="card">
                                    <h3 className="font-medium text-gray-900 mb-3">Scanned Item</h3>
                                    <div className="flex items-center gap-4">
                                        {scannedSku.imageUrl && (
                                            <img src={scannedSku.imageUrl} alt="" className="w-16 h-16 object-cover rounded" />
                                        )}
                                        <div>
                                            <div className="font-medium">{scannedSku.productName}</div>
                                            <div className="text-sm text-gray-500">{scannedSku.colorName} / {scannedSku.size}</div>
                                            <div className="text-sm font-mono text-gray-600">{scannedSku.skuCode}</div>
                                        </div>
                                    </div>
                                </div>
                            )}

                            {scannedSku && matchingTickets.length > 0 && (
                                <div className="card">
                                    <h3 className="font-medium text-gray-900 mb-3">
                                        Matching Return Tickets ({matchingTickets.length})
                                    </h3>
                                    <div className="space-y-3 max-h-[400px] overflow-y-auto">
                                        {matchingTickets.map((ticket) => (
                                            <button
                                                key={ticket.id}
                                                onClick={() => handleSelectTicket(ticket)}
                                                className={`w-full text-left p-4 border rounded-lg transition-colors ${
                                                    selectedTicket?.id === ticket.id
                                                        ? 'border-primary-500 bg-primary-50 ring-2 ring-primary-200'
                                                        : 'border-gray-200 hover:bg-gray-50'
                                                }`}
                                            >
                                                <div className="flex items-center justify-between mb-2">
                                                    <span className="font-semibold">{ticket.requestNumber}</span>
                                                    <span className={`badge ${getStatusBadge(ticket.status)}`}>
                                                        {ticket.status.replace(/_/g, ' ')}
                                                    </span>
                                                </div>
                                                <div className="text-sm text-gray-600">
                                                    {ticket.customer?.name || ticket.originalOrder?.customerName}
                                                    <span className="mx-2">•</span>
                                                    Order #{ticket.originalOrder?.orderNumber}
                                                </div>
                                            </button>
                                        ))}
                                    </div>
                                </div>
                            )}

                            {!scannedSku && (
                                <div className="card">
                                    <h3 className="font-medium text-gray-900 mb-3">Pending Return Tickets</h3>
                                    {loadingTickets ? (
                                        <div className="flex justify-center py-8">
                                            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary-600" />
                                        </div>
                                    ) : pendingTickets?.length === 0 ? (
                                        <p className="text-center py-8 text-gray-500">No pending tickets</p>
                                    ) : (
                                        <div className="space-y-3 max-h-[500px] overflow-y-auto">
                                            {pendingTickets?.map((ticket: ReturnRequest) => (
                                                <div key={ticket.id} className="p-3 border border-gray-200 rounded-lg">
                                                    <div className="flex items-center justify-between mb-2">
                                                        <span className="font-semibold">{ticket.requestNumber}</span>
                                                        <span className={`badge ${getStatusBadge(ticket.status)}`}>
                                                            {ticket.status.replace(/_/g, ' ')}
                                                        </span>
                                                    </div>
                                                    <div className="text-sm text-gray-600">
                                                        {ticket.customer?.name || ticket.originalOrder?.customerName}
                                                    </div>
                                                    <div className="text-xs text-gray-500 mt-1">
                                                        {ticket.lines?.length} item{ticket.lines?.length > 1 ? 's' : ''}
                                                    </div>
                                                </div>
                                            ))}
                                        </div>
                                    )}
                                </div>
                            )}
                        </div>

                        {/* Right: Receive Panel */}
                        <div>
                            {selectedTicket && selectedLine ? (
                                <div className="card">
                                    <h3 className="font-medium text-gray-900 mb-4">Receive Item</h3>

                                    <div className="bg-gray-50 p-3 rounded-lg mb-4">
                                        <div className="flex justify-between">
                                            <span className="font-medium">{selectedTicket.requestNumber}</span>
                                            <span className={`badge ${getResolutionBadge(selectedTicket.resolution, selectedTicket.requestType).color}`}>
                                                {getResolutionBadge(selectedTicket.resolution, selectedTicket.requestType).label}
                                            </span>
                                        </div>
                                        <div className="text-sm text-gray-500 mt-1">
                                            Order #{selectedTicket.originalOrder?.orderNumber}
                                        </div>
                                    </div>

                                    <div className="flex items-center gap-4 p-3 border border-primary-200 bg-primary-50 rounded-lg mb-4">
                                        {selectedLine.sku.variation?.imageUrl && (
                                            <img src={selectedLine.sku.variation.imageUrl} alt="" className="w-14 h-14 object-cover rounded" />
                                        )}
                                        <div>
                                            <div className="font-medium">{selectedLine.sku.variation?.product?.name}</div>
                                            <div className="text-sm text-gray-600">
                                                {selectedLine.sku.variation?.colorName} / {selectedLine.sku.size}
                                            </div>
                                            <div className="text-sm font-mono">{selectedLine.sku.skuCode}</div>
                                        </div>
                                    </div>

                                    <div className="mb-4">
                                        <label className="block text-sm font-medium text-gray-700 mb-2">Item Condition *</label>
                                        <div className="space-y-2">
                                            {CONDITIONS.map((cond) => (
                                                <label
                                                    key={cond.value}
                                                    className={`flex items-center gap-3 p-3 border rounded-lg cursor-pointer transition-colors ${
                                                        selectedCondition === cond.value
                                                            ? cond.color === 'green' ? 'border-green-500 bg-green-50'
                                                            : cond.color === 'yellow' ? 'border-yellow-500 bg-yellow-50'
                                                            : cond.color === 'red' ? 'border-red-500 bg-red-50'
                                                            : 'border-orange-500 bg-orange-50'
                                                            : 'border-gray-200 hover:bg-gray-50'
                                                    }`}
                                                >
                                                    <input
                                                        type="radio"
                                                        name="condition"
                                                        value={cond.value}
                                                        checked={selectedCondition === cond.value}
                                                        onChange={() => setSelectedCondition(cond.value)}
                                                        className="h-4 w-4"
                                                    />
                                                    <div>
                                                        <div className="font-medium">{cond.label}</div>
                                                        <div className="text-sm text-gray-500">{cond.description}</div>
                                                    </div>
                                                </label>
                                            ))}
                                        </div>
                                    </div>

                                    <div className="flex gap-2">
                                        <button className="btn-secondary" onClick={resetReceiveState}>Cancel</button>
                                        <button
                                            className="btn-primary flex-1"
                                            onClick={handleReceive}
                                            disabled={!selectedCondition || receiveMutation.isPending}
                                        >
                                            {receiveMutation.isPending ? (
                                                <div className="animate-spin h-5 w-5 border-2 border-white border-t-transparent rounded-full" />
                                            ) : (
                                                <>
                                                    <Package size={16} className="mr-2" />
                                                    Receive & Add to QC Queue
                                                </>
                                            )}
                                        </button>
                                    </div>
                                </div>
                            ) : (
                                <div className="card">
                                    <div className="text-center py-8 text-gray-500">
                                        <Scan size={48} className="mx-auto mb-4 text-gray-300" />
                                        <p className="font-medium">Scan an item to begin</p>
                                        <p className="text-sm mt-2">
                                            Scan a barcode or enter SKU code to find matching return tickets
                                        </p>
                                    </div>
                                </div>
                            )}
                        </div>
                    </div>
                </>
            )}

            {/* ============================================ */}
            {/* TAB 4: QC QUEUE */}
            {/* ============================================ */}
            {tab === 'queue' && (
                <div className="space-y-6">
                    {/* Search Bar */}
                    <div className="card p-4">
                        <div className="flex items-center gap-4">
                            <div className="flex-1 relative">
                                <Scan className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" size={18} />
                                <input
                                    type="text"
                                    placeholder="Scan barcode or search SKU to find item in queue..."
                                    className="input pl-10 w-full"
                                    value={queueSearchTerm}
                                    onChange={(e) => setQueueSearchTerm(e.target.value)}
                                />
                            </div>
                            {queueSearchTerm && (
                                <button onClick={() => setQueueSearchTerm('')} className="p-2 text-gray-400 hover:text-gray-600">
                                    <X size={18} />
                                </button>
                            )}
                        </div>
                        {queueSearchTerm && (
                            <div className="mt-2 text-sm text-gray-500">
                                Showing {filteredQueueItems.length} of {queueItems.length} items
                            </div>
                        )}
                    </div>

                    {/* Queue Table */}
                    <div className="card">
                        <h3 className="text-lg font-semibold mb-4">QC Queue - Received Return Items</h3>
                        {loadingQueue ? (
                            <div className="flex justify-center py-8">
                                <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary-600" />
                            </div>
                        ) : filteredQueueItems.length === 0 ? (
                            <p className="text-center py-8 text-gray-500">
                                {queueSearchTerm ? 'No items match your search' : 'No items in QC queue'}
                            </p>
                        ) : (
                            <div className="overflow-x-auto">
                                <table className="w-full">
                                    <thead>
                                        <tr className="border-b">
                                            <th className="table-header">Item</th>
                                            <th className="table-header">SKU</th>
                                            <th className="table-header">Return Ticket</th>
                                            <th className="table-header">Condition</th>
                                            <th className="table-header">Received</th>
                                            <th className="table-header">Actions</th>
                                        </tr>
                                    </thead>
                                    <tbody>
                                        {filteredQueueItems.map((item) => {
                                            const isHighlighted = queueSearchTerm && (
                                                item.skuCode?.toLowerCase().includes(queueSearchTerm.toLowerCase()) ||
                                                item.productName?.toLowerCase().includes(queueSearchTerm.toLowerCase())
                                            );
                                            return (
                                                <tr key={item.id} className={`border-b last:border-0 hover:bg-gray-50 ${isHighlighted ? 'bg-blue-50' : ''}`}>
                                                    <td className="table-cell">
                                                        <div className="flex items-center gap-3">
                                                            {item.imageUrl && (
                                                                <img src={item.imageUrl} alt="" className="w-10 h-10 object-cover rounded" />
                                                            )}
                                                            <div>
                                                                <div className="font-medium text-sm">{item.productName}</div>
                                                                <div className="text-xs text-gray-500">{item.colorName} / {item.size}</div>
                                                            </div>
                                                        </div>
                                                    </td>
                                                    <td className="table-cell font-mono text-sm">{item.skuCode}</td>
                                                    <td className="table-cell text-sm">{item.returnRequest?.requestNumber || '-'}</td>
                                                    <td className="table-cell">
                                                        <span className={`badge ${
                                                            item.condition === 'good' ? 'bg-green-100 text-green-800' :
                                                            item.condition === 'used' ? 'bg-yellow-100 text-yellow-800' :
                                                            item.condition === 'damaged' ? 'bg-red-100 text-red-800' :
                                                            'bg-orange-100 text-orange-800'
                                                        }`}>
                                                            {item.condition}
                                                        </span>
                                                    </td>
                                                    <td className="table-cell text-sm text-gray-500">{formatDate(item.createdAt)}</td>
                                                    <td className="table-cell">
                                                        <div className="flex gap-1">
                                                            <button
                                                                onClick={() => openQcModal(item, 'ready')}
                                                                className="p-1.5 rounded text-green-600 hover:bg-green-50"
                                                                title="Accept - Add to Stock"
                                                            >
                                                                <Check size={16} />
                                                            </button>
                                                            <button
                                                                onClick={() => openQcModal(item, 'write_off')}
                                                                className="p-1.5 rounded text-red-600 hover:bg-red-50"
                                                                title="Reject - Write Off"
                                                            >
                                                                <Trash2 size={16} />
                                                            </button>
                                                            <button
                                                                onClick={() => {
                                                                    if (confirm('Remove from QC queue? This will undo the receive action.')) {
                                                                        removeFromQueueMutation.mutate(item.id);
                                                                    }
                                                                }}
                                                                className="p-1.5 rounded text-gray-500 hover:bg-gray-100"
                                                                title="Undo - Remove from queue"
                                                            >
                                                                <RotateCcw size={16} />
                                                            </button>
                                                        </div>
                                                    </td>
                                                </tr>
                                            );
                                        })}
                                    </tbody>
                                </table>
                            </div>
                        )}
                    </div>

                    {/* History Section */}
                    <div className="card">
                        <div className="flex items-center justify-between mb-4">
                            <h3 className="text-lg font-semibold flex items-center gap-2">
                                <History size={18} />
                                Processed History
                            </h3>
                            <div className="flex gap-2">
                                <button
                                    className={`px-3 py-1 text-sm rounded ${historyFilter === 'all' ? 'bg-gray-800 text-white' : 'bg-gray-100 text-gray-700'}`}
                                    onClick={() => setHistoryFilter('all')}
                                >
                                    All
                                </button>
                                <button
                                    className={`px-3 py-1 text-sm rounded ${historyFilter === 'ready' ? 'bg-green-600 text-white' : 'bg-green-100 text-green-700'}`}
                                    onClick={() => setHistoryFilter('ready')}
                                >
                                    Accepted
                                </button>
                                <button
                                    className={`px-3 py-1 text-sm rounded ${historyFilter === 'write_off' ? 'bg-red-600 text-white' : 'bg-red-100 text-red-700'}`}
                                    onClick={() => setHistoryFilter('write_off')}
                                >
                                    Rejected
                                </button>
                            </div>
                        </div>
                        {loadingHistory ? (
                            <div className="flex justify-center py-8">
                                <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary-600" />
                            </div>
                        ) : historyItems.length === 0 ? (
                            <p className="text-center py-8 text-gray-500">No processed items</p>
                        ) : (
                            <div className="overflow-x-auto">
                                <table className="w-full">
                                    <thead>
                                        <tr className="border-b">
                                            <th className="table-header">Item</th>
                                            <th className="table-header">SKU</th>
                                            <th className="table-header">Return Ticket</th>
                                            <th className="table-header">Result</th>
                                            <th className="table-header">Processed</th>
                                            <th className="table-header">Actions</th>
                                        </tr>
                                    </thead>
                                    <tbody>
                                        {historyItems.map((item) => (
                                            <tr key={item.id} className="border-b last:border-0 hover:bg-gray-50">
                                                <td className="table-cell">
                                                    <div className="flex items-center gap-3">
                                                        {item.imageUrl && (
                                                            <img src={item.imageUrl} alt="" className="w-10 h-10 object-cover rounded" />
                                                        )}
                                                        <div>
                                                            <div className="font-medium text-sm">{item.productName}</div>
                                                            <div className="text-xs text-gray-500">{item.colorName} / {item.size}</div>
                                                        </div>
                                                    </div>
                                                </td>
                                                <td className="table-cell font-mono text-sm">{item.skuCode}</td>
                                                <td className="table-cell text-sm">{item.returnRequest?.requestNumber || '-'}</td>
                                                <td className="table-cell">
                                                    {item.status === 'ready' ? (
                                                        <span className="badge bg-green-100 text-green-800">
                                                            <Check size={12} className="inline mr-1" />
                                                            Accepted
                                                        </span>
                                                    ) : (
                                                        <span className="badge bg-red-100 text-red-800">
                                                            <X size={12} className="inline mr-1" />
                                                            {item.writeOffReason || 'Rejected'}
                                                        </span>
                                                    )}
                                                </td>
                                                <td className="table-cell text-sm text-gray-500">
                                                    <div>{item.processedAt ? formatDate(item.processedAt) : '-'}</div>
                                                    {item.processedBy && <div className="text-xs">{item.processedBy.name}</div>}
                                                </td>
                                                <td className="table-cell">
                                                    <button
                                                        onClick={() => {
                                                            if (confirm('Undo? Item will move back to QC queue.')) {
                                                                undoMutation.mutate(item.id);
                                                            }
                                                        }}
                                                        className="btn-sm bg-gray-200 hover:bg-gray-300 text-gray-700"
                                                        title="Undo"
                                                    >
                                                        <RotateCcw size={14} />
                                                    </button>
                                                </td>
                                            </tr>
                                        ))}
                                    </tbody>
                                </table>
                            </div>
                        )}
                    </div>
                </div>
            )}

            {/* ============================================ */}
            {/* TAB 5: ANALYTICS */}
            {/* ============================================ */}
            {tab === 'analytics' && (
                <div className="card overflow-x-auto">
                    <h2 className="text-lg font-semibold mb-4">Return Rate by Product</h2>
                    <table className="w-full">
                        <thead>
                            <tr className="border-b">
                                <th className="table-header">Product</th>
                                <th className="table-header text-right">Sold</th>
                                <th className="table-header text-right">Returned</th>
                                <th className="table-header text-right">Rate</th>
                                <th className="table-header">Alert</th>
                            </tr>
                        </thead>
                        <tbody>
                            {analytics?.filter((a: any) => a.sold > 0).map((a: any) => (
                                <tr key={a.productId} className="border-b last:border-0">
                                    <td className="table-cell font-medium">{a.name}</td>
                                    <td className="table-cell text-right">{a.sold}</td>
                                    <td className="table-cell text-right">{a.returned}</td>
                                    <td className="table-cell text-right font-medium">{a.returnRate}%</td>
                                    <td className="table-cell">
                                        {parseFloat(a.returnRate) > 10 && (
                                            <AlertTriangle size={16} className="text-red-500" />
                                        )}
                                    </td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
            )}

            {/* ============================================ */}
            {/* MODALS */}
            {/* ============================================ */}

            {/* New Return Request Modal */}
            {showModal && (
                <NewReturnModal
                    onClose={() => setShowModal(false)}
                    onSuccess={() => {
                        setShowModal(false);
                        queryClient.invalidateQueries({ queryKey: ['returns'] });
                    }}
                />
            )}

            {/* Return Detail Modal */}
            {selectedRequest && (
                <ReturnDetailModal
                    request={selectedRequest}
                    onClose={() => setSelectedRequest(null)}
                    onSuccess={() => {
                        setSelectedRequest(null);
                        queryClient.invalidateQueries({ queryKey: ['returns'] });
                    }}
                />
            )}

            {/* Delete Confirmation */}
            {deleteRequest && (
                <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
                    <div className="bg-white rounded-lg shadow-xl w-full max-w-md p-6">
                        <h2 className="text-lg font-semibold text-gray-900 mb-4">Delete Return Request</h2>
                        <p className="text-gray-600 mb-6">
                            Are you sure you want to delete <span className="font-medium">{deleteRequest.requestNumber}</span>?
                        </p>
                        <div className="flex gap-3 justify-end">
                            <button className="btn-secondary" onClick={() => setDeleteRequest(null)} disabled={deleteMutation.isPending}>
                                Cancel
                            </button>
                            <button
                                className="btn-primary bg-red-600 hover:bg-red-700"
                                onClick={() => deleteMutation.mutate(deleteRequest.id)}
                                disabled={deleteMutation.isPending}
                            >
                                {deleteMutation.isPending ? 'Deleting...' : 'Delete'}
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {/* Customer Detail Modal */}
            {selectedCustomerId && (
                <CustomerDetailModal
                    customer={customerDetail}
                    isLoading={loadingCustomer}
                    onClose={() => setSelectedCustomerId(null)}
                />
            )}

            {/* Order Detail Modal */}
            {selectedOrderId && orderDetail && (
                <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
                    <div className="bg-white rounded-lg shadow-xl w-full max-w-2xl max-h-[90vh] overflow-hidden">
                        <div className="flex items-center justify-between p-4 border-b bg-gray-50">
                            <h2 className="text-lg font-bold text-gray-900">Order #{orderDetail.orderNumber}</h2>
                            <button onClick={() => setSelectedOrderId(null)} className="p-2 hover:bg-gray-200 rounded-lg">
                                <X size={20} />
                            </button>
                        </div>
                        <div className="p-4 overflow-y-auto max-h-[70vh]">
                            {loadingOrder ? (
                                <div className="flex justify-center py-8">
                                    <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary-600" />
                                </div>
                            ) : (
                                <div className="space-y-4">
                                    <div className="grid grid-cols-2 gap-4 text-sm">
                                        <div><span className="text-gray-500">Customer:</span> <span className="ml-2 font-medium">{orderDetail.customerName}</span></div>
                                        <div><span className="text-gray-500">Date:</span> <span className="ml-2">{new Date(orderDetail.orderDate).toLocaleDateString()}</span></div>
                                        <div><span className="text-gray-500">Status:</span> <span className="ml-2 capitalize">{orderDetail.status}</span></div>
                                        <div><span className="text-gray-500">Total:</span> <span className="ml-2 font-medium">₹{orderDetail.totalAmount?.toLocaleString()}</span></div>
                                    </div>
                                    <div className="border-t pt-4">
                                        <h3 className="font-medium mb-3">Items</h3>
                                        <div className="space-y-2">
                                            {orderDetail.orderLines?.map((line: any) => (
                                                <div key={line.id} className="flex items-center gap-3 p-2 bg-gray-50 rounded">
                                                    {(line.sku?.variation?.imageUrl || line.sku?.variation?.product?.imageUrl) && (
                                                        <img src={line.sku.variation.imageUrl || line.sku.variation.product.imageUrl} alt="" className="w-12 h-12 object-cover rounded" />
                                                    )}
                                                    <div className="flex-1 min-w-0">
                                                        <div className="font-medium text-sm">{line.sku?.variation?.product?.name}</div>
                                                        <div className="text-xs text-gray-500">{line.sku?.variation?.colorName} / {line.sku?.size}</div>
                                                    </div>
                                                    <div className="text-right">
                                                        <div className="text-sm font-medium">₹{line.unitPrice}</div>
                                                        <div className="text-xs text-gray-500">Qty: {line.qty}</div>
                                                    </div>
                                                </div>
                                            ))}
                                        </div>
                                    </div>
                                </div>
                            )}
                        </div>
                    </div>
                </div>
            )}

            {/* QC Modal */}
            {qcModalItem && (
                <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
                    <div className="bg-white rounded-lg shadow-xl w-full max-w-md mx-4">
                        <div className="flex items-center justify-between p-4 border-b">
                            <h3 className="text-lg font-semibold">
                                {qcAction === 'ready' ? 'Accept Item' : 'Reject Item'}
                            </h3>
                            <button onClick={closeQcModal} className="text-gray-400 hover:text-gray-600">
                                <X size={20} />
                            </button>
                        </div>
                        <div className="p-4 space-y-4">
                            <div className="flex items-center gap-4 p-3 bg-gray-50 rounded-lg">
                                {qcModalItem.imageUrl && (
                                    <img src={qcModalItem.imageUrl} alt="" className="w-14 h-14 object-cover rounded" />
                                )}
                                <div>
                                    <div className="font-medium">{qcModalItem.productName}</div>
                                    <div className="text-sm text-gray-600">{qcModalItem.colorName} / {qcModalItem.size}</div>
                                    <div className="text-sm font-mono">{qcModalItem.skuCode}</div>
                                </div>
                            </div>

                            <div className="flex gap-2">
                                <button
                                    className={`flex-1 py-2 rounded-lg font-medium ${qcAction === 'ready' ? 'bg-green-600 text-white' : 'bg-gray-100 text-gray-700 hover:bg-gray-200'}`}
                                    onClick={() => setQcAction('ready')}
                                >
                                    <Check size={16} className="inline mr-2" />
                                    Accept
                                </button>
                                <button
                                    className={`flex-1 py-2 rounded-lg font-medium ${qcAction === 'write_off' ? 'bg-red-600 text-white' : 'bg-gray-100 text-gray-700 hover:bg-gray-200'}`}
                                    onClick={() => setQcAction('write_off')}
                                >
                                    <X size={16} className="inline mr-2" />
                                    Reject
                                </button>
                            </div>

                            {qcAction === 'write_off' && (
                                <div>
                                    <label className="block text-sm font-medium text-gray-700 mb-1">Rejection Reason *</label>
                                    <select className="input" value={writeOffReason} onChange={(e) => setWriteOffReason(e.target.value)}>
                                        {WRITE_OFF_REASONS.map((r) => (
                                            <option key={r.value} value={r.value}>{r.label}</option>
                                        ))}
                                    </select>
                                </div>
                            )}

                            <div>
                                <label className="block text-sm font-medium text-gray-700 mb-1">QC Comments</label>
                                <textarea
                                    className="input"
                                    rows={3}
                                    placeholder="Add any notes..."
                                    value={qcComments}
                                    onChange={(e) => setQcComments(e.target.value)}
                                />
                            </div>
                        </div>
                        <div className="flex gap-2 p-4 border-t">
                            <button className="btn-secondary flex-1" onClick={closeQcModal}>Cancel</button>
                            <button
                                className={`flex-1 ${qcAction === 'ready' ? 'btn-primary bg-green-600 hover:bg-green-700' : 'btn-primary bg-red-600 hover:bg-red-700'}`}
                                onClick={handleQcSubmit}
                                disabled={processMutation.isPending}
                            >
                                {processMutation.isPending ? (
                                    <div className="animate-spin h-5 w-5 border-2 border-white border-t-transparent rounded-full mx-auto" />
                                ) : qcAction === 'ready' ? 'Accept & Add to Stock' : 'Reject & Write Off'}
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}

// ============================================
// NEW RETURN MODAL (Simplified for now - full resolution selection in Phase 4)
// ============================================

type ResolutionType = 'refund' | 'exchange_same' | 'exchange_up' | 'exchange_down';

function NewReturnModal({ onClose, onSuccess }: { onClose: () => void; onSuccess: () => void }) {
    const [step, setStep] = useState<1 | 2 | 3>(1);
    const [orderNumber, setOrderNumber] = useState('');
    const [order, setOrder] = useState<OrderDetails | null>(null);
    const [selectedItems, setSelectedItems] = useState<string[]>([]);
    const [resolution, setResolution] = useState<ResolutionType>('refund');
    const [reasonCategory, setReasonCategory] = useState('');
    const [reasonDetails, setReasonDetails] = useState('');
    const [courier, setCourier] = useState('');
    const [awbNumber, setAwbNumber] = useState('');
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState('');
    const inputRef = useRef<HTMLInputElement>(null);

    // Calculate return value based on selected items
    const returnValue = order?.items
        .filter((item) => selectedItems.includes(item.skuId))
        .reduce((sum, item) => sum + (item.unitPrice || 0) * item.qty, 0) || 0;

    useEffect(() => {
        if (step === 1) inputRef.current?.focus();
    }, [step]);

    const searchOrder = async () => {
        if (!orderNumber.trim()) return;
        setLoading(true);
        setError('');
        try {
            const res = await returnsApi.getOrder(orderNumber.trim());
            setOrder(res.data);
            setStep(2);
        } catch (err: any) {
            setError(err.response?.data?.error || 'Order not found');
        } finally {
            setLoading(false);
        }
    };

    const toggleItem = (skuId: string) => {
        setSelectedItems((prev) => prev.includes(skuId) ? prev.filter((id) => id !== skuId) : [...prev, skuId]);
    };

    const createMutation = useMutation({
        mutationFn: (data: Parameters<typeof returnsApi.create>[0]) => returnsApi.create(data),
        onSuccess: () => onSuccess(),
        onError: (err: any) => setError(err.response?.data?.error || 'Failed to create return request'),
    });

    const handleSubmit = () => {
        if (!order || selectedItems.length === 0 || !reasonCategory) {
            setError('Please select items and provide a reason');
            return;
        }
        // Map resolution to requestType for backward compatibility
        const requestType = resolution === 'refund' ? 'return' : 'exchange';

        // Get selected item details with prices
        const selectedItemDetails = order.items.filter((item) => selectedItems.includes(item.skuId));

        createMutation.mutate({
            requestType,
            resolution,
            originalOrderId: order.id,
            reasonCategory,
            reasonDetails: reasonDetails || undefined,
            lines: selectedItemDetails.map((item) => ({
                skuId: item.skuId,
                qty: item.qty,
                unitPrice: item.unitPrice,
            })),
            returnValue: returnValue || undefined,
            courier: courier || undefined,
            awbNumber: awbNumber || undefined,
        });
    };

    return (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
            <div className="bg-white rounded-lg shadow-xl w-full max-w-2xl max-h-[90vh] overflow-hidden">
                <div className="flex items-center justify-between p-4 border-b">
                    <h2 className="text-lg font-semibold">New Return/Exchange Request</h2>
                    <button onClick={onClose} className="text-gray-400 hover:text-gray-600"><X size={20} /></button>
                </div>

                <div className="flex items-center justify-center gap-4 p-4 bg-gray-50 border-b">
                    {[1, 2, 3].map((s) => (
                        <div key={s} className={`flex items-center gap-2 ${step >= s ? 'text-primary-600' : 'text-gray-400'}`}>
                            <div className={`w-8 h-8 rounded-full flex items-center justify-center text-sm font-medium ${step >= s ? 'bg-primary-600 text-white' : 'bg-gray-200'}`}>
                                {s}
                            </div>
                            <span className="text-sm font-medium">{s === 1 ? 'Find Order' : s === 2 ? 'Select Items' : 'Details'}</span>
                            {s < 3 && <div className="w-8 h-px bg-gray-300" />}
                        </div>
                    ))}
                </div>

                <div className="p-6 overflow-y-auto max-h-[calc(90vh-200px)]">
                    {error && <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded-lg text-red-700 text-sm">{error}</div>}

                    {step === 1 && (
                        <div className="space-y-4">
                            <p className="text-gray-600">Enter the order number to start a return or exchange request.</p>
                            <div className="flex gap-2">
                                <input
                                    ref={inputRef}
                                    type="text"
                                    className="input flex-1"
                                    placeholder="Order number (e.g., 63814)"
                                    value={orderNumber}
                                    onChange={(e) => setOrderNumber(e.target.value)}
                                    onKeyDown={(e) => e.key === 'Enter' && searchOrder()}
                                />
                                <button className="btn-primary" onClick={searchOrder} disabled={loading || !orderNumber.trim()}>
                                    {loading ? <div className="animate-spin h-5 w-5 border-2 border-white border-t-transparent rounded-full" /> : <><Search size={16} className="mr-2" />Search</>}
                                </button>
                            </div>
                        </div>
                    )}

                    {step === 2 && order && (
                        <div className="space-y-4">
                            <div className="bg-gray-50 p-4 rounded-lg">
                                <div className="font-semibold text-lg">Order #{order.orderNumber}</div>
                                {order.customer && <div className="text-sm text-gray-600">{order.customer.name} • {order.customer.email}</div>}
                            </div>
                            <p className="text-gray-600">Select the items being returned:</p>
                            <div className="space-y-2">
                                {order.items.map((item) => (
                                    <label
                                        key={item.skuId}
                                        className={`flex items-center gap-3 p-3 border rounded-lg cursor-pointer ${selectedItems.includes(item.skuId) ? 'border-primary-500 bg-primary-50' : 'border-gray-200 hover:bg-gray-50'}`}
                                    >
                                        <input type="checkbox" checked={selectedItems.includes(item.skuId)} onChange={() => toggleItem(item.skuId)} className="h-4 w-4" />
                                        {item.imageUrl && <img src={item.imageUrl} alt="" className="w-12 h-12 object-cover rounded" />}
                                        <div className="flex-1">
                                            <div className="font-medium">{item.productName}</div>
                                            <div className="text-sm text-gray-500">{item.colorName} / {item.size} • {item.skuCode}</div>
                                        </div>
                                        {item.unitPrice && <span className="text-sm font-medium">₹{item.unitPrice}</span>}
                                    </label>
                                ))}
                            </div>
                            <div className="flex gap-2 pt-4">
                                <button className="btn-secondary" onClick={() => setStep(1)}>Back</button>
                                <button className="btn-primary flex-1" onClick={() => setStep(3)} disabled={selectedItems.length === 0}>
                                    Continue ({selectedItems.length} selected)
                                </button>
                            </div>
                        </div>
                    )}

                    {step === 3 && order && (
                        <div className="space-y-4">
                            {/* Return Value Summary */}
                            <div className="bg-gray-50 p-4 rounded-lg">
                                <div className="text-sm text-gray-600">Return Value</div>
                                <div className="text-2xl font-bold text-gray-900">₹{returnValue.toLocaleString()}</div>
                                <div className="text-xs text-gray-500">{selectedItems.length} item{selectedItems.length > 1 ? 's' : ''} selected</div>
                            </div>

                            {/* Resolution Type */}
                            <div>
                                <label className="block text-sm font-medium text-gray-700 mb-2">What does the customer want?</label>
                                <div className="grid grid-cols-2 gap-3">
                                    <label className={`p-4 border-2 rounded-lg cursor-pointer transition-colors ${resolution === 'refund' ? 'border-primary-500 bg-primary-50' : 'border-gray-200 hover:bg-gray-50'}`}>
                                        <input type="radio" className="sr-only" checked={resolution === 'refund'} onChange={() => setResolution('refund')} />
                                        <div className="flex items-center gap-2">
                                            <DollarSign size={20} className={resolution === 'refund' ? 'text-primary-600' : 'text-gray-400'} />
                                            <span className="font-medium">Full Refund</span>
                                        </div>
                                        <div className="text-sm text-gray-500 mt-1">Refund ₹{returnValue.toLocaleString()}</div>
                                    </label>
                                    <label className={`p-4 border-2 rounded-lg cursor-pointer transition-colors ${resolution === 'exchange_same' ? 'border-primary-500 bg-primary-50' : 'border-gray-200 hover:bg-gray-50'}`}>
                                        <input type="radio" className="sr-only" checked={resolution === 'exchange_same'} onChange={() => setResolution('exchange_same')} />
                                        <div className="flex items-center gap-2">
                                            <RotateCcw size={20} className={resolution === 'exchange_same' ? 'text-primary-600' : 'text-gray-400'} />
                                            <span className="font-medium">Exchange</span>
                                        </div>
                                        <div className="text-sm text-gray-500 mt-1">Same or different item</div>
                                    </label>
                                </div>
                                {resolution === 'exchange_same' && (
                                    <div className="mt-3 p-3 bg-blue-50 rounded-lg text-sm text-blue-800">
                                        <strong>Note:</strong> Replacement item will be selected after ticket is created. Value difference will be calculated then.
                                    </div>
                                )}
                            </div>
                            <div>
                                <label className="block text-sm font-medium text-gray-700 mb-1">Reason *</label>
                                <select className="input w-full" value={reasonCategory} onChange={(e) => setReasonCategory(e.target.value)}>
                                    <option value="">Select reason...</option>
                                    {REASON_CATEGORIES.map((r) => <option key={r.value} value={r.value}>{r.label}</option>)}
                                </select>
                            </div>
                            <div>
                                <label className="block text-sm font-medium text-gray-700 mb-1">Additional Details</label>
                                <textarea className="input w-full" rows={2} placeholder="Optional notes..." value={reasonDetails} onChange={(e) => setReasonDetails(e.target.value)} />
                            </div>
                            <div className="border-t pt-4">
                                <h3 className="font-medium text-gray-900 mb-3 flex items-center gap-2"><Truck size={16} />Reverse Pickup (Optional)</h3>
                                <div className="grid grid-cols-2 gap-4">
                                    <div>
                                        <label className="block text-sm font-medium text-gray-700 mb-1">Courier</label>
                                        <input type="text" className="input w-full" placeholder="e.g., Delhivery" value={courier} onChange={(e) => setCourier(e.target.value)} />
                                    </div>
                                    <div>
                                        <label className="block text-sm font-medium text-gray-700 mb-1">AWB Number</label>
                                        <input type="text" className="input w-full" placeholder="Tracking number" value={awbNumber} onChange={(e) => setAwbNumber(e.target.value)} />
                                    </div>
                                </div>
                            </div>
                            <div className="flex gap-2 pt-4">
                                <button className="btn-secondary" onClick={() => setStep(2)}>Back</button>
                                <button className="btn-primary flex-1" onClick={handleSubmit} disabled={!reasonCategory || createMutation.isPending}>
                                    {createMutation.isPending ? <div className="animate-spin h-5 w-5 border-2 border-white border-t-transparent rounded-full" /> : 'Create Return Request'}
                                </button>
                            </div>
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
}

// ============================================
// RETURN DETAIL MODAL (Keeping existing for now - will update in Phase 4)
// ============================================

function ReturnDetailModal({
    request,
    onClose,
    onSuccess,
}: {
    request: ReturnRequest;
    onClose: () => void;
    onSuccess: () => void;
}) {
    const [reasonCategory, setReasonCategory] = useState(request.reasonCategory);
    const [reasonDetails, setReasonDetails] = useState(request.reasonDetails || '');
    const [courier, setCourier] = useState(request.shipping?.[0]?.courier || '');
    const [awbNumber, setAwbNumber] = useState(request.shipping?.[0]?.awbNumber || '');
    const [error, setError] = useState('');
    const [localLines] = useState(request.lines || []);

    const updateMutation = useMutation({
        mutationFn: (data: Parameters<typeof returnsApi.update>[1]) => returnsApi.update(request.id, data),
        onSuccess: () => onSuccess(),
        onError: (err: any) => setError(err.response?.data?.error || 'Failed to update'),
    });

    const markReverseReceivedMutation = useMutation({
        mutationFn: () => returnsApi.markReverseReceived(request.id),
        onSuccess: () => onSuccess(),
    });

    const unmarkReverseReceivedMutation = useMutation({
        mutationFn: () => returnsApi.unmarkReverseReceived(request.id),
        onSuccess: () => onSuccess(),
    });

    const markForwardDeliveredMutation = useMutation({
        mutationFn: () => returnsApi.markForwardDelivered(request.id),
        onSuccess: () => onSuccess(),
    });

    const unmarkForwardDeliveredMutation = useMutation({
        mutationFn: () => returnsApi.unmarkForwardDelivered(request.id),
        onSuccess: () => onSuccess(),
    });

    const handleSubmit = () => {
        updateMutation.mutate({
            reasonCategory,
            reasonDetails: reasonDetails || undefined,
            courier: courier || undefined,
            awbNumber: awbNumber || undefined,
        });
    };

    const canModify = !['resolved', 'cancelled', 'completed'].includes(request.status);
    const resolutionInfo = getResolutionBadge(request.resolution, request.requestType);

    return (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
            <div className="bg-white rounded-lg shadow-xl w-full max-w-2xl max-h-[90vh] overflow-hidden flex flex-col">
                <div className="flex items-center justify-between p-4 border-b bg-gray-50">
                    <div>
                        <h2 className="text-lg font-bold text-gray-900">{request.requestNumber}</h2>
                        <div className="flex items-center gap-2 mt-1">
                            <span className={`badge text-xs ${resolutionInfo.color}`}>{resolutionInfo.label}</span>
                            <span className={`badge text-xs ${getStatusBadge(request.status)}`}>{request.status.replace(/_/g, ' ')}</span>
                        </div>
                    </div>
                    <button onClick={onClose} className="p-2 hover:bg-gray-200 rounded-lg"><X size={20} /></button>
                </div>

                <div className="flex-1 overflow-y-auto p-4 space-y-4">
                    {error && <div className="p-3 bg-red-50 border border-red-200 rounded-lg text-red-700 text-sm">{error}</div>}

                    {/* Customer Info */}
                    <div className="bg-gray-50 rounded-lg p-4">
                        <div className="flex items-center gap-3">
                            <div className="w-10 h-10 rounded-full bg-blue-100 flex items-center justify-center">
                                <span className="text-blue-700 font-semibold">{(request.customer?.name || 'U')[0].toUpperCase()}</span>
                            </div>
                            <div>
                                <div className="font-medium">{request.customer?.name || request.originalOrder?.customerName}</div>
                                <div className="text-xs text-gray-500">Order #{request.originalOrder?.orderNumber}</div>
                            </div>
                        </div>
                    </div>

                    {/* Items */}
                    <div>
                        <label className="block text-sm font-medium text-gray-700 mb-2">Items ({localLines.length})</label>
                        <div className="space-y-2">
                            {localLines.map((line) => {
                                const imageUrl = line.sku?.variation?.imageUrl || line.sku?.variation?.product?.imageUrl;
                                const isReceived = !!line.itemCondition;
                                return (
                                    <div key={line.id} className={`flex items-center gap-3 p-3 rounded-lg ${isReceived ? 'bg-green-50' : 'bg-gray-50'}`}>
                                        {imageUrl && <img src={imageUrl} alt="" className="w-12 h-12 object-cover rounded" />}
                                        <div className="flex-1">
                                            <div className="font-medium text-sm">{line.sku?.variation?.product?.name}</div>
                                            <div className="text-xs text-gray-500">{line.sku?.variation?.colorName} • {line.sku?.size}</div>
                                        </div>
                                        {isReceived ? (
                                            <span className="text-xs text-green-600 flex items-center gap-1"><Check size={12} />{line.itemCondition}</span>
                                        ) : (
                                            <span className="text-xs text-amber-600">Pending</span>
                                        )}
                                    </div>
                                );
                            })}
                        </div>
                    </div>

                    {/* Reason */}
                    <div>
                        <label className="block text-sm font-medium text-gray-700 mb-1">Reason</label>
                        <select className="input w-full" value={reasonCategory} onChange={(e) => setReasonCategory(e.target.value)} disabled={!canModify}>
                            {REASON_CATEGORIES.map((r) => <option key={r.value} value={r.value}>{r.label}</option>)}
                        </select>
                    </div>

                    <div>
                        <label className="block text-sm font-medium text-gray-700 mb-1">Additional Details</label>
                        <textarea className="input w-full" rows={2} value={reasonDetails} onChange={(e) => setReasonDetails(e.target.value)} disabled={!canModify} />
                    </div>

                    {/* Shipping */}
                    <div className="border-t pt-4">
                        <h3 className="font-medium text-gray-900 mb-3 flex items-center gap-2"><Truck size={16} />Reverse Pickup</h3>
                        <div className="grid grid-cols-2 gap-4">
                            <div>
                                <label className="block text-sm font-medium text-gray-700 mb-1">Courier</label>
                                <input type="text" className="input w-full" value={courier} onChange={(e) => setCourier(e.target.value)} disabled={!canModify} />
                            </div>
                            <div>
                                <label className="block text-sm font-medium text-gray-700 mb-1">AWB Number</label>
                                <input type="text" className="input w-full" value={awbNumber} onChange={(e) => setAwbNumber(e.target.value)} disabled={!canModify} />
                            </div>
                        </div>
                    </div>

                    {/* Exchange Tracking */}
                    {(request.requestType === 'exchange' || request.resolution?.startsWith('exchange')) && (
                        <div className="border-t pt-4">
                            <h3 className="font-medium text-gray-900 mb-3 flex items-center gap-2"><Package size={16} />Exchange Tracking</h3>
                            <div className="grid grid-cols-2 gap-4">
                                <div className={`p-3 rounded-lg border ${request.reverseReceived ? 'bg-green-50 border-green-200' : 'bg-gray-50'}`}>
                                    <div className="text-sm font-medium mb-2">Reverse Shipment</div>
                                    {request.reverseReceived ? (
                                        <div className="flex items-center justify-between">
                                            <span className="text-xs text-green-700">Received {formatDate(request.reverseReceivedAt)}</span>
                                            <button onClick={() => unmarkReverseReceivedMutation.mutate()} className="text-xs text-red-600">Undo</button>
                                        </div>
                                    ) : (
                                        <button onClick={() => markReverseReceivedMutation.mutate()} className="w-full text-xs bg-blue-600 text-white py-1 rounded">
                                            Mark Received
                                        </button>
                                    )}
                                </div>
                                <div className={`p-3 rounded-lg border ${request.forwardDelivered ? 'bg-green-50 border-green-200' : 'bg-gray-50'}`}>
                                    <div className="text-sm font-medium mb-2">Forward Shipment</div>
                                    {request.forwardDelivered ? (
                                        <div className="flex items-center justify-between">
                                            <span className="text-xs text-green-700">Delivered {formatDate(request.forwardDeliveredAt)}</span>
                                            <button onClick={() => unmarkForwardDeliveredMutation.mutate()} className="text-xs text-red-600">Undo</button>
                                        </div>
                                    ) : (
                                        <button onClick={() => markForwardDeliveredMutation.mutate()} className="w-full text-xs bg-blue-600 text-white py-1 rounded">
                                            Mark Delivered
                                        </button>
                                    )}
                                </div>
                            </div>
                            {request.reverseReceived && request.forwardDelivered && (
                                <div className="mt-3 p-2 bg-green-100 text-green-800 text-sm rounded-lg text-center">
                                    Exchange complete - auto-resolved
                                </div>
                            )}
                        </div>
                    )}
                </div>

                <div className="flex items-center justify-end gap-3 p-4 border-t bg-gray-50">
                    <button className="btn-secondary" onClick={onClose}>Close</button>
                    {canModify && (
                        <button className="btn-primary" onClick={handleSubmit} disabled={updateMutation.isPending}>
                            {updateMutation.isPending ? 'Saving...' : 'Save Changes'}
                        </button>
                    )}
                </div>
            </div>
        </div>
    );
}
