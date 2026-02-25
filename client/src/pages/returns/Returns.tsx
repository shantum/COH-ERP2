/**
 * Unified Returns Dashboard
 *
 * 5 tabs:
 * - Action Queue (default): internal line-level returns needing action
 * - All Returns: all active internal returns in a table
 * - Return Prime: legacy RP data (kept for reference)
 * - Analytics: return analytics (from RP data + internal)
 * - Settings: return policy config
 */

import { useState, useCallback } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useServerFn } from '@tanstack/react-start';
import { useNavigate } from '@tanstack/react-router';
import { Route } from '../../routes/_authenticated/returns';
import {
    Search,
    Calendar,
    Filter,
    RefreshCw,
    Download,
    Upload,
    BarChart3,
    Package,
    ListTodo,
    Settings,
    CheckCircle2,
    Inbox,
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

// Return Prime imports
import {
    getReturnPrimeDashboard,
    triggerReturnPrimeSync,
    autoCompleteReceivedReturns,
} from '../../server/functions/returnPrime';
import { returnPrimeQueryKeys } from '../../constants/queryKeys';
import {
    ReturnPrimeStatsCards,
    ReturnPrimeTable,
    ReturnPrimeDetailModal,
    ReturnPrimeCsvEnrichmentDialog,
} from '../../components/returnPrime';

// Internal returns imports
import {
    getLineReturnActionQueue,
    getReturnConfig,
} from '../../server/functions/returns';
import { updateReturnNotes } from '../../server/functions/returnLifecycle';
import {
    cancelLineReturn,
    receiveLineReturn,
    scheduleReturnPickup,
} from '../../server/functions/returnLifecycle';
import {
    processLineReturnRefund,
    createExchangeOrder,
    completeLineReturn,
} from '../../server/functions/returnResolution';

// Tab components
import { ActionQueueTab } from './tabs/ActionQueueTab';
import { AllReturnsTab } from './tabs/AllReturnsTab';
import { AnalyticsTab } from './tabs/AnalyticsTab';
import { SettingsTab } from './tabs/SettingsTab';
import { ProcessRefundModal } from './modals/ProcessRefundModal';

import type { ReturnPrimeRequest } from '@coh/shared/schemas/returnPrime';
import type { ReturnActionQueueItem as ServerReturnActionQueueItem } from '@coh/shared/schemas/returns';

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
    const [selectedRpRequest, setSelectedRpRequest] = useState<ReturnPrimeRequest | null>(null);
    const [csvDialogOpen, setCsvDialogOpen] = useState(false);
    const [refundModalItem, setRefundModalItem] = useState<ServerReturnActionQueueItem | null>(null);

    // ============================================
    // INTERNAL RETURNS QUERIES
    // ============================================

    const getActionQueueFn = useServerFn(getLineReturnActionQueue);
    const { data: actionQueue, isLoading: actionQueueLoading } = useQuery({
        queryKey: ['returns', 'actionQueue'],
        queryFn: () => getActionQueueFn(),
        staleTime: 30 * 1000,
        enabled: search.tab === 'actions',
    });

    const getConfigFn = useServerFn(getReturnConfig);
    const { data: returnConfig, isLoading: configLoading, refetch: refetchConfig } = useQuery({
        queryKey: ['returns', 'config'],
        queryFn: () => getConfigFn(),
        staleTime: 5 * 60 * 1000,
        enabled: search.tab === 'settings',
    });

    // ============================================
    // RETURN PRIME QUERIES (for RP tab)
    // ============================================

    const dateRange = getDateRange(search.datePreset);
    const rpFilters = {
        ...dateRange,
        ...(search.requestType !== 'all' ? { requestType: search.requestType } : {}),
        ...(search.search ? { search: search.search } : {}),
    };

    const getDashboardFn = useServerFn(getReturnPrimeDashboard);
    const { data: rpData, isLoading: rpLoading, refetch: rpRefetch } = useQuery({
        queryKey: returnPrimeQueryKeys.dashboard(rpFilters),
        queryFn: () => getDashboardFn({ data: rpFilters }),
        staleTime: 60 * 1000,
        enabled: search.tab === 'return_prime',
    });

    // ============================================
    // INTERNAL RETURN MUTATIONS
    // ============================================

    const schedulePickupFn = useServerFn(scheduleReturnPickup);
    const schedulePickupMutation = useMutation({
        mutationFn: (lineId: string) =>
            schedulePickupFn({ data: { orderLineId: lineId, pickupType: 'manual' } }),
        onSuccess: () => {
            toast.success('Pickup scheduled');
            invalidateReturns();
        },
        onError: (err: unknown) =>
            toast.error(err instanceof Error ? err.message : 'Failed to schedule pickup'),
    });

    const receiveReturnFn = useServerFn(receiveLineReturn);
    const receiveMutation = useMutation({
        mutationFn: ({ lineId, condition }: { lineId: string; condition: 'good' | 'damaged' | 'defective' | 'wrong_item' | 'used' }) =>
            receiveReturnFn({ data: { orderLineId: lineId, condition } }),
        onSuccess: () => {
            toast.success('Return received — item queued for QC');
            invalidateReturns();
        },
        onError: (err: unknown) =>
            toast.error(err instanceof Error ? err.message : 'Failed to receive return'),
    });

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

    const createExchangeFn = useServerFn(createExchangeOrder);
    const createExchangeMutation = useMutation({
        mutationFn: (lineId: string) =>
            createExchangeFn({ data: { orderLineId: lineId } }),
        onSuccess: (res) => {
            if (res.success) {
                toast.success(`Exchange order created: ${res.data?.exchangeOrderNumber}`);
            }
            invalidateReturns();
        },
        onError: (err: unknown) =>
            toast.error(err instanceof Error ? err.message : 'Failed to create exchange'),
    });

    const completeReturnFn = useServerFn(completeLineReturn);
    const completeMutation = useMutation({
        mutationFn: (lineId: string) =>
            completeReturnFn({ data: { orderLineId: lineId } }),
        onSuccess: () => {
            toast.success('Return completed');
            invalidateReturns();
        },
        onError: (err: unknown) =>
            toast.error(err instanceof Error ? err.message : 'Failed to complete return'),
    });

    const cancelReturnFn = useServerFn(cancelLineReturn);
    const cancelMutation = useMutation({
        mutationFn: (lineId: string) =>
            cancelReturnFn({ data: { orderLineId: lineId, reason: 'Cancelled by staff' } }),
        onSuccess: () => {
            toast.success('Return cancelled');
            invalidateReturns();
        },
        onError: (err: unknown) =>
            toast.error(err instanceof Error ? err.message : 'Failed to cancel return'),
    });

    const updateNotesFn = useServerFn(updateReturnNotes);
    const updateNotesMutation = useMutation({
        mutationFn: ({ lineId, notes }: { lineId: string; notes: string }) =>
            updateNotesFn({ data: { orderLineId: lineId, notes } }),
        onSuccess: () => invalidateReturns(),
        onError: (err: unknown) =>
            toast.error(err instanceof Error ? err.message : 'Failed to update notes'),
    });

    // ============================================
    // RETURN PRIME MUTATIONS
    // ============================================

    const triggerSyncFn = useServerFn(triggerReturnPrimeSync);
    const syncMutation = useMutation({
        mutationFn: () => triggerSyncFn(),
        onSuccess: (res) => {
            if (res.success) {
                toast.success(res.message);
                rpRefetch();
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
                    autoCompleteMutation.mutate(false);
                }
            } else {
                toast.success(res.message);
                rpRefetch();
            }
        },
        onError: () => toast.error('Auto-complete failed'),
    });

    // ============================================
    // HANDLERS
    // ============================================

    const handleTabChange = useCallback(
        (value: string) => {
            navigate({
                search: (prev) => ({
                    ...prev,
                    tab: value as 'actions' | 'all' | 'return_prime' | 'analytics' | 'settings',
                }),
            });
        },
        [navigate]
    );

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

    const handleProcessRefund = useCallback((_lineId: string, item: ServerReturnActionQueueItem) => {
        setRefundModalItem(item);
    }, []);

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
                        Returns & exchanges management
                    </p>
                </div>
                {/* RP-specific actions (only show on RP tab) */}
                {search.tab === 'return_prime' && (
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
                    </div>
                )}
            </div>

            {/* Tabs */}
            <Tabs value={search.tab} onValueChange={handleTabChange}>
                <TabsList>
                    <TabsTrigger value="actions" className="flex items-center gap-1.5">
                        <ListTodo className="w-4 h-4" />
                        Action Queue
                        {actionQueue && actionQueue.length > 0 && (
                            <Badge variant="secondary" className="ml-1 text-xs">
                                {actionQueue.length}
                            </Badge>
                        )}
                    </TabsTrigger>
                    <TabsTrigger value="all" className="flex items-center gap-1.5">
                        <Package className="w-4 h-4" />
                        All Returns
                    </TabsTrigger>
                    <TabsTrigger value="return_prime" className="flex items-center gap-1.5">
                        <Inbox className="w-4 h-4" />
                        Return Prime
                    </TabsTrigger>
                    <TabsTrigger value="analytics" className="flex items-center gap-1.5">
                        <BarChart3 className="w-4 h-4" />
                        Analytics
                    </TabsTrigger>
                    <TabsTrigger value="settings" className="flex items-center gap-1.5">
                        <Settings className="w-4 h-4" />
                        Settings
                    </TabsTrigger>
                </TabsList>

                {/* Action Queue Tab */}
                <TabsContent value="actions" className="mt-4">
                    <ActionQueueTab
                        items={actionQueue || []}
                        loading={actionQueueLoading}
                        onSchedulePickup={(lineId) => schedulePickupMutation.mutate(lineId)}
                        onReceive={(lineId, condition) => receiveMutation.mutate({ lineId, condition })}
                        onProcessRefund={handleProcessRefund}
                        onCreateExchange={(lineId) => createExchangeMutation.mutate(lineId)}
                        onComplete={(lineId) => completeMutation.mutate(lineId)}
                        onCancel={(lineId) => {
                            if (confirm('Cancel this return?')) cancelMutation.mutate(lineId);
                        }}
                        onUpdateNotes={(lineId, notes) => updateNotesMutation.mutate({ lineId, notes })}
                    />
                </TabsContent>

                {/* All Returns Tab */}
                <TabsContent value="all" className="mt-4">
                    <AllReturnsTab />
                </TabsContent>

                {/* Return Prime Tab */}
                <TabsContent value="return_prime" className="mt-4 space-y-4">
                    {/* RP Filters Bar */}
                    <div className="flex flex-col sm:flex-row gap-3 p-4 bg-white rounded-lg border border-gray-200">
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
                        <Button
                            variant="outline"
                            size="icon"
                            onClick={() => rpRefetch()}
                            disabled={rpLoading}
                        >
                            <RefreshCw className={`w-4 h-4 ${rpLoading ? 'animate-spin' : ''}`} />
                        </Button>
                    </div>

                    {/* RP Stats */}
                    <ReturnPrimeStatsCards stats={rpData?.stats} isLoading={rpLoading} />

                    {/* RP Table */}
                    <ReturnPrimeTable
                        requests={rpData?.requests || []}
                        isLoading={rpLoading}
                        onRowClick={setSelectedRpRequest}
                    />
                </TabsContent>

                {/* Analytics Tab */}
                <TabsContent value="analytics" className="mt-4 space-y-4">
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
                    <AnalyticsTab period={search.datePreset} />
                </TabsContent>

                {/* Settings Tab */}
                <TabsContent value="settings" className="mt-4">
                    <SettingsTab
                        config={returnConfig}
                        loading={configLoading}
                        onRefresh={() => refetchConfig()}
                    />
                </TabsContent>
            </Tabs>

            {/* Refund Modal */}
            {refundModalItem && (
                <ProcessRefundModal
                    item={refundModalItem}
                    onSubmit={handleRefundSubmit}
                    onClose={() => setRefundModalItem(null)}
                />
            )}

            {/* Return Prime Detail Modal */}
            <ReturnPrimeDetailModal
                request={selectedRpRequest}
                open={!!selectedRpRequest}
                onOpenChange={(open) => {
                    if (!open) setSelectedRpRequest(null);
                }}
            />

            {/* Return Prime CSV Dialog */}
            <ReturnPrimeCsvEnrichmentDialog
                open={csvDialogOpen}
                onOpenChange={setCsvDialogOpen}
                onImported={() => rpRefetch()}
            />
        </div>
    );
}
