/**
 * SheetsMonitor — Operational dashboard for the Google Sheets hybrid system.
 *
 * Composes data from 3 queries at different poll intervals:
 *   - Background jobs (15s) — worker running state
 *   - Offload status (30s) — buffer counts, recent runs
 *   - Monitor stats (60s) — inventory totals, ingestion history
 */

import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useServerFn } from '@tanstack/react-start';
import {
    Loader2, Play, ChevronDown, ChevronRight,
    ArrowRightLeft, Database, Package, AlertCircle,
} from 'lucide-react';
import {
    getBackgroundJobs,
    startBackgroundJob,
    getSheetsMonitorStats,
    type BackgroundJob,
    type SheetsMonitorStats,
} from '../server/functions/admin';

// ============================================
// TYPES (matching new per-job server response)
// ============================================

interface JobStateResponse {
    isRunning: boolean;
    lastRunAt: string | null;
    lastResult: Record<string, unknown> | null;
    recentRuns: Array<{ startedAt: string; durationMs: number; count: number; error: string | null }>;
}

interface BufferCounts {
    inward: number;
    outward: number;
}

interface OffloadStatusResponse {
    ingestInward: JobStateResponse;
    ingestOutward: JobStateResponse;
    moveShipped: JobStateResponse;
    schedulerActive: boolean;
    intervalMs: number;
    bufferCounts: BufferCounts;
}

// ============================================
// HELPERS
// ============================================

function formatDuration(ms: number): string {
    if (ms < 1000) return `${ms}ms`;
    if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`;
    return `${(ms / 60000).toFixed(1)}m`;
}

function formatTime(ts: string | Date | null | undefined): string {
    if (!ts) return 'Never';
    const d = new Date(ts);
    const now = new Date();
    const diffMs = now.getTime() - d.getTime();
    const diffMins = Math.floor(diffMs / 60000);
    if (diffMins < 1) return 'Just now';
    if (diffMins < 60) return `${diffMins}m ago`;
    const diffHours = Math.floor(diffMins / 60);
    if (diffHours < 24) return `${diffHours}h ago`;
    return d.toLocaleDateString();
}


// ============================================
// SUB-COMPONENTS
// ============================================

function StatusBadge({ active, label }: { active: boolean; label: string }) {
    return (
        <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium ${
            active ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-600'
        }`}>
            {active && <span className="w-1.5 h-1.5 rounded-full bg-green-500 animate-pulse" />}
            {label}
        </span>
    );
}

function MetricCard({ label, value, sub, color }: {
    label: string;
    value: string | number;
    sub?: string;
    color?: 'green' | 'blue' | 'amber' | 'red' | 'gray';
}) {
    const colors = {
        green: 'bg-emerald-50 border-emerald-200',
        blue: 'bg-blue-50 border-blue-200',
        amber: 'bg-amber-50 border-amber-200',
        red: 'bg-red-50 border-red-200',
        gray: 'bg-gray-50 border-gray-200',
    };
    const valueColors = {
        green: 'text-emerald-700',
        blue: 'text-blue-700',
        amber: 'text-amber-700',
        red: 'text-red-700',
        gray: 'text-gray-900',
    };
    const bg = color ? colors[color] : 'bg-gray-50 border-gray-200';
    const vc = color ? valueColors[color] : 'text-gray-900';

    return (
        <div className={`rounded-lg p-3 border ${bg}`}>
            <div className="text-xs text-gray-500 mb-1">{label}</div>
            <div className={`text-lg font-semibold ${vc}`}>{value}</div>
            {sub && <div className="text-xs text-gray-400 mt-0.5">{sub}</div>}
        </div>
    );
}

function SmallMetric({ label, value, highlight }: {
    label: string;
    value: string | number;
    highlight?: boolean;
}) {
    return (
        <div className="bg-white border rounded p-2 text-center">
            <div className="text-xs text-gray-500">{label}</div>
            <div className={`text-sm font-semibold ${highlight ? 'text-red-600' : 'text-gray-900'}`}>
                {value}
            </div>
        </div>
    );
}

// ============================================
// MAIN COMPONENT
// ============================================

