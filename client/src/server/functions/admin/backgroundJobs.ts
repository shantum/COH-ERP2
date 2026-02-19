'use server';

import { createServerFn } from '@tanstack/react-start';
import { getCookie } from '@tanstack/react-start/server';
import { z } from 'zod';
import { authMiddleware } from '../../middleware/auth';
import { getInternalApiBaseUrl } from '../../utils';
import { type MutationResult, type BackgroundJob, type JsonValue, requireAdminRole, getApiBaseUrl } from './types';

// ============================================
// INPUT SCHEMAS
// ============================================

const startBackgroundJobSchema = z.object({
    jobId: z.enum(['shopify_sync', 'tracking_sync', 'cache_cleanup', 'ingest_inward', 'ingest_outward', 'move_shipped_to_outward', 'preview_ingest_inward', 'preview_ingest_outward', 'cleanup_done_rows', 'migrate_sheet_formulas', 'snapshot_compute', 'snapshot_backfill', 'push_balances', 'preview_push_balances', 'push_fabric_balances', 'import_fabric_balances', 'preview_fabric_inward', 'ingest_fabric_inward', 'reconcile_sheet_orders', 'sync_sheet_status', 'run_inward_cycle', 'run_outward_cycle']),
});

const cancelBackgroundJobSchema = z.object({
    jobId: z.enum(['shopify_sync', 'tracking_sync', 'cache_cleanup', 'ingest_inward', 'ingest_outward', 'move_shipped_to_outward', 'preview_ingest_inward', 'preview_ingest_outward', 'cleanup_done_rows', 'migrate_sheet_formulas', 'snapshot_compute', 'snapshot_backfill', 'push_balances', 'preview_push_balances', 'push_fabric_balances', 'import_fabric_balances', 'preview_fabric_inward', 'ingest_fabric_inward', 'reconcile_sheet_orders', 'sync_sheet_status', 'run_inward_cycle', 'run_outward_cycle']),
});

const updateBackgroundJobSchema = z.object({
    jobId: z.string(),
    enabled: z.boolean(),
});

// ============================================
// BACKGROUND JOBS SERVER FUNCTIONS
// ============================================

/**
 * Get all background jobs status
 * Uses the Express backend API since jobs are managed on the server
 */
export const getBackgroundJobs = createServerFn({ method: 'GET' })
    .middleware([authMiddleware])
    .handler(async ({ context }): Promise<MutationResult<BackgroundJob[]>> => {
        try {
            requireAdminRole(context.user.role);
        } catch {
            return {
                success: false,
                error: { code: 'FORBIDDEN', message: 'Admin access required' },
            };
        }

        // Call the Express backend API for background jobs
        const baseUrl = getApiBaseUrl();
        const authToken = getCookie('auth_token');

        try {
            const response = await fetch(`${baseUrl}/api/admin/background-jobs`, {
                headers: {
                    'Content-Type': 'application/json',
                    ...(authToken ? { Authorization: `Bearer ${authToken}` } : {}),
                },
            });

            if (!response.ok) {
                return {
                    success: false,
                    error: { code: 'BAD_REQUEST', message: 'Failed to fetch background jobs' },
                };
            }

            const result = await response.json() as { jobs: BackgroundJob[] };
            return { success: true, data: result.jobs };
        } catch {
            return {
                success: false,
                error: { code: 'BAD_REQUEST', message: 'Failed to connect to job service' },
            };
        }
    });

/**
 * Get sheet offload worker status including buffer counts
 * Wraps GET /api/admin/sheet-offload/status
 */
export const getSheetOffloadStatus = createServerFn({ method: 'GET' })
    .middleware([authMiddleware])
    .handler(async ({ context }): Promise<MutationResult<Record<string, JsonValue>>> => {
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
            const response = await fetch(`${baseUrl}/api/admin/sheet-offload/status`, {
                headers: {
                    'Content-Type': 'application/json',
                    ...(authToken ? { Authorization: `Bearer ${authToken}` } : {}),
                },
            });

            if (!response.ok) {
                return {
                    success: false,
                    error: { code: 'BAD_REQUEST', message: 'Failed to fetch sheet offload status' },
                };
            }

            const result = await response.json() as Record<string, JsonValue>;
            return { success: true, data: result };
        } catch {
            return {
                success: false,
                error: { code: 'BAD_REQUEST', message: 'Failed to connect to sheet offload service' },
            };
        }
    });

/**
 * Get real-time cycle progress for the ingestion pipeline modal
 * Requires admin role
 */
