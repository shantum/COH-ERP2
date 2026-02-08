/**
 * Sheet Sync Service
 *
 * In-memory job orchestrator that wraps the existing plan/execute functions
 * from server/src/scripts/lib/. Tracks job state for progress polling.
 */

import { randomUUID } from 'crypto';
import type { PrismaClient } from '@prisma/client';
import { parseAllCsvsFromStrings } from '../scripts/lib/csvParser.js';
import type { ParsedData } from '../scripts/lib/csvParser.js';
import {
    // planShipAndRelease, executeShipAndRelease — disabled (evidence-based fulfillment)
    planCreateOrders,
    executeCreateOrders,
    planSyncNotes,
    executeSyncNotes,
    // planLineStatusSync, executeLineStatusSync — disabled (evidence-based fulfillment)
    planProductionBatchSync,
    executeProductionBatchSync,
    type ShipAndReleaseReport,
    type CreateOrderReport,
    type SyncNotesReport,
    type LineStatusSyncReport,
    type ProductionBatchSyncReport,
} from '../scripts/lib/orderSync.js';
import {
    planInventoryReconcile,
    executeInventoryReconcile,
    type InventoryReconcileReport,
} from '../scripts/lib/inventorySync.js';

// ============================================
// TYPES
// ============================================

export interface StepSummary {
    name: string;
    description: string;
}

export interface StepResult {
    stepIndex: number;
    stepName: string;
    status: 'pending' | 'running' | 'completed' | 'failed';
    summary: string;
    errors: string[];
}

export interface PlanReport {
    parseSummary: {
        orderRows: number;
        uniqueOrders: number;
        inventoryRows: number;
    };
    steps: Array<{
        stepIndex: number;
        stepName: string;
        summary: string;
        details: Record<string, unknown>;
    }>;
}

export interface SheetSyncJob {
    id: string;
    status: 'planning' | 'planned' | 'executing' | 'completed' | 'failed';
    startedAt: Date;
    completedAt: Date | null;
    userId: string;
    planReport: PlanReport | null;
    currentStep: number;
    stepResults: StepResult[];
    errors: string[];
}

// Internal state stored alongside the job for execution
interface JobInternals {
    parsedData: ParsedData;
    shipReport: ShipAndReleaseReport;
    createReport: CreateOrderReport;
    notesReport: SyncNotesReport;
    statusReport: LineStatusSyncReport;
    batchReport: ProductionBatchSyncReport;
    inventoryReport: InventoryReconcileReport;
}

// ============================================
// STEP DEFINITIONS
// ============================================

const STEP_NAMES = [
    'Ship & Release',
    'Create Orders',
    'Sync Notes',
    'Sync Line Statuses',
    'Production Batches',
    'Inventory Reconcile',
] as const;

// ============================================
// JOB STORE
// ============================================

const jobs = new Map<string, SheetSyncJob>();
const jobInternals = new Map<string, JobInternals>();
const MAX_JOBS = 20;

function pruneOldJobs(): void {
    if (jobs.size <= MAX_JOBS) return;
    const sorted = [...jobs.entries()].sort(
        (a, b) => a[1].startedAt.getTime() - b[1].startedAt.getTime()
    );
    const toRemove = sorted.slice(0, sorted.length - MAX_JOBS);
    for (const [id] of toRemove) {
        jobs.delete(id);
        jobInternals.delete(id);
    }
}

// ============================================
// PUBLIC API
// ============================================

/**
 * Plan a sync job from CSV strings.
 * Synchronous-ish (runs all plan functions, may take 10-30s).
 * Returns the job with planReport populated.
 */
