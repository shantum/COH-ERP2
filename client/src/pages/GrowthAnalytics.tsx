/**
 * Growth Analytics Dashboard
 * GA4 + BigQuery powered analytics: funnel, acquisition, pages, geography, ads
 */

import { useState, useMemo } from 'react';
import {
    BarChart, Bar, ComposedChart, Line, XAxis, YAxis, CartesianGrid,
    Tooltip, ResponsiveContainer, Cell,
} from 'recharts';
import { AgGridReact } from 'ag-grid-react';
import type { ColDef, ValueFormatterParams, ICellRendererParams } from 'ag-grid-community';
import { AllCommunityModule, ModuleRegistry } from 'ag-grid-community';
import { ArrowRight, AlertCircle } from 'lucide-react';
import {
    useConversionFunnel, useLandingPages, useTrafficSources,
    useCampaigns, useGeoConversion, useDeviceBreakdown, useGrowthOverview,
    useGA4Health,
} from '../hooks/useGA4Analytics';
import MetaAdsAnalysis from './MetaAdsAnalysis';
import GoogleAdsAnalysis from './GoogleAdsAnalysis';
import { compactThemeSmall } from '../utils/agGridHelpers';
import { formatCurrency } from '../utils/formatting';
import type {
    FunnelDay, TrafficSourceRow, CampaignRow, LandingPageRow, GeoRow, DeviceRow,
} from '../server/functions/ga4Analytics';

ModuleRegistry.registerModules([AllCommunityModule]);

type Tab = 'overview' | 'acquisition' | 'pages' | 'geography' | 'meta-ads' | 'google-ads';
type DayRange = 1 | 2 | 7 | 14 | 30 | 90;

const TABS: { key: Tab; label: string }[] = [
    { key: 'overview', label: 'Overview' },
    { key: 'acquisition', label: 'Acquisition' },
    { key: 'pages', label: 'Pages' },
    { key: 'geography', label: 'Geography' },
    { key: 'google-ads', label: 'Google Ads' },
    { key: 'meta-ads', label: 'Meta Ads' },
];

const DAY_OPTIONS: { value: DayRange; label: string }[] = [
    { value: 1, label: 'Today' },
    { value: 2, label: 'Yesterday' },
    { value: 7, label: '7d' },
    { value: 14, label: '14d' },
    { value: 30, label: '30d' },
    { value: 90, label: '90d' },
];

const DEFAULT_COL_DEF = { sortable: true, resizable: true };

const FUNNEL_COLORS = ['#292524', '#57534e', '#a8a29e', '#d6d3d1'];

function formatPct(value: number): string {
    return `${value.toFixed(2)}%`;
}

function formatNum(value: number): string {
    return value.toLocaleString('en-IN');
}

function formatChartDate(dateStr: string): string {
    const [year, month, day] = dateStr.split('-').map(Number);
    const date = new Date(year, month - 1, day);
    return date.toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });
}

function truncateUrl(url: string): string {
    try {
        const parsed = new URL(url);
        return parsed.pathname + (parsed.search ? '?' + parsed.search.slice(1, 30) : '');
    } catch {
        return url.length > 60 ? url.slice(0, 60) + '...' : url;
    }
}

// ============================================
// SKELETON
// ============================================

function Skeleton({ className = '' }: { className?: string }) {
    return <div className={`animate-pulse bg-stone-200 rounded ${className}`} />;
}

function KPISkeleton() {
    return (
        <div className="grid grid-cols-2 lg:grid-cols-3 gap-4">
            {Array.from({ length: 6 }).map((_, i) => (
                <div key={i} className="bg-white rounded-lg border border-stone-200 shadow-sm p-4 sm:p-6">
                    <Skeleton className="h-3 w-20 mb-3" />
                    <Skeleton className="h-7 w-28" />
                </div>
            ))}
        </div>
    );
}

function ChartSkeleton() {
    return (
        <div className="bg-white rounded-lg border border-stone-200 shadow-sm p-4 sm:p-6">
            <Skeleton className="h-4 w-40 mb-4" />
            <Skeleton className="h-64 w-full" />
        </div>
    );
}

function GridSkeleton() {
    return (
        <div className="bg-white rounded-lg border border-stone-200 shadow-sm p-4 sm:p-6">
            <Skeleton className="h-4 w-48 mb-4" />
            <Skeleton className="h-80 w-full" />
        </div>
    );
}

