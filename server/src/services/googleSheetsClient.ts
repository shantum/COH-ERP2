/**
 * Google Sheets API v4 Client (Authenticated)
 *
 * Separate from googleSheetsFetcher.ts which uses unauthenticated CSV export.
 * This client uses a service account JWT for read + write + delete operations,
 * needed by the sheet offload worker.
 *
 * Features:
 * - Lazy auth: authenticates on first API call
 * - Rate limiter: respects 300 calls/min quota (250 safe limit)
 * - Retry: exponential backoff on 429/500/503
 * - Module-level singleton
 */

import { google, type sheets_v4 } from 'googleapis';
import { readFileSync, existsSync } from 'fs';
import { sheetsLogger } from '../utils/logger.js';
import {
    GOOGLE_SERVICE_ACCOUNT_PATH,
    SHEETS_API_SCOPE,
    API_CALL_DELAY_MS,
    API_MAX_RETRIES,
} from '../config/sync/sheets.js';

// ============================================
// TYPES
// ============================================

interface ServiceAccountKey {
    client_email: string;
    private_key: string;
}

// ============================================
// SINGLETON STATE
// ============================================

let sheetsClient: sheets_v4.Sheets | null = null;
let lastCallAt = 0;

// ============================================
// AUTH
// ============================================

/**
 * Get or create the authenticated Sheets client.
 * Lazy: first call reads the service account key and creates the JWT.
 *
 * Credential sources (checked in order):
 *   1. GOOGLE_SERVICE_ACCOUNT_JSON env var (JSON string — ideal for Railway/CI)
 *   2. JSON key file at GOOGLE_SERVICE_ACCOUNT_PATH (local dev)
 */
function getClient(): sheets_v4.Sheets {
    if (sheetsClient) return sheetsClient;

    let keyFile: ServiceAccountKey;

    const envJson = process.env.GOOGLE_SERVICE_ACCOUNT_JSON;
    if (envJson) {
        keyFile = JSON.parse(envJson);
        sheetsLogger.info('Using Google service account from GOOGLE_SERVICE_ACCOUNT_JSON env var');
    } else if (existsSync(GOOGLE_SERVICE_ACCOUNT_PATH)) {
        keyFile = JSON.parse(readFileSync(GOOGLE_SERVICE_ACCOUNT_PATH, 'utf-8'));
        sheetsLogger.info('Using Google service account from key file');
    } else {
        throw new Error(
            'Google service account credentials not found. ' +
            'Set GOOGLE_SERVICE_ACCOUNT_JSON env var or place key file at server/config/google-service-account.json'
        );
    }

    const auth = new google.auth.JWT({
        email: keyFile.client_email,
        key: keyFile.private_key,
        scopes: [SHEETS_API_SCOPE],
    });

    sheetsClient = google.sheets({ version: 'v4', auth });
    sheetsLogger.info('Google Sheets API client initialized');
    return sheetsClient;
}

// ============================================
// RATE LIMITER
// ============================================

/**
 * Wait if needed to respect rate limit (min API_CALL_DELAY_MS between calls)
 */
async function rateLimit(): Promise<void> {
    const now = Date.now();
    const elapsed = now - lastCallAt;
    if (elapsed < API_CALL_DELAY_MS) {
        await new Promise(resolve => setTimeout(resolve, API_CALL_DELAY_MS - elapsed));
    }
    lastCallAt = Date.now();
}

// ============================================
// RETRY LOGIC
// ============================================

/**
 * Retry on transient errors (429, 500, 503) with exponential backoff
 */
async function withRetry<T>(operation: () => Promise<T>, label: string): Promise<T> {
    let lastError: Error | null = null;

    for (let attempt = 0; attempt <= API_MAX_RETRIES; attempt++) {
        try {
            await rateLimit();
            return await operation();
        } catch (error: unknown) {
            lastError = error instanceof Error ? error : new Error(String(error));

            // Extract HTTP status code — googleapis throws GaxiosError with `code` as string
            const rawCode = error instanceof Error && 'code' in error
                ? (error as Error & { code: unknown }).code
                : undefined;
            const statusCode = rawCode !== undefined ? Number(rawCode) : undefined;

            // Only retry on transient errors
            const isTransient = statusCode === 429 || statusCode === 500 || statusCode === 503;
            if (!isTransient || attempt === API_MAX_RETRIES) {
                throw lastError;
            }

            const delay = Math.pow(2, attempt) * 1000; // 1s, 2s, 4s
            sheetsLogger.warn(
                { attempt: attempt + 1, delay, statusCode, label },
                'Retrying after transient error'
            );
            await new Promise(resolve => setTimeout(resolve, delay));
        }
    }

    throw lastError ?? new Error(`${label}: exhausted retries`);
}

