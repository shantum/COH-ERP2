'use server';

import { createServerFn } from '@tanstack/react-start';
import { getCookie } from '@tanstack/react-start/server';
import { z } from 'zod';
import { authMiddleware } from '../../middleware/auth';
import { type MutationResult, type JsonValue, requireAdminRole, getApiBaseUrl } from './types';

// ============================================
// INTERFACES
// ============================================

export interface WorkerRunEntry {
    id: string;
    workerName: string;
    status: string;
    startedAt: string;
    completedAt: string | null;
    durationMs: number | null;
    result: Record<string, JsonValue> | null;
    error: string | null;
    triggeredBy: string;
    createdAt: string;
}

export interface WorkerRunSummaryEntry {
    last24h: { total: number; succeeded: number; failed: number };
    avgDurationMs: number | null;
    lastRunAt: string | null;
    lastStatus: string | null;
}

// ============================================
// INPUT SCHEMAS
// ============================================

const getWorkerRunHistorySchema = z.object({
    workerName: z.string().optional(),
    status: z.string().optional(),
    limit: z.number().int().positive().max(200).optional().default(50),
    offset: z.number().int().nonnegative().optional().default(0),
});

// ============================================
// WORKER RUN HISTORY SERVER FUNCTIONS
// ============================================

/**
 * Get worker run history
 */
export const getWorkerRunHistory = createServerFn({ method: 'GET' })
    .middleware([authMiddleware])
    .inputValidator((input: unknown) => getWorkerRunHistorySchema.parse(input))
    .handler(async ({ data, context }): Promise<MutationResult<{ runs: WorkerRunEntry[]; total: number }>> => {
        try {
            requireAdminRole(context.user.role);
        } catch {
            return {
                success: false,
                error: { code: 'FORBIDDEN', message: 'Admin access required' },
            };
        }

        const baseUrl = getApiBaseUrl();
        const authToken = getCookie('auth_token');

        const params = new URLSearchParams();
        if (data.workerName) params.set('workerName', data.workerName);
        if (data.status) params.set('status', data.status);
        params.set('limit', String(data.limit));
        params.set('offset', String(data.offset));

        try {
            const response = await fetch(`${baseUrl}/api/admin/worker-runs?${params.toString()}`, {
                headers: {
                    'Content-Type': 'application/json',
                    ...(authToken ? { Authorization: `Bearer ${authToken}` } : {}),
                },
            });

            if (!response.ok) {
                return {
                    success: false,
                    error: { code: 'BAD_REQUEST', message: 'Failed to fetch worker run history' },
                };
            }

            const result = await response.json() as { runs: WorkerRunEntry[]; total: number };
            return { success: true, data: result };
        } catch {
            return {
                success: false,
                error: { code: 'BAD_REQUEST', message: 'Failed to connect to worker run service' },
            };
        }
    });

/**
 * Get worker run summary (per-worker stats)
 */
export const getWorkerRunSummary = createServerFn({ method: 'GET' })
    .middleware([authMiddleware])
    .handler(async ({ context }): Promise<MutationResult<Record<string, WorkerRunSummaryEntry>>> => {
        try {
            requireAdminRole(context.user.role);
        } catch {
            return {
                success: false,
                error: { code: 'FORBIDDEN', message: 'Admin access required' },
            };
        }

        const baseUrl = getApiBaseUrl();
        const authToken = getCookie('auth_token');

        try {
            const response = await fetch(`${baseUrl}/api/admin/worker-runs/summary`, {
                headers: {
                    'Content-Type': 'application/json',
                    ...(authToken ? { Authorization: `Bearer ${authToken}` } : {}),
                },
            });

            if (!response.ok) {
                return {
                    success: false,
                    error: { code: 'BAD_REQUEST', message: 'Failed to fetch worker run summary' },
                };
            }

            const result = await response.json() as Record<string, WorkerRunSummaryEntry>;
            return { success: true, data: result };
        } catch {
            return {
                success: false,
                error: { code: 'BAD_REQUEST', message: 'Failed to connect to worker run service' },
            };
        }
    });
