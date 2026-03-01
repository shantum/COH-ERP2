/**
 * Google Ads Analysis — Comprehensive ads analytics
 *
 * Sub-tabs: Overview, Competitive, Products, Creatives, Video, Search, Audience, Geography, Schedule, Landing Pages
 * Data from Google Ads via BigQuery Data Transfer.
 */

import { useState, useMemo } from 'react';
import {
    ComposedChart, Bar, BarChart, Line, XAxis, YAxis, CartesianGrid,
    Tooltip, ResponsiveContainer, Cell,
} from 'recharts';
import { AgGridReact } from 'ag-grid-react';
import type { ColDef, ValueFormatterParams } from 'ag-grid-community';
import { AlertCircle } from 'lucide-react';
import {
    useGAdsAccountSummary, useGAdsCampaigns, useGAdsDailyTrend,
    useGAdsProducts, useGAdsGeo, useGAdsHourly, useGAdsDevices,
    useGAdsAge, useGAdsGender, useGAdsSearchTerms, useGAdsKeywords,
    useGAdsLandingPages, useGAdsImpressionShare, useGAdsBudgets,
    useGAdsCreatives, useGAdsVideos, useGAdsAssetGroups, useGAdsAudienceSegments,
    useGAdsProductFunnel, useGAdsSearchConversions, useGAdsCampaignConversions,
} from '../hooks/useGoogleAds';
import { compactThemeSmall } from '../utils/agGridHelpers';
import { formatCurrency } from '../utils/formatting';
import type {
    GAdsCampaignRow, GAdsProductRow, GAdsGeoRow,
    GAdsSearchTermRow, GAdsKeywordRow, GAdsLandingPageRow,
    GAdsImpressionShareRow, GAdsBudgetRow, GAdsCreativeRow,
    GAdsVideoRow, GAdsAssetGroupRow, GAdsAudienceSegmentRow,
    GAdsProductFunnelRow, GAdsSearchConversionRow, GAdsCampaignConversionRow,
} from '../server/functions/googleAds';

// ============================================
// SHARED HELPERS
// ============================================

type GAdsSubTab = 'overview' | 'competitive' | 'products' | 'creatives' | 'video' | 'search' | 'audience' | 'geography' | 'schedule' | 'landing-pages';

const SUB_TABS: { key: GAdsSubTab; label: string }[] = [
    { key: 'overview', label: 'Overview' },
    { key: 'competitive', label: 'Competitive' },
    { key: 'products', label: 'Products' },
    { key: 'creatives', label: 'Creatives' },
    { key: 'video', label: 'Video' },
    { key: 'search', label: 'Search' },
    { key: 'audience', label: 'Audience' },
    { key: 'geography', label: 'Geography' },
    { key: 'schedule', label: 'Schedule' },
    { key: 'landing-pages', label: 'Landing Pages' },
];

const DEFAULT_COL_DEF = { sortable: true, resizable: true };

function fmt(v: number): string { return v.toLocaleString('en-IN'); }
function fmtPct(v: number): string { return `${v.toFixed(2)}%`; }
function fmtChartDate(dateStr: string): string {
    const [y, m, d] = dateStr.split('-').map(Number);
    return new Date(y, m - 1, d).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });
}

function truncateUrl(url: string): string {
    try {
        const parsed = new URL(url);
        const path = parsed.pathname + (parsed.search ? '?' + parsed.search.slice(1, 30) : '');
        return path.length > 60 ? path.slice(0, 60) + '...' : path;
    } catch {
        return url.length > 60 ? url.slice(0, 60) + '...' : url;
    }
}

function roasStyle(value: number): Record<string, string | number> | null {
    if (value >= 3) return { color: '#16a34a', fontWeight: 600 };
    if (value >= 1.5) return { color: '#d97706', fontWeight: 600 };
    if (value > 0) return { color: '#dc2626', fontWeight: 600 };
    return null;
}

// ============================================
// SKELETONS & SHARED COMPONENTS
// ============================================

function Skeleton({ className = '' }: { className?: string }) {
    return <div className={`animate-pulse bg-stone-200 rounded ${className}`} />;
}

