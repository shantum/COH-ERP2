/**
 * Returns Dashboard — Return Prime-style UI
 *
 * Status pill tabs filter by returnStatus.
 * Date presets for quick filtering.
 * Clean table with product images.
 * Secondary view switcher for analytics/settings.
 */

import { useState, useCallback, useMemo } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useServerFn } from '@tanstack/react-start';
import { useNavigate } from '@tanstack/react-router';
import { Route } from '../../routes/_authenticated/returns';
import {
    Search,
    ChevronLeft,
    ChevronRight,
    BarChart3,
    Settings,
    Package,
    X,
    Plus,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { toast } from 'sonner';

// Server functions
import {
    getAllReturns,
    getReturnStatusCounts,
    getReturnConfig,
} from '../../server/functions/returns';
import {
    processLineReturnRefund,
} from '../../server/functions/returnResolution';

// Tab components
import { AnalyticsTab } from './tabs/AnalyticsTab';
import { SettingsTab } from './tabs/SettingsTab';
import { ProcessRefundModal } from './modals/ProcessRefundModal';

import { getOptimizedImageUrl } from '../../utils/imageOptimization';
import { getStatusBadge } from './types';
import type { ActiveReturnLine } from '@coh/shared/schemas/returns';
import type { ReturnActionQueueItem as ServerReturnActionQueueItem } from '@coh/shared/schemas/returns';

// ============================================
// CONSTANTS
// ============================================

const STATUS_TABS = [
    { value: 'requested', label: 'Requested' },
    { value: 'approved', label: 'Approved' },
    { value: 'inspected', label: 'Inspected' },
    { value: 'refunded', label: 'Refunded' },
    { value: 'archived', label: 'Archived' },
    { value: 'rejected', label: 'Rejected' },
    { value: 'all', label: 'All' },
] as const;

const DATE_PRESETS = [
    { value: 'custom', label: 'Custom' },
    { value: 'today', label: 'Today' },
    { value: 'yesterday', label: 'Yesterday' },
    { value: '7d', label: 'Last 7 days' },
    { value: '30d', label: 'Last 30 days' },
] as const;

const PAGE_SIZE = 50;

// ============================================
// HELPERS
// ============================================

function formatDateForApi(date: Date): string {
    return date.toISOString().split('T')[0];
}

function getDateRange(preset: string): { dateFrom?: string; dateTo?: string } {
    const today = new Date();
    const dateTo = formatDateForApi(today);

    switch (preset) {
        case 'today':
            return { dateFrom: dateTo, dateTo };
        case 'yesterday': {
            const yesterday = new Date(today);
            yesterday.setDate(yesterday.getDate() - 1);
            const d = formatDateForApi(yesterday);
            return { dateFrom: d, dateTo: d };
        }
        case '7d': {
            const from = new Date(today);
            from.setDate(from.getDate() - 7);
            return { dateFrom: formatDateForApi(from), dateTo };
        }
        case '30d': {
            const from = new Date(today);
            from.setDate(from.getDate() - 30);
            return { dateFrom: formatDateForApi(from), dateTo };
        }
        default:
            return {};
    }
}

function formatDisplayDate(date: Date | string | null): string {
    if (!date) return '-';
    const d = new Date(date);
    return d.toLocaleDateString('en-US', {
        year: 'numeric',
        month: 'long',
        day: 'numeric',
    });
}

// ============================================
// MAIN COMPONENT
// ============================================

export default function Returns() {
    const search = Route.useSearch();
    const navigate = useNavigate({ from: Route.fullPath });
    const queryClient = useQueryClient();
    const invalidateReturns = useCallback(
        () => queryClient.invalidateQueries({ queryKey: ['returns'] }),
        [queryClient]
    );

    // Local state
    const [searchInput, setSearchInput] = useState(search.search || '');
    const [refundModalItem, setRefundModalItem] = useState<ServerReturnActionQueueItem | null>(null);

    // Computed date range
    const dateRange = useMemo(() => getDateRange(search.datePreset), [search.datePreset]);

    // ============================================
    // QUERIES
    // ============================================

    // Status counts for pill badges
    const getStatusCountsFn = useServerFn(getReturnStatusCounts);
    const { data: statusCounts } = useQuery({
        queryKey: ['returns', 'statusCounts', { ...dateRange, search: search.search }],
        queryFn: () =>
            getStatusCountsFn({
                data: {
                    ...dateRange,
                    ...(search.search ? { search: search.search } : {}),
                },
            }),
        staleTime: 30_000,
        enabled: search.view === 'returns',
    });

    // Returns table data
    const getAllReturnsFn = useServerFn(getAllReturns);
    const { data: returnsData, isLoading: returnsLoading } = useQuery({
        queryKey: [
            'returns',
            'all',
            {
                page: search.page,
                status: search.status,
                search: search.search,
                ...dateRange,
            },
        ],
        queryFn: () =>
            getAllReturnsFn({
                data: {
                    page: search.page,
                    limit: PAGE_SIZE,
                    ...(search.status !== 'all' ? { status: search.status } : {}),
                    ...(search.search ? { search: search.search } : {}),
                    ...dateRange,
                },
            }),
        staleTime: 30_000,
        enabled: search.view === 'returns',
    });

    // Settings config (only when settings view is active)
    const getConfigFn = useServerFn(getReturnConfig);
    const {
        data: returnConfig,
        isLoading: configLoading,
        refetch: refetchConfig,
    } = useQuery({
        queryKey: ['returns', 'config'],
        queryFn: () => getConfigFn(),
        staleTime: 5 * 60 * 1000,
        enabled: search.view === 'settings',
    });

    // ============================================
    // MUTATIONS
    // ============================================

    const processRefundFn = useServerFn(processLineReturnRefund);
    const processRefundMutation = useMutation({
        mutationFn: (params: {
            orderLineId: string;
            grossAmount: number;
            discountClawback: number;
            deductions: number;
            deductionNotes?: string;
            refundMethod?: 'payment_link' | 'bank_transfer' | 'store_credit';
        }) => processRefundFn({ data: params }),
        onSuccess: () => {
            toast.success('Refund processed');
            setRefundModalItem(null);
            invalidateReturns();
        },
        onError: (err: unknown) =>
            toast.error(err instanceof Error ? err.message : 'Failed to process refund'),
    });

    // ============================================
    // HANDLERS
    // ============================================

    const handleStatusChange = useCallback(
        (status: string) => {
            navigate({
                search: (prev) => ({
                    ...prev,
                    status: status as typeof search.status,
                    page: 1,
                }),
            });
        },
        [navigate]
    );

    const handleViewChange = useCallback(
        (view: string) => {
            navigate({
                search: (prev) => ({
                    ...prev,
                    view: view as typeof search.view,
                }),
            });
        },
        [navigate]
    );

    const handleDatePresetChange = useCallback(
        (preset: string) => {
            navigate({
                search: (prev) => ({
                    ...prev,
                    datePreset: preset as typeof search.datePreset,
                    page: 1,
                }),
            });
        },
        [navigate]
    );

    const handleSearch = useCallback(() => {
        navigate({
            search: (prev) => ({
                ...prev,
                search: searchInput || undefined,
                page: 1,
            }),
        });
    }, [navigate, searchInput]);

    const handleSearchKeyDown = useCallback(
        (e: React.KeyboardEvent) => {
            if (e.key === 'Enter') handleSearch();
        },
        [handleSearch]
    );

    const handleClearFilters = useCallback(() => {
        setSearchInput('');
        navigate({
            search: (prev) => ({
                ...prev,
                search: undefined,
                datePreset: '7d' as const,
                requestType: 'all' as const,
                page: 1,
            }),
        });
    }, [navigate]);

    const handlePageChange = useCallback(
        (newPage: number) => {
            navigate({
                search: (prev) => ({ ...prev, page: newPage }),
            });
        },
        [navigate]
    );

    const handleRefundSubmit = useCallback(
        (
            lineId: string,
            grossAmount: number,
            discountClawback: number,
            deductions: number,
            deductionNotes?: string,
            refundMethod?: 'payment_link' | 'bank_transfer' | 'store_credit'
        ) => {
            processRefundMutation.mutate({
                orderLineId: lineId,
                grossAmount,
                discountClawback,
                deductions,
                deductionNotes,
                refundMethod,
            });
        },
        [processRefundMutation]
    );

    const totalPages = returnsData
        ? Math.ceil(returnsData.total / returnsData.limit)
        : 0;
    const items = returnsData?.items || [];

    // ============================================
    // RENDER
    // ============================================

    return (
        <div className="min-h-screen bg-gray-50">
            <div className="max-w-7xl mx-auto px-4 sm:px-6 py-6 space-y-5">
                {/* Header */}
                <div className="flex items-center justify-between">
                    <div className="flex items-center gap-4">
                        <h1 className="text-2xl font-bold text-gray-900">Returns</h1>
                        <a
                            href="/orders"
                            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium text-emerald-700 bg-emerald-50 border border-emerald-200 rounded-lg hover:bg-emerald-100 transition-colors"
                        >
                            <Plus size={14} />
                            Create new request
                        </a>
                    </div>
                    {/* View switcher as small text links */}
                    <div className="flex items-center gap-4">
                        <div className="flex items-center gap-1 text-sm">
                            <button
                                onClick={() => handleViewChange('returns')}
                                className={`px-3 py-1.5 rounded-md font-medium transition-colors ${
                                    search.view === 'returns'
                                        ? 'bg-gray-900 text-white'
                                        : 'text-gray-500 hover:text-gray-700 hover:bg-gray-100'
                                }`}
                            >
                                Returns
                            </button>
                            <button
                                onClick={() => handleViewChange('analytics')}
                                className={`px-3 py-1.5 rounded-md font-medium transition-colors flex items-center gap-1.5 ${
                                    search.view === 'analytics'
                                        ? 'bg-gray-900 text-white'
                                        : 'text-gray-500 hover:text-gray-700 hover:bg-gray-100'
                                }`}
                            >
                                <BarChart3 size={14} />
                                Analytics
                            </button>
                            <button
                                onClick={() => handleViewChange('settings')}
                                className={`px-3 py-1.5 rounded-md font-medium transition-colors flex items-center gap-1.5 ${
                                    search.view === 'settings'
                                        ? 'bg-gray-900 text-white'
                                        : 'text-gray-500 hover:text-gray-700 hover:bg-gray-100'
                                }`}
                            >
                                <Settings size={14} />
                                Settings
                            </button>
                        </div>
                    </div>
                </div>

                {search.view === 'returns' && (
                    <>
                        {/* Status Pill Tabs */}
                        <div className="flex items-center gap-2 overflow-x-auto pb-1 scrollbar-hide" role="tablist">
                            {STATUS_TABS.map(({ value, label }) => {
                                const count = statusCounts?.[value] ?? 0;
                                const isActive = search.status === value;
                                return (
                                    <button
                                        key={value}
                                        role="tab"
                                        aria-selected={isActive}
                                        onClick={() => handleStatusChange(value)}
                                        className={`relative px-4 py-2 text-sm font-medium rounded-full whitespace-nowrap transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500 focus-visible:ring-offset-1 ${
                                            isActive
                                                ? 'bg-emerald-600 text-white shadow-sm'
                                                : 'bg-white text-gray-600 border border-gray-200 hover:bg-gray-50 hover:border-gray-300'
                                        }`}
                                    >
                                        {label}
                                        {count > 0 && (
                                            <span
                                                className={`ml-2 inline-flex items-center justify-center min-w-[20px] h-5 px-1.5 text-xs font-semibold rounded-full ${
                                                    isActive
                                                        ? 'bg-white/20 text-white'
                                                        : 'bg-gray-100 text-gray-600'
                                                }`}
                                            >
                                                {count}
                                            </span>
                                        )}
                                    </button>
                                );
                            })}
                        </div>

                        {/* Date Filter Row */}
                        <div className="flex items-center gap-3 flex-wrap">
                            <div className="flex items-center gap-1">
                                {DATE_PRESETS.map(({ value, label }) => (
                                    <button
                                        key={value}
                                        onClick={() => handleDatePresetChange(value)}
                                        className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gray-400 focus-visible:ring-offset-1 ${
                                            search.datePreset === value
                                                ? 'bg-gray-900 text-white'
                                                : 'bg-white text-gray-500 border border-gray-200 hover:bg-gray-50'
                                        }`}
                                    >
                                        {label}
                                    </button>
                                ))}
                            </div>
                            <div className="h-4 w-px bg-gray-200" />
                            <button
                                onClick={handleClearFilters}
                                className="text-xs text-gray-400 hover:text-red-500 transition-colors"
                            >
                                Remove all filters
                            </button>
                        </div>

                        {/* Search Bar */}
                        <div className="flex gap-2">
                            <div className="relative flex-1 max-w-md">
                                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
                                <input
                                    type="text"
                                    placeholder="Search by order, customer, SKU, batch number..."
                                    value={searchInput}
                                    onChange={(e) => setSearchInput(e.target.value)}
                                    onKeyDown={handleSearchKeyDown}
                                    className="w-full pl-10 pr-4 py-2 text-sm border border-gray-200 rounded-lg bg-white focus:outline-none focus:ring-2 focus:ring-emerald-500/30 focus:border-emerald-400"
                                />
                                {searchInput && (
                                    <button
                                        onClick={() => {
                                            setSearchInput('');
                                            navigate({
                                                search: (prev) => ({
                                                    ...prev,
                                                    search: undefined,
                                                    page: 1,
                                                }),
                                            });
                                        }}
                                        className="absolute right-3 top-1/2 -translate-y-1/2"
                                    >
                                        <X size={14} className="text-gray-400 hover:text-gray-600" />
                                    </button>
                                )}
                            </div>
                            <Button
                                onClick={handleSearch}
                                size="sm"
                                className="bg-emerald-600 hover:bg-emerald-700 text-white"
                            >
                                Search
                            </Button>
                        </div>

                        {/* Returns Table */}
                        <div className="bg-white rounded-lg border border-gray-200 overflow-hidden">
                            <table className="w-full text-sm">
                                <thead className="bg-gray-50 border-b border-gray-200">
                                    <tr className="text-xs text-gray-500 font-medium uppercase tracking-wider">
                                        <th className="text-left px-4 py-3">Request</th>
                                        <th className="text-left px-4 py-3">Product</th>
                                        <th className="text-left px-4 py-3">Order</th>
                                        <th className="text-left px-4 py-3">Customer</th>
                                        <th className="text-left px-4 py-3">Status</th>
                                        <th className="text-left px-4 py-3">Date</th>
                                    </tr>
                                </thead>
                                <tbody className="divide-y divide-gray-100">
                                    {returnsLoading ? (
                                        <tr>
                                            <td
                                                colSpan={6}
                                                className="text-center py-16 text-gray-400"
                                            >
                                                <div className="flex flex-col items-center gap-2">
                                                    <div className="w-6 h-6 border-2 border-emerald-500 border-t-transparent rounded-full animate-spin" />
                                                    <span>Loading returns...</span>
                                                </div>
                                            </td>
                                        </tr>
                                    ) : items.length === 0 ? (
                                        <tr>
                                            <td
                                                colSpan={6}
                                                className="text-center py-16 text-gray-400"
                                            >
                                                <Package
                                                    size={40}
                                                    className="mx-auto mb-3 text-gray-300"
                                                />
                                                <p className="text-sm font-medium">
                                                    No returns found
                                                </p>
                                                <p className="text-xs mt-1">
                                                    Try adjusting your filters or date range.
                                                </p>
                                            </td>
                                        </tr>
                                    ) : (
                                        items.map((row) => (
                                            <ReturnRow key={row.id} row={row} />
                                        ))
                                    )}
                                </tbody>
                            </table>
                        </div>

                        {/* Pagination */}
                        {returnsData && returnsData.total > 0 && (
                            <div className="flex items-center justify-between px-1">
                                <div className="text-sm text-gray-500">
                                    Showing{' '}
                                    {(search.page - 1) * PAGE_SIZE + 1}
                                    &ndash;
                                    {Math.min(
                                        search.page * PAGE_SIZE,
                                        returnsData.total
                                    )}{' '}
                                    of {returnsData.total.toLocaleString()}{' '}
                                    returns
                                </div>
                                <div className="flex items-center gap-2">
                                    <button
                                        onClick={() =>
                                            handlePageChange(
                                                Math.max(1, search.page - 1)
                                            )
                                        }
                                        disabled={search.page <= 1}
                                        className="p-1.5 rounded border border-gray-300 hover:bg-gray-50 disabled:opacity-40 disabled:cursor-not-allowed transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500"
                                    >
                                        <ChevronLeft size={16} />
                                    </button>
                                    <span className="text-xs text-gray-500">
                                        Page {search.page} of{' '}
                                        {totalPages || 1}
                                    </span>
                                    <button
                                        onClick={() =>
                                            handlePageChange(
                                                Math.min(
                                                    totalPages,
                                                    search.page + 1
                                                )
                                            )
                                        }
                                        disabled={search.page >= totalPages}
                                        className="p-1.5 rounded border border-gray-300 hover:bg-gray-50 disabled:opacity-40 disabled:cursor-not-allowed transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500"
                                    >
                                        <ChevronRight size={16} />
                                    </button>
                                </div>
                            </div>
                        )}
                    </>
                )}

                {search.view === 'analytics' && (
                    <AnalyticsTab period={
                        search.datePreset === '7d' || search.datePreset === '30d'
                            ? search.datePreset
                            : '30d'
                    } />
                )}

                {search.view === 'settings' && (
                    <SettingsTab
                        config={returnConfig}
                        loading={configLoading}
                        onRefresh={() => refetchConfig()}
                    />
                )}

                {/* Refund Modal */}
                {refundModalItem && (
                    <ProcessRefundModal
                        item={refundModalItem}
                        config={returnConfig}
                        onSubmit={handleRefundSubmit}
                        onClose={() => setRefundModalItem(null)}
                    />
                )}
            </div>
        </div>
    );
}

// ============================================
// TABLE ROW
// ============================================

function ReturnRow({ row }: { row: ActiveReturnLine }) {
    const requestId = row.returnPrimeRequestNumber
        ? `#${row.returnPrimeRequestNumber}`
        : row.returnBatchNumber
        ? `#${row.returnBatchNumber}`
        : `#${row.id.slice(0, 6)}`;

    const isFromRP = !!row.returnPrimeRequestId;

    return (
        <tr className="hover:bg-gray-50/60 transition-colors">
            {/* Request */}
            <td className="px-4 py-3">
                <div className="flex items-center gap-2">
                    <a
                        href={`/returns/${row.id}`}
                        className="text-emerald-600 hover:text-emerald-700 font-semibold text-sm hover:underline"
                    >
                        {requestId}
                    </a>
                    {isFromRP && (
                        <span className="inline-flex px-1.5 py-0.5 text-[10px] font-medium rounded bg-violet-100 text-violet-700" title="Created via Return Prime">
                            RP
                        </span>
                    )}
                </div>
            </td>

            {/* Product */}
            <td className="px-4 py-3">
                <div className="flex items-center gap-3">
                    <div className="w-10 h-10 rounded-lg bg-gray-100 flex-shrink-0 overflow-hidden ring-1 ring-gray-200/60">
                        {row.imageUrl ? (
                            <img
                                src={
                                    getOptimizedImageUrl(row.imageUrl, 'sm') ||
                                    row.imageUrl
                                }
                                alt={row.productName || ''}
                                className="w-full h-full object-cover"
                                loading="lazy"
                            />
                        ) : (
                            <div className="w-full h-full flex items-center justify-center">
                                <Package
                                    size={16}
                                    className="text-gray-300"
                                />
                            </div>
                        )}
                    </div>
                    <div className="min-w-0">
                        <div className="text-sm font-medium text-gray-900 truncate max-w-[220px]">
                            {row.productName}
                        </div>
                        <div className="text-xs text-gray-500">
                            {row.colorName} / {row.size}
                            {row.returnQty > 1 && (
                                <span className="ml-1 text-gray-400">
                                    x{row.returnQty}
                                </span>
                            )}
                        </div>
                    </div>
                </div>
            </td>

            {/* Order */}
            <td className="px-4 py-3">
                <a
                    href={`/orders/${row.orderNumber}`}
                    className="text-sm text-blue-600 hover:underline font-medium"
                >
                    #{row.orderNumber}
                </a>
            </td>

            {/* Customer */}
            <td className="px-4 py-3 text-sm text-gray-600">
                {row.customerEmail || row.customerName || '-'}
            </td>

            {/* Status */}
            <td className="px-4 py-3">
                <span
                    className={`inline-flex px-2.5 py-0.5 text-xs font-semibold rounded-full ${getStatusBadge(row.returnStatus)}`}
                >
                    {row.returnStatus.replace(/_/g, ' ')}
                </span>
            </td>

            {/* Date */}
            <td className="px-4 py-3 text-sm text-gray-500 whitespace-nowrap">
                {formatDisplayDate(row.returnRequestedAt)}
            </td>
        </tr>
    );
}
