/**
 * Costing Dashboard Page
 *
 * P&L analysis with:
 * - Editable overhead costs (labor, marketing)
 * - Revenue and profit summary cards
 * - Unit economics breakdown
 * - Breakeven analysis
 * - Product contribution table
 */

import { useState, useMemo, useCallback } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useServerFn } from '@tanstack/react-start';
import { useNavigate } from '@tanstack/react-router';
import { Route } from '../routes/_authenticated/costing';
import { AgGridReact } from 'ag-grid-react';
import type { ColDef, ValueFormatterParams } from 'ag-grid-community';
import { AllCommunityModule, ModuleRegistry } from 'ag-grid-community';
import { DollarSign, TrendingUp, TrendingDown, Edit2, Save, X, AlertTriangle, CheckCircle } from 'lucide-react';
import {
    getCostingDashboard,
    getProductContribution,
    getCostingConfig,
    updateCostingConfig,
} from '../server/functions/costing';
import { costingQueryKeys } from '../constants/queryKeys';
import { compactThemeSmall } from '../utils/agGridHelpers';
import { useAccess } from '../hooks/useAccess';
import type { ProductContribution } from '../server/functions/costing';

ModuleRegistry.registerModules([AllCommunityModule]);

type Period = '7d' | '30d' | 'mtd';
type Channel = 'all' | 'shopify_online' | 'marketplace';

const CHANNEL_OPTIONS: { value: Channel; label: string }[] = [
    { value: 'all', label: 'All Channels' },
    { value: 'shopify_online', label: 'Shopify' },
    { value: 'marketplace', label: 'Marketplaces' },
];

