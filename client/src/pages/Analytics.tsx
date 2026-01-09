/**
 * Sales Analytics Page
 * Shows sales metrics with charts and breakdowns by various dimensions
 */

import { useState, useMemo } from 'react';
import { BarChart, Bar, AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Cell } from 'recharts';
import { AgGridReact } from 'ag-grid-react';
import type { ColDef, ValueFormatterParams } from 'ag-grid-community';
import { AllCommunityModule, ModuleRegistry } from 'ag-grid-community';
import { TrendingUp, Package, ShoppingCart, DollarSign, Calendar } from 'lucide-react';
import { useSalesAnalytics, getDateRange } from '../hooks/useSalesAnalytics';
import { compactThemeSmall } from '../utils/agGridHelpers';
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
    { key: 'fabricType', label: 'By Fabric Type' },
    { key: 'fabricColor', label: 'By Fabric Color' },
    { key: 'channel', label: 'By Channel' },
];

// Chart colors
const CHART_COLORS = ['#3B82F6', '#10B981', '#F59E0B', '#EF4444', '#8B5CF6', '#EC4899', '#06B6D4', '#84CC16'];

type DatePreset = '7d' | '30d' | '90d' | 'custom';

export default function Analytics() {
    // State
    const [datePreset, setDatePreset] = useState<DatePreset>('30d');
    const [customStart, setCustomStart] = useState('');
    const [customEnd, setCustomEnd] = useState('');
    const [dimension, setDimension] = useState<SalesDimension>('summary');
    const [activeMetric, setActiveMetric] = useState<'revenue' | 'units' | 'orders'>('revenue');

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

    // Format currency
    const formatCurrency = (value: number) => {
        if (value >= 100000) return `₹${(value / 100000).toFixed(1)}L`;
        if (value >= 1000) return `₹${(value / 1000).toFixed(1)}K`;
        return `₹${value.toFixed(0)}`;
    };

    // Format number
    const formatNumber = (value: number) => {
        return value.toLocaleString('en-IN');
    };

    // Column definitions for breakdown table
    const columnDefs: ColDef<SalesBreakdownItem>[] = useMemo(() => [
        {
            field: 'key',
            headerName: getDimensionColumnHeader(dimension),
            flex: 2,
            minWidth: 150,
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
    ], [dimension]);

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
            // Bar chart for breakdown (top 10)
            return data.breakdown.slice(0, 10).map(item => ({
                name: item.key.length > 15 ? item.key.substring(0, 15) + '...' : item.key,
                fullName: item.key,
                revenue: item.revenue,
                units: item.units,
                orders: item.orders,
            }));
        }
        return [];
    }, [data, dimension]);

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
                                    className={`px-3 py-1.5 text-sm font-medium rounded-md transition-colors ${
                                        datePreset === preset
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
                            className={`px-3 py-1.5 text-sm font-medium rounded-md whitespace-nowrap transition-colors ${
                                dimension === dim.key
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
                                <div className="px-4 py-3 border-b">
                                    <h3 className="text-sm font-medium text-gray-700">
                                        Detailed Breakdown ({data.breakdown.length} items)
                                    </h3>
                                </div>
                                <div className="h-96">
                                    <AgGridReact
                                        rowData={data.breakdown}
                                        columnDefs={columnDefs}
                                        theme={compactThemeSmall}
                                        defaultColDef={{
                                            sortable: true,
                                            resizable: true,
                                        }}
                                        animateRows={true}
                                        pagination={true}
                                        paginationPageSize={20}
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
            className={`bg-white rounded-xl p-4 shadow-sm text-left transition-all ${activeClasses} ${
                onClick ? 'hover:shadow-md cursor-pointer' : 'cursor-default'
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
        fabricType: 'Fabric Type',
        fabricColor: 'Fabric Color',
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
        fabricType: 'Fabric Type',
        fabricColor: 'Fabric Color',
        channel: 'Channel',
    };
    return headers[dimension];
}

function formatChartDate(dateStr: string): string {
    const date = new Date(dateStr);
    return date.toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });
}