export async function planSync(
    prisma: PrismaClient,
    ordersCsv: string,
    inventoryCsv: string,
    userId: string
): Promise<SheetSyncJob> {
    pruneOldJobs();

    const jobId = randomUUID();
    const job: SheetSyncJob = {
        id: jobId,
        status: 'planning',
        startedAt: new Date(),
        completedAt: null,
        userId,
        planReport: null,
        currentStep: -1,
        stepResults: STEP_NAMES.map((name, i) => ({
            stepIndex: i,
            stepName: name,
            status: 'pending',
            summary: '',
            errors: [],
        })),
        errors: [],
    };
    jobs.set(jobId, job);

    try {
        // Step 1: Parse CSVs
        const parsedData = parseAllCsvsFromStrings(ordersCsv, inventoryCsv);

        // Run plan functions (Ship & Release and Line Status Sync are disabled —
        // fulfillment is now evidence-based via sheet outward transactions)
        const shipReport: ShipAndReleaseReport = { ordersToRelease: [] };
        const statusReport: LineStatusSyncReport = { transitions: [], awbUpdates: [], skipped: [] };

        const [createReport, notesReport, batchReport, inventoryReport] =
            await Promise.all([
                planCreateOrders(prisma, parsedData.ordersByNumber),
                planSyncNotes(prisma, parsedData.ordersByNumber),
                planProductionBatchSync(prisma, parsedData.ordersByNumber),
                planInventoryReconcile(prisma, parsedData.inventoryBySkuCode),
            ]);

        // Store internals for execution
        jobInternals.set(jobId, {
            parsedData,
            shipReport,
            createReport,
            notesReport,
            statusReport,
            batchReport,
            inventoryReport,
        });

        // Build plan report
        job.planReport = {
            parseSummary: {
                orderRows: parsedData.orderRows.length,
                uniqueOrders: parsedData.orderNumberSet.size,
                inventoryRows: parsedData.inventoryRows.length,
            },
            steps: [
                {
                    stepIndex: 0,
                    stepName: 'Ship & Release',
                    summary: 'Disabled — fulfillment is now evidence-based via sheet outward transactions',
                    details: { disabled: true },
                },
                {
                    stepIndex: 1,
                    stepName: 'Create Orders',
                    summary: `${createReport.ordersToCreate.length} marketplace orders to create`,
                    details: {
                        ordersToCreate: createReport.ordersToCreate.length,
                        withMissingSku: createReport.ordersToCreate.filter(o => o.missingSkus.length > 0).length,
                    },
                },
                {
                    stepIndex: 2,
                    stepName: 'Sync Notes',
                    summary: `${notesReport.ordersToUpdate.length} orders with notes to update`,
                    details: {
                        ordersToUpdate: notesReport.ordersToUpdate.length,
                    },
                },
                {
                    stepIndex: 3,
                    stepName: 'Sync Line Statuses',
                    summary: 'Disabled — fulfillment is now evidence-based via sheet outward transactions',
                    details: { disabled: true },
                },
                {
                    stepIndex: 4,
                    stepName: 'Production Batches',
                    summary: `${batchReport.assignments.length} new, ${batchReport.dateUpdates.length} date updates, ${batchReport.alreadyLinked} unchanged`,
                    details: {
                        newBatches: batchReport.assignments.length,
                        dateUpdates: batchReport.dateUpdates.length,
                        alreadyLinked: batchReport.alreadyLinked,
                        skipped: batchReport.skipped.length,
                    },
                },
                {
                    stepIndex: 5,
                    stepName: 'Inventory Reconcile',
                    summary: `${inventoryReport.summary.adjustmentsNeeded} adjustments (${inventoryReport.summary.skusInBalance} in balance, ${inventoryReport.skippedSkus.length} not found)`,
                    details: {
                        adjustments: inventoryReport.summary.adjustmentsNeeded,
                        inBalance: inventoryReport.summary.skusInBalance,
                        totalInward: inventoryReport.summary.totalInward,
                        totalOutward: inventoryReport.summary.totalOutward,
                        skippedSkus: inventoryReport.skippedSkus.length,
                    },
                },
            ],
        };

        job.status = 'planned';
        return job;
    } catch (error: unknown) {
        const message = error instanceof Error ? error.message : String(error);
        job.status = 'failed';
        job.errors.push(message);
        job.completedAt = new Date();
        return job;
    }
}

/**
 * Execute a planned sync job. Fires and forgets — runs in the background.
 * Call getJob() to poll progress.
 */
