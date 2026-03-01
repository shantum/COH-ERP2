/**
 * Meta Ads Analysis — Full D2C analytics suite
 *
 * Sub-tabs: Overview, Campaigns, Audience, Placements, Creative, Funnel
 * Data from Meta Marketing API via metaAdsClient.ts
 */

import React, { useState, useMemo } from 'react';
import {
    ComposedChart, Bar, Line, XAxis, YAxis, CartesianGrid,
    Tooltip, ResponsiveContainer,
} from 'recharts';
import { AgGridReact } from 'ag-grid-react';
import type { ColDef, ValueFormatterParams } from 'ag-grid-community';
import { AlertCircle } from 'lucide-react';
import {
    useMetaCampaigns, useMetaSummary, useMetaDailyTrend,
    useMetaAdsets, useMetaAds, useMetaAgeGender,
    useMetaPlacements, useMetaRegions, useMetaDevices,
    useMetaProducts,
} from '../hooks/useMetaAds';
import { compactThemeSmall } from '../utils/agGridHelpers';
import { formatCurrency } from '../utils/formatting';
import type {
    MetaCampaignRow, MetaAdsetRow, MetaAdRow,
    MetaAgeGenderRow, MetaPlacementRow, MetaRegionRow,
    MetaProductEnrichedRow,
} from '../server/functions/metaAds';

// ============================================
// SHARED HELPERS
// ============================================

type MetaSubTab = 'overview' | 'campaigns' | 'audience' | 'placements' | 'creative' | 'landing-page' | 'products' | 'funnel';

const SUB_TABS: { key: MetaSubTab; label: string }[] = [
    { key: 'overview', label: 'Overview' },
    { key: 'campaigns', label: 'Campaigns' },
    { key: 'audience', label: 'Audience' },
    { key: 'placements', label: 'Placements' },
    { key: 'creative', label: 'Creative' },
    { key: 'landing-page', label: 'Landing Page' },
    { key: 'products', label: 'Products' },
    { key: 'funnel', label: 'Funnel' },
];

const DEFAULT_COL_DEF = { sortable: true, resizable: true };

function fmt(v: number): string { return v.toLocaleString('en-IN'); }
function fmtPct(v: number): string { return `${v.toFixed(2)}%`; }
function fmtChartDate(dateStr: string): string {
    const [y, m, d] = dateStr.split('-').map(Number);
    return new Date(y, m - 1, d).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });
}

function RoasBadge({ value }: { value: number }) {
    if (value <= 0) return <span className="text-stone-400">-</span>;
    const color = value >= 3 ? 'text-green-600 bg-green-50' : value >= 1.5 ? 'text-amber-600 bg-amber-50' : 'text-red-600 bg-red-50';
    return <span className={`px-1.5 py-0.5 rounded text-xs font-semibold font-mono ${color}`}>{value.toFixed(2)}x</span>;
}

// ============================================
// SKELETONS
// ============================================

function Skeleton({ className = '' }: { className?: string }) {
    return <div className={`animate-pulse bg-stone-200 rounded ${className}`} />;
}

function KPISkeleton() {
    return (
        <div className="grid grid-cols-2 lg:grid-cols-5 gap-3">
            {Array.from({ length: 5 }).map((_, i) => (
                <div key={i} className="bg-white rounded-lg border border-stone-200 p-4">
                    <Skeleton className="h-3 w-16 mb-3" />
                    <Skeleton className="h-7 w-24" />
                </div>
            ))}
        </div>
    );
}

function ChartSkeleton() {
    return (
        <div className="bg-white rounded-lg border border-stone-200 p-5">
            <Skeleton className="h-4 w-40 mb-4" />
            <Skeleton className="h-64 w-full" />
        </div>
    );
}

function GridSkeleton() {
    return (
        <div className="bg-white rounded-lg border border-stone-200 p-5">
            <Skeleton className="h-4 w-48 mb-4" />
            <Skeleton className="h-80 w-full" />
        </div>
    );
}

function ErrorState({ error }: { error: Error | null | undefined }) {
    return (
        <div className="flex flex-col items-center justify-center py-16 text-center">
            <AlertCircle size={40} className="text-red-300 mb-4" />
            <h3 className="text-lg font-medium text-stone-700">Meta Ads data unavailable</h3>
            <p className="text-sm text-stone-400 mt-2 max-w-md">
                {error instanceof Error ? error.message : 'Failed to load data. Check server and env vars.'}
            </p>
        </div>
    );
}

// ============================================
// KPI CARD
// ============================================

function KPICard({ label, value, subtext, accent }: { label: string; value: string; subtext?: string; accent?: boolean }) {
    return (
        <div className="bg-white rounded-lg border border-stone-200 p-4">
            <p className="text-[11px] font-semibold text-stone-400 uppercase tracking-wider">{label}</p>
            <p className={`text-2xl font-bold mt-1 tracking-tight ${accent ? 'text-green-600' : 'text-stone-900'}`}>{value}</p>
            {subtext && <p className="text-xs text-stone-400 mt-1">{subtext}</p>}
        </div>
    );
}

// ============================================
// OVERVIEW SUB-TAB
// ============================================

function OverviewSubTab({ days }: { days: number }) {
    const summary = useMetaSummary(days);
    const campaigns = useMetaCampaigns(days);
    const daily = useMetaDailyTrend(days);

    if (summary.isLoading || campaigns.isLoading) {
        return <div className="space-y-5"><KPISkeleton /><ChartSkeleton /><GridSkeleton /></div>;
    }
    if (summary.error || campaigns.error) return <ErrorState error={summary.error ?? campaigns.error} />;

    const s = summary.data;
    if (!s) return <ErrorState error={null} />;

    const dailyData = daily.data ?? [];
    const campaignData = campaigns.data ?? [];

    return (
        <div className="space-y-5">
            {/* KPI Cards */}
            <div className="grid grid-cols-2 lg:grid-cols-5 gap-3">
                <KPICard label="Total Spend" value={formatCurrency(s.spend)} subtext={`${formatCurrency(Math.round(s.spend / Math.max(days === 1 || days === 2 ? 1 : days, 1)))}/day avg`} />
                <KPICard label="ROAS" value={s.roas > 0 ? `${s.roas.toFixed(2)}x` : '-'} subtext={`${formatCurrency(Math.round(s.purchaseValue))} revenue`} accent={s.roas >= 3} />
                <KPICard label="Purchases" value={fmt(s.purchases)} subtext={s.purchases > 0 ? `${formatCurrency(Math.round(s.spend / s.purchases))} per purchase` : undefined} />
                <KPICard label="CTR" value={fmtPct(s.ctr)} subtext={`CPC ${formatCurrency(s.cpc)} · CPM ${formatCurrency(Math.round(s.cpm))}`} />
                <KPICard label="Reach" value={s.reach >= 100000 ? `${(s.reach / 100000).toFixed(1)}L` : fmt(s.reach)} subtext={`Freq ${s.frequency.toFixed(1)} · ${fmt(s.impressions)} impr`} />
            </div>

            {/* Funnel Strip */}
            <FunnelStrip summary={s} />

            {/* Charts Row */}
            <div className="flex gap-3">
                {/* Daily Chart */}
                <div className="flex-[2] bg-white rounded-lg border border-stone-200 p-5">
                    <h3 className="text-sm font-semibold text-stone-800">Daily Spend & Revenue</h3>
                    <p className="text-xs text-stone-400 mt-0.5">Bar = spend, Line = purchase revenue</p>
                    {dailyData.length > 0 ? (
                        <div className="h-64 mt-4">
                            <ResponsiveContainer width="100%" height="100%">
                                <ComposedChart data={dailyData}>
                                    <CartesianGrid strokeDasharray="3 3" stroke="#e7e5e4" />
                                    <XAxis dataKey="date" tickFormatter={fmtChartDate} tick={{ fill: '#78716c', fontSize: 11 }} />
                                    <YAxis yAxisId="left" tick={{ fill: '#78716c', fontSize: 11 }} tickFormatter={v => `₹${(v / 1000).toFixed(0)}k`} />
                                    <YAxis yAxisId="right" orientation="right" tick={{ fill: '#78716c', fontSize: 11 }} tickFormatter={v => `₹${(v / 1000).toFixed(0)}k`} />
                                    <Tooltip
                                        formatter={(value: number | undefined, name?: string) => [
                                            formatCurrency(value ?? 0),
                                            name === 'purchaseValue' ? 'Revenue' : 'Spend',
                                        ]}
                                        labelFormatter={fmtChartDate}
                                    />
                                    <Bar yAxisId="left" dataKey="spend" fill="rgba(24,119,242,0.2)" stroke="rgba(24,119,242,0.4)" name="spend" radius={[2, 2, 0, 0]} />
                                    <Line yAxisId="right" dataKey="purchaseValue" stroke="#16a34a" strokeWidth={2} dot={false} name="purchaseValue" />
                                </ComposedChart>
                            </ResponsiveContainer>
                        </div>
                    ) : (
                        <p className="text-sm text-stone-400 py-12 text-center">No daily data for this period</p>
                    )}
                </div>

                {/* Efficiency Sidebar */}
                <div className="flex-1 bg-white rounded-lg border border-stone-200 p-5">
                    <h3 className="text-sm font-semibold text-stone-800">Efficiency</h3>
                    <div className="mt-4 space-y-4">
                        {[
                            { label: 'Avg ROAS', value: s.roas > 0 ? `${s.roas.toFixed(2)}x` : '-', accent: s.roas >= 3 },
                            { label: 'Cost per Purchase', value: s.purchases > 0 ? formatCurrency(Math.round(s.spend / s.purchases)) : '-' },
                            { label: 'Frequency', value: s.frequency.toFixed(1) },
                            { label: 'Conv Rate', value: s.clicks > 0 ? fmtPct((s.purchases / s.clicks) * 100) : '-' },
                            { label: 'Add to Carts', value: fmt(s.addToCarts) },
                        ].map(({ label, value, accent }) => (
                            <div key={label}>
                                <div className="flex justify-between items-center">
                                    <span className="text-xs text-stone-500">{label}</span>
                                    <span className={`text-lg font-bold tracking-tight ${accent ? 'text-green-600' : 'text-stone-900'}`}>{value}</span>
                                </div>
                                <div className="border-b border-stone-100 mt-3" />
                            </div>
                        ))}
                    </div>
                </div>
            </div>

            {/* Campaign Table Preview */}
            <CampaignTable data={campaignData} compact />
        </div>
    );
}

