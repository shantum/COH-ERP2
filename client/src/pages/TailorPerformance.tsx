/**
 * Tailor Performance Dashboard
 *
 * Shows production metrics per tailor from inward inventory data:
 * summary cards, bar chart, monthly trend, sortable table, and SKU drill-down.
 */

import { useState, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useServerFn } from '@tanstack/react-start';
import { useNavigate } from '@tanstack/react-router';
import { Route } from '../routes/_authenticated/tailor-performance';
import {
    BarChart,
    Bar,
    AreaChart,
    Area,
    XAxis,
    YAxis,
    CartesianGrid,
    Tooltip,
    ResponsiveContainer,
    Legend,
    Cell,
    LabelList,
} from 'recharts';
import { Users, Package, IndianRupee, TrendingUp, ChevronUp, ChevronDown, ChevronsUpDown, X } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '../components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '../components/ui/table';
import { ToggleGroup, ToggleGroupItem } from '../components/ui/toggle-group';
import { Button } from '../components/ui/button';
import { formatCurrency, formatNumber } from '../utils/formatting';
import { getTailorPerformance } from '../server/functions/tailorPerformance';
import type {
    TailorSummary,
    TailorMonthly,
    TailorSkuRow,
} from '../server/functions/tailorPerformance';

// ============================================
// CONSTANTS
// ============================================

type Period = 'all' | '12m' | '6m' | '3m' | '1m';

const CHART_COLORS = [
    '#3B82F6', '#10B981', '#F59E0B', '#EF4444',
    '#8B5CF6', '#EC4899', '#06B6D4', '#84CC16',
    '#F97316', '#14B8A6', '#A855F7', '#E11D48',
];

const TAILOR_AREA_COLORS: Record<string, string> = {
    others: '#6B7280',
};

function getTailorColor(index: number): string {
    return CHART_COLORS[index % CHART_COLORS.length];
}

function formatDate(dateStr: string): string {
    return new Date(dateStr).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: '2-digit' });
}

// ============================================
// MAIN PAGE
// ============================================

export default function TailorPerformance() {
    const { period } = Route.useSearch();
    const navigate = useNavigate();
    const [selectedTailor, setSelectedTailor] = useState<string | null>(null);

    const fetchFn = useServerFn(getTailorPerformance);
    const { data, isLoading } = useQuery({
        queryKey: ['tailor-performance', 'dashboard', 'getTailorPerformance', period],
        queryFn: () => fetchFn({ data: { period } }),
    });

    const setPeriod = (p: Period) => {
        navigate({ to: '/tailor-performance', search: { period: p } });
    };

    if (isLoading || !data) {
        return (
            <div className="mx-auto max-w-7xl px-4 py-6">
                <div className="flex items-center justify-between mb-6">
                    <h1 className="text-xl font-semibold tracking-tight">Tailor Performance</h1>
                </div>
                <div className="text-sm text-muted-foreground">Loading...</div>
            </div>
        );
    }

    const selectedSkuData = selectedTailor ? data.skuByTailor[selectedTailor] : null;

    return (
        <div className="mx-auto max-w-7xl px-4 py-6">
            {/* Header */}
            <div className="mb-6 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
                <h1 className="text-xl font-semibold tracking-tight">Tailor Performance</h1>
                <DateFilter value={period} onChange={setPeriod} />
            </div>

            <div className="space-y-4">
                <SummaryCards data={data.summary} />
                <Charts summary={data.summary} monthly={data.monthly} />
                <TailorTable
                    data={data.summary}
                    selectedTailor={selectedTailor}
                    onSelectTailor={setSelectedTailor}
                />
                {selectedTailor && selectedSkuData && (
                    <SKUBreakdown
                        tailorNumber={selectedTailor}
                        skuData={selectedSkuData}
                        onClose={() => setSelectedTailor(null)}
                    />
                )}
            </div>
        </div>
    );
}

// ============================================
// DATE FILTER
// ============================================

