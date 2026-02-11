/**
 * Result card components for background jobs.
 *
 * Each card renders the "last run result" for a specific job type.
 * Shared helpers: StatCard, DurationFooter, ErrorReasonsList.
 */

import React from 'react';
import { Database } from 'lucide-react';
import type {
    IngestInwardResult,
    IngestOutwardResult,
    IngestPreviewResult,
    MoveShippedResult,
    CleanupDoneResult,
    MigrateFormulasResult,
    ShopifySyncResult,
    TrackingSyncResult,
    CacheCleanupResult,
    CacheStats,
    ErrorReasonsMap,
    PushBalancesPreviewResult,
} from './sheetJobTypes';

// ============================================
// SHARED HELPERS (internal)
// ============================================

function StatCard({ label, value, color = 'text-gray-900' }: { label: string; value: number | string; color?: string }) {
    return (
        <div className="bg-white p-2 rounded border">
            <p className="font-medium text-gray-700">{label}</p>
            <p className={`text-lg font-semibold ${color}`}>{value}</p>
        </div>
    );
}

function DurationFooter({ durationMs, errors, errorLabel = 'Errors' }: { durationMs?: number; errors?: number; errorLabel?: string }) {
    if (durationMs == null) return null;
    return (
        <div className="bg-white p-2 rounded border col-span-2 md:col-span-4">
            <p className="text-gray-600">
                Duration: {(durationMs / 1000).toFixed(1)}s
                {errors != null && errors > 0 && (
                    <span className="text-red-600"> | {errorLabel}: {errors}</span>
                )}
            </p>
        </div>
    );
}

/** Renders a Record<string, number> as a compact list of reason -> count */
export function ErrorReasonsList({
    title,
    reasons,
    variant = 'red',
}: {
    title: string;
    reasons: ErrorReasonsMap | undefined;
    variant?: 'red' | 'amber' | 'gray';
}) {
    if (!reasons || Object.keys(reasons).length === 0) return null;

    const colorMap = {
        red: { bg: 'bg-red-50', border: 'border-red-200', title: 'text-red-700', text: 'text-red-600' },
        amber: { bg: 'bg-amber-50', border: 'border-amber-200', title: 'text-amber-700', text: 'text-amber-600' },
        gray: { bg: 'bg-gray-50', border: 'border-gray-200', title: 'text-gray-700', text: 'text-gray-600' },
    };
    const c = colorMap[variant];

    return (
        <div className={`${c.bg} p-2 rounded border ${c.border} col-span-2 md:col-span-4`}>
            <p className={`font-medium ${c.title} text-xs mb-1`}>{title}</p>
            <ul className="space-y-0.5">
                {Object.entries(reasons).map(([reason, count]) => (
                    <li key={reason} className={`text-xs ${c.text}`}>
                        {reason}: {count}
                    </li>
                ))}
            </ul>
        </div>
    );
}

// ============================================
// INGEST PREVIEW CARD (DRY-RUN)
// ============================================

export const IngestPreviewCard = React.memo(function IngestPreviewCard({
    preview,
}: {
    preview: IngestPreviewResult;
}) {
    const [showSkus, setShowSkus] = React.useState(false);
    const skuCount = preview.affectedSkuCodes.length;

    return (
        <div className="space-y-1.5 text-xs">
            {/* Summary line */}
            <div className="flex items-center gap-2 flex-wrap">
                {preview.valid > 0 && (
                    <span className="text-emerald-700 font-medium">{preview.valid} valid</span>
                )}
                {preview.invalid > 0 && (
                    <span className="text-red-600 font-medium">{preview.invalid} invalid</span>
                )}
                {preview.duplicates > 0 && (
                    <span className="text-gray-500">{preview.duplicates} duplicate</span>
                )}
                {preview.valid === 0 && preview.invalid === 0 && preview.duplicates === 0 && (
                    <span className="text-gray-400">No rows</span>
                )}
            </div>

            {/* Validation errors */}
            <ErrorReasonsList title="Validation Errors" reasons={preview.validationErrors} variant="red" />

            {/* Skip reasons */}
            <ErrorReasonsList title="Skip Reasons" reasons={preview.skipReasons} variant="amber" />

            {/* Affected SKUs (collapsed) */}
            {skuCount > 0 && (
                <div>
                    <button
                        onClick={() => setShowSkus(!showSkus)}
                        className="text-gray-500 hover:text-gray-700 text-xs"
                    >
                        {showSkus ? 'Hide' : 'Show'} {skuCount} affected SKU{skuCount !== 1 ? 's' : ''}
                    </button>
                    {showSkus && (
                        <p className="text-gray-500 mt-0.5">
                            {preview.affectedSkuCodes.slice(0, 10).join(', ')}
                            {skuCount > 10 && ` ...+${skuCount - 10} more`}
                        </p>
                    )}
                </div>
            )}
        </div>
    );
});