// ============================================
// PUBLIC API
// ============================================

/**
 * Read a range from a spreadsheet.
 * @returns 2D array of strings (empty cells are empty strings)
 */
export async function readRange(
    spreadsheetId: string,
    range: string
): Promise<string[][]> {
    const client = getClient();

    const response = await withRetry(
        () => client.spreadsheets.values.get({
            spreadsheetId,
            range,
            valueRenderOption: 'FORMATTED_VALUE',
        }),
        `readRange(${range})`
    );

    // Google Sheets API returns mixed types — coerce everything to strings
    const raw = response.data.values ?? [];
    return raw.map(row => row.map(cell => String(cell ?? '')));
}

/**
 * Read multiple ranges in a single API call using values.batchGet.
 * Much faster than calling readRange() in a loop.
 * @returns Map of range string to 2D string array
 */
export async function batchReadRanges(
    spreadsheetId: string,
    ranges: string[]
): Promise<Map<string, string[][]>> {
    if (ranges.length === 0) return new Map();

    const client = getClient();

    const response = await withRetry(
        () => client.spreadsheets.values.batchGet({
            spreadsheetId,
            ranges,
            valueRenderOption: 'FORMATTED_VALUE',
        }),
        `batchReadRanges(${ranges.length} ranges)`
    );

    // Google guarantees valueRanges is in the same order as input ranges.
    // Store parsed data under the original requested key (primary) and
    // Google's normalized key (alias) — parse values only once.
    const result = new Map<string, string[][]>();
    const valueRanges = response.data.valueRanges ?? [];

    for (let i = 0; i < valueRanges.length; i++) {
        const vr = valueRanges[i];
        const raw = vr.values ?? [];
        const parsed = raw.map(row => row.map(cell => String(cell ?? '')));

        // Primary: store under the original key the caller used
        result.set(ranges[i], parsed);

        // Alias: also store under Google's normalized key if different
        if (vr.range && vr.range !== ranges[i]) {
            result.set(vr.range, parsed);
        }
    }

    return result;
}

/**
 * Overwrite cells in a spreadsheet range.
 */
export async function writeRange(
    spreadsheetId: string,
    range: string,
    values: (string | number)[][]
): Promise<void> {
    const client = getClient();

    await withRetry(
        () => client.spreadsheets.values.update({
            spreadsheetId,
            range,
            valueInputOption: 'USER_ENTERED',
            requestBody: { values },
        }),
        `writeRange(${range})`
    );
}

/**
 * Write multiple ranges in a single API call using values.batchUpdate.
 * Much faster than calling writeRange() in a loop.
 */
export async function batchWriteRanges(
    spreadsheetId: string,
    data: Array<{ range: string; values: (string | number)[][] }>
): Promise<void> {
    if (data.length === 0) return;

    const client = getClient();

    await withRetry(
        () => client.spreadsheets.values.batchUpdate({
            spreadsheetId,
            requestBody: {
                valueInputOption: 'USER_ENTERED',
                data: data.map(d => ({
                    range: d.range,
                    values: d.values,
                })),
            },
        }),
        `batchWriteRanges(${data.length} ranges)`
    );
}

/**
 * Append rows to the end of a range.
 * Returns the 0-based start row index where data was appended.
 */
export async function appendRows(
    spreadsheetId: string,
    range: string,
    values: (string | number)[][]
): Promise<number> {
    const client = getClient();

    const response = await withRetry(
        () => client.spreadsheets.values.append({
            spreadsheetId,
            range,
            valueInputOption: 'USER_ENTERED',
            requestBody: { values },
        }),
        `appendRows(${range})`
    );

    // Extract start row from updatedRange (e.g. "'Orders from COH'!A125:AD136" → 124)
    const updatedRange = response.data.updates?.updatedRange ?? '';
    const match = updatedRange.match(/!.*?(\d+):/);
    return match ? parseInt(match[1], 10) - 1 : -1; // Convert 1-based to 0-based
}

/**
 * Apply a bottom border to specific rows.
 * @param spreadsheetId - Spreadsheet ID
 * @param sheetId - Numeric sheet ID (from getSheetId)
 * @param rowIndices - 0-based row indices to add a bottom border to
 * @param endCol - Last column index (exclusive, default 30 for A-AD)
 */
