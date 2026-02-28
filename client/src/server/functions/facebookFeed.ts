/**
 * Facebook Feed Health Server Functions
 *
 * Wraps the Express endpoint for feed health monitoring.
 * Compares the Facebook catalog feed against ERP + Shopify data.
 */

import { createServerFn } from '@tanstack/react-start';
import { authMiddleware } from '../middleware/auth';
import { callExpressApi } from '../utils';

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

// callExpressApi imported from ../utils

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
            console.error('[facebook-feed] getFacebookFeedHealth failed:', error);
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
            console.error('[facebook-feed] refreshFacebookFeedHealth failed:', error);
            return {
                success: false,
                error: { code: 'EXTERNAL_ERROR', message },
            };
        }
    });
