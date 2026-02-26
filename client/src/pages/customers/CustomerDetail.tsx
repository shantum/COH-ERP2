/**
 * CustomerDetail — Full-page customer profile (Shopify-style 2-column layout)
 *
 * Shows customer profile, stats, style DNA, order history, and risk indicators.
 * Data comes from the getCustomer server function (Kysely-based, includes affinities).
 */

import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useServerFn } from '@tanstack/react-start';
import { useNavigate } from '@tanstack/react-router';
import {
    ArrowLeft, Mail, Phone, MessageCircle, User,
    ShoppingBag, Package, Truck, RotateCcw, Layers,
    Palette, MapPin, Tag, AlertCircle, AlertTriangle,
    CheckCircle2, ChevronRight, Clock,
    TrendingUp, CreditCard,
} from 'lucide-react';

import { Route } from '../../routes/_authenticated/customers_.$customerId';
import { getCustomer } from '../../server/functions/customers';
import type { CustomerDetailResult } from '@coh/shared/schemas/customers';
import { getOptimizedImageUrl } from '../../utils/imageOptimization';
import { cn } from '../../lib/utils';
import {
    getTierConfig,
    calculateHealthScore,
    getHealthScoreColor,
    getHealthScoreLabel,
    calculateTierProgress,
    getColorHex,
    getInitials,
    calculateTenure,
    getRelativeTime,
} from '../../utils/customerIntelligence';

// ============================================
// HELPERS
// ============================================

function formatDate(date: Date | string): string {
    const d = typeof date === 'string' ? new Date(date) : date;
    return d.toLocaleDateString('en-IN', {
        day: 'numeric',
        month: 'short',
        year: 'numeric',
    });
}

function formatINR(amount: number): string {
    return amount.toLocaleString('en-IN', {
        style: 'currency',
        currency: 'INR',
        maximumFractionDigits: 0,
    });
}

// ============================================
// STATUS CONFIG for order cards
// ============================================

const ORDER_STATUS_CONFIG: Record<string, { bg: string; text: string; dot: string }> = {
    open: { bg: 'bg-sky-50', text: 'text-sky-700', dot: 'bg-sky-500' },
    pending: { bg: 'bg-gray-50', text: 'text-gray-600', dot: 'bg-gray-400' },
    allocated: { bg: 'bg-blue-50', text: 'text-blue-700', dot: 'bg-blue-500' },
    picked: { bg: 'bg-indigo-50', text: 'text-indigo-700', dot: 'bg-indigo-500' },
    packed: { bg: 'bg-violet-50', text: 'text-violet-700', dot: 'bg-violet-500' },
    shipped: { bg: 'bg-amber-50', text: 'text-amber-700', dot: 'bg-amber-500' },
    delivered: { bg: 'bg-green-50', text: 'text-green-700', dot: 'bg-green-500' },
    cancelled: { bg: 'bg-red-50', text: 'text-red-600', dot: 'bg-red-500' },
    rto: { bg: 'bg-orange-50', text: 'text-orange-700', dot: 'bg-orange-500' },
    rto_delivered: { bg: 'bg-orange-50', text: 'text-orange-700', dot: 'bg-orange-500' },
};

// ============================================
// MAIN COMPONENT
// ============================================

