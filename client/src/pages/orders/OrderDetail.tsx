/**
 * OrderDetail — Full-page order detail view (Shopify-style 2-column layout)
 *
 * Matches Shopify's order detail page with:
 * - Status-aware payment card (pending amber / paid green)
 * - Fulfillment groups with shipping method
 * - Tags card
 * - Additional details card (UTM, gateway, etc.)
 * - Timeline with comment input
 */

import { useState, useMemo, useCallback } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useServerFn } from '@tanstack/react-start';
import { useNavigate } from '@tanstack/react-router';
import {
    ArrowLeft, Printer, MoreHorizontal, Package, User,
    MapPin, FileText, Tag, CreditCard, Truck, Mail, Phone,
    ChevronDown, Clock, Info,
    AlertCircle, CheckCircle2, Send,
} from 'lucide-react';

import { Route } from '../../routes/_authenticated/orders_.$orderId';
import { getOrderById } from '../../server/functions/orders';
import type { OrderDetail as OrderDetailType } from '../../server/functions/orderTypes';
import { formatCurrencyExact as formatCurrency } from '../../utils/formatting';
import { getOptimizedImageUrl } from '../../utils/imageOptimization';
import { cn } from '../../lib/utils';
import { LINE_STATUS_CONFIG } from '../../components/orders/UnifiedOrderModal/types';
import type { AddressData } from '../../components/orders/UnifiedOrderModal/types';
import useOrdersMutations from '../../hooks/useOrdersMutations';

// ============================================
// STATUS ORDER for fulfillment groups
// ============================================
const STATUS_ORDER = ['pending', 'allocated', 'picked', 'packed', 'shipped', 'delivered', 'cancelled'];

// ============================================
// HELPERS
// ============================================

function parseAddress(order: OrderDetailType): AddressData | null {
    if (order.shippingAddress) {
        try {
            const raw = order.shippingAddress as string;
            if (typeof raw === 'object') return raw as unknown as AddressData;
            const parsed = JSON.parse(raw);
            if (parsed && typeof parsed === 'object') return parsed;
        } catch { /* not JSON */ }
    }
    return null;
}

function formatAddress(addr: AddressData): string {
    const parts: string[] = [];
    const name = addr.name || [addr.first_name, addr.last_name].filter(Boolean).join(' ');
    if (name) parts.push(name);
    if (addr.address1) parts.push(addr.address1);
    if (addr.address2) parts.push(addr.address2);
    const cityLine = [addr.city, addr.province, addr.zip].filter(Boolean).join(', ');
    if (cityLine) parts.push(cityLine);
    if (addr.country) parts.push(addr.country);
    return parts.join('\n');
}

function formatDate(dateStr: string): string {
    return new Date(dateStr).toLocaleDateString('en-IN', {
        day: 'numeric',
        month: 'short',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
    });
}

function formatDateShort(dateStr: string): string {
    return new Date(dateStr).toLocaleDateString('en-IN', {
        day: 'numeric',
        month: 'short',
        year: 'numeric',
    });
}

function formatTime(dateStr: string): string {
    return new Date(dateStr).toLocaleTimeString('en-IN', {
        hour: 'numeric',
        minute: '2-digit',
        hour12: true,
    });
}

// ============================================
// MAIN COMPONENT
// ============================================