// ============================================
// KPI CARD
// ============================================

function KPICard({ label, value, subtext }: { label: string; value: string; subtext?: string }) {
    return (
        <div className="bg-white rounded-lg border border-stone-200 shadow-sm p-4 sm:p-6">
            <p className="text-xs font-medium text-stone-500 uppercase tracking-wide">{label}</p>
            <p className="text-2xl font-semibold text-stone-900 mt-1">{value}</p>
            {subtext && <p className="text-xs text-stone-400 mt-1 truncate">{subtext}</p>}
        </div>
    );
}

// ============================================
// OVERVIEW TAB
// ============================================

function OverviewTab({ days }: { days: number }) {
    const overview = useGrowthOverview(days);
    const funnel = useConversionFunnel(days);

    const isLoading = overview.isLoading || funnel.isLoading;

    if (isLoading) {
        return (
            <div className="space-y-6">
                <KPISkeleton />
                <ChartSkeleton />
                <ChartSkeleton />
            </div>
        );
    }

    if (overview.error || funnel.error) {
        return <ErrorState />;
    }

    const o = overview.data;
    const f = funnel.data;

    if (!o || !f) return <ErrorState />;

    // Funnel horizontal bar data
    const funnelData = [
        { name: 'Sessions', value: f.summary.totalSessions, rate: 100 },
        { name: 'Add to Cart', value: f.summary.totalAddToCarts, rate: f.summary.cartRate },
        { name: 'Checkout', value: f.summary.totalCheckouts, rate: f.summary.checkoutRate },
        { name: 'Purchase', value: f.summary.totalPurchases, rate: f.summary.purchaseRate },
    ];

    // Drop-off percentages between steps
    const dropOffs = funnelData.slice(1).map((step, i) => {
        const prev = funnelData[i].value;
        const dropOff = prev > 0 ? ((prev - step.value) / prev * 100) : 0;
        return dropOff.toFixed(1);
    });

    // Trend data
    const trendData = (f.daily as FunnelDay[]).map((d: FunnelDay) => ({
        date: formatChartDate(d.date),
        sessions: d.sessions,
        convRate: d.sessions > 0 ? Number(((d.purchases / d.sessions) * 100).toFixed(2)) : 0,
    }));

    return (
        <div className="space-y-6">
            {/* KPI Cards */}
            <div className="grid grid-cols-2 lg:grid-cols-3 gap-4">
                <KPICard label="Sessions" value={formatNum(o.totalSessions)} />
                <KPICard label="Purchases" value={formatNum(o.totalPurchases)} />
                <KPICard label="Conversion Rate" value={formatPct(o.overallConversionRate)} />
                <KPICard label="Revenue" value={formatCurrency(o.totalRevenue)} />
                <KPICard label="Avg Order Value" value={formatCurrency(o.avgOrderValue)} />
                <KPICard label="Top Source" value={o.topSource} subtext={o.topCity} />
            </div>

            {/* Conversion Funnel */}
            <div className="bg-white rounded-lg border border-stone-200 shadow-sm p-4 sm:p-6">
                <h3 className="text-sm font-medium text-stone-700 mb-4">Conversion Funnel</h3>
                <div className="space-y-3">
                    {funnelData.map((step, i) => {
                        const maxVal = funnelData[0].value;
                        const widthPct = maxVal > 0 ? Math.max((step.value / maxVal) * 100, 4) : 4;
                        return (
                            <div key={step.name}>
                                <div className="flex items-center justify-between mb-1">
                                    <span className="text-sm text-stone-600">{step.name}</span>
                                    <span className="text-sm font-medium text-stone-900">
                                        {formatNum(step.value)}
                                        {i > 0 && (
                                            <span className="text-xs text-stone-400 ml-2">
                                                ({step.rate}% of sessions)
                                            </span>
                                        )}
                                    </span>
                                </div>
                                <div className="w-full bg-stone-100 rounded-full h-6">
                                    <div
                                        className="h-6 rounded-full transition-all"
                                        style={{
                                            width: `${widthPct}%`,
                                            backgroundColor: FUNNEL_COLORS[i],
                                        }}
                                    />
                                </div>
                                {i < funnelData.length - 1 && (
                                    <div className="flex items-center gap-1 mt-1 ml-2">
                                        <ArrowRight size={10} className="text-stone-400" />
                                        <span className="text-xs text-red-400">
                                            {dropOffs[i]}% drop-off
                                        </span>
                                    </div>
                                )}
                            </div>
                        );
                    })}
                </div>
            </div>

            {/* Conversion Trend */}
            <div className="bg-white rounded-lg border border-stone-200 shadow-sm p-4 sm:p-6">
                <h3 className="text-sm font-medium text-stone-700 mb-4">Sessions & Conversion Trend</h3>
                <div className="h-72">
                    <ResponsiveContainer width="100%" height="100%">
                        <ComposedChart data={trendData}>
                            <CartesianGrid strokeDasharray="3 3" stroke="#e7e5e4" />
                            <XAxis dataKey="date" tick={{ fontSize: 11 }} stroke="#a8a29e" />
                            <YAxis
                                yAxisId="left"
                                tick={{ fontSize: 11 }}
                                stroke="#a8a29e"
                                tickFormatter={(v) => formatNum(v)}
                            />
                            <YAxis
                                yAxisId="right"
                                orientation="right"
                                tick={{ fontSize: 11 }}
                                stroke="#10b981"
                                tickFormatter={(v) => `${v}%`}
                            />
                            <Tooltip
                                formatter={(value, name) => {
                                    const v = Number(value ?? 0);
                                    if (name === 'convRate') return [`${v}%`, 'Conv. Rate'];
                                    return [formatNum(v), 'Sessions'];
                                }}
                            />
                            <Bar yAxisId="left" dataKey="sessions" fill="#292524" radius={[2, 2, 0, 0]} />
                            <Line
                                yAxisId="right"
                                type="monotone"
                                dataKey="convRate"
                                stroke="#10b981"
                                strokeWidth={2}
                                dot={false}
                            />
                        </ComposedChart>
                    </ResponsiveContainer>
                </div>
            </div>
        </div>
    );
}

