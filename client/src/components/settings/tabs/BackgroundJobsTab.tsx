/**
 * BackgroundJobsTab component
 * View and manage background sync jobs and scheduled tasks
 *
 * Sheet offload jobs (ingest_inward, ingest_outward, move_shipped_to_outward,
 * preview_ingest_inward, preview_ingest_outward) are filtered out here —
 * they're shown in the OffloadMonitor inside SheetSyncTab instead.
 */

import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useServerFn } from '@tanstack/react-start';
import {
    RefreshCw, Play, Clock, CheckCircle, XCircle, Info,
    Store, Truck, Trash2, Archive, AlertTriangle, History, X,
} from 'lucide-react';

// Server Functions
import {
    getBackgroundJobs,
    startBackgroundJob,
    updateBackgroundJob,
    getWorkerRunHistory,
    getWorkerRunSummary,
    type BackgroundJob,
    type WorkerRunEntry,
    type WorkerRunSummaryEntry,
} from '../../../server/functions/admin';

// Result card components
import {
    ShopifySyncResultCard,
    TrackingSyncResultCard,
    CacheCleanupResultCard,
} from '../jobs/JobResultCards';
import type {
    ShopifySyncResult,
    TrackingSyncResult,
    CacheCleanupResult,
    CacheStats,
} from '../jobs/sheetJobTypes';

import ConfirmModal from '../../common/ConfirmModal';

// Sheet job IDs — filtered out of this tab (shown in SheetSyncTab's OffloadMonitor)
const SHEET_JOB_IDS = new Set([
    'ingest_inward',
    'ingest_outward',
    'move_shipped_to_outward',
    'preview_ingest_inward',
    'preview_ingest_outward',
    'cleanup_done_rows',
    'migrate_sheet_formulas',
]);

// Map admin job IDs → worker names used in WorkerRun table
const JOB_TO_WORKER: Record<string, string> = {
    shopify_sync: 'shopify_sync',
    tracking_sync: 'tracking_sync',
    cache_cleanup: 'cache_cleanup',
    snapshot_compute: 'stock_snapshot',
    snapshot_backfill: 'stock_snapshot_backfill',
};

interface JobsResponse {
    jobs: BackgroundJob[];
}

// ============================================
// HISTORY DIALOG
// ============================================

