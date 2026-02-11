/**
 * Return Prime Dashboard Page
 *
 * Customer returns and exchanges from Return Prime integration.
 * Page-level orchestration only: state, queries, layout.
 * Components imported from ../components/returnPrime/.
 */

import { useState, useCallback } from 'react';
import { useQuery, useMutation } from '@tanstack/react-query';
import { useServerFn } from '@tanstack/react-start';
import { Route } from '../routes/_authenticated/return-prime';
import { useNavigate } from '@tanstack/react-router';
import {
    Search,
    Calendar,
    Filter,
    RefreshCw,
    AlertCircle,
    Download,
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
import { toast } from 'sonner';
import { getReturnPrimeDashboard, triggerReturnPrimeSync } from '../server/functions/returnPrime';
import { returnPrimeQueryKeys } from '../constants/queryKeys';
import {
    ReturnPrimeStatsCards,
    ReturnPrimeTable,
    ReturnPrimeDetailModal,
    ReturnPrimeAnalytics,
} from '../components/returnPrime';
import type { ReturnPrimeRequest } from '@coh/shared/schemas/returnPrime';

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

// ============================================
// MAIN COMPONENT
// ============================================

export default function ReturnPrimePage() {
    const search = Route.useSearch();
    const navigate = useNavigate({ from: Route.fullPath });

    // Local state
    const [datePreset, setDatePreset] = useState<string>('30d');
    const [searchInput, setSearchInput] = useState(search.search || '');
    const [selectedRequest, setSelectedRequest] = useState<ReturnPrimeRequest | null>(null);

    // Compute filters
    const dateRange = getDateRange(datePreset);
    const filters = {
        ...dateRange,
        requestType: search.requestType,
        search: search.search,
    };

    // Fetch dashboard data (requests + stats) from local database
    const { data, isLoading, error, refetch } = useQuery({
        queryKey: returnPrimeQueryKeys.dashboard(filters),
        queryFn: () => getReturnPrimeDashboard({ data: filters }),
        staleTime: 60 * 1000,
        retry: 2,
    });

    // Sync mutation
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

    // Handlers
    const handleSearch = useCallback(() => {
        navigate({
            search: (prev) => ({ ...prev, search: searchInput || undefined }),
        });
    }, [navigate, searchInput]);

    const handleSearchKeyDown = useCallback(
        (e: React.KeyboardEvent) => {
            if (e.key === 'Enter') {
                handleSearch();
            }
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

    const handleTabChange = useCallback(
        (value: string) => {
            navigate({
                search: (prev) => ({ ...prev, tab: value as 'requests' | 'analytics' }),
            });
        },
        [navigate]
    );

    // Error state
    if (error) {
        return (
            <div className="p-6">
                <div className="bg-red-50 border border-red-200 rounded-lg p-6 text-center">
                    <AlertCircle className="w-12 h-12 text-red-400 mx-auto mb-3" />
                    <h3 className="text-lg font-semibold text-red-800 mb-2">
                        Failed to load Return Prime data
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

    return (
        <div className="space-y-4 sm:space-y-6 px-2 sm:px-4 md:px-6 py-4">
            {/* Header */}
            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
                <div>
                    <h1 className="text-xl sm:text-2xl font-bold text-gray-900">Return Prime</h1>
                    <p className="text-sm text-gray-500 mt-1">
                        Customer returns and exchanges from Return Prime
                    </p>
                </div>
                <div className="flex gap-2">
                    <Button
                        variant="outline"
                        size="sm"
                        onClick={() => syncMutation.mutate()}
                        disabled={syncMutation.isPending}
                    >
                        <Download className={`w-4 h-4 mr-2 ${syncMutation.isPending ? 'animate-pulse' : ''}`} />
                        {syncMutation.isPending ? 'Syncing...' : 'Sync from Return Prime'}
                    </Button>
                    <Button
                        variant="outline"
                        size="sm"
                        onClick={() => refetch()}
                        disabled={isLoading}
                    >
                        <RefreshCw className={`w-4 h-4 mr-2 ${isLoading ? 'animate-spin' : ''}`} />
                        Refresh
                    </Button>
                </div>
            </div>

            {/* Stats Cards */}
            <ReturnPrimeStatsCards stats={data?.stats} isLoading={isLoading} />

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
                <Select value={search.requestType || 'all'} onValueChange={handleTypeChange}>
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
                <Select value={datePreset} onValueChange={setDatePreset}>
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

            {/* Tabs: Requests | Analytics */}
            <Tabs value={search.tab || 'requests'} onValueChange={handleTabChange}>
                <TabsList>
                    <TabsTrigger value="requests">Requests</TabsTrigger>
                    <TabsTrigger value="analytics">Analytics</TabsTrigger>
                </TabsList>

                <TabsContent value="requests" className="mt-4">
                    <ReturnPrimeTable
                        requests={data?.requests || []}
                        isLoading={isLoading}
                        onRowClick={setSelectedRequest}
                    />
                </TabsContent>

                <TabsContent value="analytics" className="mt-4">
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
        </div>
    );
}