// ============================================
// ACQUISITION TAB
// ============================================

function AcquisitionTab({ days }: { days: number }) {
    const sources = useTrafficSources(days);
    const campaigns = useCampaigns(days);
    const devices = useDeviceBreakdown(days);

    const isLoading = sources.isLoading || campaigns.isLoading || devices.isLoading;

    const sourceColDefs = useMemo((): ColDef<TrafficSourceRow>[] => [
        { field: 'source', headerName: 'Source', flex: 1, minWidth: 120 },
        { field: 'medium', headerName: 'Medium', width: 100 },
        { field: 'sessions', headerName: 'Sessions', width: 100, cellClass: 'text-right', headerClass: 'ag-right-aligned-header', valueFormatter: (p: ValueFormatterParams) => formatNum(p.value ?? 0) },
        { field: 'users', headerName: 'Users', width: 90, cellClass: 'text-right', headerClass: 'ag-right-aligned-header', valueFormatter: (p: ValueFormatterParams) => formatNum(p.value ?? 0) },
        { field: 'purchases', headerName: 'Purchases', width: 100, cellClass: 'text-right', headerClass: 'ag-right-aligned-header', valueFormatter: (p: ValueFormatterParams) => formatNum(p.value ?? 0) },
        { field: 'revenue', headerName: 'Revenue', width: 110, cellClass: 'text-right font-medium', headerClass: 'ag-right-aligned-header', valueFormatter: (p: ValueFormatterParams) => formatCurrency(p.value ?? 0) },
        { field: 'conversionRate', headerName: 'Conv %', width: 90, cellClass: 'text-right', headerClass: 'ag-right-aligned-header', valueFormatter: (p: ValueFormatterParams) => formatPct(p.value ?? 0) },
    ], []);

    const campaignColDefs = useMemo((): ColDef<CampaignRow>[] => [
        { field: 'campaign', headerName: 'Campaign', flex: 1, minWidth: 150 },
        { field: 'source', headerName: 'Source', width: 100 },
        { field: 'medium', headerName: 'Medium', width: 90 },
        { field: 'users', headerName: 'Users', width: 90, cellClass: 'text-right', headerClass: 'ag-right-aligned-header', valueFormatter: (p: ValueFormatterParams) => formatNum(p.value ?? 0) },
        { field: 'purchases', headerName: 'Purchases', width: 100, cellClass: 'text-right', headerClass: 'ag-right-aligned-header', valueFormatter: (p: ValueFormatterParams) => formatNum(p.value ?? 0) },
        { field: 'revenue', headerName: 'Revenue', width: 110, cellClass: 'text-right font-medium', headerClass: 'ag-right-aligned-header', valueFormatter: (p: ValueFormatterParams) => formatCurrency(p.value ?? 0) },
        { field: 'conversionRate', headerName: 'Conv %', width: 90, cellClass: 'text-right', headerClass: 'ag-right-aligned-header', valueFormatter: (p: ValueFormatterParams) => formatPct(p.value ?? 0) },
    ], []);

    // Device chart data
    const deviceData = useMemo(() => {
        if (!devices.data) return [];
        return (devices.data as DeviceRow[]).map((d: DeviceRow) => ({
            name: d.device.charAt(0).toUpperCase() + d.device.slice(1),
            sessions: d.sessions,
            convRate: d.conversionRate,
        }));
    }, [devices.data]);

    if (isLoading) {
        return (
            <div className="space-y-6">
                <GridSkeleton />
                <GridSkeleton />
                <ChartSkeleton />
            </div>
        );
    }

    return (
        <div className="space-y-6">
            {/* Traffic Sources */}
            <div className="bg-white rounded-lg border border-stone-200 shadow-sm p-4 sm:p-6">
                <h3 className="text-sm font-medium text-stone-700 mb-3">Traffic Sources</h3>
                <div className="h-80">
                    <AgGridReact<TrafficSourceRow>
                        rowData={sources.data ?? []}
                        columnDefs={sourceColDefs}
                        theme={compactThemeSmall}
                        defaultColDef={DEFAULT_COL_DEF}
                        pagination
                        paginationPageSize={15}
                        enableCellTextSelection
                        ensureDomOrder
                    />
                </div>
            </div>

            {/* Campaigns */}
            <div className="bg-white rounded-lg border border-stone-200 shadow-sm p-4 sm:p-6">
                <h3 className="text-sm font-medium text-stone-700 mb-3">Campaign Performance</h3>
                {campaigns.data && campaigns.data.length > 0 ? (
                    <div className="h-72">
                        <AgGridReact<CampaignRow>
                            rowData={campaigns.data}
                            columnDefs={campaignColDefs}
                            theme={compactThemeSmall}
                            defaultColDef={DEFAULT_COL_DEF}
                            pagination
                            paginationPageSize={10}
                            enableCellTextSelection
                            ensureDomOrder
                        />
                    </div>
                ) : (
                    <p className="text-sm text-stone-400 py-8 text-center">No campaign data for this period</p>
                )}
            </div>

            {/* Device Breakdown */}
            <div className="bg-white rounded-lg border border-stone-200 shadow-sm p-4 sm:p-6">
                <h3 className="text-sm font-medium text-stone-700 mb-3">Device Breakdown</h3>
                <div className="h-48">
                    <ResponsiveContainer width="100%" height="100%">
                        <BarChart data={deviceData} layout="vertical" margin={{ left: 10 }}>
                            <CartesianGrid strokeDasharray="3 3" stroke="#e7e5e4" />
                            <XAxis type="number" tick={{ fontSize: 11 }} stroke="#a8a29e" tickFormatter={formatNum} />
                            <YAxis type="category" dataKey="name" width={80} tick={{ fontSize: 12 }} stroke="#a8a29e" />
                            <Tooltip
                                formatter={(value) => [formatNum(Number(value ?? 0)), 'Sessions']}
                            />
                            <Bar dataKey="sessions" fill="#292524" radius={[0, 4, 4, 0]} />
                        </BarChart>
                    </ResponsiveContainer>
                </div>
            </div>
        </div>
    );
}

