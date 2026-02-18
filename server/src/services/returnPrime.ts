/**
 * Return Prime API Client
 *
 * Handles communication with Return Prime API for:
 * - Getting return request details
 * - Updating return status (sync QC results back to Return Prime)
 *
 * Pattern follows ithinkLogistics.ts with retry logic and config from env/database.
 */

import axios, { AxiosInstance, AxiosError } from 'axios';
import prisma from '../lib/prisma.js';
import logger from '../utils/logger.js';

const log = logger.child({ module: 'returnprime' });

// ============================================
// CONSTANTS
// ============================================

const API_BASE_URL = 'https://admin.returnprime.com';
const API_TIMEOUT_MS = 30000;
const MAX_RETRIES = 2;
const INITIAL_RETRY_DELAY_MS = 1000;

// ============================================
// TYPES
// ============================================

export interface ReturnPrimeConfig {
    apiToken?: string;
    storeId?: string;
    webhookSecret?: string;
}

export interface ReturnPrimeRequest {
    id: string;
    request_number: string;
    status: string;
    request_type: string;
    created_at: string;
    updated_at: string;
    // Add more fields as needed from RP API response
}

export interface UpdateStatusData {
    received_at?: string;
    condition?: string;
    notes?: string;
    [key: string]: unknown;
}

export interface ConfigStatus {
    hasCredentials: boolean;
    hasStoreId: boolean;
    hasWebhookSecret: boolean;
}

// ============================================
// CLIENT CLASS
// ============================================

class ReturnPrimeClient {
    private baseUrl: string;
    private apiToken: string | null = null;
    private storeId: string | null = null;
    private webhookSecret: string | null = null;
    private client: AxiosInstance | null = null;

    constructor() {
        this.baseUrl = API_BASE_URL;

        // Load from environment variables first (preferred)
        this.apiToken = process.env.RETURNPRIME_API_TOKEN || null;
        this.storeId = process.env.RETURNPRIME_STORE_ID || null;
        this.webhookSecret = process.env.RETURNPRIME_WEBHOOK_SECRET || null;

        if (this.apiToken) {
            this.initializeClient();
        }
    }

    /**
     * Initialize the axios client with auth headers
     */
    private initializeClient(): void {
        if (!this.apiToken) return;

        this.client = axios.create({
            baseURL: this.baseUrl,
            headers: {
                'x-rp-token': this.apiToken,
                'Content-Type': 'application/json',
            },
            timeout: API_TIMEOUT_MS,
        });
    }

    /**
     * Load credentials from database if not set via environment
     */
    async loadFromDatabase(): Promise<void> {
        // If env vars are set, prefer them
        if (this.apiToken) {
            log.info('Using credentials from environment variables');
            return;
        }

        try {
            const settings = await prisma.systemSetting.findMany({
                where: {
                    key: {
                        in: [
                            'returnprime_api_token',
                            'returnprime_store_id',
                            'returnprime_webhook_secret',
                        ],
                    },
                },
            });

            let loadedFromDb = false;
            for (const setting of settings) {
                if (setting.key === 'returnprime_api_token' && !this.apiToken) {
                    this.apiToken = setting.value;
                    loadedFromDb = true;
                } else if (setting.key === 'returnprime_store_id' && !this.storeId) {
                    this.storeId = setting.value;
                } else if (setting.key === 'returnprime_webhook_secret' && !this.webhookSecret) {
                    this.webhookSecret = setting.value;
                }
            }

            if (loadedFromDb) {
                log.info('Loaded credentials from database');
                this.initializeClient();
            }
        } catch (error) {
            const message = error instanceof Error ? error.message : 'Unknown error';
            log.error({ error: message }, 'Failed to load config from database');
        }
    }

    /**
     * Update credentials in database
     * Note: For production, credentials should be set via environment variables
     */
    async updateConfig(config: ReturnPrimeConfig): Promise<void> {
        // Warn if trying to update while env vars are set
        if (process.env.RETURNPRIME_API_TOKEN) {
            log.warn('Credentials are set via environment variables. Database update will be ignored on restart.');
        }

        const { apiToken, storeId, webhookSecret } = config;
        const updates = [];

        if (apiToken !== undefined) {
            updates.push(prisma.systemSetting.upsert({
                where: { key: 'returnprime_api_token' },
                update: { value: apiToken },
                create: { key: 'returnprime_api_token', value: apiToken }
            }));
            this.apiToken = apiToken;
        }

        if (storeId !== undefined) {
            updates.push(prisma.systemSetting.upsert({
                where: { key: 'returnprime_store_id' },
                update: { value: storeId },
                create: { key: 'returnprime_store_id', value: storeId }
            }));
            this.storeId = storeId;
        }

        if (webhookSecret !== undefined) {
            updates.push(prisma.systemSetting.upsert({
                where: { key: 'returnprime_webhook_secret' },
                update: { value: webhookSecret },
                create: { key: 'returnprime_webhook_secret', value: webhookSecret }
            }));
            this.webhookSecret = webhookSecret;
        }

        if (updates.length > 0) {
            await prisma.$transaction(updates);
            this.initializeClient();
        }
    }

