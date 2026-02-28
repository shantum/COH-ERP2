'use server';

import { createServerFn } from '@tanstack/react-start';
import { getCookie } from '@tanstack/react-start/server';
import { authMiddleware } from '../../middleware/auth';
import { type MutationResult, requireAdminRole } from './types';
import { getInternalApiBaseUrl } from '../../utils';

// ============================================
// INTERFACES
// ============================================

export interface SheetsMonitorStats {
    inventory: {
        totalSkus: number;
        totalBalance: number;
        inStock: number;
        outOfStock: number;
    };
    ingestion: {
        totalInwardLive: number;
        totalOutwardLive: number;
        historicalInward: number;
        historicalOutward: number;
    };
    recentTransactions: Array<{
        id: string;
        skuCode: string;
        txnType: string;
        quantity: number;
        reason: string | null;
        referenceId: string | null;
        createdAt: string;
    }>;
}

// ============================================
// SHEETS MONITOR STATS SERVER FUNCTIONS
// ============================================

/**
 * Get sheets monitor stats (inventory, ingestion, recent transactions)
 * Requires admin role
 */
export const getSheetsMonitorStats = createServerFn({ method: 'GET' })
    .middleware([authMiddleware])
    .handler(async ({ context }): Promise<MutationResult<SheetsMonitorStats>> => {
        try {
            requireAdminRole(context.user.role, context.permissions);
        } catch {
            return {
                success: false,
                error: { code: 'FORBIDDEN', message: 'Admin access required' },
            };
        }

        const baseUrl = getInternalApiBaseUrl();
        const authToken = getCookie('auth_token');

        try {
            const response = await fetch(`${baseUrl}/api/admin/sheet-monitor/stats`, {
                headers: {
                    'Content-Type': 'application/json',
                    ...(authToken ? { Authorization: `Bearer ${authToken}` } : {}),
                },
            });

            if (!response.ok) {
                return {
                    success: false,
                    error: { code: 'BAD_REQUEST', message: 'Failed to fetch sheet monitor stats' },
                };
            }

            const result = await response.json() as SheetsMonitorStats;
            return { success: true, data: result };
        } catch {
            return {
                success: false,
                error: { code: 'BAD_REQUEST', message: 'Failed to connect to sheet monitor service' },
            };
        }
    });
