/**
 * PayU Settlement API Client
 *
 * Fetches settlement data from PayU's Settlement Detail Range API.
 * Auth: HMAC SHA512 with key/salt/MID stored in SystemSetting.
 *
 * API Docs: https://docs.payu.in/reference/settlement-detail-range-api
 */

import crypto from 'crypto';
import axios from 'axios';
import prisma from '../lib/prisma.js';
import { settlementLogger } from '../utils/logger.js';
import { PAYU_API_TIMEOUT_MS, PAYU_PAGE_SIZE } from '../config/index.js';
import type { PayuSettlementResponse } from '../types/payuApi.js';

const BASE_URL = 'https://info.payu.in/settlement/range';

class PayuClient {
    private key: string | null = null;
    private salt: string | null = null;
    private mid: string | null = null;

    isConfigured(): boolean {
        return !!(this.key && this.salt && this.mid);
    }

    /**
     * Load credentials from SystemSetting table.
     */
    async loadFromDatabase(): Promise<void> {
        const settings = await prisma.systemSetting.findMany({
            where: {
                key: { in: ['payu_key', 'payu_salt', 'payu_mid'] },
            },
        });

        for (const setting of settings) {
            if (setting.key === 'payu_key') this.key = setting.value;
            else if (setting.key === 'payu_salt') this.salt = setting.value;
            else if (setting.key === 'payu_mid') this.mid = setting.value;
        }

        if (this.isConfigured()) {
            settlementLogger.debug('PayU client loaded from database');
        } else {
            settlementLogger.debug('PayU client not fully configured');
        }
    }

    /**
     * Save credentials to SystemSetting table.
     */
    async saveCredentials(credentials: { key?: string; salt?: string; mid?: string }): Promise<void> {
        const updates = [];

        if (credentials.key !== undefined) {
            updates.push(prisma.systemSetting.upsert({
                where: { key: 'payu_key' },
                update: { value: credentials.key },
                create: { key: 'payu_key', value: credentials.key },
            }));
            this.key = credentials.key;
        }

        if (credentials.salt !== undefined) {
            updates.push(prisma.systemSetting.upsert({
                where: { key: 'payu_salt' },
                update: { value: credentials.salt },
                create: { key: 'payu_salt', value: credentials.salt },
            }));
            this.salt = credentials.salt;
        }

        if (credentials.mid !== undefined) {
            updates.push(prisma.systemSetting.upsert({
                where: { key: 'payu_mid' },
                update: { value: credentials.mid },
                create: { key: 'payu_mid', value: credentials.mid },
            }));
            this.mid = credentials.mid;
        }

        if (updates.length > 0) {
            await Promise.all(updates);
            settlementLogger.info('PayU credentials saved');
        }
    }

    /**
     * Build HMAC SHA512 authorization header.
     * Hash = SHA512("" + "|" + dateUTCString + "|" + salt)
     */
    private buildAuthHeaders(): { Authorization: string; date: string; mid: string } {
        if (!this.key || !this.salt || !this.mid) {
            throw new Error('PayU client not configured — missing key, salt, or mid');
        }

        const dateStr = new Date().toUTCString();
        const message = `|${dateStr}|${this.salt}`;
        const hash = crypto.createHash('sha512').update(message).digest('hex');

        return {
            Authorization: `hmac username="${this.key}", algorithm="sha512", headers="date", signature="${hash}"`,
            date: dateStr,
            mid: this.mid,
        };
    }

    /**
     * Fetch settlements for a date range (max 3 days per PayU limit).
     * Handles pagination automatically — returns all settlements in range.
     */
    async getSettlements(dateFrom: string, dateTo?: string): Promise<PayuSettlementResponse['result']['data']> {
        if (!this.isConfigured()) {
            throw new Error('PayU client not configured');
        }

        const allSettlements: PayuSettlementResponse['result']['data'] = [];
        let page = 1;
        let totalCount = 0;

        do {
            const headers = this.buildAuthHeaders();
            const params: Record<string, string | number> = {
                dateFrom,
                pageSize: PAYU_PAGE_SIZE,
                page,
            };
            if (dateTo) params.dateTo = dateTo;

            try {
                const response = await axios.get<PayuSettlementResponse>(BASE_URL, {
                    headers,
                    params,
                    timeout: PAYU_API_TIMEOUT_MS,
                });

                if (response.data.status !== 0) {
                    settlementLogger.warn({ status: response.data.status, dateFrom, dateTo }, 'PayU API non-zero status');
                    break;
                }

                const { result } = response.data;
                totalCount = result.totalCount;
                allSettlements.push(...result.data);

                settlementLogger.debug({
                    dateFrom, dateTo, page,
                    fetched: result.data.length,
                    totalCount,
                }, 'PayU settlements page fetched');

                page++;
            } catch (error: unknown) {
                if (axios.isAxiosError(error) && error.response?.status && error.response.status >= 400 && error.response.status < 500) {
                    settlementLogger.error({
                        status: error.response.status,
                        data: error.response.data,
                        dateFrom, dateTo,
                    }, 'PayU API client error');
                    throw error;
                }

                settlementLogger.error({
                    error: error instanceof Error ? error.message : String(error),
                    dateFrom, dateTo, page,
                }, 'PayU API request failed');
                throw error;
            }
        } while (allSettlements.length < totalCount);

        return allSettlements;
    }
}

const payuClient = new PayuClient();
export default payuClient;
