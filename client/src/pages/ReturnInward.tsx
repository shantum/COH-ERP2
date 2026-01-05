/**
 * Return Inward Page
 * Scan SKU → Find matching return tickets → Select ticket → Receive item into QC queue
 * Also shows the QC queue for processing received items
 */

import { useState, useRef, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { returnsApi, repackingApi } from '../services/api';
import { Scan, Package, Check, ArrowLeft, Truck, AlertCircle, CheckCircle, PackageCheck, Trash2, X, RotateCcw, History } from 'lucide-react';

interface ReturnLine {
    id: string;
    skuId: string;
    qty: number;
    itemCondition: string | null;
    sku: {
        id: string;
        skuCode: string;
        barcode: string | null;
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

interface ReturnTicket {
    id: string;
    requestNumber: string;
    requestType: 'return' | 'exchange';
    status: string;
    reasonCategory: string;
    reasonDetails: string | null;
    createdAt: string;
    ageDays: number;
    originalOrder: {
        id: string;
        orderNumber: string;
        orderDate?: string;
        shippedAt?: string;
        deliveredAt?: string;
        customerName?: string;
    };
    customer: {
        id: string;
        name: string;
        email: string;
    } | null;
    lines: ReturnLine[];
    reverseShipping: {
        courier: string;
        awbNumber: string;
    } | null;
    matchingLine?: ReturnLine;
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

type TabType = 'receive' | 'queue' | 'history';

// Format date as "27 Dec 2025"
const formatDate = (dateString: string) => {
    const date = new Date(dateString);
    return date.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
};

export default function ReturnInward() {
    const navigate = useNavigate();
    const queryClient = useQueryClient();
    const [tab, setTab] = useState<TabType>('receive');
    const [scanInput, setScanInput] = useState('');
    const [scannedSku, setScannedSku] = useState<SkuInfo | null>(null);
    const [matchingTickets, setMatchingTickets] = useState<ReturnTicket[]>([]);
    const [selectedTicket, setSelectedTicket] = useState<ReturnTicket | null>(null);
    const [selectedLine, setSelectedLine] = useState<ReturnLine | null>(null);
    const [selectedCondition, setSelectedCondition] = useState<string>('');
    const [error, setError] = useState('');
    const [successMessage, setSuccessMessage] = useState('');
    const inputRef = useRef<HTMLInputElement>(null);

    // QC Modal state
    const [qcModalItem, setQcModalItem] = useState<QueueItem | null>(null);
    const [qcAction, setQcAction] = useState<'ready' | 'write_off'>('ready');
    const [qcComments, setQcComments] = useState('');
    const [writeOffReason, setWriteOffReason] = useState('');
    const [historyFilter, setHistoryFilter] = useState<'all' | 'ready' | 'write_off'>('all');
    const [queueSearchTerm, setQueueSearchTerm] = useState('');

    // Fetch pending tickets
    const { data: pendingTickets, isLoading: loadingTickets } = useQuery({
        queryKey: ['returns', 'pending'],
        queryFn: () => returnsApi.getPending().then((r) => r.data),
    });

    // Fetch QC queue (repacking queue items from returns)
    const { data: queueItems = [], isLoading: loadingQueue } = useQuery({
        queryKey: ['repacking-queue'],
        queryFn: async () => {
            const res = await repackingApi.getQueue({ limit: 100 });
            // Filter to only show items from returns
            return (res.data as QueueItem[]).filter(item => item.returnRequestId);
        },
    });

    // Filter queue items based on search
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

    // Fetch processed history
    const { data: historyItems = [], isLoading: loadingHistory } = useQuery({
        queryKey: ['repacking-history', historyFilter],
        queryFn: async () => {
            const params = historyFilter === 'all' ? {} : { status: historyFilter as 'ready' | 'write_off' };
            const res = await repackingApi.getQueueHistory({ ...params, limit: 100 });
            // Filter to only show items from returns
            return (res.data as QueueItem[]).filter(item => item.returnRequestId);
        },
        enabled: tab === 'history',
    });

    // Process queue item mutation (add to stock)
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

    // Undo processed item
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

    // Remove item from QC queue (undo receive)
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

    useEffect(() => {
        if (tab === 'receive') {
            inputRef.current?.focus();
        }
    }, [tab]);

    // Auto-clear success message
    useEffect(() => {
        if (successMessage) {
            const timer = setTimeout(() => setSuccessMessage(''), 3000);
            return () => clearTimeout(timer);
        }
    }, [successMessage]);

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
                // Auto-select if only one ticket
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
            queryClient.invalidateQueries({ queryKey: ['returns', 'pending'] });
            queryClient.invalidateQueries({ queryKey: ['repacking-queue'] });
            resetState();
            inputRef.current?.focus();
        },
        onError: (err: any) => {
            setError(err.response?.data?.error || 'Failed to receive item');
        },
    });

    const handleScan = () => {
        if (!scanInput.trim()) return;
        searchMutation.mutate(scanInput.trim());
        setScanInput('');
    };

    const handleSelectTicket = (ticket: ReturnTicket) => {
        const line = ticket.matchingLine || ticket.lines.find((l) => l.skuId === scannedSku?.id && !l.itemCondition);
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

    const resetState = () => {
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

    const getStatusBadge = (status: string) => {
        const colors: Record<string, string> = {
            requested: 'bg-yellow-100 text-yellow-800',
            reverse_initiated: 'bg-blue-100 text-blue-800',
            in_transit: 'bg-purple-100 text-purple-800',
        };
        return colors[status] || 'bg-gray-100 text-gray-800';
    };

    return (
        <div className="space-y-6">
            {/* Header */}
            <div className="flex items-center justify-between">
                <div className="flex items-center gap-4">
                    <button onClick={() => navigate('/returns')} className="text-gray-500 hover:text-gray-700">
                        <ArrowLeft size={20} />
                    </button>
                    <h1 className="text-2xl font-bold text-gray-900">Return Inward</h1>
                </div>
                <div className="text-sm text-gray-500">
                    {pendingTickets?.length || 0} pending tickets • {queueItems.length} in QC queue
                </div>
            </div>

            {/* Tabs */}
            <div className="flex gap-2 border-b">
                <button
                    className={`px-4 py-2 font-medium ${tab === 'receive' ? 'text-primary-600 border-b-2 border-primary-600' : 'text-gray-500'}`}
                    onClick={() => setTab('receive')}
                >
                    <Package size={16} className="inline mr-2" />
                    Receive Items
                </button>
                <button
                    className={`px-4 py-2 font-medium ${tab === 'queue' ? 'text-primary-600 border-b-2 border-primary-600' : 'text-gray-500'}`}
                    onClick={() => setTab('queue')}
                >
                    <PackageCheck size={16} className="inline mr-2" />
                    QC Queue ({queueItems.length})
                </button>
                <button
                    className={`px-4 py-2 font-medium ${tab === 'history' ? 'text-primary-600 border-b-2 border-primary-600' : 'text-gray-500'}`}
                    onClick={() => setTab('history')}
                >
                    <History size={16} className="inline mr-2" />
                    Processed History
                </button>
            </div>

            {/* Success Message */}
            {successMessage && (
                <div className="p-4 bg-green-50 border border-green-200 rounded-lg flex items-center gap-3">
                    <CheckCircle className="text-green-500" size={20} />
                    <span className="text-green-800">{successMessage}</span>
                </div>
            )}

            {/* Error Message */}
            {error && (
                <div className="p-4 bg-red-50 border border-red-200 rounded-lg flex items-center gap-3">
                    <AlertCircle className="text-red-500" size={20} />
                    <span className="text-red-800">{error}</span>
                    <button onClick={() => setError('')} className="ml-auto text-red-500 hover:text-red-700">
                        &times;
                    </button>
                </div>
            )}

            {/* Receive Tab Content */}
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

                    {/* Main Content */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                {/* Left: Scanned Item & Matching Tickets */}
                <div className="space-y-4">
                    {/* Scanned Item Info */}
                    {scannedSku && (
                        <div className="card">
                            <h3 className="font-medium text-gray-900 mb-3">Scanned Item</h3>
                            <div className="flex items-center gap-4">
                                {scannedSku.imageUrl && (
                                    <img
                                        src={scannedSku.imageUrl}
                                        alt=""
                                        className="w-16 h-16 object-cover rounded"
                                    />
                                )}
                                <div>
                                    <div className="font-medium">{scannedSku.productName}</div>
                                    <div className="text-sm text-gray-500">
                                        {scannedSku.colorName} / {scannedSku.size}
                                    </div>
                                    <div className="text-sm font-mono text-gray-600">{scannedSku.skuCode}</div>
                                </div>
                            </div>
                        </div>
                    )}

                    {/* Matching Tickets */}
                    {scannedSku && matchingTickets.length > 0 && (
                        <div className="card">
                            <h3 className="font-medium text-gray-900 mb-3">
                                Matching Return Tickets ({matchingTickets.length})
                            </h3>
                            <div className="space-y-3">
                                {matchingTickets.map((ticket) => {
                                    const customerName = ticket.customer?.name || ticket.originalOrder.customerName || 'Unknown';
                                    const orderDate = ticket.originalOrder.orderDate
                                        ? formatDate(ticket.originalOrder.orderDate)
                                        : null;

                                    return (
                                        <button
                                            key={ticket.id}
                                            onClick={() => handleSelectTicket(ticket)}
                                            className={`w-full text-left p-4 border rounded-lg transition-colors ${
                                                selectedTicket?.id === ticket.id
                                                    ? 'border-primary-500 bg-primary-50 ring-2 ring-primary-200'
                                                    : 'border-gray-200 hover:bg-gray-50'
                                            }`}
                                        >
                                            {/* Header */}
                                            <div className="flex items-start justify-between mb-3">
                                                <div>
                                                    <div className="flex items-center gap-2">
                                                        <span className="font-semibold text-gray-900">{ticket.requestNumber}</span>
                                                        <span className={`badge text-xs ${ticket.requestType === 'return' ? 'bg-red-100 text-red-700' : 'bg-blue-100 text-blue-700'}`}>
                                                            {ticket.requestType}
                                                        </span>
                                                    </div>
                                                    <div className="text-sm text-gray-600 mt-0.5">
                                                        {customerName}
                                                    </div>
                                                </div>
                                                <span className={`badge ${getStatusBadge(ticket.status)}`}>
                                                    {ticket.status.replace(/_/g, ' ')}
                                                </span>
                                            </div>

                                            {/* Order Info */}
                                            <div className="text-xs text-gray-500 mb-3 pb-3 border-b space-y-1">
                                                <div className="flex items-center gap-2 flex-wrap">
                                                    <span className="font-medium text-gray-700">Order #{ticket.originalOrder.orderNumber}</span>
                                                    {ticket.reverseShipping && (
                                                        <span className="flex items-center gap-1 bg-purple-50 text-purple-700 px-2 py-0.5 rounded">
                                                            <Truck size={12} />
                                                            {ticket.reverseShipping.courier}
                                                        </span>
                                                    )}
                                                </div>
                                                <div className="grid grid-cols-2 gap-x-4 gap-y-1">
                                                    {orderDate && (
                                                        <div>
                                                            <span className="text-gray-400">Ordered:</span>{' '}
                                                            <span className="text-gray-600">{orderDate}</span>
                                                            <span className="text-amber-600 ml-1">({ticket.ageDays}d ago)</span>
                                                        </div>
                                                    )}
                                                    {ticket.originalOrder.shippedAt && (
                                                        <div>
                                                            <span className="text-gray-400">Shipped:</span>{' '}
                                                            <span className="text-gray-600">
                                                                {formatDate(ticket.originalOrder.shippedAt)}
                                                            </span>
                                                        </div>
                                                    )}
                                                    {ticket.originalOrder.deliveredAt && (
                                                        <div>
                                                            <span className="text-gray-400">Delivered:</span>{' '}
                                                            <span className="text-gray-600">
                                                                {formatDate(ticket.originalOrder.deliveredAt)}
                                                            </span>
                                                        </div>
                                                    )}
                                                    <div>
                                                        <span className="text-gray-400">Return requested:</span>{' '}
                                                        <span className="text-gray-600">
                                                            {formatDate(ticket.createdAt)}
                                                        </span>
                                                    </div>
                                                </div>
                                            </div>

                                            {/* Line Items */}
                                            <div className="space-y-2">
                                                {ticket.lines.map((line: ReturnLine) => {
                                                    const imageUrl = line.sku.variation?.imageUrl || line.sku.variation?.product?.imageUrl;
                                                    const isScannedItem = line.skuId === scannedSku?.id && !line.itemCondition;
                                                    const isReceived = !!line.itemCondition;

                                                    return (
                                                        <div
                                                            key={line.id}
                                                            className={`flex items-center gap-3 p-2 rounded ${
                                                                isScannedItem
                                                                    ? 'bg-primary-100 border-2 border-primary-400 ring-2 ring-primary-200'
                                                                    : isReceived
                                                                    ? 'bg-green-50'
                                                                    : 'bg-gray-50'
                                                            }`}
                                                        >
                                                            {imageUrl ? (
                                                                <img
                                                                    src={imageUrl}
                                                                    alt=""
                                                                    className="w-12 h-12 object-cover rounded"
                                                                />
                                                            ) : (
                                                                <div className="w-12 h-12 bg-gray-200 rounded flex items-center justify-center">
                                                                    <Package size={20} className="text-gray-400" />
                                                                </div>
                                                            )}
                                                            <div className="flex-1 min-w-0">
                                                                <div className={`font-medium text-sm truncate ${
                                                                    isScannedItem ? 'text-primary-800' : isReceived ? 'text-green-700' : 'text-gray-900'
                                                                }`}>
                                                                    {line.sku.variation?.product?.name || 'Unknown Product'}
                                                                </div>
                                                                <div className="text-xs text-gray-500">
                                                                    {line.sku.variation?.colorName} • {line.sku.size} • {line.sku.skuCode}
                                                                </div>
                                                            </div>
                                                            <div className="text-right">
                                                                {isScannedItem ? (
                                                                    <span className="flex items-center gap-1 text-primary-700 text-xs font-medium">
                                                                        <Scan size={14} />
                                                                        Scanned
                                                                    </span>
                                                                ) : isReceived ? (
                                                                    <span className="flex items-center gap-1 text-green-600 text-xs">
                                                                        <Check size={14} />
                                                                        Received
                                                                    </span>
                                                                ) : (
                                                                    <span className="text-xs text-amber-600">Pending</span>
                                                                )}
                                                            </div>
                                                        </div>
                                                    );
                                                })}
                                            </div>

                                            {/* Reason */}
                                            <div className="mt-2 pt-2 border-t text-xs text-gray-500">
                                                Reason: {ticket.reasonCategory.replace(/_/g, ' ')}
                                                {ticket.reasonDetails && ` - ${ticket.reasonDetails}`}
                                            </div>
                                        </button>
                                    );
                                })}
                            </div>
                        </div>
                    )}

                    {/* No scan yet - show pending tickets */}
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
                                    {pendingTickets?.map((ticket: ReturnTicket) => {
                                        const customerName = ticket.customer?.name || ticket.originalOrder.customerName || 'Unknown';
                                        const orderDate = ticket.originalOrder.orderDate
                                            ? formatDate(ticket.originalOrder.orderDate)
                                            : null;

                                        return (
                                            <div
                                                key={ticket.id}
                                                className="p-4 border border-gray-200 rounded-lg hover:border-gray-300 transition-colors"
                                            >
                                                {/* Header */}
                                                <div className="flex items-start justify-between mb-3">
                                                    <div>
                                                        <div className="flex items-center gap-2">
                                                            <span className="font-semibold text-gray-900">{ticket.requestNumber}</span>
                                                            <span className={`badge text-xs ${ticket.requestType === 'return' ? 'bg-red-100 text-red-700' : 'bg-blue-100 text-blue-700'}`}>
                                                                {ticket.requestType}
                                                            </span>
                                                        </div>
                                                        <div className="text-sm text-gray-600 mt-0.5">
                                                            {customerName}
                                                        </div>
                                                    </div>
                                                    <span className={`badge ${getStatusBadge(ticket.status)}`}>
                                                        {ticket.status.replace(/_/g, ' ')}
                                                    </span>
                                                </div>

                                                {/* Order Info */}
                                                <div className="text-xs text-gray-500 mb-3 pb-3 border-b space-y-1">
                                                    <div className="flex items-center gap-2 flex-wrap">
                                                        <span className="font-medium text-gray-700">Order #{ticket.originalOrder.orderNumber}</span>
                                                        {ticket.reverseShipping && (
                                                            <span className="flex items-center gap-1 bg-purple-50 text-purple-700 px-2 py-0.5 rounded">
                                                                <Truck size={12} />
                                                                {ticket.reverseShipping.courier}
                                                            </span>
                                                        )}
                                                    </div>
                                                    <div className="grid grid-cols-2 gap-x-4 gap-y-1">
                                                        {orderDate && (
                                                            <div>
                                                                <span className="text-gray-400">Ordered:</span>{' '}
                                                                <span className="text-gray-600">{orderDate}</span>
                                                                <span className="text-amber-600 ml-1">({ticket.ageDays}d ago)</span>
                                                            </div>
                                                        )}
                                                        {ticket.originalOrder.shippedAt && (
                                                            <div>
                                                                <span className="text-gray-400">Shipped:</span>{' '}
                                                                <span className="text-gray-600">
                                                                    {formatDate(ticket.originalOrder.shippedAt)}
                                                                </span>
                                                            </div>
                                                        )}
                                                        {ticket.originalOrder.deliveredAt && (
                                                            <div>
                                                                <span className="text-gray-400">Delivered:</span>{' '}
                                                                <span className="text-gray-600">
                                                                    {formatDate(ticket.originalOrder.deliveredAt)}
                                                                </span>
                                                            </div>
                                                        )}
                                                        <div>
                                                            <span className="text-gray-400">Return requested:</span>{' '}
                                                            <span className="text-gray-600">
                                                                {formatDate(ticket.createdAt)}
                                                            </span>
                                                        </div>
                                                    </div>
                                                </div>

                                                {/* Line Items */}
                                                <div className="space-y-2">
                                                    {ticket.lines.map((line: ReturnLine) => {
                                                        const imageUrl = line.sku.variation?.imageUrl || line.sku.variation?.product?.imageUrl;
                                                        const isReceived = !!line.itemCondition;

                                                        return (
                                                            <div
                                                                key={line.id}
                                                                className={`flex items-center gap-3 p-2 rounded ${isReceived ? 'bg-green-50' : 'bg-gray-50'}`}
                                                            >
                                                                {imageUrl ? (
                                                                    <img
                                                                        src={imageUrl}
                                                                        alt=""
                                                                        className="w-12 h-12 object-cover rounded"
                                                                    />
                                                                ) : (
                                                                    <div className="w-12 h-12 bg-gray-200 rounded flex items-center justify-center">
                                                                        <Package size={20} className="text-gray-400" />
                                                                    </div>
                                                                )}
                                                                <div className="flex-1 min-w-0">
                                                                    <div className={`font-medium text-sm truncate ${isReceived ? 'text-green-700' : 'text-gray-900'}`}>
                                                                        {line.sku.variation?.product?.name || 'Unknown Product'}
                                                                    </div>
                                                                    <div className="text-xs text-gray-500">
                                                                        {line.sku.variation?.colorName} • {line.sku.size} • {line.sku.skuCode}
                                                                    </div>
                                                                </div>
                                                                <div className="text-right">
                                                                    {isReceived ? (
                                                                        <span className="flex items-center gap-1 text-green-600 text-xs">
                                                                            <Check size={14} />
                                                                            Received
                                                                        </span>
                                                                    ) : (
                                                                        <span className="text-xs text-amber-600">Pending</span>
                                                                    )}
                                                                </div>
                                                            </div>
                                                        );
                                                    })}
                                                </div>

                                                {/* Reason */}
                                                <div className="mt-2 pt-2 border-t text-xs text-gray-500">
                                                    Reason: {ticket.reasonCategory.replace(/_/g, ' ')}
                                                    {ticket.reasonDetails && ` - ${ticket.reasonDetails}`}
                                                </div>
                                            </div>
                                        );
                                    })}
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

                            {/* Selected Ticket Info */}
                            <div className="bg-gray-50 p-3 rounded-lg mb-4">
                                <div className="flex justify-between">
                                    <span className="font-medium">{selectedTicket.requestNumber}</span>
                                    <span className={`badge ${selectedTicket.requestType === 'return' ? 'bg-red-100 text-red-800' : 'bg-blue-100 text-blue-800'}`}>
                                        {selectedTicket.requestType}
                                    </span>
                                </div>
                                <div className="text-sm text-gray-500 mt-1">
                                    Order #{selectedTicket.originalOrder.orderNumber}
                                </div>
                                {selectedTicket.customer && (
                                    <div className="text-sm text-gray-500">
                                        {selectedTicket.customer.name} • {selectedTicket.customer.email}
                                    </div>
                                )}
                            </div>

                            {/* Item Being Received */}
                            <div className="flex items-center gap-4 p-3 border border-primary-200 bg-primary-50 rounded-lg mb-4">
                                {selectedLine.sku.variation?.imageUrl && (
                                    <img
                                        src={selectedLine.sku.variation.imageUrl}
                                        alt=""
                                        className="w-14 h-14 object-cover rounded"
                                    />
                                )}
                                <div>
                                    <div className="font-medium">{selectedLine.sku.variation?.product?.name}</div>
                                    <div className="text-sm text-gray-600">
                                        {selectedLine.sku.variation?.colorName} / {selectedLine.sku.size}
                                    </div>
                                    <div className="text-sm font-mono">{selectedLine.sku.skuCode}</div>
                                </div>
                                <div className="ml-auto text-sm text-gray-500">Qty: {selectedLine.qty}</div>
                            </div>

                            {/* Condition Selection */}
                            <div className="mb-4">
                                <label className="block text-sm font-medium text-gray-700 mb-2">
                                    Item Condition *
                                </label>
                                <div className="space-y-2">
                                    {CONDITIONS.map((cond) => (
                                        <label
                                            key={cond.value}
                                            className={`flex items-center gap-3 p-3 border rounded-lg cursor-pointer transition-colors ${
                                                selectedCondition === cond.value
                                                    ? cond.color === 'green'
                                                        ? 'border-green-500 bg-green-50'
                                                        : cond.color === 'yellow'
                                                        ? 'border-yellow-500 bg-yellow-50'
                                                        : cond.color === 'red'
                                                        ? 'border-red-500 bg-red-50'
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

                            {/* Actions */}
                            <div className="flex gap-2">
                                <button className="btn-secondary" onClick={resetState}>
                                    Cancel
                                </button>
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
                    ) : scannedSku ? (
                        <div className="card">
                            <div className="text-center py-8 text-gray-500">
                                <Package size={48} className="mx-auto mb-4 text-gray-300" />
                                <p>Select a return ticket from the list</p>
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

            {/* QC Queue Tab Content */}
            {tab === 'queue' && (
                <div className="card">
                    <h3 className="text-lg font-semibold mb-4">QC Queue - Received Return Items</h3>

                    {/* Search/Scan Bar for QC Queue */}
                    <div className="mb-4 p-4 bg-gray-50 rounded-lg border">
                        <div className="flex items-center gap-4">
                            <div className="flex-1 relative">
                                <Scan className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" size={18} />
                                <input
                                    type="text"
                                    placeholder="Scan barcode or search SKU to find item in queue..."
                                    className="input pl-10 w-full"
                                    value={queueSearchTerm}
                                    onChange={(e) => setQueueSearchTerm(e.target.value)}
                                    onKeyDown={(e) => {
                                        if (e.key === 'Enter' && queueSearchTerm.trim()) {
                                            // Auto-highlight matching item
                                        }
                                    }}
                                />
                            </div>
                            {queueSearchTerm && (
                                <button
                                    onClick={() => setQueueSearchTerm('')}
                                    className="p-2 text-gray-400 hover:text-gray-600"
                                >
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
                                        <th className="table-header">Status</th>
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
                                                        <img
                                                            src={item.imageUrl}
                                                            alt=""
                                                            className="w-10 h-10 object-cover rounded"
                                                        />
                                                    )}
                                                    <div>
                                                        <div className="font-medium text-sm">{item.productName}</div>
                                                        <div className="text-xs text-gray-500">
                                                            {item.colorName} / {item.size}
                                                        </div>
                                                    </div>
                                                </div>
                                            </td>
                                            <td className="table-cell font-mono text-sm">{item.skuCode}</td>
                                            <td className="table-cell text-sm">
                                                {item.returnRequest?.requestNumber || '-'}
                                            </td>
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
                                            <td className="table-cell">
                                                <span className="badge bg-yellow-100 text-yellow-800">
                                                    pending
                                                </span>
                                            </td>
                                            <td className="table-cell text-sm text-gray-500">
                                                {formatDate(item.createdAt)}
                                            </td>
                                            <td className="table-cell">
                                                <div className="flex gap-1">
                                                    <button
                                                        onClick={() => openQcModal(item, 'ready')}
                                                        className="p-1.5 rounded text-green-600 hover:bg-green-50 hover:text-green-700"
                                                        title="Accept - Add to Stock"
                                                    >
                                                        <Check size={16} />
                                                    </button>
                                                    <button
                                                        onClick={() => openQcModal(item, 'write_off')}
                                                        className="p-1.5 rounded text-red-600 hover:bg-red-50 hover:text-red-700"
                                                        title="Reject - Write Off"
                                                    >
                                                        <Trash2 size={16} />
                                                    </button>
                                                    <button
                                                        onClick={() => {
                                                            if (confirm('Remove this item from the QC queue? This will undo the receive action.')) {
                                                                removeFromQueueMutation.mutate(item.id);
                                                            }
                                                        }}
                                                        className="p-1.5 rounded text-gray-500 hover:bg-gray-100 hover:text-gray-700"
                                                        title="Undo - Remove from queue"
                                                        disabled={removeFromQueueMutation.isPending}
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
            )}

            {/* History Tab Content */}
            {tab === 'history' && (
                <div className="card">
                    <div className="flex items-center justify-between mb-4">
                        <h3 className="text-lg font-semibold">Processed History</h3>
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
                                        <th className="table-header">QC Comments</th>
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
                                                        <img
                                                            src={item.imageUrl}
                                                            alt=""
                                                            className="w-10 h-10 object-cover rounded"
                                                        />
                                                    )}
                                                    <div>
                                                        <div className="font-medium text-sm">{item.productName}</div>
                                                        <div className="text-xs text-gray-500">
                                                            {item.colorName} / {item.size}
                                                        </div>
                                                    </div>
                                                </div>
                                            </td>
                                            <td className="table-cell font-mono text-sm">{item.skuCode}</td>
                                            <td className="table-cell text-sm">
                                                {item.returnRequest?.requestNumber || '-'}
                                            </td>
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
                                            <td className="table-cell text-sm text-gray-600">
                                                {item.qcComments || '-'}
                                            </td>
                                            <td className="table-cell text-sm text-gray-500">
                                                <div>{item.processedAt ? formatDate(item.processedAt) : '-'}</div>
                                                {item.processedBy && (
                                                    <div className="text-xs">{item.processedBy.name}</div>
                                                )}
                                            </td>
                                            <td className="table-cell">
                                                <button
                                                    onClick={() => {
                                                        if (confirm('Undo this action? The item will be moved back to the QC queue.')) {
                                                            undoMutation.mutate(item.id);
                                                        }
                                                    }}
                                                    className="btn-sm bg-gray-200 hover:bg-gray-300 text-gray-700"
                                                    disabled={undoMutation.isPending}
                                                    title="Undo - Move back to queue"
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
                            {/* Item Info */}
                            <div className="flex items-center gap-4 p-3 bg-gray-50 rounded-lg">
                                {qcModalItem.imageUrl && (
                                    <img
                                        src={qcModalItem.imageUrl}
                                        alt=""
                                        className="w-14 h-14 object-cover rounded"
                                    />
                                )}
                                <div>
                                    <div className="font-medium">{qcModalItem.productName}</div>
                                    <div className="text-sm text-gray-600">
                                        {qcModalItem.colorName} / {qcModalItem.size}
                                    </div>
                                    <div className="text-sm font-mono">{qcModalItem.skuCode}</div>
                                </div>
                            </div>

                            {/* Action Toggle */}
                            <div className="flex gap-2">
                                <button
                                    className={`flex-1 py-2 rounded-lg font-medium transition-colors ${
                                        qcAction === 'ready'
                                            ? 'bg-green-600 text-white'
                                            : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                                    }`}
                                    onClick={() => setQcAction('ready')}
                                >
                                    <Check size={16} className="inline mr-2" />
                                    Accept
                                </button>
                                <button
                                    className={`flex-1 py-2 rounded-lg font-medium transition-colors ${
                                        qcAction === 'write_off'
                                            ? 'bg-red-600 text-white'
                                            : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                                    }`}
                                    onClick={() => setQcAction('write_off')}
                                >
                                    <X size={16} className="inline mr-2" />
                                    Reject
                                </button>
                            </div>

                            {/* Write-off Reason (if rejecting) */}
                            {qcAction === 'write_off' && (
                                <div>
                                    <label className="block text-sm font-medium text-gray-700 mb-1">
                                        Rejection Reason *
                                    </label>
                                    <select
                                        className="input"
                                        value={writeOffReason}
                                        onChange={(e) => setWriteOffReason(e.target.value)}
                                    >
                                        {WRITE_OFF_REASONS.map((r) => (
                                            <option key={r.value} value={r.value}>
                                                {r.label}
                                            </option>
                                        ))}
                                    </select>
                                </div>
                            )}

                            {/* QC Comments */}
                            <div>
                                <label className="block text-sm font-medium text-gray-700 mb-1">
                                    QC Comments
                                </label>
                                <textarea
                                    className="input"
                                    rows={3}
                                    placeholder="Add any notes about this item..."
                                    value={qcComments}
                                    onChange={(e) => setQcComments(e.target.value)}
                                />
                            </div>
                        </div>
                        <div className="flex gap-2 p-4 border-t">
                            <button className="btn-secondary flex-1" onClick={closeQcModal}>
                                Cancel
                            </button>
                            <button
                                className={`flex-1 ${
                                    qcAction === 'ready'
                                        ? 'btn-primary bg-green-600 hover:bg-green-700'
                                        : 'btn-primary bg-red-600 hover:bg-red-700'
                                }`}
                                onClick={handleQcSubmit}
                                disabled={processMutation.isPending}
                            >
                                {processMutation.isPending ? (
                                    <div className="animate-spin h-5 w-5 border-2 border-white border-t-transparent rounded-full mx-auto" />
                                ) : qcAction === 'ready' ? (
                                    'Accept & Add to Stock'
                                ) : (
                                    'Reject & Write Off'
                                )}
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}