function DateFilter({ value, onChange }: { value: Period; onChange: (v: Period) => void }) {
    return (
        <ToggleGroup
            type="single"
            value={value}
            onValueChange={(v) => v && onChange(v as Period)}
            className="gap-1"
        >
            {(['all', '12m', '6m', '3m', '1m'] as const).map((p) => (
                <ToggleGroupItem
                    key={p}
                    value={p}
                    className="h-7 px-3 text-xs data-[state=on]:bg-primary data-[state=on]:text-primary-foreground"
                >
                    {p === 'all' ? 'All Time' : p.toUpperCase()}
                </ToggleGroupItem>
            ))}
        </ToggleGroup>
    );
}

// ============================================
// SUMMARY CARDS
// ============================================

function SummaryCards({ data }: { data: TailorSummary[] }) {
    const activeTailors = data.length;
    const totalPieces = data.reduce((sum, t) => sum + t.totalPcs, 0);
    const totalMrpValue = data.reduce((sum, t) => sum + t.mrpValue, 0);
    const totalActiveMonths = data.reduce((sum, t) => sum + t.activeMonths, 0);
    const avgPcsPerTailorMonth = totalActiveMonths > 0 ? totalPieces / totalActiveMonths : 0;

    const cards = [
        { title: 'Active Tailors', value: String(activeTailors), icon: Users, color: 'text-blue-500' },
        { title: 'Total Pieces', value: formatNumber(Math.round(totalPieces)), icon: Package, color: 'text-emerald-500' },
        { title: 'Production Value (MRP)', value: formatCurrency(totalMrpValue), icon: IndianRupee, color: 'text-amber-500' },
        { title: 'Avg Pcs/Tailor/Month', value: avgPcsPerTailorMonth.toFixed(1), icon: TrendingUp, color: 'text-purple-500' },
    ];

    return (
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            {cards.map((card) => (
                <Card key={card.title} className="border-muted">
                    <CardContent className="p-4">
                        <div className="flex items-center justify-between">
                            <div>
                                <p className="text-xs text-muted-foreground">{card.title}</p>
                                <p className="text-2xl font-semibold tracking-tight">{card.value}</p>
                            </div>
                            <card.icon className={`h-8 w-8 ${card.color} opacity-80`} />
                        </div>
                    </CardContent>
                </Card>
            ))}
        </div>
    );
}

// ============================================
// CHARTS
// ============================================

