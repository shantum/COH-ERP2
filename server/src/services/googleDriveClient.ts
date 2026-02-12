/**
 * Google Drive API v3 Client (OAuth2 Authenticated)
 *
 * Uses OAuth2 refresh token to upload as a real Google user.
 * This avoids the service account storage quota limitation.
 *
 * Features:
 * - Lazy auth: creates OAuth2 client on first API call
 * - Rate limiter: respects Drive API quotas
 * - Retry: exponential backoff on 429/500/503
 * - Module-level singleton
 */

import { google, type drive_v3 } from 'googleapis';
import { Readable } from 'stream';
import { driveLogger } from '../utils/logger.js';
import {
    DRIVE_API_SCOPE,
    DRIVE_API_CALL_DELAY_MS,
    DRIVE_API_MAX_RETRIES,
} from '../config/sync/drive.js';

// ============================================
// TYPES
// ============================================

export interface UploadResult {
    fileId: string;
    webViewLink: string;
}

// ============================================
// SINGLETON STATE
// ============================================

let driveClient: drive_v3.Drive | null = null;
let lastCallAt = 0;

// ============================================
// AUTH
// ============================================

/**
 * Get or create the authenticated Drive client.
 * Uses OAuth2 with a refresh token so files are owned by the real user
 * and count against their storage (not the service account's zero quota).
 *
 * Required env vars:
 *   - GOOGLE_OAUTH_CLIENT_ID
 *   - GOOGLE_OAUTH_CLIENT_SECRET
 *   - GOOGLE_OAUTH_REFRESH_TOKEN
 */
function getClient(): drive_v3.Drive {
    if (driveClient) return driveClient;

    const clientId = process.env.GOOGLE_OAUTH_CLIENT_ID;
    const clientSecret = process.env.GOOGLE_OAUTH_CLIENT_SECRET;
    const refreshToken = process.env.GOOGLE_OAUTH_REFRESH_TOKEN;

    if (!clientId || !clientSecret || !refreshToken) {
        throw new Error(
            'Google Drive OAuth2 credentials not configured. ' +
            'Set GOOGLE_OAUTH_CLIENT_ID, GOOGLE_OAUTH_CLIENT_SECRET, and GOOGLE_OAUTH_REFRESH_TOKEN in .env'
        );
    }

    const oauth2Client = new google.auth.OAuth2(clientId, clientSecret);
    oauth2Client.setCredentials({ refresh_token: refreshToken });

    driveClient = google.drive({ version: 'v3', auth: oauth2Client });
    driveLogger.info('Google Drive API client initialized (OAuth2)');
    return driveClient;
}

// ============================================
// RATE LIMITER
// ============================================

async function rateLimit(): Promise<void> {
    const now = Date.now();
    const elapsed = now - lastCallAt;
    if (elapsed < DRIVE_API_CALL_DELAY_MS) {
        await new Promise(resolve => setTimeout(resolve, DRIVE_API_CALL_DELAY_MS - elapsed));
    }
    lastCallAt = Date.now();
}

// ============================================
// RETRY LOGIC
// ============================================

async function withRetry<T>(operation: () => Promise<T>, label: string): Promise<T> {
    let lastError: Error | null = null;

    for (let attempt = 0; attempt <= DRIVE_API_MAX_RETRIES; attempt++) {
        try {
            await rateLimit();
            return await operation();
        } catch (error: unknown) {
            lastError = error instanceof Error ? error : new Error(String(error));

            const rawCode = error instanceof Error && 'code' in error
                ? (error as Error & { code: unknown }).code
                : undefined;
            const statusCode = rawCode !== undefined ? Number(rawCode) : undefined;

            const isTransient = statusCode === 429 || statusCode === 500 || statusCode === 503;
            if (!isTransient || attempt === DRIVE_API_MAX_RETRIES) {
                throw lastError;
            }

            const delay = Math.pow(2, attempt) * 1000;
            driveLogger.warn(
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
 * Upload a file to Google Drive.
 * @returns fileId and webViewLink for the uploaded file
 */
export async function uploadFile(
    folderId: string,
    fileName: string,
    mimeType: string,
    buffer: Buffer
): Promise<UploadResult> {
    const client = getClient();

    const response = await withRetry(
        () => client.files.create({
            requestBody: {
                name: fileName,
                parents: [folderId],
            },
            media: {
                mimeType,
                body: Readable.from(buffer),
            },
            fields: 'id,webViewLink',
        }),
        `uploadFile(${fileName})`
    );

    const fileId = response.data.id;
    const webViewLink = response.data.webViewLink;

    if (!fileId || !webViewLink) {
        throw new Error(`Drive upload returned incomplete data for ${fileName}`);
    }

    driveLogger.info({ fileId, fileName, folderId }, 'File uploaded to Drive');
    return { fileId, webViewLink };
}

/**
 * Find or create a folder inside a parent folder.
 * @returns The folder ID (existing or newly created)
 */
export async function ensureFolder(
    parentId: string,
    name: string
): Promise<string> {
    const client = getClient();

    // Search for existing folder
    const query = `name='${name.replace(/'/g, "\\'")}' and '${parentId}' in parents and mimeType='application/vnd.google-apps.folder' and trashed=false`;

    const searchResult = await withRetry(
        () => client.files.list({
            q: query,
            fields: 'files(id)',
            pageSize: 1,
        }),
        `ensureFolder.search(${name})`
    );

    const existing = searchResult.data.files?.[0];
    if (existing?.id) {
        return existing.id;
    }

    // Create new folder
    const createResult = await withRetry(
        () => client.files.create({
            requestBody: {
                name,
                parents: [parentId],
                mimeType: 'application/vnd.google-apps.folder',
            },
            fields: 'id',
        }),
        `ensureFolder.create(${name})`
    );

    const folderId = createResult.data.id;
    if (!folderId) {
        throw new Error(`Failed to create folder "${name}" in parent ${parentId}`);
    }

    driveLogger.info({ folderId, name, parentId }, 'Created folder on Drive');
    return folderId;
}