export default function OrderDetail() {
    const { orderId } = Route.useParams();
    const navigate = useNavigate();
    const queryClient = useQueryClient();

    // Server function
    const getOrderByIdFn = useServerFn(getOrderById);

    // Determine if URL param is a UUID or an order number
    const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(orderId);

    // Fetch order data
    const { data: order, isLoading, error } = useQuery({
        queryKey: ['order', orderId],
        queryFn: async () => {
            const input = isUuid ? { id: orderId } : { orderNumber: orderId };
            const result = await getOrderByIdFn({ data: input });
            return result as OrderDetailType;
        },
        staleTime: 30 * 1000,
    });

    // Notes editing state
    const [isEditingNotes, setIsEditingNotes] = useState(false);
    const [notesValue, setNotesValue] = useState('');
    const [showMoreActions, setShowMoreActions] = useState(false);
    const [commentText, setCommentText] = useState('');
    const [showAllAttributes, setShowAllAttributes] = useState(false);

    // Mutations
    const { updateOrderNotes } = useOrdersMutations({
        onNotesSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ['order', orderId] });
            setIsEditingNotes(false);
        },
    });

    // Start editing notes
    const handleEditNotes = useCallback(() => {
        setNotesValue(order?.internalNotes || '');
        setIsEditingNotes(true);
    }, [order?.internalNotes]);

    // Save notes
    const handleSaveNotes = useCallback(() => {
        if (!order) return;
        updateOrderNotes.mutate({ id: order.id, notes: notesValue });
    }, [order, notesValue, updateOrderNotes]);

    // Cancel editing
    const handleCancelNotes = useCallback(() => {
        setIsEditingNotes(false);
        setNotesValue('');
    }, []);

    // Parse financial data
    const financials = useMemo(() => {
        if (!order) return null;
        const subtotalPrice = order.subtotalPrice ? parseFloat(order.subtotalPrice) : 0;
        const totalTax = order.totalTax ? parseFloat(order.totalTax) : 0;
        const totalDiscounts = order.totalDiscounts ? parseFloat(order.totalDiscounts) : 0;
        const shippingCost = order.shippingLines?.reduce(
            (sum, l) => sum + parseFloat(l.price || '0'), 0
        ) || 0;
        const shippingTitle = order.shippingLines?.[0]?.title || null;
        const discountCodes = order.shopifyCache?.discountCodes;
        const paymentMethod = order.paymentMethod || 'Prepaid';
        const isCod = paymentMethod.toUpperCase() === 'COD';
        const total = order.totalAmount || subtotalPrice;

        // Determine payment status
        const financialStatus = order.shopifyCache?.financialStatus || order.paymentStatus || '';
        const isPaid = financialStatus === 'paid' || (!isCod && financialStatus !== 'pending');
        const isPending = isCod || financialStatus === 'pending' || financialStatus === 'authorized';

        return {
            subtotalPrice, totalTax, totalDiscounts, shippingCost, shippingTitle,
            discountCodes, paymentMethod, isCod, total, financialStatus, isPaid, isPending,
        };
    }, [order]);

    // Group lines by status
    const groupedLines = useMemo(() => {
        if (!order) return new Map<string, OrderDetailType['orderLines']>();
        const lines = order.orderLines || [];
        const grouped = new Map<string, OrderDetailType['orderLines']>();
        for (const line of lines) {
            const status = line.lineStatus || 'pending';
            if (!grouped.has(status)) grouped.set(status, []);
            grouped.get(status)!.push(line);
        }
        const sorted = new Map<string, OrderDetailType['orderLines']>();
        for (const status of STATUS_ORDER) {
            if (grouped.has(status)) sorted.set(status, grouped.get(status)!);
        }
        for (const [status, lines] of grouped) {
            if (!sorted.has(status)) sorted.set(status, lines);
        }
        return sorted;
    }, [order]);

    // Address
    const address = useMemo(() => order ? parseAddress(order) : null, [order]);

    // Shopify attributes for Additional Details
    const attributes = useMemo(() => {
        if (!order?.shopifyAttributes) return [];
        return Object.entries(order.shopifyAttributes)
            .filter(([, v]) => v && v.trim() !== '')
            .map(([k, v]) => ({ key: k, value: v }));
    }, [order]);

    // Timeline events
    const timelineEvents = useMemo(() => {
        if (!order) return [];
        const events: Array<{
            id: string;
            type: string;
            title: string;
            description?: string;
            timestamp: Date;
        }> = [];

        if (order.orderDate) {
            events.push({
                id: 'created',
                type: 'created',
                title: `${order.customerName} placed this order on ${order.channel || 'Shopify'}.`,
                timestamp: new Date(order.orderDate),
            });
        }

        // Payment event
        const paymentMethod = financials?.paymentMethod || 'Prepaid';
        if (order.orderDate) {
            const isCod = paymentMethod.toUpperCase() === 'COD';
            events.push({
                id: 'payment',
                type: isCod ? 'payment_pending' : 'payment',
                title: isCod
                    ? `A ${formatCurrency(order.totalAmount || 0)} INR payment is pending on Cash on Delivery (COD).`
                    : `Payment of ${formatCurrency(order.totalAmount || 0)} received via ${paymentMethod}.`,
                timestamp: new Date(new Date(order.orderDate).getTime() + 1000),
            });
        }

        // Shopify confirmation
        if (order.orderDate) {
            events.push({
                id: 'confirmation',
                type: 'confirmation',
                title: `Confirmation #${order.orderNumber} was generated for this order.`,
                timestamp: new Date(new Date(order.orderDate).getTime() + 2000),
            });
        }

        // Email sent
        if (order.customerEmail && order.orderDate) {
            events.push({
                id: 'email_sent',
                type: 'email',
                title: `${order.channel || 'Shopify'} sent an order confirmation email to ${order.customerName} (${order.customerEmail}).`,
                timestamp: new Date(new Date(order.orderDate).getTime() + 3000),
            });
        }

        // Shipped events from lines
        const shippedLines = order.orderLines?.filter(l => l.shippedAt) || [];
        if (shippedLines.length > 0) {
            const first = shippedLines[0];
            events.push({
                id: 'shipped',
                type: 'shipped',
                title: `Order shipped${first.courier ? ` via ${first.courier}` : ''}.`,
                description: first.awbNumber ? `AWB: ${first.awbNumber}` : undefined,
                timestamp: new Date(first.shippedAt!),
            });
        }

        // Delivered
        const deliveredLines = order.orderLines?.filter(l => l.deliveredAt) || [];
        if (deliveredLines.length > 0) {
            events.push({
                id: 'delivered',
                type: 'delivered',
                title: 'Order delivered to customer.',
                timestamp: new Date(deliveredLines[0].deliveredAt!),
            });
        }

        // RTO
        const rtoLines = order.orderLines?.filter(l => l.rtoInitiatedAt) || [];
        if (rtoLines.length > 0) {
            events.push({
                id: 'rto',
                type: 'rto',
                title: 'Return to origin initiated.',
                timestamp: new Date(rtoLines[0].rtoInitiatedAt!),
            });
        }

        events.sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime());
        return events;
    }, [order, financials]);

    // ============================================
    // LOADING STATE
    // ============================================
    if (isLoading) {
        return (
            <div className="min-h-screen bg-gray-50">
                <div className="max-w-6xl mx-auto px-6 py-6">
                    <div className="animate-pulse space-y-4">
                        <div className="h-8 w-48 bg-gray-200 rounded" />
                        <div className="grid grid-cols-3 gap-6">
                            <div className="col-span-2 space-y-4">
                                <div className="h-64 bg-gray-200 rounded-lg" />
                                <div className="h-48 bg-gray-200 rounded-lg" />
                            </div>
                            <div className="space-y-4">
                                <div className="h-32 bg-gray-200 rounded-lg" />
                                <div className="h-48 bg-gray-200 rounded-lg" />
                            </div>
                        </div>
                    </div>
                </div>
            </div>
        );
    }

    // ============================================
    // ERROR STATE
    // ============================================
    if (error || !order) {
        return (
            <div className="min-h-screen bg-gray-50">
                <div className="max-w-6xl mx-auto px-6 py-6">
                    <button
                        onClick={() => navigate({ to: '/orders', search: { view: 'all', page: 1, limit: 250 } })}
                        className="flex items-center gap-1.5 text-sm text-gray-600 hover:text-gray-900 mb-4"
                    >
                        <ArrowLeft className="w-4 h-4" />
                        Back to orders
                    </button>
                    <div className="bg-white rounded-lg border border-gray-200 shadow-sm p-8 text-center">
                        <p className="text-gray-500">
                            {error instanceof Error ? error.message : 'Order not found'}
                        </p>
                    </div>
                </div>
            </div>
        );
    }

    // ============================================
    // STATUS BADGES
    // ============================================
    const paymentBadge = (() => {
        if (financials?.isPending) {
            return (
                <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-amber-100 text-amber-800 border border-amber-200">
                    <span className="w-1.5 h-1.5 rounded-full bg-amber-500" />
                    Payment pending
                </span>
            );
        }
        return (
            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-green-100 text-green-800 border border-green-200">
                <span className="w-1.5 h-1.5 rounded-full bg-green-500" />
                Paid
            </span>
        );
    })();

    const fulfillmentBadge = (() => {
        const fulfillment = order.shopifyCache?.fulfillmentStatus || order.status;
        const normalized = fulfillment?.toLowerCase() || '';
        let color = 'bg-yellow-100 text-yellow-800 border-yellow-200';
        let label = 'Unfulfilled';
        let dot = 'bg-yellow-500';
        if (normalized === 'fulfilled' || normalized === 'delivered') {
            color = 'bg-green-100 text-green-800 border-green-200';
            label = normalized === 'delivered' ? 'Delivered' : 'Fulfilled';
            dot = 'bg-green-500';
        } else if (normalized === 'partial' || normalized === 'partially_fulfilled') {
            color = 'bg-blue-100 text-blue-800 border-blue-200';
            label = 'Partially fulfilled';
            dot = 'bg-blue-500';
        } else if (normalized === 'shipped') {
            color = 'bg-emerald-100 text-emerald-800 border-emerald-200';
            label = 'Shipped';
            dot = 'bg-emerald-500';
        } else if (normalized === 'cancelled') {
            color = 'bg-red-100 text-red-800 border-red-200';
            label = 'Cancelled';
            dot = 'bg-red-500';
        }
        return (
            <span className={cn('inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium border', color)}>
                <span className={cn('w-1.5 h-1.5 rounded-full', dot)} />
                {label}
            </span>
        );
    })();

    const itemCount = order.orderLines.reduce((sum, l) => sum + l.qty, 0);

    // ============================================
    // RENDER
    // ============================================
    return (
        <div className="min-h-screen bg-gray-50">
            <div className="max-w-6xl mx-auto px-6 py-6">

                {/* ===== HEADER ===== */}
                <div className="mb-6">
                    <button
                        onClick={() => navigate({ to: '/orders', search: { view: 'all', page: 1, limit: 250 } })}
                        className="flex items-center gap-1.5 text-sm text-gray-600 hover:text-gray-900 mb-3"
                    >
                        <ArrowLeft className="w-4 h-4" />
                        Orders
                    </button>

                    <div className="flex items-start justify-between">
                        <div>
                            <div className="flex items-center gap-3 mb-1">
                                <h1 className="text-xl font-semibold text-gray-900">
                                    #{order.orderNumber}
                                </h1>
                                {paymentBadge}
                                {fulfillmentBadge}
                                {order.isExchange && (
                                    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-purple-100 text-purple-800 border border-purple-200">
                                        <span className="w-1.5 h-1.5 rounded-full bg-purple-500" />
                                        Exchange
                                    </span>
                                )}
                                {order.isArchived && (
                                    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-gray-100 text-gray-600 border border-gray-200">
                                        Archived
                                    </span>
                                )}
                            </div>
                            <p className="text-sm text-gray-500">
                                {formatDate(order.orderDate)}
                                {order.channel && <span> &middot; {order.channel}</span>}
                            </p>
                        </div>

                        <div className="flex items-center gap-2">
                            <button
                                onClick={() => window.print()}
                                className="inline-flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-lg hover:bg-gray-50"
                            >
                                <Printer className="w-4 h-4" />
                                Print
                            </button>
                            <div className="relative">
                                <button
                                    onClick={() => setShowMoreActions(!showMoreActions)}
                                    className="inline-flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-lg hover:bg-gray-50"
                                >
                                    More actions
                                    <ChevronDown className="w-3 h-3" />
                                </button>
                                {showMoreActions && (
                                    <>
                                        <div className="fixed inset-0 z-10" onClick={() => setShowMoreActions(false)} />
                                        <div className="absolute right-0 mt-1 w-48 bg-white border border-gray-200 rounded-lg shadow-lg z-20 py-1">
                                            <button
                                                onClick={() => {
                                                    setShowMoreActions(false);
                                                    handleEditNotes();
                                                }}
                                                className="w-full text-left px-4 py-2 text-sm text-gray-700 hover:bg-gray-50"
                                            >
                                                Edit notes
                                            </button>
                                            {order.shopifyCache?.trackingUrl && (
                                                <a
                                                    href={order.shopifyCache.trackingUrl}
                                                    target="_blank"
                                                    rel="noopener noreferrer"
                                                    className="block px-4 py-2 text-sm text-gray-700 hover:bg-gray-50"
                                                    onClick={() => setShowMoreActions(false)}
                                                >
                                                    Track shipment
                                                </a>
                                            )}
                                        </div>
                                    </>
                                )}
                            </div>
                        </div>
                    </div>
                </div>

                {/* ===== TWO COLUMN LAYOUT ===== */}
                <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">

                    {/* ===== LEFT COLUMN (2/3) ===== */}
                    <div className="lg:col-span-2 space-y-4">

                        {/* --- FULFILLMENT GROUPS --- */}
                        {Array.from(groupedLines.entries()).map(([status, lines]) => {
                            const config = LINE_STATUS_CONFIG[status] || LINE_STATUS_CONFIG.pending;
                            const isUnfulfilled = ['pending', 'allocated', 'picked', 'packed'].includes(status);
                            return (
                                <div key={status} className="bg-white rounded-lg border border-gray-200 shadow-sm overflow-hidden">
                                    {/* Status header bar */}
                                    <div className={cn('px-4 py-3 flex items-center justify-between border-b border-gray-100', config.bg)}>
                                        <div className="flex items-center gap-2">
                                            {isUnfulfilled ? (
                                                <Package className={cn('w-4 h-4', config.text)} />
                                            ) : status === 'shipped' ? (
                                                <Truck className={cn('w-4 h-4', config.text)} />
                                            ) : status === 'delivered' ? (
                                                <CheckCircle2 className={cn('w-4 h-4', config.text)} />
                                            ) : (
                                                <Package className={cn('w-4 h-4', config.text)} />
                                            )}
                                            <span className={cn('text-sm font-semibold', config.text)}>
                                                {config.label}
                                            </span>
                                            <span className="text-xs text-gray-500">
                                                ({lines.length} {lines.length === 1 ? 'item' : 'items'})
                                            </span>
                                        </div>
                                        {(status === 'shipped' || status === 'delivered') && lines.some(l => l.awbNumber) && (
                                            <span className="text-xs text-gray-500">
                                                {(() => {
                                                    const awb = lines.find(l => l.awbNumber);
                                                    return awb ? `${awb.courier || 'Courier'} · ${awb.awbNumber}` : null;
                                                })()}
                                            </span>
                                        )}
                                    </div>

                                    {/* Shipping method (for unfulfilled groups) */}
                                    {isUnfulfilled && financials?.shippingTitle && (
                                        <div className="px-4 py-2 bg-gray-50 border-b border-gray-100 flex items-center gap-2">
                                            <Truck className="w-3.5 h-3.5 text-gray-400" />
                                            <span className="text-xs text-gray-500">
                                                {financials.shippingTitle}
                                                {financials.shippingCost > 0 && ` (${formatCurrency(financials.shippingCost)})`}
                                                {financials.shippingCost === 0 && ' (Free Shipping)'}
                                            </span>
                                        </div>
                                    )}

                                    {/* Line items */}
                                    <div className="divide-y divide-gray-100">
                                        {lines.map((line) => {
                                            const imageUrl = getOptimizedImageUrl(
                                                line.sku.variation.imageUrl || line.sku.variation.product.imageUrl,
                                                'sm'
                                            );
                                            const productName = line.sku.variation.product.name;
                                            const variantInfo = [
                                                line.sku.variation.colorName,
                                                line.sku.size,
                                            ].filter(Boolean).join(' / ');
                                            const lineTotal = line.unitPrice * line.qty;

                                            return (
                                                <div key={line.id} className="px-4 py-3 flex items-center gap-4">
                                                    {/* Product image */}
                                                    <div className="w-12 h-12 rounded-md border border-gray-200 overflow-hidden flex-shrink-0 bg-gray-50">
                                                        {imageUrl ? (
                                                            <img
                                                                src={imageUrl}
                                                                alt={productName}
                                                                className="w-full h-full object-cover"
                                                            />
                                                        ) : (
                                                            <div className="w-full h-full flex items-center justify-center">
                                                                <Package className="w-5 h-5 text-gray-300" />
                                                            </div>
                                                        )}
                                                    </div>

                                                    {/* Product info */}
                                                    <div className="flex-1 min-w-0">
                                                        <p className="text-sm font-medium text-blue-700 truncate hover:underline cursor-pointer">
                                                            {productName}
                                                        </p>
                                                        <p className="text-xs text-gray-500">
                                                            {variantInfo}
                                                        </p>
                                                        <p className="text-xs text-gray-400 font-mono">
                                                            {line.sku.skuCode}
                                                        </p>
                                                        {line.isCustomized && (
                                                            <span className="inline-block mt-0.5 px-1.5 py-0.5 text-xs bg-purple-50 text-purple-700 rounded">
                                                                Customized
                                                            </span>
                                                        )}
                                                    </div>

                                                    {/* Price x Qty = Total */}
                                                    <div className="text-right flex-shrink-0">
                                                        <p className="text-sm text-gray-700">
                                                            {formatCurrency(line.unitPrice)} &times; {line.qty}
                                                        </p>
                                                        <p className="text-sm font-medium text-gray-900">
                                                            {formatCurrency(lineTotal)}
                                                        </p>
                                                    </div>
                                                </div>
                                            );
                                        })}
                                    </div>

                                    {/* AWB info for shipped/delivered lines */}
                                    {(status === 'shipped' || status === 'delivered') && lines.some(l => l.awbNumber) && (
                                        <div className="px-4 py-2.5 border-t border-gray-100 bg-gray-50">
                                            <div className="flex items-center gap-2 text-xs text-gray-500">
                                                <Truck className="w-3.5 h-3.5" />
                                                {(() => {
                                                    const awb = lines.find(l => l.awbNumber);
                                                    return awb ? (
                                                        <span>
                                                            {awb.courier && `${awb.courier} — `}
                                                            {awb.awbNumber}
                                                            {awb.shippedAt && ` (shipped ${formatDateShort(awb.shippedAt)})`}
                                                        </span>
                                                    ) : null;
                                                })()}
                                            </div>
                                        </div>
                                    )}

                                    {/* CTA for unfulfilled items */}
                                    {isUnfulfilled && (
                                        <div className="px-4 py-3 border-t border-gray-100 flex justify-end">
                                            <button
                                                disabled
                                                title="Fulfillment is managed via Google Sheets"
                                                className="px-4 py-1.5 text-sm font-medium text-white bg-gray-300 rounded-lg cursor-not-allowed"
                                            >
                                                Mark as fulfilled
                                            </button>
                                        </div>
                                    )}
                                </div>
                            );
                        })}

                        {/* --- PAYMENT CARD (Shopify-style) --- */}
                        {financials && (
                            <div className="bg-white rounded-lg border border-gray-200 shadow-sm overflow-hidden">
                                {/* Payment status header */}
                                <div className={cn(
                                    'px-4 py-3 border-b flex items-center justify-between',
                                    financials.isPending
                                        ? 'bg-amber-50 border-amber-100'
                                        : 'bg-green-50 border-green-100'
                                )}>
                                    <div className="flex items-center gap-2">
                                        {financials.isPending ? (
                                            <AlertCircle className="w-4 h-4 text-amber-600" />
                                        ) : (
                                            <CheckCircle2 className="w-4 h-4 text-green-600" />
                                        )}
                                        <span className={cn(
                                            'text-sm font-semibold',
                                            financials.isPending ? 'text-amber-800' : 'text-green-800'
                                        )}>
                                            {financials.isPending ? 'Payment pending' : 'Paid'}
                                        </span>
                                    </div>
                                    <MoreHorizontal className="w-4 h-4 text-gray-400" />
                                </div>

                                {/* COD pending message */}
                                {financials.isPending && financials.isCod && (
                                    <div className="px-4 py-3 bg-amber-50/50 border-b border-gray-100">
                                        <div className="flex items-start gap-2">
                                            <Info className="w-4 h-4 text-amber-500 mt-0.5 flex-shrink-0" />
                                            <p className="text-sm text-gray-600">
                                                Cash on Delivery (COD) is still processing this order&apos;s payment.
                                                To make sure you get paid, wait for the payment to be successful before fulfilling this order.
                                            </p>
                                        </div>
                                    </div>
                                )}

                                <div className="px-4 py-3 space-y-2">
                                    {/* Subtotal with item count */}
                                    <div className="flex justify-between text-sm">
                                        <span className="text-gray-600">Subtotal</span>
                                        <span className="text-gray-500">{itemCount} {itemCount === 1 ? 'item' : 'items'}</span>
                                        <span className="text-gray-900">
                                            {formatCurrency(financials.subtotalPrice || order.orderLines.reduce((s, l) => s + l.unitPrice * l.qty, 0))}
                                        </span>
                                    </div>

                                    {/* Discount */}
                                    {financials.totalDiscounts > 0 && (
                                        <div className="flex justify-between text-sm">
                                            <span className="text-gray-600 flex items-center gap-1.5">
                                                Discount
                                                {financials.discountCodes && (
                                                    <span className="px-1.5 py-0.5 bg-gray-100 text-gray-700 rounded text-xs font-mono">
                                                        {financials.discountCodes}
                                                    </span>
                                                )}
                                            </span>
                                            <span className="text-green-600">-{formatCurrency(financials.totalDiscounts)}</span>
                                        </div>
                                    )}

                                    {/* Shipping */}
                                    <div className="flex justify-between text-sm">
                                        <span className="text-gray-600">
                                            Shipping
                                            {financials.shippingTitle && (
                                                <span className="text-gray-400 text-xs ml-1">
                                                    {financials.shippingTitle}
                                                </span>
                                            )}
                                        </span>
                                        <span className="text-gray-900">
                                            {financials.shippingCost > 0 ? formatCurrency(financials.shippingCost) : formatCurrency(0)}
                                        </span>
                                    </div>

                                    {/* Tax */}
                                    <div className="flex justify-between text-sm">
                                        <span className="text-gray-600">Taxes</span>
                                        <span className="text-gray-900">
                                            {financials.totalTax > 0 ? formatCurrency(financials.totalTax) : 'Included'}
                                        </span>
                                    </div>

                                    {/* Divider + Total */}
                                    <div className="border-t border-gray-100 pt-2 mt-2">
                                        <div className="flex justify-between text-sm font-semibold">
                                            <span className="text-gray-900">Total</span>
                                            <span className="text-gray-900">{formatCurrency(financials.total || 0)}</span>
                                        </div>
                                    </div>

                                    {/* Paid / Balance */}
                                    <div className="space-y-1">
                                        <div className="flex justify-between text-sm">
                                            <span className="text-gray-600">Paid</span>
                                            <span className="text-gray-900">
                                                {financials.isPaid ? formatCurrency(financials.total || 0) : formatCurrency(0)}
                                            </span>
                                        </div>
                                        <div className="flex justify-between text-sm">
                                            <span className="text-gray-600">Balance</span>
                                            <span className="text-gray-900">
                                                {financials.isPending ? formatCurrency(financials.total || 0) : formatCurrency(0)}
                                            </span>
                                        </div>
                                    </div>

                                    {/* Action buttons for pending payments */}
                                    {financials.isPending && (
                                        <div className="flex gap-2 pt-2 border-t border-gray-100 mt-2">
                                            <button
                                                disabled
                                                className="px-3 py-1.5 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-lg hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed"
                                            >
                                                Send invoice
                                            </button>
                                            <button
                                                disabled
                                                className="px-3 py-1.5 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-lg hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed"
                                            >
                                                Mark as paid
                                            </button>
                                        </div>
                                    )}
                                </div>
                            </div>
                        )}

                        {/* --- TIMELINE CARD (Shopify-style) --- */}
                        <div className="bg-white rounded-lg border border-gray-200 shadow-sm overflow-hidden">
                            <div className="px-4 py-3 border-b border-gray-100">
                                <h2 className="text-sm font-semibold text-gray-900">Timeline</h2>
                            </div>

                            {/* Comment input */}
                            <div className="px-4 py-3 border-b border-gray-100">
                                <div className="flex items-start gap-3">
                                    <div className="w-8 h-8 rounded-full bg-green-600 flex items-center justify-center flex-shrink-0">
                                        <span className="text-xs font-semibold text-white">SG</span>
                                    </div>
                                    <div className="flex-1">
                                        <input
                                            type="text"
                                            value={commentText}
                                            onChange={(e) => setCommentText(e.target.value)}
                                            placeholder="Leave a comment..."
                                            className="w-full text-sm border border-gray-300 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                                        />
                                        {commentText.trim() && (
                                            <div className="flex justify-end mt-2">
                                                <button
                                                    onClick={() => {
                                                        // Save as internal note (append to existing)
                                                        if (!order) return;
                                                        const newNotes = order.internalNotes
                                                            ? `${order.internalNotes}\n\n[${new Date().toLocaleDateString('en-IN')}] ${commentText}`
                                                            : `[${new Date().toLocaleDateString('en-IN')}] ${commentText}`;
                                                        updateOrderNotes.mutate({ id: order.id, notes: newNotes });
                                                        setCommentText('');
                                                    }}
                                                    disabled={updateOrderNotes.isPending}
                                                    className="inline-flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium text-white bg-gray-800 rounded-lg hover:bg-gray-900 disabled:opacity-50"
                                                >
                                                    <Send className="w-3.5 h-3.5" />
                                                    Post
                                                </button>
                                            </div>
                                        )}
                                    </div>
                                </div>
                                <p className="text-xs text-gray-400 mt-2 ml-11">
                                    Only you and other staff can see comments
                                </p>
                            </div>

                            {/* Timeline events */}
                            <div className="px-4 py-3">
                                {timelineEvents.length > 0 && (
                                    <div className="space-y-0">
                                        {/* Group by date */}
                                        {(() => {
                                            const groups = new Map<string, typeof timelineEvents>();
                                            for (const event of timelineEvents) {
                                                const dateKey = event.timestamp.toLocaleDateString('en-IN', {
                                                    day: 'numeric',
                                                    month: 'long',
                                                    year: 'numeric',
                                                });
                                                const today = new Date().toLocaleDateString('en-IN', {
                                                    day: 'numeric',
                                                    month: 'long',
                                                    year: 'numeric',
                                                });
                                                const label = dateKey === today ? 'Today' : dateKey;
                                                if (!groups.has(label)) groups.set(label, []);
                                                groups.get(label)!.push(event);
                                            }
                                            return Array.from(groups.entries()).map(([dateLabel, events]) => (
                                                <div key={dateLabel}>
                                                    <div className="flex items-center gap-3 py-2">
                                                        <div className="h-px flex-1 bg-gray-200" />
                                                        <span className="text-xs font-medium text-gray-500">{dateLabel}</span>
                                                        <div className="h-px flex-1 bg-gray-200" />
                                                    </div>
                                                    <div className="space-y-3">
                                                        {events.map((event) => (
                                                            <div key={event.id} className="flex items-start gap-3">
                                                                <div className="mt-1 flex-shrink-0">
                                                                    <TimelineIcon type={event.type} />
                                                                </div>
                                                                <div className="flex-1 min-w-0">
                                                                    <p className="text-sm text-gray-700">{event.title}</p>
                                                                    {event.description && (
                                                                        <p className="text-xs text-gray-500 mt-0.5">{event.description}</p>
                                                                    )}
                                                                </div>
                                                                <span className="text-xs text-gray-400 whitespace-nowrap flex-shrink-0">
                                                                    {formatTime(event.timestamp.toISOString())}
                                                                </span>
                                                            </div>
                                                        ))}
                                                    </div>
                                                </div>
                                            ));
                                        })()}
                                    </div>
                                )}
                            </div>
                        </div>
                    </div>

                    {/* ===== RIGHT COLUMN (1/3) ===== */}
                    <div className="space-y-4">

                        {/* --- NOTES CARD --- */}
                        <div className="bg-white rounded-lg border border-gray-200 shadow-sm">
                            <div className="px-4 py-3 border-b border-gray-100">
                                <div className="flex items-center justify-between">
                                    <h2 className="text-sm font-semibold text-gray-900">Notes</h2>
                                    {!isEditingNotes && (
                                        <button
                                            onClick={handleEditNotes}
                                            className="text-xs text-blue-600 hover:text-blue-700 font-medium"
                                        >
                                            Edit
                                        </button>
                                    )}
                                </div>
                            </div>
                            <div className="px-4 py-3 space-y-3">
                                {/* Customer notes */}
                                {order.shopifyCache?.customerNotes ? (
                                    <p className="text-sm text-gray-700">
                                        {order.shopifyCache.customerNotes}
                                    </p>
                                ) : (
                                    <p className="text-sm text-gray-400">No notes from customer</p>
                                )}

                                {/* Internal notes */}
                                {isEditingNotes ? (
                                    <div className="border-t border-gray-100 pt-3">
                                        <p className="text-xs font-medium text-gray-500 mb-1">Internal notes</p>
                                        <textarea
                                            value={notesValue}
                                            onChange={(e) => setNotesValue(e.target.value)}
                                            rows={4}
                                            className="w-full text-sm border border-gray-300 rounded-md px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent resize-none"
                                            placeholder="Add internal notes..."
                                            autoFocus
                                        />
                                        <div className="flex gap-2 mt-2">
                                            <button
                                                onClick={handleSaveNotes}
                                                disabled={updateOrderNotes.isPending}
                                                className="px-3 py-1.5 text-xs font-medium text-white bg-blue-600 rounded-md hover:bg-blue-700 disabled:opacity-50"
                                            >
                                                {updateOrderNotes.isPending ? 'Saving...' : 'Save'}
                                            </button>
                                            <button
                                                onClick={handleCancelNotes}
                                                className="px-3 py-1.5 text-xs font-medium text-gray-700 bg-white border border-gray-300 rounded-md hover:bg-gray-50"
                                            >
                                                Cancel
                                            </button>
                                        </div>
                                    </div>
                                ) : order.internalNotes ? (
                                    <div className="border-t border-gray-100 pt-3">
                                        <p className="text-xs font-medium text-gray-500 mb-1">Internal notes</p>
                                        <p className="text-sm text-gray-700 whitespace-pre-wrap">{order.internalNotes}</p>
                                    </div>
                                ) : null}
                            </div>
                        </div>

                        {/* --- ADDITIONAL DETAILS CARD --- */}
                        {attributes.length > 0 && (
                            <div className="bg-white rounded-lg border border-gray-200 shadow-sm">
                                <div className="px-4 py-3 border-b border-gray-100">
                                    <h2 className="text-sm font-semibold text-gray-900">Additional details</h2>
                                </div>
                                <div className="px-4 py-3 space-y-2.5">
                                    {(showAllAttributes ? attributes : attributes.slice(0, 6)).map(({ key, value }) => (
                                        <div key={key}>
                                            <p className="text-xs font-medium text-gray-500">{key}</p>
                                            <p className="text-sm text-gray-700 break-all">{value}</p>
                                        </div>
                                    ))}
                                    {attributes.length > 6 && (
                                        <button
                                            onClick={() => setShowAllAttributes(!showAllAttributes)}
                                            className="text-xs text-blue-600 hover:text-blue-700 font-medium"
                                        >
                                            {showAllAttributes ? 'Show less' : `View all (${attributes.length})`}
                                        </button>
                                    )}
                                </div>
                            </div>
                        )}

                        {/* --- CUSTOMER CARD --- */}
                        <div className="bg-white rounded-lg border border-gray-200 shadow-sm">
                            <div className="px-4 py-3 border-b border-gray-100">
                                <div className="flex items-center gap-2">
                                    <User className="w-4 h-4 text-gray-400" />
                                    <h2 className="text-sm font-semibold text-gray-900">Customer</h2>
                                </div>
                            </div>
                            <div className="px-4 py-3 space-y-2.5">
                                <p
                                    className="text-sm font-medium text-blue-700 hover:underline cursor-pointer"
                                    onClick={() => {
                                        const customerIdentifier = order.customerEmail || order.customer?.email || order.customerId;
                                        if (customerIdentifier) navigate({
                                            to: '/customers/$customerId',
                                            params: { customerId: customerIdentifier },
                                        });
                                    }}
                                >
                                    {order.customerName}
                                </p>
                                {order.customer && (
                                    <p className="text-xs text-blue-600">
                                        {order.customer.orderCount} {order.customer.orderCount === 1 ? 'order' : 'orders'}
                                    </p>
                                )}

                                {/* Contact information */}
                                <div className="border-t border-gray-100 pt-2.5 mt-2.5">
                                    <p className="text-xs font-medium text-gray-500 mb-2">Contact information</p>
                                    {(order.customerEmail || order.customer?.email) && (
                                        <div className="flex items-center gap-2 text-sm text-blue-600 mb-1">
                                            <a
                                                href={`mailto:${order.customerEmail || order.customer?.email}`}
                                                className="hover:underline truncate"
                                            >
                                                {order.customerEmail || order.customer?.email}
                                            </a>
                                        </div>
                                    )}
                                    {(order.customerPhone || order.customer?.phone) && (
                                        <div className="flex items-center gap-2 text-sm text-gray-600">
                                            <Phone className="w-3.5 h-3.5 text-gray-400" />
                                            <span>{order.customerPhone || order.customer?.phone}</span>
                                        </div>
                                    )}
                                </div>

                                {/* Customer badges */}
                                {order.customer && (
                                    <div className="flex flex-wrap gap-1.5 pt-1">
                                        <span className="px-2 py-0.5 rounded-full text-xs font-medium bg-blue-50 text-blue-700">
                                            LTV: {formatCurrency(order.customer.ltv)}
                                        </span>
                                        {order.customer.rtoCount > 0 && (
                                            <span className="px-2 py-0.5 rounded-full text-xs font-medium bg-red-50 text-red-700">
                                                {order.customer.rtoCount} RTO
                                            </span>
                                        )}
                                        {order.customer.tier && (
                                            <span className="px-2 py-0.5 rounded-full text-xs font-medium bg-purple-50 text-purple-700">
                                                {order.customer.tier}
                                            </span>
                                        )}
                                    </div>
                                )}
                            </div>
                        </div>

                        {/* --- SHIPPING ADDRESS CARD --- */}
                        {address && (
                            <div className="bg-white rounded-lg border border-gray-200 shadow-sm">
                                <div className="px-4 py-3 border-b border-gray-100">
                                    <div className="flex items-center gap-2">
                                        <MapPin className="w-4 h-4 text-gray-400" />
                                        <h2 className="text-sm font-semibold text-gray-900">Shipping address</h2>
                                    </div>
                                </div>
                                <div className="px-4 py-3">
                                    <p className="text-sm text-gray-700 whitespace-pre-line">
                                        {formatAddress(address)}
                                    </p>
                                    {address.phone && (
                                        <div className="flex items-center gap-2 mt-2 text-sm text-gray-500">
                                            <Phone className="w-3.5 h-3.5" />
                                            {address.phone}
                                        </div>
                                    )}
                                </div>
                            </div>
                        )}

                        {/* --- TAGS CARD --- */}
                        {order.shopifyCache?.tags && (
                            <div className="bg-white rounded-lg border border-gray-200 shadow-sm">
                                <div className="px-4 py-3 border-b border-gray-100">
                                    <div className="flex items-center gap-2">
                                        <Tag className="w-4 h-4 text-gray-400" />
                                        <h2 className="text-sm font-semibold text-gray-900">Tags</h2>
                                    </div>
                                </div>
                                <div className="px-4 py-3">
                                    <div className="flex flex-wrap gap-1.5">
                                        {order.shopifyCache.tags.split(',').map((tag) => (
                                            <span
                                                key={tag.trim()}
                                                className="inline-flex items-center px-2 py-0.5 bg-gray-100 text-gray-700 rounded-full text-xs"
                                            >
                                                {tag.trim()}
                                                <button className="ml-1 text-gray-400 hover:text-gray-600">&times;</button>
                                            </span>
                                        ))}
                                    </div>
                                </div>
                            </div>
                        )}

                        {/* --- ORDER DETAILS CARD --- */}
                        <div className="bg-white rounded-lg border border-gray-200 shadow-sm">
                            <div className="px-4 py-3 border-b border-gray-100">
                                <div className="flex items-center gap-2">
                                    <FileText className="w-4 h-4 text-gray-400" />
                                    <h2 className="text-sm font-semibold text-gray-900">Order details</h2>
                                </div>
                            </div>
                            <div className="px-4 py-3 space-y-2.5">
                                <DetailRow label="Order date" value={formatDateShort(order.orderDate)} />
                                <DetailRow label="Total" value={formatCurrency(order.totalAmount || 0)} />
                                <DetailRow label="Payment" value={financials?.paymentMethod || 'Prepaid'} />
                                {order.paymentStatus && (
                                    <DetailRow label="Payment status" value={order.paymentStatus} />
                                )}
                                {order.channel && (
                                    <DetailRow label="Channel" value={order.channel} />
                                )}
                                {order.shipByDate && (
                                    <DetailRow label="Ship by" value={formatDateShort(order.shipByDate)} />
                                )}
                            </div>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
}