function Charts({ summary, monthly }: { summary: TailorSummary[]; monthly: TailorMonthly[] }) {
    // Horizontal bar data sorted ascending for bottom-to-top display
    const barData = [...summary]
        .sort((a, b) => a.totalPcs - b.totalPcs)
        .map((t) => ({ tailor: `#${t.tailorNumber}`, pieces: Math.round(t.totalPcs) }));

    // Top 6 tailors for area chart
    const top6 = summary.slice(0, 6).map((s) => s.tailorNumber);

    return (
        <div className="grid gap-4 lg:grid-cols-2">
            {/* Horizontal Bar Chart */}
            <Card className="border-muted">
                <CardHeader className="pb-2">
                    <CardTitle className="text-sm font-medium">Pieces by Tailor</CardTitle>
                </CardHeader>
                <CardContent className="pt-0">
                    <div className="h-[320px]">
                        <ResponsiveContainer width="100%" height="100%">
                            <BarChart data={barData} layout="vertical" margin={{ top: 5, right: 50, left: 30, bottom: 5 }}>
                                <CartesianGrid strokeDasharray="3 3" className="stroke-muted" horizontal vertical={false} />
                                <XAxis type="number" tick={{ fontSize: 11 }} className="text-muted-foreground" />
                                <YAxis type="category" dataKey="tailor" tick={{ fontSize: 11 }} className="text-muted-foreground" width={35} />
                                <Tooltip
                                    contentStyle={{ backgroundColor: 'hsl(var(--card))', border: '1px solid hsl(var(--border))', borderRadius: '6px', fontSize: '12px' }}
                                    formatter={(value: number | undefined) => [(value ?? 0).toLocaleString('en-IN'), 'Pieces']}
                                />
                                <Bar dataKey="pieces" radius={[0, 4, 4, 0]}>
                                    {barData.map((_, index) => (
                                        <Cell key={index} fill={CHART_COLORS[index % CHART_COLORS.length]} />
                                    ))}
                                    <LabelList
                                        dataKey="pieces"
                                        position="right"
                                        className="fill-foreground text-[10px]"
                                        formatter={(value: unknown) => typeof value === 'number' ? value.toLocaleString('en-IN') : String(value ?? '')}
                                    />
                                </Bar>
                            </BarChart>
                        </ResponsiveContainer>
                    </div>
                </CardContent>
            </Card>

            {/* Stacked Area Chart */}
            <Card className="border-muted">
                <CardHeader className="pb-2">
                    <CardTitle className="text-sm font-medium">Monthly Output</CardTitle>
                </CardHeader>
                <CardContent className="pt-0">
                    <div className="h-[320px]">
                        <ResponsiveContainer width="100%" height="100%">
                            <AreaChart data={monthly} margin={{ top: 5, right: 10, left: 10, bottom: 5 }}>
                                <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
                                <XAxis dataKey="month" tick={{ fontSize: 10 }} className="text-muted-foreground" interval="preserveStartEnd" />
                                <YAxis tick={{ fontSize: 11 }} className="text-muted-foreground" width={35} />
                                <Tooltip
                                    contentStyle={{ backgroundColor: 'hsl(var(--card))', border: '1px solid hsl(var(--border))', borderRadius: '6px', fontSize: '12px' }}
                                />
                                <Legend
                                    wrapperStyle={{ fontSize: '11px', paddingTop: '10px' }}
                                    formatter={(value: string) => (value === 'others' ? 'Others' : `#${value}`)}
                                />
                                {top6.map((t, i) => (
                                    <Area
                                        key={t}
                                        type="monotone"
                                        dataKey={t}
                                        stackId="1"
                                        stroke={getTailorColor(i)}
                                        fill={getTailorColor(i)}
                                        fillOpacity={0.6}
                                    />
                                ))}
                                <Area
                                    type="monotone"
                                    dataKey="others"
                                    stackId="1"
                                    stroke={TAILOR_AREA_COLORS.others}
                                    fill={TAILOR_AREA_COLORS.others}
                                    fillOpacity={0.4}
                                />
                            </AreaChart>
                        </ResponsiveContainer>
                    </div>
                </CardContent>
            </Card>
        </div>
    );
}

// ============================================
// TAILOR TABLE
// ============================================

type SortKey = 'tailorNumber' | 'totalPcs' | 'mrpValue' | 'productionCost' | 'margin' | 'avgPcsMonth' | 'firstInward' | 'lastInward' | 'activeMonths';
type SortDir = 'asc' | 'desc';

