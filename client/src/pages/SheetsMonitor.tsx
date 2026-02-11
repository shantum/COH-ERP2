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
    ArrowRightLeft, Database, Package, AlertCircle, Eye, X,
    RefreshCw, Upload, CheckCircle2, Layers,
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

interface BalanceVerification {
    passed: boolean;
    totalSkusChecked: number;
    drifted: number;
    sampleDrifts: Array<{
        skuCode: string;
        before: { c: number; d: number; e: number; r: number };
        after: { c: number; d: number; e: number; r: number };
        cDelta: number;
    }>;
}

interface InwardPreviewRow {
    skuCode: string;
    product: string;
    qty: number;
    source: string;
    date: string;
    doneBy: string;
    tailor: string;
    status: 'ready' | 'invalid' | 'duplicate';
    error?: string;
}

interface OutwardPreviewRow {
    skuCode: string;
    product: string;
    qty: number;
    orderNo: string;
    orderDate: string;
    customerName: string;
    courier: string;
    awb: string;
    status: 'ready' | 'invalid' | 'duplicate';
    error?: string;
}

interface BalanceSkuSummary {
    skuCode: string;
    qty: number;
    erpBalance: number;
    afterErpBalance: number;
    sheetPending: number;
    afterSheetPending: number;
    colC: number;
    inSync: boolean;
}

interface PreviewResult {
    tab: string;
    totalRows: number;
    valid: number;
    invalid: number;
    duplicates: number;
    validationErrors: Record<string, number>;
    skipReasons?: Record<string, number>;
    affectedSkuCodes: string[];
    durationMs: number;
    previewRows?: InwardPreviewRow[] | OutwardPreviewRow[];
    balanceSnapshot?: {
        skuBalances: BalanceSkuSummary[];
        allInSync: boolean;
    };
}

interface FabricInwardPreviewRow {
    fabricCode: string;
    material: string;
    fabric: string;
    colour: string;
    qty: number;
    unit: string;
    costPerUnit: number;
    supplier: string;
    date: string;
    notes: string;
    status: 'ready' | 'invalid' | 'duplicate';
    error?: string;
}

interface FabricInwardPreviewResult {
    tab: string;
    totalRows: number;
    valid: number;
    invalid: number;
    duplicates: number;
    validationErrors: Record<string, number>;
    affectedFabricCodes: string[];
    durationMs: number;
    previewRows?: FabricInwardPreviewRow[];
}