// ============================================
// PAGES TAB
// ============================================

function ConvRateCellRenderer(params: ICellRendererParams<LandingPageRow>) {
    const value = params.value as number | undefined;
    if (value == null) return null;
    let colorClass = 'text-red-600 bg-red-50';
    if (value >= 2) colorClass = 'text-emerald-700 bg-emerald-50';
    else if (value >= 1) colorClass = 'text-amber-700 bg-amber-50';
    return (
        <span className={`inline-block px-1.5 py-0.5 rounded text-xs font-medium ${colorClass}`}>
            {formatPct(value)}
        </span>
    );
}

function PagesTab({ days }: { days: number }) {
    const pages = useLandingPages(days);

    const colDefs = useMemo((): ColDef<LandingPageRow>[] => [
        {
            field: 'landingPage',
            headerName: 'Landing Page',
            flex: 2,
            minWidth: 200,
            valueFormatter: (p: ValueFormatterParams) => truncateUrl(p.value ?? ''),
            tooltipValueGetter: (p) => p.value as string,
        },
        { field: 'sessions', headerName: 'Sessions', width: 100, cellClass: 'text-right', headerClass: 'ag-right-aligned-header', valueFormatter: (p: ValueFormatterParams) => formatNum(p.value ?? 0) },
        { field: 'users', headerName: 'Users', width: 90, cellClass: 'text-right', headerClass: 'ag-right-aligned-header', valueFormatter: (p: ValueFormatterParams) => formatNum(p.value ?? 0) },
        { field: 'purchases', headerName: 'Purchases', width: 100, cellClass: 'text-right', headerClass: 'ag-right-aligned-header', valueFormatter: (p: ValueFormatterParams) => formatNum(p.value ?? 0) },
        { field: 'revenue', headerName: 'Revenue', width: 110, cellClass: 'text-right font-medium', headerClass: 'ag-right-aligned-header', valueFormatter: (p: ValueFormatterParams) => formatCurrency(p.value ?? 0) },
        {
            field: 'conversionRate',
            headerName: 'Conv %',
            width: 100,
            headerClass: 'ag-right-aligned-header',
            cellRenderer: ConvRateCellRenderer,
        },
    ], []);

    if (pages.isLoading) return <GridSkeleton />;

    return (
        <div className="bg-white rounded-lg border border-stone-200 shadow-sm p-4 sm:p-6">
            <h3 className="text-sm font-medium text-stone-700 mb-3">
                Landing Page Performance ({pages.data?.length ?? 0} pages)
            </h3>
            <div className="h-[500px]">
                <AgGridReact<LandingPageRow>
                    rowData={pages.data ?? []}
                    columnDefs={colDefs}
                    theme={compactThemeSmall}
                    defaultColDef={DEFAULT_COL_DEF}
                    pagination
                    paginationPageSize={20}
                    enableCellTextSelection
                    ensureDomOrder
                    tooltipShowDelay={300}
                />
            </div>
        </div>
    );
}