// ============================================
// FUNNEL STRIP
// ============================================

function FunnelStrip({ summary: s }: { summary: { impressions: number; clicks: number; ctr: number; addToCarts: number; initiateCheckouts: number; purchases: number } }) {
    const steps = [
        { label: 'Impressions', value: s.impressions, rate: null },
        { label: 'Clicks', value: s.clicks, rate: s.impressions > 0 ? `${((s.clicks / s.impressions) * 100).toFixed(2)}% CTR` : null },
        { label: 'Add to Cart', value: s.addToCarts, rate: s.clicks > 0 ? `${((s.addToCarts / s.clicks) * 100).toFixed(1)}% of clicks` : null },
        { label: 'Checkout', value: s.initiateCheckouts, rate: s.addToCarts > 0 ? `${((s.initiateCheckouts / s.addToCarts) * 100).toFixed(1)}% of ATC` : null },
        { label: 'Purchase', value: s.purchases, rate: s.initiateCheckouts > 0 ? `${((s.purchases / s.initiateCheckouts) * 100).toFixed(1)}% of checkout` : null },
    ];

    return (
        <div className="flex gap-1">
            {steps.map((step, i) => (
                <div key={step.label} className="flex items-center gap-1 flex-1">
                    <div className={`flex-1 bg-white border border-stone-200 p-3 ${i === 0 ? 'rounded-l-lg' : ''} ${i === steps.length - 1 ? 'rounded-r-lg' : ''}`}>
                        <p className={`text-[11px] font-medium ${i === steps.length - 1 ? 'text-blue-600' : 'text-stone-400'}`}>{step.label}</p>
                        <div className="flex items-baseline gap-2 mt-1">
                            <span className={`text-lg font-bold tracking-tight ${i === steps.length - 1 ? 'text-blue-600' : 'text-stone-900'}`}>
                                {step.value >= 100000 ? `${(step.value / 100000).toFixed(1)}L` : fmt(step.value)}
                            </span>
                            {step.rate && <span className="text-[10px] text-stone-400">{step.rate}</span>}
                        </div>
                    </div>
                    {i < steps.length - 1 && (
                        <svg width="12" height="12" viewBox="0 0 12 12" className="flex-shrink-0 text-stone-300">
                            <path d="M4 2l4 4-4 4" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                        </svg>
                    )}
                </div>
            ))}
        </div>
    );
}

// ============================================
// CAMPAIGNS SUB-TAB
// ============================================

function CampaignsSubTab({ days }: { days: number }) {
    const campaigns = useMetaCampaigns(days);
    const adsets = useMetaAdsets(days);

    if (campaigns.isLoading) return <GridSkeleton />;
    if (campaigns.error) return <ErrorState error={campaigns.error} />;

    return (
        <div className="space-y-5">
            <CampaignTable data={campaigns.data ?? []} />
            {/* Adset Breakdown */}
            <AdsetTable data={adsets.data ?? []} isLoading={adsets.isLoading} />
        </div>
    );
}

function CampaignTable({ data, compact }: { data: MetaCampaignRow[]; compact?: boolean }) {
    const cols: ColDef<MetaCampaignRow>[] = useMemo(() => [
        { field: 'campaignName', headerName: 'Campaign', flex: 2, minWidth: 200 },
        { field: 'objective', headerName: 'Objective', width: 140, valueFormatter: (p: ValueFormatterParams) => { const v = String(p.value ?? ''); return v.replace('OUTCOME_', '').toLowerCase().replace(/^\w/, (c: string) => c.toUpperCase()); } },
        { field: 'spend', headerName: 'Spend', width: 110, sort: 'desc' as const, valueFormatter: (p: ValueFormatterParams) => formatCurrency(p.value) },
        { field: 'impressions', headerName: 'Impr', width: 90, valueFormatter: (p: ValueFormatterParams) => fmt(p.value) },
        { field: 'ctr', headerName: 'CTR', width: 75, valueFormatter: (p: ValueFormatterParams) => fmtPct(p.value) },
        { field: 'cpc', headerName: 'CPC', width: 75, valueFormatter: (p: ValueFormatterParams) => `₹${Number(p.value).toFixed(1)}` },
        { field: 'purchases', headerName: 'Purch', width: 80 },
        { field: 'purchaseValue', headerName: 'Revenue', width: 110, valueFormatter: (p: ValueFormatterParams) => formatCurrency(p.value) },
        { field: 'costPerPurchase', headerName: 'CPP', width: 80, valueFormatter: (p: ValueFormatterParams) => p.value > 0 ? `₹${Number(p.value).toFixed(0)}` : '-' },
        {
            field: 'roas', headerName: 'ROAS', width: 85,
            valueFormatter: (p: ValueFormatterParams) => p.value > 0 ? `${Number(p.value).toFixed(2)}x` : '-',
            cellStyle: (params: { value: number }) => {
                if (params.value >= 3) return { color: '#16a34a', fontWeight: 600 };
                if (params.value >= 1.5) return { color: '#d97706', fontWeight: 600 };
                if (params.value > 0) return { color: '#dc2626', fontWeight: 600 };
                return null;
            },
        },
    ], []);

    return (
        <div className="bg-white rounded-lg border border-stone-200 p-5">
            <h3 className="text-sm font-semibold text-stone-800 mb-3">Campaign Performance</h3>
            <div style={{ height: compact ? 300 : 450 }}>
                <AgGridReact<MetaCampaignRow>
                    rowData={data}
                    columnDefs={cols}
                    defaultColDef={DEFAULT_COL_DEF}
                    theme={compactThemeSmall}
                    suppressCellFocus
                />
            </div>
        </div>
    );
}

function AdsetTable({ data, isLoading }: { data: MetaAdsetRow[]; isLoading: boolean }) {
    const cols: ColDef<MetaAdsetRow>[] = useMemo(() => [
        { field: 'campaignName', headerName: 'Campaign', flex: 1, minWidth: 150 },
        { field: 'adsetName', headerName: 'Ad Set', flex: 1.5, minWidth: 180 },
        { field: 'spend', headerName: 'Spend', width: 100, sort: 'desc' as const, valueFormatter: (p: ValueFormatterParams) => formatCurrency(p.value) },
        { field: 'reach', headerName: 'Reach', width: 90, valueFormatter: (p: ValueFormatterParams) => fmt(p.value) },
        { field: 'ctr', headerName: 'CTR', width: 75, valueFormatter: (p: ValueFormatterParams) => fmtPct(p.value) },
        { field: 'purchases', headerName: 'Purch', width: 75 },
        { field: 'purchaseValue', headerName: 'Revenue', width: 100, valueFormatter: (p: ValueFormatterParams) => formatCurrency(p.value) },
        { field: 'costPerPurchase', headerName: 'CPP', width: 80, valueFormatter: (p: ValueFormatterParams) => p.value > 0 ? `₹${Number(p.value).toFixed(0)}` : '-' },
        {
            field: 'roas', headerName: 'ROAS', width: 85,
            valueFormatter: (p: ValueFormatterParams) => p.value > 0 ? `${Number(p.value).toFixed(2)}x` : '-',
            cellStyle: (params: { value: number }) => {
                if (params.value >= 3) return { color: '#16a34a', fontWeight: 600 };
                if (params.value >= 1.5) return { color: '#d97706', fontWeight: 600 };
                if (params.value > 0) return { color: '#dc2626', fontWeight: 600 };
                return null;
            },
        },
    ], []);

    if (isLoading) return <GridSkeleton />;

    return (
        <div className="bg-white rounded-lg border border-stone-200 p-5">
            <h3 className="text-sm font-semibold text-stone-800 mb-3">Ad Set Breakdown ({data.length} ad sets)</h3>
            <div style={{ height: 400 }}>
                <AgGridReact<MetaAdsetRow>
                    rowData={data}
                    columnDefs={cols}
                    defaultColDef={DEFAULT_COL_DEF}
                    theme={compactThemeSmall}
                    suppressCellFocus
                />
            </div>
        </div>
    );
}

