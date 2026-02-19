'use server';

import { createServerFn } from '@tanstack/react-start';
import { z } from 'zod';
import { authMiddleware } from '../../middleware/auth';
import { getInternalApiBaseUrl } from '../../utils';
import { type MutationResult, type LogsResult, requireAdminRole } from './types';

// ============================================
// INPUT SCHEMAS
// ============================================

const getServerLogsSchema = z.object({
    level: z.enum(['error', 'warn', 'info', 'all']).optional().default('all'),
    limit: z.number().int().positive().max(1000).optional().default(100),
    offset: z.number().int().nonnegative().optional().default(0),
    search: z.string().optional().nullable(),
});

// ============================================
// INTERFACES
// ============================================

export interface LogStats {
    total: number;
    maxSize: number;
    byLevel: { error: number; warn: number; info: number; debug: number };
    lastHour: { total: number; byLevel: { error: number; warn: number } };
    last24Hours: { total: number; byLevel: { error: number; warn: number } };
    isPersistent: boolean;
    retentionHours: number;
    fileSizeKB?: number;
    fileSizeMB?: number;
    oldestLog?: string;
    newestLog?: string;
    nextCleanup?: string;
}

// ============================================
// SERVER LOGS SERVER FUNCTIONS
// ============================================

/**
 * Get server logs with filtering
 * Uses the Express backend API since logs are stored on the server
 */
export const getServerLogs = createServerFn({ method: 'GET' })
    .middleware([authMiddleware])
    .inputValidator((input: unknown) => getServerLogsSchema.parse(input))
    .handler(async ({ data, context }): Promise<MutationResult<LogsResult>> => {
        try {
            requireAdminRole(context.user.role);
        } catch {
            return {
                success: false,
                error: { code: 'FORBIDDEN', message: 'Admin access required' },
            };
        }

        const { level, limit, offset, search } = data;

        // Call the Express backend API for logs
        const baseUrl = getInternalApiBaseUrl();
        const params = new URLSearchParams();
        params.set('level', level);
        params.set('limit', String(limit));
        params.set('offset', String(offset));
        if (search) params.set('search', search);

        try {
            const response = await fetch(`${baseUrl}/api/admin/logs?${params.toString()}`, {
                headers: {
                    'Content-Type': 'application/json',
                },
            });

            if (!response.ok) {
                return {
                    success: false,
                    error: { code: 'BAD_REQUEST', message: 'Failed to fetch logs' },
                };
            }

            const result = await response.json() as LogsResult;
            return { success: true, data: result };
        } catch {
            return {
                success: false,
                error: { code: 'BAD_REQUEST', message: 'Failed to connect to log service' },
            };
        }
    });

/**
 * Get log statistics
 * Requires admin role
 */
export const getLogStats = createServerFn({ method: 'GET' })
    .middleware([authMiddleware])
    .handler(async ({ context }): Promise<MutationResult<LogStats>> => {
        try {
            requireAdminRole(context.user.role);
        } catch {
            return {
                success: false,
                error: { code: 'FORBIDDEN', message: 'Admin access required' },
            };
        }

        // Call the Express backend API for log stats
        const baseUrl = getInternalApiBaseUrl();

        try {
            const response = await fetch(`${baseUrl}/api/admin/logs/stats`, {
                headers: {
                    'Content-Type': 'application/json',
                },
            });

            if (!response.ok) {
                return {
                    success: false,
                    error: { code: 'BAD_REQUEST', message: 'Failed to fetch log stats' },
                };
            }

            const result = await response.json() as LogStats;
            return { success: true, data: result };
        } catch {
            return {
                success: false,
                error: { code: 'BAD_REQUEST', message: 'Failed to connect to log service' },
            };
        }
    });

/**
 * Clear all server logs
 * Requires admin role
 */
export const clearLogs = createServerFn({ method: 'POST' })
    .middleware([authMiddleware])
    .handler(async ({ context }): Promise<MutationResult<{ cleared: boolean }>> => {
        try {
            requireAdminRole(context.user.role);
        } catch {
            return {
                success: false,
                error: { code: 'FORBIDDEN', message: 'Admin access required' },
            };
        }

        // Call the Express backend API to clear logs
        const baseUrl = getInternalApiBaseUrl();

        try {
            const response = await fetch(`${baseUrl}/api/admin/logs`, {
                method: 'DELETE',
                headers: {
                    'Content-Type': 'application/json',
                },
            });

            if (!response.ok) {
                return {
                    success: false,
                    error: { code: 'BAD_REQUEST', message: 'Failed to clear logs' },
                };
            }

            return { success: true, data: { cleared: true } };
        } catch {
            return {
                success: false,
                error: { code: 'BAD_REQUEST', message: 'Failed to connect to log service' },
            };
        }
    });