    /**
     * Check if the client is configured with API token
     */
    isConfigured(): boolean {
        return !!this.apiToken;
    }

    /**
     * Get the webhook secret for HMAC verification
     */
    getWebhookSecret(): string | null {
        return this.webhookSecret;
    }

    /**
     * Get configuration status
     */
    getConfig(): ConfigStatus {
        return {
            hasCredentials: !!this.apiToken,
            hasStoreId: !!this.storeId,
            hasWebhookSecret: !!this.webhookSecret,
        };
    }

    /**
     * Execute a request with retry logic and exponential backoff
     */
    private async executeWithRetry<T>(
        requestFn: () => Promise<T>,
        context: string
    ): Promise<T> {
        let lastError: Error | null = null;

        for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
            try {
                return await requestFn();
            } catch (error) {
                lastError = error instanceof Error ? error : new Error(String(error));

                const isAxiosError = axios.isAxiosError(error);
                const axiosError = error as AxiosError;
                const status = axiosError.response?.status;

                // Don't retry on 4xx client errors (except 429 rate limit)
                if (isAxiosError && status && status >= 400 && status < 500 && status !== 429) {
                    log.warn({ context, status }, 'Client error - not retrying');
                    throw lastError;
                }

                // Check if we should retry
                const isRetryable = !isAxiosError ||
                    !status ||
                    status >= 500 ||
                    status === 429 ||
                    axiosError.code === 'ECONNABORTED' ||
                    axiosError.code === 'ECONNREFUSED' ||
                    axiosError.code === 'ENOTFOUND' ||
                    axiosError.code === 'ETIMEDOUT';

                if (!isRetryable || attempt === MAX_RETRIES) {
                    log.error({ context, attempts: attempt + 1 }, 'Failed after retries');
                    throw lastError;
                }

                // Exponential backoff
                const delay = INITIAL_RETRY_DELAY_MS * Math.pow(2, attempt);
                log.warn({ context, attempt: attempt + 1, retryDelayMs: delay }, 'Attempt failed, retrying');
                await new Promise(resolve => setTimeout(resolve, delay));
            }
        }

        throw lastError || new Error('Request failed after retries');
    }

    /**
     * Get a return request by ID from Return Prime
     */
    async getRequest(requestId: string): Promise<ReturnPrimeRequest> {
        if (!this.client) {
            throw new Error('Return Prime client not configured');
        }

        const response = await this.executeWithRetry(
            () => this.client!.get(`/return-exchange/v2/${requestId}`),
            `getRequest:${requestId}`
        );

        return response.data.data?.request || response.data;
    }

    /**
     * Update request status in Return Prime
     * Used to sync QC results and status changes back to Return Prime
     */
    async updateRequestStatus(
        requestId: string,
        status: string,
        data?: UpdateStatusData
    ): Promise<void> {
        if (!this.client) {
            throw new Error('Return Prime client not configured');
        }

        await this.executeWithRetry(
            () => this.client!.put(`/return-exchange/v2/${requestId}/status`, {
                status,
                ...data,
            }),
            `updateRequestStatus:${requestId}`
        );

        log.info({ requestId, status }, 'Updated request status');
    }

    /**
     * Update inspection/QC results in Return Prime
     */
    async updateInspectionResults(
        requestId: string,
        condition: string,
        notes?: string
    ): Promise<void> {
        if (!this.client) {
            throw new Error('Return Prime client not configured');
        }

        await this.executeWithRetry(
            () => this.client!.put(`/return-exchange/v2/${requestId}/inspection`, {
                condition,
                notes,
                inspected_at: new Date().toISOString(),
            }),
            `updateInspectionResults:${requestId}`
        );

        log.info({ requestId }, 'Updated inspection results');
    }
}

// ============================================
// SINGLETON EXPORT
// ============================================

/**
 * Singleton instance of the Return Prime client
 */
export const returnPrimeClient = new ReturnPrimeClient();

/**
 * Get the Return Prime client, ensuring it's loaded from database if needed
 */
export async function getReturnPrimeClient(): Promise<ReturnPrimeClient> {
    await returnPrimeClient.loadFromDatabase();
    return returnPrimeClient;
}

export default returnPrimeClient;