function TailorTable({
    data,
    selectedTailor,
    onSelectTailor,
}: {
    data: TailorSummary[];
    selectedTailor: string | null;
    onSelectTailor: (id: string | null) => void;
}) {
    const [sortKey, setSortKey] = useState<SortKey | null>(null);
    const [sortDir, setSortDir] = useState<SortDir>('desc');

    const handleSort = (key: SortKey) => {
        if (sortKey === key) {
            if (sortDir === 'desc') setSortDir('asc');
            else { setSortKey(null); setSortDir('desc'); }
        } else {
            setSortKey(key);
            setSortDir('desc');
        }
    };

    const sorted = useMemo(() => {
        if (!sortKey) return data;
        return [...data].sort((a, b) => {
            let aVal: number | string;
            let bVal: number | string;
            if (sortKey === 'margin') {
                aVal = a.mrpValue - a.productionCost;
                bVal = b.mrpValue - b.productionCost;
            } else if (sortKey === 'avgPcsMonth') {
                aVal = a.activeMonths > 0 ? a.totalPcs / a.activeMonths : 0;
                bVal = b.activeMonths > 0 ? b.totalPcs / b.activeMonths : 0;
            } else {
                aVal = a[sortKey];
                bVal = b[sortKey];
            }
            if (typeof aVal === 'string' && typeof bVal === 'string') {
                return sortDir === 'asc' ? aVal.localeCompare(bVal) : bVal.localeCompare(aVal);
            }
            return sortDir === 'asc' ? (aVal as number) - (bVal as number) : (bVal as number) - (aVal as number);
        });
    }, [data, sortKey, sortDir]);

    const SortIcon = ({ col }: { col: SortKey }) => {
        if (sortKey !== col) return <ChevronsUpDown className="ml-1 h-3 w-3 opacity-50" />;
        return sortDir === 'asc' ? <ChevronUp className="ml-1 h-3 w-3" /> : <ChevronDown className="ml-1 h-3 w-3" />;
    };

    const columns: { key: SortKey; label: string; align?: 'right' }[] = [
        { key: 'tailorNumber', label: 'Tailor #' },
        { key: 'totalPcs', label: 'Total Pcs', align: 'right' },
        { key: 'mrpValue', label: 'MRP Value', align: 'right' },
        { key: 'productionCost', label: 'Prod. Cost', align: 'right' },
        { key: 'margin', label: 'Margin', align: 'right' },
        { key: 'avgPcsMonth', label: 'Avg Pcs/Mo', align: 'right' },
        { key: 'firstInward', label: 'First Inward' },
        { key: 'lastInward', label: 'Last Inward' },
        { key: 'activeMonths', label: 'Active Mo', align: 'right' },
    ];

    return (
        <Card className="border-muted">
            <CardHeader className="pb-2">
                <CardTitle className="text-sm font-medium">Tailor Summary</CardTitle>
            </CardHeader>
            <CardContent className="pt-0">
                <div className="overflow-x-auto">
                    <Table className="text-xs">
                        <TableHeader>
                            <TableRow className="hover:bg-transparent">
                                {columns.map((col) => (
                                    <TableHead
                                        key={col.key}
                                        className={`cursor-pointer select-none whitespace-nowrap ${col.align === 'right' ? 'text-right' : ''}`}
                                        onClick={() => handleSort(col.key)}
                                    >
                                        <div className={`flex items-center ${col.align === 'right' ? 'justify-end' : ''}`}>
                                            {col.label} <SortIcon col={col.key} />
                                        </div>
                                    </TableHead>
                                ))}
                            </TableRow>
                        </TableHeader>
                        <TableBody>
                            {sorted.map((t, idx) => {
                                const margin = t.mrpValue - t.productionCost;
                                const avgPcs = t.activeMonths > 0 ? t.totalPcs / t.activeMonths : 0;
                                const isSelected = selectedTailor === t.tailorNumber;
                                return (
                                    <TableRow
                                        key={t.tailorNumber}
                                        className={`cursor-pointer transition-colors ${idx % 2 === 0 ? 'bg-muted/30' : ''} ${isSelected ? 'bg-primary/10 hover:bg-primary/15' : ''}`}
                                        onClick={() => onSelectTailor(isSelected ? null : t.tailorNumber)}
                                    >
                                        <TableCell className="font-semibold">#{t.tailorNumber}</TableCell>
                                        <TableCell className="text-right tabular-nums">{formatNumber(Math.round(t.totalPcs))}</TableCell>
                                        <TableCell className="text-right tabular-nums">{formatCurrency(t.mrpValue)}</TableCell>
                                        <TableCell className="text-right tabular-nums">{formatCurrency(t.productionCost)}</TableCell>
                                        <TableCell className="text-right tabular-nums text-emerald-600 dark:text-emerald-400">{formatCurrency(margin)}</TableCell>
                                        <TableCell className="text-right tabular-nums">{avgPcs.toFixed(1)}</TableCell>
                                        <TableCell className="whitespace-nowrap">{formatDate(t.firstInward)}</TableCell>
                                        <TableCell className="whitespace-nowrap">{formatDate(t.lastInward)}</TableCell>
                                        <TableCell className="text-right tabular-nums">{t.activeMonths}</TableCell>
                                    </TableRow>
                                );
                            })}
                        </TableBody>
                    </Table>
                </div>
            </CardContent>
        </Card>
    );
}

// ============================================
// SKU BREAKDOWN (DRILL-DOWN)
// ============================================