// ============================================
// AUDIENCE SUB-TAB
// ============================================

function AudienceSubTab({ days }: { days: number }) {
    const ageGender = useMetaAgeGender(days);

    if (ageGender.isLoading) return <div className="space-y-5"><GridSkeleton /><GridSkeleton /></div>;
    if (ageGender.error) return <ErrorState error={ageGender.error} />;

    const rows = ageGender.data ?? [];

    // Aggregate by age
    const ageMap = new Map<string, { spend: number; purchases: number; purchaseValue: number; impressions: number; clicks: number }>();
    for (const r of rows) {
        const existing = ageMap.get(r.age) ?? { spend: 0, purchases: 0, purchaseValue: 0, impressions: 0, clicks: 0 };
        existing.spend += r.spend;
        existing.purchases += r.purchases;
        existing.purchaseValue += r.purchaseValue;
        existing.impressions += r.impressions;
        existing.clicks += r.clicks;
        ageMap.set(r.age, existing);
    }
    const ageRows = Array.from(ageMap.entries())
        .map(([age, d]) => ({
            age,
            spend: d.spend,
            purchases: d.purchases,
            cpp: d.purchases > 0 ? Math.round(d.spend / d.purchases) : 0,
            roas: d.spend > 0 ? Math.round((d.purchaseValue / d.spend) * 100) / 100 : 0,
        }))
        .sort((a, b) => a.age.localeCompare(b.age));

    // Aggregate by gender
    const genderMap = new Map<string, { spend: number; purchases: number; purchaseValue: number }>();
    for (const r of rows) {
        const existing = genderMap.get(r.gender) ?? { spend: 0, purchases: 0, purchaseValue: 0 };
        existing.spend += r.spend;
        existing.purchases += r.purchases;
        existing.purchaseValue += r.purchaseValue;
        genderMap.set(r.gender, existing);
    }
    const totalSpend = rows.reduce((sum, r) => sum + r.spend, 0);
    const genderRows = Array.from(genderMap.entries()).map(([gender, d]) => ({
        gender: gender.charAt(0).toUpperCase() + gender.slice(1),
        spend: d.spend,
        spendPct: totalSpend > 0 ? Math.round((d.spend / totalSpend) * 100) : 0,
        purchases: d.purchases,
        cpp: d.purchases > 0 ? Math.round(d.spend / d.purchases) : 0,
        roas: d.spend > 0 ? Math.round((d.purchaseValue / d.spend) * 100) / 100 : 0,
    }));

    // Best age bracket
    const bestAge = ageRows.reduce((best, r) => r.roas > best.roas ? r : best, ageRows[0]);

    return (
        <div className="space-y-5">
            <div className="flex gap-3">
                {/* Age Table */}
                <div className="flex-1 bg-white rounded-lg border border-stone-200 p-5">
                    <h3 className="text-sm font-semibold text-stone-800">Performance by Age</h3>
                    <p className="text-xs text-stone-400 mt-0.5">Spend, purchases, and ROAS by age bracket</p>
                    <div className="mt-4 space-y-0">
                        <div className="flex py-2 border-b border-stone-100">
                            <span className="text-[11px] font-semibold text-stone-400 w-16">AGE</span>
                            <span className="text-[11px] font-semibold text-stone-400 flex-1 text-right">SPEND</span>
                            <span className="text-[11px] font-semibold text-stone-400 flex-1 text-right">PURCH</span>
                            <span className="text-[11px] font-semibold text-stone-400 flex-1 text-right">CPP</span>
                            <span className="text-[11px] font-semibold text-stone-400 flex-1 text-right">ROAS</span>
                        </div>
                        {ageRows.map(r => (
                            <div key={r.age} className={`flex py-2.5 border-b border-stone-50 items-center ${r.age === bestAge?.age ? 'bg-blue-50/50' : ''}`}>
                                <span className={`text-sm w-16 ${r.age === bestAge?.age ? 'font-semibold text-blue-600' : 'font-medium text-stone-800'}`}>{r.age}</span>
                                <span className="text-xs font-mono text-stone-500 flex-1 text-right">{formatCurrency(r.spend)}</span>
                                <span className="text-xs font-mono text-stone-800 flex-1 text-right">{r.purchases}</span>
                                <span className="text-xs font-mono text-stone-800 flex-1 text-right">{r.cpp > 0 ? formatCurrency(r.cpp) : '-'}</span>
                                <span className="flex-1 text-right"><RoasBadge value={r.roas} /></span>
                            </div>
                        ))}
                    </div>
                </div>

                {/* Gender Cards */}
                <div className="flex-1 bg-white rounded-lg border border-stone-200 p-5">
                    <h3 className="text-sm font-semibold text-stone-800">Performance by Gender</h3>
                    <p className="text-xs text-stone-400 mt-0.5">Which gender converts better?</p>
                    <div className="flex gap-3 mt-4">
                        {genderRows.map(g => (
                            <div key={g.gender} className="flex-1 bg-stone-50 rounded-lg p-4 space-y-3">
                                <p className={`text-xs font-semibold tracking-wider ${g.gender === 'Female' ? 'text-blue-600' : 'text-stone-500'}`}>{g.gender.toUpperCase()}</p>
                                <p className="text-3xl font-bold text-stone-900 tracking-tight">{g.spendPct}%</p>
                                <p className="text-[11px] text-stone-400">of total spend</p>
                                <div className="border-t border-stone-200 pt-3 space-y-2">
                                    <div className="flex justify-between"><span className="text-xs text-stone-500">Purchases</span><span className="text-xs font-mono font-semibold text-stone-800">{g.purchases}</span></div>
                                    <div className="flex justify-between"><span className="text-xs text-stone-500">ROAS</span><RoasBadge value={g.roas} /></div>
                                    <div className="flex justify-between"><span className="text-xs text-stone-500">CPP</span><span className="text-xs font-mono text-stone-800">{g.cpp > 0 ? formatCurrency(g.cpp) : '-'}</span></div>
                                </div>
                            </div>
                        ))}
                    </div>
                </div>
            </div>

            {/* Full Age+Gender Grid */}
            <AgeGenderGrid data={rows} />
        </div>
    );
}

function AgeGenderGrid({ data }: { data: MetaAgeGenderRow[] }) {
    const cols: ColDef<MetaAgeGenderRow>[] = useMemo(() => [
        { field: 'age', headerName: 'Age', width: 80 },
        { field: 'gender', headerName: 'Gender', width: 90, valueFormatter: (p: ValueFormatterParams) => String(p.value).charAt(0).toUpperCase() + String(p.value).slice(1) },
        { field: 'spend', headerName: 'Spend', width: 100, sort: 'desc' as const, valueFormatter: (p: ValueFormatterParams) => formatCurrency(p.value) },
        { field: 'impressions', headerName: 'Impr', width: 90, valueFormatter: (p: ValueFormatterParams) => fmt(p.value) },
        { field: 'ctr', headerName: 'CTR', width: 75, valueFormatter: (p: ValueFormatterParams) => fmtPct(p.value) },
        { field: 'purchases', headerName: 'Purch', width: 75 },
        { field: 'purchaseValue', headerName: 'Revenue', width: 100, valueFormatter: (p: ValueFormatterParams) => formatCurrency(p.value) },
        { field: 'costPerPurchase', headerName: 'CPP', width: 80, valueFormatter: (p: ValueFormatterParams) => p.value > 0 ? `₹${Number(p.value).toFixed(0)}` : '-' },
        {
            field: 'roas', headerName: 'ROAS', width: 85,
            valueFormatter: (p: ValueFormatterParams) => p.value > 0 ? `${Number(p.value).toFixed(2)}x` : '-',
            cellStyle: (params: { value: number }) => {
                if (params.value >= 3) return { color: '#16a34a', fontWeight: 600 };
                if (params.value >= 1.5) return { color: '#d97706', fontWeight: 600 };
                if (params.value > 0) return { color: '#dc2626', fontWeight: 600 };
                return null;
            },
        },
    ], []);

    return (
        <div className="bg-white rounded-lg border border-stone-200 p-5">
            <h3 className="text-sm font-semibold text-stone-800 mb-3">Full Age + Gender Breakdown ({data.length} segments)</h3>
            <div style={{ height: 350 }}>
                <AgGridReact<MetaAgeGenderRow>
                    rowData={data}
                    columnDefs={cols}
                    defaultColDef={DEFAULT_COL_DEF}
                    theme={compactThemeSmall}
                    suppressCellFocus
                />
            </div>
        </div>
    );
}

