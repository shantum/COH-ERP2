/**
 * CustomerDetailModal - Premium Customer Profile Experience
 *
 * A distinctive, editorial-style modal that presents comprehensive customer intelligence
 * with visual metrics, health scores, and risk indicators.
 */

import { useState, useMemo } from 'react';
import {
    X,
    Mail, Phone, MessageCircle, MapPin,
    TrendingUp, TrendingDown, AlertTriangle,
    Package, Palette, Layers, ShoppingBag,
    ChevronDown, ChevronUp,
    RotateCcw, Truck,
    Heart, AlertCircle, CheckCircle2, XCircle
} from 'lucide-react';
import { useQuery } from '@tanstack/react-query';
import { useServerFn } from '@tanstack/react-start';
import { getCustomer } from '../../server/functions/customers';
import { getOptimizedImageUrl } from '../../utils/imageOptimization';
import {
    TIER_CONFIG,
    calculateHealthScore,
    getHealthScoreColor,
    getHealthScoreLabel,
    calculateTierProgress,
    getColorHex,
    getInitials,
    calculateTenure,
    getDaysSinceLastOrder,
    getRelativeTime,
    formatAddress,
} from '../../utils/customerIntelligence';

// ============================================================================
// TYPES
// ============================================================================

interface CustomerDetailModalProps {
    // Either provide customer data directly OR customerId to fetch
    customer?: any;
    customerId?: string | null;
    isLoading?: boolean;
    onClose: () => void;
}

interface OrderLine {
    id: string;
    qty: number;
    sku?: {
        size?: string;
        variation?: {
            colorName?: string;
            imageUrl?: string;
            product?: { name?: string; imageUrl?: string };
        };
    };
}

interface Order {
    id: string;
    orderNumber: string;
    status: string;
    totalAmount: number;
    orderDate: string;
    orderLines?: OrderLine[];
}

// Note: Constants and helper functions imported from '../../utils/customerIntelligence'

function pluralize(count: number, singular: string, plural?: string): string {
    return count === 1 ? singular : (plural || singular + 's');
}

function calculateOrderFrequency(totalOrders: number, firstOrderDate: string | null): number {
    if (!firstOrderDate || totalOrders === 0) return 0;
    const months = Math.max(1, Math.floor(
        (Date.now() - new Date(firstOrderDate).getTime()) / (1000 * 60 * 60 * 24 * 30)
    ));
    return totalOrders / months;
}

// ============================================================================
// SUB-COMPONENTS
// ============================================================================

function HealthScoreGauge({ score }: { score: number }) {
    const color = getHealthScoreColor(score);
    const label = getHealthScoreLabel(score);
    const circumference = 2 * Math.PI * 45;
    const offset = circumference - (score / 100) * circumference;

    return (
        <div className="flex flex-col items-center">
            <div className="relative w-28 h-28">
                <svg className="w-full h-full transform -rotate-90" viewBox="0 0 100 100">
                    {/* Background ring */}
                    <circle
                        cx="50"
                        cy="50"
                        r="45"
                        fill="none"
                        stroke="#e5e7eb"
                        strokeWidth="8"
                    />
                    {/* Score ring */}
                    <circle
                        cx="50"
                        cy="50"
                        r="45"
                        fill="none"
                        stroke={color}
                        strokeWidth="8"
                        strokeLinecap="round"
                        strokeDasharray={circumference}
                        strokeDashoffset={offset}
                        className="health-score-ring"
                        style={{ transition: 'stroke-dashoffset 1s ease-out' }}
                    />
                </svg>
                <div className="absolute inset-0 flex flex-col items-center justify-center">
                    <span className="text-2xl font-bold" style={{ color }}>{score}</span>
                    <span className="text-[10px] uppercase tracking-wider text-slate-500">{label}</span>
                </div>
            </div>
            <span className="mt-2 text-xs font-medium text-slate-600 uppercase tracking-wider">Health Score</span>
        </div>
    );
}

function TierBadge({ tier }: { tier: string }) {
    const config = TIER_CONFIG[tier?.toLowerCase() as keyof typeof TIER_CONFIG] || TIER_CONFIG.bronze;
    const Icon = config.icon;

    return (
        <div
            className={`
                inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full border
                ${config.bg} ${config.text} ${config.border}
            `}
        >
            <Icon size={14} />
            <span className="text-xs font-bold tracking-wider">{config.label}</span>
        </div>
    );
}

