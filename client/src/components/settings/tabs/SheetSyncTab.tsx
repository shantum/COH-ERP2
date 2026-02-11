/**
 * SheetSyncTab component
 *
 * Allows admins to sync ERP state from Google Sheets.
 * Supports CSV file upload and direct Google Sheets URL fetch.
 * Shows a dry-run preview, then executes in background with progress polling.
 */

import React, { useState, useCallback, useRef, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useServerFn } from '@tanstack/react-start';
import {
    Upload, Link, Play, CheckCircle, XCircle, Loader2,
    FileSpreadsheet, AlertTriangle, ChevronDown, ChevronRight,
    RotateCcw, Info, RefreshCw, Database,
} from 'lucide-react';

import { planSyncFromSheet, executeSyncJob, getSyncJobStatus } from '../../../server/functions/sheetSync';
import {
    startBackgroundJob,
    getSheetOffloadStatus,
} from '../../../server/functions/admin';
import type { OffloadStatusResponse, IngestInwardResult, IngestOutwardResult, IngestPreviewResult, MoveShippedResult, CleanupDoneResult, MigrateFormulasResult, PushBalancesPreviewResult } from '../jobs/sheetJobTypes';
import { IngestInwardResultCard, IngestOutwardResultCard, IngestPreviewCard, MoveShippedResultCard, CleanupDoneResultCard, MigrateFormulasResultCard, PushBalancesPreviewCard } from '../jobs/JobResultCards';
import ConfirmModal from '../../common/ConfirmModal';

// ============================================
// TYPES (matching server types)
// ============================================

interface StepResult {
    stepIndex: number;
    stepName: string;
    status: 'pending' | 'running' | 'completed' | 'failed';
    summary: string;
    errors: string[];
}

interface PlanStep {
    stepIndex: number;
    stepName: string;
    summary: string;
    details: Record<string, unknown>;
}

interface PlanReport {
    parseSummary: {
        orderRows: number;
        uniqueOrders: number;
        inventoryRows: number;
    };
    steps: PlanStep[];
}

interface SheetSyncJob {
    id: string;
    status: 'planning' | 'planned' | 'executing' | 'completed' | 'failed';
    startedAt: string;
    completedAt: string | null;
    userId: string;
    planReport: PlanReport | null;
    currentStep: number;
    stepResults: StepResult[];
    errors: string[];
}

type InputMode = 'file' | 'sheet';

// ============================================
// HELPERS
// ============================================

function getApiBaseUrl(): string {
    return typeof window !== 'undefined' ? '' : 'http://localhost:3001';
}

function getStepIcon(status: StepResult['status']) {
    switch (status) {
        case 'completed': return <CheckCircle size={16} className="text-green-600" />;
        case 'failed': return <XCircle size={16} className="text-red-600" />;
        case 'running': return <Loader2 size={16} className="text-blue-600 animate-spin" />;
        default: return <div className="w-4 h-4 rounded-full border-2 border-gray-300" />;
    }
}

// ============================================
// SUB-COMPONENTS
// ============================================