// ============================================
// PLACEMENTS SUB-TAB
// ============================================

function PlacementsSubTab({ days }: { days: number }) {
    const placements = useMetaPlacements(days);
    const devices = useMetaDevices(days);
    const regions = useMetaRegions(days);

    if (placements.isLoading) return <div className="space-y-5"><GridSkeleton /><GridSkeleton /></div>;
    if (placements.error) return <ErrorState error={placements.error} />;

    const placementData = placements.data ?? [];
    const deviceData = devices.data ?? [];
    const regionData = regions.data ?? [];

    // Platform aggregation
    const platformMap = new Map<string, { spend: number; purchases: number; purchaseValue: number; impressions: number; cpm: number }>();
    for (const r of placementData) {
        const existing = platformMap.get(r.platform) ?? { spend: 0, purchases: 0, purchaseValue: 0, impressions: 0, cpm: 0 };
        existing.spend += r.spend;
        existing.purchases += r.purchases;
        existing.purchaseValue += r.purchaseValue;
        existing.impressions += r.impressions;
        platformMap.set(r.platform, existing);
    }

    const platforms = Array.from(platformMap.entries()).map(([platform, d]) => ({
        platform: platform.charAt(0).toUpperCase() + platform.slice(1),
        spend: d.spend,
        purchases: d.purchases,
        roas: d.spend > 0 ? Math.round((d.purchaseValue / d.spend) * 100) / 100 : 0,
        cpm: d.impressions > 0 ? Math.round((d.spend / d.impressions) * 1000) : 0,
    }));

    // Device totals
    const deviceTotal = deviceData.reduce((s, d) => s + d.spend, 0);

    return (
        <div className="space-y-5">
            <div className="flex gap-3">
                {/* Platform Split */}
                <div className="flex-1 bg-white rounded-lg border border-stone-200 p-5">
                    <h3 className="text-sm font-semibold text-stone-800">Platform Split</h3>
                    <p className="text-xs text-stone-400 mt-0.5">Facebook vs Instagram performance</p>
                    <div className="flex gap-4 mt-4">
                        {platforms.map(p => (
                            <div key={p.platform} className="flex-1 space-y-3">
                                <div className="flex items-center gap-2">
                                    <div className={`w-2.5 h-2.5 rounded-full ${p.platform === 'Facebook' ? 'bg-blue-500' : 'bg-gradient-to-br from-amber-400 via-pink-500 to-purple-600'}`} />
                                    <span className="text-sm font-semibold text-stone-800">{p.platform}</span>
                                </div>
                                <div className="space-y-2">
                                    <div className="flex justify-between"><span className="text-xs text-stone-500">Spend</span><span className="text-xs font-mono text-stone-800">{formatCurrency(p.spend)}</span></div>
                                    <div className="flex justify-between"><span className="text-xs text-stone-500">Purchases</span><span className="text-xs font-mono font-semibold text-stone-800">{p.purchases}</span></div>
                                    <div className="flex justify-between"><span className="text-xs text-stone-500">ROAS</span><RoasBadge value={p.roas} /></div>
                                    <div className="flex justify-between"><span className="text-xs text-stone-500">CPM</span><span className="text-xs font-mono text-stone-800">{formatCurrency(p.cpm)}</span></div>
                                </div>
                            </div>
                        ))}
                    </div>
                </div>

                {/* Placement Table */}
                <div className="flex-[2] bg-white rounded-lg border border-stone-200 p-5">
                    <h3 className="text-sm font-semibold text-stone-800">Placement Breakdown</h3>
                    <p className="text-xs text-stone-400 mt-0.5">Where is your money working hardest?</p>
                    <PlacementGrid data={placementData} />
                </div>
            </div>

            <div className="flex gap-3">
                {/* Device */}
                <div className="flex-1 bg-white rounded-lg border border-stone-200 p-5">
                    <h3 className="text-sm font-semibold text-stone-800">Device Performance</h3>
                    <div className="mt-4 space-y-4">
                        {deviceData.map(d => {
                            const pct = deviceTotal > 0 ? Math.round((d.spend / deviceTotal) * 100) : 0;
                            const roas = d.spend > 0 ? Math.round((d.purchaseValue / d.spend) * 100) / 100 : 0;
                            return (
                                <div key={d.device}>
                                    <div className="flex items-center justify-between">
                                        <div>
                                            <p className="text-sm font-medium text-stone-800 capitalize">{d.device}</p>
                                            <p className="text-[11px] text-stone-400">{pct}% of spend</p>
                                        </div>
                                        <div className="flex items-center gap-3">
                                            <span className="text-xs font-mono font-semibold text-stone-800">{d.purchases} purch</span>
                                            <RoasBadge value={roas} />
                                        </div>
                                    </div>
                                    <div className="w-full h-2 bg-stone-100 rounded mt-2">
                                        <div className="h-2 bg-blue-500 rounded" style={{ width: `${pct}%` }} />
                                    </div>
                                </div>
                            );
                        })}
                    </div>
                </div>

                {/* Region Table */}
                <div className="flex-[2] bg-white rounded-lg border border-stone-200 p-5">
                    <h3 className="text-sm font-semibold text-stone-800">Top Regions</h3>
                    <p className="text-xs text-stone-400 mt-0.5">Geographic performance by region</p>
                    <RegionGrid data={regionData} isLoading={regions.isLoading} />
                </div>
            </div>
        </div>
    );
}

function PlacementGrid({ data }: { data: MetaPlacementRow[] }) {
    const cols: ColDef<MetaPlacementRow>[] = useMemo(() => [
        { field: 'label', headerName: 'Placement', flex: 2, minWidth: 160 },
        { field: 'spend', headerName: 'Spend', width: 100, sort: 'desc' as const, valueFormatter: (p: ValueFormatterParams) => formatCurrency(p.value) },
        { field: 'impressions', headerName: 'Impr', width: 90, valueFormatter: (p: ValueFormatterParams) => fmt(p.value) },
        { field: 'ctr', headerName: 'CTR', width: 70, valueFormatter: (p: ValueFormatterParams) => fmtPct(p.value) },
        { field: 'purchases', headerName: 'Purch', width: 70 },
        {
            field: 'roas', headerName: 'ROAS', width: 85,
            valueFormatter: (p: ValueFormatterParams) => p.value > 0 ? `${Number(p.value).toFixed(2)}x` : '-',
            cellStyle: (params: { value: number }) => {
                if (params.value >= 3) return { color: '#16a34a', fontWeight: 600 };
                if (params.value >= 1.5) return { color: '#d97706', fontWeight: 600 };
                if (params.value > 0) return { color: '#dc2626', fontWeight: 600 };
                return null;
            },
        },
    ], []);

    return (
        <div style={{ height: 300 }} className="mt-3">
            <AgGridReact<MetaPlacementRow>
                rowData={data}
                columnDefs={cols}
                defaultColDef={DEFAULT_COL_DEF}
                theme={compactThemeSmall}
                suppressCellFocus
            />
        </div>
    );
}