function TierProgressBar({ progress, nextTier, amountToNext, shouldUpgrade }: { progress: number; nextTier: string | null; amountToNext: number; shouldUpgrade?: boolean }) {
    if (!nextTier) {
        return (
            <div className="flex items-center gap-2 text-xs text-slate-500">
                <CheckCircle2 size={14} className="text-purple-500" />
                <span>Highest tier achieved</span>
            </div>
        );
    }

    // Customer qualifies for upgrade
    if (shouldUpgrade) {
        return (
            <div className="space-y-1.5">
                <div className="flex items-center gap-2 text-xs text-emerald-600">
                    <CheckCircle2 size={14} />
                    <span className="font-medium">Qualifies for {nextTier}!</span>
                </div>
                <div className="h-2 bg-slate-100 rounded-full overflow-hidden">
                    <div className="h-full bg-gradient-to-r from-emerald-400 to-emerald-600 rounded-full w-full" />
                </div>
                <p className="text-[10px] text-emerald-500">
                    Tier upgrade pending
                </p>
            </div>
        );
    }

    return (
        <div className="space-y-1.5">
            <div className="flex justify-between text-xs">
                <span className="text-slate-500">Progress to {nextTier}</span>
                <span className="font-medium text-slate-700">{Math.round(progress)}%</span>
            </div>
            <div className="h-2 bg-slate-100 rounded-full overflow-hidden">
                <div
                    className="h-full bg-gradient-to-r from-sky-400 to-sky-600 rounded-full transition-all duration-500"
                    style={{ width: `${progress}%` }}
                />
            </div>
            <p className="text-[10px] text-slate-400">
                ₹{amountToNext.toLocaleString()} more to reach {nextTier}
            </p>
        </div>
    );
}

const STAT_COLOR_CLASSES: Record<string, { bg: string; iconBg: string; iconText: string }> = {
    sky: { bg: 'bg-white', iconBg: 'bg-sky-50', iconText: 'text-sky-600' },
    slate: { bg: 'bg-white', iconBg: 'bg-slate-50', iconText: 'text-slate-600' },
    red: { bg: 'bg-white', iconBg: 'bg-red-50', iconText: 'text-red-600' },
    amber: { bg: 'bg-white', iconBg: 'bg-amber-50', iconText: 'text-amber-600' },
    emerald: { bg: 'bg-white', iconBg: 'bg-emerald-50', iconText: 'text-emerald-600' },
};

function StatCard({ label, value, icon: Icon, trend, subtext, color = 'slate' }: {
    label: string;
    value: string | number;
    icon: any;
    trend?: 'up' | 'down' | null;
    subtext?: string;
    color?: string;
}) {
    const colorClasses = STAT_COLOR_CLASSES[color] || STAT_COLOR_CLASSES.slate;

    return (
        <div className={`${colorClasses.bg} rounded-xl p-4 border border-slate-100 shadow-sm hover:shadow-md transition-shadow`}>
            <div className="flex items-start justify-between mb-2">
                <div className={`p-2 rounded-lg ${colorClasses.iconBg}`}>
                    <Icon size={16} className={colorClasses.iconText} />
                </div>
                {trend && (
                    <div className={`flex items-center gap-0.5 text-xs ${trend === 'up' ? 'text-emerald-600' : 'text-red-500'}`}>
                        {trend === 'up' ? <TrendingUp size={12} /> : <TrendingDown size={12} />}
                    </div>
                )}
            </div>
            <div className="font-bold text-xl text-slate-900 tabular-nums">{value}</div>
            <div className="text-[10px] uppercase tracking-wider text-slate-500 mt-0.5">{label}</div>
            {subtext && <div className="text-[10px] text-slate-400 mt-1">{subtext}</div>}
        </div>
    );
}