// ============================================
// SUB-COMPONENTS
// ============================================

function DetailRow({ label, value }: { label: string; value: React.ReactNode }) {
    return (
        <div className="flex justify-between text-sm">
            <span className="text-gray-500">{label}</span>
            <span className="text-gray-900 text-right">{value}</span>
        </div>
    );
}

function TimelineIcon({ type }: { type: string }) {
    const base = "w-5 h-5 rounded-full flex items-center justify-center";
    switch (type) {
        case 'created':
            return <div className={cn(base, 'bg-gray-200')}><Package className="w-3 h-3 text-gray-500" /></div>;
        case 'payment':
            return <div className={cn(base, 'bg-green-100')}><CreditCard className="w-3 h-3 text-green-600" /></div>;
        case 'payment_pending':
            return <div className={cn(base, 'bg-amber-100')}><CreditCard className="w-3 h-3 text-amber-600" /></div>;
        case 'confirmation':
            return <div className={cn(base, 'bg-blue-100')}><FileText className="w-3 h-3 text-blue-600" /></div>;
        case 'email':
            return <div className={cn(base, 'bg-sky-100')}><Mail className="w-3 h-3 text-sky-600" /></div>;
        case 'shipped':
            return <div className={cn(base, 'bg-emerald-100')}><Truck className="w-3 h-3 text-emerald-600" /></div>;
        case 'delivered':
            return <div className={cn(base, 'bg-green-100')}><CheckCircle2 className="w-3 h-3 text-green-600" /></div>;
        case 'rto':
            return <div className={cn(base, 'bg-orange-100')}><AlertCircle className="w-3 h-3 text-orange-600" /></div>;
        default:
            return <div className={cn(base, 'bg-gray-100')}><Clock className="w-3 h-3 text-gray-500" /></div>;
    }
}