function RegionGrid({ data, isLoading }: { data: MetaRegionRow[]; isLoading: boolean }) {
    const cols: ColDef<MetaRegionRow>[] = useMemo(() => [
        { field: 'region', headerName: 'Region', flex: 2, minWidth: 150 },
        { field: 'spend', headerName: 'Spend', width: 100, sort: 'desc' as const, valueFormatter: (p: ValueFormatterParams) => formatCurrency(p.value) },
        { field: 'purchases', headerName: 'Purch', width: 75 },
        {
            field: 'roas', headerName: 'ROAS', width: 85,
            valueFormatter: (p: ValueFormatterParams) => p.value > 0 ? `${Number(p.value).toFixed(2)}x` : '-',
            cellStyle: (params: { value: number }) => {
                if (params.value >= 3) return { color: '#16a34a', fontWeight: 600 };
                if (params.value >= 1.5) return { color: '#d97706', fontWeight: 600 };
                if (params.value > 0) return { color: '#dc2626', fontWeight: 600 };
                return null;
            },
        },
    ], []);

    if (isLoading) return <Skeleton className="h-60 mt-3" />;

    return (
        <div style={{ height: 300 }} className="mt-3">
            <AgGridReact<MetaRegionRow>
                rowData={data}
                columnDefs={cols}
                defaultColDef={DEFAULT_COL_DEF}
                theme={compactThemeSmall}
                suppressCellFocus
            />
        </div>
    );
}

// ============================================
// CREATIVE SUB-TAB
// ============================================

function CreativeSubTab({ days }: { days: number }) {
    const ads = useMetaAds(days);

    if (ads.isLoading) return <div className="space-y-5"><ChartSkeleton /><GridSkeleton /></div>;
    if (ads.error) return <ErrorState error={ads.error} />;

    const adData = ads.data ?? [];
    const topAds = [...adData].sort((a, b) => b.roas - a.roas).slice(0, 3);

    return (
        <div className="space-y-5">
            {/* Top 3 Ad Cards */}
            {topAds.length > 0 && (
                <div>
                    <h3 className="text-sm font-semibold text-stone-800 mb-3">Top Performing Ads</h3>
                    <div className="flex gap-3">
                        {topAds.map(ad => (
                            <div key={ad.adId} className="flex-1 bg-white rounded-lg border border-stone-200 overflow-hidden">
                                {ad.imageUrl ? (
                                    <img
                                        src={ad.imageUrl}
                                        alt={ad.adName}
                                        className="h-36 w-full object-cover"
                                        loading="lazy"
                                        referrerPolicy="no-referrer"
                                    />
                                ) : (
                                    <div className="h-36 bg-gradient-to-br from-stone-800 to-stone-600 flex items-center justify-center">
                                        <span className="text-sm text-stone-400">No Preview</span>
                                    </div>
                                )}
                                <div className="p-4 space-y-2.5">
                                    <p className="text-sm font-semibold text-stone-800 truncate">{ad.adName}</p>
                                    <p className="text-[11px] text-stone-400 truncate">{ad.campaignName}</p>
                                    <div className="border-t border-stone-100 pt-2.5 space-y-2">
                                        <div className="flex justify-between"><span className="text-xs text-stone-500">Spend</span><span className="text-xs font-mono text-stone-800">{formatCurrency(ad.spend)}</span></div>
                                        <div className="flex justify-between"><span className="text-xs text-stone-500">Purchases</span><span className="text-xs font-mono font-semibold text-stone-800">{ad.purchases}</span></div>
                                        <div className="flex justify-between"><span className="text-xs text-stone-500">ROAS</span><RoasBadge value={ad.roas} /></div>
                                        <div className="flex justify-between"><span className="text-xs text-stone-500">CTR</span><span className="text-xs font-mono text-stone-800">{fmtPct(ad.ctr)}</span></div>
                                        <div className="flex justify-between"><span className="text-xs text-stone-500">CPP</span><span className="text-xs font-mono text-stone-800">{ad.costPerPurchase > 0 ? formatCurrency(Math.round(ad.costPerPurchase)) : '-'}</span></div>
                                    </div>
                                </div>
                            </div>
                        ))}
                    </div>
                </div>
            )}

            {/* Full Ads Grid */}
            <AdGrid data={adData} />
        </div>
    );
}

const AdThumbnail = React.memo(function AdThumbnail(props: { data?: MetaAdRow }) {
    const url = props.data?.imageUrl;
    if (!url) return <div className="w-10 h-10 rounded bg-stone-100" />;
    return <img src={url} alt="" className="w-10 h-10 rounded object-cover" loading="lazy" referrerPolicy="no-referrer" />;
});

function AdGrid({ data }: { data: MetaAdRow[] }) {
    const cols: ColDef<MetaAdRow>[] = useMemo(() => [
        { headerName: '', width: 56, cellRenderer: AdThumbnail, sortable: false, filter: false, resizable: false },
        { field: 'adName', headerName: 'Ad Name', flex: 2, minWidth: 200 },
        { field: 'campaignName', headerName: 'Campaign', flex: 1, minWidth: 140 },
        { field: 'adsetName', headerName: 'Ad Set', flex: 1, minWidth: 140 },
        { field: 'spend', headerName: 'Spend', width: 100, sort: 'desc' as const, valueFormatter: (p: ValueFormatterParams) => formatCurrency(p.value) },
        { field: 'ctr', headerName: 'CTR', width: 70, valueFormatter: (p: ValueFormatterParams) => fmtPct(p.value) },
        { field: 'purchases', headerName: 'Purch', width: 70 },
        { field: 'purchaseValue', headerName: 'Revenue', width: 100, valueFormatter: (p: ValueFormatterParams) => formatCurrency(p.value) },
        {
            field: 'roas', headerName: 'ROAS', width: 85,
            valueFormatter: (p: ValueFormatterParams) => p.value > 0 ? `${Number(p.value).toFixed(2)}x` : '-',
            cellStyle: (params: { value: number }) => {
                if (params.value >= 3) return { color: '#16a34a', fontWeight: 600 };
                if (params.value >= 1.5) return { color: '#d97706', fontWeight: 600 };
                if (params.value > 0) return { color: '#dc2626', fontWeight: 600 };
                return null;
            },
        },
    ], []);

    return (
        <div className="bg-white rounded-lg border border-stone-200 p-5">
            <h3 className="text-sm font-semibold text-stone-800 mb-3">All Ads ({data.length} ads)</h3>
            <div style={{ height: 450 }}>
                <AgGridReact<MetaAdRow>
                    rowData={data}
                    columnDefs={cols}
                    rowHeight={48}
                    defaultColDef={DEFAULT_COL_DEF}
                    theme={compactThemeSmall}
                    suppressCellFocus
                />
            </div>
        </div>
    );
}

// ============================================
// LANDING PAGE SUB-TAB
// ============================================