export const getCycleProgress = createServerFn({ method: 'GET' })
    .middleware([authMiddleware])
    .handler(async ({ context }): Promise<MutationResult<Record<string, JsonValue>>> => {
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
            const response = await fetch(`${baseUrl}/api/admin/sheet-offload/cycle-progress`, {
                headers: {
                    'Content-Type': 'application/json',
                    ...(authToken ? { Authorization: `Bearer ${authToken}` } : {}),
                },
            });

            if (!response.ok) {
                return {
                    success: false,
                    error: { code: 'BAD_REQUEST', message: 'Failed to fetch cycle progress' },
                };
            }

            const result = await response.json() as Record<string, JsonValue>;
            return { success: true, data: result };
        } catch {
            return {
                success: false,
                error: { code: 'BAD_REQUEST', message: 'Failed to connect to cycle progress service' },
            };
        }
    });

/**
 * Start/trigger a background job
 * Requires admin role
 */
export const startBackgroundJob = createServerFn({ method: 'POST' })
    .middleware([authMiddleware])
    .inputValidator((input: unknown) => startBackgroundJobSchema.parse(input))
    .handler(async ({ data, context }): Promise<MutationResult<{ triggered: boolean; result?: JsonValue }>> => {
        try {
            requireAdminRole(context.user.role);
        } catch {
            return {
                success: false,
                error: { code: 'FORBIDDEN', message: 'Admin access required' },
            };
        }

        const { jobId } = data;

        // Call the Express backend API to trigger the job
        const baseUrl = getApiBaseUrl();
        const authToken = getCookie('auth_token');

        try {
            const response = await fetch(`${baseUrl}/api/admin/background-jobs/${jobId}/trigger`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    ...(authToken ? { Authorization: `Bearer ${authToken}` } : {}),
                },
            });

            if (!response.ok) {
                const errorData = await response.json().catch(() => ({})) as { error?: string };
                return {
                    success: false,
                    error: { code: 'BAD_REQUEST', message: errorData.error || 'Failed to trigger job' },
                };
            }

            const result = await response.json() as { result?: JsonValue };
            return { success: true, data: { triggered: true, result: result.result } };
        } catch {
            return {
                success: false,
                error: { code: 'BAD_REQUEST', message: 'Failed to connect to job service' },
            };
        }
    });

/**
 * Cancel/disable a background job
 * Requires admin role
 * Note: This updates the job settings, not actually cancels a running job
 */
export const cancelBackgroundJob = createServerFn({ method: 'POST' })
    .middleware([authMiddleware])
    .inputValidator((input: unknown) => cancelBackgroundJobSchema.parse(input))
    .handler(async ({ data, context }): Promise<MutationResult<{ cancelled: boolean }>> => {
        try {
            requireAdminRole(context.user.role);
        } catch {
            return {
                success: false,
                error: { code: 'FORBIDDEN', message: 'Admin access required' },
            };
        }

        const { jobId } = data;

        // Call the Express backend API to update job settings (disable)
        const baseUrl = getInternalApiBaseUrl();

        try {
            const response = await fetch(`${baseUrl}/api/admin/background-jobs/${jobId}`, {
                method: 'PUT',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({ enabled: false }),
            });

            if (!response.ok) {
                const errorData = await response.json().catch(() => ({})) as { error?: string };
                return {
                    success: false,
                    error: { code: 'BAD_REQUEST', message: errorData.error || 'Failed to cancel job' },
                };
            }

            return { success: true, data: { cancelled: true } };
        } catch {
            return {
                success: false,
                error: { code: 'BAD_REQUEST', message: 'Failed to connect to job service' },
            };
        }
    });

/**
 * Update background job enabled state
 * Requires admin role
 */
export const updateBackgroundJob = createServerFn({ method: 'POST' })
    .middleware([authMiddleware])
    .inputValidator((input: unknown) => updateBackgroundJobSchema.parse(input))
    .handler(async ({ data, context }): Promise<MutationResult<{ updated: boolean }>> => {
        try {
            requireAdminRole(context.user.role);
        } catch {
            return {
                success: false,
                error: { code: 'FORBIDDEN', message: 'Admin access required' },
            };
        }

        const { jobId, enabled } = data;

        // Call the Express backend API to update job settings
        const baseUrl = getApiBaseUrl();
        const authToken = getCookie('auth_token');

        try {
            const response = await fetch(`${baseUrl}/api/admin/background-jobs/${jobId}`, {
                method: 'PUT',
                headers: {
                    'Content-Type': 'application/json',
                    ...(authToken ? { Authorization: `Bearer ${authToken}` } : {}),
                },
                body: JSON.stringify({ enabled }),
            });

            if (!response.ok) {
                const errorData = await response.json().catch(() => ({})) as { error?: string };
                return {
                    success: false,
                    error: { code: 'BAD_REQUEST', message: errorData.error || 'Failed to update job' },
                };
            }

            return { success: true, data: { updated: true } };
        } catch {
            return {
                success: false,
                error: { code: 'BAD_REQUEST', message: 'Failed to connect to job service' },
            };
        }
    });
