/**
 * CustomerDetail — Comprehensive customer profile page
 *
 * Everything about a customer: stats, style DNA, return/RTO analysis,
 * revenue timeline, payment breakdown, order history with notes, and health scoring.
 */

import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useServerFn } from '@tanstack/react-start';
import { useNavigate } from '@tanstack/react-router';
import {
    ArrowLeft, Mail, Phone, MessageCircle,
    ShoppingBag, Package, RotateCcw,
    Palette, MapPin, Tag, AlertCircle, AlertTriangle,
    CheckCircle2, ChevronRight, ChevronDown, ChevronUp,
    CreditCard, Wallet, BarChart3,
    MessageSquare, IndianRupee, Shield,
    RefreshCcw, Ban, FileText,
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

function formatReasonLabel(reason: string): string {
    return reason
        .replace(/_/g, ' ')
        .replace(/\b\w/g, (c) => c.toUpperCase());
}

// ============================================
// STATUS CONFIG for order cards
// ============================================

const ORDER_STATUS_CONFIG: Record<string, { bg: string; text: string; dot: string }> = {
    open: { bg: 'bg-sky-50', text: 'text-sky-700', dot: 'bg-sky-500' },
    pending: { bg: 'bg-[#F5F0EB]', text: 'text-[#6B5E50]', dot: 'bg-[#B5AAA0]' },
    allocated: { bg: 'bg-blue-50', text: 'text-blue-700', dot: 'bg-blue-500' },
    picked: { bg: 'bg-indigo-50', text: 'text-indigo-700', dot: 'bg-indigo-500' },
    packed: { bg: 'bg-violet-50', text: 'text-violet-700', dot: 'bg-violet-500' },
    shipped: { bg: 'bg-amber-50', text: 'text-amber-700', dot: 'bg-amber-500' },
    delivered: { bg: 'bg-emerald-50', text: 'text-emerald-700', dot: 'bg-emerald-500' },
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
    const [showAllOrders, setShowAllOrders] = useState(false);
    const [orderFilter, setOrderFilter] = useState<'all' | 'delivered' | 'returns'>('all');

    const getCustomerFn = useServerFn(getCustomer);

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

    const [now] = useState(() => Date.now());
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
            ? Math.floor((now - new Date(customer.lastOrderDate).getTime()) / (1000 * 60 * 60 * 24))
            : null;

        const daysSinceLastOrder = customer.lastOrderDate
            ? Math.floor((now - new Date(customer.lastOrderDate).getTime()) / (1000 * 60 * 60 * 24))
            : 365;
        const monthsSinceFirst = customer.firstOrderDate
            ? Math.max(1, Math.floor((now - new Date(customer.firstOrderDate).getTime()) / (1000 * 60 * 60 * 24 * 30)))
            : 1;
        const ordersPerMonth = (customer.totalOrders || 0) / monthsSinceFirst;
        const recencyScore = Math.round(Math.max(0, (60 - daysSinceLastOrder) / 60) * 25);
        const frequencyScore = Math.round(Math.min(ordersPerMonth * 15, 25));
        const monetaryScore = Math.round(Math.min(((customer.lifetimeValue || 0) / 30000) * 25, 25));
        const returnPenalty = Math.round(Math.min((customer.returnRate || 0) * 0.5, 25));

        return {
            healthScore, tierProgress, tenure, daysSinceOrder,
            rfm: { recencyScore, frequencyScore, monetaryScore, returnPenalty },
        };
    }, [customer, now]);

    // eslint-disable-next-line react-hooks/preserve-manual-memoization -- only orders sub-property is used
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
                message: `${customer.rtoCount} RTO incidents (${formatINR(customer.rtoValue || 0)} value)`,
                severity: (customer.rtoCount || 0) > 5 ? 'high' : 'medium',
            });
        }
        if ((customer.storeCreditBalance || 0) > 0) {
            items.push({
                type: 'Store Credit Available',
                message: `${formatINR(customer.storeCreditBalance)} unused credit`,
                severity: 'low',
            });
        }
        return items;
    }, [customer, metrics]);

    // eslint-disable-next-line react-hooks/preserve-manual-memoization -- only orders sub-property is used
    const returnRtoStats = useMemo(() => {
        if (!customer?.orders) return { returnOrders: 0, rtoOrders: 0 };
        let returnOrders = 0;
        let rtoOrders = 0;
        for (const order of customer.orders) {
            let hasReturn = false;
            let hasRto = false;
            for (const line of order.orderLines || []) {
                if (line.returnStatus) hasReturn = true;
                if (line.rtoCondition || line.rtoInitiatedAt) hasRto = true;
            }
            if (hasReturn) returnOrders++;
            if (hasRto) rtoOrders++;
        }
        return { returnOrders, rtoOrders };
    }, [customer.orders]);

    // Filtered orders based on order filter
    const filteredOrders = useMemo(() => {
        if (!customer?.orders) return [];
        if (orderFilter === 'all') return customer.orders;
        if (orderFilter === 'delivered') {
            return customer.orders.filter((o) => o.status?.toLowerCase() === 'delivered');
        }
        // returns = orders with return lines or RTO
        return customer.orders.filter((o) =>
            o.orderLines?.some((l) => l.returnStatus || l.rtoCondition || l.rtoInitiatedAt)
        );
    }, [customer.orders, orderFilter]);

    const displayOrders = showAllOrders ? filteredOrders : filteredOrders.slice(0, 10);

    // Revenue trend from timeline (must be before early returns to satisfy hooks rules)
    const revenueTrend = useMemo(() => {
        if (!customer?.revenueTimeline || customer.revenueTimeline.length < 2) return null;
        const recent = customer.revenueTimeline.slice(-3);
        const earlier = customer.revenueTimeline.slice(-6, -3);
        if (earlier.length === 0) return null;
        const recentAvg = recent.reduce((s, d) => s + d.revenue, 0) / recent.length;
        const earlierAvg = earlier.reduce((s, d) => s + d.revenue, 0) / earlier.length;
        if (earlierAvg === 0) return null;
        const pct = Math.round(((recentAvg - earlierAvg) / earlierAvg) * 100);
        return pct;
    }, [customer.revenueTimeline]);

    // ============================================
    // LOADING STATE
    // ============================================
    if (isLoading) {
        return (
            <div className="min-h-screen bg-[#FAF9F7]">
                <div className="max-w-7xl mx-auto px-4 sm:px-6 py-6">
                    <div className="animate-pulse space-y-6">
                        <div className="h-5 w-32 bg-[#E8E4DF] rounded" />
                        <div className="flex items-center gap-4">
                            <div className="w-[72px] h-[72px] bg-[#E8E4DF] rounded-full" />
                            <div className="space-y-2">
                                <div className="h-6 w-48 bg-[#E8E4DF] rounded" />
                                <div className="h-4 w-64 bg-[#F5F0EB] rounded" />
                            </div>
                        </div>
                        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
                            {Array.from({ length: 4 }).map((_, i) => (
                                <div key={i} className="h-24 bg-white border border-[#E8E4DF] rounded-xl" />
                            ))}
                        </div>
                        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
                            <div className="lg:col-span-2 h-64 bg-white border border-[#E8E4DF] rounded-xl" />
                            <div className="h-64 bg-white border border-[#E8E4DF] rounded-xl" />
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
            <div className="min-h-screen bg-[#FAF9F7]">
                <div className="max-w-7xl mx-auto px-4 sm:px-6 py-6">
                    <button
                        onClick={() => navigate({ to: '/customers', search: { tier: 'all', page: 1, limit: 100 } })}
                        className="flex items-center gap-1.5 text-sm text-[#6B5E50] hover:text-[#1A1A1A] mb-6 transition-colors"
                    >
                        <ArrowLeft className="w-4 h-4" />
                        Back to Customers
                    </button>
                    <div className="bg-white rounded-xl border border-[#E8E4DF] p-12 text-center">
                        <p className="text-[#8C7B6B]">
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

    // ============================================
    // RENDER
    // ============================================
    return (
        <div className="min-h-screen bg-[#FAF9F7]">
            <div className="max-w-7xl mx-auto px-4 sm:px-6 py-6">

                {/* Top bar */}
                <div className="flex items-center justify-between mb-6">
                    <button
                        onClick={() => navigate({ to: '/customers', search: { tier: 'all', page: 1, limit: 100 } })}
                        className="flex items-center gap-1.5 text-sm text-[#6B5E50] hover:text-[#1A1A1A] transition-colors"
                    >
                        <ArrowLeft className="w-4 h-4" />
                        Back to Customers
                    </button>
                    <div className="flex items-center gap-2">
                        {customer.email && (
                            <a
                                href={`mailto:${customer.email}`}
                                className="inline-flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium text-[#6B5E50] bg-white border border-[#E8E4DF] rounded-lg hover:bg-[#FAF9F7] transition-colors"
                            >
                                <Mail className="w-3.5 h-3.5" />
                                <span className="hidden sm:inline">Email</span>
                            </a>
                        )}
                        {customer.phone && (
                            <a
                                href={`https://wa.me/${customer.phone.replace(/\D/g, '')}`}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="inline-flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium text-[#5B9A6F] bg-white border border-[#E8E4DF] rounded-lg hover:bg-emerald-50 transition-colors"
                            >
                                <MessageCircle className="w-3.5 h-3.5" />
                                <span className="hidden sm:inline">WhatsApp</span>
                            </a>
                        )}
                    </div>
                </div>

                {/* Profile header */}
                <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 mb-8">
                    <div className="flex items-center gap-4">
                        <div
                            className={cn(
                                'w-[72px] h-[72px] rounded-full flex items-center justify-center text-white text-2xl font-bold flex-shrink-0',
                                tierConfig.avatarBg || tierConfig.bg,
                            )}
                        >
                            {getInitials(customer.firstName, customer.lastName)}
                        </div>
                        <div>
                            <div className="flex items-center gap-2.5 flex-wrap">
                                <h1 className="text-xl sm:text-2xl font-bold text-[#1A1A1A] tracking-tight font-display">
                                    {[customer.firstName, customer.lastName].filter(Boolean).join(' ') || customer.email}
                                </h1>
                                <span className={cn(
                                    'inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wider',
                                    tierConfig.bg, tierConfig.text,
                                )}>
                                    <TierIcon className="w-3 h-3" />
                                    {tierConfig.label}
                                </span>
                                {(customer.storeCreditBalance || 0) > 0 && (
                                    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-medium bg-emerald-50 text-[#5B9A6F] border border-emerald-200">
                                        <Wallet className="w-3 h-3" />
                                        {formatINR(customer.storeCreditBalance)} credit
                                    </span>
                                )}
                            </div>
                            <div className="flex items-center gap-3 mt-1.5 text-sm text-[#8C7B6B] flex-wrap">
                                {customer.email && (
                                    <span className="flex items-center gap-1">
                                        <Mail className="w-3 h-3 text-[#B5AAA0]" />
                                        {customer.email}
                                    </span>
                                )}
                                {customer.phone && (
                                    <span className="flex items-center gap-1">
                                        <Phone className="w-3 h-3 text-[#B5AAA0]" />
                                        {customer.phone}
                                    </span>
                                )}
                                {customer.defaultAddress && (
                                    <span className="flex items-center gap-1">
                                        <MapPin className="w-3 h-3 text-[#B5AAA0]" />
                                        <AddressOneliner address={customer.defaultAddress} />
                                    </span>
                                )}
                            </div>
                            <p className="text-xs text-[#B5AAA0] mt-1">
                                Customer for {metrics.tenure}
                            </p>
                        </div>
                    </div>

                    {/* Health score ring — desktop right-aligned */}
                    <div className="hidden sm:flex flex-col items-center gap-1">
                        <div className="relative w-16 h-16">
                            <svg className="w-full h-full transform -rotate-90" viewBox="0 0 50 50">
                                <circle cx="25" cy="25" r="20" fill="none" stroke="#F5F0EB" strokeWidth="4" />
                                <circle
                                    cx="25" cy="25" r="20" fill="none" stroke={healthColor} strokeWidth="4"
                                    strokeLinecap="round"
                                    strokeDasharray={2 * Math.PI * 20}
                                    strokeDashoffset={2 * Math.PI * 20 - (metrics.healthScore / 100) * 2 * Math.PI * 20}
                                    style={{ transition: 'stroke-dashoffset 0.5s ease-out' }}
                                />
                            </svg>
                            <div className="absolute inset-0 flex items-center justify-center">
                                <span className="text-lg font-bold font-display" style={{ color: healthColor }}>
                                    {metrics.healthScore}
                                </span>
                            </div>
                        </div>
                        <span className="text-[10px] font-medium uppercase tracking-wider text-[#B5AAA0]">{healthLabel}</span>
                    </div>
                </div>

                {/* 4 Metric Cards */}
                <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4 mb-8">
                    <MetricCard
                        label="Lifetime Value"
                        value={formatINR(customer.lifetimeValue || 0)}
                        trend={revenueTrend}
                        trendLabel="90d trend"
                    />
                    <MetricCard
                        label="Orders"
                        value={String(customer.totalOrders || 0)}
                        subtitle={`AOV ${formatINR(customer.avgOrderValue || 0)}`}
                    />
                    <MetricCard
                        label="Return Rate"
                        value={`${(customer.returnRate || 0).toFixed(1)}%`}
                        subtitle={`${customer.returnCount || 0} returns`}
                        danger={(customer.returnRate || 0) > 20}
                    />
                    <MetricCard
                        label="Last Order"
                        value={metrics.daysSinceOrder !== null ? `${metrics.daysSinceOrder}d ago` : 'Never'}
                        subtitle={customer.lastOrderDate ? formatDate(customer.lastOrderDate) : undefined}
                        danger={metrics.daysSinceOrder !== null && metrics.daysSinceOrder > 90}
                    />
                </div>

                {/* Two-column layout */}
                <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">

                    {/* Left column (2/3) */}
                    <div className="lg:col-span-2 space-y-4">

                        {/* Risk alerts */}
                        {risks.length > 0 && (
                            <div className="space-y-2">
                                {risks.map((risk, i) => (
                                    <div
                                        key={i}
                                        className={cn(
                                            'flex items-start gap-3 px-4 py-3 rounded-xl border',
                                            risk.severity === 'high'
                                                ? 'bg-red-50 border-red-200'
                                                : risk.severity === 'medium'
                                                    ? 'bg-amber-50 border-amber-200'
                                                    : 'bg-blue-50 border-blue-200',
                                        )}
                                    >
                                        {risk.severity === 'high' ? (
                                            <AlertCircle className="w-4 h-4 text-red-500 mt-0.5 flex-shrink-0" />
                                        ) : risk.severity === 'medium' ? (
                                            <AlertTriangle className="w-4 h-4 text-amber-500 mt-0.5 flex-shrink-0" />
                                        ) : (
                                            <CheckCircle2 className="w-4 h-4 text-blue-500 mt-0.5 flex-shrink-0" />
                                        )}
                                        <div>
                                            <p className={cn(
                                                'text-sm font-medium',
                                                risk.severity === 'high' ? 'text-red-800' :
                                                    risk.severity === 'medium' ? 'text-amber-800' : 'text-blue-800',
                                            )}>
                                                {risk.type}
                                            </p>
                                            <p className="text-xs text-[#6B5E50]">{risk.message}</p>
                                        </div>
                                    </div>
                                ))}
                            </div>
                        )}

                        {/* Revenue Timeline */}
                        {customer.revenueTimeline && customer.revenueTimeline.length > 1 && (
                            <div className="bg-white rounded-xl border border-[#E8E4DF] overflow-hidden">
                                <div className="px-4 py-3 border-b border-[#F5F0EB]">
                                    <div className="flex items-center gap-2">
                                        <BarChart3 className="w-4 h-4 text-[#B5AAA0]" />
                                        <h2 className="text-sm font-semibold text-[#1A1A1A]">Revenue Timeline</h2>
                                    </div>
                                </div>
                                <div className="p-4">
                                    <RevenueChart data={customer.revenueTimeline} />
                                </div>
                            </div>
                        )}

                        {/* Return & RTO Analysis */}
                        {customer.returnAnalysis && (
                            <div className="bg-white rounded-xl border border-[#E8E4DF] overflow-hidden">
                                <div className="px-4 py-3 border-b border-[#F5F0EB]">
                                    <div className="flex items-center gap-2">
                                        <RotateCcw className="w-4 h-4 text-[#B5AAA0]" />
                                        <h2 className="text-sm font-semibold text-[#1A1A1A]">Return & RTO Analysis</h2>
                                        <span className="text-xs text-[#B5AAA0] ml-auto">
                                            {customer.returnAnalysis.totalReturnedLines} returned, {customer.returnAnalysis.totalRtoLines} RTO
                                        </span>
                                    </div>
                                </div>
                                <div className="p-4">
                                    <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                                        {customer.returnAnalysis.reasonBreakdown.length > 0 && (
                                            <div>
                                                <p className="text-xs font-medium text-[#B5AAA0] uppercase tracking-wider mb-2">Return Reasons</p>
                                                <div className="space-y-1.5">
                                                    {customer.returnAnalysis.reasonBreakdown.map((r, i) => (
                                                        <div key={i} className="flex items-center justify-between">
                                                            <span className="text-xs text-[#6B5E50]">{formatReasonLabel(r.reason)}</span>
                                                            <div className="flex items-center gap-2">
                                                                <div className="w-16 h-1.5 bg-[#F5F0EB] rounded-full overflow-hidden">
                                                                    <div
                                                                        className="h-full bg-[#D4A574] rounded-full"
                                                                        style={{ width: `${(r.count / customer.returnAnalysis!.totalReturnedLines) * 100}%` }}
                                                                    />
                                                                </div>
                                                                <span className="text-xs text-[#B5AAA0] w-5 text-right tabular-nums">{r.count}</span>
                                                            </div>
                                                        </div>
                                                    ))}
                                                </div>
                                            </div>
                                        )}

                                        {customer.returnAnalysis.resolutionBreakdown.length > 0 && (
                                            <div>
                                                <p className="text-xs font-medium text-[#B5AAA0] uppercase tracking-wider mb-2">Resolution Type</p>
                                                <div className="space-y-1.5">
                                                    {customer.returnAnalysis.resolutionBreakdown.map((r, i) => {
                                                        const icon = r.resolution === 'refund' ? IndianRupee
                                                            : r.resolution === 'exchange' ? RefreshCcw
                                                                : r.resolution === 'rejected' ? Ban : Shield;
                                                        return (
                                                            <div key={i} className="flex items-center gap-2">
                                                                {(() => {
                                                                    const Icon = icon;
                                                                    return <Icon className="w-3 h-3 text-[#B5AAA0]" />;
                                                                })()}
                                                                <span className="text-xs text-[#6B5E50] flex-1">{formatReasonLabel(r.resolution)}</span>
                                                                <span className="text-xs font-medium text-[#1A1A1A] tabular-nums">{r.count}</span>
                                                            </div>
                                                        );
                                                    })}
                                                </div>
                                            </div>
                                        )}

                                        {customer.returnAnalysis.rtoConditionBreakdown.length > 0 && (
                                            <div>
                                                <p className="text-xs font-medium text-[#B5AAA0] uppercase tracking-wider mb-2">RTO Condition</p>
                                                <div className="space-y-1.5">
                                                    {customer.returnAnalysis.rtoConditionBreakdown.map((r, i) => (
                                                        <div key={i} className="flex items-center justify-between">
                                                            <span className="text-xs text-[#6B5E50]">{formatReasonLabel(r.condition)}</span>
                                                            <span className="text-xs font-medium text-[#1A1A1A] tabular-nums">{r.count}</span>
                                                        </div>
                                                    ))}
                                                </div>
                                            </div>
                                        )}
                                    </div>
                                </div>
                            </div>
                        )}

                        {/* Order History */}
                        <div className="bg-white rounded-xl border border-[#E8E4DF] overflow-hidden">
                            <div className="px-4 py-3 border-b border-[#F5F0EB]">
                                <div className="flex items-center justify-between">
                                    <div className="flex items-center gap-2">
                                        <ShoppingBag className="w-4 h-4 text-[#B5AAA0]" />
                                        <h2 className="text-sm font-semibold text-[#1A1A1A]">Order History</h2>
                                        <span className="text-xs text-[#B5AAA0]">{customer.totalOrders || 0} total</span>
                                    </div>
                                    {/* Order filter pills */}
                                    <div className="flex items-center gap-1">
                                        {(['all', 'delivered', 'returns'] as const).map((f) => (
                                            <button
                                                key={f}
                                                onClick={() => { setOrderFilter(f); setShowAllOrders(false); }}
                                                className={cn(
                                                    'px-2.5 py-1 rounded-full text-[10px] font-medium capitalize transition-colors',
                                                    orderFilter === f
                                                        ? 'bg-[#1A1A1A] text-white'
                                                        : 'text-[#8C7B6B] hover:bg-[#F5F0EB]',
                                                )}
                                            >
                                                {f}
                                                {f === 'returns' && returnRtoStats.returnOrders > 0 && (
                                                    <span className="ml-1">{returnRtoStats.returnOrders}</span>
                                                )}
                                            </button>
                                        ))}
                                    </div>
                                </div>
                            </div>

                            {filteredOrders.length > 0 ? (
                                <>
                                    <div className="divide-y divide-[#F5F0EB]">
                                        {displayOrders?.map((order) => {
                                            const statusConfig = ORDER_STATUS_CONFIG[order.status?.toLowerCase()] || ORDER_STATUS_CONFIG.open;
                                            const firstLine = order.orderLines?.[0];
                                            const firstImage = firstLine?.sku?.variation?.imageUrl ||
                                                firstLine?.sku?.variation?.product?.imageUrl;
                                            const productName = firstLine?.sku?.variation?.product?.name || 'Unknown';
                                            const itemCount = order.orderLines?.length || 0;
                                            const hasReturns = order.orderLines?.some((l) => l.returnStatus);
                                            const hasRto = order.orderLines?.some((l) => l.rtoCondition || l.rtoInitiatedAt);

                                            return (
                                                <button
                                                    key={order.id}
                                                    onClick={() => navigate({
                                                        to: '/orders/$orderId',
                                                        params: { orderId: order.orderNumber },
                                                    })}
                                                    className="w-full text-left px-4 py-3 hover:bg-[#FAF9F7] transition-colors group"
                                                >
                                                    <div className="flex items-center gap-3">
                                                        {firstImage ? (
                                                            <img
                                                                src={getOptimizedImageUrl(firstImage, 'sm') || firstImage}
                                                                alt={productName}
                                                                className="w-11 h-11 rounded-lg object-cover border border-[#E8E4DF] flex-shrink-0"
                                                                loading="lazy"
                                                            />
                                                        ) : (
                                                            <div className="w-11 h-11 rounded-lg bg-[#F5F0EB] flex items-center justify-center flex-shrink-0">
                                                                <Package className="w-4 h-4 text-[#B5AAA0]" />
                                                            </div>
                                                        )}

                                                        <div className="flex-1 min-w-0">
                                                            <div className="flex items-center gap-1.5 flex-wrap">
                                                                <span className="text-sm font-semibold text-[#1A1A1A]">
                                                                    #{order.orderNumber}
                                                                </span>
                                                                <span className={cn(
                                                                    'inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-medium',
                                                                    statusConfig.bg, statusConfig.text,
                                                                )}>
                                                                    <span className={cn('w-1 h-1 rounded-full', statusConfig.dot)} />
                                                                    {order.status}
                                                                </span>
                                                                {order.isExchange && (
                                                                    <span className="px-1.5 py-0.5 rounded text-[10px] font-medium bg-violet-50 text-violet-700">
                                                                        Exchange
                                                                    </span>
                                                                )}
                                                                {hasReturns && (
                                                                    <span className="px-1.5 py-0.5 rounded text-[10px] font-medium bg-orange-50 text-orange-600">
                                                                        Return
                                                                    </span>
                                                                )}
                                                                {hasRto && (
                                                                    <span className="px-1.5 py-0.5 rounded text-[10px] font-medium bg-red-50 text-red-600">
                                                                        RTO
                                                                    </span>
                                                                )}
                                                            </div>
                                                            <p className="text-xs text-[#8C7B6B] truncate mt-0.5">
                                                                {productName}
                                                                {itemCount > 1 && ` + ${itemCount - 1} more`}
                                                            </p>
                                                            {order.internalNotes && (
                                                                <p className="text-[10px] text-[#D4A574] truncate mt-0.5 flex items-center gap-1">
                                                                    <MessageSquare className="w-2.5 h-2.5 flex-shrink-0" />
                                                                    {order.internalNotes}
                                                                </p>
                                                            )}
                                                        </div>

                                                        <div className="text-right flex-shrink-0">
                                                            <p className="text-sm font-semibold text-[#1A1A1A] tabular-nums font-display">
                                                                {formatINR(order.totalAmount || 0)}
                                                            </p>
                                                            <p className="text-[10px] text-[#B5AAA0]" title={formatDate(order.orderDate)}>
                                                                {getRelativeTime(
                                                                    typeof order.orderDate === 'string'
                                                                        ? order.orderDate
                                                                        : order.orderDate.toISOString()
                                                                )}
                                                            </p>
                                                        </div>

                                                        <ChevronRight className="w-4 h-4 text-[#E8E4DF] group-hover:text-[#B5AAA0] transition-colors flex-shrink-0" />
                                                    </div>
                                                </button>
                                            );
                                        })}
                                    </div>
                                    {filteredOrders.length > 10 && (
                                        <button
                                            onClick={(e) => { e.stopPropagation(); setShowAllOrders(!showAllOrders); }}
                                            className="w-full px-4 py-2.5 text-xs font-medium text-[#8C7B6B] hover:text-[#6B5E50] hover:bg-[#FAF9F7] border-t border-[#F5F0EB] flex items-center justify-center gap-1 transition-colors"
                                        >
                                            {showAllOrders ? (
                                                <>Show less <ChevronUp className="w-3 h-3" /></>
                                            ) : (
                                                <>View all {filteredOrders.length} orders <ChevronDown className="w-3 h-3" /></>
                                            )}
                                        </button>
                                    )}
                                </>
                            ) : (
                                <div className="px-4 py-12 text-center">
                                    <ShoppingBag className="w-8 h-8 text-[#E8E4DF] mx-auto mb-2" />
                                    <p className="text-sm text-[#B5AAA0]">
                                        {orderFilter === 'all' ? 'No orders yet' : `No ${orderFilter} orders`}
                                    </p>
                                </div>
                            )}
                        </div>

                        {/* Order Notes */}
                        {customer.orderNotes && customer.orderNotes.length > 0 && (
                            <div className="bg-white rounded-xl border border-[#E8E4DF] overflow-hidden">
                                <div className="px-4 py-3 border-b border-[#F5F0EB]">
                                    <div className="flex items-center gap-2">
                                        <FileText className="w-4 h-4 text-[#B5AAA0]" />
                                        <h2 className="text-sm font-semibold text-[#1A1A1A]">Notes</h2>
                                        <span className="text-xs text-[#B5AAA0]">{customer.orderNotes.length}</span>
                                    </div>
                                </div>
                                <div className="divide-y divide-[#F5F0EB] max-h-64 overflow-y-auto">
                                    {customer.orderNotes.map((note, i) => (
                                        <div key={i} className="px-4 py-2.5">
                                            <div className="flex items-center justify-between mb-0.5">
                                                <button
                                                    onClick={() => navigate({
                                                        to: '/orders/$orderId',
                                                        params: { orderId: note.orderNumber },
                                                    })}
                                                    className="text-xs font-medium text-[#D4A574] hover:underline"
                                                >
                                                    #{note.orderNumber}
                                                </button>
                                                <span className="text-[10px] text-[#B5AAA0]">{formatDate(note.orderDate)}</span>
                                            </div>
                                            <p className="text-xs text-[#6B5E50]">{note.note}</p>
                                        </div>
                                    ))}
                                </div>
                            </div>
                        )}
                    </div>

                    {/* Right column (1/3) */}
                    <div className="space-y-4">

                        {/* Style DNA */}
                        {(customer.colorAffinity?.length || customer.productAffinity?.length || customer.fabricAffinity?.length || sizePreferences.length > 0) && (
                            <div className="bg-white rounded-xl border border-[#E8E4DF] overflow-hidden">
                                <div className="px-4 py-3 border-b border-[#F5F0EB]">
                                    <div className="flex items-center gap-2">
                                        <Palette className="w-4 h-4 text-[#B5AAA0]" />
                                        <h2 className="text-sm font-semibold text-[#1A1A1A]">Style DNA</h2>
                                    </div>
                                </div>

                                <div className="p-4 space-y-5">
                                    {/* Top Colours */}
                                    {customer.colorAffinity && customer.colorAffinity.length > 0 && (
                                        <div>
                                            <p className="text-[10px] font-medium text-[#B5AAA0] uppercase tracking-wider mb-2.5">Top Colours</p>
                                            <div className="flex flex-wrap gap-2">
                                                {customer.colorAffinity.slice(0, 6).map((c, i) => {
                                                    const hex = c.hex || getColorHex(c.color);
                                                    return (
                                                        <span
                                                            key={i}
                                                            className="inline-flex items-center gap-1.5 px-2.5 py-1 bg-[#F5F0EB] rounded-full text-xs text-[#6B5E50]"
                                                            title={`${c.qty} items`}
                                                        >
                                                            <span
                                                                className="w-2.5 h-2.5 rounded-full flex-shrink-0 border border-[#E8E4DF]"
                                                                style={{ backgroundColor: hex }}
                                                            />
                                                            {c.color}
                                                        </span>
                                                    );
                                                })}
                                            </div>
                                        </div>
                                    )}

                                    {/* Preferred Sizes */}
                                    {sizePreferences.length > 0 && (
                                        <div>
                                            <p className="text-[10px] font-medium text-[#B5AAA0] uppercase tracking-wider mb-2">Preferred Sizes</p>
                                            <div className="flex flex-wrap gap-1.5">
                                                {sizePreferences.map(({ size }) => (
                                                    <span key={size} className="inline-flex items-center justify-center min-w-[32px] px-2.5 py-1 border border-[#E8E4DF] rounded-full text-xs font-medium text-[#6B5E50]">
                                                        {size}
                                                    </span>
                                                ))}
                                            </div>
                                        </div>
                                    )}

                                    {/* Favourite Categories (from products) */}
                                    {customer.productAffinity && customer.productAffinity.length > 0 && (
                                        <div>
                                            <p className="text-[10px] font-medium text-[#B5AAA0] uppercase tracking-wider mb-2">Favourite Categories</p>
                                            <div className="flex flex-wrap gap-1.5">
                                                {customer.productAffinity.slice(0, 5).map((p, i) => (
                                                    <span key={i} className="inline-flex items-center px-2.5 py-1 border border-[#E8E4DF] rounded-full text-xs text-[#6B5E50]">
                                                        {p.productName}
                                                    </span>
                                                ))}
                                            </div>
                                        </div>
                                    )}

                                    {/* Fabrics */}
                                    {customer.fabricAffinity && customer.fabricAffinity.length > 0 && (
                                        <div>
                                            <p className="text-[10px] font-medium text-[#B5AAA0] uppercase tracking-wider mb-2">Fabrics</p>
                                            <div className="flex flex-wrap gap-1.5">
                                                {customer.fabricAffinity.slice(0, 5).map((f, i) => (
                                                    <span key={i} className="px-2.5 py-1 border border-[#E8E4DF] text-[#6B5E50] rounded-full text-xs">
                                                        {f.fabricType} ({f.qty})
                                                    </span>
                                                ))}
                                            </div>
                                        </div>
                                    )}
                                </div>
                            </div>
                        )}

                        {/* Tier Progress */}
                        {metrics.tierProgress.nextTier && (
                            <div className="bg-white rounded-xl border border-[#E8E4DF] overflow-hidden">
                                <div className="px-4 py-3 border-b border-[#F5F0EB]">
                                    <div className="flex items-center justify-between">
                                        <h2 className="text-sm font-semibold text-[#1A1A1A]">Tier Progress</h2>
                                        <span className="text-xs font-medium text-[#D4A574]">
                                            {(customer.customerTier || customer.tier || 'bronze').charAt(0).toUpperCase() + (customer.customerTier || customer.tier || 'bronze').slice(1)}
                                        </span>
                                    </div>
                                </div>
                                <div className="px-4 py-4">
                                    <div className="h-2 bg-[#F5F0EB] rounded-full overflow-hidden mb-2">
                                        <div
                                            className={cn(
                                                'h-full rounded-full transition-all duration-500',
                                                metrics.tierProgress.shouldUpgrade
                                                    ? 'bg-[#5B9A6F]'
                                                    : 'bg-[#D4A574]',
                                            )}
                                            style={{ width: `${metrics.tierProgress.progress}%` }}
                                        />
                                    </div>
                                    <div className="flex items-center justify-between">
                                        <span className="text-xs text-[#8C7B6B] tabular-nums">
                                            {formatINR(customer.lifetimeValue || 0)} of {formatINR(
                                                (customer.lifetimeValue || 0) + metrics.tierProgress.amountToNext
                                            )}
                                        </span>
                                        <span className="text-xs font-medium text-[#D4A574]">
                                            {metrics.tierProgress.nextTier}
                                        </span>
                                    </div>
                                    {metrics.tierProgress.shouldUpgrade ? (
                                        <p className="text-xs text-[#5B9A6F] mt-1 font-medium">
                                            Qualifies for {metrics.tierProgress.nextTier} upgrade!
                                        </p>
                                    ) : (
                                        <p className="text-xs text-[#B5AAA0] mt-1">
                                            {formatINR(metrics.tierProgress.amountToNext)} away from {metrics.tierProgress.nextTier} tier
                                        </p>
                                    )}
                                </div>
                            </div>
                        )}

                        {/* Health Score Card */}
                        <div className="bg-white rounded-xl border border-[#E8E4DF] overflow-hidden">
                            <div className="px-4 py-3 border-b border-[#F5F0EB]">
                                <h2 className="text-sm font-semibold text-[#1A1A1A]">Health Score</h2>
                            </div>
                            <div className="px-4 py-4">
                                <div className="flex items-center gap-4 mb-4">
                                    <div className="relative w-14 h-14 flex-shrink-0">
                                        <svg className="w-full h-full transform -rotate-90" viewBox="0 0 50 50">
                                            <circle cx="25" cy="25" r="20" fill="none" stroke="#F5F0EB" strokeWidth="4" />
                                            <circle
                                                cx="25" cy="25" r="20" fill="none" stroke={healthColor} strokeWidth="4"
                                                strokeLinecap="round"
                                                strokeDasharray={2 * Math.PI * 20}
                                                strokeDashoffset={2 * Math.PI * 20 - (metrics.healthScore / 100) * 2 * Math.PI * 20}
                                                style={{ transition: 'stroke-dashoffset 0.5s ease-out' }}
                                            />
                                        </svg>
                                        <div className="absolute inset-0 flex items-center justify-center">
                                            <span className="text-base font-bold font-display" style={{ color: healthColor }}>
                                                {metrics.healthScore}
                                            </span>
                                        </div>
                                    </div>
                                    <div>
                                        <p className="text-sm font-medium text-[#1A1A1A]">{healthLabel}</p>
                                        <p className="text-xs text-[#B5AAA0] mt-0.5">RFM analysis</p>
                                    </div>
                                </div>
                                <div className="space-y-2">
                                    <RfmBar label="Recency" score={metrics.rfm.recencyScore} max={25} color="bg-[#D4A574]" />
                                    <RfmBar label="Frequency" score={metrics.rfm.frequencyScore} max={25} color="bg-[#8C7B6B]" />
                                    <RfmBar label="Monetary" score={metrics.rfm.monetaryScore} max={25} color="bg-[#6B5E50]" />
                                    <RfmBar label="Return Penalty" score={-metrics.rfm.returnPenalty} max={25} color="bg-[#C0392B]" isNegative />
                                </div>
                            </div>
                        </div>

                        {/* Payment Methods */}
                        {customer.paymentBreakdown && customer.paymentBreakdown.length > 0 && (
                            <div className="bg-white rounded-xl border border-[#E8E4DF] overflow-hidden">
                                <div className="px-4 py-3 border-b border-[#F5F0EB]">
                                    <div className="flex items-center gap-2">
                                        <CreditCard className="w-4 h-4 text-[#B5AAA0]" />
                                        <h2 className="text-sm font-semibold text-[#1A1A1A]">Payment Methods</h2>
                                    </div>
                                </div>
                                <div className="px-4 py-3 space-y-2">
                                    {customer.paymentBreakdown.map((pm, i) => (
                                        <div key={i} className="flex items-center justify-between text-sm">
                                            <div className="flex items-center gap-2">
                                                <span className="text-[#6B5E50]">{pm.method}</span>
                                                <span className="text-[10px] text-[#B5AAA0]">({pm.count})</span>
                                            </div>
                                            <span className="text-[#1A1A1A] font-medium tabular-nums">{formatINR(pm.total)}</span>
                                        </div>
                                    ))}
                                </div>
                            </div>
                        )}

                        {/* Contact & Details */}
                        <div className="bg-white rounded-xl border border-[#E8E4DF] overflow-hidden">
                            <div className="px-4 py-3 border-b border-[#F5F0EB]">
                                <h2 className="text-sm font-semibold text-[#1A1A1A]">Details</h2>
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
                                <DetailRow label="Total orders" value={String(customer.totalOrders || 0)} />
                                <DetailRow label="Returns" value={String(customer.returnCount || 0)} />
                                <DetailRow label="Exchanges" value={String(customer.exchangeCount || 0)} />
                                <DetailRow
                                    label="RTOs"
                                    value={`${customer.rtoCount || 0} lines (${customer.rtoOrderCount || 0} orders)`}
                                />
                                {(customer.rtoValue || 0) > 0 && (
                                    <DetailRow label="RTO value" value={formatINR(customer.rtoValue)} />
                                )}
                                {(customer.storeCreditBalance || 0) > 0 && (
                                    <DetailRow label="Store credit" value={formatINR(customer.storeCreditBalance)} />
                                )}
                                <DetailRow
                                    label="Account created"
                                    value={customer.createdAt ? formatDate(customer.createdAt) : 'N/A'}
                                />
                                {customer.acceptsMarketing !== undefined && (
                                    <DetailRow
                                        label="Marketing"
                                        value={customer.acceptsMarketing ? 'Subscribed' : 'Not subscribed'}
                                    />
                                )}
                            </div>
                        </div>

                        {/* Default Address */}
                        {customer.defaultAddress && (
                            <div className="bg-white rounded-xl border border-[#E8E4DF] overflow-hidden">
                                <div className="px-4 py-3 border-b border-[#F5F0EB]">
                                    <div className="flex items-center gap-2">
                                        <MapPin className="w-4 h-4 text-[#B5AAA0]" />
                                        <h2 className="text-sm font-semibold text-[#1A1A1A]">Default Address</h2>
                                    </div>
                                </div>
                                <div className="px-4 py-3">
                                    <AddressDisplay address={customer.defaultAddress} />
                                </div>
                            </div>
                        )}

                        {/* Tags */}
                        {customer.tags && (
                            <div className="bg-white rounded-xl border border-[#E8E4DF] overflow-hidden">
                                <div className="px-4 py-3 border-b border-[#F5F0EB]">
                                    <div className="flex items-center gap-2">
                                        <Tag className="w-4 h-4 text-[#B5AAA0]" />
                                        <h2 className="text-sm font-semibold text-[#1A1A1A]">Tags</h2>
                                    </div>
                                </div>
                                <div className="px-4 py-3">
                                    <div className="flex flex-wrap gap-1.5">
                                        {customer.tags.split(',').map((tag) => (
                                            <span
                                                key={tag.trim()}
                                                className="inline-flex items-center px-2.5 py-0.5 bg-[#F5F0EB] text-[#6B5E50] rounded-full text-xs"
                                            >
                                                {tag.trim()}
                                            </span>
                                        ))}
                                    </div>
                                </div>
                            </div>
                        )}
                    </div>
                </div>
            </div>
        </div>
    );
}

// ============================================
// SUB-COMPONENTS
// ============================================

function MetricCard({ label, value, subtitle, trend, trendLabel, danger }: {
    label: string;
    value: string;
    subtitle?: string;
    trend?: number | null;
    trendLabel?: string;
    danger?: boolean;
}) {
    return (
        <div className="bg-white rounded-xl border border-[#E8E4DF] p-4">
            <p className="text-[10px] font-medium uppercase tracking-wider text-[#B5AAA0] mb-1">{label}</p>
            <p className={cn(
                'text-xl font-bold tabular-nums leading-tight font-display',
                danger ? 'text-[#C0392B]' : 'text-[#1A1A1A]',
            )}>
                {value}
            </p>
            {trend !== undefined && trend !== null && (
                <p className={cn(
                    'text-xs mt-1 font-medium',
                    trend >= 0 ? 'text-[#5B9A6F]' : 'text-[#C0392B]',
                )}>
                    {trend >= 0 ? '+' : ''}{trend}% {trendLabel}
                </p>
            )}
            {subtitle && <p className="text-xs text-[#8C7B6B] mt-1">{subtitle}</p>}
        </div>
    );
}

function DetailRow({ label, value }: { label: string; value: string }) {
    return (
        <div className="flex justify-between text-sm">
            <span className="text-[#8C7B6B]">{label}</span>
            <span className="text-[#1A1A1A] text-right">{value}</span>
        </div>
    );
}

function RfmBar({ label, score, max, color, isNegative }: {
    label: string;
    score: number;
    max: number;
    color: string;
    isNegative?: boolean;
}) {
    const absScore = Math.abs(score);
    const pct = (absScore / max) * 100;

    return (
        <div className="flex items-center gap-2">
            <span className="text-[10px] text-[#8C7B6B] w-20">{label}</span>
            <div className="flex-1 h-1.5 bg-[#F5F0EB] rounded-full overflow-hidden">
                <div
                    className={cn('h-full rounded-full', color)}
                    style={{ width: `${pct}%` }}
                />
            </div>
            <span className={cn('text-[10px] w-8 text-right tabular-nums', isNegative ? 'text-[#C0392B]' : 'text-[#6B5E50]')}>
                {isNegative ? score : `+${score}`}
            </span>
        </div>
    );
}

function RevenueChart({ data }: { data: Array<{ month: string; revenue: number; orders: number }> }) {
    const maxRevenue = Math.max(...data.map((d) => d.revenue), 1);

    return (
        <div className="space-y-1">
            <div className="flex items-end gap-1 h-24">
                {data.map((d, i) => {
                    const height = (d.revenue / maxRevenue) * 100;
                    const monthLabel = d.month.split('-')[1];
                    const monthNames = ['', 'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
                    const shortMonth = monthNames[parseInt(monthLabel, 10)] || monthLabel;

                    return (
                        <div key={i} className="flex-1 flex flex-col items-center justify-end h-full group relative">
                            <div
                                className="w-full bg-[#D4A574] hover:bg-[#C4956A] rounded-t transition-colors min-h-[2px]"
                                style={{ height: `${height}%` }}
                                title={`${d.month}: ${formatINR(d.revenue)} (${d.orders} orders)`}
                            />
                            <span className="text-[8px] text-[#B5AAA0] mt-1">{shortMonth}</span>
                        </div>
                    );
                })}
            </div>
            <div className="flex justify-between text-[9px] text-[#B5AAA0] pt-1 border-t border-[#F5F0EB]">
                <span>{data[0]?.month}</span>
                <span>Total: {formatINR(data.reduce((sum, d) => sum + d.revenue, 0))}</span>
                <span>{data[data.length - 1]?.month}</span>
            </div>
        </div>
    );
}

function AddressOneliner({ address }: { address: unknown }) {
    if (!address) return null;
    let addr: Record<string, unknown>;
    if (typeof address === 'string') {
        try { addr = JSON.parse(address); } catch { return <span>{address}</span>; }
    } else {
        addr = address as Record<string, unknown>;
    }
    const city = addr.city ? String(addr.city) : null;
    const province = addr.province ? String(addr.province) : null;
    return <span>{[city, province].filter(Boolean).join(', ') || 'Address on file'}</span>;
}

function AddressDisplay({ address }: { address: unknown }) {
    if (!address) return null;

    let addr: Record<string, unknown>;
    if (typeof address === 'string') {
        try {
            addr = JSON.parse(address);
        } catch {
            return <p className="text-sm text-[#6B5E50]">{address}</p>;
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
            <p className="text-sm text-[#6B5E50] whitespace-pre-line">{parts.join('\n')}</p>
            {typeof addr.phone === 'string' && addr.phone && (
                <div className="flex items-center gap-2 mt-2 text-sm text-[#8C7B6B]">
                    <Phone className="w-3.5 h-3.5" />
                    {addr.phone}
                </div>
            )}
        </div>
    );
}
