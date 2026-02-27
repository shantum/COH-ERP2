/**
 * Sales Analytics Page
 * Shows sales metrics with charts and breakdowns by various dimensions
 */

import { useState, useMemo, useCallback, useEffect, memo } from 'react';
import { BarChart, Bar, AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Cell } from 'recharts';
import { AgGridReact } from 'ag-grid-react';
import type { ColDef, ValueFormatterParams, ColumnResizedEvent, Column, ICellRendererParams } from 'ag-grid-community';
import { AllCommunityModule, ModuleRegistry } from 'ag-grid-community';
import { TrendingUp, Package, ShoppingCart, DollarSign, Calendar, ChevronRight } from 'lucide-react';
import { useSalesAnalytics, getDateRange } from '../hooks/useSalesAnalytics';
import { compactThemeSmall } from '../utils/agGridHelpers';
import { formatCurrency } from '../utils/formatting';
import type { SalesDimension, SalesBreakdownItem } from '../types';

ModuleRegistry.registerModules([AllCommunityModule]);

// Dimension options for tabs
const DIMENSIONS: { key: SalesDimension; label: string }[] = [
    { key: 'summary', label: 'Overview' },
    { key: 'product', label: 'By Product' },
    { key: 'category', label: 'By Category' },
    { key: 'gender', label: 'By Gender' },
    { key: 'color', label: 'By Color' },
    { key: 'standardColor', label: 'By Std Color' },
    { key: 'material', label: 'By Material' },
    { key: 'fabric', label: 'By Fabric' },
    { key: 'fabricColour', label: 'By Fabric Colour' },
    { key: 'channel', label: 'By Channel' },
];

// Chart colors
const CHART_COLORS = ['#3B82F6', '#10B981', '#F59E0B', '#EF4444', '#8B5CF6', '#EC4899', '#06B6D4', '#84CC16'];

type DatePreset = '7d' | '30d' | '90d' | 'custom';

const DEFAULT_COL_DEF = {
    sortable: true,
    resizable: true,
};

// Extended row type for expandable product rows
interface DisplayRow extends SalesBreakdownItem {
    isGroup?: boolean;
    isChild?: boolean;
    childCount?: number;
}