function KPISkeleton() {
    return (
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
            {Array.from({ length: 4 }).map((_, i) => (
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

function KPICard({ label, value, subtext }: { label: string; value: string; subtext?: string }) {
    return (
        <div className="bg-white rounded-lg border border-stone-200 shadow-sm p-4 sm:p-6">
            <p className="text-xs font-medium text-stone-500 uppercase tracking-wide">{label}</p>
            <p className="text-2xl font-semibold text-stone-900 mt-1">{value}</p>
            {subtext && <p className="text-xs text-stone-400 mt-1 truncate">{subtext}</p>}
        </div>
    );
}

function ErrorState({ error }: { error: unknown }) {
    return (
        <div className="flex flex-col items-center justify-center py-16 text-stone-400">
            <AlertCircle className="h-10 w-10 mb-3" />
            <p className="text-sm font-medium">Failed to load Google Ads data</p>
            <p className="text-xs mt-1">{error instanceof Error ? error.message : 'Unknown error'}</p>
        </div>
    );
}

function EmptyState({ message }: { message: string }) {
    return (
        <div className="flex items-center justify-center py-12 text-stone-400">
            <p className="text-sm">{message}</p>
        </div>
    );
}

// ============================================
// OVERVIEW SUB-TAB
// ============================================

function OverviewSubTab({ days }: { days: number }) {
    const summary = useGAdsAccountSummary(days);
    const campaigns = useGAdsCampaigns(days);
    const daily = useGAdsDailyTrend(days);
    const campaignConv = useGAdsCampaignConversions(days);

    const campaignCols: ColDef<GAdsCampaignRow>[] = useMemo(() => [
        { field: 'campaignName', headerName: 'Campaign', flex: 2, minWidth: 200 },
        {
            field: 'channelType', headerName: 'Type', width: 130,
            valueFormatter: (p: ValueFormatterParams) => {
                const v = String(p.value ?? '');
                return v.charAt(0) + v.slice(1).toLowerCase();
            },
        },
        { field: 'spend', headerName: 'Spend', valueFormatter: (p: ValueFormatterParams) => formatCurrency(p.value), width: 110, sort: 'desc' as const },
        { field: 'impressions', headerName: 'Impr', valueFormatter: (p: ValueFormatterParams) => fmt(p.value), width: 90 },
        { field: 'clicks', headerName: 'Clicks', valueFormatter: (p: ValueFormatterParams) => fmt(p.value), width: 80 },
        { field: 'ctr', headerName: 'CTR', valueFormatter: (p: ValueFormatterParams) => fmtPct(p.value), width: 75 },
        { field: 'cpc', headerName: 'CPC', valueFormatter: (p: ValueFormatterParams) => `₹${Number(p.value).toFixed(1)}`, width: 75 },
        { field: 'conversions', headerName: 'Conv', valueFormatter: (p: ValueFormatterParams) => Number(p.value) > 0 ? Number(p.value).toFixed(1) : '-', width: 70 },
        { field: 'conversionValue', headerName: 'Revenue', valueFormatter: (p: ValueFormatterParams) => formatCurrency(p.value), width: 110 },
        {
            field: 'roas', headerName: 'ROAS', width: 80,
            valueFormatter: (p: ValueFormatterParams) => p.value > 0 ? `${Number(p.value).toFixed(2)}x` : '-',
            cellStyle: (params: { value: number }) => roasStyle(params.value),
        },
    ], []);

    if (summary.isLoading || campaigns.isLoading) {
        return <div className="space-y-6"><KPISkeleton /><ChartSkeleton /><GridSkeleton /></div>;
    }
    if (summary.error || campaigns.error) return <ErrorState error={summary.error ?? campaigns.error} />;

    const s = summary.data;
    const campaignData = campaigns.data ?? [];
    const dailyData = daily.data ?? [];

    return (
        <div className="space-y-6">
            {s && (
                <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
                    <KPICard label="Total Spend" value={formatCurrency(s.spend)} />
                    <KPICard label="ROAS" value={s.roas > 0 ? `${s.roas.toFixed(2)}x` : '-'} subtext={`₹${fmt(Math.round(s.conversionValue))} conv value`} />
                    <KPICard label="Conversions" value={s.conversions > 0 ? s.conversions.toFixed(1) : '-'} subtext={s.spend > 0 && s.conversions > 0 ? `₹${Math.round(s.spend / s.conversions)} per conv` : undefined} />
                    <KPICard label="CTR" value={fmtPct(s.ctr)} subtext={`CPC ₹${s.cpc.toFixed(1)}`} />
                </div>
            )}

            <div className="bg-white rounded-lg border border-stone-200 shadow-sm p-4 sm:p-6">
                <h3 className="text-sm font-semibold text-stone-700 mb-4">Daily Spend vs Conversion Value</h3>
                <ResponsiveContainer width="100%" height={280}>
                    <ComposedChart data={dailyData}>
                        <CartesianGrid strokeDasharray="3 3" stroke="#e7e5e4" />
                        <XAxis dataKey="date" tickFormatter={fmtChartDate} tick={{ fill: '#78716c', fontSize: 11 }} />
                        <YAxis yAxisId="left" tick={{ fill: '#78716c', fontSize: 11 }} />
                        <YAxis yAxisId="right" orientation="right" tick={{ fill: '#78716c', fontSize: 11 }} />
                        <Tooltip
                            formatter={(value: number | undefined, name?: string) =>
                                [name === 'spend' || name === 'conversionValue' ? formatCurrency(value ?? 0) : fmt(value ?? 0),
                                 name === 'conversionValue' ? 'Conv Value' : name === 'spend' ? 'Spend' : (name ?? '')]
                            }
                            labelFormatter={fmtChartDate}
                        />
                        <Bar yAxisId="left" dataKey="spend" fill="#4285F4" name="spend" radius={[2, 2, 0, 0]} />
                        <Line yAxisId="right" dataKey="conversionValue" stroke="#34A853" strokeWidth={2} dot={false} name="conversionValue" />
                    </ComposedChart>
                </ResponsiveContainer>
            </div>

            <div className="bg-white rounded-lg border border-stone-200 shadow-sm p-4 sm:p-6">
                <h3 className="text-sm font-semibold text-stone-700 mb-4">Campaign Performance</h3>
                <div className="ag-theme-custom" style={{ height: 400 }}>
                    <AgGridReact<GAdsCampaignRow>
                        rowData={campaignData}
                        columnDefs={campaignCols}
                        theme={compactThemeSmall}
                        defaultColDef={DEFAULT_COL_DEF}
                        animateRows
                    />
                </div>
            </div>

            <div className="bg-white rounded-lg border border-stone-200 shadow-sm p-4 sm:p-6">
                <h3 className="text-sm font-semibold text-stone-700 mb-4">Conversion Breakdown by Campaign</h3>
                {campaignConv.data?.length ? (
                    <div className="ag-theme-custom" style={{ height: 350 }}>
                        <AgGridReact<GAdsCampaignConversionRow>
                            rowData={campaignConv.data}
                            columnDefs={[
                                { field: 'campaignName', headerName: 'Campaign', flex: 2, minWidth: 200 },
                                { field: 'action', headerName: 'Conversion Action', flex: 2, minWidth: 180 },
                                { field: 'conversions', headerName: 'Conversions', valueFormatter: (p: ValueFormatterParams) => Number(p.value).toFixed(1), width: 110, sort: 'desc' as const },
                                { field: 'conversionValue', headerName: 'Value', valueFormatter: (p: ValueFormatterParams) => formatCurrency(p.value), width: 120 },
                            ]}
                            theme={compactThemeSmall}
                            defaultColDef={DEFAULT_COL_DEF}
                            animateRows
                        />
                    </div>
                ) : campaignConv.isLoading ? <Skeleton className="h-64 w-full" /> : <EmptyState message="No conversion breakdown data for this period" />}
            </div>
        </div>
    );
}

// ============================================
// COMPETITIVE SUB-TAB (Impression Share + Budget)
// ============================================

const IS_COLORS = { captured: '#34A853', budgetLost: '#EA4335', rankLost: '#FBBC05' };

function CompetitiveSubTab({ days }: { days: number }) {
    const impressionShare = useGAdsImpressionShare(days);
    const budgets = useGAdsBudgets(days);

    const isCols: ColDef<GAdsImpressionShareRow>[] = useMemo(() => [
        { field: 'campaignName', headerName: 'Campaign', flex: 2, minWidth: 200 },
        {
            field: 'searchImpressionShare', headerName: 'Search IS', width: 100,
            valueFormatter: (p: ValueFormatterParams) => fmtPct(p.value),
            cellStyle: (params: { value: number }) => {
                if (params.value >= 50) return { color: '#16a34a', fontWeight: 600 };
                if (params.value >= 20) return { color: '#d97706', fontWeight: 600 };
                return { color: '#dc2626', fontWeight: 600 };
            },
        },
        {
            field: 'budgetLostImpressionShare', headerName: 'Budget Lost', width: 110,
            valueFormatter: (p: ValueFormatterParams) => p.value > 0 ? fmtPct(p.value) : '-',
            cellStyle: (params: { value: number }) => params.value > 20 ? { color: '#dc2626', fontWeight: 600 } : null,
        },
        {
            field: 'rankLostImpressionShare', headerName: 'Rank Lost', width: 100,
            valueFormatter: (p: ValueFormatterParams) => p.value > 0 ? fmtPct(p.value) : '-',
            cellStyle: (params: { value: number }) => params.value > 50 ? { color: '#d97706', fontWeight: 600 } : null,
        },
        { field: 'searchAbsoluteTopIS', headerName: 'Abs Top IS', width: 100, valueFormatter: (p: ValueFormatterParams) => p.value > 0 ? fmtPct(p.value) : '-' },
        { field: 'searchTopIS', headerName: 'Top IS', width: 90, valueFormatter: (p: ValueFormatterParams) => p.value > 0 ? fmtPct(p.value) : '-' },
    ], []);

    const budgetCols: ColDef<GAdsBudgetRow>[] = useMemo(() => [
        { field: 'campaignName', headerName: 'Campaign', flex: 2, minWidth: 200 },
        { field: 'dailyBudget', headerName: 'Daily Budget', valueFormatter: (p: ValueFormatterParams) => formatCurrency(p.value), width: 120 },
        { field: 'actualSpend', headerName: 'Actual Spend', valueFormatter: (p: ValueFormatterParams) => formatCurrency(p.value), width: 120, sort: 'desc' as const },
        {
            field: 'utilization', headerName: 'Utilization', width: 100,
            valueFormatter: (p: ValueFormatterParams) => fmtPct(p.value),
            cellStyle: (params: { value: number }) => {
                if (params.value >= 95) return { color: '#dc2626', fontWeight: 600 };
                if (params.value >= 80) return { color: '#d97706', fontWeight: 600 };
                return { color: '#16a34a', fontWeight: 600 };
            },
        },
        { field: 'impressions', headerName: 'Impr', valueFormatter: (p: ValueFormatterParams) => fmt(p.value), width: 90 },
        { field: 'clicks', headerName: 'Clicks', valueFormatter: (p: ValueFormatterParams) => fmt(p.value), width: 80 },
        { field: 'conversions', headerName: 'Conv', valueFormatter: (p: ValueFormatterParams) => Number(p.value) > 0 ? Number(p.value).toFixed(1) : '-', width: 70 },
        {
            field: 'roas', headerName: 'ROAS', width: 80,
            valueFormatter: (p: ValueFormatterParams) => p.value > 0 ? `${Number(p.value).toFixed(2)}x` : '-',
            cellStyle: (params: { value: number }) => roasStyle(params.value),
        },
    ], []);

    if (impressionShare.isLoading || budgets.isLoading) {
        return <div className="space-y-6"><GridSkeleton /><GridSkeleton /></div>;
    }
    if (impressionShare.error) return <ErrorState error={impressionShare.error} />;

    const isData = impressionShare.data ?? [];
    const budgetData = budgets.data ?? [];

    // Summary KPIs
    const avgIS = isData.length > 0 ? isData.reduce((s, r) => s + r.searchImpressionShare, 0) / isData.length : 0;
    const avgBudgetLost = isData.length > 0 ? isData.reduce((s, r) => s + r.budgetLostImpressionShare, 0) / isData.length : 0;
    const avgRankLost = isData.length > 0 ? isData.reduce((s, r) => s + r.rankLostImpressionShare, 0) / isData.length : 0;
    const cappedCampaigns = budgetData.filter(b => b.utilization >= 95).length;

    // Stacked bar chart data for impression share
    const isChartData = isData.map(r => ({
        name: r.campaignName.length > 30 ? r.campaignName.slice(0, 30) + '...' : r.campaignName,
        captured: r.searchImpressionShare,
        budgetLost: r.budgetLostImpressionShare,
        rankLost: r.rankLostImpressionShare,
    }));

    return (
        <div className="space-y-6">
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
                <KPICard label="Avg Search IS" value={fmtPct(avgIS)} subtext="of eligible impressions captured" />
                <KPICard label="Budget Lost IS" value={fmtPct(avgBudgetLost)} subtext={avgBudgetLost > 20 ? 'Consider increasing budgets' : 'Budgets look healthy'} />
                <KPICard label="Rank Lost IS" value={fmtPct(avgRankLost)} subtext={avgRankLost > 50 ? 'Improve ad rank / quality' : 'Ranking well'} />
                <KPICard label="Budget Capped" value={`${cappedCampaigns} / ${budgetData.length}`} subtext={cappedCampaigns > 0 ? 'campaigns at limit' : 'none at limit'} />
            </div>

            {isChartData.length > 0 && (
                <div className="bg-white rounded-lg border border-stone-200 shadow-sm p-4 sm:p-6">
                    <h3 className="text-sm font-semibold text-stone-700 mb-4">Impression Share Breakdown by Campaign</h3>
                    <ResponsiveContainer width="100%" height={Math.max(200, isChartData.length * 40)}>
                        <BarChart data={isChartData} layout="vertical">
                            <CartesianGrid strokeDasharray="3 3" stroke="#e7e5e4" />
                            <XAxis type="number" domain={[0, 100]} tick={{ fill: '#78716c', fontSize: 11 }} tickFormatter={(v: number) => `${v}%`} />
                            <YAxis dataKey="name" type="category" width={200} tick={{ fill: '#78716c', fontSize: 11 }} />
                            <Tooltip formatter={(v: number | undefined) => `${(v ?? 0).toFixed(1)}%`} />
                            <Bar dataKey="captured" stackId="is" fill={IS_COLORS.captured} name="Captured" radius={[0, 0, 0, 0]} />
                            <Bar dataKey="budgetLost" stackId="is" fill={IS_COLORS.budgetLost} name="Budget Lost" />
                            <Bar dataKey="rankLost" stackId="is" fill={IS_COLORS.rankLost} name="Rank Lost" radius={[0, 2, 2, 0]} />
                        </BarChart>
                    </ResponsiveContainer>
                    <div className="flex gap-4 mt-3 text-xs text-stone-500">
                        <span className="flex items-center gap-1"><span className="w-3 h-3 rounded-sm" style={{ backgroundColor: IS_COLORS.captured }} /> Captured</span>
                        <span className="flex items-center gap-1"><span className="w-3 h-3 rounded-sm" style={{ backgroundColor: IS_COLORS.budgetLost }} /> Budget Lost</span>
                        <span className="flex items-center gap-1"><span className="w-3 h-3 rounded-sm" style={{ backgroundColor: IS_COLORS.rankLost }} /> Rank Lost</span>
                    </div>
                </div>
            )}

            <div className="bg-white rounded-lg border border-stone-200 shadow-sm p-4 sm:p-6">
                <h3 className="text-sm font-semibold text-stone-700 mb-4">Impression Share Detail</h3>
                {isData.length ? (
                    <div className="ag-theme-custom" style={{ height: 300 }}>
                        <AgGridReact<GAdsImpressionShareRow>
                            rowData={isData}
                            columnDefs={isCols}
                            theme={compactThemeSmall}
                            defaultColDef={DEFAULT_COL_DEF}
                            animateRows
                        />
                    </div>
                ) : <EmptyState message="No impression share data for this period" />}
            </div>

            <div className="bg-white rounded-lg border border-stone-200 shadow-sm p-4 sm:p-6">
                <h3 className="text-sm font-semibold text-stone-700 mb-4">Budget Utilization</h3>
                {budgetData.length ? (
                    <div className="ag-theme-custom" style={{ height: 350 }}>
                        <AgGridReact<GAdsBudgetRow>
                            rowData={budgetData}
                            columnDefs={budgetCols}
                            theme={compactThemeSmall}
                            defaultColDef={DEFAULT_COL_DEF}
                            animateRows
                        />
                    </div>
                ) : <EmptyState message="No budget data available" />}
            </div>
        </div>
    );
}

// ============================================
// PRODUCTS SUB-TAB (Shopping + Asset Groups)
// ============================================

const FUNNEL_COLORS = ['#4285F4', '#FBBC05', '#34A853'];

function ProductsSubTab({ days }: { days: number }) {
    const { data, isLoading, error } = useGAdsProducts(days);
    const assetGroups = useGAdsAssetGroups(days);
    const funnel = useGAdsProductFunnel(days);

    const cols: ColDef<GAdsProductRow>[] = useMemo(() => [
        { field: 'productType', headerName: 'Product Type', flex: 2, minWidth: 180 },
        { field: 'productBrand', headerName: 'Brand', width: 140 },
        { field: 'productChannel', headerName: 'Channel', width: 100 },
        { field: 'spend', headerName: 'Spend', valueFormatter: (p: ValueFormatterParams) => formatCurrency(p.value), width: 110, sort: 'desc' as const },
        { field: 'impressions', headerName: 'Impr', valueFormatter: (p: ValueFormatterParams) => fmt(p.value), width: 90 },
        { field: 'clicks', headerName: 'Clicks', valueFormatter: (p: ValueFormatterParams) => fmt(p.value), width: 80 },
        { field: 'ctr', headerName: 'CTR', valueFormatter: (p: ValueFormatterParams) => fmtPct(p.value), width: 75 },
        { field: 'cpc', headerName: 'CPC', valueFormatter: (p: ValueFormatterParams) => `₹${Number(p.value).toFixed(1)}`, width: 75 },
        { field: 'conversions', headerName: 'Conv', valueFormatter: (p: ValueFormatterParams) => Number(p.value) > 0 ? Number(p.value).toFixed(1) : '-', width: 70 },
        { field: 'conversionValue', headerName: 'Revenue', valueFormatter: (p: ValueFormatterParams) => formatCurrency(p.value), width: 110 },
        {
            field: 'roas', headerName: 'ROAS', width: 80,
            valueFormatter: (p: ValueFormatterParams) => p.value > 0 ? `${Number(p.value).toFixed(2)}x` : '-',
            cellStyle: (params: { value: number }) => roasStyle(params.value),
        },
        {
            field: 'impressionShare', headerName: 'Impr Share', width: 100,
            valueFormatter: (p: ValueFormatterParams) => Number(p.value) > 0 ? fmtPct(p.value) : '-',
        },
    ], []);

    const agCols: ColDef<GAdsAssetGroupRow>[] = useMemo(() => [
        { field: 'assetGroupName', headerName: 'Asset Group', flex: 2, minWidth: 200 },
        { field: 'campaignName', headerName: 'Campaign', flex: 2, minWidth: 180 },
        { field: 'spend', headerName: 'Spend', valueFormatter: (p: ValueFormatterParams) => formatCurrency(p.value), width: 110, sort: 'desc' as const },
        { field: 'impressions', headerName: 'Impr', valueFormatter: (p: ValueFormatterParams) => fmt(p.value), width: 90 },
        { field: 'clicks', headerName: 'Clicks', valueFormatter: (p: ValueFormatterParams) => fmt(p.value), width: 80 },
        { field: 'ctr', headerName: 'CTR', valueFormatter: (p: ValueFormatterParams) => fmtPct(p.value), width: 75 },
        { field: 'cpc', headerName: 'CPC', valueFormatter: (p: ValueFormatterParams) => `₹${Number(p.value).toFixed(1)}`, width: 75 },
        { field: 'conversions', headerName: 'Conv', valueFormatter: (p: ValueFormatterParams) => Number(p.value) > 0 ? Number(p.value).toFixed(1) : '-', width: 70 },
        {
            field: 'roas', headerName: 'ROAS', width: 80,
            valueFormatter: (p: ValueFormatterParams) => p.value > 0 ? `${Number(p.value).toFixed(2)}x` : '-',
            cellStyle: (params: { value: number }) => roasStyle(params.value),
        },
    ], []);

    const funnelCols: ColDef<GAdsProductFunnelRow>[] = useMemo(() => [
        { field: 'productType', headerName: 'Product Type', flex: 2, minWidth: 200 },
        { field: 'views', headerName: 'Views', valueFormatter: (p: ValueFormatterParams) => fmt(p.value), width: 90 },
        { field: 'addToCarts', headerName: 'Add to Cart', valueFormatter: (p: ValueFormatterParams) => fmt(p.value), width: 100 },
        { field: 'purchases', headerName: 'Purchases', valueFormatter: (p: ValueFormatterParams) => fmt(p.value), width: 100 },
        { field: 'purchaseValue', headerName: 'Purchase Value', valueFormatter: (p: ValueFormatterParams) => formatCurrency(p.value), width: 130, sort: 'desc' as const },
        { field: 'viewToAtcRate', headerName: 'View→ATC', valueFormatter: (p: ValueFormatterParams) => fmtPct(p.value), width: 100 },
        {
            field: 'atcToPurchaseRate', headerName: 'ATC→Purchase', width: 120,
            valueFormatter: (p: ValueFormatterParams) => fmtPct(p.value),
            cellStyle: (params: { value: number }) => {
                if (params.value >= 10) return { color: '#16a34a', fontWeight: 600 };
                if (params.value >= 5) return { color: '#d97706', fontWeight: 600 };
                return params.value > 0 ? { color: '#dc2626', fontWeight: 600 } : null;
            },
        },
    ], []);

    if (isLoading) return <GridSkeleton />;
    if (error) return <ErrorState error={error} />;

    const top10 = (data ?? []).slice(0, 10);
    const agData = assetGroups.data ?? [];
    const funnelData = funnel.data ?? [];

    return (
        <div className="space-y-6">
            {top10.length > 0 && (
                <div className="bg-white rounded-lg border border-stone-200 shadow-sm p-4 sm:p-6">
                    <h3 className="text-sm font-semibold text-stone-700 mb-4">Top Products by Spend</h3>
                    <ResponsiveContainer width="100%" height={280}>
                        <ComposedChart data={top10} layout="vertical">
                            <CartesianGrid strokeDasharray="3 3" stroke="#e7e5e4" />
                            <XAxis type="number" tick={{ fill: '#78716c', fontSize: 11 }} />
                            <YAxis
                                dataKey="productType" type="category" width={160}
                                tick={{ fill: '#78716c', fontSize: 11 }}
                                tickFormatter={(v: string) => v.length > 22 ? v.slice(0, 22) + '...' : v}
                            />
                            <Tooltip formatter={(value: number | undefined, name?: string) => [name === 'roas' ? `${(value ?? 0).toFixed(2)}x` : formatCurrency(value ?? 0), name === 'roas' ? 'ROAS' : 'Spend']} />
                            <Bar dataKey="spend" fill="#4285F4" name="Spend" radius={[0, 2, 2, 0]} />
                            <Line dataKey="roas" stroke="#34A853" strokeWidth={2} dot={{ r: 3 }} name="roas" />
                        </ComposedChart>
                    </ResponsiveContainer>
                </div>
            )}

            <div className="bg-white rounded-lg border border-stone-200 shadow-sm p-4 sm:p-6">
                <h3 className="text-sm font-semibold text-stone-700 mb-4">Shopping Product Performance</h3>
                {data?.length ? (
                    <div className="ag-theme-custom" style={{ height: 400 }}>
                        <AgGridReact<GAdsProductRow>
                            rowData={data}
                            columnDefs={cols}
                            theme={compactThemeSmall}
                            defaultColDef={DEFAULT_COL_DEF}
                            animateRows
                        />
                    </div>
                ) : <EmptyState message="No product data for this period" />}
            </div>

            <div className="bg-white rounded-lg border border-stone-200 shadow-sm p-4 sm:p-6">
                <h3 className="text-sm font-semibold text-stone-700 mb-4">PMax Asset Groups</h3>
                {agData.length ? (
                    <div className="ag-theme-custom" style={{ height: 350 }}>
                        <AgGridReact<GAdsAssetGroupRow>
                            rowData={agData}
                            columnDefs={agCols}
                            theme={compactThemeSmall}
                            defaultColDef={DEFAULT_COL_DEF}
                            animateRows
                        />
                    </div>
                ) : assetGroups.isLoading ? <Skeleton className="h-64 w-full" /> : <EmptyState message="No PMax asset group data for this period" />}
            </div>

            <div className="bg-white rounded-lg border border-stone-200 shadow-sm p-4 sm:p-6">
                <h3 className="text-sm font-semibold text-stone-700 mb-4">Conversion Funnel by Product Type</h3>
                {funnelData.length > 0 ? (
                    <>
                        <div className="mb-4">
                            <ResponsiveContainer width="100%" height={280}>
                                <BarChart data={funnelData.slice(0, 8)} layout="vertical">
                                    <CartesianGrid strokeDasharray="3 3" stroke="#e7e5e4" />
                                    <XAxis type="number" tick={{ fill: '#78716c', fontSize: 11 }} />
                                    <YAxis
                                        dataKey="productType" type="category" width={160}
                                        tick={{ fill: '#78716c', fontSize: 11 }}
                                        tickFormatter={(v: string) => v.length > 22 ? v.slice(0, 22) + '...' : v}
                                    />
                                    <Tooltip formatter={(value: number | undefined) => [fmt(value ?? 0)]} />
                                    <Bar dataKey="views" fill={FUNNEL_COLORS[0]} name="Views" stackId="a" />
                                    <Bar dataKey="addToCarts" fill={FUNNEL_COLORS[1]} name="Add to Cart" stackId="b" />
                                    <Bar dataKey="purchases" fill={FUNNEL_COLORS[2]} name="Purchases" stackId="c" />
                                </BarChart>
                            </ResponsiveContainer>
                        </div>
                        <div className="ag-theme-custom" style={{ height: 350 }}>
                            <AgGridReact<GAdsProductFunnelRow>
                                rowData={funnelData}
                                columnDefs={funnelCols}
                                theme={compactThemeSmall}
                                defaultColDef={DEFAULT_COL_DEF}
                                animateRows
                            />
                        </div>
                    </>
                ) : funnel.isLoading ? <Skeleton className="h-64 w-full" /> : <EmptyState message="No conversion funnel data for this period" />}
            </div>
        </div>
    );
}

// ============================================
// CREATIVES SUB-TAB
// ============================================

const STRENGTH_COLORS: Record<string, string> = {
    EXCELLENT: '#16a34a',
    GOOD: '#65a30d',
    AVERAGE: '#d97706',
    POOR: '#dc2626',
};

function CreativesSubTab({ days }: { days: number }) {
    const { data, isLoading, error } = useGAdsCreatives(days);

    const cols: ColDef<GAdsCreativeRow>[] = useMemo(() => [
        {
            field: 'adType', headerName: 'Type', width: 160,
            valueFormatter: (p: ValueFormatterParams) => {
                const v = String(p.value ?? '');
                return v.split(' ').map((w: string) => w.charAt(0) + w.slice(1).toLowerCase()).join(' ');
            },
        },
        {
            field: 'adStrength', headerName: 'Strength', width: 100,
            cellStyle: (params: { value: string }) => {
                const color = STRENGTH_COLORS[params.value];
                return color ? { color, fontWeight: 600 } : null;
            },
        },
        {
            field: 'headlines', headerName: 'Headlines', flex: 3, minWidth: 250,
            valueFormatter: (p: ValueFormatterParams) => {
                const arr = p.value as string[];
                return arr?.length ? arr.slice(0, 3).join(' | ') : '-';
            },
        },
        { field: 'spend', headerName: 'Spend', valueFormatter: (p: ValueFormatterParams) => formatCurrency(p.value), width: 110, sort: 'desc' as const },
        { field: 'impressions', headerName: 'Impr', valueFormatter: (p: ValueFormatterParams) => fmt(p.value), width: 90 },
        { field: 'clicks', headerName: 'Clicks', valueFormatter: (p: ValueFormatterParams) => fmt(p.value), width: 80 },
        { field: 'ctr', headerName: 'CTR', valueFormatter: (p: ValueFormatterParams) => fmtPct(p.value), width: 75 },
        { field: 'cpc', headerName: 'CPC', valueFormatter: (p: ValueFormatterParams) => `₹${Number(p.value).toFixed(1)}`, width: 75 },
        { field: 'conversions', headerName: 'Conv', valueFormatter: (p: ValueFormatterParams) => Number(p.value) > 0 ? Number(p.value).toFixed(1) : '-', width: 70 },
        {
            field: 'roas', headerName: 'ROAS', width: 80,
            valueFormatter: (p: ValueFormatterParams) => p.value > 0 ? `${Number(p.value).toFixed(2)}x` : '-',
            cellStyle: (params: { value: number }) => roasStyle(params.value),
        },
    ], []);

    if (isLoading) return <GridSkeleton />;
    if (error) return <ErrorState error={error} />;
    if (!data?.length) return <EmptyState message="No creative data for this period" />;

    // Ad type breakdown
    const typeMap = new Map<string, { spend: number; clicks: number; impressions: number }>();
    for (const ad of data) {
        const existing = typeMap.get(ad.adType) ?? { spend: 0, clicks: 0, impressions: 0 };
        existing.spend += ad.spend;
        existing.clicks += ad.clicks;
        existing.impressions += ad.impressions;
        typeMap.set(ad.adType, existing);
    }
    const typeData = Array.from(typeMap.entries()).map(([type, m]) => ({
        type: type.split(' ').map((w: string) => w.charAt(0) + w.slice(1).toLowerCase()).join(' '),
        spend: m.spend,
        ctr: m.impressions > 0 ? Math.round((m.clicks / m.impressions) * 10000) / 100 : 0,
    })).sort((a, b) => b.spend - a.spend);

    // Strength distribution
    const strengthMap = new Map<string, number>();
    for (const ad of data) {
        strengthMap.set(ad.adStrength, (strengthMap.get(ad.adStrength) ?? 0) + 1);
    }

    return (
        <div className="space-y-6">
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                <div className="bg-white rounded-lg border border-stone-200 shadow-sm p-4 sm:p-6">
                    <h3 className="text-sm font-semibold text-stone-700 mb-4">Spend by Ad Type</h3>
                    <ResponsiveContainer width="100%" height={200}>
                        <BarChart data={typeData} layout="vertical">
                            <CartesianGrid strokeDasharray="3 3" stroke="#e7e5e4" />
                            <XAxis type="number" tick={{ fill: '#78716c', fontSize: 11 }} />
                            <YAxis dataKey="type" type="category" width={160} tick={{ fill: '#78716c', fontSize: 11 }} />
                            <Tooltip formatter={(v: number | undefined) => formatCurrency(v ?? 0)} />
                            <Bar dataKey="spend" fill="#4285F4" name="Spend" radius={[0, 2, 2, 0]} />
                        </BarChart>
                    </ResponsiveContainer>
                </div>

                <div className="bg-white rounded-lg border border-stone-200 shadow-sm p-4 sm:p-6">
                    <h3 className="text-sm font-semibold text-stone-700 mb-4">Ad Strength Distribution</h3>
                    <div className="space-y-3 mt-4">
                        {['EXCELLENT', 'GOOD', 'AVERAGE', 'POOR', 'N/A'].map(strength => {
                            const count = strengthMap.get(strength) ?? 0;
                            if (count === 0) return null;
                            const pct = data.length > 0 ? (count / data.length) * 100 : 0;
                            return (
                                <div key={strength} className="flex items-center gap-3">
                                    <span className="text-xs font-medium w-20" style={{ color: STRENGTH_COLORS[strength] ?? '#78716c' }}>
                                        {strength.charAt(0) + strength.slice(1).toLowerCase()}
                                    </span>
                                    <div className="flex-1 bg-stone-100 rounded-full h-2">
                                        <div className="h-2 rounded-full" style={{ width: `${pct}%`, backgroundColor: STRENGTH_COLORS[strength] ?? '#a8a29e' }} />
                                    </div>
                                    <span className="text-xs text-stone-500 w-8 text-right">{count}</span>
                                </div>
                            );
                        })}
                    </div>
                </div>
            </div>

            <div className="bg-white rounded-lg border border-stone-200 shadow-sm p-4 sm:p-6">
                <h3 className="text-sm font-semibold text-stone-700 mb-4">Ad Creative Performance</h3>
                <div className="ag-theme-custom" style={{ height: 450 }}>
                    <AgGridReact<GAdsCreativeRow>
                        rowData={data}
                        columnDefs={cols}
                        theme={compactThemeSmall}
                        defaultColDef={DEFAULT_COL_DEF}
                        animateRows
                    />
                </div>
            </div>
        </div>
    );
}

// ============================================
// VIDEO SUB-TAB
// ============================================

function VideoSubTab({ days }: { days: number }) {
    const { data, isLoading, error } = useGAdsVideos(days);

    const cols: ColDef<GAdsVideoRow>[] = useMemo(() => [
        { field: 'videoTitle', headerName: 'Video', flex: 3, minWidth: 250 },
        {
            field: 'durationSec', headerName: 'Duration', width: 90,
            valueFormatter: (p: ValueFormatterParams) => {
                const s = Number(p.value);
                return s >= 60 ? `${Math.floor(s / 60)}:${(s % 60).toString().padStart(2, '0')}` : `${s}s`;
            },
        },
        { field: 'spend', headerName: 'Spend', valueFormatter: (p: ValueFormatterParams) => formatCurrency(p.value), width: 110, sort: 'desc' as const },
        { field: 'impressions', headerName: 'Views', valueFormatter: (p: ValueFormatterParams) => fmt(p.value), width: 100 },
        { field: 'clicks', headerName: 'Clicks', valueFormatter: (p: ValueFormatterParams) => fmt(p.value), width: 80 },
        { field: 'ctr', headerName: 'CTR', valueFormatter: (p: ValueFormatterParams) => fmtPct(p.value), width: 75 },
        { field: 'cpc', headerName: 'CPC', valueFormatter: (p: ValueFormatterParams) => `₹${Number(p.value).toFixed(1)}`, width: 75 },
        { field: 'conversions', headerName: 'Conv', valueFormatter: (p: ValueFormatterParams) => Number(p.value) > 0 ? Number(p.value).toFixed(1) : '-', width: 70 },
        {
            field: 'roas', headerName: 'ROAS', width: 80,
            valueFormatter: (p: ValueFormatterParams) => p.value > 0 ? `${Number(p.value).toFixed(2)}x` : '-',
            cellStyle: (params: { value: number }) => roasStyle(params.value),
        },
    ], []);

    if (isLoading) return <GridSkeleton />;
    if (error) return <ErrorState error={error} />;
    if (!data?.length) return <EmptyState message="No video data for this period" />;

    // Summary KPIs
    const totalSpend = data.reduce((s, r) => s + r.spend, 0);
    const totalViews = data.reduce((s, r) => s + r.impressions, 0);
    const totalClicks = data.reduce((s, r) => s + r.clicks, 0);
    const avgCPV = totalViews > 0 ? totalSpend / totalViews : 0;

    // Top 5 videos by spend for chart
    const top5 = data.slice(0, 5).map(v => ({
        title: v.videoTitle.length > 35 ? v.videoTitle.slice(0, 35) + '...' : v.videoTitle,
        spend: v.spend,
        clicks: v.clicks,
    }));

    return (
        <div className="space-y-6">
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
                <KPICard label="Video Spend" value={formatCurrency(totalSpend)} />
                <KPICard label="Total Views" value={fmt(totalViews)} />
                <KPICard label="Clicks" value={fmt(totalClicks)} subtext={totalViews > 0 ? `CTR ${fmtPct((totalClicks / totalViews) * 100)}` : undefined} />
                <KPICard label="Avg CPV" value={`₹${avgCPV.toFixed(2)}`} subtext="cost per view" />
            </div>

            {top5.length > 0 && (
                <div className="bg-white rounded-lg border border-stone-200 shadow-sm p-4 sm:p-6">
                    <h3 className="text-sm font-semibold text-stone-700 mb-4">Top Videos by Spend</h3>
                    <ResponsiveContainer width="100%" height={220}>
                        <BarChart data={top5} layout="vertical">
                            <CartesianGrid strokeDasharray="3 3" stroke="#e7e5e4" />
                            <XAxis type="number" tick={{ fill: '#78716c', fontSize: 11 }} />
                            <YAxis dataKey="title" type="category" width={220} tick={{ fill: '#78716c', fontSize: 10 }} />
                            <Tooltip formatter={(v: number | undefined) => formatCurrency(v ?? 0)} />
                            <Bar dataKey="spend" fill="#EA4335" name="Spend" radius={[0, 2, 2, 0]} />
                        </BarChart>
                    </ResponsiveContainer>
                </div>
            )}

            <div className="bg-white rounded-lg border border-stone-200 shadow-sm p-4 sm:p-6">
                <h3 className="text-sm font-semibold text-stone-700 mb-4">Video Performance</h3>
                <div className="ag-theme-custom" style={{ height: 400 }}>
                    <AgGridReact<GAdsVideoRow>
                        rowData={data}
                        columnDefs={cols}
                        theme={compactThemeSmall}
                        defaultColDef={DEFAULT_COL_DEF}
                        animateRows
                    />
                </div>
            </div>
        </div>
    );
}

// ============================================
// SEARCH SUB-TAB
// ============================================

function SearchSubTab({ days }: { days: number }) {
    const searchTerms = useGAdsSearchTerms(days);
    const keywords = useGAdsKeywords(days);
    const searchConv = useGAdsSearchConversions(days);

    const stCols: ColDef<GAdsSearchTermRow>[] = useMemo(() => [
        { field: 'searchTerm', headerName: 'Search Term', flex: 2, minWidth: 200 },
        { field: 'matchType', headerName: 'Match', width: 110 },
        { field: 'spend', headerName: 'Spend', valueFormatter: (p: ValueFormatterParams) => formatCurrency(p.value), width: 100, sort: 'desc' as const },
        { field: 'impressions', headerName: 'Impr', valueFormatter: (p: ValueFormatterParams) => fmt(p.value), width: 80 },
        { field: 'clicks', headerName: 'Clicks', valueFormatter: (p: ValueFormatterParams) => fmt(p.value), width: 75 },
        { field: 'ctr', headerName: 'CTR', valueFormatter: (p: ValueFormatterParams) => fmtPct(p.value), width: 75 },
        { field: 'cpc', headerName: 'CPC', valueFormatter: (p: ValueFormatterParams) => `₹${Number(p.value).toFixed(1)}`, width: 75 },
        { field: 'conversions', headerName: 'Conv', valueFormatter: (p: ValueFormatterParams) => Number(p.value) > 0 ? Number(p.value).toFixed(1) : '-', width: 70 },
        {
            field: 'roas', headerName: 'ROAS', width: 80,
            valueFormatter: (p: ValueFormatterParams) => p.value > 0 ? `${Number(p.value).toFixed(2)}x` : '-',
            cellStyle: (params: { value: number }) => roasStyle(params.value),
        },
    ], []);

    const kwCols: ColDef<GAdsKeywordRow>[] = useMemo(() => [
        { field: 'keyword', headerName: 'Keyword', flex: 2, minWidth: 200 },
        { field: 'matchType', headerName: 'Match', width: 100 },
        {
            field: 'qualityScore', headerName: 'QS', width: 60,
            valueFormatter: (p: ValueFormatterParams) => p.value != null ? String(p.value) : '-',
            cellStyle: (params: { value: number | null }) => {
                if (params.value == null) return null;
                if (params.value >= 7) return { color: '#16a34a', fontWeight: 600 };
                if (params.value >= 5) return { color: '#d97706', fontWeight: 600 };
                return { color: '#dc2626', fontWeight: 600 };
            },
        },
        { field: 'spend', headerName: 'Spend', valueFormatter: (p: ValueFormatterParams) => formatCurrency(p.value), width: 100, sort: 'desc' as const },
        { field: 'impressions', headerName: 'Impr', valueFormatter: (p: ValueFormatterParams) => fmt(p.value), width: 80 },
        { field: 'clicks', headerName: 'Clicks', valueFormatter: (p: ValueFormatterParams) => fmt(p.value), width: 75 },
        { field: 'ctr', headerName: 'CTR', valueFormatter: (p: ValueFormatterParams) => fmtPct(p.value), width: 75 },
        { field: 'cpc', headerName: 'CPC', valueFormatter: (p: ValueFormatterParams) => `₹${Number(p.value).toFixed(1)}`, width: 75 },
        {
            field: 'roas', headerName: 'ROAS', width: 80,
            valueFormatter: (p: ValueFormatterParams) => p.value > 0 ? `${Number(p.value).toFixed(2)}x` : '-',
            cellStyle: (params: { value: number }) => roasStyle(params.value),
        },
    ], []);

    const scCols: ColDef<GAdsSearchConversionRow>[] = useMemo(() => [
        { field: 'searchTerm', headerName: 'Search Term', flex: 2, minWidth: 200 },
        { field: 'action', headerName: 'Conversion Action', flex: 2, minWidth: 180 },
        { field: 'conversions', headerName: 'Conversions', valueFormatter: (p: ValueFormatterParams) => Number(p.value).toFixed(1), width: 110, sort: 'desc' as const },
        { field: 'conversionValue', headerName: 'Value', valueFormatter: (p: ValueFormatterParams) => formatCurrency(p.value), width: 120 },
    ], []);

    if (searchTerms.isLoading || keywords.isLoading) return <div className="space-y-6"><GridSkeleton /><GridSkeleton /></div>;
    if (searchTerms.error) return <ErrorState error={searchTerms.error} />;

    return (
        <div className="space-y-6">
            <div className="bg-white rounded-lg border border-stone-200 shadow-sm p-4 sm:p-6">
                <h3 className="text-sm font-semibold text-stone-700 mb-4">Search Terms</h3>
                {searchTerms.data?.length ? (
                    <div className="ag-theme-custom" style={{ height: 350 }}>
                        <AgGridReact<GAdsSearchTermRow>
                            rowData={searchTerms.data}
                            columnDefs={stCols}
                            theme={compactThemeSmall}
                            defaultColDef={DEFAULT_COL_DEF}
                            animateRows
                        />
                    </div>
                ) : <EmptyState message="No search term data for this period" />}
            </div>

            <div className="bg-white rounded-lg border border-stone-200 shadow-sm p-4 sm:p-6">
                <h3 className="text-sm font-semibold text-stone-700 mb-4">Keywords</h3>
                {keywords.data?.length ? (
                    <div className="ag-theme-custom" style={{ height: 350 }}>
                        <AgGridReact<GAdsKeywordRow>
                            rowData={keywords.data}
                            columnDefs={kwCols}
                            theme={compactThemeSmall}
                            defaultColDef={DEFAULT_COL_DEF}
                            animateRows
                        />
                    </div>
                ) : <EmptyState message="No keyword data for this period" />}
            </div>

            <div className="bg-white rounded-lg border border-stone-200 shadow-sm p-4 sm:p-6">
                <h3 className="text-sm font-semibold text-stone-700 mb-4">Search Term Conversions by Action</h3>
                {searchConv.data?.length ? (
                    <div className="ag-theme-custom" style={{ height: 350 }}>
                        <AgGridReact<GAdsSearchConversionRow>
                            rowData={searchConv.data}
                            columnDefs={scCols}
                            theme={compactThemeSmall}
                            defaultColDef={DEFAULT_COL_DEF}
                            animateRows
                        />
                    </div>
                ) : searchConv.isLoading ? <Skeleton className="h-64 w-full" /> : <EmptyState message="No search conversion data for this period" />}
            </div>
        </div>
    );
}

// ============================================
// AUDIENCE SUB-TAB (Device + Age + Gender + Segments)
// ============================================

const DEVICE_COLORS: Record<string, string> = {
    MOBILE: '#4285F4',
    DESKTOP: '#34A853',
    TABLET: '#FBBC05',
    CONNECTED_TV: '#EA4335',
};

function AudienceSubTab({ days }: { days: number }) {
    const devices = useGAdsDevices(days);
    const age = useGAdsAge(days);
    const gender = useGAdsGender(days);
    const segments = useGAdsAudienceSegments(days);

    const segCols: ColDef<GAdsAudienceSegmentRow>[] = useMemo(() => [
        { field: 'campaignName', headerName: 'Campaign', flex: 2, minWidth: 200 },
        { field: 'criterionId', headerName: 'Audience ID', width: 130 },
        { field: 'spend', headerName: 'Spend', valueFormatter: (p: ValueFormatterParams) => formatCurrency(p.value), width: 110, sort: 'desc' as const },
        { field: 'impressions', headerName: 'Impr', valueFormatter: (p: ValueFormatterParams) => fmt(p.value), width: 90 },
        { field: 'clicks', headerName: 'Clicks', valueFormatter: (p: ValueFormatterParams) => fmt(p.value), width: 80 },
        { field: 'ctr', headerName: 'CTR', valueFormatter: (p: ValueFormatterParams) => fmtPct(p.value), width: 75 },
        { field: 'cpc', headerName: 'CPC', valueFormatter: (p: ValueFormatterParams) => `₹${Number(p.value).toFixed(1)}`, width: 75 },
        {
            field: 'roas', headerName: 'ROAS', width: 80,
            valueFormatter: (p: ValueFormatterParams) => p.value > 0 ? `${Number(p.value).toFixed(2)}x` : '-',
            cellStyle: (params: { value: number }) => roasStyle(params.value),
        },
    ], []);

    if (devices.isLoading || age.isLoading || gender.isLoading) {
        return <div className="space-y-6"><ChartSkeleton /><ChartSkeleton /><ChartSkeleton /></div>;
    }
    if (devices.error) return <ErrorState error={devices.error} />;

    const deviceData = devices.data ?? [];
    const ageData = (age.data ?? []).filter(r => r.ageRange !== 'Undetermined');
    const genderData = (gender.data ?? []).filter(r => r.gender !== 'Undetermined');
    const segData = segments.data ?? [];

    return (
        <div className="space-y-6">
            {/* Device breakdown */}
            <div className="bg-white rounded-lg border border-stone-200 shadow-sm p-4 sm:p-6">
                <h3 className="text-sm font-semibold text-stone-700 mb-4">Performance by Device</h3>
                {deviceData.length ? (
                    <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                        <ResponsiveContainer width="100%" height={220}>
                            <BarChart data={deviceData} layout="vertical">
                                <CartesianGrid strokeDasharray="3 3" stroke="#e7e5e4" />
                                <XAxis type="number" tick={{ fill: '#78716c', fontSize: 11 }} />
                                <YAxis dataKey="device" type="category" width={120} tick={{ fill: '#78716c', fontSize: 11 }}
                                    tickFormatter={(v: string) => v.charAt(0) + v.slice(1).toLowerCase().replace('_', ' ')} />
                                <Tooltip formatter={(v: number | undefined) => formatCurrency(v ?? 0)} />
                                <Bar dataKey="spend" name="Spend" radius={[0, 2, 2, 0]}>
                                    {deviceData.map((d, i) => (
                                        <Cell key={i} fill={DEVICE_COLORS[d.device] ?? '#78716c'} />
                                    ))}
                                </Bar>
                            </BarChart>
                        </ResponsiveContainer>
                        <div className="space-y-3">
                            {deviceData.map(d => (
                                <div key={d.device} className="flex items-center justify-between text-sm">
                                    <span className="text-stone-600">{d.device.charAt(0) + d.device.slice(1).toLowerCase().replace('_', ' ')}</span>
                                    <div className="flex gap-4 text-stone-500">
                                        <span>{fmt(d.clicks)} clicks</span>
                                        <span>CTR {fmtPct(d.ctr)}</span>
                                        <span className={d.roas >= 3 ? 'text-green-600 font-medium' : d.roas >= 1.5 ? 'text-amber-600 font-medium' : 'text-red-600 font-medium'}>
                                            {d.roas > 0 ? `${d.roas.toFixed(2)}x` : '-'}
                                        </span>
                                    </div>
                                </div>
                            ))}
                        </div>
                    </div>
                ) : <EmptyState message="No device data for this period" />}
            </div>

            {/* Age breakdown */}
            <div className="bg-white rounded-lg border border-stone-200 shadow-sm p-4 sm:p-6">
                <h3 className="text-sm font-semibold text-stone-700 mb-4">Performance by Age</h3>
                {ageData.length ? (
                    <ResponsiveContainer width="100%" height={280}>
                        <ComposedChart data={ageData}>
                            <CartesianGrid strokeDasharray="3 3" stroke="#e7e5e4" />
                            <XAxis dataKey="ageRange" tick={{ fill: '#78716c', fontSize: 11 }} />
                            <YAxis yAxisId="left" tick={{ fill: '#78716c', fontSize: 11 }} />
                            <YAxis yAxisId="right" orientation="right" tick={{ fill: '#78716c', fontSize: 11 }} />
                            <Tooltip formatter={(v: number | undefined, name?: string) => [name === 'roas' ? `${(v ?? 0).toFixed(2)}x` : formatCurrency(v ?? 0), name === 'roas' ? 'ROAS' : 'Spend']} />
                            <Bar yAxisId="left" dataKey="spend" fill="#4285F4" name="Spend" radius={[2, 2, 0, 0]} />
                            <Line yAxisId="right" dataKey="roas" stroke="#34A853" strokeWidth={2} dot={{ r: 3 }} name="roas" />
                        </ComposedChart>
                    </ResponsiveContainer>
                ) : <EmptyState message="No age data for this period" />}
            </div>

            {/* Gender breakdown */}
            <div className="bg-white rounded-lg border border-stone-200 shadow-sm p-4 sm:p-6">
                <h3 className="text-sm font-semibold text-stone-700 mb-4">Performance by Gender</h3>
                {genderData.length ? (
                    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                        {genderData.map(g => (
                            <div key={g.gender} className="border border-stone-200 rounded-lg p-4">
                                <p className="text-xs font-medium text-stone-500 uppercase tracking-wide">{g.gender}</p>
                                <p className="text-xl font-semibold text-stone-900 mt-1">{formatCurrency(g.spend)}</p>
                                <div className="flex gap-3 mt-2 text-xs text-stone-500">
                                    <span>{fmt(g.clicks)} clicks</span>
                                    <span>CTR {fmtPct(g.ctr)}</span>
                                    <span className={g.roas >= 3 ? 'text-green-600 font-medium' : g.roas >= 1.5 ? 'text-amber-600 font-medium' : g.roas > 0 ? 'text-red-600 font-medium' : ''}>
                                        ROAS {g.roas > 0 ? `${g.roas.toFixed(2)}x` : '-'}
                                    </span>
                                </div>
                            </div>
                        ))}
                    </div>
                ) : <EmptyState message="No gender data for this period" />}
            </div>

            {/* Audience segments */}
            {segData.length > 0 && (
                <div className="bg-white rounded-lg border border-stone-200 shadow-sm p-4 sm:p-6">
                    <h3 className="text-sm font-semibold text-stone-700 mb-4">Audience Segments</h3>
                    <div className="ag-theme-custom" style={{ height: 300 }}>
                        <AgGridReact<GAdsAudienceSegmentRow>
                            rowData={segData}
                            columnDefs={segCols}
                            theme={compactThemeSmall}
                            defaultColDef={DEFAULT_COL_DEF}
                            animateRows
                        />
                    </div>
                </div>
            )}
        </div>
    );
}

// ============================================
// GEOGRAPHY SUB-TAB
// ============================================

function GeoSubTab({ days }: { days: number }) {
    const { data, isLoading, error } = useGAdsGeo(days);

    const cols: ColDef<GAdsGeoRow>[] = useMemo(() => [
        { field: 'locationName', headerName: 'Location', flex: 2, minWidth: 180 },
        { field: 'campaignName', headerName: 'Campaign', flex: 2, minWidth: 200 },
        { field: 'spend', headerName: 'Spend', valueFormatter: (p: ValueFormatterParams) => formatCurrency(p.value), width: 110, sort: 'desc' as const },
        { field: 'impressions', headerName: 'Impr', valueFormatter: (p: ValueFormatterParams) => fmt(p.value), width: 90 },
        { field: 'clicks', headerName: 'Clicks', valueFormatter: (p: ValueFormatterParams) => fmt(p.value), width: 80 },
        { field: 'ctr', headerName: 'CTR', valueFormatter: (p: ValueFormatterParams) => fmtPct(p.value), width: 75 },
        { field: 'cpc', headerName: 'CPC', valueFormatter: (p: ValueFormatterParams) => `₹${Number(p.value).toFixed(1)}`, width: 75 },
        { field: 'conversions', headerName: 'Conv', valueFormatter: (p: ValueFormatterParams) => Number(p.value) > 0 ? Number(p.value).toFixed(1) : '-', width: 70 },
        { field: 'conversionValue', headerName: 'Revenue', valueFormatter: (p: ValueFormatterParams) => formatCurrency(p.value), width: 110 },
        {
            field: 'roas', headerName: 'ROAS', width: 80,
            valueFormatter: (p: ValueFormatterParams) => p.value > 0 ? `${Number(p.value).toFixed(2)}x` : '-',
            cellStyle: (params: { value: number }) => roasStyle(params.value),
        },
    ], []);

    if (isLoading) return <GridSkeleton />;
    if (error) return <ErrorState error={error} />;
    if (!data?.length) return <EmptyState message="No geographic data for this period" />;

    return (
        <div className="space-y-6">
            <div className="bg-white rounded-lg border border-stone-200 shadow-sm p-4 sm:p-6">
                <h3 className="text-sm font-semibold text-stone-700 mb-4">Geographic Performance</h3>
                <div className="ag-theme-custom" style={{ height: 500 }}>
                    <AgGridReact<GAdsGeoRow>
                        rowData={data}
                        columnDefs={cols}
                        theme={compactThemeSmall}
                        defaultColDef={DEFAULT_COL_DEF}
                        animateRows
                    />
                </div>
            </div>
        </div>
    );
}

// ============================================
// SCHEDULE SUB-TAB (Heatmap)
// ============================================

const DAY_ORDER = ['MONDAY', 'TUESDAY', 'WEDNESDAY', 'THURSDAY', 'FRIDAY', 'SATURDAY', 'SUNDAY'];
const DAY_SHORT: Record<string, string> = {
    MONDAY: 'Mon', TUESDAY: 'Tue', WEDNESDAY: 'Wed', THURSDAY: 'Thu',
    FRIDAY: 'Fri', SATURDAY: 'Sat', SUNDAY: 'Sun',
};

type HeatmapMetric = 'spend' | 'ctr' | 'clicks';

function ScheduleSubTab({ days }: { days: number }) {
    const { data, isLoading, error } = useGAdsHourly(days);
    const [metric, setMetric] = useState<HeatmapMetric>('spend');

    if (isLoading) return <ChartSkeleton />;
    if (error) return <ErrorState error={error} />;
    if (!data?.length) return <EmptyState message="No hourly data for this period" />;

    // Build hour × day matrix
    const matrix: Record<string, Record<number, number>> = {};
    let maxVal = 0;
    for (const day of DAY_ORDER) matrix[day] = {};

    for (const r of data) {
        const val = metric === 'spend' ? r.spend : metric === 'ctr' ? r.ctr : r.clicks;
        if (matrix[r.dayOfWeek]) {
            matrix[r.dayOfWeek][r.hour] = (matrix[r.dayOfWeek][r.hour] ?? 0) + val;
            maxVal = Math.max(maxVal, matrix[r.dayOfWeek][r.hour]);
        }
    }

    // Find best cell
    let bestDay = '';
    let bestHour = 0;
    let bestVal = 0;
    for (const day of DAY_ORDER) {
        for (let h = 0; h < 24; h++) {
            const v = matrix[day]?.[h] ?? 0;
            if (v > bestVal) { bestDay = day; bestHour = h; bestVal = v; }
        }
    }

    function cellColor(value: number): string {
        if (maxVal === 0) return '#f5f5f4';
        const intensity = value / maxVal;
        const r = Math.round(255 - intensity * (255 - 66));
        const g = Math.round(255 - intensity * (255 - 133));
        const b = Math.round(255 - intensity * (255 - 244));
        return `rgb(${r}, ${g}, ${b})`;
    }

    function formatVal(v: number): string {
        if (metric === 'spend') return v >= 1000 ? `${(v / 1000).toFixed(1)}k` : v > 0 ? Math.round(v).toString() : '';
        if (metric === 'ctr') return v > 0 ? `${v.toFixed(1)}` : '';
        return v > 0 ? Math.round(v).toString() : '';
    }

    return (
        <div className="space-y-6">
            <div className="bg-white rounded-lg border border-stone-200 shadow-sm p-4 sm:p-6">
                <div className="flex items-center justify-between mb-4">
                    <h3 className="text-sm font-semibold text-stone-700">Hour × Day Heatmap</h3>
                    <div className="flex gap-1">
                        {(['spend', 'clicks', 'ctr'] as const).map(m => (
                            <button
                                key={m}
                                onClick={() => setMetric(m)}
                                className={`px-2.5 py-1 text-xs font-medium rounded-md transition-colors ${
                                    metric === m ? 'bg-stone-900 text-white' : 'bg-stone-100 text-stone-600 hover:bg-stone-200'
                                }`}
                            >
                                {m === 'spend' ? 'Spend' : m === 'ctr' ? 'CTR' : 'Clicks'}
                            </button>
                        ))}
                    </div>
                </div>
                <div className="overflow-x-auto">
                    <table className="w-full border-collapse text-xs">
                        <thead>
                            <tr>
                                <th className="p-1.5 text-left text-stone-500 font-medium w-12">Hour</th>
                                {DAY_ORDER.map(d => (
                                    <th key={d} className="p-1.5 text-center text-stone-500 font-medium">{DAY_SHORT[d]}</th>
                                ))}
                            </tr>
                        </thead>
                        <tbody>
                            {Array.from({ length: 24 }).map((_, h) => (
                                <tr key={h}>
                                    <td className="p-1.5 text-stone-500 font-mono">
                                        {h.toString().padStart(2, '0')}:00
                                    </td>
                                    {DAY_ORDER.map(d => {
                                        const v = matrix[d]?.[h] ?? 0;
                                        return (
                                            <td
                                                key={d}
                                                className="p-1.5 text-center font-mono"
                                                style={{
                                                    backgroundColor: cellColor(v),
                                                    color: v / maxVal > 0.5 ? '#fff' : '#78716c',
                                                    minWidth: 48,
                                                }}
                                                title={`${DAY_SHORT[d]} ${h}:00 — ${metric}: ${metric === 'spend' ? `₹${v.toFixed(0)}` : metric === 'ctr' ? `${v.toFixed(2)}%` : v}`}
                                            >
                                                {formatVal(v)}
                                            </td>
                                        );
                                    })}
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
                {bestDay && (
                    <p className="text-xs text-stone-500 mt-3">
                        Peak: <span className="font-medium text-stone-700">{DAY_SHORT[bestDay]} {bestHour}:00</span>
                        {' — '}
                        {metric === 'spend' ? `₹${bestVal.toFixed(0)}` : metric === 'ctr' ? `${bestVal.toFixed(2)}% CTR` : `${bestVal} clicks`}
                    </p>
                )}
            </div>
        </div>
    );
}

// ============================================
// LANDING PAGES SUB-TAB
// ============================================

function LandingPagesSubTab({ days }: { days: number }) {
    const { data, isLoading, error } = useGAdsLandingPages(days);

    const cols: ColDef<GAdsLandingPageRow>[] = useMemo(() => [
        {
            field: 'landingPageUrl', headerName: 'Landing Page', flex: 3, minWidth: 250,
            valueFormatter: (p: ValueFormatterParams) => truncateUrl(String(p.value)),
            tooltipField: 'landingPageUrl',
        },
        { field: 'campaignName', headerName: 'Campaign', flex: 2, minWidth: 180 },
        { field: 'adGroupName', headerName: 'Ad Group', flex: 1, minWidth: 140 },
        { field: 'clicks', headerName: 'Clicks', valueFormatter: (p: ValueFormatterParams) => fmt(p.value), width: 80, sort: 'desc' as const },
        { field: 'impressions', headerName: 'Impr', valueFormatter: (p: ValueFormatterParams) => fmt(p.value), width: 90 },
        { field: 'ctr', headerName: 'CTR', valueFormatter: (p: ValueFormatterParams) => fmtPct(p.value), width: 75 },
        { field: 'cpc', headerName: 'CPC', valueFormatter: (p: ValueFormatterParams) => `₹${Number(p.value).toFixed(1)}`, width: 75 },
        { field: 'spend', headerName: 'Spend', valueFormatter: (p: ValueFormatterParams) => formatCurrency(p.value), width: 110 },
    ], []);

    if (isLoading) return <GridSkeleton />;
    if (error) return <ErrorState error={error} />;
    if (!data?.length) return <EmptyState message="No landing page data for this period" />;

    return (
        <div className="space-y-6">
            <div className="bg-white rounded-lg border border-stone-200 shadow-sm p-4 sm:p-6">
                <h3 className="text-sm font-semibold text-stone-700 mb-4">Landing Page Performance</h3>
                <div className="ag-theme-custom" style={{ height: 500 }}>
                    <AgGridReact<GAdsLandingPageRow>
                        rowData={data}
                        columnDefs={cols}
                        theme={compactThemeSmall}
                        defaultColDef={DEFAULT_COL_DEF}
                        animateRows
                    />
                </div>
            </div>
        </div>
    );
}

// ============================================
// MAIN COMPONENT
// ============================================

export default function GoogleAdsAnalysis({ days }: { days: number }) {
    const [subTab, setSubTab] = useState<GAdsSubTab>('overview');

    return (
        <div className="space-y-5">
            <div className="flex gap-1 flex-wrap">
                {SUB_TABS.map(t => (
                    <button
                        key={t.key}
                        onClick={() => setSubTab(t.key)}
                        className={`px-3 py-1.5 text-sm font-medium rounded-md transition-colors ${
                            subTab === t.key
                                ? 'bg-[#4285F4] text-white'
                                : 'bg-stone-100 text-stone-600 hover:bg-stone-200'
                        }`}
                    >
                        {t.label}
                    </button>
                ))}
            </div>
            {subTab === 'overview' && <OverviewSubTab days={days} />}
            {subTab === 'competitive' && <CompetitiveSubTab days={days} />}
            {subTab === 'products' && <ProductsSubTab days={days} />}
            {subTab === 'creatives' && <CreativesSubTab days={days} />}
            {subTab === 'video' && <VideoSubTab days={days} />}
            {subTab === 'search' && <SearchSubTab days={days} />}
            {subTab === 'audience' && <AudienceSubTab days={days} />}
            {subTab === 'geography' && <GeoSubTab days={days} />}
            {subTab === 'schedule' && <ScheduleSubTab days={days} />}
            {subTab === 'landing-pages' && <LandingPagesSubTab days={days} />}
        </div>
    );
}
