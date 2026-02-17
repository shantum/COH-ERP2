/**
 * Google Drive Finance Document Sync Service
 *
 * Pushes finance documents (vendor invoices, payment receipts) from DB to
 * Google Drive, organized by party and financial year.
 *
 * One-way sync: ERP → Drive. Drive is a browsable copy for the CA.
 * DB remains source of truth.
 *
 * Folder structure:
 *   COH Finance/
 *     Vendor Invoices/
 *       Party Name/
 *         FY 2025-26/
 *           INV-1801.pdf
 *           PAY-UTR123-2025-06-15.pdf
 *     _Unlinked/
 *       FY 2025-26/
 *         INV-misc.png
 */

import prisma from '../lib/prisma.js';
import { driveLogger } from '../utils/logger.js';
import { trackWorkerRun } from '../utils/workerRunTracker.js';
import { uploadFile, ensureFolder } from './googleDriveClient.js';
import {
    DRIVE_FINANCE_FOLDER_ID,
    DRIVE_SYNC_BATCH_SIZE,
    DRIVE_UNLINKED_FOLDER_NAME,
    DRIVE_VENDOR_INVOICES_FOLDER_NAME,
    getFinancialYear,
} from '../config/sync/drive.js';

// ============================================
// MODULE STATE
// ============================================

const SYNC_INTERVAL_MS = 30 * 60 * 1000; // 30 minutes
const STARTUP_DELAY_MS = 3 * 60 * 1000;  // 3 minutes after startup

let isRunning = false;
let lastSyncAt: Date | null = null;
let lastSyncResult: { uploaded: number; errors: number } | null = null;
let syncInterval: ReturnType<typeof setInterval> | null = null;

/** In-memory cache: "parentId/folderName" → folderId */
const folderCache = new Map<string, string>();

// ============================================
// FOLDER RESOLUTION
// ============================================

/**
 * Resolve the Drive folder for a document, creating folders as needed.
 * Path: root → Vendor Invoices → party → FY
 */
async function resolveFolderId(
    partyName: string | null | undefined,
    date: Date
): Promise<string> {
    const rootId = DRIVE_FINANCE_FOLDER_ID;
    if (!rootId) throw new Error('DRIVE_FINANCE_FOLDER_ID not set');

    // Level 0: Vendor Invoices folder (or _Unlinked at root)
    const partyFolder = partyName || DRIVE_UNLINKED_FOLDER_NAME;
    const fyFolder = getFinancialYear(date);

    const isUnlinked = partyFolder === DRIVE_UNLINKED_FOLDER_NAME;
    const parentForParty = isUnlinked ? rootId : await getVendorInvoicesFolderId(rootId);

    // Level 1: party folder (inside Vendor Invoices)
    const partyKey = `${parentForParty}/${partyFolder}`;
    let partyFolderId = folderCache.get(partyKey);
    if (!partyFolderId) {
        partyFolderId = await ensureFolder(parentForParty, partyFolder);
        folderCache.set(partyKey, partyFolderId);
    }

    // Level 2: FY folder
    const fyKey = `${partyFolderId}/${fyFolder}`;
    let fyFolderId = folderCache.get(fyKey);
    if (!fyFolderId) {
        fyFolderId = await ensureFolder(partyFolderId, fyFolder);
        folderCache.set(fyKey, fyFolderId);
    }

    return fyFolderId;
}

/** Cached Vendor Invoices folder ID */
let vendorInvoicesFolderId: string | null = null;

async function getVendorInvoicesFolderId(rootId: string): Promise<string> {
    if (vendorInvoicesFolderId) return vendorInvoicesFolderId;
    vendorInvoicesFolderId = await ensureFolder(rootId, DRIVE_VENDOR_INVOICES_FOLDER_NAME);
    return vendorInvoicesFolderId;
}

// ============================================
// FILE NAMING
// ============================================

/**
 * Extract file extension from the original filename or mime type.
 */
