/**
 * Typed result interfaces for background jobs.
 *
 * These mirror the backend types in:
 *   server/src/services/sheetOffloadWorker.ts (sheet offload jobs)
 *   server/src/routes/admin.ts (offload status endpoint)
 */

// ============================================
// SHARED HELPERS
// ============================================

/** Map of reason string -> count, used for validation errors and skip reasons */
export type ErrorReasonsMap = Record<string, number>;

// ============================================
// SHEET OFFLOAD PREVIEW RESULTS
// ============================================

/** Dry-run preview of an ingest job — mirrors server's IngestPreviewResult */
export interface IngestPreviewResult {
    tab: string;
    totalRows: number;
    valid: number;
    invalid: number;
    duplicates: number;
    validationErrors: ErrorReasonsMap;
    skipReasons?: ErrorReasonsMap;
    affectedSkuCodes: string[];
    durationMs: number;
}

// ============================================
// SHEET OFFLOAD JOB RESULTS
// ============================================

export interface IngestInwardResult {
    startedAt: string;
    inwardIngested: number;
    skipped: number;
    rowsMarkedDone: number;
    skusUpdated: number;
    errors: number;
    durationMs: number;
    error: string | null;
    inwardValidationErrors: ErrorReasonsMap;
}

export interface IngestOutwardResult {
    startedAt: string;
    outwardIngested: number;
    ordersLinked: number;
    skipped: number;
    rowsMarkedDone: number;
    skusUpdated: number;
    errors: number;
    durationMs: number;
    error: string | null;
    outwardSkipReasons?: ErrorReasonsMap;
}

export interface CleanupDoneResult {
    startedAt: string;
    inwardDeleted: number;
    outwardDeleted: number;
    errors: string[];
    durationMs: number;
}

export interface MigrateFormulasResult {
    startedAt: string;
    inventoryRowsUpdated: number;
    balanceFinalRowsUpdated: number;
    errors: string[];
    durationMs: number;
}

export interface MoveShippedResult {
    shippedRowsFound: number;
    skippedRows: number;
    skipReasons: ErrorReasonsMap;
    rowsWrittenToOutward: number;
    rowsVerified: number;
    rowsDeletedFromOrders: number;
    errors: string[];
    durationMs: number;
}

// ============================================
// OTHER BACKGROUND JOB RESULTS
// ============================================

export interface ShopifySyncResult {
    step1_dump?: { fetched: number; cached: number };
    step2_process?: { found: number; processed: number; failed: number };
    durationMs?: number;
    error?: string;
}

export interface TrackingSyncResult {
    awbsChecked: number;
    updated: number;
    delivered: number;
    rto: number;
    apiCalls: number;
    errors: number;
    durationMs?: number;
}

export interface CacheCleanupResult {
    totalDeleted?: number;
    durationMs?: number;
}

export interface CacheStats {
    orderCache?: { total: number; olderThan30Days: number };
    productCache?: { total: number; olderThan30Days: number };
    webhookLogs?: { total: number; olderThan30Days: number };
    failedSyncItems?: { total: number };
    syncJobs?: { total: number };
}

// ============================================
// OFFLOAD STATUS ENDPOINT RESPONSE
// ============================================

export interface JobStateResponse {
    isRunning: boolean;
    lastRunAt: string | null;
    lastResult: Record<string, unknown> | null;
    recentRuns: Array<{
        startedAt: string;
        durationMs: number;
        count: number;
        error: string | null;
    }>;
}

export interface BufferCounts {
    inward: number;
    outward: number;
}

export interface OffloadStatusResponse {
    ingestInward: JobStateResponse;
    ingestOutward: JobStateResponse;
    moveShipped: JobStateResponse;
    cleanupDone: JobStateResponse;
    migrateFormulas: JobStateResponse;
    schedulerActive: boolean;
    bufferCounts: BufferCounts;
}
