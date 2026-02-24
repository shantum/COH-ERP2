/**
 * iThink Logistics — Axios retry helper and constants
 */

import axios, { AxiosError } from 'axios';
import { shippingLogger } from '../../utils/logger.js';
import {
    ITHINK_API_TIMEOUT_MS,
    ITHINK_API_RETRIES,
    ITHINK_RETRY_DELAY_MS,
    ITHINK_REMITTANCE_DETAIL_TIMEOUT_MS,
} from '../../config/index.js';

// Re-export constants so modules don't need to import config directly
export const API_TIMEOUT_MS = ITHINK_API_TIMEOUT_MS;
export const REMITTANCE_DETAIL_TIMEOUT_MS = ITHINK_REMITTANCE_DETAIL_TIMEOUT_MS;
const MAX_RETRIES = ITHINK_API_RETRIES;
const INITIAL_RETRY_DELAY_MS = ITHINK_RETRY_DELAY_MS;

/**
 * Execute an axios request with retry logic and exponential backoff.
 * Retries on network errors and 5xx server errors, not on 4xx client errors.
 */
export async function axiosWithRetry<T>(
    requestFn: () => Promise<T>,
    context: string
): Promise<T> {
    let lastError: Error | null = null;

    for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
        try {
            return await requestFn();
        } catch (error: unknown) {
            lastError = error instanceof Error ? error : new Error(String(error));

            const isAxiosError = axios.isAxiosError(error);
            const axiosErr = error as AxiosError;

            // Don't retry on 4xx client errors (bad request, auth failed, etc.)
            if (isAxiosError && axiosErr.response?.status && axiosErr.response.status >= 400 && axiosErr.response.status < 500) {
                shippingLogger.warn({ context, status: axiosErr.response.status, attempt }, 'iThink API client error - not retrying');
                throw lastError;
            }

            // Check if we should retry (network error, timeout, or 5xx)
            const isRetryable = !isAxiosError ||
                axiosErr.code === 'ECONNABORTED' || // timeout
                axiosErr.code === 'ECONNREFUSED' ||
                axiosErr.code === 'ENOTFOUND' ||
                axiosErr.code === 'ETIMEDOUT' ||
                (axiosErr.response?.status && axiosErr.response.status >= 500);

            if (!isRetryable || attempt === MAX_RETRIES) {
                shippingLogger.error({ context, error: lastError.message, attempt, isRetryable }, 'iThink API request failed');
                throw lastError;
            }

            // Exponential backoff: 1s, 2s
            const delay = INITIAL_RETRY_DELAY_MS * Math.pow(2, attempt);
            shippingLogger.warn({ context, error: lastError.message, attempt, nextRetryMs: delay }, 'iThink API request failed - retrying');
            await new Promise(resolve => setTimeout(resolve, delay));
        }
    }

    // Should never reach here, but TypeScript needs this
    throw lastError || new Error('Request failed after retries');
}

// Re-export axios for use by module functions
export { axios };