function SKUBreakdown({
    tailorNumber,
    skuData,
    onClose,
}: {
    tailorNumber: string;
    skuData: TailorSkuRow[];
    onClose: () => void;
}) {
    const top5 = skuData.slice(0, 5).map((s) => ({
        name: s.productName.length > 18 ? s.productName.slice(0, 18) + '…' : s.productName,
        pieces: Math.round(s.pieces),
    }));

    return (
        <Card className="border-muted animate-in slide-in-from-top-2 duration-200">
            <CardHeader className="pb-2">
                <div className="flex items-center justify-between">
                    <CardTitle className="text-sm font-medium">Tailor #{tailorNumber} — SKU Breakdown</CardTitle>
                    <Button variant="ghost" size="icon" className="h-6 w-6" onClick={onClose}>
                        <X className="h-4 w-4" />
                    </Button>
                </div>
            </CardHeader>
            <CardContent className="pt-0">
                <div className="grid gap-4 lg:grid-cols-[1fr_300px]">
                    {/* SKU Table */}
                    <div className="overflow-x-auto">
                        <Table className="text-xs">
                            <TableHeader>
                                <TableRow className="hover:bg-transparent">
                                    <TableHead className="whitespace-nowrap">SKU Code</TableHead>
                                    <TableHead className="whitespace-nowrap">Product</TableHead>
                                    <TableHead className="whitespace-nowrap">Size</TableHead>
                                    <TableHead className="text-right whitespace-nowrap">Pieces</TableHead>
                                    <TableHead className="text-right whitespace-nowrap">MRP Value</TableHead>
                                    <TableHead className="text-right whitespace-nowrap">Cost</TableHead>
                                </TableRow>
                            </TableHeader>
                            <TableBody>
                                {skuData.map((sku, idx) => (
                                    <TableRow key={`${sku.skuCode}-${sku.size}`} className={idx % 2 === 0 ? 'bg-muted/30' : ''}>
                                        <TableCell className="font-mono text-[11px]">{sku.skuCode}</TableCell>
                                        <TableCell>{sku.productName}</TableCell>
                                        <TableCell>{sku.size}</TableCell>
                                        <TableCell className="text-right tabular-nums">{formatNumber(Math.round(sku.pieces))}</TableCell>
                                        <TableCell className="text-right tabular-nums">{formatCurrency(sku.mrpValue)}</TableCell>
                                        <TableCell className="text-right tabular-nums">{formatCurrency(sku.cost)}</TableCell>
                                    </TableRow>
                                ))}
                            </TableBody>
                        </Table>
                    </div>

                    {/* Top 5 Products Bar Chart */}
                    <div className="flex flex-col">
                        <p className="mb-2 text-xs font-medium text-muted-foreground">Top 5 Products by Pieces</p>
                        <div className="h-[200px]">
                            <ResponsiveContainer width="100%" height="100%">
                                <BarChart data={top5} layout="vertical" margin={{ top: 0, right: 40, left: 0, bottom: 0 }}>
                                    <CartesianGrid strokeDasharray="3 3" className="stroke-muted" horizontal vertical={false} />
                                    <XAxis type="number" tick={{ fontSize: 10 }} className="text-muted-foreground" />
                                    <YAxis type="category" dataKey="name" tick={{ fontSize: 10 }} className="text-muted-foreground" width={80} />
                                    <Tooltip
                                        contentStyle={{ backgroundColor: 'hsl(var(--card))', border: '1px solid hsl(var(--border))', borderRadius: '6px', fontSize: '11px' }}
                                        formatter={(value: number | undefined) => [(value ?? 0).toLocaleString('en-IN'), 'Pieces']}
                                    />
                                    <Bar dataKey="pieces" radius={[0, 4, 4, 0]}>
                                        {top5.map((_, i) => (
                                            <Cell key={i} fill={CHART_COLORS[i % CHART_COLORS.length]} />
                                        ))}
                                    </Bar>
                                </BarChart>
                            </ResponsiveContainer>
                        </div>
                    </div>
                </div>
            </CardContent>
        </Card>
    );
}
