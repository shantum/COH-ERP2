/**
 * CSV upload route for COD remittance reconciliation
 */

import { Router } from 'express';
import type { Request, Response } from 'express';
import multer from 'multer';
import { parse } from 'csv-parse/sync';
import shopifyClient from '../../services/shopify/index.js';
import { settleOrderInvoice } from '../../services/orderSettlement.js';
import { generateDraftInvoice } from '../../services/orderInvoiceGenerator.js';
import { asyncHandler } from '../../middleware/asyncHandler.js';
import { ValidationError } from '../../utils/errors.js';
import { parseDate, normalizeColumnName } from './csvUtils.js';
import type { NormalizedRecord, UploadResults } from './csvUtils.js';

// Tolerance for amount mismatch (in percentage) before flagging for manual review
const AMOUNT_MISMATCH_TOLERANCE = 5; // 5%

// Configure multer for file upload (in memory)
const upload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: 10 * 1024 * 1024 }, // 10MB limit
    fileFilter: (_req, file, cb) => {
        if (file.mimetype === 'text/csv' || file.originalname.endsWith('.csv')) {
            cb(null, true);
        } else {
            cb(new Error('Only CSV files are allowed'));
        }
    }
});

const router: Router = Router();

/**
 * Upload COD remittance CSV and reconcile orders
 * @route POST /api/remittance/upload
 * @param {File} file - CSV file (multipart/form-data)
 * @returns {Object} { success, message, results: { total, matched, updated, alreadyPaid, notFound[], errors[], shopifySynced, shopifyFailed, manualReview, dateRange } }
 * @description Expected CSV columns: Order No., AWB NO., Price, Remittance Date, Remittance UTR. Normalizes column names, handles BOM, parses DD-Mon-YY dates.
 */
