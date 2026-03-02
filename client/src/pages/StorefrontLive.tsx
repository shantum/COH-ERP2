/**
 * Storefront Live — Real-Time D2C Analytics Dashboard
 *
 * First-party, unsampled storefront analytics from our Shopify Web Pixel.
 * Light theme matching the rest of the app. Near-real-time polling for live feed + on-site-now.
 */

import React, { useState, lazy, Suspense } from 'react';
import {
    Eye, ShoppingCart, CreditCard, Search, ArrowRight,
    Smartphone, Monitor, Tablet, TrendingUp, TrendingDown, Activity,
    ChevronDown, ChevronRight, Map, List,
    Globe, Shield, Wifi,
} from 'lucide-react';

const GeoMap = lazy(() => import('../components/GeoMap').then(m => ({ default: m.GeoMap })));
import {
    useHeroMetrics, useOnSiteNow, useProductFunnel, useProductVariants, useLiveFeed,
    useTrafficSources, useCampaignAttribution, useGeoBreakdown,
    useTopPages, useTopSearches, useDeviceBreakdown,
    useVisitorList, useVisitorDetail, useClickIdBreakdown,
} from '../hooks/useStorefrontAnalytics';
import { formatCurrency } from '../utils/formatting';
import type {
    LiveFeedEvent, ProductFunnelRow, ProductVariantRow, TrafficSourceRow,
    CampaignAttributionRow, GeoBreakdownRow, TopPageRow,
    TopSearchRow, DeviceBreakdownRow,
    VisitorDetail,
} from '../server/functions/storefrontAnalytics';

// ============================================
// TYPES & CONSTANTS
// ============================================

type Tab = 'overview' | 'products' | 'acquisition' | 'geography' | 'visitors';
type DayRange = 1 | 7 | 30 | 90;

const TABS: { key: Tab; label: string }[] = [
    { key: 'overview', label: 'Overview' },
    { key: 'products', label: 'Products' },
    { key: 'acquisition', label: 'Acquisition' },
    { key: 'geography', label: 'Geography' },
    { key: 'visitors', label: 'Visitors' },
];

const DAY_OPTIONS: { value: DayRange; label: string }[] = [
    { value: 1, label: 'Today' },
    { value: 7, label: '7d' },
    { value: 30, label: '30d' },
    { value: 90, label: '90d' },
];

const GREEN = '#22c55e';
const AMBER = '#f59e0b';
const PURPLE = '#a855f7';
const BLUE = '#3b82f6';

const FUNNEL_COLORS = ['#292524', '#57534e', '#a8a29e', '#d6d3d1'];

// ============================================
// HELPERS
// ============================================

function formatNum(value: number): string {
    return value.toLocaleString('en-IN');
}

function formatPct(value: number): string {
    return `${value.toFixed(1)}%`;
}

function calcDelta(current: number, previous: number): { value: string; positive: boolean } | null {
    if (previous === 0) return current > 0 ? { value: '+100%', positive: true } : null;
    const pct = ((current - previous) / previous) * 100;
    return {
        value: `${pct >= 0 ? '+' : ''}${pct.toFixed(1)}%`,
        positive: pct >= 0,
    };
}

function timeAgo(date: Date | string): string {
    const now = Date.now();
    const then = typeof date === 'string' ? new Date(date).getTime() : date.getTime();
    const seconds = Math.floor((now - then) / 1000);
    if (seconds < 60) return `${seconds}s ago`;
    const minutes = Math.floor(seconds / 60);
    if (minutes < 60) return `${minutes}m ago`;
    const hours = Math.floor(minutes / 60);
    if (hours < 24) return `${hours}h ago`;
    return `${Math.floor(hours / 24)}d ago`;
}

function truncateUrl(url: string): string {
    try {
        const parsed = new URL(url);
        const path = parsed.pathname;
        return path.length > 40 ? path.slice(0, 40) + '...' : path;
    } catch {
        return url.length > 40 ? url.slice(0, 40) + '...' : url;
    }
}

function eventIcon(eventName: string) {
    switch (eventName) {
        case 'page_viewed': return <Eye size={14} className="text-stone-400" />;
        case 'product_viewed': return <Eye size={14} className="text-blue-500" />;
        case 'product_added_to_cart': return <ShoppingCart size={14} className="text-amber-500" />;
        case 'checkout_started': return <CreditCard size={14} className="text-orange-500" />;
        case 'checkout_completed': return <CreditCard size={14} className="text-green-600" />;
        case 'search_submitted': return <Search size={14} className="text-purple-500" />;
        default: return <Activity size={14} className="text-stone-400" />;
    }
}

function eventLabel(eventName: string): string {
    switch (eventName) {
        case 'page_viewed': return 'Viewed page';
        case 'product_viewed': return 'Viewed product';
        case 'product_added_to_cart': return 'Added to cart';
        case 'checkout_started': return 'Started checkout';
        case 'checkout_completed': return 'Completed purchase';
        case 'search_submitted': return 'Searched';
        case 'payment_info_submitted': return 'Submitted payment';
        case 'product_removed_from_cart': return 'Removed from cart';
        default: return eventName.replace(/_/g, ' ');
    }
}

function sourceColor(source: string): string {
    const s = source.toLowerCase();
    if (s.includes('facebook') || s.includes('instagram') || s === 'meta') return PURPLE;
    if (s.includes('google')) return BLUE;
    if (s === 'direct') return '#78716c';
    if (s.includes('email')) return GREEN;
    return AMBER;
}

// ============================================
// SKELETONS
// ============================================

function Skeleton({ className = '' }: { className?: string }) {
    return <div className={`animate-pulse bg-stone-200 rounded ${className}`} />;
}

function KPISkeleton() {
    return (
        <div className="grid grid-cols-2 lg:grid-cols-3 xl:grid-cols-6 gap-4">
            {Array.from({ length: 6 }).map((_, i) => (
                <div key={i} className="bg-white rounded-lg border border-stone-200 shadow-sm p-4 sm:p-6">
                    <Skeleton className="h-3 w-16 mb-3" />
                    <Skeleton className="h-7 w-24" />
                </div>
            ))}
        </div>
    );
}

function SectionSkeleton() {
    return (
        <div className="bg-white rounded-lg border border-stone-200 shadow-sm p-4 sm:p-6">
            <Skeleton className="h-4 w-40 mb-4" />
            <Skeleton className="h-48 w-full" />
        </div>
    );
}

// ============================================
// KPI CARD
// ============================================

function KPICard({ label, value, delta: d, pulse }: {
    label: string;
    value: string;
    delta?: { value: string; positive: boolean } | null;
    pulse?: boolean;
}) {
    return (
        <div className="bg-white rounded-lg border border-stone-200 shadow-sm p-4 sm:p-6">
            <div className="flex items-center gap-2">
                {pulse && <span className="relative flex h-2 w-2">
                    <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-green-400 opacity-75" />
                    <span className="relative inline-flex rounded-full h-2 w-2 bg-green-500" />
                </span>}
                <p className="text-xs font-medium text-stone-500 uppercase tracking-wide">{label}</p>
            </div>
            <p className="text-2xl font-semibold text-stone-900 mt-1">{value}</p>
            {d && (
                <p className={`text-xs mt-1 font-medium ${d.positive ? 'text-green-600' : 'text-red-500'}`}>
                    {d.positive ? <TrendingUp size={12} className="inline mr-1" /> : <TrendingDown size={12} className="inline mr-1" />}
                    {d.value} vs prev period
                </p>
            )}
        </div>
    );
}

