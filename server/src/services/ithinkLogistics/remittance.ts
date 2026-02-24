/**
 * iThink Logistics — Remittance operations
 */

import type {
    IThinkRemittanceSummary,
    IThinkRemittanceDetail,
    IThinkRemittanceResponse,
} from '../../types/ithinkApi.js';
import { axiosWithRetry, axios, API_TIMEOUT_MS, REMITTANCE_DETAIL_TIMEOUT_MS } from './axiosClient.js';
import { loadFromDatabase } from './config.js';
import type { ClientContext } from './types.js';

/**
 * Get remittance summaries for a given date
 * @param remittanceDate - Date in "YYYY-MM-DD" format
 * @returns Array of remittance summary records
 */
export async function getRemittances(
    ctx: ClientContext,
    remittanceDate: string
): Promise<IThinkRemittanceSummary[]> {
    await loadFromDatabase(ctx);

    if (!ctx.accessToken || !ctx.secretKey) {
        throw new Error('iThink Logistics credentials not configured');
    }

    const response = await axiosWithRetry(
        () => axios.post<IThinkRemittanceResponse<IThinkRemittanceSummary> | []>(
            `${ctx.orderBaseUrl}/remittance/get.json`,
            {
                data: {
                    access_token: ctx.accessToken,
                    secret_key: ctx.secretKey,
                    remittance_date: remittanceDate,
                },
            },
            {
                headers: { 'Content-Type': 'application/json' },
                timeout: API_TIMEOUT_MS,
            }
        ),
        `getRemittances:${remittanceDate}`
    );

    // API returns [] when no data for the date
    if (Array.isArray(response.data)) return [];

    if (response.data.status_code !== 200) {
        const msg = response.data.message || response.data.html_message || 'Remittance API error';
        throw new Error(`iThink remittance API error: ${msg}`);
    }

    return response.data.data || [];
}

/**
 * Get per-order remittance details for a given date
 * @param remittanceDate - Date in "YYYY-MM-DD" format
 * @returns Array of per-order detail records
 */
export async function getRemittanceDetails(
    ctx: ClientContext,
    remittanceDate: string
): Promise<IThinkRemittanceDetail[]> {
    await loadFromDatabase(ctx);

    if (!ctx.accessToken || !ctx.secretKey) {
        throw new Error('iThink Logistics credentials not configured');
    }

    // No retry wrapper — this endpoint is genuinely slow (returns per-order data),
    // so retrying on timeout would just waste 2x120s more.
    const response = await axios.post<IThinkRemittanceResponse<IThinkRemittanceDetail> | []>(
        `${ctx.orderBaseUrl}/remittance/get_details.json`,
        {
            data: {
                access_token: ctx.accessToken,
                secret_key: ctx.secretKey,
                remittance_date: remittanceDate,
            },
        },
        {
            headers: { 'Content-Type': 'application/json' },
            timeout: REMITTANCE_DETAIL_TIMEOUT_MS,
        }
    );

    // API returns [] when no data for the date
    if (Array.isArray(response.data)) return [];

    if (response.data.status_code !== 200) {
        const msg = response.data.message || response.data.html_message || 'Remittance details API error';
        throw new Error(`iThink remittance details API error: ${msg}`);
    }

    return response.data.data || [];
}