function WorkerHistoryDialog({ workerName, jobName, onClose }: { workerName: string; jobName: string; onClose: () => void }) {
    const getWorkerRunHistoryFn = useServerFn(getWorkerRunHistory);

    const { data, isLoading } = useQuery({
        queryKey: ['workerRunHistory', workerName],
        queryFn: async () => {
            const result = await getWorkerRunHistoryFn({ data: { workerName, limit: 30 } });
            if (!result.success) throw new Error(result.error?.message);
            return result.data!;
        },
    });

    const formatRelativeTime = (timestamp: string) => {
        const diffMs = Date.now() - new Date(timestamp).getTime();
        const mins = Math.floor(diffMs / 60000);
        const hours = Math.floor(mins / 60);
        const days = Math.floor(hours / 24);

        if (mins < 1) return 'Just now';
        if (mins < 60) return `${mins}m ago`;
        if (hours < 24) return `${hours}h ago`;
        if (days < 7) return `${days}d ago`;
        return new Date(timestamp).toLocaleDateString();
    };

    const formatDuration = (ms: number | null) => {
        if (ms == null) return '—';
        if (ms < 1000) return `${ms}ms`;
        if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`;
        return `${(ms / 60000).toFixed(1)}m`;
    };

    return (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4" onClick={onClose}>
            <div className="bg-white rounded-lg shadow-xl w-full max-w-2xl max-h-[80vh] flex flex-col" onClick={e => e.stopPropagation()}>
                {/* Header */}
                <div className="flex items-center justify-between px-5 py-4 border-b">
                    <div className="flex items-center gap-2">
                        <History size={18} className="text-gray-500" />
                        <h3 className="text-lg font-semibold text-gray-900">{jobName} — Run History</h3>
                    </div>
                    <button onClick={onClose} className="p-1 rounded hover:bg-gray-100">
                        <X size={18} className="text-gray-500" />
                    </button>
                </div>

                {/* Content */}
                <div className="flex-1 overflow-auto p-5">
                    {isLoading && (
                        <div className="flex justify-center py-8">
                            <RefreshCw size={24} className="animate-spin text-gray-400" />
                        </div>
                    )}

                    {!isLoading && (!data || data.runs.length === 0) && (
                        <p className="text-center text-gray-500 py-8">No run history yet.</p>
                    )}

                    {!isLoading && data && data.runs.length > 0 && (
                        <table className="w-full text-sm">
                            <thead>
                                <tr className="text-left text-xs text-gray-500 border-b">
                                    <th className="pb-2 font-medium">Time</th>
                                    <th className="pb-2 font-medium">Duration</th>
                                    <th className="pb-2 font-medium">Status</th>
                                    <th className="pb-2 font-medium">Trigger</th>
                                    <th className="pb-2 font-medium">Details</th>
                                </tr>
                            </thead>
                            <tbody>
                                {data.runs.map((run: WorkerRunEntry) => (
                                    <RunRow key={run.id} run={run} formatRelativeTime={formatRelativeTime} formatDuration={formatDuration} />
                                ))}
                            </tbody>
                        </table>
                    )}
                </div>
            </div>
        </div>
    );
}

function RunRow({ run, formatRelativeTime, formatDuration }: {
    run: WorkerRunEntry;
    formatRelativeTime: (t: string) => string;
    formatDuration: (ms: number | null) => string;
}) {
    const [expanded, setExpanded] = useState(false);

    return (
        <>
            <tr
                className="border-b border-gray-100 hover:bg-gray-50 cursor-pointer"
                onClick={() => setExpanded(!expanded)}
            >
                <td className="py-2 text-gray-700">{formatRelativeTime(run.startedAt)}</td>
                <td className="py-2 text-gray-600 tabular-nums">{formatDuration(run.durationMs)}</td>
                <td className="py-2">
                    <span className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-xs font-medium ${
                        run.status === 'completed' ? 'bg-green-100 text-green-700' :
                        run.status === 'failed' ? 'bg-red-100 text-red-700' :
                        'bg-blue-100 text-blue-700'
                    }`}>
                        {run.status === 'completed' ? <CheckCircle size={10} /> :
                         run.status === 'failed' ? <XCircle size={10} /> :
                         <RefreshCw size={10} className="animate-spin" />}
                        {run.status}
                    </span>
                </td>
                <td className="py-2">
                    <span className={`text-xs px-1.5 py-0.5 rounded ${
                        run.triggeredBy === 'manual' ? 'bg-purple-100 text-purple-700' :
                        run.triggeredBy === 'startup' ? 'bg-amber-100 text-amber-700' :
                        'bg-gray-100 text-gray-600'
                    }`}>
                        {run.triggeredBy}
                    </span>
                </td>
                <td className="py-2 text-gray-400 text-xs">
                    {(run.result || run.error) ? '▸' : '—'}
                </td>
            </tr>
            {expanded && (run.result || run.error) && (
                <tr>
                    <td colSpan={5} className="bg-gray-50 px-3 py-2">
                        {run.error && (
                            <div className="text-xs text-red-600 mb-1">
                                <span className="font-medium">Error:</span> {run.error}
                            </div>
                        )}
                        {run.result && (
                            <pre className="text-xs text-gray-600 whitespace-pre-wrap overflow-auto max-h-40">
                                {JSON.stringify(run.result, null, 2)}
                            </pre>
                        )}
                    </td>
                </tr>
            )}
        </>
    );
}

// ============================================
// SUCCESS RATE BADGE
// ============================================