export async function addBottomBorders(
    spreadsheetId: string,
    sheetId: number,
    rowIndices: number[],
    endCol = 30
): Promise<void> {
    if (rowIndices.length === 0) return;

    const client = getClient();
    const border = { style: 'SOLID' as const, width: 1, color: { red: 0, green: 0, blue: 0 } };

    const requests = rowIndices.map(rowIdx => ({
        updateBorders: {
            range: {
                sheetId,
                startRowIndex: rowIdx,
                endRowIndex: rowIdx + 1,
                startColumnIndex: 0,
                endColumnIndex: endCol,
            },
            bottom: border,
        },
    }));

    await withRetry(
        () => client.spreadsheets.batchUpdate({
            spreadsheetId,
            requestBody: { requests },
        }),
        `addBottomBorders(${rowIndices.length} rows)`
    );
}

/**
 * Get the numeric sheet ID for a tab name.
 * Required for row deletion (batchUpdate uses sheet IDs, not names).
 */
export async function getSheetId(
    spreadsheetId: string,
    sheetName: string
): Promise<number> {
    const client = getClient();

    const response = await withRetry(
        () => client.spreadsheets.get({
            spreadsheetId,
            includeGridData: false,
        }),
        `getSheetId(${sheetName})`
    );

    const sheet = response.data.sheets?.find(
        s => s.properties?.title === sheetName
    );

    if (!sheet?.properties?.sheetId && sheet?.properties?.sheetId !== 0) {
        throw new Error(`Sheet "${sheetName}" not found in spreadsheet`);
    }

    return sheet.properties.sheetId;
}

/**
 * Delete rows from a sheet using batchUpdate.
 * IMPORTANT: Rows must be deleted bottom-up to avoid index shifting.
 *
 * @param spreadsheetId - Spreadsheet ID
 * @param sheetId - Numeric sheet ID (from getSheetId)
 * @param startRow - Start row index (0-based, inclusive)
 * @param endRow - End row index (0-based, exclusive)
 */
export async function deleteRows(
    spreadsheetId: string,
    sheetId: number,
    startRow: number,
    endRow: number
): Promise<void> {
    const client = getClient();

    await withRetry(
        () => client.spreadsheets.batchUpdate({
            spreadsheetId,
            requestBody: {
                requests: [{
                    deleteDimension: {
                        range: {
                            sheetId,
                            dimension: 'ROWS',
                            startIndex: startRow,
                            endIndex: endRow,
                        },
                    },
                }],
            },
        }),
        `deleteRows(${startRow}-${endRow})`
    );
}

/**
 * Delete multiple non-contiguous row ranges (bottom-up).
 * Groups contiguous rows into ranges for efficiency.
 *
 * @param spreadsheetId - Spreadsheet ID
 * @param sheetId - Numeric sheet ID
 * @param rowIndices - Array of 0-based row indices to delete (any order)
 */
export async function deleteRowsBatch(
    spreadsheetId: string,
    sheetId: number,
    rowIndices: number[]
): Promise<void> {
    if (rowIndices.length === 0) return;

    // Sort descending — delete from bottom up to prevent index shift
    const sorted = [...rowIndices].sort((a, b) => b - a);

    // Group contiguous rows into ranges
    const ranges: Array<{ start: number; end: number }> = [];
    let rangeStart = sorted[0];
    let rangeEnd = sorted[0] + 1;

    for (let i = 1; i < sorted.length; i++) {
        if (sorted[i] === rangeStart - 1) {
            // Contiguous — extend range upward
            rangeStart = sorted[i];
        } else {
            // Gap — push current range, start new one
            ranges.push({ start: rangeStart, end: rangeEnd });
            rangeStart = sorted[i];
            rangeEnd = sorted[i] + 1;
        }
    }
    ranges.push({ start: rangeStart, end: rangeEnd });

    // Build batch requests (already bottom-up because sorted descending)
    const requests = ranges.map(r => ({
        deleteDimension: {
            range: {
                sheetId,
                dimension: 'ROWS' as const,
                startIndex: r.start,
                endIndex: r.end,
            },
        },
    }));

    const client = getClient();

    await withRetry(
        () => client.spreadsheets.batchUpdate({
            spreadsheetId,
            requestBody: { requests },
        }),
        `deleteRowsBatch(${rowIndices.length} rows)`
    );
}