export function executeSync(
    prisma: PrismaClient,
    jobId: string
): void {
    const job = jobs.get(jobId);
    const internals = jobInternals.get(jobId);

    if (!job || !internals) {
        throw new Error(`Job ${jobId} not found`);
    }
    if (job.status !== 'planned') {
        throw new Error(`Job ${jobId} is in status "${job.status}", expected "planned"`);
    }

    job.status = 'executing';

    // Fire and forget — run steps sequentially in the background
    void runSteps(prisma, job, internals);
}

async function runSteps(
    prisma: PrismaClient,
    job: SheetSyncJob,
    internals: JobInternals
): Promise<void> {
    const { parsedData, shipReport, createReport, notesReport, statusReport, batchReport, inventoryReport } = internals;
    const userId = job.userId;

    const steps: Array<() => Promise<string>> = [
        // Step 0: Ship & Release (DISABLED — evidence-based fulfillment)
        async () => {
            return 'Skipped — fulfillment is now evidence-based';
        },
        // Step 1: Create Orders
        async () => {
            if (createReport.ordersToCreate.length === 0) return 'Nothing to do';
            const r = await executeCreateOrders(prisma, parsedData.ordersByNumber, createReport, userId);
            if (r.errors.length > 0) job.stepResults[1].errors = r.errors;
            return `${r.created} orders created`;
        },
        // Step 2: Sync Notes
        async () => {
            if (notesReport.ordersToUpdate.length === 0) return 'Nothing to do';
            const r = await executeSyncNotes(prisma, notesReport);
            if (r.errors.length > 0) job.stepResults[2].errors = r.errors;
            return `${r.updated} orders updated`;
        },
        // Step 3: Sync Line Statuses (DISABLED — evidence-based fulfillment)
        async () => {
            return 'Skipped — fulfillment is now evidence-based';
        },
        // Step 4: Production Batches
        async () => {
            if (batchReport.assignments.length === 0 && batchReport.dateUpdates.length === 0) return 'Nothing to do';
            const r = await executeProductionBatchSync(prisma, batchReport);
            if (r.errors.length > 0) job.stepResults[4].errors = r.errors;
            return `${r.created} created, ${r.dateUpdated} date updates`;
        },
        // Step 5: Inventory Reconcile
        async () => {
            if (inventoryReport.adjustments.length === 0) return 'Nothing to do';
            const r = await executeInventoryReconcile(prisma, inventoryReport, userId);
            if (r.errors.length > 0) job.stepResults[5].errors = r.errors;
            return `${r.adjusted} adjustments applied`;
        },
    ];

    for (let i = 0; i < steps.length; i++) {
        job.currentStep = i;
        job.stepResults[i].status = 'running';

        try {
            const summary = await steps[i]();
            job.stepResults[i].status = 'completed';
            job.stepResults[i].summary = summary;
        } catch (error: unknown) {
            const message = error instanceof Error ? error.message : String(error);
            job.stepResults[i].status = 'failed';
            job.stepResults[i].summary = `Failed: ${message}`;
            job.stepResults[i].errors.push(message);
            job.errors.push(`Step ${i} (${STEP_NAMES[i]}): ${message}`);
        }
    }

    job.status = job.errors.length > 0 ? 'failed' : 'completed';
    job.completedAt = new Date();

    // Clean up internals after execution
    jobInternals.delete(job.id);

    // Broadcast SSE event for cache invalidation
    try {
        const port = process.env.PORT || '3001';
        const baseUrl = process.env.NODE_ENV === 'production'
            ? `http://127.0.0.1:${port}`
            : `http://localhost:${port}`;
        const secret = process.env.INTERNAL_API_SECRET;
        if (secret) {
            await fetch(`${baseUrl}/api/internal/broadcast`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'x-internal-secret': secret,
                },
                body: JSON.stringify({
                    type: 'sheet_sync_complete',
                    data: { jobId: job.id },
                }),
            });
        }
    } catch {
        // Non-critical — SSE broadcast failure shouldn't affect job result
    }
}

/**
 * Get a job by ID
 */
export function getJob(jobId: string): SheetSyncJob | null {
    return jobs.get(jobId) ?? null;
}

/**
 * Get recent jobs (last 10)
 */
export function getRecentJobs(): SheetSyncJob[] {
    return [...jobs.values()]
        .sort((a, b) => b.startedAt.getTime() - a.startedAt.getTime())
        .slice(0, 10);
}