function LandingPageSubTab({ days }: { days: number }) {
    const summary = useMetaSummary(days);
    const campaigns = useMetaCampaigns(days);
    const ads = useMetaAds(days);

    if (summary.isLoading || campaigns.isLoading) return <div className="space-y-5"><KPISkeleton /><GridSkeleton /></div>;
    if (summary.error) return <ErrorState error={summary.error} />;

    const s = summary.data;
    if (!s) return <ErrorState error={null} />;

    const dropOffRate = s.linkClicks > 0 ? ((s.linkClicks - s.landingPageViews) / s.linkClicks * 100) : 0;
    const costPerLpv = s.landingPageViews > 0 ? s.spend / s.landingPageViews : 0;
    const lpvRate = s.linkClicks > 0 ? (s.landingPageViews / s.linkClicks * 100) : 0;
    const lpvToPurchase = s.landingPageViews > 0 ? (s.purchases / s.landingPageViews * 100) : 0;

    // Campaign-level landing page data
    const campaignLpData = (campaigns.data ?? [])
        .filter(c => c.linkClicks > 0)
        .map(c => ({
            ...c,
            dropOffRate: c.linkClicks > 0 ? ((c.linkClicks - c.landingPageViews) / c.linkClicks * 100) : 0,
            lpvRate: c.linkClicks > 0 ? (c.landingPageViews / c.linkClicks * 100) : 0,
            costPerLpv: c.landingPageViews > 0 ? c.spend / c.landingPageViews : 0,
        }))
        .sort((a, b) => b.spend - a.spend);

    // Ad-level landing page data
    const adLpData = (ads.data ?? [])
        .filter(a => a.linkClicks > 0)
        .map(a => ({
            ...a,
            dropOffRate: a.linkClicks > 0 ? ((a.linkClicks - a.landingPageViews) / a.linkClicks * 100) : 0,
            lpvRate: a.linkClicks > 0 ? (a.landingPageViews / a.linkClicks * 100) : 0,
            costPerLpv: a.landingPageViews > 0 ? a.spend / a.landingPageViews : 0,
        }))
        .sort((a, b) => b.spend - a.spend);

    return (
        <div className="space-y-5">
            {/* KPI Cards */}
            <div className="grid grid-cols-2 lg:grid-cols-5 gap-3">
                <KPICard label="Link Clicks" value={fmt(s.linkClicks)} subtext={`CPC ${formatCurrency(s.linkClicks > 0 ? s.spend / s.linkClicks : 0)}`} />
                <KPICard label="Landing Page Views" value={fmt(s.landingPageViews)} subtext={`${lpvRate.toFixed(1)}% of link clicks`} />
                <KPICard
                    label="Drop-off Rate"
                    value={dropOffRate > 0 ? `${dropOffRate.toFixed(1)}%` : '-'}
                    subtext={`${fmt(s.linkClicks - s.landingPageViews)} clicks lost`}
                />
                <KPICard label="Cost per LPV" value={costPerLpv > 0 ? formatCurrency(Math.round(costPerLpv)) : '-'} subtext="Landing page view cost" />
                <KPICard label="LPV → Purchase" value={lpvToPurchase > 0 ? `${lpvToPurchase.toFixed(2)}%` : '-'} subtext={`${fmt(s.purchases)} purchases`} accent={lpvToPurchase >= 3} />
            </div>

            {/* Insight Banner */}
            {dropOffRate > 15 && (
                <div className="bg-amber-50 border border-amber-200 rounded-lg p-4">
                    <p className="text-sm text-amber-800">
                        <span className="font-semibold">High drop-off detected:</span> {dropOffRate.toFixed(1)}% of link clicks
                        don't result in a landing page view. This could indicate slow page load times, misleading ad content,
                        or landing page issues. Investigate campaigns with the highest drop-off below.
                    </p>
                </div>
            )}

            {/* Visual Flow */}
            <div className="bg-white rounded-lg border border-stone-200 p-5">
                <h3 className="text-sm font-semibold text-stone-800">Click-to-Page Flow</h3>
                <div className="flex items-center gap-4 mt-4">
                    <div className="flex-1 text-center">
                        <p className="text-[11px] font-semibold text-stone-400 uppercase tracking-wider">Link Clicks</p>
                        <p className="text-3xl font-bold text-stone-900 mt-1">{fmt(s.linkClicks)}</p>
                    </div>
                    <div className="flex flex-col items-center">
                        <svg width="40" height="20" viewBox="0 0 40 20"><path d="M0 10h30M26 4l8 6-8 6" fill="none" stroke="#a8a29e" strokeWidth="1.5" /></svg>
                        <span className="text-xs text-stone-400 mt-1">{lpvRate.toFixed(1)}%</span>
                    </div>
                    <div className="flex-1 text-center">
                        <p className="text-[11px] font-semibold text-stone-400 uppercase tracking-wider">Page Views</p>
                        <p className="text-3xl font-bold text-blue-600 mt-1">{fmt(s.landingPageViews)}</p>
                    </div>
                    <div className="flex flex-col items-center">
                        <svg width="40" height="20" viewBox="0 0 40 20"><path d="M0 10h30M26 4l8 6-8 6" fill="none" stroke="#a8a29e" strokeWidth="1.5" /></svg>
                        <span className="text-xs text-stone-400 mt-1">{lpvToPurchase.toFixed(2)}%</span>
                    </div>
                    <div className="flex-1 text-center">
                        <p className="text-[11px] font-semibold text-stone-400 uppercase tracking-wider">Purchases</p>
                        <p className="text-3xl font-bold text-green-600 mt-1">{fmt(s.purchases)}</p>
                    </div>
                    <div className="flex-1 text-center border-l border-stone-200 ml-4 pl-4">
                        <p className="text-[11px] font-semibold text-red-400 uppercase tracking-wider">Lost to Drop-off</p>
                        <p className="text-3xl font-bold text-red-500 mt-1">{fmt(s.linkClicks - s.landingPageViews)}</p>
                        <p className="text-xs text-stone-400 mt-1">{dropOffRate.toFixed(1)}% of clicks</p>
                    </div>
                </div>
            </div>

            {/* Campaign Landing Page Table */}
            <div className="bg-white rounded-lg border border-stone-200 p-5">
                <h3 className="text-sm font-semibold text-stone-800 mb-3">Campaign Landing Page Performance</h3>
                <div style={{ height: 350 }}>
                    <AgGridReact
                        rowData={campaignLpData}
                        columnDefs={[
                            { field: 'campaignName', headerName: 'Campaign', flex: 2, minWidth: 200 },
                            { field: 'linkClicks', headerName: 'Link Clicks', width: 100, sort: 'desc' as const, valueFormatter: (p: ValueFormatterParams) => fmt(p.value) },
                            { field: 'landingPageViews', headerName: 'LPV', width: 80, valueFormatter: (p: ValueFormatterParams) => fmt(p.value) },
                            { field: 'lpvRate', headerName: 'LPV Rate', width: 90, valueFormatter: (p: ValueFormatterParams) => `${Number(p.value).toFixed(1)}%` },
                            {
                                field: 'dropOffRate', headerName: 'Drop-off', width: 90,
                                valueFormatter: (p: ValueFormatterParams) => `${Number(p.value).toFixed(1)}%`,
                                cellStyle: (params: { value: number }) => {
                                    if (params.value >= 20) return { color: '#dc2626', fontWeight: 600 };
                                    if (params.value >= 10) return { color: '#d97706', fontWeight: 600 };
                                    return { color: '#16a34a', fontWeight: 400 };
                                },
                            },
                            { field: 'costPerLpv', headerName: 'Cost/LPV', width: 90, valueFormatter: (p: ValueFormatterParams) => p.value > 0 ? formatCurrency(Math.round(p.value)) : '-' },
                            { field: 'purchases', headerName: 'Purch', width: 70 },
                            {
                                field: 'roas', headerName: 'ROAS', width: 85,
                                valueFormatter: (p: ValueFormatterParams) => p.value > 0 ? `${Number(p.value).toFixed(2)}x` : '-',
                                cellStyle: (params: { value: number }) => {
                                    if (params.value >= 3) return { color: '#16a34a', fontWeight: 600 };
                                    if (params.value >= 1.5) return { color: '#d97706', fontWeight: 600 };
                                    if (params.value > 0) return { color: '#dc2626', fontWeight: 600 };
                                    return null;
                                },
                            },
                        ]}
                        defaultColDef={DEFAULT_COL_DEF}
                        theme={compactThemeSmall}
                        suppressCellFocus
                    />
                </div>
            </div>

            {/* Ad-Level Landing Page Table */}
            {!ads.isLoading && adLpData.length > 0 && (
                <div className="bg-white rounded-lg border border-stone-200 p-5">
                    <h3 className="text-sm font-semibold text-stone-800 mb-3">Ad-Level Landing Page Performance ({adLpData.length} ads)</h3>
                    <div style={{ height: 400 }}>
                        <AgGridReact
                            rowData={adLpData}
                            columnDefs={[
                                { field: 'adName', headerName: 'Ad', flex: 2, minWidth: 200 },
                                { field: 'campaignName', headerName: 'Campaign', flex: 1, minWidth: 140 },
                                { field: 'linkClicks', headerName: 'Link Clicks', width: 100, sort: 'desc' as const, valueFormatter: (p: ValueFormatterParams) => fmt(p.value) },
                                { field: 'landingPageViews', headerName: 'LPV', width: 80, valueFormatter: (p: ValueFormatterParams) => fmt(p.value) },
                                {
                                    field: 'dropOffRate', headerName: 'Drop-off', width: 90,
                                    valueFormatter: (p: ValueFormatterParams) => `${Number(p.value).toFixed(1)}%`,
                                    cellStyle: (params: { value: number }) => {
                                        if (params.value >= 20) return { color: '#dc2626', fontWeight: 600 };
                                        if (params.value >= 10) return { color: '#d97706', fontWeight: 600 };
                                        return { color: '#16a34a', fontWeight: 400 };
                                    },
                                },
                                { field: 'costPerLpv', headerName: 'Cost/LPV', width: 90, valueFormatter: (p: ValueFormatterParams) => p.value > 0 ? formatCurrency(Math.round(p.value)) : '-' },
                                { field: 'purchases', headerName: 'Purch', width: 70 },
                                {
                                    field: 'roas', headerName: 'ROAS', width: 85,
                                    valueFormatter: (p: ValueFormatterParams) => p.value > 0 ? `${Number(p.value).toFixed(2)}x` : '-',
                                    cellStyle: (params: { value: number }) => {
                                        if (params.value >= 3) return { color: '#16a34a', fontWeight: 600 };
                                        if (params.value >= 1.5) return { color: '#d97706', fontWeight: 600 };
                                        if (params.value > 0) return { color: '#dc2626', fontWeight: 600 };
                                        return null;
                                    },
                                },
                            ]}
                            defaultColDef={DEFAULT_COL_DEF}
                            theme={compactThemeSmall}
                            suppressCellFocus
                        />
                    </div>
                </div>
            )}
        </div>
    );
}

// ============================================
// PRODUCTS SUB-TAB
// ============================================