function SuccessRateBadge({ summary }: { summary: WorkerRunSummaryEntry | undefined }) {
    if (!summary || summary.last24h.total === 0) return null;

    const { succeeded, failed, total } = summary.last24h;
    const allGood = failed === 0;
    const someFailed = failed > 0 && succeeded > 0;

    return (
        <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium ${
            allGood ? 'bg-green-100 text-green-700' :
            someFailed ? 'bg-amber-100 text-amber-700' :
            'bg-red-100 text-red-700'
        }`}>
            24h: {succeeded}/{total}
        </span>
    );
}

// ============================================
// MAIN COMPONENT
// ============================================

export function BackgroundJobsTab() {
    const queryClient = useQueryClient();
    const [expandedJob, setExpandedJob] = useState<string | null>(null);
    const [confirmJob, setConfirmJob] = useState<{ id: string; name: string } | null>(null);
    const [historyJob, setHistoryJob] = useState<{ workerName: string; jobName: string } | null>(null);

    // Server Function wrappers
    const getBackgroundJobsFn = useServerFn(getBackgroundJobs);
    const startBackgroundJobFn = useServerFn(startBackgroundJob);
    const updateBackgroundJobFn = useServerFn(updateBackgroundJob);
    const getWorkerRunSummaryFn = useServerFn(getWorkerRunSummary);

    // Fetch jobs status
    const { data, isLoading, refetch } = useQuery({
        queryKey: ['backgroundJobs'],
        queryFn: async (): Promise<JobsResponse> => {
            const result = await getBackgroundJobsFn();
            if (!result.success) throw new Error(result.error?.message);
            return { jobs: result.data || [] };
        },
        refetchInterval: 10000,
    });

    // Fetch worker run summary
    const { data: summaryData } = useQuery({
        queryKey: ['workerRunSummary'],
        queryFn: async () => {
            const result = await getWorkerRunSummaryFn();
            if (!result.success) return {};
            return result.data || {};
        },
        refetchInterval: 30000,
    });

    // Filter out sheet jobs
    const visibleJobs = data?.jobs.filter(j => !SHEET_JOB_IDS.has(j.id)) ?? [];

    // Trigger job mutation
    const triggerMutation = useMutation({
        mutationFn: async (jobId: string) => {
            const result = await startBackgroundJobFn({
                data: { jobId: jobId as 'shopify_sync' | 'tracking_sync' | 'cache_cleanup' },
            });
            if (!result.success) throw new Error(result.error?.message);
            return result.data;
        },
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ['backgroundJobs'] });
            queryClient.invalidateQueries({ queryKey: ['workerRunSummary'] });
        },
    });

    // Update job settings mutation
    const updateMutation = useMutation({
        mutationFn: async ({ jobId, enabled }: { jobId: string; enabled: boolean }) => {
            const result = await updateBackgroundJobFn({
                data: { jobId, enabled },
            });
            if (!result.success) throw new Error(result.error?.message);
            return result.data;
        },
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ['backgroundJobs'] });
        },
    });

    const getJobIcon = (jobId: string) => {
        switch (jobId) {
            case 'shopify_sync':
                return <Store size={20} className="text-green-600" />;
            case 'tracking_sync':
                return <Truck size={20} className="text-blue-600" />;
            case 'cache_cleanup':
                return <Trash2 size={20} className="text-orange-600" />;
            case 'auto_archive':
                return <Archive size={20} className="text-purple-600" />;
            default:
                return <RefreshCw size={20} className="text-gray-600" />;
        }
    };

    const formatLastRun = (timestamp: string | null | undefined) => {
        if (!timestamp) return 'Never';
        const date = new Date(timestamp);
        const now = new Date();
        const diffMs = now.getTime() - date.getTime();
        const diffMins = Math.floor(diffMs / 60000);
        const diffHours = Math.floor(diffMins / 60);

        if (diffMins < 1) return 'Just now';
        if (diffMins < 60) return `${diffMins} min ago`;
        if (diffHours < 24) return `${diffHours} hour${diffHours > 1 ? 's' : ''} ago`;
        return date.toLocaleString();
    };

    const getNextRun = (job: BackgroundJob) => {
        if (!job.lastRunAt || !job.intervalMinutes) return null;
        const lastRun = new Date(job.lastRunAt);
        const nextRun = new Date(lastRun.getTime() + job.intervalMinutes * 60000);
        return nextRun;
    };

    const renderJobResult = (job: BackgroundJob) => {
        const result = job.lastResult;
        if (!result) return null;

        switch (job.id) {
            case 'shopify_sync':
                return <ShopifySyncResultCard result={result as unknown as ShopifySyncResult} />;
            case 'tracking_sync':
                return <TrackingSyncResultCard result={result as unknown as TrackingSyncResult} />;
            case 'cache_cleanup':
                return <CacheCleanupResultCard result={result as unknown as CacheCleanupResult} stats={job.stats as unknown as CacheStats | undefined} />;
            default:
                return null;
        }
    };

    const getConfirmMessage = (jobId: string): string => {
        switch (jobId) {
            case 'shopify_sync':
                return 'This will fetch recent orders from Shopify and process any that are new or updated.';
            case 'tracking_sync':
                return 'This will check tracking status for all active shipments via iThink Logistics API.';
            default:
                return 'Are you sure you want to run this job?';
        }
    };

    const handleRunClick = (job: BackgroundJob) => {
        if (job.id === 'shopify_sync' || job.id === 'tracking_sync') {
            setConfirmJob({ id: job.id, name: job.name });
        } else {
            triggerMutation.mutate(job.id);
        }
    };

    const getWorkerName = (jobId: string): string | null => {
        return JOB_TO_WORKER[jobId] ?? null;
    };

    return (
        <div className="space-y-6">
            {/* Header */}
            <div className="card">
                <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                        <RefreshCw size={20} className="text-primary-600" />
                        <h2 className="text-lg font-semibold">Background Jobs</h2>
                    </div>
                    <button
                        onClick={() => refetch()}
                        disabled={isLoading}
                        className="btn btn-secondary flex items-center gap-2"
                    >
                        <RefreshCw size={16} className={isLoading ? 'animate-spin' : ''} />
                        Refresh
                    </button>
                </div>
                <p className="mt-2 text-sm text-gray-600">
                    Monitor and control scheduled background tasks that keep your data synchronized.
                </p>
            </div>

            {/* Jobs List */}
            {isLoading && (
                <div className="card flex justify-center items-center py-12">
                    <RefreshCw size={32} className="animate-spin text-gray-400" />
                </div>
            )}

            {!isLoading && visibleJobs.map((job) => {
                const isExpanded = expandedJob === job.id;
                const nextRun = getNextRun(job);
                const canTrigger = !job.isRunning && job.id !== 'auto_archive';
                const canToggle = job.id === 'cache_cleanup';
                const workerName = getWorkerName(job.id);
                const summary = workerName && summaryData ? (summaryData as Record<string, WorkerRunSummaryEntry>)[workerName] : undefined;

                return (
                    <div key={job.id} className="card">
                        {/* Job Header */}
                        <div className="flex items-start gap-4">
                            {/* Icon */}
                            <div className="flex-shrink-0 w-12 h-12 rounded-lg bg-gray-100 flex items-center justify-center">
                                {getJobIcon(job.id)}
                            </div>

                            {/* Content */}
                            <div className="flex-1 min-w-0">
                                <div className="flex items-center gap-3 flex-wrap">
                                    <h3 className="text-lg font-semibold text-gray-900">{job.name}</h3>

                                    {/* Status Badges */}
                                    {job.isRunning && (
                                        <span className="inline-flex items-center gap-1 px-2 py-1 rounded-full text-xs font-medium bg-blue-100 text-blue-700">
                                            <RefreshCw size={12} className="animate-spin" />
                                            Running
                                        </span>
                                    )}
                                    {job.enabled && !job.isRunning && (
                                        <span className="inline-flex items-center gap-1 px-2 py-1 rounded-full text-xs font-medium bg-green-100 text-green-700">
                                            <CheckCircle size={12} />
                                            Active
                                        </span>
                                    )}
                                    {!job.enabled && (
                                        <span className="inline-flex items-center gap-1 px-2 py-1 rounded-full text-xs font-medium bg-gray-100 text-gray-600">
                                            <XCircle size={12} />
                                            Disabled
                                        </span>
                                    )}

                                    {/* Success rate badge */}
                                    <SuccessRateBadge summary={summary} />
                                </div>

                                <p className="mt-1 text-sm text-gray-600">{job.description}</p>

                                {/* Schedule Info */}
                                <div className="mt-2 flex flex-wrap items-center gap-4 text-xs text-gray-500">
                                    <span className="flex items-center gap-1">
                                        <Clock size={14} />
                                        {job.schedule || (job.intervalMinutes && `Every ${job.intervalMinutes} min`)}
                                    </span>
                                    <span>
                                        Last run: <span className="font-medium text-gray-700">{formatLastRun(job.lastRunAt)}</span>
                                    </span>
                                    {nextRun && !job.isRunning && (
                                        <span>
                                            Next run: <span className="font-medium text-gray-700">{nextRun.toLocaleTimeString()}</span>
                                        </span>
                                    )}
                                </div>

                                {/* Note */}
                                {job.note && (
                                    <p className="mt-2 text-xs text-amber-600 flex items-center gap-1">
                                        <AlertTriangle size={12} />
                                        {job.note}
                                    </p>
                                )}
                            </div>

                            {/* Actions */}
                            <div className="flex-shrink-0 flex items-center gap-2">
                                {canToggle && (
                                    <button
                                        onClick={() => updateMutation.mutate({ jobId: job.id, enabled: !job.enabled })}
                                        disabled={updateMutation.isPending}
                                        className={`btn ${job.enabled ? 'btn-secondary' : 'btn-primary'} text-sm`}
                                    >
                                        {job.enabled ? 'Disable' : 'Enable'}
                                    </button>
                                )}
                                {canTrigger && (
                                    <button
                                        onClick={() => handleRunClick(job)}
                                        disabled={triggerMutation.isPending}
                                        className="btn btn-primary flex items-center gap-1 text-sm"
                                    >
                                        <Play size={14} />
                                        Run Now
                                    </button>
                                )}
                                {workerName && (
                                    <button
                                        onClick={() => setHistoryJob({ workerName, jobName: job.name })}
                                        className="btn btn-secondary flex items-center gap-1 text-sm"
                                    >
                                        <History size={14} />
                                        History
                                    </button>
                                )}
                                <button
                                    onClick={() => setExpandedJob(isExpanded ? null : job.id)}
                                    className="btn btn-secondary text-sm"
                                >
                                    {isExpanded ? 'Hide Details' : 'Show Details'}
                                </button>
                            </div>
                        </div>

                        {/* Expanded Details */}
                        {isExpanded && (
                            <div className="mt-4 pt-4 border-t bg-gray-50 -mx-4 -mb-4 p-4 rounded-b-lg">
                                {/* Last Result */}
                                {job.lastResult && (
                                    <div>
                                        <p className="text-xs font-medium text-gray-700 mb-2">Last Run Result</p>
                                        {renderJobResult(job)}
                                    </div>
                                )}

                                {/* No results yet */}
                                {!job.lastResult && (
                                    <p className="text-sm text-gray-500">No results available yet. Run the job to see details.</p>
                                )}
                            </div>
                        )}
                    </div>
                );
            })}

            {/* Info Banner */}
            <div className="p-4 bg-blue-50 border border-blue-200 rounded-lg">
                <div className="flex items-start gap-3">
                    <Info size={20} className="text-blue-600 flex-shrink-0 mt-0.5" />
                    <div className="text-sm text-blue-800">
                        <p className="font-medium mb-1">About Background Jobs</p>
                        <ul className="list-disc list-inside space-y-1 text-xs">
                            <li><strong>Shopify Order Sync:</strong> Fetches recent orders from Shopify every 60 minutes to catch any missed webhooks. Looks back 24 hours.</li>
                            <li><strong>Tracking Status Sync:</strong> Updates delivery tracking every 30 minutes via iThink Logistics API. Handles deliveries and RTOs.</li>
                            <li><strong>Cache Cleanup:</strong> Removes old cache entries daily at 2 AM to prevent database bloat.</li>
                            <li><strong>Auto-Archive:</strong> Archives completed orders older than 90 days on server startup.</li>
                        </ul>
                        <p className="mt-2 text-xs text-blue-700">
                            Sheet offload jobs (Ingest Inward, Move Shipped, Ingest Outward) are managed in Settings &gt; Sheet Sync.
                        </p>
                    </div>
                </div>
            </div>

            {/* Confirm Modal for Run Now */}
            <ConfirmModal
                isOpen={confirmJob !== null}
                onClose={() => setConfirmJob(null)}
                onConfirm={() => {
                    if (confirmJob) triggerMutation.mutate(confirmJob.id);
                }}
                title={`Run ${confirmJob?.name ?? 'Job'}?`}
                message={confirmJob ? getConfirmMessage(confirmJob.id) : ''}
                confirmText="Run Now"
                confirmVariant="warning"
                isLoading={triggerMutation.isPending}
            />

            {/* History Dialog */}
            {historyJob && (
                <WorkerHistoryDialog
                    workerName={historyJob.workerName}
                    jobName={historyJob.jobName}
                    onClose={() => setHistoryJob(null)}
                />
            )}
        </div>
    );
}

export default BackgroundJobsTab;