router.post('/upload', upload.single('file'), asyncHandler(async (req: Request, res: Response) => {
    if (!req.file) {
        throw new ValidationError('No file uploaded');
    }

    const file = req.file as Express.Multer.File;

    // Parse CSV - strip BOM if present
    let csvContent = file.buffer.toString('utf-8');
    // Remove UTF-8 BOM if present
    if (csvContent.charCodeAt(0) === 0xFEFF) {
        csvContent = csvContent.slice(1);
    }
    let records: Record<string, string>[];

    try {
        records = parse(csvContent, {
            columns: true,
            skip_empty_lines: true,
            trim: true,
            relax_column_count: true,
            bom: true, // Also tell csv-parse to handle BOM
        });
    } catch (parseError) {
        const error = parseError as Error;
        throw new ValidationError(`CSV parsing error: ${error.message}`);
    }

    if (records.length === 0) {
        throw new ValidationError('CSV file is empty');
    }

    // Process each record
    const results: UploadResults = {
        total: records.length,
        matched: 0,
        updated: 0,
        alreadyPaid: 0,
        notFound: [],
        errors: [],
    };

    for (const record of records) {
        // Normalize keys
        const normalizedRecord: NormalizedRecord = {};
        for (const [key, value] of Object.entries(record)) {
            normalizedRecord[normalizeColumnName(key)] = value;
        }

        // Extract order number (try multiple column names)
        const orderNumber = normalizedRecord.orderNumber ||
                           normalizedRecord.orderno ||
                           record['Order No.'] ||
                           record['Order No'];

        if (!orderNumber) {
            results.errors.push({ record, error: 'Missing order number' });
            continue;
        }

        // Find order in database
        const order = await req.prisma.order.findFirst({
            where: {
                OR: [
                    { orderNumber: String(orderNumber) },
                    { orderNumber: String(orderNumber).trim() },
                ]
            },
            select: {
                id: true,
                orderNumber: true,
                shopifyOrderId: true,
                paymentMethod: true,
                codRemittedAt: true,
                totalAmount: true,
            }
        });

        if (!order) {
            results.notFound.push({
                orderNumber,
                customer: normalizedRecord.customer || record['Customer'] || '-',
                amount: normalizedRecord.amount || record['Price'] || '-',
            });
            continue;
        }

        results.matched++;

        // Check if already marked as paid
        if (order.codRemittedAt) {
            results.alreadyPaid++;
            continue;
        }

        // Parse remittance details
        const remittanceDate = parseDate(
            normalizedRecord.remittanceDate ||
            record['Remittance Date'] ||
            record['Remittance date']
        );

        const utr = normalizedRecord.utr ||
                   record['Remittance UTR'] ||
                   record['UTR'] ||
                   null;

        const amount = parseFloat(
            normalizedRecord.amount ||
            record['Price'] ||
            record['COD Amount'] ||
            '0'
        ) || null;

        // Check for amount mismatch (flag for manual review)
        let syncStatus = 'pending';
        let syncError: string | null = null;

        if (amount && order.totalAmount) {
            const diff = Math.abs(amount - order.totalAmount);
            const percentDiff = (diff / order.totalAmount) * 100;
            if (percentDiff > AMOUNT_MISMATCH_TOLERANCE) {
                syncStatus = 'manual_review';
                syncError = `Amount mismatch: CSV=${amount}, Order=${order.totalAmount} (${percentDiff.toFixed(1)}% diff)`;
            }
        }

        // Generate draft invoice for COD order (idempotent, skips if exists)
        try {
            await generateDraftInvoice(req.prisma, order.id);
        } catch (invoiceErr: unknown) {
            console.warn(`[remittance] Failed to generate invoice for order ${order.id}:`,
                invoiceErr instanceof Error ? invoiceErr.message : 'Unknown');
        }

        // Update order with remittance details using transaction for atomic check
        try {
            await req.prisma.$transaction(async (tx) => {
                // Atomic check + update - only update if NOT already remitted
                const updated = await tx.order.updateMany({
                    where: {
                        id: order.id,
                        codRemittedAt: null  // Only if NOT already remitted
                    },
                    data: {
                        codRemittedAt: remittanceDate || new Date(),
                        codRemittanceUtr: utr,
                        codRemittedAmount: amount,
                        codShopifySyncStatus: syncStatus,
                        codShopifySyncError: syncError,
                        settledAt: remittanceDate || new Date(),
                        settlementAmount: amount,
                        settlementRef: utr ? `COD-CSV-${utr}` : null,
                    }
                });

                if (updated.count === 0) {
                    // Order was already remitted by concurrent request
                    results.skipped = (results.skipped || 0) + 1;
                    return; // Exit transaction early
                }

                results.updated++;

                // Settle order invoice (confirm draft, allocate if bank txn available)
                if (req.user) {
                    await settleOrderInvoice(tx, {
                        orderId: order.id,
                        amount: amount || order.totalAmount,
                        userId: req.user.id,
                        settlementRef: utr ? `COD-CSV-${utr}` : undefined,
                    });
                }

                // Attempt Shopify sync if order has shopifyOrderId and not flagged for manual review
                if (order.shopifyOrderId && syncStatus === 'pending') {
                    try {
                        // Ensure Shopify client is loaded
                        await shopifyClient.loadFromDatabase();

                        if (shopifyClient.isConfigured()) {
                            const syncResult = await shopifyClient.markOrderAsPaid(
                                order.shopifyOrderId,
                                amount || order.totalAmount,
                                utr || '',
                                remittanceDate || new Date()
                            );

                            if (syncResult.success) {
                                await tx.order.update({
                                    where: { id: order.id },
                                    data: {
                                        codShopifySyncStatus: 'synced',
                                        codShopifySyncedAt: new Date(),
                                        codShopifySyncError: null,
                                    }
                                });
                                results.shopifySynced = (results.shopifySynced || 0) + 1;
                            } else {
                                await tx.order.update({
                                    where: { id: order.id },
                                    data: {
                                        codShopifySyncStatus: 'failed',
                                        codShopifySyncError: syncResult.error,
                                    }
                                });
                                results.shopifyFailed = (results.shopifyFailed || 0) + 1;
                            }
                        }
                    } catch (shopifyError) {
                        const error = shopifyError as Error;
                        // Don't fail the whole upload if Shopify sync fails
                        await tx.order.update({
                            where: { id: order.id },
                            data: {
                                codShopifySyncStatus: 'failed',
                                codShopifySyncError: error.message,
                            }
                        });
                        results.shopifyFailed = (results.shopifyFailed || 0) + 1;
                    }
                } else if (syncStatus === 'manual_review') {
                    results.manualReview = (results.manualReview || 0) + 1;
                }
            });

        } catch (updateError) {
            const error = updateError as Error;
            results.errors.push({
                orderNumber,
                error: error.message,
            });
        }
    }

    // Update date range tracking in SystemSetting
    if (results.updated > 0) {
        // Find min and max remittance dates from this batch
        const processedDates: Date[] = [];
        for (const record of records) {
            const normalizedRecord: NormalizedRecord = {};
            for (const [key, value] of Object.entries(record)) {
                normalizedRecord[normalizeColumnName(key)] = value;
            }
            const date = parseDate(
                normalizedRecord.remittanceDate ||
                record['Remittance Date'] ||
                record['Remittance date']
            );
            if (date) processedDates.push(date);
        }

        if (processedDates.length > 0) {
            const minDate = new Date(Math.min(...processedDates.map(d => d.getTime())));
            const maxDate = new Date(Math.max(...processedDates.map(d => d.getTime())));

            // Update earliest date
            const currentEarliest = await req.prisma.systemSetting.findUnique({
                where: { key: 'cod_remittance_earliest_date' }
            });
            if (!currentEarliest || new Date(currentEarliest.value) > minDate) {
                await req.prisma.systemSetting.upsert({
                    where: { key: 'cod_remittance_earliest_date' },
                    create: { key: 'cod_remittance_earliest_date', value: minDate.toISOString() },
                    update: { value: minDate.toISOString() },
                });
            }

            // Update latest date
            const currentLatest = await req.prisma.systemSetting.findUnique({
                where: { key: 'cod_remittance_latest_date' }
            });
            if (!currentLatest || new Date(currentLatest.value) < maxDate) {
                await req.prisma.systemSetting.upsert({
                    where: { key: 'cod_remittance_latest_date' },
                    create: { key: 'cod_remittance_latest_date', value: maxDate.toISOString() },
                    update: { value: maxDate.toISOString() },
                });
            }

            results.dateRange = {
                earliest: minDate.toISOString(),
                latest: maxDate.toISOString(),
            };
        }
    }

    res.json({
        success: true,
        message: `Processed ${results.total} records`,
        results,
    });
}));

export default router;