// ============================================
// SHEET OFFLOAD RESULT CARDS
// ============================================

export const IngestInwardResultCard = React.memo(function IngestInwardResultCard({
    result,
}: {
    result: IngestInwardResult;
}) {
    return (
        <div className="mt-2 grid grid-cols-2 md:grid-cols-4 gap-2 text-xs">
            <StatCard label="Ingested" value={result.inwardIngested ?? 0} color="text-emerald-600" />
            <StatCard label="Skipped" value={result.skipped ?? 0} />
            <StatCard label="SKUs Updated" value={result.skusUpdated ?? 0} color="text-purple-600" />
            <StatCard label="Rows Marked Done" value={result.rowsMarkedDone ?? 0} />
            <DurationFooter durationMs={result.durationMs} errors={result.errors} />
            <ErrorReasonsList title="Validation Errors" reasons={result.inwardValidationErrors} variant="red" />
            {result.error && (
                <div className="bg-red-50 p-2 rounded border border-red-200 col-span-2 md:col-span-4">
                    <p className="text-red-700">{result.error}</p>
                </div>
            )}
        </div>
    );
});

export const IngestOutwardResultCard = React.memo(function IngestOutwardResultCard({
    result,
}: {
    result: IngestOutwardResult;
}) {
    return (
        <div className="mt-2 grid grid-cols-2 md:grid-cols-4 gap-2 text-xs">
            <StatCard label="Ingested" value={result.outwardIngested ?? 0} color="text-blue-600" />
            <StatCard label="Orders Linked" value={result.ordersLinked ?? 0} color="text-green-600" />
            <StatCard label="SKUs Updated" value={result.skusUpdated ?? 0} color="text-purple-600" />
            <StatCard label="Skipped" value={result.skipped ?? 0} />
            <DurationFooter durationMs={result.durationMs} errors={result.errors} />
            <ErrorReasonsList title="Skip Reasons" reasons={result.outwardSkipReasons} variant="amber" />
            {result.error && (
                <div className="bg-red-50 p-2 rounded border border-red-200 col-span-2 md:col-span-4">
                    <p className="text-red-700">{result.error}</p>
                </div>
            )}
        </div>
    );
});

export const MoveShippedResultCard = React.memo(function MoveShippedResultCard({
    result,
}: {
    result: MoveShippedResult;
}) {
    return (
        <div className="mt-2 grid grid-cols-2 md:grid-cols-4 gap-2 text-xs">
            <StatCard label="Shipped Found" value={result.shippedRowsFound ?? 0} />
            <StatCard label="Written" value={result.rowsWrittenToOutward ?? 0} color="text-amber-600" />
            <StatCard label="Verified" value={result.rowsVerified ?? 0} color="text-green-600" />
            <StatCard label="Deleted" value={result.rowsDeletedFromOrders ?? 0} />
            <DurationFooter durationMs={result.durationMs} />
            {result.skippedRows > 0 && (
                <div className="bg-amber-50 p-2 rounded border border-amber-200 col-span-2 md:col-span-4">
                    <p className="text-amber-600 text-xs">Skipped: {result.skippedRows}</p>
                </div>
            )}
            <ErrorReasonsList title="Skip Reasons" reasons={result.skipReasons} variant="amber" />
            {result.errors?.length > 0 && (
                <div className="bg-red-50 p-2 rounded border border-red-200 col-span-2 md:col-span-4">
                    {result.errors.slice(0, 3).map((err, i) => (
                        <p key={i} className="text-red-700 text-xs">{err}</p>
                    ))}
                    {result.errors.length > 3 && (
                        <p className="text-red-400 text-xs">...and {result.errors.length - 3} more</p>
                    )}
                </div>
            )}
        </div>
    );
});

// ============================================
// CLEANUP & MIGRATION RESULT CARDS
// ============================================

