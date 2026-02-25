/**
 * File Storage Service — server filesystem storage for invoices & bank transactions.
 *
 * Stores files in organized folder structure under FILE_STORAGE_ROOT:
 *   invoices/{sanitized-party-name}/{FY-YYYY-YY}/{8char-uuid}_{original-filename}
 *   invoices/_unlinked/{FY-YYYY-YY}/...
 *   bank-transactions/{sanitized-party-name}/{FY-YYYY-YY}/...
 *
 * Reuses sanitize() and getFinancialYear() from existing services.
 */

import fs from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { env } from '../config/env.js';
import { getFinancialYear } from '../config/sync/drive.js';
import logger from '../utils/logger.js';

const log = logger.child({ module: 'fileStorage' });

/** Resolved absolute root path — set by init() */
let rootPath: string;

/**
 * Sanitize a string for use in a folder/file name.
 * Replaces spaces/slashes/special chars with dashes, trims.
 */
function sanitize(str: string): string {
    return str
        .replace(/[\/\\:*?"<>|]+/g, '-')
        .replace(/\s+/g, '-')
        .replace(/-+/g, '-')
        .replace(/^-|-$/g, '');
}

/**
 * Initialize file storage — ensures root directory and subdirectories exist.
 * Call once at server startup.
 */
export async function init(): Promise<void> {
    rootPath = path.resolve(env.FILE_STORAGE_ROOT);
    await fs.mkdir(path.join(rootPath, 'invoices'), { recursive: true });
    await fs.mkdir(path.join(rootPath, 'bank-transactions'), { recursive: true });
    log.info({ rootPath }, 'File storage initialized');
}

/**
 * Save a file to disk at the given relative path (under rootPath).
 * Creates intermediate directories as needed.
 */
export async function saveFile(relativePath: string, buffer: Buffer): Promise<void> {
    const absPath = path.join(rootPath, relativePath);
    await fs.mkdir(path.dirname(absPath), { recursive: true });
    await fs.writeFile(absPath, buffer);
}

/**
 * Read a file from disk by relative path.
 * Returns null if the file doesn't exist.
 */
export async function readFile(relativePath: string): Promise<Buffer | null> {
    try {
        const absPath = path.join(rootPath, relativePath);
        return await fs.readFile(absPath);
    } catch (err: unknown) {
        if (err instanceof Error && 'code' in err && (err as NodeJS.ErrnoException).code === 'ENOENT') {
            return null;
        }
        throw err;
    }
}

/**
 * Check whether a file exists on disk.
 */
export async function fileExists(relativePath: string): Promise<boolean> {
    try {
        await fs.access(path.join(rootPath, relativePath));
        return true;
    } catch {
        return false;
    }
}

/**
 * Get absolute path for a relative file path.
 */
export function getAbsolutePath(relativePath: string): string {
    return path.join(rootPath, relativePath);
}

/**
 * Build the relative path for an invoice file.
 *
 * Pattern: invoices/{party}/{FY}/{8char-uuid}_{filename}
 * Unlinked: invoices/_unlinked/{FY}/{8char-uuid}_{filename}
 */
export function buildInvoicePath(
    partyName: string | null | undefined,
    date: Date,
    fileName: string,
): string {
    const party = partyName ? sanitize(partyName) : '_unlinked';
    const fy = getFinancialYear(date);
    const prefix = randomUUID().slice(0, 8);
    const safeName = sanitize(fileName);
    return path.join('invoices', party, fy, `${prefix}_${safeName}`);
}

/**
 * Build the relative path for a bank transaction file.
 *
 * Pattern: bank-transactions/{party}/{FY}/{8char-uuid}_{filename}
 */
export function buildBankTransactionPath(
    partyName: string | null | undefined,
    date: Date,
    fileName: string,
): string {
    const party = partyName ? sanitize(partyName) : '_unlinked';
    const fy = getFinancialYear(date);
    const prefix = randomUUID().slice(0, 8);
    const safeName = sanitize(fileName);
    return path.join('bank-transactions', party, fy, `${prefix}_${safeName}`);
}
