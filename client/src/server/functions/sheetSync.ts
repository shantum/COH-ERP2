/**
 * Sheet Sync Server Functions
 *
 * Proxies for the Express sheet-sync endpoints.
 * For Google Sheets mode, uses createServerFn with JSON.
 * For file upload mode, the client calls Express directly via fetch() with FormData.
 */
'use server';

import { createServerFn } from '@tanstack/react-start';
import { getCookie } from '@tanstack/react-start/server';
import { z } from 'zod';
import { authMiddleware } from '../middleware/auth';

function getApiBaseUrl(): string {
    const port = process.env.PORT || '3001';
    return process.env.NODE_ENV === 'production'
        ? `http://127.0.0.1:${port}`
        : 'http://localhost:3001';
}

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
    .middleware([authMiddleware])
    .inputValidator((input: unknown) => planFromSheetSchema.parse(input))
    .handler(async ({ data, context }) => {
        if (context.user.role !== 'admin') {
            return { success: false as const, error: 'Admin access required' };
        }

        const baseUrl = getApiBaseUrl();
        const authToken = getCookie('auth_token');

        try {
            const response = await fetch(`${baseUrl}/api/admin/sheet-sync/plan`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    ...(authToken ? { Authorization: `Bearer ${authToken}` } : {}),
                },
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
    .middleware([authMiddleware])
    .inputValidator((input: unknown) => executeSchema.parse(input))
    .handler(async ({ data, context }) => {
        if (context.user.role !== 'admin') {
            return { success: false as const, error: 'Admin access required' };
        }

        const baseUrl = getApiBaseUrl();
        const authToken = getCookie('auth_token');

        try {
            const response = await fetch(`${baseUrl}/api/admin/sheet-sync/execute`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    ...(authToken ? { Authorization: `Bearer ${authToken}` } : {}),
                },
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
    .middleware([authMiddleware])
    .inputValidator((input: unknown) => statusSchema.parse(input))
    .handler(async ({ data, context }) => {
        if (context.user.role !== 'admin') {
            return { success: false as const, error: 'Admin access required' };
        }

        const baseUrl = getApiBaseUrl();
        const authToken = getCookie('auth_token');

        try {
            const url = data.jobId
                ? `${baseUrl}/api/admin/sheet-sync/status?jobId=${data.jobId}`
                : `${baseUrl}/api/admin/sheet-sync/status`;

            const response = await fetch(url, {
                headers: {
                    ...(authToken ? { Authorization: `Bearer ${authToken}` } : {}),
                },
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