interface SyncCheckResult {
    totalSkusInDb: number;
    mastersheetMatched: number;
    mastersheetWouldChange: number;
    ledgerMatched: number;
    ledgerWouldChange: number;
    alreadyCorrect: number;
    wouldChange: number;
    sampleChanges: Array<{ skuCode: string; productName: string; colorName: string; size: string; sheet: string; sheetValue: number; dbValue: number }>;
    durationMs: number;
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

function BalanceVerificationBadge({ verification }: { verification?: BalanceVerification }) {
    if (!verification) return null;

    if (verification.passed) {
        return (
            <div className="mt-2 px-2 py-1.5 bg-emerald-50 border border-emerald-200 rounded text-xs text-emerald-700 flex items-center gap-1.5">
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 shrink-0" />
                Balance verified — {verification.totalSkusChecked} SKUs checked, no drift
            </div>
        );
    }

    return (
        <div className="mt-2 px-2 py-1.5 bg-red-50 border border-red-200 rounded text-xs text-red-700">
            <div className="flex items-center gap-1.5 font-medium">
                <AlertCircle size={12} />
                BALANCE DRIFT — {verification.drifted} SKU{verification.drifted !== 1 ? 's' : ''} changed
            </div>
            {verification.sampleDrifts.length > 0 && (
                <div className="mt-1 space-y-0.5 text-[10px]">
                    {verification.sampleDrifts.slice(0, 5).map((d, i) => (
                        <div key={i} className="text-red-600">
                            {d.skuCode}: C {d.before.c}→{d.after.c} (delta: {d.cDelta})
                        </div>
                    ))}
                </div>
            )}
        </div>
    );
}

function StatusDot({ status }: { status: 'ready' | 'invalid' | 'duplicate' }) {
    if (status === 'ready') return <span className="w-2 h-2 rounded-full bg-emerald-500 shrink-0 inline-block" />;
    if (status === 'invalid') return <span className="w-2 h-2 rounded-full bg-red-500 shrink-0 inline-block" />;
    return <span className="w-2 h-2 rounded-full bg-amber-400 shrink-0 inline-block" />;
}

function PreviewResultCard({ title, preview, type, onClose }: {
    title: string;
    preview: PreviewResult;
    type: 'inward' | 'outward';
    onClose: () => void;
}) {
    const [showBalanceProof, setShowBalanceProof] = useState(false);
    const isInward = type === 'inward';
    const borderColor = isInward ? 'border-emerald-200' : 'border-blue-200';
    const bgColor = isInward ? 'bg-emerald-50' : 'bg-blue-50';
    const textColor = isInward ? 'text-emerald-700' : 'text-blue-700';

    const errors = Object.entries(preview.validationErrors ?? {});
    const skipReasons = Object.entries(preview.skipReasons ?? {});
    const balances = preview.balanceSnapshot?.skuBalances ?? [];
    const allInSync = preview.balanceSnapshot?.allInSync ?? true;
    const rawRows = preview.previewRows ?? [];

    // Sort: ready first, then invalid, then duplicate
    const statusOrder = { ready: 0, invalid: 1, duplicate: 2 };
    const inwardRows = isInward
        ? ([...rawRows] as InwardPreviewRow[]).sort((a, b) => statusOrder[a.status] - statusOrder[b.status])
        : [];
    const outwardRows = !isInward
        ? ([...rawRows] as OutwardPreviewRow[]).sort((a, b) => statusOrder[a.status] - statusOrder[b.status])
        : [];
    const rowCount = isInward ? inwardRows.length : outwardRows.length;

    return (
        <div className={`bg-white rounded-lg border ${borderColor} p-4 shadow-sm`}>
            <div className="flex items-center justify-between mb-3">
                <div className="flex items-center gap-2">
                    <Eye size={16} className={textColor} />
                    <h3 className={`text-sm font-medium ${textColor}`}>{title}</h3>
                    <span className="text-xs text-gray-400">{formatDuration(preview.durationMs)}</span>
                </div>
                <button onClick={onClose} className="text-gray-400 hover:text-gray-600">
                    <X size={16} />
                </button>
            </div>

            {/* Summary row */}
            <div className="grid grid-cols-4 gap-2 mb-3">
                <div className={`rounded p-2 text-center ${bgColor}`}>
                    <div className="text-xs text-gray-500">Total Rows</div>
                    <div className={`text-sm font-semibold ${textColor}`}>{preview.totalRows}</div>
                </div>
                <div className="rounded p-2 text-center bg-green-50">
                    <div className="text-xs text-gray-500">Ready</div>
                    <div className="text-sm font-semibold text-green-700">{preview.valid}</div>
                </div>
                <div className={`rounded p-2 text-center ${preview.invalid > 0 ? 'bg-red-50' : 'bg-gray-50'}`}>
                    <div className="text-xs text-gray-500">Invalid</div>
                    <div className={`text-sm font-semibold ${preview.invalid > 0 ? 'text-red-600' : 'text-gray-400'}`}>{preview.invalid}</div>
                </div>
                <div className={`rounded p-2 text-center ${preview.duplicates > 0 ? 'bg-amber-50' : 'bg-gray-50'}`}>
                    <div className="text-xs text-gray-500">Already Done</div>
                    <div className={`text-sm font-semibold ${preview.duplicates > 0 ? 'text-amber-600' : 'text-gray-400'}`}>{preview.duplicates}</div>
                </div>
            </div>

            {/* Sync check */}
            {balances.length > 0 && (
                allInSync ? (
                    <div className="mb-3 px-3 py-2 bg-emerald-50 border border-emerald-200 rounded flex items-center gap-2">
                        <span className="w-2 h-2 rounded-full bg-emerald-500 shrink-0" />
                        <span className="text-xs text-emerald-800">
                            ERP and Sheet balances are in sync — safe to ingest
                        </span>
                    </div>
                ) : (
                    <div className="mb-3 px-3 py-2 bg-red-50 border border-red-200 rounded">
                        <div className="flex items-center gap-2">
                            <AlertCircle size={14} className="text-red-500 shrink-0" />
                            <span className="text-xs font-medium text-red-800">
                                Some SKUs are out of sync between ERP and Sheet
                            </span>
                        </div>
                    </div>
                )
            )}

            {/* Validation errors */}
            {errors.length > 0 && (
                <div className="mb-3 p-2 bg-red-50 border border-red-200 rounded text-xs text-red-700">
                    <div className="font-medium mb-1">Validation errors:</div>
                    {errors.map(([reason, count]) => (
                        <div key={reason}>{reason}: {count}</div>
                    ))}
                </div>
            )}

            {/* Skip reasons (outward) */}
            {skipReasons.length > 0 && (
                <div className="mb-3 p-2 bg-amber-50 border border-amber-200 rounded text-xs text-amber-700">
                    <div className="font-medium mb-1">Skip reasons:</div>
                    {skipReasons.map(([reason, count]) => (
                        <div key={reason}>{reason}: {count}</div>
                    ))}
                </div>
            )}

            {/* Import data table */}
            {rowCount > 0 && (
                <div className="mb-3">
                    <div className="text-xs font-medium text-gray-600 mb-1">
                        Rows being imported ({rowCount})
                    </div>
                    <div className="border rounded-lg overflow-hidden max-h-80 overflow-y-auto">
                        <table className="w-full text-xs">
                            <thead className="bg-gray-50 sticky top-0">
                                {isInward ? (
                                    <tr>
                                        <th className="text-left px-2 py-1.5 font-medium text-gray-600 w-6"></th>
                                        <th className="text-left px-2 py-1.5 font-medium text-gray-600">SKU</th>
                                        <th className="text-left px-2 py-1.5 font-medium text-gray-600">Product</th>
                                        <th className="text-right px-2 py-1.5 font-medium text-gray-600">Qty</th>
                                        <th className="text-left px-2 py-1.5 font-medium text-gray-600">Source</th>
                                        <th className="text-left px-2 py-1.5 font-medium text-gray-600">Date</th>
                                        <th className="text-left px-2 py-1.5 font-medium text-gray-600">Done By</th>
                                    </tr>
                                ) : (
                                    <tr>
                                        <th className="text-left px-2 py-1.5 font-medium text-gray-600 w-6"></th>
                                        <th className="text-left px-2 py-1.5 font-medium text-gray-600">Order#</th>
                                        <th className="text-left px-2 py-1.5 font-medium text-gray-600">Date</th>
                                        <th className="text-left px-2 py-1.5 font-medium text-gray-600">Customer</th>
                                        <th className="text-left px-2 py-1.5 font-medium text-gray-600">SKU</th>
                                        <th className="text-left px-2 py-1.5 font-medium text-gray-600">Product</th>
                                        <th className="text-right px-2 py-1.5 font-medium text-gray-600">Qty</th>
                                    </tr>
                                )}
                            </thead>
                            <tbody className="divide-y">
                                {isInward ? (
                                    inwardRows.map((row, i) => (
                                        <tr key={i} className={row.status === 'invalid' ? 'bg-red-50' : row.status === 'duplicate' ? 'bg-amber-50/50' : 'hover:bg-gray-50'}>
                                            <td className="px-2 py-1" title={row.error ?? row.status}>
                                                <StatusDot status={row.status} />
                                            </td>
                                            <td className="px-2 py-1 font-mono text-gray-700">{row.skuCode}</td>
                                            <td className="px-2 py-1 text-gray-600 truncate max-w-[140px]" title={row.product}>{row.product}</td>
                                            <td className={`px-2 py-1 text-right font-medium ${textColor}`}>{row.qty}</td>
                                            <td className="px-2 py-1 text-gray-600">{row.source}</td>
                                            <td className="px-2 py-1 text-gray-500">{row.date}</td>
                                            <td className="px-2 py-1 text-gray-500">{row.doneBy}</td>
                                        </tr>
                                    ))
                                ) : (
                                    outwardRows.map((row, i) => (
                                        <tr key={i} className={row.status === 'invalid' ? 'bg-red-50' : row.status === 'duplicate' ? 'bg-amber-50/50' : 'hover:bg-gray-50'}>
                                            <td className="px-2 py-1" title={row.error ?? row.status}>
                                                <StatusDot status={row.status} />
                                            </td>
                                            <td className="px-2 py-1 font-mono text-gray-700">{row.orderNo}</td>
                                            <td className="px-2 py-1 text-gray-500">{row.orderDate}</td>
                                            <td className="px-2 py-1 text-gray-600 truncate max-w-[100px]" title={row.customerName}>{row.customerName}</td>
                                            <td className="px-2 py-1 font-mono text-gray-700">{row.skuCode}</td>
                                            <td className="px-2 py-1 text-gray-600 truncate max-w-[140px]" title={row.product}>{row.product}</td>
                                            <td className={`px-2 py-1 text-right font-medium ${textColor}`}>{row.qty}</td>
                                        </tr>
                                    ))
                                )}
                            </tbody>
                        </table>
                    </div>
                </div>
            )}

            {/* Balance proof — collapsible */}
            {balances.length > 0 && (
                <div>
                    <button
                        onClick={() => setShowBalanceProof(!showBalanceProof)}
                        className="flex items-center gap-1 text-xs text-gray-500 hover:text-gray-700"
                    >
                        {showBalanceProof ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                        Balance proof ({balances.length} SKUs)
                    </button>
                    {showBalanceProof && (
                        <div className="mt-1.5 space-y-0.5 text-xs text-gray-600 pl-5">
                            {balances.map(b => {
                                const erpDelta = b.afterErpBalance - b.erpBalance;
                                return (
                                    <div key={b.skuCode} className={!b.inSync ? 'text-red-600' : ''}>
                                        <span className="font-mono">{b.skuCode}</span>
                                        <span className="text-gray-400"> (qty {b.qty}): </span>
                                        ERP {b.erpBalance} → {b.afterErpBalance}
                                        <span className={erpDelta > 0 ? 'text-emerald-600' : 'text-blue-600'}>
                                            {' '}({erpDelta > 0 ? '+' : ''}{erpDelta})
                                        </span>
                                        <span className="text-gray-400">{' | '}</span>
                                        Sheet total (C): {b.colC}
                                        <span className="text-emerald-600"> — no change</span>
                                    </div>
                                );
                            })}
                        </div>
                    )}
                </div>
            )}
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

    // Preview mutations
    const [previewInwardResult, setPreviewInwardResult] = useState<PreviewResult | null>(null);
    const [previewOutwardResult, setPreviewOutwardResult] = useState<PreviewResult | null>(null);

    const previewInwardMutation = useMutation({
        mutationFn: async () => {
            const result = await triggerFn({
                data: { jobId: 'preview_ingest_inward' as const },
            });
            if (!result.success) throw new Error(result.error?.message);
            return (result.data?.result ?? null) as PreviewResult | null;
        },
        onSuccess: (data) => {
            if (data) setPreviewInwardResult(data);
            invalidateAll();
        },
    });

    const previewOutwardMutation = useMutation({
        mutationFn: async () => {
            const result = await triggerFn({
                data: { jobId: 'preview_ingest_outward' as const },
            });
            if (!result.success) throw new Error(result.error?.message);
            return (result.data?.result ?? null) as PreviewResult | null;
        },
        onSuccess: (data) => {
            if (data) setPreviewOutwardResult(data);
            invalidateAll();
        },
    });

    // Fabric Inward preview + import mutations
    const [fabricInwardPreview, setFabricInwardPreview] = useState<FabricInwardPreviewResult | null>(null);

    const previewFabricInwardMutation = useMutation({
        mutationFn: async () => {
            // First refresh Fabric Balances (so sheet dropdowns are up to date)
            await triggerFn({ data: { jobId: 'push_fabric_balances' as const } });
            // Then run preview
            const result = await triggerFn({
                data: { jobId: 'preview_fabric_inward' as const },
            });
            if (!result.success) throw new Error(result.error?.message);
            return (result.data?.result ?? null) as FabricInwardPreviewResult | null;
        },
        onSuccess: (data) => {
            if (data) setFabricInwardPreview(data);
            invalidateAll();
        },
    });

    const importFabricInwardMutation = useMutation({
        mutationFn: async () => {
            const result = await triggerFn({
                data: { jobId: 'ingest_fabric_inward' as const },
            });
            if (!result.success) throw new Error(result.error?.message);
            return result.data;
        },
        onSuccess: () => {
            setFabricInwardPreview(null);
            invalidateAll();
        },
    });

    // Sync check (ERP vs Sheet R column)
    const [syncCheckResult, setSyncCheckResult] = useState<SyncCheckResult | null>(null);
    const [pushResult, setPushResult] = useState<{ skusUpdated: number; errors: number } | null>(null);

    const checkSyncMutation = useMutation({
        mutationFn: async () => {
            const result = await triggerFn({
                data: { jobId: 'preview_push_balances' as const },
            });
            if (!result.success) throw new Error(result.error?.message);
            return (result.data?.result ?? null) as SyncCheckResult | null;
        },
        onSuccess: (data) => {
            if (data) {
                setSyncCheckResult(data);
                setPushResult(null);
            }
        },
    });

    const pushBalancesMutation = useMutation({
        mutationFn: async () => {
            const result = await triggerFn({
                data: { jobId: 'push_balances' as const },
            });
            if (!result.success) throw new Error(result.error?.message);
            const pushData = result.data?.result as { skusUpdated?: number; errors?: number } | null | undefined;
            return pushData ?? null;
        },
        onSuccess: (data) => {
            setSyncCheckResult(null);
            setPushResult(data ? { skusUpdated: data.skusUpdated ?? 0, errors: data.errors ?? 0 } : null);
            invalidateAll();
        },
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
                        <div className="flex items-center border-l border-gray-200 pl-2 gap-1">
                            <button
                                onClick={() => previewInwardMutation.mutate()}
                                disabled={previewInwardMutation.isPending || inwardState?.isRunning}
                                className="inline-flex items-center gap-1 px-2 py-1.5 text-xs font-medium rounded-md border border-emerald-300 bg-emerald-50 text-emerald-700 hover:bg-emerald-100 disabled:opacity-50 disabled:cursor-not-allowed"
                            >
                                {previewInwardMutation.isPending ? (
                                    <Loader2 size={12} className="animate-spin" />
                                ) : (
                                    <Eye size={12} />
                                )}
                                Preview
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
                                Inward
                            </button>
                        </div>
                        <div className="flex items-center border-l border-gray-200 pl-2 gap-1">
                            <button
                                onClick={() => previewOutwardMutation.mutate()}
                                disabled={previewOutwardMutation.isPending || outwardState?.isRunning}
                                className="inline-flex items-center gap-1 px-2 py-1.5 text-xs font-medium rounded-md border border-blue-300 bg-blue-50 text-blue-700 hover:bg-blue-100 disabled:opacity-50 disabled:cursor-not-allowed"
                            >
                                {previewOutwardMutation.isPending ? (
                                    <Loader2 size={12} className="animate-spin" />
                                ) : (
                                    <Eye size={12} />
                                )}
                                Preview
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
                                Outward
                            </button>
                        </div>
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
                {previewInwardMutation.error && (
                    <div className="mt-2 text-xs text-red-600 flex items-center gap-1">
                        <AlertCircle size={12} /> Preview Inward: {previewInwardMutation.error.message}
                    </div>
                )}
                {previewOutwardMutation.error && (
                    <div className="mt-2 text-xs text-red-600 flex items-center gap-1">
                        <AlertCircle size={12} /> Preview Outward: {previewOutwardMutation.error.message}
                    </div>
                )}
            </div>

            {/* ── Preview Results ── */}
            {previewInwardResult && (
                <PreviewResultCard
                    title="Inward Preview"
                    preview={previewInwardResult}
                    type="inward"
                    onClose={() => setPreviewInwardResult(null)}
                />
            )}
            {previewOutwardResult && (
                <PreviewResultCard
                    title="Outward Preview"
                    preview={previewOutwardResult}
                    type="outward"
                    onClose={() => setPreviewOutwardResult(null)}
                />
            )}

            {/* ── Fabric Inward Section ── */}
            <div className="bg-white rounded-lg border border-gray-200 p-4 shadow-sm">
                <div className="flex items-center justify-between mb-3">
                    <div className="flex items-center gap-2">
                        <Layers size={16} className="text-violet-500" />
                        <h3 className="text-sm font-medium text-gray-900">Fabric Inward (Live)</h3>
                    </div>
                    <div className="flex items-center gap-2">
                        <button
                            onClick={() => previewFabricInwardMutation.mutate()}
                            disabled={previewFabricInwardMutation.isPending}
                            className="inline-flex items-center gap-1 px-2 py-1.5 text-xs font-medium rounded-md border border-violet-300 bg-violet-50 text-violet-700 hover:bg-violet-100 disabled:opacity-50 disabled:cursor-not-allowed"
                        >
                            {previewFabricInwardMutation.isPending ? (
                                <Loader2 size={12} className="animate-spin" />
                            ) : (
                                <Eye size={12} />
                            )}
                            Preview
                        </button>
                        <button
                            onClick={() => importFabricInwardMutation.mutate()}
                            disabled={importFabricInwardMutation.isPending || !fabricInwardPreview || fabricInwardPreview.valid === 0}
                            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-md bg-violet-600 text-white hover:bg-violet-700 disabled:opacity-50 disabled:cursor-not-allowed"
                        >
                            {importFabricInwardMutation.isPending ? (
                                <Loader2 size={14} className="animate-spin" />
                            ) : (
                                <Play size={14} />
                            )}
                            Import
                        </button>
                    </div>
                </div>

                {/* Mutation errors */}
                {previewFabricInwardMutation.error && (
                    <div className="mb-3 text-xs text-red-600 flex items-center gap-1">
                        <AlertCircle size={12} /> Preview: {previewFabricInwardMutation.error.message}
                    </div>
                )}
                {importFabricInwardMutation.error && (
                    <div className="mb-3 text-xs text-red-600 flex items-center gap-1">
                        <AlertCircle size={12} /> Import: {importFabricInwardMutation.error.message}
                    </div>
                )}

                {/* Import success */}
                {importFabricInwardMutation.isSuccess && (
                    <div className="mb-3 px-3 py-2 bg-emerald-50 border border-emerald-200 rounded flex items-center gap-2">
                        <CheckCircle2 size={14} className="text-emerald-600" />
                        <span className="text-xs text-emerald-800">Fabric inward import completed successfully</span>
                    </div>
                )}

                {/* Preview result */}
                {fabricInwardPreview ? (
                    <div>
                        {/* Summary grid */}
                        <div className="flex items-center justify-between mb-3">
                            <div className="grid grid-cols-4 gap-3 flex-1">
                                <div className="text-center p-2 bg-gray-50 rounded">
                                    <div className="text-lg font-semibold text-gray-900">{fabricInwardPreview.totalRows}</div>
                                    <div className="text-[10px] text-gray-500">Total</div>
                                </div>
                                <div className="text-center p-2 bg-emerald-50 rounded">
                                    <div className="text-lg font-semibold text-emerald-600">{fabricInwardPreview.valid}</div>
                                    <div className="text-[10px] text-emerald-600">Ready</div>
                                </div>
                                <div className="text-center p-2 bg-red-50 rounded">
                                    <div className="text-lg font-semibold text-red-600">{fabricInwardPreview.invalid}</div>
                                    <div className="text-[10px] text-red-600">Invalid</div>
                                </div>
                                <div className="text-center p-2 bg-amber-50 rounded">
                                    <div className="text-lg font-semibold text-amber-600">{fabricInwardPreview.duplicates}</div>
                                    <div className="text-[10px] text-amber-600">Already Done</div>
                                </div>
                            </div>
                            <button onClick={() => setFabricInwardPreview(null)} className="ml-3 p-1 text-gray-400 hover:text-gray-600">
                                <X size={16} />
                            </button>
                        </div>

                        {/* Validation errors */}
                        {Object.keys(fabricInwardPreview.validationErrors).length > 0 && (
                            <div className="mb-3 p-2 bg-red-50 border border-red-200 rounded text-xs text-red-700 space-y-0.5">
                                {Object.entries(fabricInwardPreview.validationErrors).map(([reason, count]) => (
                                    <div key={reason}>{reason}: {count}</div>
                                ))}
                            </div>
                        )}

                        {/* Preview table */}
                        {fabricInwardPreview.previewRows && fabricInwardPreview.previewRows.length > 0 && (
                            <div className="border rounded-lg overflow-hidden">
                                <table className="w-full text-xs">
                                    <thead className="bg-gray-50">
                                        <tr>
                                            <th className="text-left px-2 py-1.5 font-medium text-gray-600">Fabric Code</th>
                                            <th className="text-left px-2 py-1.5 font-medium text-gray-600">Colour</th>
                                            <th className="text-right px-2 py-1.5 font-medium text-gray-600">Qty</th>
                                            <th className="text-left px-2 py-1.5 font-medium text-gray-600">Unit</th>
                                            <th className="text-right px-2 py-1.5 font-medium text-gray-600">Cost/Unit</th>
                                            <th className="text-left px-2 py-1.5 font-medium text-gray-600">Supplier</th>
                                            <th className="text-left px-2 py-1.5 font-medium text-gray-600">Date</th>
                                            <th className="text-center px-2 py-1.5 font-medium text-gray-600">Status</th>
                                        </tr>
                                    </thead>
                                    <tbody className="divide-y">
                                        {[...fabricInwardPreview.previewRows]
                                            .sort((a, b) => {
                                                const order = { ready: 0, invalid: 1, duplicate: 2 };
                                                return order[a.status] - order[b.status];
                                            })
                                            .map((row, i) => (
                                            <tr
                                                key={i}
                                                className={`hover:bg-gray-50 ${
                                                    row.status === 'invalid' ? 'bg-red-50/50' :
                                                    row.status === 'duplicate' ? 'bg-amber-50/50' : ''
                                                }`}
                                            >
                                                <td className="px-2 py-1 font-mono text-gray-700">{row.fabricCode}</td>
                                                <td className="px-2 py-1 text-gray-600">{row.colour}</td>
                                                <td className="px-2 py-1 text-right font-medium text-gray-900">{row.qty}</td>
                                                <td className="px-2 py-1 text-gray-500">{row.unit}</td>
                                                <td className="px-2 py-1 text-right text-gray-600">{row.costPerUnit > 0 ? `₹${row.costPerUnit}` : '—'}</td>
                                                <td className="px-2 py-1 text-gray-600 truncate max-w-[120px]">{row.supplier}</td>
                                                <td className="px-2 py-1 text-gray-500">{row.date}</td>
                                                <td className="px-2 py-1 text-center">
                                                    {row.status === 'ready' && (
                                                        <span className="inline-flex items-center gap-1 text-emerald-600">
                                                            <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" />
                                                            ok
                                                        </span>
                                                    )}
                                                    {row.status === 'invalid' && (
                                                        <span className="text-red-600" title={row.error}>
                                                            <span className="inline-flex items-center gap-1">
                                                                <span className="w-1.5 h-1.5 rounded-full bg-red-500" />
                                                                error
                                                            </span>
                                                        </span>
                                                    )}
                                                    {row.status === 'duplicate' && (
                                                        <span className="inline-flex items-center gap-1 text-amber-600">
                                                            <span className="w-1.5 h-1.5 rounded-full bg-amber-500" />
                                                            done
                                                        </span>
                                                    )}
                                                </td>
                                            </tr>
                                        ))}
                                    </tbody>
                                </table>
                            </div>
                        )}

                        <div className="mt-2 text-[10px] text-gray-400 text-right">
                            {formatDuration(fabricInwardPreview.durationMs)}
                        </div>
                    </div>
                ) : (
                    <div className="text-xs text-gray-400 text-center py-2">
                        Click "Preview" to validate rows in the Fabric Inward (Live) tab
                    </div>
                )}
            </div>

            {/* ── ERP ↔ Sheet Sync Check ── */}
            <div className="bg-white rounded-lg border border-gray-200 p-4 shadow-sm">
                <div className="flex items-center justify-between mb-3">
                    <div className="flex items-center gap-2">
                        <RefreshCw size={16} className="text-gray-500" />
                        <h3 className="text-sm font-medium text-gray-900">ERP ↔ Sheet Balance Sync</h3>
                    </div>
                    <div className="flex items-center gap-2">
                        {syncCheckResult && syncCheckResult.wouldChange > 0 && (
                            <button
                                onClick={() => pushBalancesMutation.mutate()}
                                disabled={pushBalancesMutation.isPending}
                                className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-md bg-amber-600 text-white hover:bg-amber-700 disabled:opacity-50 disabled:cursor-not-allowed"
                            >
                                {pushBalancesMutation.isPending ? (
                                    <>
                                        <Loader2 size={14} className="animate-spin" />
                                        Pushing to Sheet...
                                    </>
                                ) : (
                                    <>
                                        <Upload size={14} />
                                        Push ERP → Sheet
                                    </>
                                )}
                            </button>
                        )}
                        <button
                            onClick={() => checkSyncMutation.mutate()}
                            disabled={checkSyncMutation.isPending}
                            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-md border border-gray-300 bg-white text-gray-700 hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed"
                        >
                            {checkSyncMutation.isPending ? (
                                <>
                                    <Loader2 size={14} className="animate-spin" />
                                    Checking...
                                </>
                            ) : (
                                <>
                                    <RefreshCw size={14} />
                                    Check Sync
                                </>
                            )}
                        </button>
                    </div>
                </div>

                {/* Mutation errors */}
                {checkSyncMutation.error && (
                    <div className="mb-3 text-xs text-red-600 flex items-center gap-1">
                        <AlertCircle size={12} /> {checkSyncMutation.error.message}
                    </div>
                )}
                {pushBalancesMutation.error && (
                    <div className="mb-3 text-xs text-red-600 flex items-center gap-1">
                        <AlertCircle size={12} /> Push failed: {pushBalancesMutation.error.message}
                    </div>
                )}

                {/* Push result */}
                {pushResult && (
                    <div className={`mb-3 px-3 py-2 rounded flex items-center gap-2 ${pushResult.errors > 0 ? 'bg-amber-50 border border-amber-200' : 'bg-emerald-50 border border-emerald-200'}`}>
                        <CheckCircle2 size={14} className={pushResult.errors > 0 ? 'text-amber-600' : 'text-emerald-600'} />
                        <span className={`text-xs ${pushResult.errors > 0 ? 'text-amber-800' : 'text-emerald-800'}`}>
                            Pushed ERP balances to Sheet — {pushResult.skusUpdated} SKUs updated
                            {pushResult.errors > 0 && `, ${pushResult.errors} errors`}
                            . Click Check Sync to verify.
                        </span>
                    </div>
                )}

                {/* Results */}
                {syncCheckResult ? (
                    <div>
                        {syncCheckResult.wouldChange === 0 ? (
                            <div className="px-3 py-2 bg-emerald-50 border border-emerald-200 rounded flex items-center gap-2">
                                <CheckCircle2 size={14} className="text-emerald-600" />
                                <span className="text-xs text-emerald-800">
                                    All in sync — {syncCheckResult.alreadyCorrect} SKUs match between ERP and Sheet
                                </span>
                                <span className="text-[10px] text-gray-400 ml-auto">{formatDuration(syncCheckResult.durationMs)}</span>
                            </div>
                        ) : (
                            <div>
                                <div className="px-3 py-2 bg-amber-50 border border-amber-200 rounded mb-3">
                                    <div className="flex items-center gap-2">
                                        <AlertCircle size={14} className="text-amber-600 shrink-0" />
                                        <span className="text-xs text-amber-800">
                                            <strong>{syncCheckResult.wouldChange}</strong> SKU{syncCheckResult.wouldChange !== 1 ? 's' : ''} out of sync
                                            {syncCheckResult.alreadyCorrect > 0 && (
                                                <span className="text-gray-500"> ({syncCheckResult.alreadyCorrect} already correct)</span>
                                            )}
                                        </span>
                                        <span className="text-[10px] text-gray-400 ml-auto">{formatDuration(syncCheckResult.durationMs)}</span>
                                    </div>
                                    {(syncCheckResult.mastersheetWouldChange > 0 || syncCheckResult.ledgerWouldChange > 0) && (
                                        <div className="mt-1.5 text-[10px] text-amber-700 pl-6">
                                            {syncCheckResult.mastersheetWouldChange > 0 && (
                                                <div>Mastersheet Inventory: {syncCheckResult.mastersheetWouldChange} differ</div>
                                            )}
                                            {syncCheckResult.ledgerWouldChange > 0 && (
                                                <div>Office Ledger Balance: {syncCheckResult.ledgerWouldChange} differ</div>
                                            )}
                                        </div>
                                    )}
                                </div>

                                {/* Mismatches by sheet */}
                                {(() => {
                                    const mastersheet = syncCheckResult.sampleChanges.filter(c => c.sheet === 'Mastersheet Inventory');
                                    const ledger = syncCheckResult.sampleChanges.filter(c => c.sheet !== 'Mastersheet Inventory');
                                    const renderTable = (items: typeof mastersheet, label: string, total: number) => items.length > 0 && (
                                        <div>
                                            <div className="text-[11px] font-medium text-gray-500 mb-1">{label} — {total} differ</div>
                                            <div className="border rounded-lg overflow-hidden mb-3">
                                                <table className="w-full text-xs">
                                                    <thead className="bg-gray-50">
                                                        <tr>
                                                            <th className="text-left px-2 py-1.5 font-medium text-gray-600">SKU</th>
                                                            <th className="text-left px-2 py-1.5 font-medium text-gray-600">Product</th>
                                                            <th className="text-right px-2 py-1.5 font-medium text-gray-600">Sheet (R)</th>
                                                            <th className="text-right px-2 py-1.5 font-medium text-gray-600">ERP</th>
                                                            <th className="text-right px-2 py-1.5 font-medium text-gray-600">Diff</th>
                                                        </tr>
                                                    </thead>
                                                    <tbody className="divide-y">
                                                        {items.map((c, i) => (
                                                            <tr key={i} className="hover:bg-gray-50">
                                                                <td className="px-2 py-1 font-mono text-gray-700">{c.skuCode}</td>
                                                                <td className="px-2 py-1 text-gray-600 truncate max-w-[180px]" title={`${c.productName} / ${c.colorName} / ${c.size}`}>
                                                                    {c.productName}{c.colorName ? ` / ${c.colorName}` : ''}{c.size ? ` / ${c.size}` : ''}
                                                                </td>
                                                                <td className="px-2 py-1 text-right text-gray-500">{c.sheetValue}</td>
                                                                <td className="px-2 py-1 text-right font-medium text-gray-900">{c.dbValue}</td>
                                                                <td className={`px-2 py-1 text-right font-medium ${c.dbValue > c.sheetValue ? 'text-emerald-600' : 'text-red-600'}`}>
                                                                    {c.dbValue - c.sheetValue > 0 ? '+' : ''}{c.dbValue - c.sheetValue}
                                                                </td>
                                                            </tr>
                                                        ))}
                                                    </tbody>
                                                </table>
                                                {total > items.length && (
                                                    <div className="px-2 py-1 bg-gray-50 text-[10px] text-gray-400 text-center">
                                                        Showing {items.length} of {total}
                                                    </div>
                                                )}
                                            </div>
                                        </div>
                                    );
                                    return (
                                        <>
                                            {renderTable(mastersheet, 'Mastersheet Inventory', syncCheckResult.mastersheetWouldChange)}
                                            {renderTable(ledger, 'Office Ledger Balance', syncCheckResult.ledgerWouldChange)}
                                        </>
                                    );
                                })()}
                            </div>
                        )}
                    </div>
                ) : (
                    <div className="text-xs text-gray-400 text-center py-2">
                        Click "Check Sync" to compare ERP balances against the Sheet R column
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
                            <BalanceVerificationBadge verification={inwardState.lastResult.balanceVerification as BalanceVerification | undefined} />
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
                            <BalanceVerificationBadge verification={outwardState.lastResult.balanceVerification as BalanceVerification | undefined} />
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