export default function SheetsMonitor() {
    const queryClient = useQueryClient();
    const [showRecentRuns, setShowRecentRuns] = useState(false);
    const [showTransactions, setShowTransactions] = useState(false);

    // Server function wrappers
    const getJobsFn = useServerFn(getBackgroundJobs);
    const triggerFn = useServerFn(startBackgroundJob);
    const getStatsFn = useServerFn(getSheetsMonitorStats);

    // ── Query 1: Background jobs (15s poll) ──
    const { data: jobs } = useQuery({
        queryKey: ['backgroundJobs'],
        queryFn: async () => {
            const result = await getJobsFn();
            if (!result.success) return [];
            return (result.data || []) as BackgroundJob[];
        },
        refetchInterval: 15000,
    });

    const ingestInwardJob = jobs?.find(j => j.id === 'ingest_inward') ?? null;

    // ── Query 2: Offload status with buffer counts (30s poll) ──
    const { data: offloadStatus } = useQuery({
        queryKey: ['sheetOffloadDetailedStatus'],
        queryFn: async (): Promise<OffloadStatusResponse | null> => {
            try {
                const response = await fetch('/api/admin/sheet-offload/status', {
                    credentials: 'include',
                });
                if (!response.ok) return null;
                return await response.json() as OffloadStatusResponse;
            } catch {
                return null;
            }
        },
        refetchInterval: 30000,
    });

    // ── Query 3: Inventory & ingestion stats (60s poll) ──
    const { data: stats } = useQuery({
        queryKey: ['sheetsMonitorStats'],
        queryFn: async (): Promise<SheetsMonitorStats | null> => {
            const result = await getStatsFn();
            if (!result.success) return null;
            return result.data ?? null;
        },
        refetchInterval: 60000,
    });

    // ── Mutations ──
    const invalidateAll = () => {
        queryClient.invalidateQueries({ queryKey: ['backgroundJobs'] });
        queryClient.invalidateQueries({ queryKey: ['sheetOffloadDetailedStatus'] });
        queryClient.invalidateQueries({ queryKey: ['sheetsMonitorStats'] });
    };

    const triggerInwardMutation = useMutation({
        mutationFn: async () => {
            const result = await triggerFn({
                data: { jobId: 'ingest_inward' as const },
            });
            if (!result.success) throw new Error(result.error?.message);
            return result.data;
        },
        onSuccess: invalidateAll,
    });

    const triggerOutwardMutation = useMutation({
        mutationFn: async () => {
            const result = await triggerFn({
                data: { jobId: 'ingest_outward' as const },
            });
            if (!result.success) throw new Error(result.error?.message);
            return result.data;
        },
        onSuccess: invalidateAll,
    });

    const triggerMoveMutation = useMutation({
        mutationFn: async () => {
            const result = await triggerFn({
                data: { jobId: 'move_shipped_to_outward' as const },
            });
            if (!result.success) throw new Error(result.error?.message);
            return result.data;
        },
        onSuccess: invalidateAll,
    });

    // Derived data
    const bufferCounts = offloadStatus?.bufferCounts ?? { inward: 0, outward: 0 };
    const inwardState = offloadStatus?.ingestInward;
    const outwardState = offloadStatus?.ingestOutward;
    const moveState = offloadStatus?.moveShipped;
    const deletionEnabled = ingestInwardJob?.config?.deletionEnabled ?? false;
    // Combine recent runs from both ingest jobs for the history table
    const recentRuns = [
        ...(inwardState?.recentRuns?.map(r => ({ ...r, type: 'inward' as const })) ?? []),
        ...(outwardState?.recentRuns?.map(r => ({ ...r, type: 'outward' as const })) ?? []),
    ].sort((a, b) => new Date(b.startedAt).getTime() - new Date(a.startedAt).getTime());

    return (
        <div className="p-4 sm:p-6 max-w-6xl mx-auto space-y-4">
            {/* Header */}
            <div className="flex items-center justify-between">
                <h1 className="text-xl font-semibold text-gray-900">Sheets Monitor</h1>
                <div className="flex items-center gap-2 text-xs text-gray-400">
                    <Database size={14} />
                    Google Sheets Hybrid System
                </div>
            </div>

            {/* ── Section 1: System Status Bar ── */}
            <div className="bg-white rounded-lg border border-gray-200 p-4 shadow-sm">
                <div className="flex flex-wrap items-center gap-4">
                    {/* Scheduler status */}
                    <div className="flex items-center gap-2">
                        <span className="text-xs text-gray-500">Scheduler</span>
                        <StatusBadge active={offloadStatus?.schedulerActive ?? false} label={offloadStatus?.schedulerActive ? 'Active' : 'Disabled'} />
                    </div>

                    {/* Buffer pending */}
                    <div className="flex items-center gap-3 px-3 border-l border-gray-200">
                        <div className="text-center">
                            <div className="text-xs text-gray-500">Inward Buffer</div>
                            <div className={`text-sm font-semibold ${bufferCounts.inward > 0 ? 'text-emerald-600' : 'text-gray-400'}`}>
                                {bufferCounts.inward}
                            </div>
                        </div>
                        <div className="text-center">
                            <div className="text-xs text-gray-500">Outward Buffer</div>
                            <div className={`text-sm font-semibold ${bufferCounts.outward > 0 ? 'text-blue-600' : 'text-gray-400'}`}>
                                {bufferCounts.outward}
                            </div>
                        </div>
                    </div>

                    {/* Config badge */}
                    <div className="flex items-center gap-2 px-3 border-l border-gray-200">
                        <span className="text-xs text-gray-500">Deletion</span>
                        <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${
                            deletionEnabled ? 'bg-blue-100 text-blue-700' : 'bg-amber-100 text-amber-700'
                        }`}>
                            {deletionEnabled ? 'Enabled' : 'Disabled'}
                        </span>
                    </div>

                    {/* Action buttons */}
                    <div className="flex items-center gap-2 ml-auto">
                        <button
                            onClick={() => triggerMoveMutation.mutate()}
                            disabled={triggerMoveMutation.isPending || moveState?.isRunning}
                            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-md border border-gray-300 bg-white text-gray-700 hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed"
                        >
                            {triggerMoveMutation.isPending ? (
                                <Loader2 size={14} className="animate-spin" />
                            ) : (
                                <ArrowRightLeft size={14} />
                            )}
                            Move Shipped
                        </button>
                        <button
                            onClick={() => triggerInwardMutation.mutate()}
                            disabled={triggerInwardMutation.isPending || inwardState?.isRunning}
                            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-md bg-emerald-600 text-white hover:bg-emerald-700 disabled:opacity-50 disabled:cursor-not-allowed"
                        >
                            {triggerInwardMutation.isPending ? (
                                <Loader2 size={14} className="animate-spin" />
                            ) : (
                                <Play size={14} />
                            )}
                            Ingest Inward
                        </button>
                        <button
                            onClick={() => triggerOutwardMutation.mutate()}
                            disabled={triggerOutwardMutation.isPending || outwardState?.isRunning}
                            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-md bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed"
                        >
                            {triggerOutwardMutation.isPending ? (
                                <Loader2 size={14} className="animate-spin" />
                            ) : (
                                <Play size={14} />
                            )}
                            Ingest Outward
                        </button>
                    </div>
                </div>

                {/* Mutation errors */}
                {triggerInwardMutation.error && (
                    <div className="mt-2 text-xs text-red-600 flex items-center gap-1">
                        <AlertCircle size={12} /> Ingest Inward: {triggerInwardMutation.error.message}
                    </div>
                )}
                {triggerOutwardMutation.error && (
                    <div className="mt-2 text-xs text-red-600 flex items-center gap-1">
                        <AlertCircle size={12} /> Ingest Outward: {triggerOutwardMutation.error.message}
                    </div>
                )}
                {triggerMoveMutation.error && (
                    <div className="mt-2 text-xs text-red-600 flex items-center gap-1">
                        <AlertCircle size={12} /> Move Shipped: {triggerMoveMutation.error.message}
                    </div>
                )}
            </div>

            {/* ── Section 2: Last Sync Results (3 columns) ── */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                {/* Ingest Inward */}
                <div className="bg-white rounded-lg border border-gray-200 p-4 shadow-sm">
                    <div className="flex items-center justify-between mb-3">
                        <h3 className="text-sm font-medium text-gray-900">Ingest Inward</h3>
                        {inwardState?.isRunning && <Loader2 size={14} className="animate-spin text-emerald-600" />}
                    </div>
                    {inwardState?.lastResult ? (
                        <>
                            <div className="text-xs text-gray-500 mb-2">
                                {formatTime(inwardState.lastRunAt)}
                                {inwardState.lastResult.durationMs != null && (
                                    <span className="ml-2 text-gray-400">{formatDuration(Number(inwardState.lastResult.durationMs))}</span>
                                )}
                            </div>
                            <div className="grid grid-cols-2 gap-2">
                                <SmallMetric label="Ingested" value={Number(inwardState.lastResult.inwardIngested ?? 0)} />
                                <SmallMetric label="Skipped" value={Number(inwardState.lastResult.skipped ?? 0)} />
                                <SmallMetric label="Rows Deleted" value={Number(inwardState.lastResult.rowsDeleted ?? 0)} />
                                <SmallMetric label="SKUs Updated" value={Number(inwardState.lastResult.skusUpdated ?? 0)} />
                                <SmallMetric label="Errors" value={Number(inwardState.lastResult.errors ?? 0)} highlight={Number(inwardState.lastResult.errors ?? 0) > 0} />
                            </div>
                            {inwardState.lastResult.error && (
                                <div className="mt-2 p-2 bg-red-50 border border-red-200 rounded text-xs text-red-700">
                                    {String(inwardState.lastResult.error)}
                                </div>
                            )}
                        </>
                    ) : (
                        <div className="text-sm text-gray-400">No results yet</div>
                    )}
                </div>

                {/* Move Shipped */}
                <div className="bg-white rounded-lg border border-gray-200 p-4 shadow-sm">
                    <div className="flex items-center justify-between mb-3">
                        <h3 className="text-sm font-medium text-gray-900">Move Shipped</h3>
                        {moveState?.isRunning && <Loader2 size={14} className="animate-spin text-amber-600" />}
                    </div>
                    {moveState?.lastResult ? (
                        <>
                            <div className="text-xs text-gray-500 mb-2">
                                {formatTime(moveState.lastRunAt)}
                                {moveState.lastResult.durationMs != null && (
                                    <span className="ml-2 text-gray-400">{formatDuration(Number(moveState.lastResult.durationMs))}</span>
                                )}
                            </div>
                            <div className="grid grid-cols-2 gap-2">
                                <SmallMetric label="Rows Found" value={Number(moveState.lastResult.shippedRowsFound ?? 0)} />
                                <SmallMetric label="Written" value={Number(moveState.lastResult.rowsWrittenToOutward ?? 0)} />
                                <SmallMetric label="Deleted" value={Number(moveState.lastResult.rowsDeletedFromOrders ?? 0)} />
                                <SmallMetric label="Errors" value={Array.isArray(moveState.lastResult.errors) ? moveState.lastResult.errors.length : 0}
                                    highlight={Array.isArray(moveState.lastResult.errors) && moveState.lastResult.errors.length > 0} />
                            </div>
                            {Array.isArray(moveState.lastResult.errors) && moveState.lastResult.errors.length > 0 && (
                                <div className="mt-2 p-2 bg-red-50 border border-red-200 rounded text-xs text-red-700 space-y-0.5">
                                    {(moveState.lastResult.errors as string[]).slice(0, 3).map((err, i) => (
                                        <div key={i}>{err}</div>
                                    ))}
                                    {moveState.lastResult.errors.length > 3 && (
                                        <div className="text-red-400">...and {moveState.lastResult.errors.length - 3} more</div>
                                    )}
                                </div>
                            )}
                        </>
                    ) : (
                        <div className="text-sm text-gray-400">No results yet</div>
                    )}
                </div>

                {/* Ingest Outward */}
                <div className="bg-white rounded-lg border border-gray-200 p-4 shadow-sm">
                    <div className="flex items-center justify-between mb-3">
                        <h3 className="text-sm font-medium text-gray-900">Ingest Outward</h3>
                        {outwardState?.isRunning && <Loader2 size={14} className="animate-spin text-blue-600" />}
                    </div>
                    {outwardState?.lastResult ? (
                        <>
                            <div className="text-xs text-gray-500 mb-2">
                                {formatTime(outwardState.lastRunAt)}
                                {outwardState.lastResult.durationMs != null && (
                                    <span className="ml-2 text-gray-400">{formatDuration(Number(outwardState.lastResult.durationMs))}</span>
                                )}
                            </div>
                            <div className="grid grid-cols-2 gap-2">
                                <SmallMetric label="Ingested" value={Number(outwardState.lastResult.outwardIngested ?? 0)} />
                                <SmallMetric label="Orders Linked" value={Number(outwardState.lastResult.ordersLinked ?? 0)} />
                                <SmallMetric label="Rows Deleted" value={Number(outwardState.lastResult.rowsDeleted ?? 0)} />
                                <SmallMetric label="SKUs Updated" value={Number(outwardState.lastResult.skusUpdated ?? 0)} />
                                <SmallMetric label="Skipped" value={Number(outwardState.lastResult.skipped ?? 0)} />
                                <SmallMetric label="Errors" value={Number(outwardState.lastResult.errors ?? 0)} highlight={Number(outwardState.lastResult.errors ?? 0) > 0} />
                            </div>
                            {outwardState.lastResult.error && (
                                <div className="mt-2 p-2 bg-red-50 border border-red-200 rounded text-xs text-red-700">
                                    {String(outwardState.lastResult.error)}
                                </div>
                            )}
                        </>
                    ) : (
                        <div className="text-sm text-gray-400">No results yet</div>
                    )}
                </div>
            </div>

            {/* ── Section 3: Inventory Overview ── */}
            <div className="bg-white rounded-lg border border-gray-200 p-4 shadow-sm">
                <div className="flex items-center gap-2 mb-3">
                    <Package size={16} className="text-gray-500" />
                    <h3 className="text-sm font-medium text-gray-900">Inventory Overview</h3>
                </div>
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                    <MetricCard
                        label="Total SKUs"
                        value={stats?.inventory.totalSkus?.toLocaleString() ?? '—'}
                    />
                    <MetricCard
                        label="Total Balance"
                        value={stats?.inventory.totalBalance?.toLocaleString() ?? '—'}
                        color="blue"
                    />
                    <MetricCard
                        label="In Stock"
                        value={stats?.inventory.inStock?.toLocaleString() ?? '—'}
                        color="green"
                    />
                    <MetricCard
                        label="Out of Stock"
                        value={stats?.inventory.outOfStock?.toLocaleString() ?? '—'}
                        color={stats?.inventory.outOfStock && stats.inventory.outOfStock > 0 ? 'amber' : 'gray'}
                    />
                </div>
            </div>

            {/* ── Section 4: Ingestion History ── */}
            <div className="bg-white rounded-lg border border-gray-200 p-4 shadow-sm">
                <button
                    className="flex items-center gap-2 w-full text-left"
                    onClick={() => setShowRecentRuns(!showRecentRuns)}
                >
                    {showRecentRuns ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
                    <h3 className="text-sm font-medium text-gray-900">Ingestion History</h3>
                    <span className="text-xs text-gray-400 ml-auto">
                        {stats ? `${(stats.ingestion.totalInwardLive + stats.ingestion.totalOutwardLive + stats.ingestion.historicalInward + stats.ingestion.historicalOutward).toLocaleString()} total txns` : ''}
                    </span>
                </button>

                {/* All-time counts always visible */}
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mt-3">
                    <MetricCard
                        label="Inward (Live)"
                        value={stats?.ingestion.totalInwardLive?.toLocaleString() ?? '—'}
                        color="green"
                    />
                    <MetricCard
                        label="Outward (Live)"
                        value={stats?.ingestion.totalOutwardLive?.toLocaleString() ?? '—'}
                        color="blue"
                    />
                    <MetricCard
                        label="Historical Inward"
                        value={stats?.ingestion.historicalInward?.toLocaleString() ?? '—'}
                        color="gray"
                    />
                    <MetricCard
                        label="Historical Outward"
                        value={stats?.ingestion.historicalOutward?.toLocaleString() ?? '—'}
                        color="gray"
                    />
                </div>

                {/* Recent runs table (collapsible) */}
                {showRecentRuns && recentRuns.length > 0 && (
                    <div className="mt-3 border rounded-lg overflow-hidden">
                        <table className="w-full text-xs">
                            <thead className="bg-gray-50">
                                <tr>
                                    <th className="text-left px-3 py-1.5 font-medium text-gray-600">Time</th>
                                    <th className="text-left px-3 py-1.5 font-medium text-gray-600">Job</th>
                                    <th className="text-right px-3 py-1.5 font-medium text-gray-600">Duration</th>
                                    <th className="text-right px-3 py-1.5 font-medium text-gray-600">Count</th>
                                    <th className="text-left px-3 py-1.5 font-medium text-gray-600">Status</th>
                                </tr>
                            </thead>
                            <tbody className="divide-y">
                                {recentRuns.slice(0, 15).map((run, i) => (
                                    <tr key={i} className="hover:bg-gray-50">
                                        <td className="px-3 py-1.5 text-gray-700">{formatTime(run.startedAt)}</td>
                                        <td className="px-3 py-1.5">
                                            <span className={`inline-flex px-1.5 py-0.5 rounded text-[10px] font-medium ${
                                                run.type === 'inward'
                                                    ? 'bg-emerald-100 text-emerald-700'
                                                    : 'bg-blue-100 text-blue-700'
                                            }`}>
                                                {run.type === 'inward' ? 'Inward' : 'Outward'}
                                            </span>
                                        </td>
                                        <td className="px-3 py-1.5 text-right text-gray-600">{formatDuration(run.durationMs)}</td>
                                        <td className={`px-3 py-1.5 text-right font-medium ${
                                            run.type === 'inward' ? 'text-emerald-600' : 'text-blue-600'
                                        }`}>{run.count}</td>
                                        <td className="px-3 py-1.5">
                                            {run.error ? (
                                                <span className="text-red-600" title={run.error}>Failed</span>
                                            ) : (
                                                <span className="text-green-600">OK</span>
                                            )}
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                )}
                {showRecentRuns && recentRuns.length === 0 && (
                    <div className="mt-3 text-sm text-gray-400">No recent runs recorded</div>
                )}
            </div>

            {/* ── Section 5: Recent Transactions ── */}
            <div className="bg-white rounded-lg border border-gray-200 p-4 shadow-sm">
                <button
                    className="flex items-center gap-2 w-full text-left"
                    onClick={() => setShowTransactions(!showTransactions)}
                >
                    {showTransactions ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
                    <h3 className="text-sm font-medium text-gray-900">Recent Transactions</h3>
                    <span className="text-xs text-gray-400 ml-auto">
                        Last {stats?.recentTransactions?.length ?? 0} sheet-sourced
                    </span>
                </button>

                {showTransactions && stats?.recentTransactions && stats.recentTransactions.length > 0 && (
                    <div className="mt-3 border rounded-lg overflow-hidden">
                        <table className="w-full text-xs">
                            <thead className="bg-gray-50">
                                <tr>
                                    <th className="text-left px-3 py-1.5 font-medium text-gray-600">Time</th>
                                    <th className="text-left px-3 py-1.5 font-medium text-gray-600">SKU</th>
                                    <th className="text-left px-3 py-1.5 font-medium text-gray-600">Type</th>
                                    <th className="text-right px-3 py-1.5 font-medium text-gray-600">Qty</th>
                                    <th className="text-left px-3 py-1.5 font-medium text-gray-600">Reason</th>
                                    <th className="text-left px-3 py-1.5 font-medium text-gray-600">Reference</th>
                                </tr>
                            </thead>
                            <tbody className="divide-y">
                                {stats.recentTransactions.map(txn => (
                                    <tr key={txn.id} className="hover:bg-gray-50">
                                        <td className="px-3 py-1.5 text-gray-500 whitespace-nowrap">{formatTime(txn.createdAt)}</td>
                                        <td className="px-3 py-1.5 text-gray-900 font-mono text-[11px]">{txn.skuCode}</td>
                                        <td className="px-3 py-1.5">
                                            <span className={`inline-flex px-1.5 py-0.5 rounded text-[10px] font-medium ${
                                                txn.referenceId?.includes('inward')
                                                    ? 'bg-emerald-100 text-emerald-700'
                                                    : 'bg-blue-100 text-blue-700'
                                            }`}>
                                                {txn.referenceId?.includes('inward') ? 'Inward' : 'Outward'}
                                            </span>
                                        </td>
                                        <td className={`px-3 py-1.5 text-right font-medium ${
                                            txn.quantity > 0 ? 'text-emerald-600' : 'text-red-600'
                                        }`}>
                                            {txn.quantity > 0 ? '+' : ''}{txn.quantity}
                                        </td>
                                        <td className="px-3 py-1.5 text-gray-600 truncate max-w-[120px]">{txn.reason ?? '—'}</td>
                                        <td className="px-3 py-1.5 text-gray-400 font-mono text-[10px] truncate max-w-[180px]">{txn.referenceId ?? '—'}</td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                )}
                {showTransactions && (!stats?.recentTransactions || stats.recentTransactions.length === 0) && (
                    <div className="mt-3 text-sm text-gray-400">No sheet-sourced transactions found</div>
                )}
            </div>
        </div>
    );
}