function ColorSwatch({ color, qty, total, hex: providedHex }: { color: string; qty: number; total: number; hex?: string | null }) {
    // Use provided hex from API if available, otherwise fall back to name-based lookup
    const hex = providedHex || getColorHex(color);
    const percentage = (qty / total) * 100;

    // Determine if color is light by checking luminance of hex value
    const isLight = (() => {
        const hexClean = hex.replace('#', '');
        const r = parseInt(hexClean.substring(0, 2), 16);
        const g = parseInt(hexClean.substring(2, 4), 16);
        const b = parseInt(hexClean.substring(4, 6), 16);
        // Calculate relative luminance
        const luminance = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
        return luminance > 0.7;
    })();

    return (
        <div className="flex flex-col items-center gap-1 group">
            <div
                className={`
                    w-10 h-10 rounded-full shadow-md border-2
                    ${isLight ? 'border-slate-200' : 'border-white'}
                    transition-transform group-hover:scale-110
                `}
                style={{ backgroundColor: hex }}
                title={`${color}: ${qty} items`}
            />
            <span className="text-[9px] text-slate-500 max-w-[50px] truncate text-center">{color}</span>
            <div className="w-10 h-1 bg-slate-100 rounded-full overflow-hidden">
                <div
                    className="h-full bg-purple-400 rounded-full"
                    style={{ width: `${percentage}%` }}
                />
            </div>
        </div>
    );
}

function OrderCard({ order, isExpanded, onToggle }: { order: Order; isExpanded: boolean; onToggle: () => void }) {
    const statusConfig: Record<string, { bg: string; text: string }> = {
        open: { bg: 'bg-blue-100', text: 'text-blue-700' },
        allocated: { bg: 'bg-purple-100', text: 'text-purple-700' },
        picked: { bg: 'bg-emerald-100', text: 'text-emerald-700' },
        packed: { bg: 'bg-sky-100', text: 'text-sky-700' },
        shipped: { bg: 'bg-amber-100', text: 'text-amber-700' },
        delivered: { bg: 'bg-green-100', text: 'text-green-700' },
        cancelled: { bg: 'bg-gray-100', text: 'text-gray-500' }
    };

    const config = statusConfig[order.status?.toLowerCase()] || statusConfig.open;

    // Format actual date
    const actualDate = new Date(order.orderDate).toLocaleDateString('en-IN', {
        day: 'numeric',
        month: 'short',
        year: 'numeric'
    });

    return (
        <div className="border border-slate-100 rounded-lg overflow-hidden hover:border-slate-200 transition-colors">
            <button
                onClick={onToggle}
                className="w-full p-3 flex items-center justify-between bg-white hover:bg-slate-50 transition-colors"
            >
                <div className="flex items-center gap-3">
                    <span className="font-semibold text-slate-900">#{order.orderNumber}</span>
                    <span className={`px-2 py-0.5 rounded text-xs font-medium ${config.bg} ${config.text}`}>
                        {order.status}
                    </span>
                </div>
                <div className="flex items-center gap-4">
                    <div className="text-right">
                        <div className="font-semibold text-slate-900 tabular-nums">
                            ₹{Number(order.totalAmount).toLocaleString()}
                        </div>
                        <div className="text-[10px] text-slate-500">{getRelativeTime(order.orderDate)}</div>
                        <div className="text-[10px] text-slate-400">{actualDate}</div>
                    </div>
                    {isExpanded ? <ChevronUp size={16} className="text-slate-400" /> : <ChevronDown size={16} className="text-slate-400" />}
                </div>
            </button>

            {isExpanded && order.orderLines && order.orderLines.length > 0 && (
                <div className="px-3 pb-3 bg-slate-50 border-t border-slate-100">
                    <div className="pt-3 space-y-2.5">
                        {order.orderLines.map((line: OrderLine) => {
                            const imageUrl = line.sku?.variation?.imageUrl || line.sku?.variation?.product?.imageUrl;
                            return (
                                <div key={line.id} className="flex items-center gap-3">
                                    {/* Product Image Thumbnail */}
                                    {imageUrl ? (
                                        <img
                                            src={getOptimizedImageUrl(imageUrl, 'sm') || imageUrl}
                                            alt={line.sku?.variation?.product?.name || 'Product'}
                                            className="w-10 h-10 rounded-lg object-cover border border-slate-200 flex-shrink-0"
                                            loading="lazy"
                                        />
                                    ) : (
                                        <div className="w-10 h-10 rounded-lg bg-slate-100 flex items-center justify-center flex-shrink-0 border border-slate-200">
                                            <Package size={16} className="text-slate-400" />
                                        </div>
                                    )}
                                    {/* Product Details */}
                                    <div className="flex-1 min-w-0">
                                        <div className="text-sm font-medium text-slate-700 truncate">
                                            {line.sku?.variation?.product?.name || 'Unknown Product'}
                                        </div>
                                        <div className="text-xs text-slate-500">
                                            {line.sku?.variation?.colorName || 'N/A'} • {line.sku?.size || 'N/A'}
                                        </div>
                                    </div>
                                    {/* Quantity */}
                                    <span className="text-sm text-slate-500 tabular-nums flex-shrink-0">×{line.qty}</span>
                                </div>
                            );
                        })}
                    </div>
                </div>
            )}
        </div>
    );
}