export default function Analytics() {
    // State
    const [datePreset, setDatePreset] = useState<DatePreset>('30d');
    const [customStart, setCustomStart] = useState('');
    const [customEnd, setCustomEnd] = useState('');
    const [dimension, setDimension] = useState<SalesDimension>('summary');
    const [activeMetric, setActiveMetric] = useState<'revenue' | 'units' | 'orders'>('revenue');
    const [expandedProducts, setExpandedProducts] = useState<Set<string>>(new Set());

    // Column widths state for grid - hydrate after mount to avoid SSR mismatch
    const [columnWidths, setColumnWidths] = useState<Record<string, number>>({});
    useEffect(() => {
        const saved = localStorage.getItem('analyticsGridColumnWidths');
        if (saved) { try { setColumnWidths(JSON.parse(saved)); } catch { /* ignore */ } }
    }, []);

    const handleColumnResized = useCallback((event: ColumnResizedEvent) => {
        if (event.finished && event.columns?.length) {
            event.columns.forEach((col: Column) => {
                const colId = col.getColId();
                const width = col.getActualWidth();
                if (colId && width) {
                    setColumnWidths(prev => {
                        const updated = { ...prev, [colId]: width };
                        localStorage.setItem('analyticsGridColumnWidths', JSON.stringify(updated));
                        return updated;
                    });
                }
            });
        }
    }, []);

    // Calculate date range
    const { startDate, endDate } = useMemo(() => {
        return getDateRange(datePreset, customStart, customEnd);
    }, [datePreset, customStart, customEnd]);

    // Fetch analytics data (includes all orders except cancelled, including archived)
    const { data, isLoading, error } = useSalesAnalytics({
        dimension,
        startDate,
        endDate,
        orderStatus: 'all',
    });

    // Reset expanded state when dimension changes
    useEffect(() => {
        setExpandedProducts(new Set());
    }, [dimension]);

    const toggleProduct = useCallback((key: string) => {
        setExpandedProducts(prev => {
            const next = new Set(prev);
            if (next.has(key)) {
                next.delete(key);
            } else {
                next.add(key);
            }
            return next;
        });
    }, []);

    // Format number
    const formatNumber = (value: number) => {
        return value.toLocaleString('en-IN');
    };

    // Flatten breakdown data for product dimension (parent + expanded children)
    const flatRowData = useMemo((): DisplayRow[] => {
        if (!data?.breakdown) return [];
        if (dimension !== 'product') return data.breakdown;

        const rows: DisplayRow[] = [];
        for (const item of data.breakdown) {
            const hasChildren = item.children && item.children.length > 0;
            rows.push({
                ...item,
                isGroup: !!hasChildren,
                childCount: item.children?.length ?? 0,
            });
            if (hasChildren && expandedProducts.has(item.key)) {
                for (const child of item.children!) {
                    rows.push({
                        ...child,
                        isChild: true,
                    });
                }
            }
        }
        return rows;
    }, [data?.breakdown, dimension, expandedProducts]);

    // Product label cell renderer with expand/collapse
    const ProductLabelRenderer = useMemo(() => {
        return memo(function ProductLabel(params: ICellRendererParams<DisplayRow>) {
            const row = params.data;
            if (!row) return null;

            if (row.isGroup) {
                const expanded = expandedProducts.has(row.key);
                return (
                    <div
                        className="flex items-center gap-1 cursor-pointer select-none"
                        onClick={() => toggleProduct(row.key)}
                    >
                        <ChevronRight
                            size={14}
                            className={`text-gray-400 transition-transform flex-shrink-0 ${expanded ? 'rotate-90' : ''}`}
                        />
                        <span className="font-medium truncate">{row.label}</span>
                        <span className="text-xs text-gray-400 flex-shrink-0">
                            ({row.childCount})
                        </span>
                    </div>
                );
            }

            if (row.isChild) {
                return (
                    <div className="pl-5 text-gray-600 truncate">
                        {row.label}
                    </div>
                );
            }

            return <span className="truncate">{row.label}</span>;
        });
    }, [expandedProducts, toggleProduct]);

    // Column definitions for breakdown table
    const columnDefs: ColDef<DisplayRow>[] = useMemo(() => {
        const baseDefs: ColDef<DisplayRow>[] = [
            {
                field: 'label' as const,
                headerName: getDimensionColumnHeader(dimension),
                flex: 2,
                minWidth: 150,
                ...(dimension === 'product' ? { cellRenderer: ProductLabelRenderer, sortable: false } : {}),
            },
            {
                field: 'revenue',
                headerName: 'Revenue',
                width: 120,
                valueFormatter: (params: ValueFormatterParams) => formatCurrency(params.value || 0),
                cellClass: 'text-right font-medium',
                headerClass: 'ag-right-aligned-header',
            },
            {
                field: 'units',
                headerName: 'Units',
                width: 100,
                valueFormatter: (params: ValueFormatterParams) => formatNumber(params.value || 0),
                cellClass: 'text-right',
                headerClass: 'ag-right-aligned-header',
            },
            {
                field: 'orders',
                headerName: 'Orders',
                width: 100,
                valueFormatter: (params: ValueFormatterParams) => formatNumber(params.value || 0),
                cellClass: 'text-right',
                headerClass: 'ag-right-aligned-header',
            },
            {
                field: 'percentOfTotal',
                headerName: '% of Total',
                width: 110,
                valueFormatter: (params: ValueFormatterParams) => `${(params.value || 0).toFixed(1)}%`,
                cellClass: 'text-right text-gray-500',
                headerClass: 'ag-right-aligned-header',
            },
        ];
        // Apply saved column widths
        return baseDefs.map(col => {
            const savedWidth = col.field ? columnWidths[col.field] : undefined;
            return savedWidth ? { ...col, width: savedWidth } : col;
        });
    }, [dimension, columnWidths, ProductLabelRenderer]);

    // Get chart data based on dimension
    const chartData = useMemo(() => {
        if (dimension === 'summary' && data?.timeSeries) {
            // Time series chart for overview
            return data.timeSeries.map(point => ({
                name: formatChartDate(point.date),
                revenue: point.revenue,
                units: point.units,
                orders: point.orders,
            }));
        } else if (data?.breakdown) {
            // Bar chart for breakdown (top 10) - uses consolidated parent data
            return data.breakdown.slice(0, 10).map(item => ({
                name: item.label.length > 15 ? item.label.substring(0, 15) + '...' : item.label,
                fullName: item.label,
                revenue: item.revenue,
                units: item.units,
                orders: item.orders,
            }));
        }
        return [];
    }, [data, dimension]);

    // Count unique products for product dimension
    const breakdownCount = dimension === 'product'
        ? data?.breakdown?.length ?? 0
        : data?.breakdown?.length ?? 0;

    return (
        <div className="h-full flex flex-col">
            {/* Header */}
            <div className="flex-none px-6 py-4 border-b bg-white">
                <div className="flex items-center justify-between flex-wrap gap-4">
                    <div>
                        <h1 className="text-xl font-semibold text-gray-900">Sales Analytics</h1>
                        <p className="text-sm text-gray-500 mt-0.5">Track sales performance across dimensions</p>
                    </div>

                    {/* Date Range Selector */}
                    <div className="flex items-center gap-2">
                        <div className="flex bg-gray-100 rounded-lg p-0.5">
                            {(['7d', '30d', '90d'] as const).map(preset => (
                                <button
                                    key={preset}
                                    onClick={() => setDatePreset(preset)}
                                    className={`px-3 py-1.5 text-sm font-medium rounded-md transition-colors ${datePreset === preset
                                            ? 'bg-white text-gray-900 shadow-sm'
                                            : 'text-gray-600 hover:text-gray-900'
                                        }`}
                                >
                                    {preset}
                                </button>
                            ))}
                        </div>
                        <div className="flex items-center gap-1.5 text-sm">
                            <Calendar size={14} className="text-gray-400" />
                            <input
                                type="date"
                                value={customStart || startDate}
                                onChange={(e) => {
                                    setCustomStart(e.target.value);
                                    setDatePreset('custom');
                                }}
                                className="border rounded px-2 py-1 text-sm"
                            />
                            <span className="text-gray-400">to</span>
                            <input
                                type="date"
                                value={customEnd || endDate}
                                onChange={(e) => {
                                    setCustomEnd(e.target.value);
                                    setDatePreset('custom');
                                }}
                                className="border rounded px-2 py-1 text-sm"
                            />
                        </div>
                    </div>
                </div>

                {/* Metric Cards */}
                {data?.summary && (
                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 mt-4">
                        <MetricCard
                            label="Total Revenue"
                            value={formatCurrency(data.summary.totalRevenue)}
                            icon={<DollarSign size={20} />}
                            color="blue"
                            active={activeMetric === 'revenue'}
                            onClick={() => setActiveMetric('revenue')}
                        />
                        <MetricCard
                            label="Units Sold"
                            value={formatNumber(data.summary.totalUnits)}
                            icon={<Package size={20} />}
                            color="green"
                            active={activeMetric === 'units'}
                            onClick={() => setActiveMetric('units')}
                        />
                        <MetricCard
                            label="Orders"
                            value={formatNumber(data.summary.totalOrders)}
                            icon={<ShoppingCart size={20} />}
                            color="purple"
                            active={activeMetric === 'orders'}
                            onClick={() => setActiveMetric('orders')}
                        />
                        <MetricCard
                            label="Avg Order Value"
                            value={formatCurrency(data.summary.avgOrderValue)}
                            icon={<TrendingUp size={20} />}
                            color="amber"
                        />
                    </div>
                )}

                {/* Dimension Tabs */}
                <div className="flex gap-1 mt-4 overflow-x-auto pb-1">
                    {DIMENSIONS.map(dim => (
                        <button
                            key={dim.key}
                            onClick={() => setDimension(dim.key)}
                            className={`px-3 py-1.5 text-sm font-medium rounded-md whitespace-nowrap transition-colors ${dimension === dim.key
                                    ? 'bg-primary-100 text-primary-700'
                                    : 'text-gray-600 hover:bg-gray-100'
                                }`}
                        >
                            {dim.label}
                        </button>
                    ))}
                </div>
            </div>

            {/* Content */}
            <div className="flex-1 overflow-auto p-6 bg-gray-50">
                {isLoading ? (
                    <div className="flex items-center justify-center h-64">
                        <div className="text-gray-500">Loading analytics...</div>
                    </div>
                ) : error ? (
                    <div className="flex items-center justify-center h-64">
                        <div className="text-red-500">Failed to load analytics data</div>
                    </div>
                ) : (
                    <div className="space-y-6">
                        {/* Chart */}
                        <div className="bg-white rounded-xl p-4 shadow-sm">
                            <h3 className="text-sm font-medium text-gray-700 mb-4">
                                {dimension === 'summary' ? 'Sales Trend' : `Sales by ${getDimensionLabel(dimension)}`}
                            </h3>
                            <div className="h-72">
                                <ResponsiveContainer width="100%" height="100%">
                                    {dimension === 'summary' ? (
                                        <AreaChart data={chartData}>
                                            <CartesianGrid strokeDasharray="3 3" stroke="#E5E7EB" />
                                            <XAxis dataKey="name" tick={{ fontSize: 12 }} stroke="#9CA3AF" />
                                            <YAxis
                                                tick={{ fontSize: 12 }}
                                                stroke="#9CA3AF"
                                                tickFormatter={(value) =>
                                                    activeMetric === 'revenue' ? formatCurrency(value) : value
                                                }
                                            />
                                            <Tooltip
                                                formatter={(value) => {
                                                    const v = Number(value) || 0;
                                                    return activeMetric === 'revenue'
                                                        ? [`₹${v.toLocaleString('en-IN')}`, 'Revenue']
                                                        : [v, activeMetric === 'units' ? 'Units' : 'Orders'];
                                                }}
                                            />
                                            <Area
                                                type="monotone"
                                                dataKey={activeMetric}
                                                stroke="#3B82F6"
                                                fill="#93C5FD"
                                                strokeWidth={2}
                                            />
                                        </AreaChart>
                                    ) : (
                                        <BarChart data={chartData} layout="vertical" margin={{ left: 20 }}>
                                            <CartesianGrid strokeDasharray="3 3" stroke="#E5E7EB" />
                                            <XAxis
                                                type="number"
                                                tick={{ fontSize: 12 }}
                                                stroke="#9CA3AF"
                                                tickFormatter={(value) =>
                                                    activeMetric === 'revenue' ? formatCurrency(value) : value
                                                }
                                            />
                                            <YAxis
                                                type="category"
                                                dataKey="name"
                                                width={120}
                                                tick={{ fontSize: 11 }}
                                                stroke="#9CA3AF"
                                            />
                                            <Tooltip
                                                formatter={(value, name, props) => {
                                                    const v = Number(value) || 0;
                                                    const label = props?.payload?.fullName || name;
                                                    return activeMetric === 'revenue'
                                                        ? [`₹${v.toLocaleString('en-IN')}`, label]
                                                        : [v, label];
                                                }}
                                            />
                                            <Bar dataKey={activeMetric} radius={[0, 4, 4, 0]}>
                                                {chartData.map((_, index) => (
                                                    <Cell key={index} fill={CHART_COLORS[index % CHART_COLORS.length]} />
                                                ))}
                                            </Bar>
                                        </BarChart>
                                    )}
                                </ResponsiveContainer>
                            </div>
                        </div>

                        {/* Breakdown Table */}
                        {dimension !== 'summary' && data?.breakdown && (
                            <div className="bg-white rounded-xl shadow-sm overflow-hidden">
                                <div className="px-4 py-3 border-b flex items-center justify-between">
                                    <h3 className="text-sm font-medium text-gray-700">
                                        Detailed Breakdown ({breakdownCount} {dimension === 'product' ? 'products' : 'items'})
                                    </h3>
                                    {dimension === 'product' && data.breakdown.some(b => b.children?.length) && (
                                        <button
                                            onClick={() => {
                                                if (expandedProducts.size > 0) {
                                                    setExpandedProducts(new Set());
                                                } else {
                                                    const allKeys = data.breakdown!
                                                        .filter(b => b.children?.length)
                                                        .map(b => b.key);
                                                    setExpandedProducts(new Set(allKeys));
                                                }
                                            }}
                                            className="text-xs text-gray-500 hover:text-gray-700 transition-colors"
                                        >
                                            {expandedProducts.size > 0 ? 'Collapse All' : 'Expand All'}
                                        </button>
                                    )}
                                </div>
                                <div className="h-96">
                                    <AgGridReact<DisplayRow>
                                        rowData={flatRowData}
                                        columnDefs={columnDefs}
                                        theme={compactThemeSmall}
                                        defaultColDef={DEFAULT_COL_DEF}
                                        animateRows={true}
                                        pagination={true}
                                        paginationPageSize={20}
                                        onColumnResized={handleColumnResized}
                                        enableCellTextSelection={true}
                                        ensureDomOrder={true}
                                        getRowStyle={(params) => {
                                            if (params.data?.isChild) {
                                                return { backgroundColor: '#F9FAFB' };
                                            }
                                            return undefined;
                                        }}
                                    />
                                </div>
                            </div>
                        )}
                    </div>
                )}
            </div>
        </div>
    );
}

