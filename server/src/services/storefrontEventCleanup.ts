/**
 * Storefront Event Cleanup Worker
 *
 * Prunes StorefrontEvent rows older than 90 days.
 * Runs hourly, only acts at 3 AM IST.
 */

import prisma from '../lib/prisma.js';

const RETENTION_DAYS = 90;
const CHECK_INTERVAL_MS = 60 * 60 * 1000; // 1 hour

let interval: ReturnType<typeof setInterval> | null = null;
let isRunning = false;

async function cleanup(): Promise<void> {
    // Only run at 3 AM UTC (8:30 AM IST)
    if (new Date().getUTCHours() !== 3) return;
    if (isRunning) return;

    isRunning = true;
    try {
        const cutoff = new Date();
        cutoff.setDate(cutoff.getDate() - RETENTION_DAYS);

        const result = await prisma.storefrontEvent.deleteMany({
            where: { createdAt: { lt: cutoff } },
        });

        if (result.count > 0) {
            console.log(`[StorefrontCleanup] Pruned ${result.count} events older than ${RETENTION_DAYS} days`);
        }
    } catch (error: unknown) {
        console.error('[StorefrontCleanup] Error:', error instanceof Error ? error.message : error);
    } finally {
        isRunning = false;
    }
}

function start(): void {
    interval = setInterval(cleanup, CHECK_INTERVAL_MS);
    console.log('[StorefrontCleanup] Started (prunes events older than 90 days)');
}

function stop(): void {
    if (interval) {
        clearInterval(interval);
        interval = null;
    }
}

export default { start, stop };