function RiskAlert({ type, message, severity }: { type: string; message: string; severity: 'high' | 'medium' | 'low' }) {
    const config = {
        high: { bg: 'bg-red-50', border: 'border-red-200', text: 'text-red-700', icon: XCircle },
        medium: { bg: 'bg-amber-50', border: 'border-amber-200', text: 'text-amber-700', icon: AlertTriangle },
        low: { bg: 'bg-sky-50', border: 'border-sky-200', text: 'text-sky-700', icon: AlertCircle }
    };

    const { bg, border, text, icon: Icon } = config[severity];

    return (
        <div className={`flex items-start gap-2 p-3 rounded-lg ${bg} border ${border}`}>
            <Icon size={16} className={text} />
            <div>
                <div className={`text-xs font-medium ${text}`}>{type}</div>
                <div className="text-xs text-slate-600">{message}</div>
            </div>
        </div>
    );
}

// ============================================================================
// MAIN COMPONENT
// ============================================================================

export function CustomerDetailModal({
    customer: providedCustomer,
    customerId,
    isLoading: providedLoading,
    onClose,
}: CustomerDetailModalProps) {
    const [expandedOrders, setExpandedOrders] = useState<Set<string>>(new Set());

    // Fetch customer data if customerId is provided and no customer object
    const getCustomerFn = useServerFn(getCustomer);
    const { data: fetchedCustomer, isLoading: fetchLoading } = useQuery({
        queryKey: ['customers', 'detail', customerId],
        queryFn: () => getCustomerFn({ data: { id: customerId! } }),
        enabled: !!customerId && !providedCustomer,
    });

    // Use provided customer or fetched customer
    const customer = providedCustomer || fetchedCustomer;
    const isLoading = providedLoading || fetchLoading;

    // Calculate size preferences from orders - MUST be before any early return
    const sizePreferences = useMemo(() => {
        if (!customer?.orders) return [];
        const sizeCounts: Record<string, number> = {};
        customer.orders.forEach((order: Order) => {
            order.orderLines?.forEach((line: OrderLine) => {
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

    // Don't render if no customerId and no customer (closed state)
    if (!customerId && !providedCustomer) {
        return null;
    }

    const toggleOrder = (orderId: string) => {
        setExpandedOrders(prev => {
            const next = new Set(prev);
            if (next.has(orderId)) {
                next.delete(orderId);
            } else {
                next.add(orderId);
            }
            return next;
        });
    };

    // Calculated metrics
    const healthScore = calculateHealthScore(customer);
    const tenure = calculateTenure(customer?.firstOrderDate);
    const tierProgress = calculateTierProgress(
        customer?.lifetimeValue || 0,
        customer?.customerTier || 'bronze'
    );
    const daysSinceOrder = getDaysSinceLastOrder(customer?.lastOrderDate);

    // Calculate AVG order value properly (fallback if API returns 0)
    const avgOrderValue = customer?.avgOrderValue ||
        (customer?.totalOrders > 0 ? Math.round(customer.lifetimeValue / customer.totalOrders) : 0);

    // Calculate order frequency (orders per month)
    const orderFrequency = calculateOrderFrequency(customer?.totalOrders || 0, customer?.firstOrderDate);

    // Risk indicators
    const risks: Array<{ type: string; message: string; severity: 'high' | 'medium' | 'low' }> = [];

    if (daysSinceOrder !== null && daysSinceOrder > 90) {
        risks.push({
            type: 'Inactive Customer',
            message: `No orders in ${daysSinceOrder} days`,
            severity: daysSinceOrder > 180 ? 'high' : 'medium'
        });
    }

    if ((customer?.returnRate || 0) > 25) {
        risks.push({
            type: 'High Return Rate',
            message: `${customer.returnRate.toFixed(1)}% return rate`,
            severity: customer.returnRate > 40 ? 'high' : 'medium'
        });
    }

    if ((customer?.rtoCount || 0) > 2) {
        risks.push({
            type: 'Multiple RTOs',
            message: `${customer.rtoCount} RTO incidents`,
            severity: customer.rtoCount > 5 ? 'high' : 'medium'
        });
    }

    // Calculate total colors for percentage
    const totalColorQty = customer?.colorAffinity?.reduce((sum: number, c: any) => sum + c.qty, 0) || 1;

    // Tier config for avatar
    const tierConfig = TIER_CONFIG[customer?.customerTier?.toLowerCase() as keyof typeof TIER_CONFIG] || TIER_CONFIG.bronze;

    return (
        <div
            className="fixed inset-0 bg-slate-900/60 backdrop-blur-sm flex items-center justify-center z-50 p-2 sm:p-4"
            onClick={(e) => e.target === e.currentTarget && onClose()}
        >
            <div className="bg-white rounded-2xl shadow-2xl w-full max-w-5xl max-h-[95vh] sm:max-h-[90vh] overflow-hidden flex flex-col">
                {/* Header */}
                <div className="flex items-center justify-between px-4 sm:px-6 py-3 sm:py-4 border-b border-slate-100 bg-gradient-to-r from-slate-50 to-white">
                    <h2 className="text-base sm:text-lg font-bold text-slate-900 tracking-tight">Customer Profile</h2>
                    <button
                        onClick={onClose}
                        className="p-2 hover:bg-slate-100 rounded-lg transition-colors"
                    >
                        <X size={20} className="text-slate-500" />
                    </button>
                </div>

                {isLoading ? (
                    <div className="flex items-center justify-center p-16">
                        <div className="flex flex-col items-center gap-3">
                            <div className="animate-spin rounded-full h-10 w-10 border-2 border-slate-200 border-t-sky-500" />
                            <span className="text-sm text-slate-500">Loading profile...</span>
                        </div>
                    </div>
                ) : customer ? (
                    <div className="flex flex-col md:flex-row flex-1 overflow-hidden">
                        {/* Left Panel - Identity */}
                        <div className="w-full md:w-72 flex-shrink-0 bg-gradient-to-br from-slate-50 via-white to-slate-50 md:border-r border-b md:border-b-0 border-slate-100 p-4 sm:p-6 flex flex-col">
                            {/* Avatar */}
                            <div className="flex flex-col items-center mb-6">
                                <div className="relative">
                                    <div
                                        className={`
                                            w-20 h-20 rounded-full flex items-center justify-center
                                            ${tierConfig.avatarBg}
                                            text-white text-2xl font-bold
                                            shadow-lg avatar-pulse
                                        `}
                                    >
                                        {getInitials(customer.firstName, customer.lastName)}
                                    </div>
                                    <div className={`absolute -bottom-1 -right-1 w-6 h-6 rounded-full bg-white shadow-md flex items-center justify-center border-2 ${tierConfig.border}`}>
                                        <tierConfig.icon size={12} className="text-slate-600" />
                                    </div>
                                </div>

                                {/* Name */}
                                <h3 className="mt-4 text-xl font-bold text-slate-900 text-center tracking-tight" style={{ letterSpacing: '-0.02em' }}>
                                    {customer.firstName} {customer.lastName}
                                </h3>

                                {/* Tier Badge */}
                                <div className="mt-2">
                                    <TierBadge tier={customer.customerTier} />
                                </div>
                            </div>

                            {/* Contact Actions */}
                            <div className="flex justify-center gap-2 mb-6">
                                <a
                                    href={`mailto:${customer.email}`}
                                    className="p-2.5 rounded-lg bg-white border border-slate-200 hover:border-sky-300 hover:bg-sky-50 transition-colors group"
                                    title={customer.email}
                                >
                                    <Mail size={18} className="text-slate-400 group-hover:text-sky-600" />
                                </a>
                                {customer.phone && (
                                    <>
                                        <a
                                            href={`tel:${customer.phone}`}
                                            className="p-2.5 rounded-lg bg-white border border-slate-200 hover:border-sky-300 hover:bg-sky-50 transition-colors group"
                                            title={customer.phone}
                                        >
                                            <Phone size={18} className="text-slate-400 group-hover:text-sky-600" />
                                        </a>
                                        <a
                                            href={`https://wa.me/${customer.phone.replace(/\D/g, '')}`}
                                            target="_blank"
                                            rel="noopener noreferrer"
                                            className="p-2.5 rounded-lg bg-white border border-slate-200 hover:border-green-300 hover:bg-green-50 transition-colors group"
                                            title="WhatsApp"
                                        >
                                            <MessageCircle size={18} className="text-slate-400 group-hover:text-green-600" />
                                        </a>
                                    </>
                                )}
                            </div>

                            {/* Contact Info - Clickable Links */}
                            <div className="space-y-2 mb-6">
                                <a
                                    href={`mailto:${customer.email}`}
                                    className="flex items-center gap-2 text-sm text-slate-700 hover:text-blue-600 transition-colors"
                                >
                                    <Mail size={14} className="text-slate-400 flex-shrink-0" />
                                    <span className="truncate">{customer.email}</span>
                                </a>
                                {customer.phone && (
                                    <a
                                        href={`tel:${customer.phone}`}
                                        className="flex items-center gap-2 text-sm text-slate-700 hover:text-blue-600 transition-colors"
                                    >
                                        <Phone size={14} className="text-slate-400 flex-shrink-0" />
                                        <span>{customer.phone}</span>
                                    </a>
                                )}
                                {customer.defaultAddress && formatAddress(customer.defaultAddress) && (
                                    <div className="flex items-start gap-2 text-sm text-slate-600 pt-1">
                                        <MapPin size={14} className="mt-0.5 text-slate-400 flex-shrink-0" />
                                        <span className="text-slate-500 leading-relaxed">{formatAddress(customer.defaultAddress)}</span>
                                    </div>
                                )}
                            </div>

                            {/* Quick Stats Grid */}
                            <div className="grid grid-cols-2 gap-2 mb-4">
                                <div className="bg-white rounded-lg p-3 border border-slate-100 text-center">
                                    <div className="text-sm font-bold text-slate-900">{tenure}</div>
                                    <div className="text-[9px] uppercase tracking-wider text-slate-500">Member</div>
                                </div>
                                <div className="bg-white rounded-lg p-3 border border-slate-100 text-center">
                                    <div className="text-sm font-bold text-slate-900">
                                        {orderFrequency > 0 ? `${orderFrequency.toFixed(1)}/mo` : '-'}
                                    </div>
                                    <div className="text-[9px] uppercase tracking-wider text-slate-500">Frequency</div>
                                </div>
                                <div className="bg-white rounded-lg p-3 border border-slate-100 text-center">
                                    <div className="text-sm font-bold text-slate-900">
                                        {customer.lastOrderDate ? getRelativeTime(customer.lastOrderDate) : 'Never'}
                                    </div>
                                    <div className="text-[9px] uppercase tracking-wider text-slate-500">Last Order</div>
                                </div>
                                <div className="bg-white rounded-lg p-3 border border-slate-100 text-center">
                                    <div className="text-sm font-bold text-slate-900">
                                        {customer.exchangeCount || 0}
                                    </div>
                                    <div className="text-[9px] uppercase tracking-wider text-slate-500">Exchanges</div>
                                </div>
                            </div>

                            {/* Marketing Status */}
                            <div className="flex items-center gap-2 text-xs text-slate-500">
                                <Heart size={12} className={customer.acceptsMarketing ? 'text-pink-500 fill-pink-500' : 'text-slate-300'} />
                                <span>{customer.acceptsMarketing ? 'Subscribed to marketing' : 'Not subscribed'}</span>
                            </div>

                            {/* Tags */}
                            {customer.tags && (
                                <div className="mt-4">
                                    <div className="text-[10px] uppercase tracking-wider text-slate-500 mb-2">Tags</div>
                                    <div className="flex flex-wrap gap-1">
                                        {(Array.isArray(customer.tags) ? customer.tags : customer.tags.split(',')).map((tag: string, i: number) => (
                                            <span key={i} className="px-2 py-0.5 bg-slate-100 text-slate-600 rounded text-[10px]">
                                                {tag.trim()}
                                            </span>
                                        ))}
                                    </div>
                                </div>
                            )}

                            {/* Spacer */}
                            <div className="flex-1" />

                            {/* Tier Progress */}
                            <div className="pt-4 border-t border-slate-100">
                                <TierProgressBar
                                    progress={tierProgress.progress}
                                    nextTier={tierProgress.nextTier}
                                    amountToNext={tierProgress.amountToNext}
                                    shouldUpgrade={tierProgress.shouldUpgrade}
                                />
                            </div>
                        </div>

                        {/* Right Panel - Details */}
                        <div className="flex-1 overflow-y-auto bg-slate-50/50">
                            <div className="p-4 sm:p-6 space-y-4 sm:space-y-6">
                                {/* Health Score + LTV Section */}
                                <div className="flex flex-col sm:flex-row gap-4 sm:gap-6">
                                    {/* Health Score */}
                                    <div className="bg-white rounded-xl p-4 sm:p-5 border border-slate-100 shadow-sm flex justify-center sm:block">
                                        <HealthScoreGauge score={healthScore} />
                                    </div>

                                    {/* LTV Hero */}
                                    <div className="flex-1 bg-gradient-to-br from-sky-500 to-sky-600 rounded-xl p-4 sm:p-5 text-white relative overflow-hidden">
                                        {/* Subtle pattern overlay */}
                                        <div className="absolute inset-0 opacity-10" style={{
                                            backgroundImage: 'radial-gradient(circle at 2px 2px, white 1px, transparent 0)',
                                            backgroundSize: '24px 24px'
                                        }} />
                                        <div className="relative">
                                            <div className="text-xs uppercase tracking-wider text-sky-100 mb-1">Lifetime Value</div>
                                            <div className="text-2xl sm:text-4xl font-bold tabular-nums">
                                                ₹{Number(customer.lifetimeValue || 0).toLocaleString()}
                                            </div>
                                            <div className="mt-2 sm:mt-3 flex items-center gap-3 sm:gap-4 text-sky-100 text-xs sm:text-sm">
                                                <div>
                                                    <span className="font-semibold text-white">{customer.totalOrders || 0}</span> {pluralize(customer.totalOrders || 0, 'order')}
                                                </div>
                                                <div>
                                                    <span className="font-semibold text-white">₹{avgOrderValue.toLocaleString()}</span> avg
                                                </div>
                                            </div>
                                        </div>
                                    </div>
                                </div>

                                {/* Stats Grid */}
                                <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 sm:gap-4">
                                    <StatCard
                                        label="Total Orders"
                                        value={customer.totalOrders || 0}
                                        icon={ShoppingBag}
                                        color="sky"
                                    />
                                    <StatCard
                                        label="Return Rate"
                                        value={`${(customer.returnRate || 0).toFixed(1)}%`}
                                        icon={RotateCcw}
                                        color={(customer.returnRate || 0) > 20 ? 'red' : 'slate'}
                                    />
                                    <StatCard
                                        label="Returns"
                                        value={customer.returnRequests?.length || customer.returnCount || 0}
                                        icon={Package}
                                        color="amber"
                                    />
                                    <StatCard
                                        label="RTOs"
                                        value={customer.rtoCount || 0}
                                        icon={Truck}
                                        color={(customer.rtoCount || 0) > 2 ? 'red' : 'slate'}
                                    />
                                </div>

                                {/* Risk Alerts */}
                                {risks.length > 0 && (
                                    <div className="space-y-2">
                                        <h4 className="text-xs font-semibold uppercase tracking-wider text-slate-500 flex items-center gap-2">
                                            <AlertTriangle size={14} />
                                            Risk Indicators
                                        </h4>
                                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                                            {risks.map((risk, i) => (
                                                <RiskAlert key={i} {...risk} />
                                            ))}
                                        </div>
                                    </div>
                                )}

                                {/* Style DNA */}
                                <div className="bg-white rounded-xl border border-slate-100 overflow-hidden">
                                    <div className="px-5 py-3 bg-gradient-to-r from-slate-50 to-white border-b border-slate-100">
                                        <h4 className="text-xs font-semibold uppercase tracking-wider text-slate-600 flex items-center gap-2">
                                            <Palette size={14} />
                                            Style DNA
                                        </h4>
                                    </div>

                                    <div className="p-5 space-y-5">
                                        {/* Color Palette */}
                                        {customer.colorAffinity?.length > 0 && (
                                            <div>
                                                <div className="text-[10px] uppercase tracking-wider text-slate-500 mb-3">Color Palette</div>
                                                <div className="flex gap-4 overflow-x-auto pb-2">
                                                    {customer.colorAffinity.slice(0, 8).map((c: any, i: number) => (
                                                        <ColorSwatch
                                                            key={i}
                                                            color={c.color}
                                                            qty={c.qty}
                                                            total={totalColorQty}
                                                            hex={c.hex}
                                                        />
                                                    ))}
                                                </div>
                                            </div>
                                        )}

                                        {/* Products */}
                                        {customer.productAffinity?.length > 0 && (
                                            <div>
                                                <div className="text-[10px] uppercase tracking-wider text-slate-500 mb-3 flex items-center gap-2">
                                                    <Package size={12} />
                                                    Top Products
                                                </div>
                                                <div className="flex flex-wrap gap-2">
                                                    {customer.productAffinity.map((p: any, i: number) => (
                                                        <span
                                                            key={i}
                                                            className="px-3 py-1.5 bg-slate-100 hover:bg-slate-200 rounded-lg text-sm transition-colors"
                                                        >
                                                            {p.productName}
                                                            <span className="ml-1.5 text-slate-500">({p.qty})</span>
                                                        </span>
                                                    ))}
                                                </div>
                                            </div>
                                        )}

                                        {/* Fabrics */}
                                        {customer.fabricAffinity?.length > 0 && (
                                            <div>
                                                <div className="text-[10px] uppercase tracking-wider text-slate-500 mb-3 flex items-center gap-2">
                                                    <Layers size={12} />
                                                    Fabric Preferences
                                                </div>
                                                <div className="flex flex-wrap gap-2">
                                                    {customer.fabricAffinity.map((f: any, i: number) => (
                                                        <span
                                                            key={i}
                                                            className="px-3 py-1.5 bg-amber-50 text-amber-800 hover:bg-amber-100 rounded-lg text-sm transition-colors"
                                                        >
                                                            {f.fabricType}
                                                            <span className="ml-1.5 text-amber-500">({f.qty})</span>
                                                        </span>
                                                    ))}
                                                </div>
                                            </div>
                                        )}

                                        {/* Size Preferences */}
                                        {sizePreferences.length > 0 && (
                                            <div>
                                                <div className="text-[10px] uppercase tracking-wider text-slate-500 mb-3">
                                                    Size Preferences
                                                </div>
                                                <div className="flex flex-wrap gap-2">
                                                    {sizePreferences.map(({ size, count }) => (
                                                        <span
                                                            key={size}
                                                            className="px-3 py-1.5 bg-sky-50 text-sky-800 hover:bg-sky-100 rounded-lg text-sm font-medium transition-colors"
                                                        >
                                                            {size}
                                                            <span className="ml-1.5 text-sky-500 font-normal">({count})</span>
                                                        </span>
                                                    ))}
                                                </div>
                                            </div>
                                        )}
                                    </div>
                                </div>

                                {/* Order History */}
                                {customer.orders?.length > 0 && (
                                    <div className="bg-white rounded-xl border border-slate-100 overflow-hidden">
                                        <div className="px-5 py-3 bg-gradient-to-r from-slate-50 to-white border-b border-slate-100 flex items-center justify-between">
                                            <h4 className="text-xs font-semibold uppercase tracking-wider text-slate-600 flex items-center gap-2">
                                                <ShoppingBag size={14} />
                                                Order History
                                            </h4>
                                            <span className="text-xs text-slate-400">
                                                {customer.orders.length} {pluralize(customer.orders.length, 'order')}
                                            </span>
                                        </div>

                                        <div className="p-4 space-y-2">
                                            {customer.orders.slice(0, 5).map((order: Order) => (
                                                <OrderCard
                                                    key={order.id}
                                                    order={order}
                                                    isExpanded={expandedOrders.has(order.id)}
                                                    onToggle={() => toggleOrder(order.id)}
                                                />
                                            ))}

                                            {customer.orders.length > 5 && (
                                                <div className="text-center pt-2">
                                                    <span className="text-sm text-slate-500">
                                                        +{customer.orders.length - 5} more orders
                                                    </span>
                                                </div>
                                            )}
                                        </div>
                                    </div>
                                )}
                            </div>
                        </div>
                    </div>
                ) : (
                    <div className="flex flex-col items-center justify-center p-16">
                        <div className="w-16 h-16 rounded-full bg-slate-100 flex items-center justify-center mb-4">
                            <AlertCircle size={32} className="text-slate-400" />
                        </div>
                        <p className="text-slate-600 font-medium">Customer not found</p>
                        <p className="text-sm text-slate-400 mt-1">Unable to load customer data</p>
                    </div>
                )}
            </div>
        </div>
    );
}

export default CustomerDetailModal;
