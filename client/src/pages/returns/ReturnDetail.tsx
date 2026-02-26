/**
 * Return Detail Page — /returns/:returnId
 *
 * Two-column layout inspired by Return Prime.
 * Main content (left): alert banner, product card, price breakdown, timeline.
 * Sidebar (right): reason, customer info, refund mode, address, notes.
 */

import { useState, useCallback } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useServerFn } from '@tanstack/react-start';
// Router is used via Route.useParams() — links use plain <a> for simplicity
import { Route } from '../../routes/_authenticated/returns_.$returnId';
import {
    ArrowLeft,
    Copy,
    Check,
    Package,
    Clock,
    MapPin,
    Mail,
    Phone,
    CreditCard,
    MessageSquare,
    FileText,
    CheckCircle2,
    XCircle,
    Truck,
    PackageCheck,
    CircleDot,
    Save,
    Send,
    User,
    AlertCircle,
    RefreshCw,
    ExternalLink,
    Tag,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { toast } from 'sonner';

import { getReturnDetail, getReturnTimeline, postReturnComment } from '../../server/functions/returns';
import type { ReturnDetailResponse, TimelineEventRow } from '../../server/functions/returns';
import {
    scheduleReturnPickup,
    receiveLineReturn,
    cancelLineReturn,
    updateReturnNotes,
} from '../../server/functions/returnLifecycle';
import { processLineReturnRefund, completeLineReturn } from '../../server/functions/returnResolution';

import { getOptimizedImageUrl } from '../../utils/imageOptimization';
import { getStatusBadge, getResolutionBadge, computeAgeDays } from './types';
import {
    RETURN_REASONS,
    RETURN_CONDITIONS,
    getLabel,
} from '@coh/shared/domain/returns';

// ============================================
// HELPERS
// ============================================

function formatCurrency(amount: number | null | undefined): string {
    if (amount == null) return '-';
    return new Intl.NumberFormat('en-IN', {
        style: 'currency',
        currency: 'INR',
        minimumFractionDigits: 2,
    }).format(amount);
}

function formatDate(date: Date | string | null | undefined): string {
    if (!date) return '-';
    const d = new Date(date);
    return d.toLocaleDateString('en-IN', {
        day: 'numeric',
        month: 'short',
        year: 'numeric',
    });
}

function formatDateTime(date: Date | string | null | undefined): string {
    if (!date) return '-';
    const d = new Date(date);
    return d.toLocaleDateString('en-IN', {
        day: 'numeric',
        month: 'short',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
    });
}

interface AddressFields {
    address1?: string;
    address2?: string;
    city?: string;
    province?: string;
    zip?: string;
    country?: string;
    name?: string;
    phone?: string;
    first_name?: string;
    last_name?: string;
}

function parseAddress(raw: unknown): AddressFields | null {
    if (!raw) return null;
    try {
        if (typeof raw === 'string') {
            return JSON.parse(raw) as AddressFields;
        }
        if (typeof raw === 'object') {
            return raw as AddressFields;
        }
    } catch {
        // ignore parse errors
    }
    return null;
}

function formatAddress(raw: unknown): string {
    const addr = parseAddress(raw);
    if (!addr) return '-';
    const parts = [
        addr.address1,
        addr.address2,
        addr.city,
        addr.province,
        addr.zip,
        addr.country,
    ].filter(Boolean);
    return parts.join(', ') || '-';
}

// ============================================
// TIMELINE EVENT HELPERS
// ============================================

const EVENT_ICON_MAP: Record<string, { icon: typeof CircleDot; color: string }> = {
    'return.requested':        { icon: CircleDot,    color: 'text-yellow-600 bg-yellow-50' },
    'return.approved':         { icon: Truck,         color: 'text-blue-600 bg-blue-50' },
    'return.in_transit':       { icon: Truck,         color: 'text-blue-500 bg-blue-50' },
    'return.inspected':        { icon: PackageCheck,  color: 'text-teal-600 bg-teal-50' },
    'return.refund_processed': { icon: CreditCard,    color: 'text-purple-600 bg-purple-50' },
    'return.refund_completed': { icon: CheckCircle2,  color: 'text-green-600 bg-green-50' },
    'return.completed':        { icon: CheckCircle2,  color: 'text-green-600 bg-green-50' },
    'return.cancelled':        { icon: XCircle,       color: 'text-red-600 bg-red-50' },
    'return.closed_manually':  { icon: AlertCircle,   color: 'text-orange-600 bg-orange-50' },
    'return.exchange_created': { icon: RefreshCw,     color: 'text-indigo-600 bg-indigo-50' },
    'return.comment':          { icon: MessageSquare, color: 'text-gray-600 bg-gray-50' },
    'return.notes_updated':    { icon: FileText,      color: 'text-gray-500 bg-gray-50' },
};

function TimelineItem({ event }: { event: TimelineEventRow }) {
    const config = EVENT_ICON_MAP[event.event] || { icon: CircleDot, color: 'text-gray-400 bg-gray-50' };
    const Icon = config.icon;
    const isComment = event.event === 'return.comment';
    const time = new Date(event.createdAt);
    const relativeTime = getRelativeTime(time);

    return (
        <div className="flex items-start gap-3 relative">
            <div className={`w-8 h-8 rounded-full flex items-center justify-center flex-shrink-0 z-10 ${config.color}`}>
                <Icon size={14} />
            </div>
            <div className="flex-1 min-w-0 pt-0.5">
                <p className={`text-sm ${isComment ? 'text-gray-800 bg-gray-50 rounded-lg px-3 py-2 border border-gray-100' : 'text-gray-700'}`}>
                    {event.summary}
                </p>
                <div className="flex items-center gap-2 mt-0.5">
                    {event.actorName && (
                        <span className="text-[11px] text-gray-500 font-medium flex items-center gap-1">
                            <User size={10} />
                            {event.actorName}
                        </span>
                    )}
                    <span className="text-[11px] text-gray-400" title={formatDateTime(event.createdAt)}>
                        {relativeTime}
                    </span>
                </div>
            </div>
        </div>
    );
}

function getRelativeTime(date: Date): string {
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffMins = Math.floor(diffMs / 60000);
    if (diffMins < 1) return 'just now';
    if (diffMins < 60) return `${diffMins}m ago`;
    const diffHours = Math.floor(diffMins / 60);
    if (diffHours < 24) return `${diffHours}h ago`;
    const diffDays = Math.floor(diffHours / 24);
    if (diffDays < 7) return `${diffDays}d ago`;
    return formatDate(date);
}

// ============================================
// MAIN COMPONENT
// ============================================

export default function ReturnDetail() {
    const { returnId } = Route.useParams();
    const queryClient = useQueryClient();

    // Local state
    const [copied, setCopied] = useState(false);
    const [notesValue, setNotesValue] = useState<string | null>(null);
    const [notesEditing, setNotesEditing] = useState(false);

    // ============================================
    // QUERY
    // ============================================

    const getDetailFn = useServerFn(getReturnDetail);
    const { data: detail, isLoading, error } = useQuery({
        queryKey: ['returns', 'detail', returnId],
        queryFn: async () => {
            const result = await getDetailFn({ data: { orderLineId: returnId } });
            return result as ReturnDetailResponse;
        },
        staleTime: 30_000,
    });

    const invalidateAll = useCallback(() => {
        queryClient.invalidateQueries({ queryKey: ['returns'] });
    }, [queryClient]);

    // ============================================
    // TIMELINE QUERY + COMMENT
    // ============================================

    const getTimelineFn = useServerFn(getReturnTimeline);
    const { data: timelineEvents = [] } = useQuery({
        queryKey: ['returns', 'timeline', returnId],
        queryFn: async () => {
            const result = await getTimelineFn({ data: { orderLineId: returnId } });
            return result as TimelineEventRow[];
        },
        staleTime: 15_000,
        enabled: !!detail,
    });

    const [commentText, setCommentText] = useState('');
    const postCommentFn = useServerFn(postReturnComment);
    const postCommentMutation = useMutation({
        mutationFn: async () => {
            if (!commentText.trim()) return;
            await postCommentFn({ data: { orderLineId: returnId, comment: commentText.trim() } });
        },
        onSuccess: () => {
            setCommentText('');
            queryClient.invalidateQueries({ queryKey: ['returns', 'timeline', returnId] });
            toast.success('Comment posted');
        },
        onError: () => toast.error('Failed to post comment'),
    });

    // ============================================
    // MUTATIONS
    // ============================================

    const schedulePickupFn = useServerFn(scheduleReturnPickup);
    const schedulePickupMutation = useMutation({
        mutationFn: () =>
            schedulePickupFn({
                data: {
                    orderLineId: returnId,
                    pickupType: 'arranged_by_us',
                    scheduleWithIthink: true,
                },
            }),
        onSuccess: () => {
            toast.success('Pickup scheduled');
            invalidateAll();
        },
        onError: (err: unknown) =>
            toast.error(err instanceof Error ? err.message : 'Failed to schedule pickup'),
    });

    const receiveReturnFn = useServerFn(receiveLineReturn);
    const receiveReturnMutation = useMutation({
        mutationFn: () =>
            receiveReturnFn({
                data: {
                    orderLineId: returnId,
                    condition: 'good',
                },
            }),
        onSuccess: () => {
            toast.success('Return received & inspected');
            invalidateAll();
        },
        onError: (err: unknown) =>
            toast.error(err instanceof Error ? err.message : 'Failed to receive return'),
    });

    const processRefundFn = useServerFn(processLineReturnRefund);
    const processRefundMutation = useMutation({
        mutationFn: () => {
            if (!detail) throw new Error('No detail loaded');
            const gross = detail.returnGrossAmount ?? detail.unitPrice * (detail.returnQty || 1);
            return processRefundFn({
                data: {
                    orderLineId: returnId,
                    grossAmount: gross,
                    discountClawback: detail.returnDiscountClawback ?? 0,
                    deductions: detail.returnDeductions ?? 0,
                },
            });
        },
        onSuccess: () => {
            toast.success('Refund processed');
            invalidateAll();
        },
        onError: (err: unknown) =>
            toast.error(err instanceof Error ? err.message : 'Failed to process refund'),
    });

    const cancelReturnFn = useServerFn(cancelLineReturn);
    const cancelReturnMutation = useMutation({
        mutationFn: (reason: string) =>
            cancelReturnFn({ data: { orderLineId: returnId, reason } }),
        onSuccess: () => {
            toast.success('Return rejected');
            invalidateAll();
        },
        onError: (err: unknown) =>
            toast.error(err instanceof Error ? err.message : 'Failed to reject return'),
    });

    const completeReturnFn = useServerFn(completeLineReturn);
    const completeReturnMutation = useMutation({
        mutationFn: () =>
            completeReturnFn({ data: { orderLineId: returnId } }),
        onSuccess: () => {
            toast.success('Return completed');
            invalidateAll();
        },
        onError: (err: unknown) =>
            toast.error(err instanceof Error ? err.message : 'Failed to complete return'),
    });

    const updateNotesFn = useServerFn(updateReturnNotes);
    const updateNotesMutation = useMutation({
        mutationFn: (notes: string) =>
            updateNotesFn({ data: { orderLineId: returnId, returnNotes: notes } }),
        onSuccess: () => {
            toast.success('Notes saved');
            setNotesEditing(false);
            invalidateAll();
        },
        onError: (err: unknown) =>
            toast.error(err instanceof Error ? err.message : 'Failed to save notes'),
    });

    // ============================================
    // HANDLERS
    // ============================================

    const handleCopyId = useCallback(() => {
        if (!detail) return;
        const text = detail.returnBatchNumber
            ? `RET${detail.returnBatchNumber}`
            : detail.id;
        navigator.clipboard.writeText(text).then(() => {
            setCopied(true);
            setTimeout(() => setCopied(false), 2000);
        });
    }, [detail]);

    const handleSaveNotes = useCallback(() => {
        if (notesValue !== null) {
            updateNotesMutation.mutate(notesValue);
        }
    }, [notesValue, updateNotesMutation]);

    // ============================================
    // LOADING / ERROR
    // ============================================

    if (isLoading) {
        return (
            <div className="min-h-screen bg-gray-50 flex items-center justify-center">
                <div className="flex flex-col items-center gap-3">
                    <div className="w-8 h-8 border-2 border-emerald-500 border-t-transparent rounded-full animate-spin" />
                    <span className="text-sm text-gray-500">Loading return details...</span>
                </div>
            </div>
        );
    }

    if (error || !detail) {
        return (
            <div className="min-h-screen bg-gray-50 flex items-center justify-center">
                <div className="text-center space-y-3">
                    <XCircle size={48} className="mx-auto text-red-300" />
                    <p className="text-gray-600 font-medium">Return not found</p>
                    <a
                        href="/returns?status=requested"
                        className="text-sm text-emerald-600 hover:underline"
                    >
                        Back to Returns
                    </a>
                </div>
            </div>
        );
    }

    // ============================================
    // DERIVED
    // ============================================

    const requestId = detail.returnBatchNumber
        ? `#RET${detail.returnBatchNumber}`
        : `#${detail.id.slice(0, 8)}`;

    const ageDays = computeAgeDays(detail.returnRequestedAt);
    const statusBadgeClass = getStatusBadge(detail.returnStatus);
    const resolutionBadge = getResolutionBadge(detail.returnResolution);

    const lineTotal = detail.unitPrice * (detail.returnQty || 1);
    const grossAmount = detail.returnGrossAmount ?? lineTotal;
    const discountClawback = detail.returnDiscountClawback ?? 0;
    const deductions = detail.returnDeductions ?? 0;
    const netAmount = detail.returnNetAmount ?? (grossAmount - discountClawback - deductions);

    const isTerminal = ['refunded', 'archived', 'rejected', 'cancelled'].includes(detail.returnStatus);

    const backStatusLabel = detail.returnStatus.charAt(0).toUpperCase() + detail.returnStatus.slice(1);

    // Initialize notes state from detail if not yet set
    const displayNotes = notesValue !== null ? notesValue : (detail.returnNotes || '');

    // ============================================
    // MILESTONE STEPS (compact progress bar)
    // ============================================

    const milestones = [
        { label: 'Requested', done: true, date: detail.returnRequestedAt },
        { label: 'Approved', done: !!detail.returnPickupScheduledAt, date: detail.returnPickupScheduledAt },
        { label: 'Inspected', done: !!detail.returnReceivedAt, date: detail.returnReceivedAt },
        { label: 'Refunded', done: !!detail.returnRefundCompletedAt, date: detail.returnRefundCompletedAt },
    ];

    // ============================================
    // RENDER
    // ============================================

    return (
        <div className="min-h-screen bg-gray-50">
            <div className="max-w-7xl mx-auto px-4 sm:px-6 py-6 space-y-5">
                {/* Header */}
                <div className="space-y-3">
                    {/* Back link */}
                    <a
                        href={`/returns?status=${detail.returnStatus}`}
                        className="inline-flex items-center gap-1.5 text-sm text-gray-500 hover:text-gray-700 transition-colors"
                    >
                        <ArrowLeft size={16} />
                        All {backStatusLabel}
                    </a>

                    {/* Title row */}
                    <div className="flex items-center justify-between flex-wrap gap-3">
                        <div className="flex items-center gap-4">
                            <div className="flex items-center gap-2">
                                <h1 className="text-2xl font-bold text-gray-900">{requestId}</h1>
                                <button
                                    onClick={handleCopyId}
                                    className="p-1 rounded hover:bg-gray-100 transition-colors"
                                    title="Copy Request ID"
                                >
                                    {copied ? (
                                        <Check size={16} className="text-green-500" />
                                    ) : (
                                        <Copy size={16} className="text-gray-400" />
                                    )}
                                </button>
                            </div>
                            <a
                                href={`/orders?modal=view&orderId=${detail.orderId}`}
                                className="text-sm text-blue-600 hover:underline font-medium"
                            >
                                #{detail.orderNumber}
                            </a>
                            {detail.shopifyOrderId && (
                                <a
                                    href={`https://admin.shopify.com/store/creatures-of-habit-india/orders/${detail.shopifyOrderId}`}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    className="text-gray-400 hover:text-blue-500 transition-colors"
                                    title="View on Shopify"
                                >
                                    <ExternalLink size={14} />
                                </a>
                            )}
                            <span className={`inline-flex px-2.5 py-0.5 text-xs font-semibold rounded-full ${statusBadgeClass}`}>
                                {detail.returnStatus.replace(/_/g, ' ')}
                            </span>
                        </div>

                        {/* Action buttons */}
                        <div className="flex items-center gap-2">
                            {detail.returnStatus === 'requested' && (
                                <>
                                    <Button
                                        onClick={() => schedulePickupMutation.mutate()}
                                        disabled={schedulePickupMutation.isPending}
                                        size="sm"
                                        className="bg-emerald-600 hover:bg-emerald-700 text-white"
                                    >
                                        {schedulePickupMutation.isPending ? 'Scheduling...' : 'Approve & Schedule Pickup'}
                                    </Button>
                                    <Button
                                        onClick={() => cancelReturnMutation.mutate('Rejected by staff')}
                                        disabled={cancelReturnMutation.isPending}
                                        size="sm"
                                        variant="outline"
                                        className="text-red-600 border-red-200 hover:bg-red-50"
                                    >
                                        Reject
                                    </Button>
                                </>
                            )}
                            {detail.returnStatus === 'approved' && (
                                <Button
                                    onClick={() => receiveReturnMutation.mutate()}
                                    disabled={receiveReturnMutation.isPending}
                                    size="sm"
                                    className="bg-emerald-600 hover:bg-emerald-700 text-white"
                                >
                                    {receiveReturnMutation.isPending ? 'Processing...' : 'Mark Received & Inspected'}
                                </Button>
                            )}
                            {detail.returnStatus === 'inspected' && detail.returnResolution === 'refund' && !detail.returnRefundCompletedAt && (
                                <Button
                                    onClick={() => processRefundMutation.mutate()}
                                    disabled={processRefundMutation.isPending}
                                    size="sm"
                                    className="bg-emerald-600 hover:bg-emerald-700 text-white"
                                >
                                    {processRefundMutation.isPending ? 'Processing...' : 'Process Refund'}
                                </Button>
                            )}
                            {detail.returnStatus === 'inspected' && (
                                <Button
                                    onClick={() => completeReturnMutation.mutate()}
                                    disabled={completeReturnMutation.isPending}
                                    size="sm"
                                    variant="outline"
                                    className="text-emerald-600 border-emerald-200 hover:bg-emerald-50"
                                >
                                    Complete Return
                                </Button>
                            )}
                            {!isTerminal && detail.returnStatus !== 'requested' && (
                                <Button
                                    onClick={() => cancelReturnMutation.mutate('Cancelled by staff')}
                                    disabled={cancelReturnMutation.isPending}
                                    size="sm"
                                    variant="outline"
                                    className="text-gray-500 border-gray-200 hover:bg-gray-50"
                                >
                                    Cancel
                                </Button>
                            )}
                        </div>
                    </div>
                </div>

                {/* Two-column layout */}
                <div className="grid grid-cols-1 lg:grid-cols-5 gap-6">
                    {/* Main content — left ~65% */}
                    <div className="lg:col-span-3 space-y-5">
                        {/* Alert banner */}
                        {!isTerminal && ageDays > 0 && (
                            <div
                                className={`rounded-lg border px-4 py-3 text-sm flex items-center gap-2 ${
                                    ageDays > 7
                                        ? 'bg-red-50 border-red-200 text-red-700'
                                        : ageDays > 3
                                        ? 'bg-yellow-50 border-yellow-200 text-yellow-700'
                                        : 'bg-blue-50 border-blue-200 text-blue-700'
                                }`}
                            >
                                <Clock size={16} />
                                <span>
                                    Customer raised this request {ageDays} day{ageDays !== 1 ? 's' : ''} ago
                                    {detail.returnStatus !== 'refunded' && ageDays > 3 && ' but has not received their refund yet'}
                                </span>
                            </div>
                        )}
                        {detail.deliveredAt && (
                            <p className="text-xs text-gray-500 -mt-2">
                                Delivered on {formatDate(detail.deliveredAt)}
                            </p>
                        )}

                        {/* Product card */}
                        <div className="bg-white rounded-lg border border-gray-200 p-5">
                            <h3 className="text-sm font-semibold text-gray-500 uppercase tracking-wider mb-4">
                                Product
                            </h3>
                            <div className="flex items-start gap-4">
                                <div className="w-20 h-20 rounded-lg bg-gray-100 flex-shrink-0 overflow-hidden ring-1 ring-gray-200/60">
                                    {detail.imageUrl ? (
                                        <img
                                            src={getOptimizedImageUrl(detail.imageUrl, 'md') || detail.imageUrl}
                                            alt={detail.productName || ''}
                                            className="w-full h-full object-cover"
                                        />
                                    ) : (
                                        <div className="w-full h-full flex items-center justify-center">
                                            <Package size={24} className="text-gray-300" />
                                        </div>
                                    )}
                                </div>
                                <div className="flex-1 min-w-0">
                                    <p className="text-base font-semibold text-gray-900">{detail.productName}</p>
                                    <p className="text-sm text-gray-500 mt-0.5">
                                        {detail.colorName} / {detail.size}
                                    </p>
                                    <div className="flex items-center gap-3 mt-2">
                                        <span className="text-sm text-gray-600">
                                            Qty: <span className="font-medium">{detail.returnQty}</span>
                                        </span>
                                        <span className="text-sm text-gray-600">
                                            SKU: <span className="font-mono text-xs">{detail.skuCode}</span>
                                        </span>
                                    </div>
                                    {detail.returnReasonCategory && (
                                        <div className="mt-2">
                                            <span className="inline-flex px-2 py-0.5 text-xs font-medium rounded-full bg-orange-100 text-orange-700">
                                                {getLabel(RETURN_REASONS, detail.returnReasonCategory)}
                                            </span>
                                        </div>
                                    )}
                                </div>
                                <div className="text-right flex-shrink-0">
                                    <p className="text-sm text-gray-500">Unit Price</p>
                                    <p className="text-base font-semibold text-gray-900">{formatCurrency(detail.unitPrice)}</p>
                                </div>
                            </div>
                        </div>

                        {/* Price breakdown — RP style */}
                        <div className="bg-white rounded-lg border border-gray-200 p-5">
                            <h3 className="text-sm font-semibold text-gray-500 uppercase tracking-wider mb-4">
                                Price Breakdown
                            </h3>
                            <div className="space-y-2">
                                <div className="flex justify-between text-sm">
                                    <span className="text-gray-600">Item Price ({detail.returnQty} x {formatCurrency(detail.unitPrice)})</span>
                                    <span className="text-gray-900">{formatCurrency(lineTotal)}</span>
                                </div>
                                <div className="flex justify-between text-sm">
                                    <span className="text-gray-600">Incentive</span>
                                    <span className="text-gray-500">+ {formatCurrency(0)}</span>
                                </div>
                                <div className="flex justify-between text-sm">
                                    <span className="text-gray-600">Tax</span>
                                    <span className="text-gray-500">+ {formatCurrency(detail.lineTax)}</span>
                                </div>
                                {detail.lineDiscount > 0 && (
                                    <div className="flex justify-between text-sm">
                                        <span className="text-gray-600">Discount</span>
                                        <span className="text-red-600">- {formatCurrency(detail.lineDiscount)}</span>
                                    </div>
                                )}
                                {discountClawback > 0 && (
                                    <div className="flex justify-between text-sm">
                                        <span className="text-gray-600">Discount Clawback</span>
                                        <span className="text-red-600">- {formatCurrency(discountClawback)}</span>
                                    </div>
                                )}
                                {deductions > 0 && (
                                    <div className="flex justify-between text-sm">
                                        <span className="text-gray-600">
                                            Return Fee / Deductions
                                            {detail.returnDeductionNotes && (
                                                <span className="text-gray-400 ml-1">({detail.returnDeductionNotes})</span>
                                            )}
                                        </span>
                                        <span className="text-red-600">- {formatCurrency(deductions)}</span>
                                    </div>
                                )}
                                <div className="border-t border-gray-200 pt-2.5 flex justify-between">
                                    <span className="text-sm font-semibold text-gray-900">
                                        {detail.returnRefundCompletedAt ? 'Refunded Amount' : 'Total (To be refunded)'}
                                    </span>
                                    <span className="text-base font-bold text-gray-900">{formatCurrency(netAmount)}</span>
                                </div>
                            </div>
                            <p className="text-[10px] text-gray-400 mt-2">Price incl. of discount & taxes</p>
                        </div>

                        {/* Pickup / Logistics */}
                        {(detail.returnAwbNumber || detail.returnCourier || detail.returnPickupType) && (
                            <div className="bg-white rounded-lg border border-gray-200 p-5">
                                <h3 className="text-sm font-semibold text-gray-500 uppercase tracking-wider mb-4">
                                    Logistics
                                </h3>
                                {/* Shipment status sub-state */}
                                <div className="mb-4 flex items-center gap-2">
                                    <span className="text-xs text-gray-500">Shipment Status:</span>
                                    <span className={`inline-flex px-2 py-0.5 text-xs font-semibold rounded-full ${
                                        detail.returnReceivedAt
                                            ? 'bg-green-100 text-green-700'
                                            : detail.returnPickupAt
                                            ? 'bg-blue-100 text-blue-700'
                                            : detail.returnPickupScheduledAt
                                            ? 'bg-yellow-100 text-yellow-700'
                                            : 'bg-gray-100 text-gray-600'
                                    }`}>
                                        {detail.returnReceivedAt
                                            ? 'Returned to warehouse'
                                            : detail.returnPickupAt
                                            ? 'Picked up from customer'
                                            : detail.returnPickupScheduledAt
                                            ? 'On the way to warehouse'
                                            : 'Requested'}
                                    </span>
                                </div>
                                <div className="grid grid-cols-2 gap-4 text-sm">
                                    {detail.returnPickupType && (
                                        <div>
                                            <span className="text-gray-500">Pickup Type</span>
                                            <p className="font-medium text-gray-900 mt-0.5">
                                                {detail.returnPickupType.replace(/_/g, ' ')}
                                            </p>
                                        </div>
                                    )}
                                    {detail.returnCourier && (
                                        <div>
                                            <span className="text-gray-500">Logistic Partner</span>
                                            <p className="font-medium text-gray-900 mt-0.5">{detail.returnCourier}</p>
                                        </div>
                                    )}
                                    {detail.returnAwbNumber && (
                                        <div>
                                            <span className="text-gray-500">Tracking ID</span>
                                            <p className="font-mono text-gray-900 mt-0.5">{detail.returnAwbNumber}</p>
                                        </div>
                                    )}
                                    {detail.returnPickupScheduledAt && (
                                        <div>
                                            <span className="text-gray-500">Scheduled</span>
                                            <p className="font-medium text-gray-900 mt-0.5">
                                                {formatDate(detail.returnPickupScheduledAt)}
                                            </p>
                                        </div>
                                    )}
                                </div>
                            </div>
                        )}

                        {/* Condition / QC */}
                        {(detail.returnCondition || detail.returnQcResult) && (
                            <div className="bg-white rounded-lg border border-gray-200 p-5">
                                <h3 className="text-sm font-semibold text-gray-500 uppercase tracking-wider mb-4">
                                    Inspection
                                </h3>
                                <div className="grid grid-cols-2 gap-4 text-sm">
                                    {detail.returnCondition && (
                                        <div>
                                            <span className="text-gray-500">Condition</span>
                                            <p className="font-medium text-gray-900 mt-0.5">
                                                {getLabel(RETURN_CONDITIONS, detail.returnCondition)}
                                            </p>
                                        </div>
                                    )}
                                    {detail.returnQcResult && (
                                        <div>
                                            <span className="text-gray-500">QC Result</span>
                                            <p className="font-medium text-gray-900 mt-0.5">{detail.returnQcResult}</p>
                                        </div>
                                    )}
                                    {detail.returnConditionNotes && (
                                        <div className="col-span-2">
                                            <span className="text-gray-500">Notes</span>
                                            <p className="text-gray-700 mt-0.5">{detail.returnConditionNotes}</p>
                                        </div>
                                    )}
                                </div>
                            </div>
                        )}

                        {/* Progress milestones */}
                        <div className="bg-white rounded-lg border border-gray-200 p-5">
                            <h3 className="text-sm font-semibold text-gray-500 uppercase tracking-wider mb-4">
                                Progress
                            </h3>
                            <div className="flex items-center gap-1">
                                {milestones.map((m, idx) => (
                                    <div key={m.label} className="flex items-center gap-1 flex-1">
                                        <div className="flex flex-col items-center flex-1">
                                            <div className={`w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold ${
                                                m.done
                                                    ? 'bg-green-100 text-green-700 ring-2 ring-green-300'
                                                    : 'bg-gray-100 text-gray-400 ring-2 ring-gray-200'
                                            }`}>
                                                {m.done ? <CheckCircle2 size={14} /> : idx + 1}
                                            </div>
                                            <span className={`text-[10px] mt-1 ${m.done ? 'text-green-700 font-medium' : 'text-gray-400'}`}>
                                                {m.label}
                                            </span>
                                            {m.done && m.date && (
                                                <span className="text-[9px] text-gray-400">{formatDate(m.date)}</span>
                                            )}
                                        </div>
                                        {idx < milestones.length - 1 && (
                                            <div className={`h-0.5 flex-1 rounded ${
                                                milestones[idx + 1].done ? 'bg-green-300' : 'bg-gray-200'
                                            }`} />
                                        )}
                                    </div>
                                ))}
                            </div>
                        </div>

                        {/* Activity Timeline — RP-style */}
                        <div className="bg-white rounded-lg border border-gray-200 p-5">
                            <h3 className="text-sm font-semibold text-gray-500 uppercase tracking-wider mb-4">
                                Timeline
                            </h3>

                            {/* Comment input */}
                            <div className="mb-5">
                                <div className="flex gap-2">
                                    <textarea
                                        value={commentText}
                                        onChange={(e) => setCommentText(e.target.value)}
                                        placeholder="Leave a comment..."
                                        rows={2}
                                        className="flex-1 text-sm border border-gray-200 rounded-lg px-3 py-2 resize-none focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                                        onKeyDown={(e) => {
                                            if (e.key === 'Enter' && (e.metaKey || e.ctrlKey) && commentText.trim()) {
                                                postCommentMutation.mutate();
                                            }
                                        }}
                                    />
                                    <Button
                                        size="sm"
                                        onClick={() => postCommentMutation.mutate()}
                                        disabled={!commentText.trim() || postCommentMutation.isPending}
                                        className="self-end"
                                    >
                                        <Send size={14} className="mr-1" />
                                        Post
                                    </Button>
                                </div>
                                <p className="text-[10px] text-gray-400 mt-1">Comments are internal only. Cmd+Enter to post.</p>
                            </div>

                            {/* Event log */}
                            <div className="relative">
                                {timelineEvents.length > 0 && (
                                    <div className="absolute left-[15px] top-4 bottom-4 w-0.5 bg-gray-100" />
                                )}
                                <div className="space-y-3">
                                    {timelineEvents.length === 0 ? (
                                        <p className="text-sm text-gray-400 italic">No events yet</p>
                                    ) : (
                                        timelineEvents.map((evt) => (
                                            <TimelineItem key={evt.id} event={evt} />
                                        ))
                                    )}
                                </div>
                            </div>
                        </div>
                    </div>

                    {/* Sidebar — right ~35% */}
                    <div className="lg:col-span-2 space-y-5">
                        {/* Reason */}
                        <div className="bg-white rounded-lg border border-gray-200 p-5">
                            <h3 className="text-sm font-semibold text-gray-500 uppercase tracking-wider mb-3">
                                <MessageSquare size={14} className="inline mr-1.5" />
                                Reason
                            </h3>
                            <p className="text-sm font-medium text-gray-900">
                                {detail.returnReasonCategory
                                    ? getLabel(RETURN_REASONS, detail.returnReasonCategory)
                                    : 'Not specified'}
                            </p>
                            {detail.returnReasonDetail && (
                                <div className="mt-3">
                                    <p className="text-xs text-gray-500 mb-1">Customer&apos;s Comment</p>
                                    <p className="text-sm text-gray-700 bg-gray-50 rounded-md p-3 italic">
                                        &ldquo;{detail.returnReasonDetail}&rdquo;
                                    </p>
                                </div>
                            )}
                        </div>

                        {/* Resolution */}
                        <div className="bg-white rounded-lg border border-gray-200 p-5">
                            <h3 className="text-sm font-semibold text-gray-500 uppercase tracking-wider mb-3">
                                Resolution
                            </h3>
                            <span className={`inline-flex px-2.5 py-0.5 text-xs font-semibold rounded-full ${resolutionBadge.color}`}>
                                {resolutionBadge.label}
                            </span>
                            {detail.returnExchangeOrderId && (
                                <div className="mt-3 text-sm">
                                    <span className="text-gray-500">Exchange Order: </span>
                                    <a
                                        href={`/orders?modal=view&orderId=${detail.returnExchangeOrderId}`}
                                        className="text-blue-600 hover:underline font-medium"
                                    >
                                        View Exchange
                                    </a>
                                    {detail.returnExchangePriceDiff != null && detail.returnExchangePriceDiff !== 0 && (
                                        <p className="text-xs text-gray-500 mt-1">
                                            Price difference: {formatCurrency(detail.returnExchangePriceDiff)}
                                        </p>
                                    )}
                                </div>
                            )}
                        </div>

                        {/* Refund Mode */}
                        <div className="bg-white rounded-lg border border-gray-200 p-5">
                            <h3 className="text-sm font-semibold text-gray-500 uppercase tracking-wider mb-3">
                                <CreditCard size={14} className="inline mr-1.5" />
                                Refund Mode
                            </h3>
                            <p className="text-sm font-medium text-gray-900">
                                {detail.returnRefundMethod
                                    ? detail.returnRefundMethod.replace(/_/g, ' ')
                                    : 'Pending'}
                            </p>
                            {detail.returnRefundReference && (
                                <p className="text-xs text-gray-500 mt-1">
                                    Ref: {detail.returnRefundReference}
                                </p>
                            )}
                            {detail.returnRefundCompletedAt && (
                                <p className="text-xs text-green-600 mt-1">
                                    Completed {formatDate(detail.returnRefundCompletedAt)}
                                </p>
                            )}
                        </div>

                        {/* Contact Information */}
                        <div className="bg-white rounded-lg border border-gray-200 p-5">
                            <h3 className="text-sm font-semibold text-gray-500 uppercase tracking-wider mb-3">
                                Contact Information
                            </h3>
                            <div className="space-y-2.5 text-sm">
                                <div className="flex items-center gap-2 text-gray-700">
                                    <Package size={14} className="text-gray-400 flex-shrink-0" />
                                    <span className="font-medium">{detail.customerName}</span>
                                </div>
                                {detail.customerEmail && (
                                    <div className="flex items-center gap-2 text-gray-600">
                                        <Mail size={14} className="text-gray-400 flex-shrink-0" />
                                        <a href={`mailto:${detail.customerEmail}`} className="hover:text-emerald-600">
                                            {detail.customerEmail}
                                        </a>
                                    </div>
                                )}
                                {detail.customerPhone && (
                                    <div className="flex items-center gap-2 text-gray-600">
                                        <Phone size={14} className="text-gray-400 flex-shrink-0" />
                                        <a href={`tel:${detail.customerPhone}`} className="hover:text-emerald-600">
                                            {detail.customerPhone}
                                        </a>
                                    </div>
                                )}
                            </div>
                        </div>

                        {/* Address */}
                        <div className="bg-white rounded-lg border border-gray-200 p-5">
                            <h3 className="text-sm font-semibold text-gray-500 uppercase tracking-wider mb-3">
                                <MapPin size={14} className="inline mr-1.5" />
                                Shipping Address
                            </h3>
                            <p className="text-sm text-gray-700 leading-relaxed">
                                {formatAddress(detail.shippingAddress)}
                            </p>
                        </div>

                        {/* Order Info */}
                        <div className="bg-white rounded-lg border border-gray-200 p-5">
                            <h3 className="text-sm font-semibold text-gray-500 uppercase tracking-wider mb-3">
                                <FileText size={14} className="inline mr-1.5" />
                                Order Details
                            </h3>
                            <div className="space-y-2 text-sm">
                                <div className="flex justify-between">
                                    <span className="text-gray-500">Order Date</span>
                                    <span className="text-gray-900">{formatDate(detail.orderDate)}</span>
                                </div>
                                <div className="flex justify-between">
                                    <span className="text-gray-500">Order Total</span>
                                    <span className="text-gray-900">{formatCurrency(detail.totalAmount)}</span>
                                </div>
                                {detail.paymentMethod && (
                                    <div className="flex justify-between">
                                        <span className="text-gray-500">Payment</span>
                                        <span className="text-gray-900">{detail.paymentMethod}</span>
                                    </div>
                                )}
                            </div>
                        </div>

                        {/* Shopify Order Tags */}
                        {detail.shopifyOrderTags && (
                            <div className="bg-white rounded-lg border border-gray-200 p-5">
                                <h3 className="text-sm font-semibold text-gray-500 uppercase tracking-wider mb-3">
                                    <Tag size={14} className="inline mr-1.5" />
                                    Shopify Order Tags
                                </h3>
                                <div className="flex flex-wrap gap-1.5">
                                    {detail.shopifyOrderTags.split(',').map((tag: string) => tag.trim()).filter(Boolean).map((tag: string) => (
                                        <span
                                            key={tag}
                                            className="inline-flex px-2 py-0.5 text-xs font-medium rounded bg-gray-100 text-gray-600 border border-gray-200"
                                        >
                                            {tag}
                                        </span>
                                    ))}
                                </div>
                            </div>
                        )}

                        {/* Notes */}
                        <div className="bg-white rounded-lg border border-gray-200 p-5">
                            <div className="flex items-center justify-between mb-3">
                                <h3 className="text-sm font-semibold text-gray-500 uppercase tracking-wider">
                                    Notes
                                </h3>
                                {!isTerminal && !notesEditing && (
                                    <button
                                        onClick={() => {
                                            setNotesValue(detail.returnNotes || '');
                                            setNotesEditing(true);
                                        }}
                                        className="text-xs text-emerald-600 hover:underline"
                                    >
                                        Edit
                                    </button>
                                )}
                            </div>
                            {notesEditing ? (
                                <div className="space-y-2">
                                    <textarea
                                        value={displayNotes}
                                        onChange={(e) => setNotesValue(e.target.value)}
                                        rows={4}
                                        className="w-full text-sm border border-gray-200 rounded-lg p-3 focus:outline-none focus:ring-2 focus:ring-emerald-500/30 focus:border-emerald-400 resize-none"
                                        placeholder="Add internal notes..."
                                    />
                                    <div className="flex items-center gap-2">
                                        <Button
                                            onClick={handleSaveNotes}
                                            disabled={updateNotesMutation.isPending}
                                            size="sm"
                                            className="bg-emerald-600 hover:bg-emerald-700 text-white"
                                        >
                                            <Save size={14} className="mr-1" />
                                            {updateNotesMutation.isPending ? 'Saving...' : 'Save'}
                                        </Button>
                                        <Button
                                            onClick={() => {
                                                setNotesEditing(false);
                                                setNotesValue(null);
                                            }}
                                            size="sm"
                                            variant="outline"
                                        >
                                            Cancel
                                        </Button>
                                    </div>
                                </div>
                            ) : (
                                <p className="text-sm text-gray-600">
                                    {detail.returnNotes || <span className="text-gray-400 italic">No notes yet</span>}
                                </p>
                            )}
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
}
