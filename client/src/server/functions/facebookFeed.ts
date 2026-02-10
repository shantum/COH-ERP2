/**
 * Facebook Feed Health Server Functions
 *
 * Wraps the Express endpoint for feed health monitoring.
 * Compares the Facebook catalog feed against ERP + Shopify data.
 */

import { createServerFn } from '@tanstack/react-start';
import { getCookie } from '@tanstack/react-start/server';
import { authMiddleware } from '../middleware/auth';

// ============================================
// RESULT TYPES
// ============================================

export interface FeedIssue {
    severity: 'critical' | 'warning' | 'info';
    type: 'price_mismatch' | 'stock_mismatch' | 'availability_wrong' | 'not_in_erp' | 'not_in_shopify_cache' | 'metadata_mismatch';
    variantId: string;
    productId: string;
    title: string;
    color: string;
    size: string;
    message: string;
    feedValue: string;
    erpValue: string;
    shopifyValue: string;
}

export interface FeedHealthStats {
    totalFeedItems: number;
    matchedToErp: number;
    matchedToShopify: number;
    criticalIssues: number;
    warnings: number;
    infoIssues: number;
}

export interface FeedHealthResult {
    stats: FeedHealthStats;
    issues: FeedIssue[];
    lastFetched: string;
    feedUrl: string;
}

interface MutationResult<T> {
    success: boolean;
    data?: T;
    error?: {
        code: 'NOT_FOUND' | 'BAD_REQUEST' | 'CONFLICT' | 'FORBIDDEN' | 'EXTERNAL_ERROR';
        message: string;
    };
}

// ============================================
// EXPRESS API HELPER (same pattern as shopify.ts)
// ============================================

async function callExpressApi<T>(
    path: string,
    options: RequestInit = {}
): Promise<T> {
    const port = process.env.PORT || '3001';
    const apiUrl =
        process.env.NODE_ENV === 'production'
            ? `http://127.0.0.1:${port}`
            : 'http://localhost:3001';

    const authToken = getCookie('auth_token');

    const response = await fetch(`${apiUrl}${path}`, {
        ...options,
        headers: {
            'Content-Type': 'application/json',
            ...(authToken ? { Cookie: `auth_token=${authToken}` } : {}),
            ...options.headers,
        },
    });

    if (!response.ok) {
        const errorBody = await response.text();
        let errorMessage: string;
        try {
            const errorJson = JSON.parse(errorBody) as { error?: string; message?: string };
            errorMessage = errorJson.error || errorJson.message || `API call failed: ${response.status}`;
        } catch {
            errorMessage = `API call failed: ${response.status} - ${errorBody}`;
        }
        throw new Error(errorMessage);
    }

    return response.json() as Promise<T>;
}

// ============================================
// SERVER FUNCTIONS
// ============================================

/**
 * Get Facebook feed health report (cached on server, 1 hour)
 */
export const getFacebookFeedHealth = createServerFn({ method: 'GET' })
    .middleware([authMiddleware])
    .handler(async (): Promise<MutationResult<FeedHealthResult>> => {
        try {
            const result = await callExpressApi<FeedHealthResult>(
                '/api/shopify/facebook-feed-health'
            );
            return { success: true, data: result };
        } catch (error: unknown) {
            const message = error instanceof Error ? error.message : 'Unknown error';
            return {
                success: false,
                error: { code: 'EXTERNAL_ERROR', message },
            };
        }
    });

/**
 * Force refresh feed health (bypasses cache)
 */
export const refreshFacebookFeedHealth = createServerFn({ method: 'POST' })
    .middleware([authMiddleware])
    .handler(async (): Promise<MutationResult<FeedHealthResult>> => {
        try {
            const result = await callExpressApi<FeedHealthResult>(
                '/api/shopify/facebook-feed-health/refresh',
                { method: 'POST' }
            );
            return { success: true, data: result };
        } catch (error: unknown) {
            const message = error instanceof Error ? error.message : 'Unknown error';
            return {
                success: false,
                error: { code: 'EXTERNAL_ERROR', message },
            };
        }
    });