export default function CustomerDetail() {
    const { customerId } = Route.useParams();
    const navigate = useNavigate();

    const getCustomerFn = useServerFn(getCustomer);

    // Determine if URL param is a UUID or an email
    const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(customerId);

    const { data: customer, isLoading, error } = useQuery({
        queryKey: ['customer', 'detail', customerId],
        queryFn: async () => {
            const input = isUuid ? { id: customerId } : { email: customerId };
            const result = await getCustomerFn({ data: input });
            return result as CustomerDetailResult;
        },
        staleTime: 60 * 1000,
    });

    // Computed metrics
    const metrics = useMemo(() => {
        if (!customer) return null;
        const healthScore = calculateHealthScore(customer);
        const tierProgress = calculateTierProgress(
            customer.lifetimeValue || 0,
            customer.customerTier || customer.tier || 'bronze'
        );
        const tenure = calculateTenure(
            customer.firstOrderDate ? customer.firstOrderDate.toISOString() : null
        );
        const daysSinceOrder = customer.lastOrderDate
            ? Math.floor((Date.now() - new Date(customer.lastOrderDate).getTime()) / (1000 * 60 * 60 * 24))
            : null;

        return { healthScore, tierProgress, tenure, daysSinceOrder };
    }, [customer]);

    // Size preferences from orders
    const sizePreferences = useMemo(() => {
        if (!customer?.orders) return [];
        const sizeCounts: Record<string, number> = {};
        customer.orders.forEach((order) => {
            order.orderLines?.forEach((line) => {
                const size = line.sku?.size;
                if (size) {
                    sizeCounts[size] = (sizeCounts[size] || 0) + line.qty;
                }
            });
        });
        return Object.entries(sizeCounts)
            .map(([size, count]) => ({ size, count }))
            .sort((a, b) => b.count - a.count)
            .slice(0, 5);
    }, [customer?.orders]);

    // Risk indicators
    const risks = useMemo(() => {
        if (!customer || !metrics) return [];
        const items: Array<{ type: string; message: string; severity: 'high' | 'medium' | 'low' }> = [];

        if (metrics.daysSinceOrder !== null && metrics.daysSinceOrder > 90) {
            items.push({
                type: 'Inactive Customer',
                message: `No orders in ${metrics.daysSinceOrder} days`,
                severity: metrics.daysSinceOrder > 180 ? 'high' : 'medium',
            });
        }
        if ((customer.returnRate || 0) > 25) {
            items.push({
                type: 'High Return Rate',
                message: `${(customer.returnRate || 0).toFixed(1)}% return rate`,
                severity: (customer.returnRate || 0) > 40 ? 'high' : 'medium',
            });
        }
        if ((customer.rtoCount || 0) > 2) {
            items.push({
                type: 'Multiple RTOs',
                message: `${customer.rtoCount} RTO incidents`,
                severity: (customer.rtoCount || 0) > 5 ? 'high' : 'medium',
            });
        }
        return items;
    }, [customer, metrics]);

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
                                <div className="h-48 bg-gray-200 rounded-lg" />
                                <div className="h-64 bg-gray-200 rounded-lg" />
                            </div>
                            <div className="space-y-4">
                                <div className="h-48 bg-gray-200 rounded-lg" />
                                <div className="h-32 bg-gray-200 rounded-lg" />
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
    if (error || !customer || !metrics) {
        return (
            <div className="min-h-screen bg-gray-50">
                <div className="max-w-6xl mx-auto px-6 py-6">
                    <button
                        onClick={() => navigate({ to: '/customers', search: { tier: 'all', page: 1, limit: 100 } })}
                        className="flex items-center gap-1.5 text-sm text-gray-600 hover:text-gray-900 mb-4"
                    >
                        <ArrowLeft className="w-4 h-4" />
                        Back to customers
                    </button>
                    <div className="bg-white rounded-lg border border-gray-200 shadow-sm p-8 text-center">
                        <p className="text-gray-500">
                            {error instanceof Error ? error.message : 'Customer not found'}
                        </p>
                    </div>
                </div>
            </div>
        );
    }

    const tierConfig = getTierConfig(customer.customerTier || customer.tier || 'bronze');
    const TierIcon = tierConfig.icon;
    const healthColor = getHealthScoreColor(metrics.healthScore);
    const healthLabel = getHealthScoreLabel(metrics.healthScore);
    const totalColorQty = customer.colorAffinity?.reduce((sum, c) => sum + c.qty, 0) || 1;

    // ============================================
    // RENDER
    // ============================================
    return (
        <div className="min-h-screen bg-gray-50">
            <div className="max-w-6xl mx-auto px-6 py-6">

                {/* ===== HEADER ===== */}
                <div className="mb-6">
                    <button
                        onClick={() => navigate({ to: '/customers', search: { tier: 'all', page: 1, limit: 100 } })}
                        className="flex items-center gap-1.5 text-sm text-gray-600 hover:text-gray-900 mb-3"
                    >
                        <ArrowLeft className="w-4 h-4" />
                        Customers
                    </button>

                    <div className="flex items-start justify-between">
                        <div className="flex items-center gap-4">
                            {/* Avatar */}
                            <div
                                className={cn(
                                    'w-14 h-14 rounded-full flex items-center justify-center text-white text-xl font-bold shadow-md',
                                    tierConfig.avatarBg || tierConfig.bg,
                                )}
                            >
                                {getInitials(customer.firstName, customer.lastName)}
                            </div>
                            <div>
                                <h1 className="text-xl font-semibold text-gray-900">
                                    {[customer.firstName, customer.lastName].filter(Boolean).join(' ') || customer.email}
                                </h1>
                                <div className="flex items-center gap-2 mt-1">
                                    {/* Tier badge */}
                                    <span className={cn(
                                        'inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-bold tracking-wider border',
                                        tierConfig.bg, tierConfig.text, tierConfig.border,
                                    )}>
                                        <TierIcon className="w-3 h-3" />
                                        {tierConfig.label}
                                    </span>
                                    {/* Member since */}
                                    <span className="text-sm text-gray-500">
                                        Customer for {metrics.tenure}
                                    </span>
                                </div>
                            </div>
                        </div>

                        {/* Contact actions */}
                        <div className="flex items-center gap-2">
                            {customer.email && (
                                <a
                                    href={`mailto:${customer.email}`}
                                    className="inline-flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-lg hover:bg-gray-50"
                                >
                                    <Mail className="w-4 h-4" />
                                    Email
                                </a>
                            )}
                            {customer.phone && (
                                <a
                                    href={`https://wa.me/${customer.phone.replace(/\D/g, '')}`}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    className="inline-flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium text-green-700 bg-white border border-gray-300 rounded-lg hover:bg-green-50"
                                >
                                    <MessageCircle className="w-4 h-4" />
                                    WhatsApp
                                </a>
                            )}
                        </div>
                    </div>
                </div>

                {/* ===== STATS BAR ===== */}
                <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-6 gap-3 mb-6">
                    <StatCard
                        label="Lifetime Value"
                        value={formatINR(customer.lifetimeValue || 0)}
                        icon={TrendingUp}
                        accent="sky"
                    />
                    <StatCard
                        label="Orders"
                        value={String(customer.totalOrders || 0)}
                        icon={ShoppingBag}
                        accent="blue"
                    />
                    <StatCard
                        label="Avg Order"
                        value={formatINR(customer.avgOrderValue || 0)}
                        icon={CreditCard}
                        accent="indigo"
                    />
                    <StatCard
                        label="Return Rate"
                        value={`${(customer.returnRate || 0).toFixed(1)}%`}
                        icon={RotateCcw}
                        accent={(customer.returnRate || 0) > 20 ? 'red' : 'gray'}
                    />
                    <StatCard
                        label="RTOs"
                        value={String(customer.rtoCount || 0)}
                        icon={Truck}
                        accent={(customer.rtoCount || 0) > 2 ? 'red' : 'gray'}
                    />
                    <StatCard
                        label="Health"
                        value={String(metrics.healthScore)}
                        icon={CheckCircle2}
                        accent={metrics.healthScore >= 70 ? 'green' : metrics.healthScore >= 40 ? 'amber' : 'red'}
                        subtitle={healthLabel}
                    />
                </div>

                {/* ===== TWO COLUMN LAYOUT ===== */}
                <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">

                    {/* ===== LEFT COLUMN (2/3) ===== */}
                    <div className="lg:col-span-2 space-y-4">

                        {/* --- RISK ALERTS --- */}
                        {risks.length > 0 && (
                            <div className="space-y-2">
                                {risks.map((risk, i) => (
                                    <div
                                        key={i}
                                        className={cn(
                                            'flex items-start gap-3 px-4 py-3 rounded-lg border',
                                            risk.severity === 'high'
                                                ? 'bg-red-50 border-red-200'
                                                : 'bg-amber-50 border-amber-200',
                                        )}
                                    >
                                        {risk.severity === 'high' ? (
                                            <AlertCircle className="w-4 h-4 text-red-500 mt-0.5 flex-shrink-0" />
                                        ) : (
                                            <AlertTriangle className="w-4 h-4 text-amber-500 mt-0.5 flex-shrink-0" />
                                        )}
                                        <div>
                                            <p className={cn(
                                                'text-sm font-medium',
                                                risk.severity === 'high' ? 'text-red-800' : 'text-amber-800',
                                            )}>
                                                {risk.type}
                                            </p>
                                            <p className="text-xs text-gray-600">{risk.message}</p>
                                        </div>
                                    </div>
                                ))}
                            </div>
                        )}

                        {/* --- TIER PROGRESS --- */}
                        {metrics.tierProgress.nextTier && (
                            <div className="bg-white rounded-lg border border-gray-200 shadow-sm p-4">
                                <div className="flex items-center justify-between mb-2">
                                    <span className="text-sm font-medium text-gray-700">
                                        Progress to {metrics.tierProgress.nextTier}
                                    </span>
                                    <span className="text-sm font-semibold text-gray-900">
                                        {Math.round(metrics.tierProgress.progress)}%
                                    </span>
                                </div>
                                <div className="h-2 bg-gray-100 rounded-full overflow-hidden">
                                    <div
                                        className={cn(
                                            'h-full rounded-full transition-all duration-500',
                                            metrics.tierProgress.shouldUpgrade
                                                ? 'bg-green-500'
                                                : 'bg-sky-500',
                                        )}
                                        style={{ width: `${metrics.tierProgress.progress}%` }}
                                    />
                                </div>
                                {metrics.tierProgress.shouldUpgrade ? (
                                    <p className="text-xs text-green-600 mt-1.5 font-medium">
                                        Qualifies for {metrics.tierProgress.nextTier} upgrade!
                                    </p>
                                ) : (
                                    <p className="text-xs text-gray-500 mt-1.5">
                                        {formatINR(metrics.tierProgress.amountToNext)} more to reach {metrics.tierProgress.nextTier}
                                    </p>
                                )}
                            </div>
                        )}

                        {/* --- STYLE DNA --- */}
                        {(customer.colorAffinity?.length || customer.productAffinity?.length || customer.fabricAffinity?.length || sizePreferences.length > 0) && (
                            <div className="bg-white rounded-lg border border-gray-200 shadow-sm overflow-hidden">
                                <div className="px-4 py-3 border-b border-gray-100">
                                    <div className="flex items-center gap-2">
                                        <Palette className="w-4 h-4 text-gray-400" />
                                        <h2 className="text-sm font-semibold text-gray-900">Style DNA</h2>
                                    </div>
                                </div>

                                <div className="p-4 space-y-5">
                                    {/* Color Palette */}
                                    {customer.colorAffinity && customer.colorAffinity.length > 0 && (
                                        <div>
                                            <p className="text-xs font-medium text-gray-500 mb-2.5">Color Palette</p>
                                            <div className="flex gap-4 overflow-x-auto pb-1">
                                                {customer.colorAffinity.slice(0, 10).map((c, i) => {
                                                    const hex = c.hex || getColorHex(c.color);
                                                    const pct = Math.round((c.qty / totalColorQty) * 100);
                                                    return (
                                                        <div key={i} className="flex flex-col items-center gap-1.5">
                                                            <div
                                                                className="w-10 h-10 rounded-full shadow-sm border border-gray-200"
                                                                style={{ backgroundColor: hex }}
                                                                title={`${c.color}: ${c.qty} items (${pct}%)`}
                                                            />
                                                            <span className="text-[10px] text-gray-500 max-w-[48px] truncate text-center">
                                                                {c.color}
                                                            </span>
                                                            <span className="text-[9px] text-gray-400">{pct}%</span>
                                                        </div>
                                                    );
                                                })}
                                            </div>
                                        </div>
                                    )}

                                    {/* Products + Fabrics */}
                                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                                        {customer.productAffinity && customer.productAffinity.length > 0 && (
                                            <div>
                                                <p className="text-xs font-medium text-gray-500 mb-2 flex items-center gap-1">
                                                    <Package className="w-3 h-3" />
                                                    Top Products
                                                </p>
                                                <div className="space-y-1.5">
                                                    {customer.productAffinity.slice(0, 5).map((p, i) => (
                                                        <div key={i} className="flex items-center justify-between">
                                                            <span className="text-sm text-gray-700 truncate">{p.productName}</span>
                                                            <span className="text-xs text-gray-400 ml-2 flex-shrink-0">{p.qty} units</span>
                                                        </div>
                                                    ))}
                                                </div>
                                            </div>
                                        )}

                                        {customer.fabricAffinity && customer.fabricAffinity.length > 0 && (
                                            <div>
                                                <p className="text-xs font-medium text-gray-500 mb-2 flex items-center gap-1">
                                                    <Layers className="w-3 h-3" />
                                                    Fabrics
                                                </p>
                                                <div className="flex flex-wrap gap-1.5">
                                                    {customer.fabricAffinity.slice(0, 5).map((f, i) => (
                                                        <span key={i} className="px-2 py-1 bg-amber-50 text-amber-800 rounded text-xs">
                                                            {f.fabricType} ({f.qty})
                                                        </span>
                                                    ))}
                                                </div>
                                            </div>
                                        )}
                                    </div>

                                    {/* Size Preferences */}
                                    {sizePreferences.length > 0 && (
                                        <div>
                                            <p className="text-xs font-medium text-gray-500 mb-2">Size Preferences</p>
                                            <div className="flex flex-wrap gap-1.5">
                                                {sizePreferences.map(({ size, count }) => (
                                                    <span key={size} className="px-2.5 py-1 bg-sky-50 text-sky-800 rounded text-xs font-medium">
                                                        {size} <span className="text-sky-500 font-normal">({count})</span>
                                                    </span>
                                                ))}
                                            </div>
                                        </div>
                                    )}
                                </div>
                            </div>
                        )}

                        {/* --- ORDER HISTORY --- */}
                        <div className="bg-white rounded-lg border border-gray-200 shadow-sm overflow-hidden">
                            <div className="px-4 py-3 border-b border-gray-100 flex items-center justify-between">
                                <div className="flex items-center gap-2">
                                    <ShoppingBag className="w-4 h-4 text-gray-400" />
                                    <h2 className="text-sm font-semibold text-gray-900">Order History</h2>
                                </div>
                                <span className="text-xs text-gray-500">
                                    {customer.orders?.length || 0} orders
                                </span>
                            </div>

                            {customer.orders && customer.orders.length > 0 ? (
                                <div className="divide-y divide-gray-100">
                                    {customer.orders.map((order) => {
                                        const statusConfig = ORDER_STATUS_CONFIG[order.status?.toLowerCase()] || ORDER_STATUS_CONFIG.open;
                                        const firstLine = order.orderLines?.[0];
                                        const firstImage = firstLine?.sku?.variation?.imageUrl ||
                                            firstLine?.sku?.variation?.product?.imageUrl;
                                        const productName = firstLine?.sku?.variation?.product?.name || 'Unknown';
                                        const itemCount = order.orderLines?.length || 0;

                                        return (
                                            <button
                                                key={order.id}
                                                onClick={() => navigate({
                                                    to: '/orders/$orderId',
                                                    params: { orderId: order.orderNumber },
                                                })}
                                                className="w-full text-left px-4 py-3 hover:bg-gray-50 transition-colors group"
                                            >
                                                <div className="flex items-center gap-3">
                                                    {/* Product thumbnail */}
                                                    {firstImage ? (
                                                        <img
                                                            src={getOptimizedImageUrl(firstImage, 'sm') || firstImage}
                                                            alt={productName}
                                                            className="w-11 h-11 rounded-lg object-cover border border-gray-200 flex-shrink-0"
                                                            loading="lazy"
                                                        />
                                                    ) : (
                                                        <div className="w-11 h-11 rounded-lg bg-gray-100 flex items-center justify-center flex-shrink-0 border border-gray-200">
                                                            <Package className="w-4 h-4 text-gray-400" />
                                                        </div>
                                                    )}

                                                    {/* Order info */}
                                                    <div className="flex-1 min-w-0">
                                                        <div className="flex items-center gap-2">
                                                            <span className="text-sm font-semibold text-gray-900">
                                                                #{order.orderNumber}
                                                            </span>
                                                            <span className={cn(
                                                                'inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-medium',
                                                                statusConfig.bg, statusConfig.text,
                                                            )}>
                                                                <span className={cn('w-1 h-1 rounded-full', statusConfig.dot)} />
                                                                {order.status}
                                                            </span>
                                                        </div>
                                                        <p className="text-xs text-gray-500 truncate mt-0.5">
                                                            {productName}
                                                            {itemCount > 1 && ` + ${itemCount - 1} more`}
                                                        </p>
                                                    </div>

                                                    {/* Amount + date */}
                                                    <div className="text-right flex-shrink-0">
                                                        <p className="text-sm font-semibold text-gray-900 tabular-nums">
                                                            {formatINR(order.totalAmount || 0)}
                                                        </p>
                                                        <p className="text-[10px] text-gray-400" title={formatDate(order.orderDate)}>
                                                            {getRelativeTime(
                                                                typeof order.orderDate === 'string'
                                                                    ? order.orderDate
                                                                    : order.orderDate.toISOString()
                                                            )}
                                                        </p>
                                                    </div>

                                                    <ChevronRight className="w-4 h-4 text-gray-300 group-hover:text-gray-500 transition-colors flex-shrink-0" />
                                                </div>
                                            </button>
                                        );
                                    })}
                                </div>
                            ) : (
                                <div className="px-4 py-8 text-center">
                                    <ShoppingBag className="w-8 h-8 text-gray-300 mx-auto mb-2" />
                                    <p className="text-sm text-gray-400">No orders yet</p>
                                </div>
                            )}
                        </div>
                    </div>

                    {/* ===== RIGHT COLUMN (1/3) ===== */}
                    <div className="space-y-4">

                        {/* --- CONTACT INFO CARD --- */}
                        <div className="bg-white rounded-lg border border-gray-200 shadow-sm">
                            <div className="px-4 py-3 border-b border-gray-100">
                                <div className="flex items-center gap-2">
                                    <User className="w-4 h-4 text-gray-400" />
                                    <h2 className="text-sm font-semibold text-gray-900">Contact information</h2>
                                </div>
                            </div>
                            <div className="px-4 py-3 space-y-2.5">
                                {customer.email && (
                                    <div className="flex items-center gap-2 text-sm">
                                        <Mail className="w-3.5 h-3.5 text-gray-400 flex-shrink-0" />
                                        <a
                                            href={`mailto:${customer.email}`}
                                            className="text-blue-600 hover:underline truncate"
                                        >
                                            {customer.email}
                                        </a>
                                    </div>
                                )}
                                {customer.phone && (
                                    <div className="flex items-center gap-2 text-sm text-gray-600">
                                        <Phone className="w-3.5 h-3.5 text-gray-400 flex-shrink-0" />
                                        <span>{customer.phone}</span>
                                    </div>
                                )}
                                {customer.acceptsMarketing !== undefined && (
                                    <div className="flex items-center gap-2 text-xs text-gray-500">
                                        <Mail className="w-3 h-3 text-gray-300 flex-shrink-0" />
                                        <span>
                                            {customer.acceptsMarketing
                                                ? 'Subscribed to email marketing'
                                                : 'Not subscribed to email marketing'}
                                        </span>
                                    </div>
                                )}
                            </div>
                        </div>

                        {/* --- DEFAULT ADDRESS CARD --- */}
                        {customer.defaultAddress && (
                            <div className="bg-white rounded-lg border border-gray-200 shadow-sm">
                                <div className="px-4 py-3 border-b border-gray-100">
                                    <div className="flex items-center gap-2">
                                        <MapPin className="w-4 h-4 text-gray-400" />
                                        <h2 className="text-sm font-semibold text-gray-900">Default address</h2>
                                    </div>
                                </div>
                                <div className="px-4 py-3">
                                    <AddressDisplay address={customer.defaultAddress} />
                                </div>
                            </div>
                        )}

                        {/* --- HEALTH SCORE CARD --- */}
                        <div className="bg-white rounded-lg border border-gray-200 shadow-sm">
                            <div className="px-4 py-3 border-b border-gray-100">
                                <h2 className="text-sm font-semibold text-gray-900">Health Score</h2>
                            </div>
                            <div className="px-4 py-4 flex items-center gap-4">
                                {/* Circular gauge */}
                                <div className="relative w-16 h-16 flex-shrink-0">
                                    <svg className="w-full h-full transform -rotate-90" viewBox="0 0 50 50">
                                        <circle cx="25" cy="25" r="20" fill="none" stroke="#e5e7eb" strokeWidth="4" />
                                        <circle
                                            cx="25" cy="25" r="20" fill="none" stroke={healthColor} strokeWidth="4"
                                            strokeLinecap="round"
                                            strokeDasharray={2 * Math.PI * 20}
                                            strokeDashoffset={2 * Math.PI * 20 - (metrics.healthScore / 100) * 2 * Math.PI * 20}
                                            style={{ transition: 'stroke-dashoffset 0.5s ease-out' }}
                                        />
                                    </svg>
                                    <div className="absolute inset-0 flex items-center justify-center">
                                        <span className="text-lg font-bold" style={{ color: healthColor }}>
                                            {metrics.healthScore}
                                        </span>
                                    </div>
                                </div>
                                <div>
                                    <p className="text-sm font-medium text-gray-900">{healthLabel}</p>
                                    <p className="text-xs text-gray-500 mt-0.5">
                                        Based on recency, frequency, monetary value, and return behavior
                                    </p>
                                </div>
                            </div>
                        </div>

                        {/* --- TAGS CARD --- */}
                        {customer.tags && (
                            <div className="bg-white rounded-lg border border-gray-200 shadow-sm">
                                <div className="px-4 py-3 border-b border-gray-100">
                                    <div className="flex items-center gap-2">
                                        <Tag className="w-4 h-4 text-gray-400" />
                                        <h2 className="text-sm font-semibold text-gray-900">Tags</h2>
                                    </div>
                                </div>
                                <div className="px-4 py-3">
                                    <div className="flex flex-wrap gap-1.5">
                                        {customer.tags.split(',').map((tag) => (
                                            <span
                                                key={tag.trim()}
                                                className="inline-flex items-center px-2 py-0.5 bg-gray-100 text-gray-700 rounded-full text-xs"
                                            >
                                                {tag.trim()}
                                            </span>
                                        ))}
                                    </div>
                                </div>
                            </div>
                        )}

                        {/* --- CUSTOMER DETAILS CARD --- */}
                        <div className="bg-white rounded-lg border border-gray-200 shadow-sm">
                            <div className="px-4 py-3 border-b border-gray-100">
                                <div className="flex items-center gap-2">
                                    <Clock className="w-4 h-4 text-gray-400" />
                                    <h2 className="text-sm font-semibold text-gray-900">Details</h2>
                                </div>
                            </div>
                            <div className="px-4 py-3 space-y-2.5">
                                <DetailRow
                                    label="Customer since"
                                    value={customer.firstOrderDate ? formatDate(customer.firstOrderDate) : 'N/A'}
                                />
                                <DetailRow
                                    label="Last order"
                                    value={customer.lastOrderDate
                                        ? `${formatDate(customer.lastOrderDate)} (${getRelativeTime(customer.lastOrderDate.toISOString())})`
                                        : 'Never'}
                                />
                                <DetailRow
                                    label="Total orders"
                                    value={String(customer.totalOrders || 0)}
                                />
                                <DetailRow
                                    label="Returns"
                                    value={String(customer.returnCount || 0)}
                                />
                                <DetailRow
                                    label="Exchanges"
                                    value={String(customer.exchangeCount || 0)}
                                />
                                <DetailRow
                                    label="Account created"
                                    value={customer.createdAt ? formatDate(customer.createdAt) : 'N/A'}
                                />
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

function StatCard({ label, value, icon: Icon, accent, subtitle }: {
    label: string;
    value: string;
    icon: React.ElementType;
    accent: string;
    subtitle?: string;
}) {
    const accentMap: Record<string, { iconBg: string; iconText: string }> = {
        sky: { iconBg: 'bg-sky-50', iconText: 'text-sky-600' },
        blue: { iconBg: 'bg-blue-50', iconText: 'text-blue-600' },
        indigo: { iconBg: 'bg-indigo-50', iconText: 'text-indigo-600' },
        green: { iconBg: 'bg-green-50', iconText: 'text-green-600' },
        amber: { iconBg: 'bg-amber-50', iconText: 'text-amber-600' },
        red: { iconBg: 'bg-red-50', iconText: 'text-red-600' },
        gray: { iconBg: 'bg-gray-50', iconText: 'text-gray-500' },
    };
    const colors = accentMap[accent] || accentMap.gray;

    return (
        <div className="bg-white rounded-lg border border-gray-200 shadow-sm p-3">
            <div className="flex items-center gap-2 mb-1.5">
                <div className={cn('p-1.5 rounded-lg', colors.iconBg)}>
                    <Icon className={cn('w-3.5 h-3.5', colors.iconText)} />
                </div>
            </div>
            <p className="text-lg font-bold text-gray-900 tabular-nums leading-tight">{value}</p>
            <p className="text-[10px] uppercase tracking-wider text-gray-500 mt-0.5">{label}</p>
            {subtitle && <p className="text-[10px] text-gray-400">{subtitle}</p>}
        </div>
    );
}

function DetailRow({ label, value }: { label: string; value: string }) {
    return (
        <div className="flex justify-between text-sm">
            <span className="text-gray-500">{label}</span>
            <span className="text-gray-900 text-right">{value}</span>
        </div>
    );
}

function AddressDisplay({ address }: { address: unknown }) {
    if (!address) return null;

    let addr: Record<string, unknown>;
    if (typeof address === 'string') {
        try {
            addr = JSON.parse(address);
        } catch {
            return <p className="text-sm text-gray-700">{address}</p>;
        }
    } else {
        addr = address as Record<string, unknown>;
    }

    const parts: string[] = [];
    const name = [addr.first_name, addr.last_name].filter(Boolean).join(' ') || addr.name;
    if (name) parts.push(String(name));
    if (addr.address1) parts.push(String(addr.address1));
    if (addr.address2) parts.push(String(addr.address2));
    const cityLine = [addr.city, addr.province, addr.zip].filter(Boolean).map(String).join(', ');
    if (cityLine) parts.push(cityLine);
    if (addr.country) parts.push(String(addr.country));

    return (
        <div>
            <p className="text-sm text-gray-700 whitespace-pre-line">{parts.join('\n')}</p>
            {typeof addr.phone === 'string' && addr.phone && (
                <div className="flex items-center gap-2 mt-2 text-sm text-gray-500">
                    <Phone className="w-3.5 h-3.5" />
                    {addr.phone}
                </div>
            )}
        </div>
    );
}