const PlanStepCard = React.memo(function PlanStepCard({ step }: { step: PlanStep }) {
    const [expanded, setExpanded] = useState(false);
    const detailEntries = Object.entries(step.details);

    return (
        <div className="border rounded-lg p-3">
            <button
                className="flex items-center gap-2 w-full text-left"
                onClick={() => setExpanded(!expanded)}
            >
                {expanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                <span className="font-medium text-sm">Step {step.stepIndex + 2}: {step.stepName}</span>
                <span className="text-gray-500 text-xs ml-auto">{step.summary}</span>
            </button>
            {expanded && detailEntries.length > 0 && (
                <div className="mt-2 pl-6 text-xs text-gray-600 space-y-1">
                    {detailEntries.map(([key, value]) => (
                        <div key={key}>
                            <span className="font-medium">{key}:</span> {String(value)}
                        </div>
                    ))}
                </div>
            )}
        </div>
    );
});

const ExecutionProgress = React.memo(function ExecutionProgress({
    stepResults,
}: {
    stepResults: StepResult[];
}) {
    return (
        <div className="space-y-2">
            {stepResults.map((step) => (
                <div key={step.stepIndex} className="flex items-start gap-2 py-1">
                    {getStepIcon(step.status)}
                    <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                            <span className="text-sm font-medium">
                                Step {step.stepIndex + 2}: {step.stepName}
                            </span>
                            {step.status === 'running' && (
                                <span className="text-xs text-blue-600">Running...</span>
                            )}
                        </div>
                        {step.summary && (
                            <p className="text-xs text-gray-500 mt-0.5">{step.summary}</p>
                        )}
                        {step.errors.length > 0 && (
                            <div className="mt-1 space-y-0.5">
                                {step.errors.slice(0, 3).map((err, i) => (
                                    <p key={i} className="text-xs text-red-600">{err}</p>
                                ))}
                                {step.errors.length > 3 && (
                                    <p className="text-xs text-red-400">
                                        ...and {step.errors.length - 3} more errors
                                    </p>
                                )}
                            </div>
                        )}
                    </div>
                </div>
            ))}
        </div>
    );
});

// ============================================
// OFFLOAD WORKER MONITOR
// ============================================

type OffloadJobId = 'ingest_inward' | 'ingest_outward' | 'move_shipped_to_outward' | 'cleanup_done_rows' | 'migrate_sheet_formulas' | 'push_balances' | 'push_fabric_balances' | 'import_fabric_balances';

const OFFLOAD_JOB_CONFIRM_MESSAGES: Record<OffloadJobId, string> = {
    ingest_inward: 'This will create inventory transactions from Inward (Live) buffer rows and mark them as DONE.',
    move_shipped_to_outward: 'This will copy shipped orders from Orders from COH to the Outward (Live) buffer tab.',
    ingest_outward: 'This will create inventory transactions from Outward (Live) buffer rows and mark them as DONE.',
    cleanup_done_rows: 'This will delete DONE rows older than 7 days from both live tabs. Safe — only removes already-ingested rows.',
    migrate_sheet_formulas: 'This will rewrite Inventory col C and Balance (Final) col E formulas to exclude DONE rows. Safe to re-run.',
    push_balances: 'This will push all current ERP balances to Mastersheet Inventory col R and Office Ledger Balance (Final) col F. No ingestion — just a balance sync.',
    push_fabric_balances: 'This will refresh the Fabric Balances sheet with latest system balances and any new fabric colours. Preserves physical counts already entered.',
    import_fabric_balances: 'This will read Physical Count values from the Fabric Balances sheet and create adjustment transactions to match. Only rows with counts filled (not already DONE) will be processed.',
};

const OffloadMonitor = React.memo(function OffloadMonitor() {
    const queryClient = useQueryClient();
    const triggerFn = useServerFn(startBackgroundJob);
    const getStatusFn = useServerFn(getSheetOffloadStatus);

    const [expandedJob, setExpandedJob] = useState<string | null>(null);
    const [confirmAction, setConfirmAction] = useState<{ jobId: OffloadJobId; jobName: string } | null>(null);

    const { data: offloadStatus, isLoading, isFetching, refetch } = useQuery({
        queryKey: ['sheetOffloadDetailedStatus'],
        queryFn: async (): Promise<OffloadStatusResponse | null> => {
            const result = await getStatusFn();
            if (!result.success) return null;
            return result.data as unknown as OffloadStatusResponse;
        },
        refetchInterval: 15000,
    });

    // Preview mutations — triggered by clicking "Preview" button
    const inwardPreviewMutation = useMutation({
        mutationFn: async (): Promise<IngestPreviewResult | null> => {
            const result = await triggerFn({ data: { jobId: 'preview_ingest_inward' } });
            if (!result.success) return null;
            return (result.data?.result as unknown as IngestPreviewResult) ?? null;
        },
    });

    const outwardPreviewMutation = useMutation({
        mutationFn: async (): Promise<IngestPreviewResult | null> => {
            const result = await triggerFn({ data: { jobId: 'preview_ingest_outward' } });
            if (!result.success) return null;
            return (result.data?.result as unknown as IngestPreviewResult) ?? null;
        },
    });

    const pushBalancesPreviewMutation = useMutation({
        mutationFn: async (): Promise<PushBalancesPreviewResult | null> => {
            const result = await triggerFn({ data: { jobId: 'preview_push_balances' } });
            if (!result.success) return null;
            return (result.data?.result as unknown as PushBalancesPreviewResult) ?? null;
        },
    });

    const inwardPreview = inwardPreviewMutation.data ?? null;
    const outwardPreview = outwardPreviewMutation.data ?? null;
    const pushBalancesPreview = pushBalancesPreviewMutation.data ?? null;

    // Single generic trigger mutation
    const triggerMutation = useMutation({
        mutationFn: async (jobId: OffloadJobId) => {
            const result = await triggerFn({
                data: { jobId },
            });
            if (!result.success) throw new Error(result.error?.message);
            return result.data;
        },
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ['sheetOffloadDetailedStatus'] });
            // Clear stale preview data after running a job
            inwardPreviewMutation.reset();
            outwardPreviewMutation.reset();
            pushBalancesPreviewMutation.reset();
        },
    });

    const formatDuration = (ms: number) => {
        if (ms < 1000) return `${ms}ms`;
        if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`;
        return `${(ms / 60000).toFixed(1)}m`;
    };

    const formatTime = (ts: string | Date | null | undefined) => {
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
    };

    const getConfirmMessage = (jobId: OffloadJobId): string => {
        const base = OFFLOAD_JOB_CONFIRM_MESSAGES[jobId];
        if (jobId === 'ingest_inward' && inwardPreview) {
            const { valid, invalid } = inwardPreview;
            return `This will ingest ${valid} valid row${valid !== 1 ? 's' : ''} into inventory` +
                (invalid > 0 ? ` (${invalid} invalid will be skipped)` : '') +
                '. Create inventory transactions?';
        }
        if (jobId === 'ingest_outward' && outwardPreview) {
            const { valid, invalid } = outwardPreview;
            return `This will ingest ${valid} valid row${valid !== 1 ? 's' : ''} into inventory` +
                (invalid > 0 ? ` (${invalid} invalid will be skipped)` : '') +
                '. Create inventory transactions and link orders?';
        }
        if (jobId === 'push_balances' && pushBalancesPreview) {
            const { wouldChange, alreadyCorrect } = pushBalancesPreview;
            return `${wouldChange} cell${wouldChange !== 1 ? 's' : ''} will be updated across both sheets` +
                ` (${alreadyCorrect} already correct). Push balances now?`;
        }
        return base;
    };

    const handleRunClick = (jobId: OffloadJobId, jobName: string) => {
        setConfirmAction({ jobId, jobName });
    };

    if (isLoading) {
        return (
            <div className="card flex items-center gap-2 text-gray-400 py-6 justify-center">
                <Loader2 size={16} className="animate-spin" /> Loading offload status...
            </div>
        );
    }

    if (!offloadStatus) return null;

    const anyRunning = offloadStatus.ingestInward.isRunning || offloadStatus.ingestOutward.isRunning || offloadStatus.moveShipped.isRunning;

    return (
        <div className="card space-y-4">
            {/* Header */}
            <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                    <div className="w-10 h-10 rounded-lg bg-emerald-100 flex items-center justify-center">
                        <Database size={18} className="text-emerald-600" />
                    </div>
                    <div>
                        <div className="flex items-center gap-2">
                            <h3 className="font-semibold text-gray-900">Sheet Offload Jobs</h3>
                            {offloadStatus.schedulerActive && !anyRunning && (
                                <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-green-100 text-green-700">
                                    <CheckCircle size={10} /> Active
                                </span>
                            )}
                            {anyRunning && (
                                <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-blue-100 text-blue-700">
                                    <RefreshCw size={10} className="animate-spin" /> Running
                                </span>
                            )}
                        </div>
                        <p className="text-xs text-gray-500 mt-0.5">
                            3 independent jobs: Ingest Inward, Move Shipped, Ingest Outward
                        </p>
                    </div>
                </div>

                <button
                    onClick={() => refetch()}
                    disabled={isFetching}
                    className="btn btn-secondary text-xs py-1 px-2"
                >
                    <RefreshCw size={12} className={isFetching ? 'animate-spin' : ''} />
                </button>
            </div>

            {/* Buffer Counts */}
            <div className="grid grid-cols-2 md:grid-cols-3 gap-3 text-xs">
                <div className="bg-emerald-50 rounded-lg p-2.5">
                    <p className="text-gray-500">Inward Pending</p>
                    <p className="font-medium text-emerald-700">
                        {offloadStatus.bufferCounts.inward >= 0
                            ? `${offloadStatus.bufferCounts.inward} rows`
                            : '—'}
                    </p>
                </div>
                <div className="bg-blue-50 rounded-lg p-2.5">
                    <p className="text-gray-500">Outward Pending</p>
                    <p className="font-medium text-blue-700">
                        {offloadStatus.bufferCounts.outward >= 0
                            ? `${offloadStatus.bufferCounts.outward} rows`
                            : '—'}
                    </p>
                </div>
                <div className="bg-gray-50 rounded-lg p-2.5">
                    <p className="text-gray-500">Scheduler</p>
                    <p className="font-medium text-gray-900">{offloadStatus.schedulerActive ? 'Active' : 'Stopped'}</p>
                </div>
            </div>

            {/* Per-Job Summary */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                {/* Ingest Inward */}
                <div className="border rounded-lg p-3 space-y-2">
                    <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2">
                            <span className="text-sm font-medium text-gray-900">Ingest Inward</span>
                            {offloadStatus.ingestInward.isRunning && (
                                <RefreshCw size={12} className="animate-spin text-blue-600" />
                            )}
                        </div>
                        <div className="flex items-center gap-1">
                            <button
                                onClick={() => inwardPreviewMutation.mutate()}
                                disabled={offloadStatus.ingestInward.isRunning || inwardPreviewMutation.isPending}
                                className="btn btn-secondary text-xs py-0.5 px-2 flex items-center gap-1"
                            >
                                {inwardPreviewMutation.isPending ? <Loader2 size={10} className="animate-spin" /> : <FileSpreadsheet size={10} />} Preview
                            </button>
                            <button
                                onClick={() => handleRunClick('ingest_inward', 'Ingest Inward')}
                                disabled={offloadStatus.ingestInward.isRunning || triggerMutation.isPending}
                                className="btn btn-primary text-xs py-0.5 px-2 flex items-center gap-1"
                            >
                                <Play size={10} /> Run
                            </button>
                        </div>
                    </div>
                    <div className="text-xs text-gray-500">
                        Last: {formatTime(offloadStatus.ingestInward.lastRunAt)}
                        {offloadStatus.ingestInward.lastResult && (
                            <span className="ml-2 text-emerald-600 font-medium">
                                +{(offloadStatus.ingestInward.lastResult as Record<string, number>).inwardIngested ?? 0}
                            </span>
                        )}
                        {offloadStatus.ingestInward.lastResult?.durationMs != null && (
                            <span className="ml-1 text-gray-400">
                                ({formatDuration(Number(offloadStatus.ingestInward.lastResult.durationMs))})
                            </span>
                        )}
                    </div>
                    {/* Preview result */}
                    {inwardPreview && <IngestPreviewCard preview={inwardPreview} />}
                    {/* Expandable detail */}
                    {offloadStatus.ingestInward.lastResult && (
                        <button
                            onClick={() => setExpandedJob(expandedJob === 'ingest_inward' ? null : 'ingest_inward')}
                            className="text-xs text-blue-600 hover:text-blue-800 flex items-center gap-1"
                        >
                            {expandedJob === 'ingest_inward' ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
                            Details
                        </button>
                    )}
                    {expandedJob === 'ingest_inward' && offloadStatus.ingestInward.lastResult && (
                        <IngestInwardResultCard result={offloadStatus.ingestInward.lastResult as unknown as IngestInwardResult} />
                    )}
                </div>

                {/* Move Shipped */}
                <div className="border rounded-lg p-3 space-y-2">
                    <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2">
                            <span className="text-sm font-medium text-gray-900">Move Shipped</span>
                            {offloadStatus.moveShipped.isRunning && (
                                <RefreshCw size={12} className="animate-spin text-blue-600" />
                            )}
                        </div>
                        <button
                            onClick={() => handleRunClick('move_shipped_to_outward', 'Move Shipped')}
                            disabled={offloadStatus.moveShipped.isRunning || triggerMutation.isPending}
                            className="btn btn-primary text-xs py-0.5 px-2 flex items-center gap-1"
                        >
                            <Play size={10} /> Run
                        </button>
                    </div>
                    <div className="text-xs text-gray-500">
                        Last: {formatTime(offloadStatus.moveShipped.lastRunAt)}
                        {offloadStatus.moveShipped.lastResult && (
                            <span className="ml-2 text-amber-600 font-medium">
                                {(offloadStatus.moveShipped.lastResult as Record<string, number>).rowsWrittenToOutward ?? 0} moved
                            </span>
                        )}
                    </div>
                    {/* Expandable detail */}
                    {offloadStatus.moveShipped.lastResult && (
                        <button
                            onClick={() => setExpandedJob(expandedJob === 'move_shipped' ? null : 'move_shipped')}
                            className="text-xs text-blue-600 hover:text-blue-800 flex items-center gap-1"
                        >
                            {expandedJob === 'move_shipped' ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
                            Details
                        </button>
                    )}
                    {expandedJob === 'move_shipped' && offloadStatus.moveShipped.lastResult && (
                        <MoveShippedResultCard result={offloadStatus.moveShipped.lastResult as unknown as MoveShippedResult} />
                    )}
                </div>

                {/* Ingest Outward */}
                <div className="border rounded-lg p-3 space-y-2">
                    <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2">
                            <span className="text-sm font-medium text-gray-900">Ingest Outward</span>
                            {offloadStatus.ingestOutward.isRunning && (
                                <RefreshCw size={12} className="animate-spin text-blue-600" />
                            )}
                        </div>
                        <div className="flex items-center gap-1">
                            <button
                                onClick={() => outwardPreviewMutation.mutate()}
                                disabled={offloadStatus.ingestOutward.isRunning || outwardPreviewMutation.isPending}
                                className="btn btn-secondary text-xs py-0.5 px-2 flex items-center gap-1"
                            >
                                {outwardPreviewMutation.isPending ? <Loader2 size={10} className="animate-spin" /> : <FileSpreadsheet size={10} />} Preview
                            </button>
                            <button
                                onClick={() => handleRunClick('ingest_outward', 'Ingest Outward')}
                                disabled={offloadStatus.ingestOutward.isRunning || triggerMutation.isPending}
                                className="btn btn-primary text-xs py-0.5 px-2 flex items-center gap-1"
                            >
                                <Play size={10} /> Run
                            </button>
                        </div>
                    </div>
                    <div className="text-xs text-gray-500">
                        Last: {formatTime(offloadStatus.ingestOutward.lastRunAt)}
                        {offloadStatus.ingestOutward.lastResult && (
                            <span className="ml-2 text-blue-600 font-medium">
                                +{(offloadStatus.ingestOutward.lastResult as Record<string, number>).outwardIngested ?? 0}
                            </span>
                        )}
                        {offloadStatus.ingestOutward.lastResult?.durationMs != null && (
                            <span className="ml-1 text-gray-400">
                                ({formatDuration(Number(offloadStatus.ingestOutward.lastResult.durationMs))})
                            </span>
                        )}
                    </div>
                    {/* Preview result */}
                    {outwardPreview && <IngestPreviewCard preview={outwardPreview} />}
                    {/* Expandable detail */}
                    {offloadStatus.ingestOutward.lastResult && (
                        <button
                            onClick={() => setExpandedJob(expandedJob === 'ingest_outward' ? null : 'ingest_outward')}
                            className="text-xs text-blue-600 hover:text-blue-800 flex items-center gap-1"
                        >
                            {expandedJob === 'ingest_outward' ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
                            Details
                        </button>
                    )}
                    {expandedJob === 'ingest_outward' && offloadStatus.ingestOutward.lastResult && (
                        <IngestOutwardResultCard result={offloadStatus.ingestOutward.lastResult as unknown as IngestOutwardResult} />
                    )}
                </div>
            </div>

            {/* --- Maintenance Jobs --- */}
            <div className="border-t pt-3 mt-3">
                <p className="text-xs font-medium text-gray-500 mb-2">Maintenance</p>
                <div className="flex gap-2 flex-wrap">
                    <button
                        onClick={() => handleRunClick('cleanup_done_rows', 'Cleanup DONE Rows')}
                        disabled={triggerMutation.isPending || offloadStatus.cleanupDone?.isRunning}
                        className="px-2.5 py-1.5 text-xs bg-gray-100 hover:bg-gray-200 text-gray-700 rounded border disabled:opacity-50"
                    >
                        {offloadStatus.cleanupDone?.isRunning ? 'Cleaning...' : 'Cleanup DONE Rows'}
                    </button>
                    <button
                        onClick={() => handleRunClick('migrate_sheet_formulas', 'Migrate Formulas')}
                        disabled={triggerMutation.isPending || offloadStatus.migrateFormulas?.isRunning}
                        className="px-2.5 py-1.5 text-xs bg-gray-100 hover:bg-gray-200 text-gray-700 rounded border disabled:opacity-50"
                    >
                        {offloadStatus.migrateFormulas?.isRunning ? 'Migrating...' : 'Migrate Formulas'}
                    </button>
                    <button
                        onClick={() => pushBalancesPreviewMutation.mutate()}
                        disabled={pushBalancesPreviewMutation.isPending || offloadStatus.pushBalances?.isRunning}
                        className="px-2.5 py-1.5 text-xs bg-gray-100 hover:bg-gray-200 text-gray-700 rounded border disabled:opacity-50 flex items-center gap-1"
                    >
                        {pushBalancesPreviewMutation.isPending ? <Loader2 size={10} className="animate-spin" /> : <FileSpreadsheet size={10} />}
                        Preview Balances
                    </button>
                    <button
                        onClick={() => handleRunClick('push_balances', 'Push Balances to Sheets')}
                        disabled={triggerMutation.isPending || offloadStatus.pushBalances?.isRunning}
                        className="px-2.5 py-1.5 text-xs bg-emerald-100 hover:bg-emerald-200 text-emerald-700 rounded border disabled:opacity-50"
                    >
                        {offloadStatus.pushBalances?.isRunning ? 'Pushing...' : 'Push Balances'}
                    </button>
                    <button
                        onClick={() => handleRunClick('push_fabric_balances', 'Push Fabric Balances to Sheet')}
                        disabled={triggerMutation.isPending || offloadStatus.pushFabricBalances?.isRunning}
                        className="px-2.5 py-1.5 text-xs bg-violet-100 hover:bg-violet-200 text-violet-700 rounded border disabled:opacity-50"
                    >
                        {offloadStatus.pushFabricBalances?.isRunning ? 'Pushing...' : 'Push Fabric Balances'}
                    </button>
                    <button
                        onClick={() => handleRunClick('import_fabric_balances', 'Import Fabric Balances from Sheet')}
                        disabled={triggerMutation.isPending || offloadStatus.importFabricBalances?.isRunning}
                        className="px-2.5 py-1.5 text-xs bg-amber-100 hover:bg-amber-200 text-amber-700 rounded border disabled:opacity-50"
                    >
                        {offloadStatus.importFabricBalances?.isRunning ? 'Importing...' : 'Import Fabric Counts'}
                    </button>
                </div>
                {offloadStatus.cleanupDone?.lastResult && (
                    <div className="mt-2">
                        <button
                            onClick={() => setExpandedJob(expandedJob === 'cleanup_done' ? null : 'cleanup_done')}
                            className="text-xs text-blue-600 hover:text-blue-800 flex items-center gap-1"
                        >
                            {expandedJob === 'cleanup_done' ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
                            Cleanup Details
                        </button>
                        {expandedJob === 'cleanup_done' && (
                            <CleanupDoneResultCard result={offloadStatus.cleanupDone.lastResult as unknown as CleanupDoneResult} />
                        )}
                    </div>
                )}
                {offloadStatus.migrateFormulas?.lastResult && (
                    <div className="mt-2">
                        <button
                            onClick={() => setExpandedJob(expandedJob === 'migrate_formulas' ? null : 'migrate_formulas')}
                            className="text-xs text-blue-600 hover:text-blue-800 flex items-center gap-1"
                        >
                            {expandedJob === 'migrate_formulas' ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
                            Migration Details
                        </button>
                        {expandedJob === 'migrate_formulas' && (
                            <MigrateFormulasResultCard result={offloadStatus.migrateFormulas.lastResult as unknown as MigrateFormulasResult} />
                        )}
                    </div>
                )}
                {/* Push Balances Preview */}
                {pushBalancesPreview && (
                    <div className="mt-2 p-2 bg-emerald-50 rounded border border-emerald-200">
                        <p className="text-xs font-medium text-emerald-700 mb-1">Push Balances Preview</p>
                        <PushBalancesPreviewCard preview={pushBalancesPreview} />
                    </div>
                )}
            </div>

            {/* Confirm Modal */}
            <ConfirmModal
                isOpen={confirmAction !== null}
                onClose={() => setConfirmAction(null)}
                onConfirm={() => {
                    if (confirmAction) triggerMutation.mutate(confirmAction.jobId);
                }}
                title={`Run ${confirmAction?.jobName ?? 'Job'}?`}
                message={confirmAction ? getConfirmMessage(confirmAction.jobId) : ''}
                confirmText="Run Now"
                confirmVariant="warning"
                isLoading={triggerMutation.isPending}
            />
        </div>
    );
});

// ============================================
// MAIN COMPONENT
// ============================================

export function SheetSyncTab() {
    const STORAGE_KEY = 'coh_sheet_sync';

    // Load saved values from localStorage
    const savedConfig = (() => {
        try {
            const raw = typeof window !== 'undefined' ? localStorage.getItem(STORAGE_KEY) : null;
            if (!raw) return null;
            return JSON.parse(raw) as { inputMode?: InputMode; sheetUrl?: string; ordersGid?: string; inventoryGid?: string };
        } catch { return null; }
    })();

    const [inputMode, setInputMode] = useState<InputMode>(savedConfig?.inputMode ?? 'file');
    const [sheetUrl, setSheetUrl] = useState(savedConfig?.sheetUrl ?? '');
    const [ordersGid, setOrdersGid] = useState(savedConfig?.ordersGid ?? '0');
    const [inventoryGid, setInventoryGid] = useState(savedConfig?.inventoryGid ?? '1');
    // Persist config to localStorage on change
    useEffect(() => {
        try {
            localStorage.setItem(STORAGE_KEY, JSON.stringify({ inputMode, sheetUrl, ordersGid, inventoryGid }));
        } catch { /* storage full or unavailable */ }
    }, [inputMode, sheetUrl, ordersGid, inventoryGid]);

    const [ordersFile, setOrdersFile] = useState<File | null>(null);
    const [inventoryFile, setInventoryFile] = useState<File | null>(null);
    const [currentJob, setCurrentJob] = useState<SheetSyncJob | null>(null);
    const [planError, setPlanError] = useState<string | null>(null);
    const ordersInputRef = useRef<HTMLInputElement>(null);
    const inventoryInputRef = useRef<HTMLInputElement>(null);

    // Server function wrappers
    const planSyncFromSheetFn = useServerFn(planSyncFromSheet);
    const executeSyncJobFn = useServerFn(executeSyncJob);
    const getSyncJobStatusFn = useServerFn(getSyncJobStatus);

    // Poll job status during execution
    useQuery({
        queryKey: ['sheetSyncStatus', currentJob?.id],
        queryFn: async () => {
            if (!currentJob?.id) return null;
            const result = await getSyncJobStatusFn({ data: { jobId: currentJob.id } });
            if (result.success && result.data?.job) {
                const job = result.data.job as SheetSyncJob;
                setCurrentJob(job);
                return job;
            }
            return null;
        },
        enabled: currentJob?.status === 'executing',
        refetchInterval: 2000,
    });

    // Plan mutation — file upload mode (direct Express call)
    const planFileMutation = useMutation({
        mutationFn: async () => {
            if (!ordersFile || !inventoryFile) throw new Error('Both files are required');

            const formData = new FormData();
            formData.append('ordersFile', ordersFile);
            formData.append('inventoryFile', inventoryFile);

            const baseUrl = getApiBaseUrl();
            const response = await fetch(`${baseUrl}/api/admin/sheet-sync/plan`, {
                method: 'POST',
                body: formData,
                credentials: 'include',
            });

            if (!response.ok) {
                const errorData = await response.json().catch(() => ({}));
                throw new Error((errorData as Record<string, string>).error || `Request failed (${response.status})`);
            }

            return await response.json();
        },
        onSuccess: (data) => {
            setCurrentJob(data.job as SheetSyncJob);
            setPlanError(null);
        },
        onError: (err: Error) => {
            setPlanError(err.message);
        },
    });

    // Plan mutation — Google Sheets mode (server function)
    const planSheetMutation = useMutation({
        mutationFn: async () => {
            const result = await planSyncFromSheetFn({
                data: {
                    sheetId: sheetUrl,
                    ordersGid,
                    inventoryGid,
                },
            });
            if (!result.success) throw new Error(result.error);
            return result.data;
        },
        onSuccess: (data) => {
            if (data?.job) {
                setCurrentJob(data.job as SheetSyncJob);
            }
            setPlanError(null);
        },
        onError: (err: Error) => {
            setPlanError(err.message);
        },
    });

    // Execute mutation
    const executeMutation = useMutation({
        mutationFn: async () => {
            if (!currentJob?.id) throw new Error('No job to execute');
            const result = await executeSyncJobFn({ data: { jobId: currentJob.id } });
            if (!result.success) throw new Error(result.error);
            return result.data;
        },
        onSuccess: () => {
            if (currentJob) {
                setCurrentJob({ ...currentJob, status: 'executing' });
            }
        },
    });

    const handlePlan = useCallback(() => {
        setPlanError(null);
        if (inputMode === 'file') {
            planFileMutation.mutate();
        } else {
            planSheetMutation.mutate();
        }
    }, [inputMode, planFileMutation, planSheetMutation]);

    const handleExecute = useCallback(() => {
        executeMutation.mutate();
    }, [executeMutation]);

    const handleReset = useCallback(() => {
        setCurrentJob(null);
        setPlanError(null);
        setOrdersFile(null);
        setInventoryFile(null);
        // Keep sheetUrl/GIDs — they're saved config
        if (ordersInputRef.current) ordersInputRef.current.value = '';
        if (inventoryInputRef.current) inventoryInputRef.current.value = '';
    }, []);

    const isPlanning = planFileMutation.isPending || planSheetMutation.isPending;
    const isExecuting = currentJob?.status === 'executing';
    const isDone = currentJob?.status === 'completed' || currentJob?.status === 'failed';
    const canPlan = inputMode === 'file'
        ? (ordersFile !== null && inventoryFile !== null)
        : sheetUrl.trim().length > 0;

    return (
        <div className="space-y-6 max-w-3xl">
            {/* Offload Worker Monitor */}
            <OffloadMonitor />

            {/* Divider */}
            <div className="border-t pt-2" />

            {/* Header */}
            <div>
                <h2 className="text-lg font-semibold text-gray-900">Sheet Sync</h2>
                <p className="text-sm text-gray-500 mt-1">
                    Sync ERP state from Google Sheets. Upload CSV files or provide a Google Sheets URL.
                </p>
            </div>

            {/* Input Mode Toggle */}
            <div className="flex gap-2">
                <button
                    className={`px-3 py-1.5 text-sm rounded-md flex items-center gap-1.5 ${
                        inputMode === 'file'
                            ? 'bg-blue-100 text-blue-800 font-medium'
                            : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                    }`}
                    onClick={() => setInputMode('file')}
                    disabled={isPlanning || isExecuting}
                >
                    <Upload size={14} /> File Upload
                </button>
                <button
                    className={`px-3 py-1.5 text-sm rounded-md flex items-center gap-1.5 ${
                        inputMode === 'sheet'
                            ? 'bg-blue-100 text-blue-800 font-medium'
                            : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                    }`}
                    onClick={() => setInputMode('sheet')}
                    disabled={isPlanning || isExecuting}
                >
                    <Link size={14} /> Google Sheets
                </button>
            </div>

            {/* Input Fields */}
            {inputMode === 'file' ? (
                <div className="space-y-3">
                    <div>
                        <label className="block text-sm font-medium text-gray-700 mb-1">
                            Orders CSV
                        </label>
                        <input
                            ref={ordersInputRef}
                            type="file"
                            accept=".csv"
                            onChange={(e) => setOrdersFile(e.target.files?.[0] ?? null)}
                            disabled={isPlanning || isExecuting}
                            className="block w-full text-sm text-gray-500 file:mr-4 file:py-1.5 file:px-3 file:rounded-md file:border-0 file:text-sm file:font-medium file:bg-blue-50 file:text-blue-700 hover:file:bg-blue-100"
                        />
                    </div>
                    <div>
                        <label className="block text-sm font-medium text-gray-700 mb-1">
                            Inventory CSV
                        </label>
                        <input
                            ref={inventoryInputRef}
                            type="file"
                            accept=".csv"
                            onChange={(e) => setInventoryFile(e.target.files?.[0] ?? null)}
                            disabled={isPlanning || isExecuting}
                            className="block w-full text-sm text-gray-500 file:mr-4 file:py-1.5 file:px-3 file:rounded-md file:border-0 file:text-sm file:font-medium file:bg-blue-50 file:text-blue-700 hover:file:bg-blue-100"
                        />
                    </div>
                </div>
            ) : (
                <div className="space-y-3">
                    <div>
                        <label className="block text-sm font-medium text-gray-700 mb-1">
                            Google Sheets URL or ID
                        </label>
                        <input
                            type="text"
                            value={sheetUrl}
                            onChange={(e) => setSheetUrl(e.target.value)}
                            placeholder="https://docs.google.com/spreadsheets/d/..."
                            disabled={isPlanning || isExecuting}
                            className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm focus:ring-blue-500 focus:border-blue-500"
                        />
                    </div>
                    <div className="flex gap-3">
                        <div className="flex-1">
                            <label className="block text-sm font-medium text-gray-700 mb-1">
                                Orders Tab GID
                            </label>
                            <input
                                type="text"
                                value={ordersGid}
                                onChange={(e) => setOrdersGid(e.target.value)}
                                placeholder="0"
                                disabled={isPlanning || isExecuting}
                                className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm focus:ring-blue-500 focus:border-blue-500"
                            />
                        </div>
                        <div className="flex-1">
                            <label className="block text-sm font-medium text-gray-700 mb-1">
                                Inventory Tab GID
                            </label>
                            <input
                                type="text"
                                value={inventoryGid}
                                onChange={(e) => setInventoryGid(e.target.value)}
                                placeholder="1"
                                disabled={isPlanning || isExecuting}
                                className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm focus:ring-blue-500 focus:border-blue-500"
                            />
                        </div>
                    </div>
                    <p className="text-xs text-gray-400">
                        The sheet must be shared with "Anyone with the link". GID is the number in the URL after #gid=.
                    </p>
                </div>
            )}

            {/* Plan Button */}
            {!currentJob && (
                <button
                    onClick={handlePlan}
                    disabled={!canPlan || isPlanning}
                    className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white text-sm font-medium rounded-md hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed"
                >
                    {isPlanning ? (
                        <>
                            <Loader2 size={16} className="animate-spin" /> Planning...
                        </>
                    ) : (
                        <>
                            <FileSpreadsheet size={16} /> Plan Sync (Dry Run)
                        </>
                    )}
                </button>
            )}

            {/* Plan Error */}
            {planError && (
                <div className="flex items-start gap-2 p-3 bg-red-50 border border-red-200 rounded-lg">
                    <XCircle size={16} className="text-red-600 mt-0.5 flex-shrink-0" />
                    <p className="text-sm text-red-700">{planError}</p>
                </div>
            )}

            {/* Plan Preview */}
            {currentJob?.planReport && currentJob.status === 'planned' && (
                <div className="space-y-4">
                    {/* Parse summary */}
                    <div className="bg-gray-50 rounded-lg p-3">
                        <h3 className="text-sm font-medium text-gray-700 mb-2">Parse Summary</h3>
                        <div className="flex gap-4 text-xs text-gray-600">
                            <span>{currentJob.planReport.parseSummary.orderRows} order rows</span>
                            <span>{currentJob.planReport.parseSummary.uniqueOrders} unique orders</span>
                            <span>{currentJob.planReport.parseSummary.inventoryRows} inventory rows</span>
                        </div>
                    </div>

                    {/* Step previews */}
                    <div className="space-y-2">
                        <h3 className="text-sm font-medium text-gray-700">Planned Steps</h3>
                        {currentJob.planReport.steps.map((step) => (
                            <PlanStepCard key={step.stepIndex} step={step} />
                        ))}
                    </div>

                    {/* Action buttons */}
                    <div className="flex gap-3">
                        <button
                            onClick={handleExecute}
                            disabled={executeMutation.isPending}
                            className="flex items-center gap-2 px-4 py-2 bg-green-600 text-white text-sm font-medium rounded-md hover:bg-green-700 disabled:opacity-50"
                        >
                            {executeMutation.isPending ? (
                                <Loader2 size={16} className="animate-spin" />
                            ) : (
                                <Play size={16} />
                            )}
                            Execute All Steps
                        </button>
                        <button
                            onClick={handleReset}
                            className="flex items-center gap-2 px-4 py-2 bg-gray-100 text-gray-700 text-sm font-medium rounded-md hover:bg-gray-200"
                        >
                            <RotateCcw size={16} /> Start Over
                        </button>
                    </div>
                </div>
            )}

            {/* Execution Progress */}
            {(currentJob?.status === 'executing' || isDone) && currentJob.stepResults && (
                <div className="space-y-4">
                    <div className="flex items-center gap-2">
                        <h3 className="text-sm font-medium text-gray-700">Execution Progress</h3>
                        {isExecuting && (
                            <span className="text-xs text-blue-600 flex items-center gap-1">
                                <Loader2 size={12} className="animate-spin" /> Running
                            </span>
                        )}
                        {currentJob.status === 'completed' && (
                            <span className="text-xs text-green-600 flex items-center gap-1">
                                <CheckCircle size={12} /> Completed
                            </span>
                        )}
                        {currentJob.status === 'failed' && (
                            <span className="text-xs text-red-600 flex items-center gap-1">
                                <AlertTriangle size={12} /> Completed with errors
                            </span>
                        )}
                    </div>

                    <ExecutionProgress stepResults={currentJob.stepResults} />

                    {/* Job-level errors */}
                    {currentJob.errors.length > 0 && (
                        <div className="bg-red-50 border border-red-200 rounded-lg p-3">
                            <p className="text-sm font-medium text-red-700 mb-1">Errors</p>
                            {currentJob.errors.slice(0, 5).map((err, i) => (
                                <p key={i} className="text-xs text-red-600">{err}</p>
                            ))}
                            {currentJob.errors.length > 5 && (
                                <p className="text-xs text-red-400">
                                    ...and {currentJob.errors.length - 5} more
                                </p>
                            )}
                        </div>
                    )}

                    {isDone && (
                        <button
                            onClick={handleReset}
                            className="flex items-center gap-2 px-4 py-2 bg-gray-100 text-gray-700 text-sm font-medium rounded-md hover:bg-gray-200"
                        >
                            <RotateCcw size={16} /> Start New Sync
                        </button>
                    )}
                </div>
            )}

            {/* Job failed during planning */}
            {currentJob?.status === 'failed' && !currentJob.stepResults?.some(s => s.status !== 'pending') && (
                <div className="space-y-3">
                    <div className="flex items-start gap-2 p-3 bg-red-50 border border-red-200 rounded-lg">
                        <XCircle size={16} className="text-red-600 mt-0.5 flex-shrink-0" />
                        <div>
                            <p className="text-sm font-medium text-red-700">Planning failed</p>
                            {currentJob.errors.map((err, i) => (
                                <p key={i} className="text-xs text-red-600 mt-1">{err}</p>
                            ))}
                        </div>
                    </div>
                    <button
                        onClick={handleReset}
                        className="flex items-center gap-2 px-4 py-2 bg-gray-100 text-gray-700 text-sm font-medium rounded-md hover:bg-gray-200"
                    >
                        <RotateCcw size={16} /> Try Again
                    </button>
                </div>
            )}

            {/* Info banner */}
            {!currentJob && !planError && (
                <div className="flex items-start gap-2 p-3 bg-blue-50 border border-blue-200 rounded-lg mt-4">
                    <Info size={16} className="text-blue-600 mt-0.5 flex-shrink-0" />
                    <div className="text-xs text-blue-700 space-y-1">
                        <p className="font-medium">How Sheet Sync Works</p>
                        <p>1. Upload or fetch two CSVs: Orders and Inventory</p>
                        <p>2. Review the dry-run preview showing all planned changes</p>
                        <p>3. Execute to apply: ship/release orders, create marketplace orders, sync notes, update statuses, assign production batches, and reconcile inventory</p>
                    </div>
                </div>
            )}
        </div>
    );
}
