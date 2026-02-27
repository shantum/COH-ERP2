/**
 * Module-level state for the sheet offload worker.
 * All mutable state lives here so other modules can import and share it.
 */

// ============================================
// TYPES
// ============================================

/** Fabric consumption line for a single fabric colour */
export interface FabricConsumptionLine {
    fabricName: string;
    colourName: string;
    unit: string;
    piecesProduced: number;
    fabricConsumed: number;
    remainingBalance: number;
}

export interface IngestInwardResult {
    startedAt: string;
    inwardIngested: number;
    skipped: number;
    rowsMarkedDone: number;
    skusUpdated: number;
    errors: number;
    durationMs: number;
    error: string | null;
    inwardValidationErrors: Record<string, number>;
    balanceVerification?: BalanceVerificationResult;
    fabricConsumption?: FabricConsumptionLine[];
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
    outwardSkipReasons?: Record<string, number>;
    balanceVerification?: BalanceVerificationResult;
}

export interface CleanupDoneResult {
    startedAt: string;
    inwardDeleted: number;
    outwardDeleted: number;
    fabricInwardDeleted: number;
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

export interface PushBalancesResult {
    startedAt: string;
    skusUpdated: number;
    errors: number;
    durationMs: number;
    error: string | null;
}

export interface PushFabricBalancesResult {
    startedAt: string;
    totalColours: number;
    newColoursAdded: number;
    balancesUpdated: number;
    errors: number;
    durationMs: number;
    error: string | null;
}

export interface ImportFabricBalancesResult {
    startedAt: string;
    rowsWithCounts: number;
    adjustmentsCreated: number;
    alreadyMatching: number;
    skipped: number;
    skipReasons: Record<string, number>;
    adjustments: Array<{
        fabricCode: string;
        colour: string;
        fabric: string;
        systemBalance: number;
        physicalCount: number;
        delta: number;
        type: 'inward' | 'outward';
    }>;
    durationMs: number;
    error: string | null;
}

export interface FabricInwardResult {
    startedAt: string;
    imported: number;
    skipped: number;
    rowsMarkedDone: number;
    suppliersCreated: number;
    errors: number;
    durationMs: number;
    error: string | null;
    validationErrors: Record<string, number>;
}

export interface FabricInwardPreviewRow {
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

export interface FabricInwardPreviewResult {
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

export interface PushBalancesPreviewResult {
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

export interface MoveShippedResult {
    shippedRowsFound: number;
    skippedRows: number;
    skipReasons: Record<string, number>;
    rowsWrittenToOutward: number;
    rowsVerified: number;
    rowsDeletedFromOrders: number;
    errors: string[];
    durationMs: number;
}

export interface InwardPreviewRow {
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

export interface OutwardPreviewRow {
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

export interface IngestPreviewResult {
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
        skuBalances: Array<{
            skuCode: string;
            qty: number;
            erpBalance: number;
            afterErpBalance: number;
            sheetPending: number;
            afterSheetPending: number;
            colC: number;
            inSync: boolean;
        }>;
        allInSync: boolean;
    };
}

export interface BalanceSnapshot {
    balances: Map<string, { c: number; d: number; e: number; r: number }>;
    rowCount: number;
    timestamp: string;
}

export interface BalanceVerificationResult {
    passed: boolean;
    totalSkusChecked: number;
    drifted: number;
    sampleDrifts: Array<{
        skuCode: string;
        before: { c: number; d: number; e: number; r: number };
        after: { c: number; d: number; e: number; r: number };
        cDelta: number;
    }>;
    snapshotBeforeMs: number;
    snapshotAfterMs: number;
}

export interface RunSummary {
    startedAt: string;
    durationMs: number;
    count: number;        // inwardIngested or outwardIngested or rowsWrittenToOutward
    error: string | null;
}

export interface JobState<T> {
    isRunning: boolean;
    lastRunAt: Date | null;
    lastResult: T | null;
    recentRuns: RunSummary[];
}

export interface OffloadStatus {
    ingestInward: JobState<IngestInwardResult>;
    ingestOutward: JobState<IngestOutwardResult>;
    moveShipped: JobState<MoveShippedResult>;
    cleanupDone: JobState<CleanupDoneResult>;
    migrateFormulas: JobState<MigrateFormulasResult>;
    pushBalances: JobState<PushBalancesResult>;
    pushFabricBalances: JobState<PushFabricBalancesResult>;
    importFabricBalances: JobState<ImportFabricBalancesResult>;
    fabricInward: JobState<FabricInwardResult>;
    schedulerActive: boolean;
}

export interface ParsedRow {
    rowIndex: number;       // 0-based index in the sheet (including header)
    skuCode: string;
    qty: number;
    date: Date | null;
    source: string;         // inward: source, outward: destination
    extra: string;          // inward: doneBy, outward: orderNumber
    tailor: string;         // inward only
    barcode: string;        // inward only — unique piece barcode from col G
    userNotes: string;      // inward only — user-entered notes from col I
    orderNotes: string;     // outward only — Order Note from col K
    cohNotes: string;       // outward only — COH Note from col L
    courier: string;        // outward only — from sheet col Z
    awb: string;            // outward only — from sheet col AA
    referenceId: string;
    notes: string;
}

/** An outward item that has an orderNumber and can be linked to an OrderLine. */
export interface LinkableOutward {
    orderNumber: string;
    skuId: string;
    qty: number;
    date: Date | null;
    courier: string;
    awb: string;
}

/** Internal accumulator for markRowsIngested — shared across job types. */
export interface MarkTracker {
    rowsMarkedDone: number;
    errors: number;
}

export interface SkuLookupInfo {
    id: string;
    variationId: string;
    isActive: boolean;
}

export interface OrderMapEntry {
    id: string;
    orderNumber: string;  // the actual ERP orderNumber (may differ from the sheet key)
    orderLines: Array<{ id: string; skuId: string; qty: number; lineStatus: string }>;
}

export interface OutwardValidationResult {
    validRows: ParsedRow[];
    skipReasons: Record<string, number>;
    orderMap: Map<string, OrderMapEntry>;
    /** ERP orderNumber|skuId keys that already have OUTWARD txns in DB */
    existingOrderSkuKeys: Set<string>;
}

/**
 * Optional step tracker passed into ingest functions for granular progress updates.
 */
export interface StepTracker {
    start(name: string): number;
    done(name: string, startMs: number, detail?: string): void;
    fail(name: string, startMs: number, error: string): void;
}

// ============================================
// CYCLE PROGRESS TYPES
// ============================================

export interface CycleStep {
    name: string;
    status: 'pending' | 'running' | 'done' | 'failed' | 'skipped';
    detail?: string;
    durationMs?: number;
    error?: string;
}

export interface CycleProgressState {
    isRunning: boolean;
    type: 'inward' | 'outward' | null;
    startedAt: string | null;
    completedAt: string | null;
    steps: CycleStep[];
    totalDurationMs?: number;
}

// ============================================
// STATE
// ============================================

export let schedulerActive = false;

export function setSchedulerActive(value: boolean): void {
    schedulerActive = value;
}

export const MAX_RECENT_RUNS = 10;

// Per-job state
export const ingestInwardState: JobState<IngestInwardResult> = {
    isRunning: false,
    lastRunAt: null,
    lastResult: null,
    recentRuns: [],
};

export const ingestOutwardState: JobState<IngestOutwardResult> = {
    isRunning: false,
    lastRunAt: null,
    lastResult: null,
    recentRuns: [],
};

export const moveShippedState: JobState<MoveShippedResult> = {
    isRunning: false,
    lastRunAt: null,
    lastResult: null,
    recentRuns: [],
};

export const cleanupDoneState: JobState<CleanupDoneResult> = {
    isRunning: false,
    lastRunAt: null,
    lastResult: null,
    recentRuns: [],
};

export const migrateFormulasState: JobState<MigrateFormulasResult> = {
    isRunning: false,
    lastRunAt: null,
    lastResult: null,
    recentRuns: [],
};

export const pushBalancesState: JobState<PushBalancesResult> = {
    isRunning: false,
    lastRunAt: null,
    lastResult: null,
    recentRuns: [],
};

export const pushFabricBalancesState: JobState<PushFabricBalancesResult> = {
    isRunning: false,
    lastRunAt: null,
    lastResult: null,
    recentRuns: [],
};

export const importFabricBalancesState: JobState<ImportFabricBalancesResult> = {
    isRunning: false,
    lastRunAt: null,
    lastResult: null,
    recentRuns: [],
};

export const fabricInwardState: JobState<FabricInwardResult> = {
    isRunning: false,
    lastRunAt: null,
    lastResult: null,
    recentRuns: [],
};

// ============================================
// CYCLE PROGRESS STATE
// ============================================

export const cycleProgress: CycleProgressState = {
    isRunning: false,
    type: null,
    startedAt: null,
    completedAt: null,
    steps: [],
};

export const INWARD_STEPS = [
    'Balance check',
    'CSV backup',
    'Push balances',
    'DB health check',
    'Read sheet rows',
    'Validate rows',
    'DB write',
    'Mark DONE',
    'Protect DONE rows',
    'Push updated balances',
    'Verify balances',
    'Cleanup DONE rows',
    'Summary',
];

export const OUTWARD_STEPS = [
    'Balance check',
    'CSV backup',
    'Push balances',
    'DB health check',
    'Read sheet rows',
    'Validate rows',
    'DB write',
    'Link orders',
    'Book COGS',
    'Mark DONE',
    'Push updated balances',
    'Verify balances',
    'Cleanup DONE rows',
    'Summary',
];

export function initCycleSteps(type: 'inward' | 'outward'): void {
    const names = type === 'inward' ? INWARD_STEPS : OUTWARD_STEPS;
    cycleProgress.isRunning = true;
    cycleProgress.type = type;
    cycleProgress.startedAt = new Date().toISOString();
    cycleProgress.completedAt = null;
    cycleProgress.totalDurationMs = undefined;
    cycleProgress.steps = names.map(name => ({ name, status: 'pending' }));
}

export function getStep(name: string): CycleStep | undefined {
    return cycleProgress.steps.find(s => s.name === name);
}

export function stepStart(name: string): number {
    const step = getStep(name);
    if (step) {
        step.status = 'running';
        step.detail = undefined;
        step.error = undefined;
        step.durationMs = undefined;
    }
    return Date.now();
}

export function stepDone(name: string, startMs: number, detail?: string): void {
    const step = getStep(name);
    if (step) {
        step.status = 'done';
        step.durationMs = Date.now() - startMs;
        if (detail) step.detail = detail;
    }
}

export function stepFailed(name: string, startMs: number, error: string): void {
    const step = getStep(name);
    if (step) {
        step.status = 'failed';
        step.durationMs = Date.now() - startMs;
        step.error = error;
    }
}

export function stepSkipped(name: string, detail?: string): void {
    const step = getStep(name);
    if (step) {
        step.status = 'skipped';
        if (detail) step.detail = detail;
    }
}

export function skipRemainingSteps(): void {
    for (const step of cycleProgress.steps) {
        if (step.status === 'pending') {
            step.status = 'skipped';
        }
    }
}

export function finishCycle(startMs: number): void {
    cycleProgress.isRunning = false;
    cycleProgress.completedAt = new Date().toISOString();
    cycleProgress.totalDurationMs = Date.now() - startMs;
}

export function getCycleProgress(): CycleProgressState {
    return { ...cycleProgress, steps: cycleProgress.steps.map(s => ({ ...s })) };
}

export function resetCycleProgress(): void {
    cycleProgress.isRunning = false;
    cycleProgress.type = null;
    cycleProgress.startedAt = null;
    cycleProgress.completedAt = null;
    cycleProgress.totalDurationMs = undefined;
    cycleProgress.steps = [];
}

// Cached admin user id
export let cachedAdminUserId: string | null = null;

export function setCachedAdminUserId(id: string): void {
    cachedAdminUserId = id;
}
