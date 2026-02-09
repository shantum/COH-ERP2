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
    Store, Truck, Trash2, Archive, AlertTriangle,
} from 'lucide-react';

// Server Functions
import {
    getBackgroundJobs,
    startBackgroundJob,
    updateBackgroundJob,
    type BackgroundJob,
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

interface JobsResponse {
    jobs: BackgroundJob[];
}

export function BackgroundJobsTab() {
    const queryClient = useQueryClient();
    const [expandedJob, setExpandedJob] = useState<string | null>(null);
    const [confirmJob, setConfirmJob] = useState<{ id: string; name: string } | null>(null);

    // Server Function wrappers
    const getBackgroundJobsFn = useServerFn(getBackgroundJobs);
    const startBackgroundJobFn = useServerFn(startBackgroundJob);
    const updateBackgroundJobFn = useServerFn(updateBackgroundJob);

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
        </div>
    );
}

export default BackgroundJobsTab;