function getExtension(fileName: string | null, mimeType: string | null): string {
    if (fileName) {
        const dot = fileName.lastIndexOf('.');
        if (dot >= 0) return fileName.slice(dot);
    }
    const mimeMap: Record<string, string> = {
        'application/pdf': '.pdf',
        'image/jpeg': '.jpg',
        'image/png': '.png',
        'image/webp': '.webp',
        'image/gif': '.gif',
    };
    return mimeMap[mimeType ?? ''] ?? '.bin';
}

/**
 * Sanitize a string for use in a file name.
 * Replaces spaces/slashes/special chars with dashes, trims.
 */
function sanitize(str: string): string {
    return str.replace(/[\/\\:*?"<>|]+/g, '-').replace(/\s+/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '');
}

// ============================================
// UPLOAD FUNCTIONS
// ============================================

/**
 * Upload an invoice's file attachment to Drive.
 * Fetches from DB, resolves folder, uploads, saves driveFileId/driveUrl.
 */
export async function uploadInvoiceFile(invoiceId: string): Promise<boolean> {
    const invoice = await prisma.invoice.findUnique({
        where: { id: invoiceId },
        select: {
            id: true,
            invoiceNumber: true,
            invoiceDate: true,
            createdAt: true,
            fileData: true,
            fileName: true,
            fileMimeType: true,
            driveFileId: true,
            party: { select: { name: true } },
        },
    });

    if (!invoice || !invoice.fileData) {
        driveLogger.debug({ invoiceId }, 'No file data — skipping');
        return false;
    }

    if (invoice.driveFileId) {
        driveLogger.debug({ invoiceId }, 'Already uploaded — skipping');
        return false;
    }

    const date = invoice.invoiceDate ?? invoice.createdAt;
    const ext = getExtension(invoice.fileName, invoice.fileMimeType);
    const party = sanitize(invoice.party?.name ?? 'Unknown');
    const invNum = sanitize(invoice.invoiceNumber ?? invoice.id.slice(0, 8));
    const dateStr = date.toISOString().split('T')[0];
    const driveName = `${party}_INV-${invNum}_${dateStr}${ext}`;

    const folderId = await resolveFolderId(
        invoice.party?.name,
        date
    );

    const result = await uploadFile(
        folderId,
        driveName,
        invoice.fileMimeType ?? 'application/octet-stream',
        Buffer.from(invoice.fileData)
    );

    await prisma.invoice.update({
        where: { id: invoiceId },
        data: {
            driveFileId: result.fileId,
            driveUrl: result.webViewLink,
            driveUploadedAt: new Date(),
        },
    });

    driveLogger.info(
        { invoiceId, driveFileId: result.fileId, driveName },
        'Invoice file uploaded to Drive'
    );
    return true;
}

/**
 * Upload a payment's file attachment to Drive.
 */
export async function uploadPaymentFile(paymentId: string): Promise<boolean> {
    const payment = await prisma.payment.findUnique({
        where: { id: paymentId },
        select: {
            id: true,
            referenceNumber: true,
            paymentDate: true,
            fileData: true,
            fileName: true,
            fileMimeType: true,
            driveFileId: true,
            party: { select: { name: true } },
        },
    });

    if (!payment || !payment.fileData) {
        driveLogger.debug({ paymentId }, 'No file data — skipping');
        return false;
    }

    if (payment.driveFileId) {
        driveLogger.debug({ paymentId }, 'Already uploaded — skipping');
        return false;
    }

    const dateStr = payment.paymentDate.toISOString().split('T')[0];
    const ref = sanitize(payment.referenceNumber ?? payment.id.slice(0, 8));
    const ext = getExtension(payment.fileName, payment.fileMimeType);
    const party = sanitize(payment.party?.name ?? 'Unknown');
    const driveName = `${party}_PAY-${ref}_${dateStr}${ext}`;

    const folderId = await resolveFolderId(
        payment.party?.name,
        payment.paymentDate
    );

    const result = await uploadFile(
        folderId,
        driveName,
        payment.fileMimeType ?? 'application/octet-stream',
        Buffer.from(payment.fileData)
    );

    await prisma.payment.update({
        where: { id: paymentId },
        data: {
            driveFileId: result.fileId,
            driveUrl: result.webViewLink,
            driveUploadedAt: new Date(),
        },
    });

    driveLogger.info(
        { paymentId, driveFileId: result.fileId, driveName },
        'Payment file uploaded to Drive'
    );
    return true;
}

// ============================================
// BATCH SYNC
// ============================================

/**
 * Find all invoices & payments with files but no driveFileId, upload them in batches.
 */
export async function syncAllPendingFiles(): Promise<{ uploaded: number; errors: number }> {
    if (isRunning) {
        driveLogger.warn('Sync already running — skipping');
        return { uploaded: 0, errors: 0 };
    }

    if (!DRIVE_FINANCE_FOLDER_ID) {
        driveLogger.warn('DRIVE_FINANCE_FOLDER_ID not set — skipping sync');
        return { uploaded: 0, errors: 0 };
    }

    isRunning = true;
    let uploaded = 0;
    let errors = 0;

    try {
        // Pending invoices
        const pendingInvoices = await prisma.invoice.findMany({
            where: {
                fileData: { not: null },
                driveFileId: null,
            },
            select: { id: true },
            take: DRIVE_SYNC_BATCH_SIZE * 10, // Up to 100 pending
        });

        driveLogger.info({ count: pendingInvoices.length }, 'Pending invoice files to upload');

        for (const inv of pendingInvoices) {
            try {
                const ok = await uploadInvoiceFile(inv.id);
                if (ok) uploaded++;
            } catch (err: unknown) {
                errors++;
                driveLogger.error(
                    { invoiceId: inv.id, error: err instanceof Error ? err.message : String(err) },
                    'Failed to upload invoice file'
                );
            }
        }

        // Pending payments
        const pendingPayments = await prisma.payment.findMany({
            where: {
                fileData: { not: null },
                driveFileId: null,
            },
            select: { id: true },
            take: DRIVE_SYNC_BATCH_SIZE * 10,
        });

        driveLogger.info({ count: pendingPayments.length }, 'Pending payment files to upload');

        for (const pmt of pendingPayments) {
            try {
                const ok = await uploadPaymentFile(pmt.id);
                if (ok) uploaded++;
            } catch (err: unknown) {
                errors++;
                driveLogger.error(
                    { paymentId: pmt.id, error: err instanceof Error ? err.message : String(err) },
                    'Failed to upload payment file'
                );
            }
        }

        lastSyncResult = { uploaded, errors };
        lastSyncAt = new Date();
        driveLogger.info({ uploaded, errors }, 'Drive sync completed');
    } finally {
        isRunning = false;
    }

    return { uploaded, errors };
}

// ============================================
// WORKER EXPORTS
// ============================================

function start(): void {
    if (syncInterval) {
        driveLogger.debug('Scheduler already running');
        return;
    }

    if (!DRIVE_FINANCE_FOLDER_ID) {
        driveLogger.warn('DRIVE_FINANCE_FOLDER_ID not set — Drive sync disabled');
        return;
    }

    driveLogger.info({ intervalMinutes: SYNC_INTERVAL_MS / 60_000 }, 'Drive sync scheduler starting');

    // First run after startup delay
    setTimeout(() => {
        trackWorkerRun('drive_sync', syncAllPendingFiles, 'startup').catch(() => {});
    }, STARTUP_DELAY_MS);

    // Then every 30 minutes
    syncInterval = setInterval(() => {
        trackWorkerRun('drive_sync', syncAllPendingFiles, 'scheduled').catch(() => {});
    }, SYNC_INTERVAL_MS);
}

function stop(): void {
    if (syncInterval) {
        clearInterval(syncInterval);
        syncInterval = null;
        driveLogger.info('Drive sync scheduler stopped');
    }
}

function getStatus() {
    return {
        isRunning,
        schedulerActive: !!syncInterval,
        intervalMinutes: SYNC_INTERVAL_MS / 60_000,
        lastSyncAt,
        lastSyncResult,
        folderCacheSize: folderCache.size,
        configured: !!DRIVE_FINANCE_FOLDER_ID,
    };
}

async function triggerSync() {
    return trackWorkerRun('drive_sync', syncAllPendingFiles, 'manual');
}

export default {
    start,
    stop,
    getStatus,
    triggerSync,
};