// ============================================
// OVERVIEW TAB
// ============================================

function OverviewTab({ days }: { days: number }) {
    const hero = useHeroMetrics(days);
    const onSite = useOnSiteNow();
    const feed = useLiveFeed();

    if (hero.isLoading) {
        return (
            <div className="space-y-6">
                <KPISkeleton />
                <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                    <SectionSkeleton />
                    <SectionSkeleton />
                </div>
            </div>
        );
    }

    const h = hero.data;
    const os = onSite.data;

    return (
        <div className="space-y-6">
            {/* Hero Metrics */}
            <div className="grid grid-cols-2 lg:grid-cols-3 xl:grid-cols-6 gap-4">
                <KPICard
                    label="On Site Now"
                    value={os ? formatNum(os.total) : '...'}
                    pulse
                />
                <KPICard
                    label="Visitors"
                    value={h ? formatNum(h.visitors) : '-'}
                    delta={h ? calcDelta(h.visitors, h.prevVisitors) : null}
                />
                <KPICard
                    label="Page Views"
                    value={h ? formatNum(h.pageViews) : '-'}
                    delta={h ? calcDelta(h.pageViews, h.prevPageViews) : null}
                />
                <KPICard
                    label="Add to Carts"
                    value={h ? formatNum(h.addToCarts) : '-'}
                    delta={h ? calcDelta(h.addToCarts, h.prevAddToCarts) : null}
                />
                <KPICard
                    label="Checkouts"
                    value={h ? formatNum(h.checkouts) : '-'}
                    delta={h ? calcDelta(h.checkouts, h.prevCheckouts) : null}
                />
                <KPICard
                    label="Revenue"
                    value={h ? formatCurrency(h.revenue) : '-'}
                    delta={h ? calcDelta(h.revenue, h.prevRevenue) : null}
                />
            </div>

            {/* On-site device split */}
            {os && os.total > 0 && (
                <div className="flex gap-4 text-xs text-stone-500">
                    <span className="flex items-center gap-1"><Smartphone size={12} /> {os.mobile} mobile</span>
                    <span className="flex items-center gap-1"><Monitor size={12} /> {os.desktop} desktop</span>
                    <span className="flex items-center gap-1"><Tablet size={12} /> {os.tablet} tablet</span>
                </div>
            )}

            {/* Two-column: funnel + live feed */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                <ConversionFunnel data={h} />
                <LiveFeed events={feed.data ?? []} isLoading={feed.isLoading} />
            </div>
        </div>
    );
}

// ============================================
// CONVERSION FUNNEL
// ============================================

function ConversionFunnel({ data }: { data?: { sessions: number; productViews: number; addToCarts: number; checkouts: number; purchases: number } }) {
    if (!data) return <SectionSkeleton />;

    const steps = [
        { name: 'Sessions', value: data.sessions, color: FUNNEL_COLORS[0] },
        { name: 'Product Views', value: data.productViews, color: FUNNEL_COLORS[1] },
        { name: 'Add to Cart', value: data.addToCarts, color: FUNNEL_COLORS[2] },
        { name: 'Checkout', value: data.checkouts, color: FUNNEL_COLORS[3] },
        { name: 'Purchase', value: data.purchases, color: '#22c55e' },
    ];

    const maxVal = steps[0].value || 1;

    return (
        <div className="bg-white rounded-lg border border-stone-200 shadow-sm p-4 sm:p-6">
            <h3 className="text-sm font-medium text-stone-700 mb-4">Conversion Funnel</h3>
            <div className="space-y-3">
                {steps.map((step, i) => {
                    const widthPct = step.value === 0 ? 0 : Math.min(Math.max((step.value / maxVal) * 100, 4), 100);
                    const dropOff = i > 0 && steps[i - 1].value > 0 && step.value < steps[i - 1].value
                        ? ((steps[i - 1].value - step.value) / steps[i - 1].value * 100).toFixed(1)
                        : null;
                    return (
                        <div key={step.name}>
                            <div className="flex items-center justify-between mb-1">
                                <span className="text-sm text-stone-600">{step.name}</span>
                                <span className="text-sm font-medium text-stone-900">
                                    {formatNum(step.value)}
                                    {i > 0 && steps[0].value > 0 && (
                                        <span className="text-xs text-stone-400 ml-2">
                                            ({((step.value / steps[0].value) * 100).toFixed(1)}% of sessions)
                                        </span>
                                    )}
                                </span>
                            </div>
                            <div className="w-full bg-stone-100 rounded-full h-6">
                                <div
                                    className="h-6 rounded-full transition-all"
                                    style={{ width: `${widthPct}%`, backgroundColor: step.color }}
                                />
                            </div>
                            {dropOff && (
                                <div className="flex items-center gap-1 mt-1 ml-2">
                                    <ArrowRight size={10} className="text-stone-400" />
                                    <span className="text-xs text-red-400">{dropOff}% drop-off</span>
                                </div>
                            )}
                        </div>
                    );
                })}
            </div>
        </div>
    );
}

// ============================================
// LIVE FEED
// ============================================

function LiveFeed({ events, isLoading }: { events: LiveFeedEvent[]; isLoading: boolean }) {
    if (isLoading) return <SectionSkeleton />;

    return (
        <div className="bg-white rounded-lg border border-stone-200 shadow-sm p-4 sm:p-6">
            <div className="flex items-center justify-between mb-4">
                <h3 className="text-sm font-medium text-stone-700">Live Activity</h3>
                <span className="relative flex h-2 w-2">
                    <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-green-400 opacity-75" />
                    <span className="relative inline-flex rounded-full h-2 w-2 bg-green-500" />
                </span>
            </div>
            <div className="space-y-0 max-h-[400px] overflow-y-auto">
                {events.length === 0 && (
                    <p className="text-sm text-stone-400">No events yet</p>
                )}
                {events.map((e) => {
                    const hasProduct = !!e.productTitle;
                    const hasCollection = !!e.collectionTitle && !hasProduct;
                    const location = [e.city, e.region].filter(Boolean).join(', ') || e.country;
                    const variantParts = e.variantTitle?.split(' / ') ?? [];
                    const variantColor = variantParts[0];
                    const variantSize = variantParts[1];

                    return (
                        <div key={e.id} className="flex items-start gap-3 py-2.5 border-b border-stone-100 last:border-0">
                            {/* Thumbnail or icon */}
                            {hasProduct && e.imageUrl ? (
                                <img
                                    src={e.imageUrl}
                                    alt={e.productTitle ?? ''}
                                    className="w-8 h-10 rounded object-cover flex-shrink-0 mt-0.5"
                                />
                            ) : (
                                <div className="w-8 h-10 rounded bg-stone-100 flex items-center justify-center flex-shrink-0 mt-0.5">
                                    {eventIcon(e.eventName)}
                                </div>
                            )}

                            <div className="flex-1 min-w-0">
                                {/* Main line — event + product/collection */}
                                <p className="text-sm text-stone-800 leading-snug">
                                    <span className="font-medium">{eventLabel(e.eventName)}</span>
                                    {hasProduct && (
                                        <span className="text-stone-600"> — {e.productTitle}</span>
                                    )}
                                    {hasCollection && (
                                        <span className="text-stone-600"> — {e.collectionTitle}</span>
                                    )}
                                    {!hasProduct && !hasCollection && e.pageUrl && (
                                        <span className="text-stone-500"> — {truncateUrl(e.pageUrl)}</span>
                                    )}
                                    {e.searchQuery && (
                                        <span className="text-purple-600"> "{e.searchQuery}"</span>
                                    )}
                                </p>

                                {/* Variant info */}
                                {hasProduct && variantColor && (
                                    <div className="flex items-center gap-1.5 mt-0.5">
                                        <span className="text-[11px] text-stone-500">{variantColor}</span>
                                        {variantSize && (
                                            <span className="text-[10px] font-medium text-stone-400 bg-stone-100 px-1.5 py-0.5 rounded">
                                                {variantSize}
                                            </span>
                                        )}
                                    </div>
                                )}

                                {/* Page title for non-product events */}
                                {e.pageTitle && !hasProduct && !hasCollection && (
                                    <p className="text-[11px] text-stone-400 mt-0.5 truncate">{e.pageTitle}</p>
                                )}

                                {/* Meta line — location, device, source, value */}
                                <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 mt-1 text-[11px] text-stone-400">
                                    {location && <span>{location}</span>}
                                    {e.deviceType && (
                                        <span className="capitalize flex items-center gap-0.5">
                                            {e.browser && <span>{e.browser}</span>}
                                            {!e.browser && e.deviceType}
                                            {e.os && <span className="text-stone-300">/ {e.os}</span>}
                                        </span>
                                    )}
                                    {e.asOrganization && (
                                        <span className="flex items-center gap-0.5">
                                            <Wifi size={9} />
                                            {e.asOrganization.length > 20 ? e.asOrganization.slice(0, 20) + '...' : e.asOrganization}
                                        </span>
                                    )}
                                    {e.isVpn && (
                                        <span className="font-medium text-red-500 flex items-center gap-0.5">
                                            <Shield size={9} />VPN
                                        </span>
                                    )}
                                    {e.utmSource && (
                                        <span className="font-medium" style={{ color: sourceColor(e.utmSource) }}>
                                            {e.utmSource}
                                            {e.utmCampaign && (
                                                <span className="font-normal text-stone-400"> / {e.utmCampaign}</span>
                                            )}
                                        </span>
                                    )}
                                    {e.orderValue != null && e.orderValue > 0 && (
                                        <span className="text-green-600 font-semibold">{formatCurrency(e.orderValue)}</span>
                                    )}
                                    {e.cartValue != null && e.cartValue > 0 && e.eventName === 'product_added_to_cart' && (
                                        <span className="text-amber-600">Cart: {formatCurrency(e.cartValue)}</span>
                                    )}
                                    {/* Visitor / click IDs */}
                                    <span className="text-stone-300 font-mono">
                                        {e.visitorId.slice(0, 8)}
                                    </span>
                                    {e.fbclid && (
                                        <span className="font-medium text-purple-400">fb:{e.fbclid.slice(0, 12)}...</span>
                                    )}
                                    {e.gclid && (
                                        <span className="font-medium text-blue-400">g:{e.gclid.slice(0, 12)}...</span>
                                    )}
                                </div>
                            </div>

                            <span className="text-[11px] text-stone-400 whitespace-nowrap mt-0.5">{timeAgo(e.createdAt)}</span>
                        </div>
                    );
                })}
            </div>
        </div>
    );
}

// ============================================
// PRODUCTS TAB
// ============================================

interface ColorGroup {
    color: string;
    imageUrl: string | null;
    views: number;
    atcCount: number;
    purchases: number;
    revenue: number;
    sizes: ProductVariantRow[];
}

function groupByColor(rows: ProductVariantRow[]): ColorGroup[] {
    const map: Record<string, ColorGroup> = {};
    for (const r of rows) {
        let group = map[r.color];
        if (!group) {
            group = { color: r.color, imageUrl: r.imageUrl, views: 0, atcCount: 0, purchases: 0, revenue: 0, sizes: [] };
            map[r.color] = group;
        }
        group.views += r.views;
        group.atcCount += r.atcCount;
        group.purchases += r.purchases;
        group.revenue += r.revenue;
        group.sizes.push(r);
    }
    return Object.values(map).sort((a, b) => b.views - a.views);
}

function ProductVariantRows({ productTitle, gender, days }: { productTitle: string; gender: string | null; days: number }) {
    const variants = useProductVariants(productTitle, gender, days, true);
    const [expandedColors, setExpandedColors] = useState<Set<string>>(new Set());

    if (variants.isLoading) {
        return (
            <tr>
                <td colSpan={8} className="py-2 pl-16">
                    <div className="animate-pulse flex gap-4">
                        <div className="h-3 w-20 bg-stone-200 rounded" />
                        <div className="h-3 w-16 bg-stone-200 rounded" />
                    </div>
                </td>
            </tr>
        );
    }

    const rows = variants.data ?? [];
    if (rows.length === 0) return null;

    const colorGroups = groupByColor(rows);

    function toggleColor(color: string) {
        setExpandedColors(prev => {
            const next = new Set(prev);
            if (next.has(color)) next.delete(color);
            else next.add(color);
            return next;
        });
    }

    return (
        <>
            {colorGroups.map((cg) => {
                const isOpen = expandedColors.has(cg.color);
                const hasSizes = cg.sizes.length > 1 || (cg.sizes.length === 1 && cg.sizes[0].size !== '-');
                return (
                    <React.Fragment key={cg.color}>
                        {/* Color-level row */}
                        <tr
                            className={`bg-stone-50/60 border-b border-stone-100 ${hasSizes ? 'cursor-pointer hover:bg-stone-100/60' : ''}`}
                            onClick={hasSizes ? () => toggleColor(cg.color) : undefined}
                        >
                            <td className="py-2 pr-4 pl-14">
                                <div className="flex items-center gap-2">
                                    {hasSizes && (
                                        <span className="text-stone-400 flex-shrink-0">
                                            {isOpen ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
                                        </span>
                                    )}
                                    {cg.imageUrl ? (
                                        <img
                                            src={cg.imageUrl}
                                            alt={cg.color}
                                            className="w-7 h-9 rounded object-cover flex-shrink-0"
                                        />
                                    ) : (
                                        <div className="w-7 h-9 rounded bg-stone-200 flex-shrink-0" />
                                    )}
                                    <span className="text-xs font-medium text-stone-700">{cg.color}</span>
                                    {!hasSizes && cg.sizes[0]?.size !== '-' && (
                                        <span className="text-[10px] font-medium text-stone-400 bg-stone-200 px-1.5 py-0.5 rounded">
                                            {cg.sizes[0].size}
                                        </span>
                                    )}
                                </div>
                            </td>
                            <td className="text-right py-2 px-3 text-xs text-stone-600">{formatNum(cg.views)}</td>
                            <td className="text-right py-2 px-3 text-xs text-stone-400">
                                {cg.views > 0 ? formatPct(cg.atcCount / cg.views * 100) : '-'}
                            </td>
                            <td className="text-right py-2 px-3 text-xs text-amber-600">{formatNum(cg.atcCount)}</td>
                            <td className="text-right py-2 px-3 text-xs text-stone-400">
                                {cg.atcCount > 0 ? formatPct(cg.purchases / cg.atcCount * 100) : '-'}
                            </td>
                            <td className="text-right py-2 px-3 text-xs text-green-600">{formatNum(cg.purchases)}</td>
                            <td className="text-right py-2 px-3 text-xs text-stone-400">
                                {cg.views > 0 ? formatPct(cg.purchases / cg.views * 100) : '-'}
                            </td>
                            <td className="text-right py-2 pl-3 text-xs text-stone-600">{formatCurrency(cg.revenue)}</td>
                        </tr>
                        {/* Size-level rows */}
                        {isOpen && cg.sizes.map((s) => (
                            <tr key={`${cg.color}-${s.size}`} className="bg-stone-50/30 border-b border-stone-50">
                                <td className="py-1.5 pr-4 pl-24">
                                    <span className="text-[11px] font-medium text-stone-400 bg-stone-200/70 px-1.5 py-0.5 rounded">
                                        {s.size}
                                    </span>
                                </td>
                                <td className="text-right py-1.5 px-3 text-[11px] text-stone-500">{formatNum(s.views)}</td>
                                <td className="text-right py-1.5 px-3 text-[11px] text-stone-400">
                                    {s.views > 0 ? formatPct(s.atcCount / s.views * 100) : '-'}
                                </td>
                                <td className="text-right py-1.5 px-3 text-[11px] text-amber-500">{formatNum(s.atcCount)}</td>
                                <td className="text-right py-1.5 px-3 text-[11px] text-stone-400">
                                    {s.atcCount > 0 ? formatPct(s.purchases / s.atcCount * 100) : '-'}
                                </td>
                                <td className="text-right py-1.5 px-3 text-[11px] text-green-500">{formatNum(s.purchases)}</td>
                                <td className="text-right py-1.5 px-3 text-[11px] text-stone-400">
                                    {s.views > 0 ? formatPct(s.purchases / s.views * 100) : '-'}
                                </td>
                                <td className="text-right py-1.5 pl-3 text-[11px] text-stone-500">{formatCurrency(s.revenue)}</td>
                            </tr>
                        ))}
                    </React.Fragment>
                );
            })}
        </>
    );
}

function ProductsTab({ days }: { days: number }) {
    const funnel = useProductFunnel(days, 20);
    const [expanded, setExpanded] = useState<Set<string>>(new Set());

    if (funnel.isLoading) return <SectionSkeleton />;

    const rows = funnel.data ?? [];

    function productKey(p: ProductFunnelRow) {
        return `${p.productTitle}::${p.gender ?? ''}`;
    }

    function toggleExpand(key: string) {
        setExpanded(prev => {
            const next = new Set(prev);
            if (next.has(key)) next.delete(key);
            else next.add(key);
            return next;
        });
    }

    return (
        <div className="space-y-6">
            <div className="bg-white rounded-lg border border-stone-200 shadow-sm p-4 sm:p-6">
                <h3 className="text-sm font-medium text-stone-700 mb-4">Top Products — View → Cart → Purchase</h3>
                <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                        <thead>
                            <tr className="text-xs text-stone-500 uppercase tracking-wider border-b border-stone-200">
                                <th className="text-left py-3 pr-4">Product</th>
                                <th className="text-right py-3 px-3">Views</th>
                                <th className="text-right py-3 px-3">View→ATC</th>
                                <th className="text-right py-3 px-3">ATC</th>
                                <th className="text-right py-3 px-3">ATC→Buy</th>
                                <th className="text-right py-3 px-3">Purchased</th>
                                <th className="text-right py-3 px-3">Net Conv</th>
                                <th className="text-right py-3 pl-3">Revenue</th>
                            </tr>
                        </thead>
                        <tbody>
                            {rows.map((p: ProductFunnelRow) => {
                                const viewToAtc = p.views > 0 ? (p.atcCount / p.views * 100) : 0;
                                const atcToPurchase = p.atcCount > 0 ? (p.purchases / p.atcCount * 100) : 0;
                                const key = productKey(p);
                                const isExpanded = expanded.has(key);
                                const initial = (p.productTitle ?? '?')[0].toUpperCase();
                                return (
                                    <React.Fragment key={key}>
                                        <tr
                                            className="border-b border-stone-100 hover:bg-stone-50 cursor-pointer"
                                            onClick={() => toggleExpand(key)}
                                        >
                                            <td className="py-3 pr-4">
                                                <div className="flex items-center gap-3">
                                                    <button className="text-stone-400 flex-shrink-0">
                                                        {isExpanded
                                                            ? <ChevronDown size={14} />
                                                            : <ChevronRight size={14} />
                                                        }
                                                    </button>
                                                    {p.imageUrl ? (
                                                        <img
                                                            src={p.imageUrl}
                                                            alt={p.productTitle}
                                                            className="w-9 h-12 rounded object-cover flex-shrink-0"
                                                        />
                                                    ) : (
                                                        <div className="w-9 h-12 rounded bg-stone-200 flex items-center justify-center text-xs font-bold text-stone-500 flex-shrink-0">
                                                            {initial}
                                                        </div>
                                                    )}
                                                    <div className="min-w-0">
                                                        <span className="text-stone-900 truncate max-w-[240px] font-medium block">
                                                            {p.productTitle}
                                                        </span>
                                                        {p.gender && (
                                                            <span className="text-[10px] uppercase tracking-wider text-stone-400">
                                                                {p.gender}
                                                            </span>
                                                        )}
                                                    </div>
                                                </div>
                                            </td>
                                            <td className="text-right py-3 px-3 text-stone-900 font-medium">{formatNum(p.views)}</td>
                                            <td className="text-right py-3 px-3 text-stone-400">{formatPct(viewToAtc)}</td>
                                            <td className="text-right py-3 px-3 text-amber-600 font-medium">{formatNum(p.atcCount)}</td>
                                            <td className="text-right py-3 px-3 text-stone-400">{formatPct(atcToPurchase)}</td>
                                            <td className="text-right py-3 px-3 text-green-600 font-medium">{formatNum(p.purchases)}</td>
                                            <td className="text-right py-3 px-3 text-stone-500">{formatPct(p.netConversion)}</td>
                                            <td className="text-right py-3 pl-3 text-stone-900 font-medium">{formatCurrency(p.revenue)}</td>
                                        </tr>
                                        {isExpanded && (
                                            <ProductVariantRows productTitle={p.productTitle} gender={p.gender} days={days} />
                                        )}
                                    </React.Fragment>
                                );
                            })}
                            {rows.length === 0 && (
                                <tr><td colSpan={8} className="py-8 text-center text-stone-400">No product data yet</td></tr>
                            )}
                        </tbody>
                    </table>
                </div>
            </div>
        </div>
    );
}

// ============================================
// ACQUISITION TAB
// ============================================

const PLATFORM_COLORS: Record<string, string> = {
    facebook: '#a855f7',
    google: '#3b82f6',
    'google (app)': '#60a5fa',
    tiktok: '#06b6d4',
    microsoft: '#f97316',
};

function AcquisitionTab({ days }: { days: number }) {
    const sources = useTrafficSources(days);
    const campaigns = useCampaignAttribution(days);
    const clickIds = useClickIdBreakdown(days);

    if (sources.isLoading) return <SectionSkeleton />;

    const srcRows = sources.data ?? [];
    const totalSessions = srcRows.reduce((s: number, r: TrafficSourceRow) => s + r.sessions, 0);
    const clickIdRows = clickIds.data ?? [];

    return (
        <div className="space-y-6">
            {/* Traffic Sources */}
            <div className="bg-white rounded-lg border border-stone-200 shadow-sm p-4 sm:p-6">
                <h3 className="text-sm font-medium text-stone-700 mb-4">Traffic Sources</h3>
                <div className="space-y-3">
                    {srcRows.map((r: TrafficSourceRow) => {
                        const pct = totalSessions > 0 ? (r.sessions / totalSessions * 100) : 0;
                        return (
                            <div key={r.source}>
                                <div className="flex items-center justify-between mb-1">
                                    <span className="text-sm text-stone-700 capitalize">{r.source}</span>
                                    <span className="text-sm text-stone-500">
                                        {formatNum(r.sessions)} <span className="text-stone-400">({formatPct(pct)})</span>
                                    </span>
                                </div>
                                <div className="w-full bg-stone-100 rounded-full h-4">
                                    <div
                                        className="h-4 rounded-full transition-all"
                                        style={{
                                            width: `${Math.max(pct, 2)}%`,
                                            backgroundColor: sourceColor(r.source),
                                        }}
                                    />
                                </div>
                            </div>
                        );
                    })}
                    {srcRows.length === 0 && (
                        <p className="text-sm text-stone-400">No traffic data yet</p>
                    )}
                </div>
            </div>

            {/* Ad Platform Click IDs */}
            {clickIdRows.length > 0 && (
                <div className="bg-white rounded-lg border border-stone-200 shadow-sm p-4 sm:p-6">
                    <h3 className="text-sm font-medium text-stone-700 mb-4">Ad Platform Click IDs</h3>
                    <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
                        {clickIdRows.map(c => (
                            <div key={c.platform} className="rounded-lg border border-stone-100 p-3">
                                <div className="flex items-center gap-2 mb-2">
                                    <div className="w-2 h-2 rounded-full" style={{ backgroundColor: PLATFORM_COLORS[c.platform] ?? '#78716c' }} />
                                    <span className="text-xs font-medium text-stone-700 capitalize">{c.platform}</span>
                                </div>
                                <div className="text-lg font-semibold text-stone-900">{formatNum(c.sessions)}</div>
                                <div className="text-[11px] text-stone-400">sessions</div>
                                <div className="flex gap-3 mt-1.5 text-[11px]">
                                    <span className="text-amber-600">{c.atcCount} ATC</span>
                                    <span className="text-green-600">{c.orders} orders</span>
                                </div>
                                {c.revenue > 0 && (
                                    <div className="text-xs font-medium text-stone-700 mt-0.5">{formatCurrency(c.revenue)}</div>
                                )}
                            </div>
                        ))}
                    </div>
                </div>
            )}

            {/* Campaign Attribution */}
            <div className="bg-white rounded-lg border border-stone-200 shadow-sm p-4 sm:p-6">
                <h3 className="text-sm font-medium text-stone-700 mb-4">Campaign Attribution</h3>
                <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                        <thead>
                            <tr className="text-xs text-stone-500 uppercase tracking-wider border-b border-stone-200">
                                <th className="text-left py-3 pr-4">Campaign</th>
                                <th className="text-left py-3 px-3">Source</th>
                                <th className="text-right py-3 px-3">Clicks</th>
                                <th className="text-right py-3 px-3">ATC</th>
                                <th className="text-right py-3 px-3">Orders</th>
                                <th className="text-right py-3 px-3">Revenue</th>
                                <th className="text-right py-3 pl-3">Conv%</th>
                            </tr>
                        </thead>
                        <tbody>
                            {(campaigns.data ?? []).map((c: CampaignAttributionRow, i: number) => (
                                <tr key={`${c.utmCampaign}-${i}`} className="border-b border-stone-100 hover:bg-stone-50">
                                    <td className="py-3 pr-4 text-stone-900 truncate max-w-[200px]">{c.utmCampaign}</td>
                                    <td className="py-3 px-3">
                                        <span
                                            className="text-xs font-medium px-2 py-0.5 rounded-full"
                                            style={{
                                                color: sourceColor(c.utmSource),
                                                backgroundColor: sourceColor(c.utmSource) + '18',
                                            }}
                                        >
                                            {c.utmSource}
                                        </span>
                                    </td>
                                    <td className="text-right py-3 px-3 text-stone-700">{formatNum(c.clicks)}</td>
                                    <td className="text-right py-3 px-3 text-amber-600 font-medium">{formatNum(c.atcCount)}</td>
                                    <td className="text-right py-3 px-3 text-green-600 font-medium">{formatNum(c.orders)}</td>
                                    <td className="text-right py-3 px-3 text-stone-900 font-medium">{formatCurrency(c.revenue)}</td>
                                    <td className="text-right py-3 pl-3 text-stone-500">{formatPct(c.conversionRate)}</td>
                                </tr>
                            ))}
                            {(campaigns.data ?? []).length === 0 && (
                                <tr><td colSpan={7} className="py-8 text-center text-stone-400">No campaign data yet</td></tr>
                            )}
                        </tbody>
                    </table>
                </div>
            </div>
        </div>
    );
}

// ============================================
// GEOGRAPHY TAB
// ============================================

type GeoMetric = 'sessions' | 'atcCount' | 'orders';

function GeographyTab({ days }: { days: number }) {
    const geo = useGeoBreakdown(days, 50);
    const devices = useDeviceBreakdown(days);
    const pages = useTopPages(days, 15);
    const searches = useTopSearches(days, 15);
    const [geoView, setGeoView] = useState<'map' | 'table'>('map');
    const [metric, setMetric] = useState<GeoMetric>('sessions');

    if (geo.isLoading) return <SectionSkeleton />;

    const deviceRows = devices.data ?? [];
    const totalDeviceSessions = deviceRows.reduce((s: number, r: DeviceBreakdownRow) => s + r.sessions, 0);
    const geoRows = geo.data ?? [];

    return (
        <div className="space-y-6">
            {/* Device Breakdown */}
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                {deviceRows.map((d: DeviceBreakdownRow) => {
                    const pct = totalDeviceSessions > 0 ? (d.sessions / totalDeviceSessions * 100) : 0;
                    const Icon = d.deviceType === 'mobile' ? Smartphone : d.deviceType === 'desktop' ? Monitor : Tablet;
                    return (
                        <div key={d.deviceType} className="bg-white rounded-lg border border-stone-200 shadow-sm p-4 sm:p-6">
                            <div className="flex items-center gap-2 text-stone-500 mb-2">
                                <Icon size={16} />
                                <span className="text-xs uppercase tracking-wide font-medium">{d.deviceType}</span>
                            </div>
                            <p className="text-2xl font-semibold text-stone-900">{formatPct(pct)}</p>
                            <p className="text-xs text-stone-400 mt-1">{formatNum(d.sessions)} sessions</p>
                        </div>
                    );
                })}
            </div>

            {/* Geo Map / Table */}
            <div className="bg-white rounded-lg border border-stone-200 shadow-sm p-4 sm:p-6">
                <div className="flex items-center justify-between mb-4">
                    <h3 className="text-sm font-medium text-stone-700">Geography</h3>
                    <div className="flex gap-1 bg-stone-100 rounded-md p-0.5">
                        <button
                            onClick={() => setGeoView('map')}
                            className={`flex items-center gap-1.5 px-2.5 py-1 text-xs font-medium rounded transition-colors ${
                                geoView === 'map'
                                    ? 'bg-white text-stone-900 shadow-sm'
                                    : 'text-stone-500 hover:text-stone-700'
                            }`}
                        >
                            <Map size={12} />
                            Map
                        </button>
                        <button
                            onClick={() => setGeoView('table')}
                            className={`flex items-center gap-1.5 px-2.5 py-1 text-xs font-medium rounded transition-colors ${
                                geoView === 'table'
                                    ? 'bg-white text-stone-900 shadow-sm'
                                    : 'text-stone-500 hover:text-stone-700'
                            }`}
                        >
                            <List size={12} />
                            Table
                        </button>
                    </div>
                </div>

                {geoView === 'map' ? (
                    <div className="flex flex-col lg:flex-row gap-4">
                        {/* Map — takes most of the space */}
                        <div className="lg:flex-1 min-w-0">
                            <Suspense fallback={<div className="flex items-center justify-center py-16 text-sm text-stone-400">Loading map…</div>}>
                                <GeoMap data={geoRows} />
                            </Suspense>
                        </div>

                        {/* Sidebar — ranked regions */}
                        <div className="lg:w-72 flex-shrink-0">
                            {/* Metric selector */}
                            <div className="flex gap-1 bg-stone-100 rounded-md p-0.5 mb-3">
                                {([
                                    ['sessions', 'Sessions'],
                                    ['atcCount', 'ATC'],
                                    ['orders', 'Orders'],
                                ] as const).map(([key, label]) => (
                                    <button
                                        key={key}
                                        onClick={() => setMetric(key)}
                                        className={`flex-1 px-2 py-1 text-xs font-medium rounded transition-colors ${
                                            metric === key
                                                ? 'bg-white text-stone-900 shadow-sm'
                                                : 'text-stone-500 hover:text-stone-700'
                                        }`}
                                    >
                                        {label}
                                    </button>
                                ))}
                            </div>

                            {/* Ranked list */}
                            <div className="space-y-1 max-h-[380px] overflow-y-auto pr-1">
                                {[...geoRows]
                                    .sort((a, b) => b[metric] - a[metric])
                                    .filter(r => r[metric] > 0)
                                    .slice(0, 20)
                                    .map((r, i) => {
                                        const value = r[metric];
                                        const maxVal = Math.max(...geoRows.map(g => g[metric]), 1);
                                        const pct = (value / maxVal) * 100;
                                        const primaryLabel = r.city ?? r.region ?? r.country ?? 'Unknown';
                                        const secondaryLabel = r.city
                                            ? [r.region, r.country].filter(Boolean).join(', ')
                                            : (r.region && r.country ? r.country : null);
                                        const metricColor = metric === 'orders'
                                            ? 'bg-green-500'
                                            : metric === 'atcCount'
                                              ? 'bg-amber-500'
                                              : 'bg-stone-400';
                                        return (
                                            <div key={`${r.city}-${r.region}-${r.country}-${i}`} className="relative">
                                                <div
                                                    className={`absolute inset-y-0 left-0 ${metricColor} opacity-10 rounded`}
                                                    style={{ width: `${pct}%` }}
                                                />
                                                <div className="relative flex items-center justify-between px-2.5 py-2">
                                                    <div className="flex items-center gap-2 min-w-0">
                                                        <span className="text-[10px] font-mono text-stone-400 w-4 text-right flex-shrink-0">{i + 1}</span>
                                                        <span className="text-xs text-stone-800 truncate">{primaryLabel}</span>
                                                        {secondaryLabel && (
                                                            <span className="text-[10px] text-stone-400 flex-shrink-0 truncate max-w-[80px]">{secondaryLabel}</span>
                                                        )}
                                                    </div>
                                                    <span className={`text-xs font-semibold flex-shrink-0 ml-2 ${
                                                        metric === 'orders' ? 'text-green-600'
                                                            : metric === 'atcCount' ? 'text-amber-600'
                                                              : 'text-stone-700'
                                                    }`}>
                                                        {formatNum(value)}
                                                    </span>
                                                </div>
                                            </div>
                                        );
                                    })}
                                {geoRows.filter(r => r[metric] > 0).length === 0 && (
                                    <p className="text-xs text-stone-400 text-center py-4">No data</p>
                                )}
                            </div>
                        </div>
                    </div>
                ) : (
                    <div className="overflow-x-auto">
                        <table className="w-full text-sm">
                            <thead>
                                <tr className="text-xs text-stone-500 uppercase tracking-wider border-b border-stone-200">
                                    <th className="text-left py-3 pr-4">City</th>
                                    <th className="text-left py-3 px-3">Region</th>
                                    <th className="text-left py-3 px-3">Country</th>
                                    <th className="text-right py-3 px-3">Sessions</th>
                                    <th className="text-right py-3 px-3">Views</th>
                                    <th className="text-right py-3 px-3">ATC</th>
                                    <th className="text-right py-3 px-3">Orders</th>
                                    <th className="text-right py-3 pl-3">Revenue</th>
                                </tr>
                            </thead>
                            <tbody>
                                {geoRows.map((r: GeoBreakdownRow, i: number) => (
                                    <tr key={`${r.city}-${r.region}-${r.country}-${i}`} className="border-b border-stone-100 hover:bg-stone-50">
                                        <td className="py-3 pr-4 text-stone-900 font-medium">{r.city ?? '-'}</td>
                                        <td className="py-3 px-3 text-stone-500">{r.region ?? '-'}</td>
                                        <td className="py-3 px-3 text-stone-500">{r.country ?? '-'}</td>
                                        <td className="text-right py-3 px-3 text-stone-700">{formatNum(r.sessions)}</td>
                                        <td className="text-right py-3 px-3 text-stone-500">{formatNum(r.pageViews)}</td>
                                        <td className="text-right py-3 px-3 text-amber-600 font-medium">{formatNum(r.atcCount)}</td>
                                        <td className="text-right py-3 px-3 text-green-600 font-medium">{formatNum(r.orders)}</td>
                                        <td className="text-right py-3 pl-3 text-stone-700">{r.revenue > 0 ? formatCurrency(r.revenue) : '-'}</td>
                                    </tr>
                                ))}
                                {geoRows.length === 0 && (
                                    <tr><td colSpan={8} className="py-8 text-center text-stone-400">No geo data yet</td></tr>
                                )}
                            </tbody>
                        </table>
                    </div>
                )}
            </div>

            {/* Two-column: Top Pages + Top Searches */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                {/* Top Pages */}
                <div className="bg-white rounded-lg border border-stone-200 shadow-sm p-4 sm:p-6">
                    <h3 className="text-sm font-medium text-stone-700 mb-4">Top Pages</h3>
                    <div className="space-y-2">
                        {(pages.data ?? []).map((p: TopPageRow, i: number) => (
                            <div key={`${p.pageUrl}-${i}`} className="flex items-center justify-between py-1.5 border-b border-stone-100 last:border-0">
                                <span className="text-sm text-stone-700 truncate max-w-[250px]">{truncateUrl(p.pageUrl)}</span>
                                <div className="flex items-center gap-3 text-sm">
                                    <span className="text-stone-600">{formatNum(p.views)}</span>
                                    <span className="text-stone-400">({formatNum(p.uniqueViews)} unique)</span>
                                </div>
                            </div>
                        ))}
                        {(pages.data ?? []).length === 0 && (
                            <p className="text-sm text-stone-400">No page data yet</p>
                        )}
                    </div>
                </div>

                {/* Top Searches */}
                <div className="bg-white rounded-lg border border-stone-200 shadow-sm p-4 sm:p-6">
                    <h3 className="text-sm font-medium text-stone-700 mb-4">Top Searches</h3>
                    <div className="space-y-2">
                        {(searches.data ?? []).map((s: TopSearchRow, i: number) => (
                            <div key={`${s.searchQuery}-${i}`} className="flex items-center justify-between py-1.5 border-b border-stone-100 last:border-0">
                                <span className="text-sm text-purple-600">"{s.searchQuery}"</span>
                                <span className="text-sm text-stone-600">{formatNum(s.count)}</span>
                            </div>
                        ))}
                        {(searches.data ?? []).length === 0 && (
                            <p className="text-sm text-stone-400">No search data yet</p>
                        )}
                    </div>
                </div>
            </div>
        </div>
    );
}

// ============================================
// VISITORS TAB
// ============================================

function funnelStepBadge(step: number) {
    switch (step) {
        case 3: return <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded bg-green-100 text-green-700">Purchased</span>;
        case 2: return <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded bg-orange-100 text-orange-700">Checkout</span>;
        case 1: return <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded bg-amber-100 text-amber-700">ATC</span>;
        default: return <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded bg-stone-100 text-stone-500">Browsing</span>;
    }
}

function VisitorsTab({ days }: { days: number }) {
    const [selectedVisitorId, setSelectedVisitorId] = useState<string | null>(null);
    const [statusFilter, setStatusFilter] = useState<string | undefined>();
    const [sourceFilter, setSourceFilter] = useState<string | undefined>();

    const filter = {
        ...(statusFilter ? { status: statusFilter } : {}),
        ...(sourceFilter ? { source: sourceFilter } : {}),
    };
    const hasFilter = Object.keys(filter).length > 0;

    const visitors = useVisitorList(days, 50, 0, hasFilter ? filter : undefined);
    const detail = useVisitorDetail(selectedVisitorId);

    const visitorList = visitors.data ?? [];

    // Auto-select first visitor when list loads
    React.useEffect(() => {
        if (!selectedVisitorId && visitorList.length > 0) {
            setSelectedVisitorId(visitorList[0].visitorId);
        }
    }, [visitorList, selectedVisitorId]);

    return (
        <div className="flex gap-4 h-[calc(100vh-220px)]">
            {/* LEFT: Visitor List */}
            <div className="w-[380px] flex-shrink-0 flex flex-col bg-white rounded-lg border border-stone-200 shadow-sm overflow-hidden">
                {/* Filters */}
                <div className="p-3 border-b border-stone-100 flex flex-wrap gap-2">
                    <select
                        value={statusFilter ?? ''}
                        onChange={e => { setStatusFilter(e.target.value || undefined); setSelectedVisitorId(null); }}
                        className="text-xs border border-stone-200 rounded-md px-2 py-1.5 bg-white text-stone-700"
                    >
                        <option value="">All status</option>
                        <option value="converted">Purchased</option>
                        <option value="atc">ATC / Checkout</option>
                        <option value="browsing">Browsing</option>
                    </select>
                    <select
                        value={sourceFilter ?? ''}
                        onChange={e => { setSourceFilter(e.target.value || undefined); setSelectedVisitorId(null); }}
                        className="text-xs border border-stone-200 rounded-md px-2 py-1.5 bg-white text-stone-700"
                    >
                        <option value="">All sources</option>
                        <option value="paid">Paid</option>
                        <option value="direct">Direct</option>
                    </select>
                    <span className="text-[11px] text-stone-400 self-center ml-auto">
                        {visitorList.length} visitors
                    </span>
                </div>

                {/* Visitor rows */}
                <div className="flex-1 overflow-y-auto">
                    {visitors.isLoading && <div className="p-4"><SectionSkeleton /></div>}
                    {visitorList.map(v => (
                        <button
                            key={v.visitorId}
                            onClick={() => setSelectedVisitorId(v.visitorId)}
                            className={`w-full text-left px-3 py-2.5 border-b border-stone-100 hover:bg-stone-50 transition-colors ${
                                selectedVisitorId === v.visitorId ? 'bg-stone-100' : ''
                            }`}
                        >
                            <div className="flex items-center justify-between">
                                <div className="flex items-center gap-2 min-w-0">
                                    {funnelStepBadge(v.maxFunnelStep)}
                                    <span className="text-xs text-stone-500 truncate">
                                        {v.visitorId.slice(0, 8)}...
                                    </span>
                                </div>
                                <span className="text-[11px] text-stone-400 whitespace-nowrap">{timeAgo(v.lastSeen)}</span>
                            </div>
                            <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 mt-1 text-[11px] text-stone-400">
                                {(v.city || v.country) && (
                                    <span>{[v.city, v.country].filter(Boolean).join(', ')}</span>
                                )}
                                {v.deviceType && <span className="capitalize">{v.deviceType}</span>}
                                {v.source && (
                                    <span className="font-medium" style={{ color: sourceColor(v.source) }}>{v.source}</span>
                                )}
                                <span>{v.eventCount} events</span>
                                {v.sessionCount > 1 && <span>{v.sessionCount} sessions</span>}
                            </div>
                            {v.totalOrderValue != null && v.totalOrderValue > 0 && (
                                <div className="mt-0.5 text-[11px] font-semibold text-green-600">
                                    Order: {formatCurrency(v.totalOrderValue)}
                                </div>
                            )}
                        </button>
                    ))}
                    {!visitors.isLoading && visitorList.length === 0 && (
                        <p className="text-sm text-stone-400 p-4 text-center">No visitors found</p>
                    )}
                </div>
            </div>

            {/* RIGHT: Journey Timeline */}
            <div className="flex-1 bg-white rounded-lg border border-stone-200 shadow-sm overflow-hidden flex flex-col">
                {!selectedVisitorId ? (
                    <div className="flex-1 flex items-center justify-center text-sm text-stone-400">
                        Select a visitor to see their journey
                    </div>
                ) : detail.isLoading ? (
                    <div className="p-4"><SectionSkeleton /></div>
                ) : detail.data ? (
                    <VisitorJourney detail={detail.data} />
                ) : (
                    <div className="flex-1 flex items-center justify-center text-sm text-stone-400">
                        No data found
                    </div>
                )}
            </div>
        </div>
    );
}

function VisitorJourney({ detail }: { detail: VisitorDetail }) {
    const { sessions, events, matchedOrders } = detail;

    // Group events by sessionId
    const eventsBySession: Record<string, typeof events> = {};
    for (const e of events) {
        const list = eventsBySession[e.sessionId] ?? [];
        list.push(e);
        eventsBySession[e.sessionId] = list;
    }

    return (
        <div className="flex-1 overflow-y-auto">
            {/* Matched orders banner */}
            {matchedOrders.length > 0 && (
                <div className="p-3 bg-green-50 border-b border-green-100">
                    <div className="flex items-center gap-2 text-sm text-green-800">
                        <CreditCard size={14} />
                        <span className="font-medium">Converted</span>
                    </div>
                    {matchedOrders.map(o => (
                        <div key={o.orderId} className="mt-1 text-xs text-green-700">
                            Order #{o.orderNumber} — {o.customerName} — {formatCurrency(o.amount)}
                        </div>
                    ))}
                </div>
            )}

            {/* Sessions */}
            {sessions.map((session, si) => {
                const sessionEvents = eventsBySession[session.sessionId] ?? [];
                return (
                    <div key={session.sessionId}>
                        {/* Session header */}
                        <div className="sticky top-0 z-10 px-4 py-2.5 bg-stone-50 border-b border-stone-200 flex flex-wrap items-center gap-2">
                            <span className="text-[11px] font-semibold text-stone-600 uppercase tracking-wider">
                                Session {si + 1}
                            </span>
                            <span className="text-[11px] text-stone-400">
                                {new Date(session.startTime).toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}
                            </span>
                            {session.source && (
                                <span className="text-[10px] font-medium px-1.5 py-0.5 rounded-full"
                                    style={{ color: sourceColor(session.source), backgroundColor: sourceColor(session.source) + '18' }}>
                                    {session.source}
                                    {session.campaign && <span className="font-normal opacity-70"> / {session.campaign}</span>}
                                </span>
                            )}
                            {session.deviceType && (
                                <span className="text-[11px] text-stone-400 capitalize flex items-center gap-1">
                                    {session.deviceType === 'mobile' ? <Smartphone size={11} /> : session.deviceType === 'desktop' ? <Monitor size={11} /> : <Tablet size={11} />}
                                    {session.deviceType}
                                </span>
                            )}
                            {session.city && (
                                <span className="text-[11px] text-stone-400 flex items-center gap-1">
                                    <Globe size={11} />
                                    {[session.city, session.country].filter(Boolean).join(', ')}
                                </span>
                            )}
                            {session.browser && (
                                <span className="text-[11px] text-stone-400">{session.browser}/{session.os}</span>
                            )}
                            {session.asOrganization && (
                                <span className="text-[11px] text-stone-400 flex items-center gap-1">
                                    <Wifi size={10} />
                                    {session.asOrganization.length > 25 ? session.asOrganization.slice(0, 25) + '...' : session.asOrganization}
                                </span>
                            )}
                            {session.isVpn && (
                                <span className="text-[10px] font-medium px-1.5 py-0.5 rounded bg-red-100 text-red-600 flex items-center gap-1">
                                    <Shield size={10} />VPN
                                </span>
                            )}
                        </div>

                        {/* Landing URL */}
                        {session.landingUrl && (
                            <div className="px-4 py-1.5 bg-stone-50/50 border-b border-stone-100 text-[11px] text-stone-400 truncate">
                                <span className="text-stone-500 font-medium">Landing: </span>
                                {truncateUrl(session.landingUrl)}
                            </div>
                        )}

                        {/* Event timeline */}
                        <div className="relative pl-8 pr-4">
                            {/* Vertical line */}
                            <div className="absolute left-5 top-0 bottom-0 w-px bg-stone-200" />

                            {sessionEvents.map((e) => {
                                const hasProduct = !!e.productTitle;
                                return (
                                    <div key={e.id} className="relative py-2 flex items-start gap-3">
                                        {/* Timeline dot */}
                                        <div className={`absolute left-[-12px] top-3 w-2.5 h-2.5 rounded-full border-2 border-white z-10 ${
                                            e.eventName === 'checkout_completed' ? 'bg-green-500' :
                                            e.eventName === 'product_added_to_cart' ? 'bg-amber-500' :
                                            e.eventName === 'checkout_started' ? 'bg-orange-500' :
                                            e.eventName === 'product_viewed' ? 'bg-blue-400' :
                                            'bg-stone-300'
                                        }`} />

                                        {/* Thumbnail */}
                                        {hasProduct && e.imageUrl ? (
                                            <img src={e.imageUrl} alt={e.productTitle ?? ''} className="w-8 h-10 rounded object-cover flex-shrink-0" />
                                        ) : null}

                                        {/* Event content */}
                                        <div className="flex-1 min-w-0">
                                            <p className="text-sm text-stone-800 leading-snug">
                                                <span className="font-medium">{eventLabel(e.eventName)}</span>
                                                {hasProduct && <span className="text-stone-600"> — {e.productTitle}</span>}
                                                {e.collectionTitle && !hasProduct && <span className="text-stone-600"> — {e.collectionTitle}</span>}
                                                {e.searchQuery && <span className="text-purple-600"> "{e.searchQuery}"</span>}
                                            </p>
                                            {hasProduct && e.variantTitle && (
                                                <p className="text-[11px] text-stone-500 mt-0.5">{e.variantTitle}</p>
                                            )}
                                            {e.pageTitle && !hasProduct && (
                                                <p className="text-[11px] text-stone-400 mt-0.5 truncate">{e.pageTitle}</p>
                                            )}
                                            <div className="flex items-center gap-2 mt-0.5 text-[11px] text-stone-400">
                                                <span>
                                                    {new Date(e.eventTime).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
                                                </span>
                                                {e.orderValue != null && e.orderValue > 0 && (
                                                    <span className="text-green-600 font-semibold">{formatCurrency(e.orderValue)}</span>
                                                )}
                                                {e.cartValue != null && e.cartValue > 0 && (
                                                    <span className="text-amber-600">Cart: {formatCurrency(e.cartValue)}</span>
                                                )}
                                            </div>
                                        </div>
                                    </div>
                                );
                            })}
                        </div>
                    </div>
                );
            })}

            {sessions.length === 0 && (
                <div className="flex-1 flex items-center justify-center text-sm text-stone-400 p-8">
                    No sessions found for this visitor
                </div>
            )}
        </div>
    );
}

// ============================================
// HEADER
// ============================================

function Header({
    days, setDays, tab, setTab,
}: {
    days: DayRange;
    setDays: (d: DayRange) => void;
    tab: Tab;
    setTab: (t: Tab) => void;
}) {
    return (
        <div className="flex-none px-6 py-4 border-b bg-white">
            <div className="flex items-center justify-between flex-wrap gap-4">
                <div>
                    <h1 className="text-xl font-semibold text-stone-900">Storefront Live</h1>
                    <p className="text-sm text-stone-400 mt-0.5">First-party storefront analytics — unsampled</p>
                </div>

                {/* Day range pills */}
                <div className="flex bg-stone-100 rounded-lg p-0.5">
                    {DAY_OPTIONS.map(d => (
                        <button
                            key={d.value}
                            onClick={() => setDays(d.value)}
                            className={`px-3 py-1.5 text-sm font-medium rounded-md transition-colors ${
                                days === d.value
                                    ? 'bg-stone-900 text-white'
                                    : 'text-stone-600 hover:bg-stone-200'
                            }`}
                        >
                            {d.label}
                        </button>
                    ))}
                </div>
            </div>

            {/* Tabs */}
            <div className="flex gap-1 mt-4 overflow-x-auto pb-1">
                {TABS.map(t => (
                    <button
                        key={t.key}
                        onClick={() => setTab(t.key)}
                        className={`px-3 py-1.5 text-sm font-medium rounded-md whitespace-nowrap transition-colors ${
                            tab === t.key
                                ? 'bg-stone-900 text-white'
                                : 'bg-stone-100 text-stone-600 hover:bg-stone-200'
                        }`}
                    >
                        {t.label}
                    </button>
                ))}
            </div>
        </div>
    );
}

// ============================================
// MAIN PAGE
// ============================================

export default function StorefrontLive() {
    const [tab, setTab] = useState<Tab>('overview');
    const [days, setDays] = useState<DayRange>(1);

    return (
        <div className="h-full flex flex-col">
            <Header days={days} setDays={setDays} tab={tab} setTab={setTab} />
            <div className="flex-1 overflow-auto p-6 bg-stone-50">
                {tab === 'overview' && <OverviewTab days={days} />}
                {tab === 'products' && <ProductsTab days={days} />}
                {tab === 'acquisition' && <AcquisitionTab days={days} />}
                {tab === 'geography' && <GeographyTab days={days} />}
                {tab === 'visitors' && <VisitorsTab days={days} />}
            </div>
        </div>
    );
}
