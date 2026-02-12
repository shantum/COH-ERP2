/**
 * Worker Run Tracker
 *
 * Wraps worker execution to persist run history in the WorkerRun table.
 * Graceful degradation — if DB write fails, the worker still runs fine.
 */

import prisma from '../lib/prisma.js';
import logger from './logger.js';

const runLogger = logger.child({ module: 'worker-run-tracker' });

type TriggerType = 'scheduled' | 'manual' | 'startup';

/**
 * Wrap a worker function to track its run in the WorkerRun table.
 * - Creates a "running" record before execution
 * - Updates to "completed" or "failed" after
 * - Re-throws errors so existing worker error handling still works
 * - Returns the original result transparently
 */
export async function trackWorkerRun<T>(
    workerName: string,
    fn: () => Promise<T>,
    triggeredBy: TriggerType = 'scheduled'
): Promise<T> {
    const startedAt = new Date();
    let runId: string | null = null;

    try {
        const run = await prisma.workerRun.create({
            data: { workerName, startedAt, triggeredBy },
            select: { id: true },
        });
        runId = run.id;
    } catch (err) {
        runLogger.warn({ workerName, error: (err as Error).message }, 'Failed to create WorkerRun record');
    }

    try {
        const result = await fn();
        const durationMs = Date.now() - startedAt.getTime();

        if (runId) {
            await prisma.workerRun.update({
                where: { id: runId },
                data: {
                    status: 'completed',
                    completedAt: new Date(),
                    durationMs,
                    result: result as any,
                },
            }).catch(err => runLogger.warn({ workerName, error: (err as Error).message }, 'Failed to update WorkerRun'));
        }

        return result;
    } catch (error) {
        const durationMs = Date.now() - startedAt.getTime();
        const errorMsg = error instanceof Error ? error.message : String(error);

        if (runId) {
            await prisma.workerRun.update({
                where: { id: runId },
                data: {
                    status: 'failed',
                    completedAt: new Date(),
                    durationMs,
                    error: errorMsg,
                },
            }).catch(err => runLogger.warn({ workerName, error: (err as Error).message }, 'Failed to update WorkerRun'));
        }

        throw error;
    }
}

/**
 * Mark any runs still in "running" state as failed.
 * Called once on server startup — these are runs that were interrupted by a restart.
 */
export async function cleanupStaleRuns(): Promise<void> {
    try {
        const stale = await prisma.workerRun.updateMany({
            where: { status: 'running' },
            data: {
                status: 'failed',
                error: 'Server restarted before completion',
                completedAt: new Date(),
            },
        });
        if (stale.count > 0) {
            runLogger.info({ count: stale.count }, 'Marked stale worker runs as failed');
        }
    } catch (err) {
        runLogger.warn({ error: (err as Error).message }, 'Failed to cleanup stale runs');
    }
}