export const CleanupDoneResultCard = React.memo(function CleanupDoneResultCard({
    result,
}: {
    result: CleanupDoneResult;
}) {
    return (
        <div className="mt-2 grid grid-cols-2 md:grid-cols-4 gap-2 text-xs">
            <StatCard label="Inward Deleted" value={result.inwardDeleted ?? 0} color="text-emerald-600" />
            <StatCard label="Outward Deleted" value={result.outwardDeleted ?? 0} color="text-blue-600" />
            <DurationFooter durationMs={result.durationMs} />
            {result.errors?.length > 0 && (
                <div className="bg-red-50 p-2 rounded border border-red-200 col-span-2 md:col-span-4">
                    {result.errors.slice(0, 3).map((err, i) => (
                        <p key={i} className="text-red-700 text-xs">{err}</p>
                    ))}
                </div>
            )}
        </div>
    );
});

export const MigrateFormulasResultCard = React.memo(function MigrateFormulasResultCard({
    result,
}: {
    result: MigrateFormulasResult;
}) {
    return (
        <div className="mt-2 grid grid-cols-2 md:grid-cols-4 gap-2 text-xs">
            <StatCard label="Inventory Rows" value={result.inventoryRowsUpdated ?? 0} color="text-emerald-600" />
            <StatCard label="Balance Rows" value={result.balanceFinalRowsUpdated ?? 0} color="text-blue-600" />
            <DurationFooter durationMs={result.durationMs} />
            {result.errors?.length > 0 && (
                <div className="bg-red-50 p-2 rounded border border-red-200 col-span-2 md:col-span-4">
                    {result.errors.slice(0, 3).map((err, i) => (
                        <p key={i} className="text-red-700 text-xs">{err}</p>
                    ))}
                </div>
            )}
        </div>
    );
});

// ============================================
// PUSH BALANCES PREVIEW CARD
// ============================================

export const PushBalancesPreviewCard = React.memo(function PushBalancesPreviewCard({
    preview,
}: {
    preview: PushBalancesPreviewResult;
}) {
    const [showChanges, setShowChanges] = React.useState(false);

    return (
        <div className="space-y-1.5 text-xs">
            {/* Summary line */}
            <div className="flex items-center gap-2 flex-wrap">
                {preview.wouldChange > 0 && (
                    <span className="text-amber-700 font-medium">{preview.wouldChange} would change</span>
                )}
                {preview.alreadyCorrect > 0 && (
                    <span className="text-emerald-600 font-medium">{preview.alreadyCorrect} already correct</span>
                )}
                <span className="text-gray-400">{preview.totalSkusInDb} SKUs in DB</span>
            </div>

            {/* Per-sheet breakdown */}
            <div className="flex gap-3 text-gray-500">
                <span>Mastersheet: {preview.mastersheetWouldChange} diff / {preview.mastersheetMatched} ok</span>
                <span>Ledger: {preview.ledgerWouldChange} diff / {preview.ledgerMatched} ok</span>
            </div>

            {/* Sample changes (collapsed) */}
            {preview.sampleChanges.length > 0 && (
                <div>
                    <button
                        onClick={() => setShowChanges(!showChanges)}
                        className="text-gray-500 hover:text-gray-700 text-xs"
                    >
                        {showChanges ? 'Hide' : 'Show'} sample changes ({preview.sampleChanges.length})
                    </button>
                    {showChanges && (
                        <div className="mt-1 space-y-0.5">
                            {preview.sampleChanges.map((c, i) => (
                                <p key={i} className="text-gray-600">
                                    <span className="font-medium">{c.skuCode}</span>
                                    <span className="text-gray-400"> ({c.sheet})</span>
                                    : {c.sheetValue} → {c.dbValue}
                                </p>
                            ))}
                        </div>
                    )}
                </div>
            )}

            {/* Duration */}
            <p className="text-gray-400">{(preview.durationMs / 1000).toFixed(1)}s</p>
        </div>
    );
});

// ============================================
// OTHER BACKGROUND JOB RESULT CARDS
// ============================================