export default function Costing() {
    const navigate = useNavigate();
    const { period, channel } = Route.useSearch();
    const queryClient = useQueryClient();
    const { hasAccess } = useAccess();

    // Costing dashboard access check
    if (!hasAccess('costing-dashboard')) {
        return (
            <div className="flex items-center justify-center h-64">
                <div className="text-center">
                    <p className="text-gray-500">Access restricted. You need costing dashboard permission.</p>
                </div>
            </div>
        );
    }

    // Editing state for config panel
    const [isEditingConfig, setIsEditingConfig] = useState(false);
    const [editLaborOverhead, setEditLaborOverhead] = useState<string>('');
    const [editMarketingBudget, setEditMarketingBudget] = useState<string>('');

    // Server functions
    const getCostingDashboardFn = useServerFn(getCostingDashboard);
    const getProductContributionFn = useServerFn(getProductContribution);
    const getCostingConfigFn = useServerFn(getCostingConfig);
    const updateCostingConfigFn = useServerFn(updateCostingConfig);

    // Queries
    const { data: dashboardData, isLoading: isDashboardLoading } = useQuery({
        queryKey: costingQueryKeys.dashboard(period, channel),
        queryFn: () => getCostingDashboardFn({ data: { period, channel } }),
    });

    const { data: productData, isLoading: isProductLoading } = useQuery({
        queryKey: costingQueryKeys.products(period, channel),
        queryFn: () => getProductContributionFn({ data: { period, channel, limit: 50 } }),
    });

    const { data: configData } = useQuery({
        queryKey: costingQueryKeys.config,
        queryFn: () => getCostingConfigFn(),
    });

    // Mutation for updating config
    const updateConfigMutation = useMutation({
        mutationFn: (data: { monthlyLaborOverhead?: number; monthlyMarketingBudget?: number }) =>
            updateCostingConfigFn({ data }),
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ['costing'] });
            setIsEditingConfig(false);
        },
    });

    // Format helpers
    const formatCurrency = useCallback((value: number, compact = false) => {
        if (compact) {
            if (Math.abs(value) >= 10000000) return `${(value / 10000000).toFixed(2)} Cr`;
            if (Math.abs(value) >= 100000) return `${(value / 100000).toFixed(2)} L`;
            if (Math.abs(value) >= 1000) return `${(value / 1000).toFixed(1)} K`;
        }
        return new Intl.NumberFormat('en-IN', {
            style: 'currency',
            currency: 'INR',
            minimumFractionDigits: 0,
            maximumFractionDigits: 0,
        }).format(value);
    }, []);

    const formatPercent = useCallback((value: number) => {
        return `${value >= 0 ? '' : ''}${value.toFixed(1)}%`;
    }, []);

    // Handle period change
    const handlePeriodChange = useCallback((newPeriod: Period) => {
        navigate({ to: '/costing', search: { period: newPeriod, channel } });
    }, [navigate, channel]);

    // Handle channel change
    const handleChannelChange = useCallback((newChannel: Channel) => {
        navigate({ to: '/costing', search: { period, channel: newChannel } });
    }, [navigate, period]);

    // Handle edit config
    const handleStartEdit = useCallback(() => {
        if (configData) {
            setEditLaborOverhead(String(configData.monthlyLaborOverhead));
            setEditMarketingBudget(String(configData.monthlyMarketingBudget));
        }
        setIsEditingConfig(true);
    }, [configData]);

    const handleSaveConfig = useCallback(() => {
        const labor = parseFloat(editLaborOverhead);
        const marketing = parseFloat(editMarketingBudget);

        if (!isNaN(labor) && !isNaN(marketing)) {
            updateConfigMutation.mutate({
                monthlyLaborOverhead: labor,
                monthlyMarketingBudget: marketing,
            });
        }
    }, [editLaborOverhead, editMarketingBudget, updateConfigMutation]);

    const handleCancelEdit = useCallback(() => {
        setIsEditingConfig(false);
    }, []);

    // Column definitions for product contribution table
    const columnDefs: ColDef<ProductContribution>[] = useMemo(() => [
        {
            field: 'productName',
            headerName: 'Product',
            flex: 2,
            minWidth: 180,
        },
        {
            field: 'category',
            headerName: 'Category',
            width: 120,
        },
        {
            field: 'avgMrp',
            headerName: 'Avg MRP',
            width: 100,
            valueFormatter: (params: ValueFormatterParams) => formatCurrency(params.value || 0),
            cellClass: 'text-right',
            headerClass: 'ag-right-aligned-header',
        },
        {
            field: 'avgBomCost',
            headerName: 'BOM Cost',
            width: 100,
            valueFormatter: (params: ValueFormatterParams) => formatCurrency(params.value || 0),
            cellClass: 'text-right',
            headerClass: 'ag-right-aligned-header',
        },
        {
            field: 'contributionPct',
            headerName: 'Contrib %',
            width: 100,
            valueFormatter: (params: ValueFormatterParams) => `${(params.value || 0).toFixed(1)}%`,
            cellClass: (params) => {
                const value = params.value || 0;
                if (value < 50) return 'text-right text-red-600 font-medium';
                if (value < 60) return 'text-right text-amber-600 font-medium';
                return 'text-right text-green-600 font-medium';
            },
            headerClass: 'ag-right-aligned-header',
        },
        {
            field: 'unitsSold',
            headerName: 'Units',
            width: 80,
            valueFormatter: (params: ValueFormatterParams) => (params.value || 0).toLocaleString('en-IN'),
            cellClass: 'text-right',
            headerClass: 'ag-right-aligned-header',
        },
        {
            field: 'revenue',
            headerName: 'Revenue',
            width: 110,
            valueFormatter: (params: ValueFormatterParams) => formatCurrency(params.value || 0),
            cellClass: 'text-right font-medium',
            headerClass: 'ag-right-aligned-header',
        },
        {
            field: 'totalContribution',
            headerName: 'Total Contrib',
            width: 120,
            valueFormatter: (params: ValueFormatterParams) => formatCurrency(params.value || 0),
            cellClass: 'text-right font-medium',
            headerClass: 'ag-right-aligned-header',
        },
        {
            field: 'bomMultiple',
            headerName: 'Multiple',
            width: 90,
            valueFormatter: (params: ValueFormatterParams) => `${(params.value || 0).toFixed(1)}x`,
            cellClass: 'text-right text-gray-500',
            headerClass: 'ag-right-aligned-header',
        },
    ], [formatCurrency]);

    const summary = dashboardData?.summary;
    const breakeven = dashboardData?.breakeven;

    return (
        <div className="h-full flex flex-col">
            {/* Header */}
            <div className="flex-none px-6 py-4 border-b bg-white">
                <div className="flex items-center justify-between flex-wrap gap-4">
                    <div>
                        <h1 className="text-xl font-semibold text-gray-900">Costing Dashboard</h1>
                        <p className="text-sm text-gray-500 mt-0.5">P&L analysis with overhead costs and contribution margins</p>
                    </div>

                    <div className="flex items-center gap-3">
                        {/* Channel Selector */}
                        <div className="flex bg-gray-100 rounded-lg p-0.5">
                            {CHANNEL_OPTIONS.map((opt) => (
                                <button
                                    key={opt.value}
                                    onClick={() => handleChannelChange(opt.value)}
                                    className={`px-3 py-1.5 text-sm font-medium rounded-md transition-colors ${
                                        channel === opt.value
                                            ? 'bg-white text-gray-900 shadow-sm'
                                            : 'text-gray-600 hover:text-gray-900'
                                    }`}
                                >
                                    {opt.label}
                                </button>
                            ))}
                        </div>

                        {/* Period Selector */}
                        <div className="flex bg-gray-100 rounded-lg p-0.5">
                            {(['7d', '30d', 'mtd'] as const).map((p) => (
                                <button
                                    key={p}
                                    onClick={() => handlePeriodChange(p)}
                                    className={`px-3 py-1.5 text-sm font-medium rounded-md transition-colors ${
                                        period === p
                                            ? 'bg-white text-gray-900 shadow-sm'
                                            : 'text-gray-600 hover:text-gray-900'
                                    }`}
                                >
                                    {p === 'mtd' ? 'MTD' : p.toUpperCase()}
                                </button>
                            ))}
                        </div>
                    </div>
                </div>
            </div>

            {/* Content */}
            <div className="flex-1 overflow-auto p-6 bg-gray-50">
                {isDashboardLoading ? (
                    <div className="flex items-center justify-center h-64">
                        <div className="text-gray-500">Loading costing data...</div>
                    </div>
                ) : (
                    <div className="space-y-6">
                        {/* Config Panel + P&L Summary Row */}
                        <div className="grid grid-cols-1 lg:grid-cols-4 gap-4">
                            {/* Config Panel */}
                            <div className="bg-white rounded-xl p-4 shadow-sm">
                                <div className="flex items-center justify-between mb-3">
                                    <h3 className="text-sm font-medium text-gray-700">Monthly Overheads</h3>
                                    {!isEditingConfig ? (
                                        <button
                                            onClick={handleStartEdit}
                                            className="p-1 text-gray-400 hover:text-gray-600 rounded"
                                        >
                                            <Edit2 size={14} />
                                        </button>
                                    ) : (
                                        <div className="flex gap-1">
                                            <button
                                                onClick={handleSaveConfig}
                                                disabled={updateConfigMutation.isPending}
                                                className="p-1 text-green-600 hover:text-green-700 rounded"
                                            >
                                                <Save size={14} />
                                            </button>
                                            <button
                                                onClick={handleCancelEdit}
                                                className="p-1 text-gray-400 hover:text-gray-600 rounded"
                                            >
                                                <X size={14} />
                                            </button>
                                        </div>
                                    )}
                                </div>
                                <div className="space-y-3">
                                    <div>
                                        <label className="text-xs text-gray-500">Labor & Operations</label>
                                        {isEditingConfig ? (
                                            <input
                                                type="number"
                                                value={editLaborOverhead}
                                                onChange={(e) => setEditLaborOverhead(e.target.value)}
                                                className="w-full mt-1 px-2 py-1 text-sm border rounded focus:ring-1 focus:ring-primary-500"
                                            />
                                        ) : (
                                            <p className="text-base font-semibold text-gray-900">
                                                {formatCurrency(configData?.monthlyLaborOverhead ?? 0)}
                                            </p>
                                        )}
                                    </div>
                                    <div>
                                        <label className="text-xs text-gray-500">Marketing & Ads</label>
                                        {isEditingConfig ? (
                                            <input
                                                type="number"
                                                value={editMarketingBudget}
                                                onChange={(e) => setEditMarketingBudget(e.target.value)}
                                                className="w-full mt-1 px-2 py-1 text-sm border rounded focus:ring-1 focus:ring-primary-500"
                                            />
                                        ) : (
                                            <p className="text-base font-semibold text-gray-900">
                                                {formatCurrency(configData?.monthlyMarketingBudget ?? 0)}
                                            </p>
                                        )}
                                    </div>
                                    <div className="pt-2 border-t">
                                        <label className="text-xs text-gray-500">Total Overhead</label>
                                        <p className="text-base font-bold text-gray-900">
                                            {formatCurrency((configData?.monthlyLaborOverhead ?? 0) + (configData?.monthlyMarketingBudget ?? 0))}
                                        </p>
                                    </div>
                                </div>
                            </div>

                            {/* P&L Summary Cards */}
                            <PLCard
                                label="Revenue"
                                value={formatCurrency(summary?.revenue ?? 0, true)}
                                subValue="100%"
                                icon={<DollarSign size={20} />}
                                color="blue"
                            />
                            <PLCard
                                label="Gross Profit"
                                value={formatCurrency(summary?.grossProfit ?? 0, true)}
                                subValue={formatPercent(summary?.grossMarginPct ?? 0)}
                                icon={<TrendingUp size={20} />}
                                color="green"
                            />
                            <PLCard
                                label="Operating Profit"
                                value={formatCurrency(summary?.operatingProfit ?? 0, true)}
                                subValue={formatPercent(summary?.operatingMarginPct ?? 0)}
                                icon={(summary?.operatingProfit ?? 0) >= 0 ? <TrendingUp size={20} /> : <TrendingDown size={20} />}
                                color={(summary?.operatingProfit ?? 0) >= 0 ? 'green' : 'red'}
                            />
                        </div>

                        {/* Unit Economics Cards */}
                        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
                            <UnitCard
                                label="Avg Selling Price"
                                value={formatCurrency(summary?.avgSellingPrice ?? 0)}
                            />
                            <UnitCard
                                label="Avg BOM Cost"
                                value={formatCurrency(summary?.avgBomCost ?? 0)}
                                subValue={summary?.avgSellingPrice ? `${((summary?.avgBomCost ?? 0) / summary.avgSellingPrice * 100).toFixed(1)}%` : undefined}
                            />
                            <UnitCard
                                label="Contribution/Unit"
                                value={formatCurrency(summary?.contributionPerUnit ?? 0)}
                                subValue={summary?.avgSellingPrice ? `${((summary?.contributionPerUnit ?? 0) / summary.avgSellingPrice * 100).toFixed(1)}%` : undefined}
                                highlight
                            />
                            <UnitCard
                                label="Overhead/Unit"
                                value={formatCurrency(summary?.overheadPerUnit ?? 0)}
                            />
                        </div>

                        {/* ROAS Section */}
                        <div className="bg-white rounded-xl p-4 shadow-sm">
                            <h3 className="text-sm font-medium text-gray-700 mb-4">ROAS (Return on Ad Spend)</h3>
                            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                                <div className="text-center p-4 rounded-lg bg-gray-50">
                                    <p className="text-xs text-gray-500 mb-1">Marketing Spend</p>
                                    <p className="text-lg font-semibold text-gray-900">
                                        {formatCurrency(summary?.marketingBudget ?? 0, true)}
                                    </p>
                                </div>
                                <div className={`text-center p-4 rounded-lg ${
                                    summary?.roasStatus === 'above' ? 'bg-green-50' :
                                    summary?.roasStatus === 'below' ? 'bg-red-50' : 'bg-amber-50'
                                }`}>
                                    <p className="text-xs text-gray-500 mb-1">Current ROAS</p>
                                    <p className={`text-2xl font-bold ${
                                        summary?.roasStatus === 'above' ? 'text-green-600' :
                                        summary?.roasStatus === 'below' ? 'text-red-600' : 'text-amber-600'
                                    }`}>
                                        {(summary?.roas ?? 0).toFixed(2)}x
                                    </p>
                                    <p className="text-xs text-gray-500 mt-1">
                                        {summary?.roasStatus === 'above' ? 'Above breakeven' :
                                         summary?.roasStatus === 'below' ? 'Below breakeven' : 'At breakeven'}
                                    </p>
                                </div>
                                <div className="text-center p-4 rounded-lg bg-gray-50 border-2 border-dashed border-gray-300">
                                    <p className="text-xs text-gray-500 mb-1">Breakeven ROAS</p>
                                    <p className="text-lg font-semibold text-gray-700">
                                        {(summary?.breakevenRoas ?? 0).toFixed(2)}x
                                    </p>
                                    <p className="text-xs text-gray-400 mt-1">Minimum to cover costs</p>
                                </div>
                            </div>
                        </div>

                        {/* Breakeven Gauge */}
                        <div className="bg-white rounded-xl p-4 shadow-sm">
                            <h3 className="text-sm font-medium text-gray-700 mb-4">Breakeven Analysis</h3>
                            <div className="space-y-4">
                                {/* Progress bar */}
                                <div>
                                    <div className="flex justify-between text-xs text-gray-500 mb-1">
                                        <span>0</span>
                                        <span>Breakeven: {breakeven?.unitsRequired.toLocaleString('en-IN')} units</span>
                                    </div>
                                    <div className="h-4 bg-gray-200 rounded-full overflow-hidden">
                                        <div
                                            className={`h-full rounded-full transition-all ${
                                                (breakeven?.percentToBreakeven ?? 0) >= 100
                                                    ? 'bg-green-500'
                                                    : (breakeven?.percentToBreakeven ?? 0) >= 75
                                                    ? 'bg-amber-500'
                                                    : 'bg-red-500'
                                            }`}
                                            style={{ width: `${Math.min(breakeven?.percentToBreakeven ?? 0, 100)}%` }}
                                        />
                                    </div>
                                    <div className="flex justify-between text-xs mt-1">
                                        <span className="text-gray-600">
                                            Current: {breakeven?.currentUnits.toLocaleString('en-IN')} units
                                        </span>
                                        <span className={`font-medium ${
                                            (breakeven?.percentToBreakeven ?? 0) >= 100
                                                ? 'text-green-600'
                                                : 'text-amber-600'
                                        }`}>
                                            {(breakeven?.percentToBreakeven ?? 0).toFixed(1)}% to breakeven
                                        </span>
                                    </div>
                                </div>

                                {/* Status message */}
                                <div className={`flex items-center gap-2 p-3 rounded-lg ${
                                    (breakeven?.surplusDeficit ?? 0) >= 0
                                        ? 'bg-green-50 text-green-700'
                                        : 'bg-red-50 text-red-700'
                                }`}>
                                    {(breakeven?.surplusDeficit ?? 0) >= 0 ? (
                                        <>
                                            <CheckCircle size={18} />
                                            <span className="text-sm font-medium">
                                                Surplus: {formatCurrency(breakeven?.surplusDeficit ?? 0, true)} profit
                                            </span>
                                        </>
                                    ) : (
                                        <>
                                            <AlertTriangle size={18} />
                                            <span className="text-sm font-medium">
                                                Deficit: {formatCurrency(Math.abs(breakeven?.surplusDeficit ?? 0), true)} below breakeven
                                            </span>
                                            <span className="text-xs ml-2">
                                                (Need {((breakeven?.unitsRequired ?? 0) - (breakeven?.currentUnits ?? 0)).toLocaleString('en-IN')} more units)
                                            </span>
                                        </>
                                    )}
                                </div>
                            </div>
                        </div>

                        {/* Product Contribution Table */}
                        <div className="bg-white rounded-xl shadow-sm overflow-hidden">
                            <div className="px-4 py-3 border-b flex items-center justify-between">
                                <h3 className="text-sm font-medium text-gray-700">
                                    Product Contribution ({productData?.data.length ?? 0} products)
                                </h3>
                                <div className="text-xs text-gray-500">
                                    Total: {formatCurrency(productData?.totals.totalContribution ?? 0, true)} contribution from {productData?.totals.unitsSold.toLocaleString('en-IN')} units
                                </div>
                            </div>
                            <div className="h-96">
                                <AgGridReact
                                    rowData={productData?.data ?? []}
                                    columnDefs={columnDefs}
                                    theme={compactThemeSmall}
                                    defaultColDef={{
                                        sortable: true,
                                        resizable: true,
                                    }}
                                    animateRows={true}
                                    pagination={true}
                                    paginationPageSize={20}
                                    enableCellTextSelection={true}
                                    ensureDomOrder={true}
                                    loading={isProductLoading}
                                />
                            </div>
                        </div>
                    </div>
                )}
            </div>
        </div>
    );
}

