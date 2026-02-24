/**
 * Unified Returns Dashboard
 *
 * Merges Returns Management + Return Prime into a single page.
 * Return Prime handles all operations; the ERP mirrors data for analytics.
 *
 * 3 tabs: Overview | All Returns | Analytics
 */

import { useState, useCallback } from 'react';
import { useQuery, useMutation } from '@tanstack/react-query';
import { useServerFn } from '@tanstack/react-start';
import { useNavigate } from '@tanstack/react-router';
import { Route } from '../../routes/_authenticated/returns';
import {
    Search,
    Calendar,
    Filter,
    RefreshCw,
    AlertCircle,
    Download,
    Upload,
    BarChart3,
    Package,
    LayoutDashboard,
    Clock,
    Database,
    LinkIcon,
    TrendingUp,
    Timer,
    Tag,
    CheckCircle2,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from '@/components/ui/select';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Badge } from '@/components/ui/badge';
import { toast } from 'sonner';
import {
    getReturnPrimeDashboard,
    getReturnPrimeSyncStatus,
    triggerReturnPrimeSync,
    autoCompleteReceivedReturns,
} from '../../server/functions/returnPrime';
import { returnPrimeQueryKeys } from '../../constants/queryKeys';
import {
    ReturnPrimeStatsCards,
    ReturnPrimeTable,
    ReturnPrimeDetailModal,
    ReturnPrimeAnalytics,
    ReturnPrimeCsvEnrichmentDialog,
} from '../../components/returnPrime';
import type { ReturnPrimeRequest, ReturnPrimeStats } from '@coh/shared/schemas/returnPrime';

// ============================================
// CONSTANTS
// ============================================

const DATE_PRESETS = [
    { value: '7d', label: 'Last 7 days' },
    { value: '30d', label: 'Last 30 days' },
    { value: '90d', label: 'Last 90 days' },
    { value: '1y', label: 'Last 1 year' },
    { value: 'all', label: 'All time' },
] as const;

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
        case '90d': {
            const from = new Date(today);
            from.setDate(from.getDate() - 90);
            return { dateFrom: formatDateForApi(from), dateTo };
        }
        case '1y': {
            const from = new Date(today);
            from.setFullYear(from.getFullYear() - 1);
            return { dateFrom: formatDateForApi(from), dateTo };
        }
        default:
            return {};
    }
}

function formatRelativeTime(isoString: string | null): string {
    if (!isoString) return 'Never';
    const date = new Date(isoString);
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffMins = Math.floor(diffMs / 60000);
    if (diffMins < 1) return 'Just now';
    if (diffMins < 60) return `${diffMins}m ago`;
    const diffHours = Math.floor(diffMins / 60);
    if (diffHours < 24) return `${diffHours}h ago`;
    const diffDays = Math.floor(diffHours / 24);
    return `${diffDays}d ago`;
}

// ============================================
// OVERVIEW TAB
// ============================================