// Metric Card Component
interface MetricCardProps {
    label: string;
    value: string;
    icon: React.ReactNode;
    color: 'blue' | 'green' | 'purple' | 'amber';
    active?: boolean;
    onClick?: () => void;
}

function MetricCard({ label, value, icon, color, active, onClick }: MetricCardProps) {
    const colorClasses = {
        blue: 'bg-blue-50 text-blue-600',
        green: 'bg-green-50 text-green-600',
        purple: 'bg-purple-50 text-purple-600',
        amber: 'bg-amber-50 text-amber-600',
    };

    const activeClasses = active ? 'ring-2 ring-primary-500 ring-offset-2' : '';

    return (
        <button
            onClick={onClick}
            disabled={!onClick}
            className={`bg-white rounded-xl p-4 shadow-sm text-left transition-all ${activeClasses} ${onClick ? 'hover:shadow-md cursor-pointer' : 'cursor-default'
                }`}
        >
            <div className="flex items-center gap-3">
                <div className={`p-2 rounded-lg ${colorClasses[color]}`}>{icon}</div>
                <div>
                    <p className="text-xs text-gray-500 font-medium">{label}</p>
                    <p className="text-lg font-semibold text-gray-900">{value}</p>
                </div>
            </div>
        </button>
    );
}

// Helper functions
function getDimensionLabel(dimension: SalesDimension): string {
    const labels: Record<SalesDimension, string> = {
        summary: 'Overview',
        product: 'Product',
        category: 'Category',
        gender: 'Gender',
        color: 'Color',
        standardColor: 'Standard Color',
        material: 'Material',
        fabric: 'Fabric',
        fabricColour: 'Fabric Colour',
        channel: 'Channel',
    };
    return labels[dimension];
}

function getDimensionColumnHeader(dimension: SalesDimension): string {
    const headers: Record<SalesDimension, string> = {
        summary: 'Item',
        product: 'Product',
        category: 'Category',
        gender: 'Gender',
        color: 'Color',
        standardColor: 'Standard Color',
        material: 'Material',
        fabric: 'Fabric',
        fabricColour: 'Fabric Colour',
        channel: 'Channel',
    };
    return headers[dimension];
}

function formatChartDate(dateStr: string): string {
    // Parse YYYY-MM-DD as local date parts to avoid timezone shifts
    // Server already returns IST-based dates
    const [year, month, day] = dateStr.split('-').map(Number);
    const date = new Date(year, month - 1, day); // month is 0-indexed
    return date.toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });
}