// ============================================
// HELPER COMPONENTS
// ============================================

interface PLCardProps {
    label: string;
    value: string;
    subValue?: string;
    icon: React.ReactNode;
    color: 'blue' | 'green' | 'red' | 'amber';
}

function PLCard({ label, value, subValue, icon, color }: PLCardProps) {
    const colorClasses = {
        blue: 'bg-blue-50 text-blue-600',
        green: 'bg-green-50 text-green-600',
        red: 'bg-red-50 text-red-600',
        amber: 'bg-amber-50 text-amber-600',
    };

    return (
        <div className="bg-white rounded-xl p-4 shadow-sm">
            <div className="flex items-center gap-3">
                <div className={`p-2 rounded-lg ${colorClasses[color]}`}>
                    {icon}
                </div>
                <div className="flex-1">
                    <p className="text-xs text-gray-500 font-medium">{label}</p>
                    <p className="text-lg font-bold text-gray-900">{value}</p>
                    {subValue && (
                        <p className="text-xs text-gray-500">{subValue}</p>
                    )}
                </div>
            </div>
        </div>
    );
}

interface UnitCardProps {
    label: string;
    value: string;
    subValue?: string;
    highlight?: boolean;
}

function UnitCard({ label, value, subValue, highlight }: UnitCardProps) {
    return (
        <div className={`bg-white rounded-xl p-4 shadow-sm ${highlight ? 'ring-2 ring-primary-200' : ''}`}>
            <p className="text-xs text-gray-500 font-medium">{label}</p>
            <p className={`text-lg font-semibold ${highlight ? 'text-primary-600' : 'text-gray-900'}`}>{value}</p>
            {subValue && (
                <p className="text-xs text-gray-400">{subValue}</p>
            )}
        </div>
    );
}
