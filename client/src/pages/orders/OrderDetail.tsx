/**
 * OrderDetail — Full-page order detail view (Shopify-style 2-column layout)
 *
 * Replaces the modal-based approach with a dedicated route at /orders/$orderId.
 */

import { useState, useMemo, useCallback } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useServerFn } from '@tanstack/react-start';
import { useNavigate } from '@tanstack/react-router';
import {
    ArrowLeft, Printer, MoreHorizontal, Package, User,
    MapPin, FileText, Tag, CreditCard, Truck, Mail, Phone,
    Percent, ChevronDown,
} from 'lucide-react';

import { Route } from '../../routes/_authenticated/orders_.$orderId';
import { getOrderById } from '../../server/functions/orders';
import type { OrderDetail as OrderDetailType } from '../../server/functions/orderTypes';
import { formatCurrencyExact as formatCurrency } from '../../utils/formatting';
import { getOptimizedImageUrl } from '../../utils/imageOptimization';
import { cn } from '../../lib/utils';
import { LINE_STATUS_CONFIG } from '../../components/orders/UnifiedOrderModal/types';
import type { AddressData } from '../../components/orders/UnifiedOrderModal/types';
import { TimelineSection } from '../../components/orders/UnifiedOrderModal/components/TimelineSection';
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
        const shopifyDetails = (order as unknown as Record<string, unknown>).shopifyDetails as {
            subtotalPrice?: string;
            totalTax?: string;
            totalDiscounts?: string;
            shippingLines?: Array<{ title: string; price: string }>;
        } | undefined;
        const subtotalPrice = shopifyDetails?.subtotalPrice ? parseFloat(shopifyDetails.subtotalPrice) : 0;
        const totalTax = shopifyDetails?.totalTax ? parseFloat(shopifyDetails.totalTax) : 0;
        const totalDiscounts = shopifyDetails?.totalDiscounts ? parseFloat(shopifyDetails.totalDiscounts) : 0;
        const shippingCost = shopifyDetails?.shippingLines?.reduce(
            (sum: number, l: { price: string }) => sum + parseFloat(l.price || '0'), 0
        ) || 0;
        const discountCodes = order.shopifyCache?.discountCodes;
        const paymentMethod = order.paymentMethod || 'Prepaid';
        const isCod = paymentMethod.toUpperCase() === 'COD';
        const total = order.totalAmount || subtotalPrice;

        return { subtotalPrice, totalTax, totalDiscounts, shippingCost, discountCodes, paymentMethod, isCod, total };
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
        // Sort by status order
        const sorted = new Map<string, OrderDetailType['orderLines']>();
        for (const status of STATUS_ORDER) {
            if (grouped.has(status)) sorted.set(status, grouped.get(status)!);
        }
        // Add any remaining statuses not in the predefined order
        for (const [status, lines] of grouped) {
            if (!sorted.has(status)) sorted.set(status, lines);
        }
        return sorted;
    }, [order]);

    // Address
    const address = useMemo(() => order ? parseAddress(order) : null, [order]);

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
        const isCod = financials?.isCod;
        return (
            <span className={cn(
                'px-2 py-0.5 rounded-full text-xs font-medium',
                isCod ? 'bg-amber-100 text-amber-800' : 'bg-green-100 text-green-800'
            )}>
                {isCod ? 'COD' : 'Paid'}
            </span>
        );
    })();

    const fulfillmentBadge = (() => {
        const fulfillment = order.shopifyCache?.fulfillmentStatus || order.status;
        const normalized = fulfillment?.toLowerCase() || '';
        let color = 'bg-yellow-100 text-yellow-800';
        let label = 'Unfulfilled';
        if (normalized === 'fulfilled' || normalized === 'delivered') {
            color = 'bg-green-100 text-green-800';
            label = normalized === 'delivered' ? 'Delivered' : 'Fulfilled';
        } else if (normalized === 'partial' || normalized === 'partially_fulfilled') {
            color = 'bg-blue-100 text-blue-800';
            label = 'Partially fulfilled';
        } else if (normalized === 'shipped') {
            color = 'bg-emerald-100 text-emerald-800';
            label = 'Shipped';
        } else if (normalized === 'cancelled') {
            color = 'bg-red-100 text-red-800';
            label = 'Cancelled';
        }
        return (
            <span className={cn('px-2 py-0.5 rounded-full text-xs font-medium', color)}>
                {label}
            </span>
        );
    })();

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
                                    <span className="px-2 py-0.5 rounded-full text-xs font-medium bg-purple-100 text-purple-800">
                                        Exchange
                                    </span>
                                )}
                                {order.isArchived && (
                                    <span className="px-2 py-0.5 rounded-full text-xs font-medium bg-gray-100 text-gray-600">
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
                                    <MoreHorizontal className="w-4 h-4" />
                                    More actions
                                    <ChevronDown className="w-3 h-3" />
                                </button>
                                {showMoreActions && (
                                    <>
                                        <div className="fixed inset-0 z-10" onClick={() => setShowMoreActions(false)} />
                                        <div className="absolute right-0 mt-1 w-48 bg-white border border-gray-200 rounded-lg shadow-lg z-20">
                                            <button
                                                onClick={() => {
                                                    setShowMoreActions(false);
                                                    handleEditNotes();
                                                }}
                                                className="w-full text-left px-4 py-2 text-sm text-gray-700 hover:bg-gray-50 rounded-t-lg"
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
                            return (
                                <div key={status} className="bg-white rounded-lg border border-gray-200 shadow-sm overflow-hidden">
                                    {/* Status header bar */}
                                    <div className={cn('px-4 py-2.5 flex items-center justify-between', config.bg)}>
                                        <div className="flex items-center gap-2">
                                            <Package className={cn('w-4 h-4', config.text)} />
                                            <span className={cn('text-sm font-semibold', config.text)}>
                                                {config.label} ({lines.length})
                                            </span>
                                        </div>
                                        {status === 'shipped' && order.shopifyCache?.trackingNumber && (
                                            <span className="text-xs text-gray-500">
                                                AWB: {order.shopifyCache.trackingNumber}
                                                {order.shopifyCache.trackingCompany && ` (${order.shopifyCache.trackingCompany})`}
                                            </span>
                                        )}
                                    </div>

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
                                                        <p className="text-sm font-medium text-gray-900 truncate">
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
                                                        <p className="text-sm font-medium text-gray-900">
                                                            {formatCurrency(lineTotal)}
                                                        </p>
                                                        <p className="text-xs text-gray-500">
                                                            {formatCurrency(line.unitPrice)} &times; {line.qty}
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
                                                            {awb.courier && `${awb.courier} - `}
                                                            {awb.awbNumber}
                                                            {awb.shippedAt && ` (shipped ${formatDateShort(awb.shippedAt)})`}
                                                        </span>
                                                    ) : null;
                                                })()}
                                            </div>
                                        </div>
                                    )}

                                    {/* CTA for packed items */}
                                    {status === 'packed' && (
                                        <div className="px-4 py-2.5 border-t border-gray-100">
                                            <button
                                                disabled
                                                title="Fulfillment is managed via Google Sheets"
                                                className="text-sm font-medium text-gray-400 cursor-not-allowed"
                                            >
                                                Mark as fulfilled (managed in Sheets)
                                            </button>
                                        </div>
                                    )}
                                </div>
                            );
                        })}

                        {/* --- PAYMENT CARD --- */}
                        {financials && (
                            <div className="bg-white rounded-lg border border-gray-200 shadow-sm">
                                <div className="px-4 py-3 border-b border-gray-100">
                                    <div className="flex items-center gap-2">
                                        <CreditCard className="w-4 h-4 text-gray-400" />
                                        <h2 className="text-sm font-semibold text-gray-900">Payment</h2>
                                    </div>
                                </div>
                                <div className="px-4 py-3 space-y-2">
                                    {/* Subtotal */}
                                    <div className="flex justify-between text-sm">
                                        <span className="text-gray-600">Subtotal</span>
                                        <span className="text-gray-900">
                                            {formatCurrency(financials.subtotalPrice || order.orderLines.reduce((s, l) => s + l.unitPrice * l.qty, 0))}
                                        </span>
                                    </div>

                                    {/* Discount */}
                                    {financials.totalDiscounts > 0 && (
                                        <div className="flex justify-between text-sm">
                                            <span className="text-gray-600 flex items-center gap-1.5">
                                                <Percent className="w-3 h-3" />
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
                                    {financials.shippingCost > 0 && (
                                        <div className="flex justify-between text-sm">
                                            <span className="text-gray-600">Shipping</span>
                                            <span className="text-gray-900">{formatCurrency(financials.shippingCost)}</span>
                                        </div>
                                    )}

                                    {/* Tax */}
                                    {financials.totalTax > 0 && (
                                        <div className="flex justify-between text-sm">
                                            <span className="text-gray-600">Tax (GST)</span>
                                            <span className="text-gray-900">{formatCurrency(financials.totalTax)}</span>
                                        </div>
                                    )}

                                    {/* Divider */}
                                    <div className="border-t border-gray-100 pt-2 mt-2">
                                        <div className="flex justify-between text-sm font-semibold">
                                            <span className="text-gray-900">Total</span>
                                            <span className="text-gray-900">{formatCurrency(financials.total || 0)}</span>
                                        </div>
                                    </div>

                                    {/* Paid amount */}
                                    <div className="flex justify-between text-sm">
                                        <span className="text-gray-600">Paid by customer</span>
                                        <span className="text-gray-900">{formatCurrency(financials.total || 0)}</span>
                                    </div>

                                    {/* Payment method badge */}
                                    <div className="pt-2 border-t border-gray-100 mt-2">
                                        <span className={cn(
                                            'px-2 py-0.5 rounded-full text-xs font-medium',
                                            financials.isCod ? 'bg-amber-100 text-amber-800' : 'bg-green-100 text-green-800'
                                        )}>
                                            {financials.paymentMethod}
                                        </span>
                                    </div>
                                </div>
                            </div>
                        )}

                        {/* --- TIMELINE CARD --- */}
                        {/* Build an order-like object for TimelineSection from order lines */}
                        {(() => {
                            const lines = order.orderLines || [];
                            const shipped = lines.find(l => l.shippedAt);
                            const delivered = lines.find(l => l.deliveredAt);
                            const rto = lines.find(l => l.rtoInitiatedAt);
                            const orderForTimeline = {
                                ...order,
                                shippedAt: shipped?.shippedAt || null,
                                deliveredAt: delivered?.deliveredAt || null,
                                rtoInitiatedAt: rto?.rtoInitiatedAt || null,
                                awbNumber: shipped?.awbNumber || order.shopifyCache?.trackingNumber || null,
                                courier: shipped?.courier || order.shopifyCache?.trackingCompany || null,
                                shopifyCache: {
                                    ...(order.shopifyCache || {}),
                                    paymentMethod: financials?.paymentMethod || 'Prepaid',
                                },
                            };
                            return (
                                <TimelineSection order={orderForTimeline as unknown as import('../../types').Order} />
                            );
                        })()}
                    </div>

                    {/* ===== RIGHT COLUMN (1/3) ===== */}
                    <div className="space-y-4">

                        {/* --- NOTES CARD --- */}
                        <div className="bg-white rounded-lg border border-gray-200 shadow-sm">
                            <div className="px-4 py-3 border-b border-gray-100">
                                <div className="flex items-center justify-between">
                                    <div className="flex items-center gap-2">
                                        <FileText className="w-4 h-4 text-gray-400" />
                                        <h2 className="text-sm font-semibold text-gray-900">Notes</h2>
                                    </div>
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
                                {order.shopifyCache?.customerNotes && (
                                    <div>
                                        <p className="text-xs font-medium text-gray-500 mb-1">Customer note</p>
                                        <p className="text-sm text-gray-700 bg-yellow-50 border border-yellow-100 rounded px-2.5 py-2">
                                            {order.shopifyCache.customerNotes}
                                        </p>
                                    </div>
                                )}

                                {/* Internal notes */}
                                {isEditingNotes ? (
                                    <div>
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
                                ) : (
                                    <div>
                                        <p className="text-xs font-medium text-gray-500 mb-1">Internal notes</p>
                                        {order.internalNotes ? (
                                            <p className="text-sm text-gray-700 whitespace-pre-wrap">{order.internalNotes}</p>
                                        ) : (
                                            <p className="text-sm text-gray-400 italic">No internal notes</p>
                                        )}
                                    </div>
                                )}
                            </div>
                        </div>

                        {/* --- CUSTOMER CARD --- */}
                        <div className="bg-white rounded-lg border border-gray-200 shadow-sm">
                            <div className="px-4 py-3 border-b border-gray-100">
                                <div className="flex items-center gap-2">
                                    <User className="w-4 h-4 text-gray-400" />
                                    <h2 className="text-sm font-semibold text-gray-900">Customer</h2>
                                </div>
                            </div>
                            <div className="px-4 py-3 space-y-2.5">
                                <p className="text-sm font-medium text-gray-900">
                                    {order.customerName}
                                </p>

                                {(order.customerEmail || order.customer?.email) && (
                                    <div className="flex items-center gap-2 text-sm text-gray-600">
                                        <Mail className="w-3.5 h-3.5 text-gray-400" />
                                        <a
                                            href={`mailto:${order.customerEmail || order.customer?.email}`}
                                            className="hover:text-blue-600 truncate"
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

                                {order.customer && (
                                    <div className="flex flex-wrap gap-1.5 pt-1">
                                        <span className="px-2 py-0.5 rounded-full text-xs font-medium bg-blue-50 text-blue-700">
                                            LTV: {formatCurrency(order.customer.ltv)}
                                        </span>
                                        <span className="px-2 py-0.5 rounded-full text-xs font-medium bg-gray-100 text-gray-700">
                                            {order.customer.orderCount} orders
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

                        {/* --- ORDER DETAILS CARD --- */}
                        <div className="bg-white rounded-lg border border-gray-200 shadow-sm">
                            <div className="px-4 py-3 border-b border-gray-100">
                                <div className="flex items-center gap-2">
                                    <Tag className="w-4 h-4 text-gray-400" />
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
                                {financials?.discountCodes && (
                                    <DetailRow
                                        label="Discount"
                                        value={
                                            <span className="px-1.5 py-0.5 bg-gray-100 text-gray-700 rounded text-xs font-mono">
                                                {financials.discountCodes}
                                            </span>
                                        }
                                    />
                                )}
                                {order.shopifyCache?.tags && (
                                    <div>
                                        <p className="text-xs text-gray-500 mb-1">Tags</p>
                                        <div className="flex flex-wrap gap-1">
                                            {order.shopifyCache.tags.split(',').map((tag) => (
                                                <span
                                                    key={tag.trim()}
                                                    className="px-1.5 py-0.5 bg-gray-100 text-gray-600 rounded text-xs"
                                                >
                                                    {tag.trim()}
                                                </span>
                                            ))}
                                        </div>
                                    </div>
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