// ============================================
// GEOGRAPHY TAB
// ============================================

function GeographyTab({ days }: { days: number }) {
    const geo = useGeoConversion(days);

    const colDefs = useMemo((): ColDef<GeoRow>[] => [
        { field: 'city', headerName: 'City', flex: 1, minWidth: 120 },
        { field: 'region', headerName: 'State', flex: 1, minWidth: 120 },
        { field: 'sessions', headerName: 'Sessions', width: 100, cellClass: 'text-right', headerClass: 'ag-right-aligned-header', valueFormatter: (p: ValueFormatterParams) => formatNum(p.value ?? 0) },
        { field: 'users', headerName: 'Users', width: 90, cellClass: 'text-right', headerClass: 'ag-right-aligned-header', valueFormatter: (p: ValueFormatterParams) => formatNum(p.value ?? 0) },
        { field: 'purchases', headerName: 'Purchases', width: 100, cellClass: 'text-right', headerClass: 'ag-right-aligned-header', valueFormatter: (p: ValueFormatterParams) => formatNum(p.value ?? 0) },
        { field: 'conversionRate', headerName: 'Conv %', width: 90, cellClass: 'text-right', headerClass: 'ag-right-aligned-header', valueFormatter: (p: ValueFormatterParams) => formatPct(p.value ?? 0) },
        { field: 'revenue', headerName: 'Revenue', width: 110, cellClass: 'text-right font-medium', headerClass: 'ag-right-aligned-header', valueFormatter: (p: ValueFormatterParams) => formatCurrency(p.value ?? 0) },
    ], []);

    // Top 10 cities for bar chart
    const top10 = useMemo(() => {
        if (!geo.data) return [];
        return (geo.data as GeoRow[]).slice(0, 10).map((r: GeoRow) => ({
            name: r.city,
            sessions: r.sessions,
        }));
    }, [geo.data]);

    if (geo.isLoading) {
        return (
            <div className="space-y-6">
                <ChartSkeleton />
                <GridSkeleton />
            </div>
        );
    }

    return (
        <div className="space-y-6">
            {/* Top 10 Cities Chart */}
            {top10.length > 0 && (
                <div className="bg-white rounded-lg border border-stone-200 shadow-sm p-4 sm:p-6">
                    <h3 className="text-sm font-medium text-stone-700 mb-3">Top 10 Cities by Sessions</h3>
                    <div className="h-64">
                        <ResponsiveContainer width="100%" height="100%">
                            <BarChart data={top10} layout="vertical" margin={{ left: 10 }}>
                                <CartesianGrid strokeDasharray="3 3" stroke="#e7e5e4" />
                                <XAxis type="number" tick={{ fontSize: 11 }} stroke="#a8a29e" tickFormatter={formatNum} />
                                <YAxis type="category" dataKey="name" width={100} tick={{ fontSize: 11 }} stroke="#a8a29e" />
                                <Tooltip formatter={(value) => [formatNum(Number(value ?? 0)), 'Sessions']} />
                                <Bar dataKey="sessions" radius={[0, 4, 4, 0]}>
                                    {top10.map((_, i) => (
                                        <Cell key={i} fill={i < 3 ? '#292524' : '#78716c'} />
                                    ))}
                                </Bar>
                            </BarChart>
                        </ResponsiveContainer>
                    </div>
                </div>
            )}

            {/* Full Grid */}
            <div className="bg-white rounded-lg border border-stone-200 shadow-sm p-4 sm:p-6">
                <h3 className="text-sm font-medium text-stone-700 mb-3">
                    City Breakdown ({geo.data?.length ?? 0} cities)
                </h3>
                <div className="h-[500px]">
                    <AgGridReact<GeoRow>
                        rowData={geo.data ?? []}
                        columnDefs={colDefs}
                        theme={compactThemeSmall}
                        defaultColDef={DEFAULT_COL_DEF}
                        pagination
                        paginationPageSize={20}
                        enableCellTextSelection
                        ensureDomOrder
                    />
                </div>
            </div>
        </div>
    );
}

