import type { AxiosError } from 'axios';
import type { ShopifyClientContext, MarkPaidResult, ShopifyTransaction } from './types.js';
import { shopifyLogger } from '../../utils/logger.js';

/**
 * Mark a Shopify order as paid by creating a transaction
 * Used for COD orders when remittance is received
 *
 * IMPORTANT: Proper error logging for debugging COD sync issues
 */
export async function markOrderAsPaid(
    ctx: ShopifyClientContext,
    shopifyOrderId: string | number,
    amount: number,
    utr: string,
    paidAt: Date = new Date()
): Promise<MarkPaidResult> {
    if (!ctx.isConfigured()) {
        shopifyLogger.error('Shopify not configured for COD sync');
        return { success: false, error: 'Shopify is not configured', shouldRetry: false };
    }

    if (!shopifyOrderId) {
        shopifyLogger.error('No Shopify order ID provided for COD sync');
        return { success: false, error: 'No Shopify order ID provided', shouldRetry: false };
    }

    const transactionData = {
        transaction: {
            kind: 'capture',          // capture = payment received
            status: 'success',
            amount: String(amount),
            gateway: 'Cash on Delivery',
            source: 'external',
            authorization: utr || `COD-${Date.now()}`,
            processed_at: paidAt.toISOString(),
        }
    };

    try {
        // Create a transaction to mark the order as paid
        const response = await ctx.executeWithRetry<{ transaction: ShopifyTransaction }>(
            () => ctx.client.post(`/orders/${shopifyOrderId}/transactions.json`, transactionData),
            { maxRetries: 2 } // Limit retries for payment operations
        );

        shopifyLogger.info({ shopifyOrderId, amount }, 'Order marked as paid');

        return {
            success: true,
            transaction: response.data.transaction,
        };
    } catch (error: unknown) {
        const axiosError = error as AxiosError<{ errors?: unknown; error?: string }>;
        const status = axiosError.response?.status;
        const errorData = axiosError.response?.data;
        const errorMessage = errorData?.errors || errorData?.error || (error instanceof Error ? error.message : 'Unknown error');

        // Determine if this error is retryable
        const shouldRetry = status === 429 || (status !== undefined && status >= 500) || !axiosError.response;

        // Structured error logging for debugging
        shopifyLogger.error({
            shopifyOrderId,
            amount,
            utr,
            httpStatus: status,
            error: typeof errorMessage === 'object' ? JSON.stringify(errorMessage) : errorMessage,
            shouldRetry
        }, 'Failed to mark order as paid');

        return {
            success: false,
            error: typeof errorMessage === 'object' ? JSON.stringify(errorMessage) : String(errorMessage),
            errorCode: status,
            shouldRetry,
        };
    }
}

/**
 * Get transactions for a Shopify order
 */
export async function getOrderTransactions(
    ctx: ShopifyClientContext,
    shopifyOrderId: string | number
): Promise<ShopifyTransaction[]> {
    if (!ctx.isConfigured()) {
        throw new Error('Shopify is not configured');
    }

    try {
        const response = await ctx.executeWithRetry<{ transactions: ShopifyTransaction[] }>(
            () => ctx.client.get(`/orders/${shopifyOrderId}/transactions.json`)
        );
        return response.data.transactions || [];
    } catch (error: unknown) {
        shopifyLogger.error({ shopifyOrderId, error: error instanceof Error ? error.message : 'Unknown error' }, 'Failed to get transactions for order');
        return [];
    }
}