const ProductThumbnail = React.memo(function ProductThumbnail(props: { data?: MetaProductEnrichedRow }) {
    const url = props.data?.imageUrl;
    if (!url) return <div className="w-10 h-10 rounded bg-stone-100" />;
    return <img src={url} alt="" className="w-10 h-10 rounded object-cover" loading="lazy" />;
});

function ProductsSubTab({ days }: { days: number }) {
    const products = useMetaProducts(days);

    if (products.isLoading) return <div className="space-y-5"><KPISkeleton /><GridSkeleton /></div>;
    if (products.error) return <ErrorState error={products.error} />;

    const data = (products.data ?? []) as MetaProductEnrichedRow[];

    if (data.length === 0) {
        return (
            <div className="flex flex-col items-center justify-center py-16 text-center">
                <AlertCircle size={40} className="text-stone-300 mb-4" />
                <h3 className="text-lg font-medium text-stone-700">No product-level data</h3>
                <p className="text-sm text-stone-400 mt-2 max-w-md">
                    Product breakdown is only available for catalog/DPA campaigns.
                    If you're running Advantage+ Catalog ads, data will appear here.
                </p>
            </div>
        );
    }

    const totalSpend = data.reduce((s, p) => s + p.spend, 0);
    const totalClicks = data.reduce((s, p) => s + p.clicks, 0);
    const totalRevenue = data.reduce((s, p) => s + p.revenue, 0);
    const totalOrders = data.reduce((s, p) => s + p.orders, 0);
    const overallRoas = totalSpend > 0 ? Math.round((totalRevenue / totalSpend) * 100) / 100 : 0;

    // Top performers by ROAS (with min spend threshold)
    const minSpend = totalSpend / data.length * 0.2; // at least 20% of avg
    const topByRoas = [...data].filter(p => p.spend >= minSpend && p.roas > 0).sort((a, b) => b.roas - a.roas).slice(0, 5);
    // Worst performers — high spend, low ROAS
    const worstByRoas = [...data].filter(p => p.spend >= minSpend).sort((a, b) => a.roas - b.roas).slice(0, 5);

    const displayName = (p: MetaProductEnrichedRow) => {
        if (p.productName && p.colorName) return `${p.productName} — ${p.colorName}`;
        if (p.productName) return p.productName;
        return p.productId;
    };

    const cols: ColDef<MetaProductEnrichedRow>[] = [
        { headerName: '', width: 56, cellRenderer: ProductThumbnail, sortable: false, filter: false, resizable: false },
        {
            headerName: 'Product', flex: 2, minWidth: 220,
            valueGetter: (params: { data?: MetaProductEnrichedRow }) => params.data ? displayName(params.data) : '',
        },
        { field: 'spend', headerName: 'Spend', width: 100, sort: 'desc' as const, valueFormatter: (p: ValueFormatterParams) => formatCurrency(p.value) },
        { field: 'impressions', headerName: 'Impr', width: 90, valueFormatter: (p: ValueFormatterParams) => fmt(p.value) },
        { field: 'clicks', headerName: 'Clicks', width: 80, valueFormatter: (p: ValueFormatterParams) => fmt(p.value) },
        { field: 'ctr', headerName: 'CTR', width: 70, valueFormatter: (p: ValueFormatterParams) => fmtPct(p.value) },
        { field: 'orders', headerName: 'Orders', width: 80 },
        { field: 'unitsSold', headerName: 'Units', width: 70 },
        { field: 'revenue', headerName: 'Revenue', width: 100, valueFormatter: (p: ValueFormatterParams) => formatCurrency(p.value) },
        {
            field: 'roas', headerName: 'ROAS', width: 85,
            valueFormatter: (p: ValueFormatterParams) => p.value > 0 ? `${Number(p.value).toFixed(2)}x` : '-',
            cellStyle: (params: { value: number }) => {
                if (params.value >= 3) return { color: '#16a34a', fontWeight: 600 };
                if (params.value >= 1.5) return { color: '#d97706', fontWeight: 600 };
                if (params.value > 0) return { color: '#dc2626', fontWeight: 600 };
                return null;
            },
        },
    ];

    return (
        <div className="space-y-5">
            {/* Summary KPIs */}
            <div className="grid grid-cols-2 lg:grid-cols-5 gap-3">
                <KPICard label="Products Shown" value={fmt(data.length)} subtext="Unique products in catalog ads" />
                <KPICard label="Ad Spend" value={formatCurrency(totalSpend)} subtext={`${formatCurrency(Math.round(totalSpend / Math.max(data.length, 1)))}/product avg`} />
                <KPICard label="Shopify Revenue" value={formatCurrency(totalRevenue)} subtext={`${fmt(totalOrders)} orders in period`} />
                <KPICard label="Blended ROAS" value={overallRoas > 0 ? `${overallRoas.toFixed(2)}x` : '-'} subtext="Revenue ÷ Ad Spend" accent={overallRoas >= 3} />
                <KPICard label="Total Clicks" value={fmt(totalClicks)} subtext={`CPC ${formatCurrency(totalClicks > 0 ? Math.round(totalSpend / totalClicks) : 0)}`} />
            </div>

            {/* Info */}
            <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
                <p className="text-sm text-blue-800">
                    <span className="font-semibold">How this works:</span> Ad spend, clicks, and impressions come from Meta's API per product.
                    Orders and revenue come from your Shopify data in the same date range.
                    ROAS = Shopify Revenue ÷ Meta Ad Spend per product.
                </p>
            </div>

            {/* Top & Worst performers */}
            <div className="flex gap-3">
                {/* Best ROAS */}
                <div className="flex-1 bg-white rounded-lg border border-stone-200 p-5">
                    <h3 className="text-sm font-semibold text-green-700">Top Performers by ROAS</h3>
                    <p className="text-xs text-stone-400 mt-0.5">Best return on ad spend</p>
                    <div className="mt-4 space-y-0">
                        <div className="flex py-2 border-b border-stone-100">
                            <span className="text-[11px] font-semibold text-stone-400 flex-[3]">PRODUCT</span>
                            <span className="text-[11px] font-semibold text-stone-400 flex-1 text-right">SPEND</span>
                            <span className="text-[11px] font-semibold text-stone-400 flex-1 text-right">REVENUE</span>
                            <span className="text-[11px] font-semibold text-stone-400 w-16 text-right">ROAS</span>
                        </div>
                        {topByRoas.map(p => (
                            <div key={p.productId} className="flex py-2.5 border-b border-stone-50 items-center">
                                <div className="flex items-center gap-2 flex-[3] min-w-0">
                                    {p.imageUrl && <img src={p.imageUrl} alt="" className="w-8 h-8 rounded object-cover flex-shrink-0" />}
                                    <span className="text-xs text-stone-800 truncate">{displayName(p)}</span>
                                </div>
                                <span className="text-xs font-mono text-stone-500 flex-1 text-right">{formatCurrency(p.spend)}</span>
                                <span className="text-xs font-mono text-stone-800 flex-1 text-right">{formatCurrency(p.revenue)}</span>
                                <span className="w-16 text-right"><RoasBadge value={p.roas} /></span>
                            </div>
                        ))}
                    </div>
                </div>

                {/* Worst ROAS */}
                <div className="flex-1 bg-white rounded-lg border border-stone-200 p-5">
                    <h3 className="text-sm font-semibold text-red-700">Underperformers</h3>
                    <p className="text-xs text-stone-400 mt-0.5">High spend, low return — consider pausing</p>
                    <div className="mt-4 space-y-0">
                        <div className="flex py-2 border-b border-stone-100">
                            <span className="text-[11px] font-semibold text-stone-400 flex-[3]">PRODUCT</span>
                            <span className="text-[11px] font-semibold text-stone-400 flex-1 text-right">SPEND</span>
                            <span className="text-[11px] font-semibold text-stone-400 flex-1 text-right">REVENUE</span>
                            <span className="text-[11px] font-semibold text-stone-400 w-16 text-right">ROAS</span>
                        </div>
                        {worstByRoas.map(p => (
                            <div key={p.productId} className="flex py-2.5 border-b border-stone-50 items-center">
                                <div className="flex items-center gap-2 flex-[3] min-w-0">
                                    {p.imageUrl && <img src={p.imageUrl} alt="" className="w-8 h-8 rounded object-cover flex-shrink-0" />}
                                    <span className="text-xs text-stone-800 truncate">{displayName(p)}</span>
                                </div>
                                <span className="text-xs font-mono text-stone-500 flex-1 text-right">{formatCurrency(p.spend)}</span>
                                <span className="text-xs font-mono text-stone-800 flex-1 text-right">{formatCurrency(p.revenue)}</span>
                                <span className="w-16 text-right"><RoasBadge value={p.roas} /></span>
                            </div>
                        ))}
                    </div>
                </div>
            </div>

            {/* Full Product Grid */}
            <div className="bg-white rounded-lg border border-stone-200 p-5">
                <h3 className="text-sm font-semibold text-stone-800 mb-3">All Products ({data.length} products)</h3>
                <div style={{ height: 500 }}>
                    <AgGridReact<MetaProductEnrichedRow>
                        rowData={data}
                        columnDefs={cols}
                        rowHeight={48}
                        defaultColDef={DEFAULT_COL_DEF}
                        theme={compactThemeSmall}
                        suppressCellFocus
                    />
                </div>
            </div>
        </div>
    );
}