// ============================================
// GOOGLE ADS TAB (delegated to GoogleAdsAnalysis)
// ============================================

function GoogleAdsTab({ days }: { days: number }) {
    return <GoogleAdsAnalysis days={days} />;
}

// ============================================
// META ADS TAB (delegated to MetaAdsAnalysis)
// ============================================

function MetaAdsTab({ days }: { days: number }) {
    return <MetaAdsAnalysis days={days} />;
}

// ============================================
// ERROR STATES
// ============================================

function ErrorState() {
    return (
        <div className="flex flex-col items-center justify-center py-16 text-center">
            <AlertCircle size={40} className="text-stone-300 mb-4" />
            <h3 className="text-lg font-medium text-stone-700">GA4 data not available yet</h3>
            <p className="text-sm text-stone-400 mt-2 max-w-md">
                BigQuery export can take 24-48 hours to populate after initial setup.
                If this persists, check that the GA4 BigQuery linking is active and
                the service account has correct permissions.
            </p>
        </div>
    );
}

// ============================================
// MAIN PAGE
// ============================================

export default function GrowthAnalytics() {
    const [tab, setTab] = useState<Tab>('overview');
    const [days, setDays] = useState<DayRange>(30);
    const health = useGA4Health();
    const ga4Unavailable = health.data && !health.data.exists;
    const isGA4Tab = tab === 'overview' || tab === 'acquisition' || tab === 'pages' || tab === 'geography';

    return (
        <div className="h-full flex flex-col">
            <Header days={days} setDays={setDays} tab={tab} setTab={setTab} />
            <div className="flex-1 overflow-auto p-6 bg-stone-50">
                {isGA4Tab && ga4Unavailable ? (
                    <ErrorState />
                ) : (
                    <>
                        {tab === 'overview' && <OverviewTab days={days} />}
                        {tab === 'acquisition' && <AcquisitionTab days={days} />}
                        {tab === 'pages' && <PagesTab days={days} />}
                        {tab === 'geography' && <GeographyTab days={days} />}
                        {tab === 'google-ads' && <GoogleAdsTab days={days} />}
                        {tab === 'meta-ads' && <MetaAdsTab days={days} />}
                    </>
                )}
            </div>
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
                    <h1 className="text-xl font-semibold text-stone-900">Growth Analytics</h1>
                    <p className="text-sm text-stone-400 mt-0.5">Powered by GA4 + BigQuery</p>
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