export const ShopifySyncResultCard = React.memo(function ShopifySyncResultCard({
    result,
}: {
    result: ShopifySyncResult;
}) {
    return (
        <div className="mt-2 grid grid-cols-2 gap-2 text-xs">
            {result.step1_dump && (
                <div className="bg-white p-2 rounded border">
                    <p className="font-medium text-gray-700">Order Fetch</p>
                    <p className="text-gray-600">
                        Fetched: {result.step1_dump.fetched} | Cached: {result.step1_dump.cached}
                    </p>
                </div>
            )}
            {result.step2_process && (
                <div className="bg-white p-2 rounded border">
                    <p className="font-medium text-gray-700">Processing</p>
                    <p className="text-gray-600">
                        Found: {result.step2_process.found} | Processed: {result.step2_process.processed}
                        {result.step2_process.failed > 0 && (
                            <span className="text-red-600"> | Failed: {result.step2_process.failed}</span>
                        )}
                    </p>
                </div>
            )}
            <DurationFooter durationMs={result.durationMs} />
            {result.error && (
                <div className="bg-red-50 p-2 rounded border border-red-200 col-span-2">
                    <p className="text-red-700">{result.error}</p>
                </div>
            )}
        </div>
    );
});

export const TrackingSyncResultCard = React.memo(function TrackingSyncResultCard({
    result,
}: {
    result: TrackingSyncResult;
}) {
    return (
        <div className="mt-2 grid grid-cols-2 md:grid-cols-4 gap-2 text-xs">
            <StatCard label="AWBs Checked" value={result.awbsChecked ?? 0} />
            <StatCard label="Updated" value={result.updated ?? 0} color="text-blue-600" />
            <StatCard label="Delivered" value={result.delivered ?? 0} color="text-green-600" />
            <StatCard label="RTO" value={result.rto ?? 0} color="text-orange-600" />
            {result.durationMs != null && (
                <div className="bg-white p-2 rounded border col-span-2 md:col-span-4">
                    <p className="text-gray-600">
                        Duration: {(result.durationMs / 1000).toFixed(1)}s | API Calls: {result.apiCalls ?? 0}
                        {result.errors > 0 && <span className="text-red-600"> | Errors: {result.errors}</span>}
                    </p>
                </div>
            )}
        </div>
    );
});

export const CacheCleanupResultCard = React.memo(function CacheCleanupResultCard({
    result,
    stats,
}: {
    result: CacheCleanupResult;
    stats?: CacheStats;
}) {
    return (
        <div className="mt-2 text-xs space-y-3">
            {result.totalDeleted !== undefined && (
                <div className="bg-white p-2 rounded border">
                    <p className="text-gray-600">
                        Deleted: {result.totalDeleted} entries | Duration: {result.durationMs}ms
                    </p>
                </div>
            )}
            {stats && (
                <div className="pt-3 border-t">
                    <p className="text-xs font-medium text-gray-700 mb-2 flex items-center gap-1">
                        <Database size={14} /> Cache Statistics
                    </p>
                    <div className="grid grid-cols-2 md:grid-cols-3 gap-2 text-xs">
                        <div className="bg-white p-2 rounded border">
                            <p className="font-medium text-gray-600">Order Cache</p>
                            <p className="text-gray-900">
                                {stats.orderCache?.total ?? 0} total
                                <span className="text-gray-500"> ({stats.orderCache?.olderThan30Days ?? 0} older than 30d)</span>
                            </p>
                        </div>
                        <div className="bg-white p-2 rounded border">
                            <p className="font-medium text-gray-600">Product Cache</p>
                            <p className="text-gray-900">
                                {stats.productCache?.total ?? 0} total
                                <span className="text-gray-500"> ({stats.productCache?.olderThan30Days ?? 0} older than 30d)</span>
                            </p>
                        </div>
                        <div className="bg-white p-2 rounded border">
                            <p className="font-medium text-gray-600">Webhook Logs</p>
                            <p className="text-gray-900">
                                {stats.webhookLogs?.total ?? 0} total
                                <span className="text-gray-500"> ({stats.webhookLogs?.olderThan30Days ?? 0} older than 30d)</span>
                            </p>
                        </div>
                        <div className="bg-white p-2 rounded border">
                            <p className="font-medium text-gray-600">Failed Syncs</p>
                            <p className="text-gray-900">{stats.failedSyncItems?.total ?? 0}</p>
                        </div>
                        <div className="bg-white p-2 rounded border">
                            <p className="font-medium text-gray-600">Sync Jobs</p>
                            <p className="text-gray-900">{stats.syncJobs?.total ?? 0}</p>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
});