function OverviewTab({
    stats,
    syncStatus,
    isLoading,
    isSyncLoading,
}: {
    stats: ReturnPrimeStats | undefined;
    syncStatus: SyncStatus | undefined;
    isLoading: boolean;
    isSyncLoading: boolean;
}) {
    return (
        <div className="space-y-6">
            {/* Stats Cards */}
            <ReturnPrimeStatsCards stats={stats} isLoading={isLoading} />

            {/* Sync Health Bar */}
            <div className="bg-white rounded-lg border border-gray-200 p-4">
                <h3 className="text-sm font-semibold text-gray-700 mb-3 flex items-center gap-2">
                    <Database className="w-4 h-4" />
                    Sync Health
                </h3>
                {isSyncLoading ? (
                    <div className="flex gap-4">
                        {[1, 2, 3].map((i) => (
                            <div key={i} className="h-16 bg-gray-100 rounded-lg animate-pulse flex-1" />
                        ))}
                    </div>
                ) : syncStatus ? (
                    <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                        <div className="flex items-center gap-3 p-3 bg-gray-50 rounded-lg">
                            <Clock className="w-5 h-5 text-blue-500 shrink-0" />
                            <div>
                                <p className="text-xs text-gray-500">Last Sync</p>
                                <p className="text-sm font-medium">
                                    {formatRelativeTime(syncStatus.lastSyncedAt)}
                                </p>
                            </div>
                        </div>
                        <div className="flex items-center gap-3 p-3 bg-gray-50 rounded-lg">
                            <Database className="w-5 h-5 text-green-500 shrink-0" />
                            <div>
                                <p className="text-xs text-gray-500">Total Records</p>
                                <p className="text-sm font-medium">
                                    {syncStatus.totalRecords.toLocaleString()}
                                </p>
                            </div>
                        </div>
                        <div className="flex items-center gap-3 p-3 bg-gray-50 rounded-lg">
                            <LinkIcon className="w-5 h-5 text-amber-500 shrink-0" />
                            <div>
                                <p className="text-xs text-gray-500">Date Range</p>
                                <p className="text-sm font-medium">
                                    {syncStatus.oldestRecord
                                        ? new Date(syncStatus.oldestRecord).toLocaleDateString()
                                        : 'N/A'}
                                    {' - '}
                                    {syncStatus.newestRecord
                                        ? new Date(syncStatus.newestRecord).toLocaleDateString()
                                        : 'N/A'}
                                </p>
                            </div>
                        </div>
                    </div>
                ) : (
                    <p className="text-sm text-gray-500">No sync data available</p>
                )}
            </div>

            {/* Quick Stats */}
            {stats && (
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                    <div className="bg-white rounded-lg border border-gray-200 p-4">
                        <div className="flex items-center gap-2 mb-2">
                            <TrendingUp className="w-4 h-4 text-blue-500" />
                            <h4 className="text-sm font-medium text-gray-600">Return Rate</h4>
                        </div>
                        <p className="text-2xl font-bold text-gray-900">
                            {stats.total > 0
                                ? `${((stats.returns / stats.total) * 100).toFixed(1)}%`
                                : '0%'}
                        </p>
                        <p className="text-xs text-gray-500 mt-1">Returns vs total requests</p>
                    </div>
                    <div className="bg-white rounded-lg border border-gray-200 p-4">
                        <div className="flex items-center gap-2 mb-2">
                            <Timer className="w-4 h-4 text-purple-500" />
                            <h4 className="text-sm font-medium text-gray-600">Active Requests</h4>
                        </div>
                        <p className="text-2xl font-bold text-gray-900">
                            {stats.pending + stats.approved}
                        </p>
                        <p className="text-xs text-gray-500 mt-1">Pending + approved</p>
                    </div>
                    <div className="bg-white rounded-lg border border-gray-200 p-4">
                        <div className="flex items-center gap-2 mb-2">
                            <Tag className="w-4 h-4 text-orange-500" />
                            <h4 className="text-sm font-medium text-gray-600">Exchanges</h4>
                        </div>
                        <p className="text-2xl font-bold text-gray-900">
                            {stats.exchanges}
                        </p>
                        <p className="text-xs text-gray-500 mt-1">
                            {stats.total > 0
                                ? `${((stats.exchanges / stats.total) * 100).toFixed(0)}% of total`
                                : 'No data'}
                        </p>
                    </div>
                </div>
            )}
        </div>
    );
}

// ============================================
// TYPES
// ============================================

type SyncStatus = {
    totalRecords: number;
    lastSyncedAt: string | null;
    oldestRecord: string | null;
    newestRecord: string | null;
};

// ============================================
// MAIN COMPONENT
// ============================================