// ============================================
// FUNNEL SUB-TAB
// ============================================

function FunnelSubTab({ days }: { days: number }) {
    const summary = useMetaSummary(days);
    const daily = useMetaDailyTrend(days);

    if (summary.isLoading) return <div className="space-y-5"><ChartSkeleton /><ChartSkeleton /></div>;
    if (summary.error) return <ErrorState error={summary.error} />;

    const s = summary.data;
    if (!s) return <ErrorState error={null} />;

    const dailyData = daily.data ?? [];

    // Funnel steps with drop-off
    const funnelSteps = [
        { label: 'Impressions', value: s.impressions },
        { label: 'Clicks', value: s.clicks },
        { label: 'View Content', value: s.viewContents },
        { label: 'Add to Cart', value: s.addToCarts },
        { label: 'Checkout', value: s.initiateCheckouts },
        { label: 'Purchase', value: s.purchases },
    ];

    const maxVal = funnelSteps[0].value;

    return (
        <div className="space-y-5">
            {/* Visual Funnel */}
            <div className="bg-white rounded-lg border border-stone-200 p-5">
                <h3 className="text-sm font-semibold text-stone-800">Conversion Funnel</h3>
                <p className="text-xs text-stone-400 mt-0.5">Full path from impression to purchase</p>
                <div className="mt-6 space-y-3">
                    {funnelSteps.map((step, i) => {
                        const widthPct = maxVal > 0 ? Math.max((step.value / maxVal) * 100, 3) : 3;
                        const prev = i > 0 ? funnelSteps[i - 1].value : 0;
                        const dropOff = prev > 0 ? ((prev - step.value) / prev * 100).toFixed(1) : null;
                        const stepRate = i > 0 && funnelSteps[0].value > 0 ? ((step.value / funnelSteps[0].value) * 100).toFixed(2) : null;

                        return (
                            <div key={step.label}>
                                <div className="flex items-center justify-between mb-1.5">
                                    <span className={`text-sm ${i === funnelSteps.length - 1 ? 'font-semibold text-blue-600' : 'font-medium text-stone-700'}`}>{step.label}</span>
                                    <div className="flex items-center gap-3">
                                        <span className="text-sm font-bold font-mono text-stone-900">{fmt(step.value)}</span>
                                        {stepRate && <span className="text-[11px] text-stone-400">{stepRate}% of impr</span>}
                                    </div>
                                </div>
                                <div className="w-full bg-stone-100 rounded h-7">
                                    <div
                                        className={`h-7 rounded transition-all ${i === funnelSteps.length - 1 ? 'bg-blue-500' : 'bg-stone-700'}`}
                                        style={{ width: `${widthPct}%`, opacity: 1 - (i * 0.12) }}
                                    />
                                </div>
                                {dropOff && (
                                    <div className="flex items-center gap-1.5 mt-1 ml-1">
                                        <svg width="10" height="10" viewBox="0 0 10 10" className="text-stone-400">
                                            <path d="M3 3l4 4M3 7l4-4" fill="none" stroke="currentColor" strokeWidth="1.2" />
                                        </svg>
                                        <span className="text-[11px] text-red-400">{dropOff}% drop-off</span>
                                    </div>
                                )}
                            </div>
                        );
                    })}
                </div>
            </div>

            {/* Daily Purchase Trend */}
            {dailyData.length > 0 && (
                <div className="bg-white rounded-lg border border-stone-200 p-5">
                    <h3 className="text-sm font-semibold text-stone-800">Daily Purchases & Revenue</h3>
                    <div className="h-64 mt-4">
                        <ResponsiveContainer width="100%" height="100%">
                            <ComposedChart data={dailyData}>
                                <CartesianGrid strokeDasharray="3 3" stroke="#e7e5e4" />
                                <XAxis dataKey="date" tickFormatter={fmtChartDate} tick={{ fill: '#78716c', fontSize: 11 }} />
                                <YAxis yAxisId="left" tick={{ fill: '#78716c', fontSize: 11 }} />
                                <YAxis yAxisId="right" orientation="right" tick={{ fill: '#78716c', fontSize: 11 }} tickFormatter={v => `₹${(v / 1000).toFixed(0)}k`} />
                                <Tooltip
                                    formatter={(value: number | undefined, name?: string) => [
                                        name === 'purchaseValue' ? formatCurrency(value ?? 0) : fmt(value ?? 0),
                                        name === 'purchaseValue' ? 'Revenue' : 'Purchases',
                                    ]}
                                    labelFormatter={fmtChartDate}
                                />
                                <Bar yAxisId="left" dataKey="purchases" fill="#1877F2" name="purchases" radius={[2, 2, 0, 0]} />
                                <Line yAxisId="right" dataKey="purchaseValue" stroke="#16a34a" strokeWidth={2} dot={false} name="purchaseValue" />
                            </ComposedChart>
                        </ResponsiveContainer>
                    </div>
                </div>
            )}

            {/* Key Conversion Metrics */}
            <div className="bg-white rounded-lg border border-stone-200 p-5">
                <h3 className="text-sm font-semibold text-stone-800 mb-4">Key Metrics</h3>
                <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
                    <div className="space-y-1">
                        <p className="text-[11px] text-stone-400 uppercase tracking-wider">Click → ATC Rate</p>
                        <p className="text-xl font-bold text-stone-900">{s.clicks > 0 ? `${((s.addToCarts / s.clicks) * 100).toFixed(2)}%` : '-'}</p>
                    </div>
                    <div className="space-y-1">
                        <p className="text-[11px] text-stone-400 uppercase tracking-wider">ATC → Checkout Rate</p>
                        <p className="text-xl font-bold text-stone-900">{s.addToCarts > 0 ? `${((s.initiateCheckouts / s.addToCarts) * 100).toFixed(1)}%` : '-'}</p>
                    </div>
                    <div className="space-y-1">
                        <p className="text-[11px] text-stone-400 uppercase tracking-wider">Checkout → Purchase</p>
                        <p className="text-xl font-bold text-stone-900">{s.initiateCheckouts > 0 ? `${((s.purchases / s.initiateCheckouts) * 100).toFixed(1)}%` : '-'}</p>
                    </div>
                    <div className="space-y-1">
                        <p className="text-[11px] text-stone-400 uppercase tracking-wider">Overall Conv Rate</p>
                        <p className="text-xl font-bold text-stone-900">{s.clicks > 0 ? `${((s.purchases / s.clicks) * 100).toFixed(2)}%` : '-'}</p>
                    </div>
                </div>
            </div>
        </div>
    );
}

// ============================================
// MAIN COMPONENT
// ============================================

export default function MetaAdsAnalysis({ days }: { days: number }) {
    const [subTab, setSubTab] = useState<MetaSubTab>('overview');

    return (
        <div className="space-y-5">
            {/* Sub-tabs */}
            <div className="flex gap-1">
                {SUB_TABS.map(t => (
                    <button
                        key={t.key}
                        onClick={() => setSubTab(t.key)}
                        className={`px-3 py-1.5 text-sm font-medium rounded-md transition-colors ${
                            subTab === t.key
                                ? 'bg-[#1877F2] text-white'
                                : 'bg-stone-100 text-stone-600 hover:bg-stone-200'
                        }`}
                    >
                        {t.label}
                    </button>
                ))}
            </div>

            {/* Sub-tab content */}
            {subTab === 'overview' && <OverviewSubTab days={days} />}
            {subTab === 'campaigns' && <CampaignsSubTab days={days} />}
            {subTab === 'audience' && <AudienceSubTab days={days} />}
            {subTab === 'placements' && <PlacementsSubTab days={days} />}
            {subTab === 'creative' && <CreativeSubTab days={days} />}
            {subTab === 'landing-page' && <LandingPageSubTab days={days} />}
            {subTab === 'products' && <ProductsSubTab days={days} />}
            {subTab === 'funnel' && <FunnelSubTab days={days} />}
        </div>
    );
}
