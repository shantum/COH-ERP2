/**
 * SystemStatusCard - Background worker sync status at a glance
 *
 * Shows each worker's name, status indicator, and relative last-sync time.
 * Green = running & recently synced, yellow = running but stale, red = error.
 */

import { useQuery } from '@tanstack/react-query';
import { getWorkerStatuses } from '../../server/functions/dashboard';
import type { WorkerStatusItem } from '../../server/functions/dashboard';
import { Activity, AlertCircle, RefreshCcw } from 'lucide-react';

function getRelativeTime(dateStr: string | null): string {
    if (!dateStr) return 'never';
    const now = Date.now();
    const then = new Date(dateStr).getTime();
    const diffMs = now - then;

    if (diffMs < 0) return 'just now';
    if (diffMs < 60_000) return `${Math.floor(diffMs / 1000)}s ago`;
    if (diffMs < 3_600_000) return `${Math.floor(diffMs / 60_000)}m ago`;
    if (diffMs < 86_400_000) return `${Math.floor(diffMs / 3_600_000)}h ago`;
    return `${Math.floor(diffMs / 86_400_000)}d ago`;
}

type StatusColor = 'green' | 'yellow' | 'red' | 'gray';

function getStatusColor(worker: WorkerStatusItem): StatusColor {
    if (worker.lastError) return 'red';
    if (worker.isRunning) return 'green';
    if (!worker.schedulerActive && worker.interval !== 'manual' && worker.interval !== 'on-demand') return 'gray';
    if (!worker.lastSyncAt) return 'gray';

    // Check staleness based on interval
    const now = Date.now();
    const lastSync = new Date(worker.lastSyncAt).getTime();
    const staleMs = now - lastSync;

    // Stale if more than 2x the expected interval
    if (worker.interval.endsWith('m')) {
        const minutes = parseInt(worker.interval);
        if (staleMs > minutes * 2 * 60_000) return 'yellow';
    } else if (worker.interval.endsWith('s')) {
        const seconds = parseInt(worker.interval);
        if (staleMs > seconds * 4 * 1000) return 'yellow';
    }

    return 'green';
}

const STATUS_DOT: Record<StatusColor, string> = {
    green: 'bg-emerald-400',
    yellow: 'bg-amber-400',
    red: 'bg-red-400',
    gray: 'bg-gray-300',
};

function WorkerRow({ worker }: { worker: WorkerStatusItem }) {
    const color = getStatusColor(worker);

    return (
        <div className="flex items-center justify-between py-1.5 px-1">
            <div className="flex items-center gap-2 min-w-0">
                <span className={`w-2 h-2 rounded-full flex-shrink-0 ${STATUS_DOT[color]} ${worker.isRunning ? 'animate-pulse' : ''}`} />
                <span className="text-sm text-gray-700 truncate">{worker.name}</span>
            </div>
            <div className="flex items-center gap-2 flex-shrink-0">
                {worker.lastError && (
                    <span className="text-[10px] text-red-500 max-w-[80px] truncate" title={worker.lastError}>
                        error
                    </span>
                )}
                <span className="text-xs text-gray-400 tabular-nums w-16 text-right">
                    {worker.isRunning ? (
                        <span className="text-emerald-500 font-medium">syncing</span>
                    ) : (
                        getRelativeTime(worker.lastSyncAt)
                    )}
                </span>
            </div>
        </div>
    );
}

export function SystemStatusCard() {
    const { data, isLoading, error, refetch } = useQuery({
        queryKey: ['dashboard', 'workerStatus'],
        queryFn: () => getWorkerStatuses(),
        refetchInterval: 30_000,
        staleTime: 15_000,
    });

    // Only show scheduled/important workers (skip manual/on-demand unless they ran recently)
    const workers = data?.workers ?? [];
    const activeWorkers = workers.filter((w) => {
        if (w.schedulerActive) return true;
        if (w.lastSyncAt) return true;
        return false;
    });

    return (
        <div className="bg-white rounded-lg border border-gray-200 p-3 sm:p-4 shadow-sm">
            <div className="flex items-center justify-between mb-2 sm:mb-3">
                <div className="flex items-center gap-2">
                    <Activity className="w-4 h-4 sm:w-5 sm:h-5 text-gray-400" />
                    <h2 className="text-base sm:text-lg font-semibold">System Status</h2>
                </div>
                <button
                    onClick={() => refetch()}
                    className="p-1 text-gray-400 hover:text-gray-600 transition-colors"
                    title="Refresh"
                >
                    <RefreshCcw className="w-3.5 h-3.5" />
                </button>
            </div>

            {error ? (
                <div className="py-4 text-center">
                    <AlertCircle className="w-6 h-6 text-red-400 mx-auto mb-1" />
                    <p className="text-gray-500 text-xs">Failed to load status</p>
                </div>
            ) : isLoading ? (
                <div className="space-y-2">
                    {[...Array(4)].map((_, i) => (
                        <div key={i} className="h-7 bg-gray-50 rounded" />
                    ))}
                </div>
            ) : activeWorkers.length === 0 ? (
                <p className="text-gray-400 text-sm text-center py-4">No workers running</p>
            ) : (
                <div className="divide-y divide-gray-50">
                    {activeWorkers.map((worker) => (
                        <WorkerRow key={worker.id} worker={worker} />
                    ))}
                </div>
            )}
        </div>
    );
}