export default function Returns() {
    const search = Route.useSearch();
    const navigate = useNavigate({ from: Route.fullPath });

    // Local state
    const [searchInput, setSearchInput] = useState(search.search || '');
    const [selectedRequest, setSelectedRequest] = useState<ReturnPrimeRequest | null>(null);
    const [csvDialogOpen, setCsvDialogOpen] = useState(false);

    // Compute API filters from URL search params
    const dateRange = getDateRange(search.datePreset);
    const filters = {
        ...dateRange,
        ...(search.requestType !== 'all' ? { requestType: search.requestType } : {}),
        ...(search.search ? { search: search.search } : {}),
    };

    // ============================================
    // QUERIES
    // ============================================

    const { data, isLoading, error, refetch } = useQuery({
        queryKey: returnPrimeQueryKeys.dashboard(filters),
        queryFn: () => getReturnPrimeDashboard({ data: filters }),
        staleTime: 60 * 1000,
        retry: 2,
    });

    const getSyncStatusFn = useServerFn(getReturnPrimeSyncStatus);
    const { data: syncStatus, isLoading: isSyncLoading } = useQuery({
        queryKey: ['returnPrime', 'syncStatus'],
        queryFn: () => getSyncStatusFn(),
        staleTime: 30 * 1000,
        enabled: search.tab === 'overview',
    });

    // ============================================
    // MUTATIONS
    // ============================================

    const triggerSyncFn = useServerFn(triggerReturnPrimeSync);
    const syncMutation = useMutation({
        mutationFn: () => triggerSyncFn(),
        onSuccess: (res) => {
            if (res.success) {
                toast.success(res.message);
                refetch();
            } else {
                toast.error(res.message);
            }
        },
        onError: () => toast.error('Sync failed'),
    });

    const autoCompleteFn = useServerFn(autoCompleteReceivedReturns);
    const autoCompleteMutation = useMutation({
        mutationFn: (dryRun: boolean) => autoCompleteFn({ data: { dryRun } }),
        onSuccess: (res) => {
            if (res.dryRun) {
                if (res.totalUpdated === 0) {
                    toast.info('All return statuses are already in sync');
                } else {
                    toast.info(`Preview: ${res.message}. Run again to apply.`);
                    // Auto-run the real update
                    autoCompleteMutation.mutate(false);
                }
            } else {
                toast.success(res.message);
                refetch();
            }
        },
        onError: () => toast.error('Auto-complete failed'),
    });

    // ============================================
    // HANDLERS
    // ============================================

    const handleSearch = useCallback(() => {
        navigate({
            search: (prev) => ({ ...prev, search: searchInput || undefined }),
        });
    }, [navigate, searchInput]);

    const handleSearchKeyDown = useCallback(
        (e: React.KeyboardEvent) => {
            if (e.key === 'Enter') handleSearch();
        },
        [handleSearch]
    );

    const handleTypeChange = useCallback(
        (value: string) => {
            navigate({
                search: (prev) => ({
                    ...prev,
                    requestType: value as 'all' | 'return' | 'exchange',
                }),
            });
        },
        [navigate]
    );

    const handleDatePresetChange = useCallback(
        (value: string) => {
            navigate({
                search: (prev) => ({
                    ...prev,
                    datePreset: value as '7d' | '30d' | '90d' | '1y' | 'all',
                }),
            });
        },
        [navigate]
    );

    const handleTabChange = useCallback(
        (value: string) => {
            navigate({
                search: (prev) => ({
                    ...prev,
                    tab: value as 'overview' | 'returns' | 'analytics',
                }),
            });
        },
        [navigate]
    );

    // ============================================
    // ERROR STATE
    // ============================================

    if (error) {
        return (
            <div className="p-6">
                <div className="bg-red-50 border border-red-200 rounded-lg p-6 text-center">
                    <AlertCircle className="w-12 h-12 text-red-400 mx-auto mb-3" />
                    <h3 className="text-lg font-semibold text-red-800 mb-2">
                        Failed to load returns data
                    </h3>
                    <p className="text-red-600 mb-4">
                        {error instanceof Error ? error.message : 'Unknown error occurred'}
                    </p>
                    <Button onClick={() => refetch()} variant="outline">
                        <RefreshCw className="w-4 h-4 mr-2" />
                        Try again
                    </Button>
                </div>
            </div>
        );
    }

    // ============================================
    // RENDER
    // ============================================

    return (
        <div className="space-y-4 sm:space-y-6 px-2 sm:px-4 md:px-6 py-4">
            {/* Header */}
            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
                <div>
                    <h1 className="text-xl sm:text-2xl font-bold text-gray-900">Returns</h1>
                    <p className="text-sm text-gray-500 mt-1">
                        Customer returns and exchanges synced from Return Prime
                    </p>
                </div>
                <div className="flex flex-wrap gap-2">
                    <Button
                        variant="outline"
                        size="sm"
                        onClick={() => autoCompleteMutation.mutate(true)}
                        disabled={autoCompleteMutation.isPending}
                    >
                        <CheckCircle2 className={`w-4 h-4 mr-2 ${autoCompleteMutation.isPending ? 'animate-pulse' : ''}`} />
                        <span className="hidden sm:inline">Sync Statuses</span>
                        <span className="sm:hidden">Sync</span>
                    </Button>
                    <Button
                        variant="outline"
                        size="sm"
                        onClick={() => setCsvDialogOpen(true)}
                    >
                        <Upload className="w-4 h-4 mr-2" />
                        <span className="hidden sm:inline">Upload CSV</span>
                        <span className="sm:hidden">CSV</span>
                    </Button>
                    <Button
                        variant="outline"
                        size="sm"
                        onClick={() => syncMutation.mutate()}
                        disabled={syncMutation.isPending}
                    >
                        <Download className={`w-4 h-4 mr-2 ${syncMutation.isPending ? 'animate-pulse' : ''}`} />
                        {syncMutation.isPending ? 'Syncing...' : 'Sync from RP'}
                    </Button>
                    <Button
                        variant="outline"
                        size="sm"
                        onClick={() => refetch()}
                        disabled={isLoading}
                    >
                        <RefreshCw className={`w-4 h-4 ${isLoading ? 'animate-spin' : ''}`} />
                    </Button>
                </div>
            </div>

            {/* Tabs */}
            <Tabs value={search.tab} onValueChange={handleTabChange}>
                <TabsList>
                    <TabsTrigger value="overview" className="flex items-center gap-1.5">
                        <LayoutDashboard className="w-4 h-4" />
                        Overview
                    </TabsTrigger>
                    <TabsTrigger value="returns" className="flex items-center gap-1.5">
                        <Package className="w-4 h-4" />
                        All Returns
                        {data?.stats?.total ? (
                            <Badge variant="secondary" className="ml-1 text-xs">
                                {data.stats.total}
                            </Badge>
                        ) : null}
                    </TabsTrigger>
                    <TabsTrigger value="analytics" className="flex items-center gap-1.5">
                        <BarChart3 className="w-4 h-4" />
                        Analytics
                    </TabsTrigger>
                </TabsList>

                {/* Overview Tab */}
                <TabsContent value="overview" className="mt-4">
                    <OverviewTab
                        stats={data?.stats}
                        syncStatus={syncStatus}
                        isLoading={isLoading}
                        isSyncLoading={isSyncLoading}
                    />
                </TabsContent>

                {/* All Returns Tab */}
                <TabsContent value="returns" className="mt-4 space-y-4">
                    {/* Filters Bar */}
                    <div className="flex flex-col sm:flex-row gap-3 p-4 bg-white rounded-lg border border-gray-200">
                        {/* Search */}
                        <div className="flex-1 flex gap-2">
                            <div className="relative flex-1">
                                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
                                <Input
                                    type="text"
                                    placeholder="Search by order, email, phone, RET/EXC number..."
                                    value={searchInput}
                                    onChange={(e) => setSearchInput(e.target.value)}
                                    onKeyDown={handleSearchKeyDown}
                                    className="pl-10"
                                />
                            </div>
                            <Button onClick={handleSearch} variant="secondary">
                                Search
                            </Button>
                        </div>

                        {/* Type Filter */}
                        <Select value={search.requestType} onValueChange={handleTypeChange}>
                            <SelectTrigger className="w-[140px]">
                                <Filter className="w-4 h-4 mr-2" />
                                <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                                <SelectItem value="all">All Types</SelectItem>
                                <SelectItem value="return">Returns</SelectItem>
                                <SelectItem value="exchange">Exchanges</SelectItem>
                            </SelectContent>
                        </Select>

                        {/* Date Range */}
                        <Select value={search.datePreset} onValueChange={handleDatePresetChange}>
                            <SelectTrigger className="w-[150px]">
                                <Calendar className="w-4 h-4 mr-2" />
                                <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                                {DATE_PRESETS.map(({ value, label }) => (
                                    <SelectItem key={value} value={value}>
                                        {label}
                                    </SelectItem>
                                ))}
                            </SelectContent>
                        </Select>
                    </div>

                    {/* Table */}
                    <ReturnPrimeTable
                        requests={data?.requests || []}
                        isLoading={isLoading}
                        onRowClick={setSelectedRequest}
                    />
                </TabsContent>

                {/* Analytics Tab */}
                <TabsContent value="analytics" className="mt-4 space-y-4">
                    {/* Date filter for analytics */}
                    <div className="flex items-center gap-3 p-4 bg-white rounded-lg border border-gray-200">
                        <span className="text-sm text-gray-600 font-medium">Period:</span>
                        <Select value={search.datePreset} onValueChange={handleDatePresetChange}>
                            <SelectTrigger className="w-[150px]">
                                <Calendar className="w-4 h-4 mr-2" />
                                <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                                {DATE_PRESETS.map(({ value, label }) => (
                                    <SelectItem key={value} value={value}>
                                        {label}
                                    </SelectItem>
                                ))}
                            </SelectContent>
                        </Select>
                    </div>

                    <ReturnPrimeAnalytics
                        requests={data?.requests || []}
                        isLoading={isLoading}
                    />
                </TabsContent>
            </Tabs>

            {/* Detail Modal */}
            <ReturnPrimeDetailModal
                request={selectedRequest}
                open={!!selectedRequest}
                onOpenChange={(open) => {
                    if (!open) setSelectedRequest(null);
                }}
            />

            {/* CSV Enrichment Dialog */}
            <ReturnPrimeCsvEnrichmentDialog
                open={csvDialogOpen}
                onOpenChange={setCsvDialogOpen}
                onImported={() => refetch()}
            />
        </div>
    );
}
