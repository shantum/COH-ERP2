/**
 * Sheet Sync Server Functions
 *
 * Proxies for the Express sheet-sync endpoints.
 * For Google Sheets mode, uses createServerFn with JSON.
 * For file upload mode, the client calls Express directly via fetch() with FormData.
 */
'use server';

import { createServerFn } from '@tanstack/react-start';
import { z } from 'zod';
import { adminMiddleware } from '../middleware/auth';
import { internalFetch } from '../utils';

// ============================================
// SCHEMAS
// ============================================

const planFromSheetSchema = z.object({
    sheetId: z.string().min(1, 'Sheet ID or URL is required'),
    ordersGid: z.string().optional(),
    inventoryGid: z.string().optional(),
});

const executeSchema = z.object({
    jobId: z.string().uuid('Invalid job ID'),
});

const statusSchema = z.object({
    jobId: z.string().optional(),
});

// ============================================
// SERVER FUNCTIONS
// ============================================

/**
 * Plan sync from Google Sheets URL
 */
export const planSyncFromSheet = createServerFn({ method: 'POST' })
    .middleware([adminMiddleware])
    .inputValidator((input: unknown) => planFromSheetSchema.parse(input))
    .handler(async ({ data }) => {
        try {
            const response = await internalFetch('/api/admin/sheet-sync/plan', {
                method: 'POST',
                body: JSON.stringify(data),
            });

            if (!response.ok) {
                const errorData = await response.json().catch(() => ({}));
                return {
                    success: false as const,
                    error: (errorData as Record<string, string>).error || `Request failed with status ${response.status}`,
                };
            }

            const result = await response.json();
            return { success: true as const, data: result };
        } catch (error: unknown) {
            const message = error instanceof Error ? error.message : 'Unknown error';
            return { success: false as const, error: message };
        }
    });

/**
 * Execute a planned sync job
 */
export const executeSyncJob = createServerFn({ method: 'POST' })
    .middleware([adminMiddleware])
    .inputValidator((input: unknown) => executeSchema.parse(input))
    .handler(async ({ data }) => {
        try {
            const response = await internalFetch('/api/admin/sheet-sync/execute', {
                method: 'POST',
                body: JSON.stringify(data),
            });

            if (!response.ok) {
                const errorData = await response.json().catch(() => ({}));
                return {
                    success: false as const,
                    error: (errorData as Record<string, string>).error || `Request failed with status ${response.status}`,
                };
            }

            const result = await response.json();
            return { success: true as const, data: result };
        } catch (error: unknown) {
            const message = error instanceof Error ? error.message : 'Unknown error';
            return { success: false as const, error: message };
        }
    });

/**
 * Get sync job status (for polling)
 */
export const getSyncJobStatus = createServerFn({ method: 'POST' })
    .middleware([adminMiddleware])
    .inputValidator((input: unknown) => statusSchema.parse(input))
    .handler(async ({ data }) => {
        try {
            const path = data.jobId
                ? `/api/admin/sheet-sync/status?jobId=${data.jobId}`
                : '/api/admin/sheet-sync/status';

            const response = await internalFetch(path);

            if (!response.ok) {
                const errorData = await response.json().catch(() => ({}));
                return {
                    success: false as const,
                    error: (errorData as Record<string, string>).error || `Request failed with status ${response.status}`,
                };
            }

            const result = await response.json();
            return { success: true as const, data: result };
        } catch (error: unknown) {
            const message = error instanceof Error ? error.message : 'Unknown error';
            return { success: false as const, error: message };
        }
    });
