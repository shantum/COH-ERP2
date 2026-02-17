/**
 * @module routes/remittance
 * @description COD remittance reconciliation with Shopify sync
 *
 * CSV Upload Workflow:
 * 1. Parse CSV (expected columns: Order No., AWB NO., Price, Remittance Date, Remittance UTR)
 * 2. Match orders by orderNumber, validate amount (5% tolerance)
 * 3. Update order: codRemittedAt, codRemittanceUtr, codRemittedAmount, codShopifySyncStatus
 * 4. Auto-sync to Shopify if order has shopifyOrderId (creates transaction via markOrderAsPaid)
 * 5. Track date range in SystemSetting (earliest/latest remittance dates)
 *
 * Sync Statuses: 'pending', 'synced', 'failed', 'manual_review' (>5% amount mismatch)
 * Shopify Sync: markOrderAsPaid() creates transaction, updates financial_status to 'paid'
 *
 * Gotchas:
 * - CSV BOM handling (0xFEFF)
 * - Date parsing supports "DD-Mon-YY" format (e.g., "06-Jan-26")
 * - Amount mismatch >5% flags for manual_review
 * - Already-paid orders skipped (codRemittedAt not null)
 *
 * @see services/shopify.ts - markOrderAsPaid method
 */

import { Router } from 'express';
import type { Request, Response } from 'express';
import multer from 'multer';
import { parse } from 'csv-parse/sync';
import shopifyClient from '../services/shopify.js';
import { asyncHandler } from '../middleware/asyncHandler.js';
import { ValidationError, NotFoundError, BusinessLogicError } from '../utils/errors.js';
import { requireAdmin } from '../middleware/auth.js';

const router: Router = Router();

// All remittance routes require admin access
router.use(requireAdmin);

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

// Type for normalized CSV record
type NormalizedRecord = Record<string, string | undefined>;

// Type for upload results
interface UploadResults {
    total: number;
    matched: number;
    updated: number;
    alreadyPaid: number;
    notFound: Array<{ orderNumber: string; customer: string; amount: string }>;
    errors: Array<{ record?: Record<string, unknown>; orderNumber?: string; error: string }>;
    skipped?: number;
    shopifySynced?: number;
    shopifyFailed?: number;
    manualReview?: number;
    dateRange?: { earliest: string; latest: string };
}

// Type for sync results
interface SyncResults {
    total: number;
    synced: number;
    failed: number;
    alreadySynced?: number;
    errors: Array<{ orderNumber: string; error: string }>;
}

/**
 * Parse date string from CSV (formats: "06-Jan-26", "2026-01-06", etc.)
 */
function parseDate(dateStr: string | undefined | null): Date | null {
    if (!dateStr) return null;

    // Try "DD-Mon-YY" format (e.g., "06-Jan-26")
    const monthMap: Record<string, number> = {
        'jan': 0, 'feb': 1, 'mar': 2, 'apr': 3, 'may': 4, 'jun': 5,
        'jul': 6, 'aug': 7, 'sep': 8, 'oct': 9, 'nov': 10, 'dec': 11
    };

    const match = dateStr.match(/^(\d{1,2})-([A-Za-z]{3})-(\d{2})$/);
    if (match) {
        const day = parseInt(match[1]);
        const month = monthMap[match[2].toLowerCase()];
        let year = parseInt(match[3]);
        // Assume 20xx for 2-digit years
        year = year < 50 ? 2000 + year : 1900 + year;
        return new Date(year, month, day);
    }

    // Try ISO format or other standard formats
    const parsed = new Date(dateStr);
    return isNaN(parsed.getTime()) ? null : parsed;
}

/**
 * Normalize column names from CSV headers
 */
function normalizeColumnName(name: string): string {
    const normalized = name.toLowerCase().replace(/[^a-z0-9]/g, '');
    const mappings: Record<string, string> = {
        'awbno': 'awb',
        'awbnumber': 'awb',
        'orderno': 'orderNumber',
        'ordernumber': 'orderNumber',
        'price': 'amount',
        'codamount': 'amount',
        'remittancedate': 'remittanceDate',
        'remittanceutr': 'utr',
        'utr': 'utr',
    };
    return mappings[normalized] || normalized;
}

/**
 * Upload COD remittance CSV and reconcile orders
 * @route POST /api/remittance/upload
 * @param {File} file - CSV file (multipart/form-data)
 * @returns {Object} { success, message, results: { total, matched, updated, alreadyPaid, notFound[], errors[], shopifySynced, shopifyFailed, manualReview, dateRange } }
 * @description Expected CSV columns: Order No., AWB NO., Price, Remittance Date, Remittance UTR. Normalizes column names, handles BOM, parses DD-Mon-YY dates.
 * @example
 * FormData:
 *   file: remittance.csv
 * CSV:
 *   Order No.,Price,Remittance Date,Remittance UTR
 *   64040,1299,06-Jan-26,UTR123456789
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
                    }
                });

                if (updated.count === 0) {
                    // Order was already remitted by concurrent request
                    results.skipped = (results.skipped || 0) + 1;
                    return; // Exit transaction early
                }

                results.updated++;

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

/**
 * Get COD orders awaiting remittance (delivered, COD, not yet remitted)
 * @route GET /api/remittance/pending?limit=100
 * @param {number} [query.limit=100] - Max orders
 * @returns {Object} { orders: [{ id, orderNumber, customerName, totalAmount, deliveredAt, awbNumber, courier }], total, pendingAmount }
 */
router.get('/pending', asyncHandler(async (req: Request, res: Response) => {
    const { limit = 100 } = req.query;

    // Find COD orders where ALL lines are delivered and not yet remitted
    const orders = await req.prisma.order.findMany({
        where: {
            paymentMethod: 'COD',
            codRemittedAt: null,
            isArchived: false,
            // All lines must be delivered
            orderLines: {
                every: {
                    OR: [
                        { trackingStatus: 'delivered' },
                        { lineStatus: 'cancelled' }
                    ]
                },
                some: {
                    trackingStatus: 'delivered'
                }
            }
        },
        select: {
            id: true,
            orderNumber: true,
            customerName: true,
            totalAmount: true,
            orderLines: {
                select: {
                    deliveredAt: true,
                    awbNumber: true,
                    courier: true,
                },
                where: { trackingStatus: 'delivered' },
                take: 1
            }
        },
        orderBy: { orderDate: 'asc' },
        take: Number(limit),
    });

    const total = await req.prisma.order.count({
        where: {
            paymentMethod: 'COD',
            codRemittedAt: null,
            isArchived: false,
            orderLines: {
                every: {
                    OR: [
                        { trackingStatus: 'delivered' },
                        { lineStatus: 'cancelled' }
                    ]
                },
                some: {
                    trackingStatus: 'delivered'
                }
            }
        },
    });

    // Flatten to include line-level tracking data
    const flattenedOrders = orders.map(o => ({
        id: o.id,
        orderNumber: o.orderNumber,
        customerName: o.customerName,
        totalAmount: o.totalAmount,
        deliveredAt: o.orderLines[0]?.deliveredAt || null,
        awbNumber: o.orderLines[0]?.awbNumber || null,
        courier: o.orderLines[0]?.courier || null,
    }));

    res.json({
        orders: flattenedOrders,
        total,
        pendingAmount: orders.reduce((sum, o) => sum + (o.totalAmount || 0), 0),
    });
}));

/**
 * Get remittance summary stats
 * @route GET /api/remittance/summary?days=30
 * @param {number} [query.days=30] - Period for 'paid' stats
 * @returns {Object} { pending: { count, amount }, paid: { count, amount, periodDays }, processedRange: { earliest, latest } }
 */
router.get('/summary', asyncHandler(async (req: Request, res: Response) => {
    const { days = 30 } = req.query;
    const fromDate = new Date();
    fromDate.setDate(fromDate.getDate() - Number(days));

    // Get counts - use line-level trackingStatus
    const deliveredCodWhere = {
        paymentMethod: 'COD',
        codRemittedAt: null,
        isArchived: false,
        orderLines: {
            every: {
                OR: [
                    { trackingStatus: 'delivered' },
                    { lineStatus: 'cancelled' }
                ]
            },
            some: {
                trackingStatus: 'delivered'
            }
        }
    };

    const [pendingCount, paidCount, pendingAmount, paidAmount] = await Promise.all([
        req.prisma.order.count({
            where: deliveredCodWhere,
        }),
        req.prisma.order.count({
            where: {
                paymentMethod: 'COD',
                codRemittedAt: { gte: fromDate },
            },
        }),
        req.prisma.order.aggregate({
            where: deliveredCodWhere,
            _sum: { totalAmount: true },
        }),
        req.prisma.order.aggregate({
            where: {
                paymentMethod: 'COD',
                codRemittedAt: { gte: fromDate },
            },
            _sum: { codRemittedAmount: true },
        }),
    ]);

    // Get processed date range from SystemSetting
    const [earliestSetting, latestSetting] = await Promise.all([
        req.prisma.systemSetting.findUnique({ where: { key: 'cod_remittance_earliest_date' } }),
        req.prisma.systemSetting.findUnique({ where: { key: 'cod_remittance_latest_date' } }),
    ]);

    res.json({
        pending: {
            count: pendingCount,
            amount: pendingAmount._sum?.totalAmount || 0,
        },
        paid: {
            count: paidCount,
            amount: paidAmount._sum?.codRemittedAmount || 0,
            periodDays: Number(days),
        },
        processedRange: {
            earliest: earliestSetting?.value || null,
            latest: latestSetting?.value || null,
        },
    });
}));

/**
 * Get orders with failed/pending Shopify sync
 * @route GET /api/remittance/failed?limit=100
 * @param {number} [query.limit=100] - Max orders
 * @returns {Object} { orders: [...], counts: { failed, pending, manual_review }, total }
 */
router.get('/failed', asyncHandler(async (req: Request, res: Response) => {
    const { limit = 100 } = req.query;

    const orders = await req.prisma.order.findMany({
        where: {
            paymentMethod: 'COD',
            codRemittedAt: { not: null },
            codShopifySyncStatus: { in: ['failed', 'pending', 'manual_review'] },
        },
        select: {
            id: true,
            orderNumber: true,
            shopifyOrderId: true,
            customerName: true,
            totalAmount: true,
            codRemittedAt: true,
            codRemittanceUtr: true,
            codRemittedAmount: true,
            codShopifySyncStatus: true,
            codShopifySyncError: true,
        },
        orderBy: { codRemittedAt: 'desc' },
        take: Number(limit),
    });

    const counts = await req.prisma.order.groupBy({
        by: ['codShopifySyncStatus'],
        where: {
            paymentMethod: 'COD',
            codRemittedAt: { not: null },
            codShopifySyncStatus: { in: ['failed', 'pending', 'manual_review'] },
        },
        _count: true,
    });

    const statusCounts: Record<string, number> = {};
    for (const c of counts) {
        if (c.codShopifySyncStatus) {
            statusCounts[c.codShopifySyncStatus] = c._count;
        }
    }

    res.json({
        orders,
        counts: statusCounts,
        total: orders.length,
    });
}));

/**
 * Sync specific orders to Shopify (for already-remitted orders)
 * @route POST /api/remittance/sync-orders
 * @param {string[]} body.orderNumbers - Order numbers to sync
 * @returns {Object} { success, message, results: { total, synced, failed, alreadySynced, errors[] } }
 */
router.post('/sync-orders', asyncHandler(async (req: Request, res: Response) => {
    const { orderNumbers } = req.body as { orderNumbers?: string[] };

    if (!orderNumbers || !Array.isArray(orderNumbers) || orderNumbers.length === 0) {
        throw new ValidationError('orderNumbers array required');
    }

    // Find orders that have remittance data but haven't been synced yet
    const orders = await req.prisma.order.findMany({
        where: {
            orderNumber: { in: orderNumbers.map(String) },
            codRemittedAt: { not: null },
            shopifyOrderId: { not: null },
            OR: [
                { codShopifySyncStatus: null },
                { codShopifySyncStatus: { in: ['pending', 'failed'] } },
            ],
        },
        select: {
            id: true,
            orderNumber: true,
            shopifyOrderId: true,
            totalAmount: true,
            codRemittedAt: true,
            codRemittanceUtr: true,
            codRemittedAmount: true,
            codShopifySyncStatus: true,
        },
    });

    if (orders.length === 0) {
        res.json({
            success: true,
            message: 'No orders to sync (may already be synced or missing Shopify ID)',
            results: { total: 0, synced: 0, failed: 0 }
        });
        return;
    }

    // Ensure Shopify client is loaded
    await shopifyClient.loadFromDatabase();

    if (!shopifyClient.isConfigured()) {
        throw new ValidationError('Shopify is not configured');
    }

    const results: SyncResults = {
        total: orders.length,
        synced: 0,
        failed: 0,
        alreadySynced: orderNumbers.length - orders.length,
        errors: [],
    };

    for (const order of orders) {
        try {
            const syncResult = await shopifyClient.markOrderAsPaid(
                order.shopifyOrderId!,
                order.codRemittedAmount || order.totalAmount,
                order.codRemittanceUtr || '',
                order.codRemittedAt!
            );

            if (syncResult.success) {
                await req.prisma.order.update({
                    where: { id: order.id },
                    data: {
                        codShopifySyncStatus: 'synced',
                        codShopifySyncedAt: new Date(),
                        codShopifySyncError: null,
                    }
                });
                results.synced++;
            } else {
                await req.prisma.order.update({
                    where: { id: order.id },
                    data: {
                        codShopifySyncStatus: 'failed',
                        codShopifySyncError: syncResult.error,
                    }
                });
                results.failed++;
                results.errors.push({
                    orderNumber: order.orderNumber,
                    error: syncResult.error || 'Unknown error',
                });
            }
        } catch (syncError) {
            const error = syncError as Error;
            await req.prisma.order.update({
                where: { id: order.id },
                data: {
                    codShopifySyncStatus: 'failed',
                    codShopifySyncError: error.message,
                }
            });
            results.failed++;
            results.errors.push({
                orderNumber: order.orderNumber,
                error: error.message,
            });
        }
    }

    res.json({
        success: true,
        message: `Synced ${results.synced} of ${results.total} orders to Shopify`,
        results,
    });
}));

/**
 * Retry failed Shopify syncs
 * @route POST /api/remittance/retry-sync
 * @param {string[]} [body.orderIds] - Specific order UUIDs to retry
 * @param {boolean} [body.all=false] - Retry all failed/pending syncs
 * @returns {Object} { success, message, results: { total, synced, failed, errors[] } }
 */
router.post('/retry-sync', asyncHandler(async (req: Request, res: Response) => {
    const { orderIds, all = false } = req.body as { orderIds?: string[]; all?: boolean };

    // Build where clause
    interface WhereClause {
        paymentMethod: string;
        codRemittedAt: { not: null };
        shopifyOrderId: { not: null };
        codShopifySyncStatus?: { in: string[] };
        id?: { in: string[] };
    }

    const where: WhereClause = {
        paymentMethod: 'COD',
        codRemittedAt: { not: null },
        shopifyOrderId: { not: null },
    };

    if (all) {
        // Retry all failed/pending
        where.codShopifySyncStatus = { in: ['failed', 'pending'] };
    } else if (orderIds && Array.isArray(orderIds) && orderIds.length > 0) {
        // Retry specific orders
        where.id = { in: orderIds };
        where.codShopifySyncStatus = { in: ['failed', 'pending', 'manual_review'] };
    } else {
        throw new ValidationError('Provide orderIds array or set all=true');
    }

    const orders = await req.prisma.order.findMany({
        where,
        select: {
            id: true,
            orderNumber: true,
            shopifyOrderId: true,
            totalAmount: true,
            codRemittedAt: true,
            codRemittanceUtr: true,
            codRemittedAmount: true,
            codShopifySyncStatus: true,
        },
    });

    if (orders.length === 0) {
        res.json({ success: true, message: 'No orders to retry', results: { total: 0 } });
        return;
    }

    // Ensure Shopify client is loaded
    await shopifyClient.loadFromDatabase();

    if (!shopifyClient.isConfigured()) {
        throw new ValidationError('Shopify is not configured');
    }

    const results: SyncResults = {
        total: orders.length,
        synced: 0,
        failed: 0,
        errors: [],
    };

    for (const order of orders) {
        try {
            const syncResult = await shopifyClient.markOrderAsPaid(
                order.shopifyOrderId!,
                order.codRemittedAmount || order.totalAmount,
                order.codRemittanceUtr || '',
                order.codRemittedAt!
            );

            if (syncResult.success) {
                await req.prisma.order.update({
                    where: { id: order.id },
                    data: {
                        codShopifySyncStatus: 'synced',
                        codShopifySyncedAt: new Date(),
                        codShopifySyncError: null,
                    }
                });
                results.synced++;
            } else {
                await req.prisma.order.update({
                    where: { id: order.id },
                    data: {
                        codShopifySyncStatus: 'failed',
                        codShopifySyncError: syncResult.error,
                    }
                });
                results.failed++;
                results.errors.push({
                    orderNumber: order.orderNumber,
                    error: syncResult.error || 'Unknown error',
                });
            }
        } catch (syncError) {
            const error = syncError as Error;
            await req.prisma.order.update({
                where: { id: order.id },
                data: {
                    codShopifySyncStatus: 'failed',
                    codShopifySyncError: error.message,
                }
            });
            results.failed++;
            results.errors.push({
                orderNumber: order.orderNumber,
                error: error.message,
            });
        }
    }

    res.json({
        success: true,
        message: `Retried ${results.total} orders: ${results.synced} synced, ${results.failed} failed`,
        results,
    });
}));

/**
 * Approve manual_review order and sync to Shopify
 * @route POST /api/remittance/approve-manual
 * @param {string} body.orderId - Order UUID flagged for manual_review
 * @param {number} [body.approvedAmount] - Override amount (uses codRemittedAmount if omitted)
 * @returns {Object} { success, message, transaction }
 * @description For orders with >5% amount mismatch. Syncs to Shopify with approved amount.
 */
router.post('/approve-manual', asyncHandler(async (req: Request, res: Response) => {
    const { orderId, approvedAmount } = req.body as { orderId?: string; approvedAmount?: number };

    if (!orderId) {
        throw new ValidationError('orderId required');
    }

    const order = await req.prisma.order.findUnique({
        where: { id: orderId },
        select: {
            id: true,
            orderNumber: true,
            shopifyOrderId: true,
            totalAmount: true,
            codRemittedAt: true,
            codRemittanceUtr: true,
            codRemittedAmount: true,
            codShopifySyncStatus: true,
        },
    });

    if (!order) {
        throw new NotFoundError('Order not found', 'Order', orderId);
    }

    if (order.codShopifySyncStatus !== 'manual_review') {
        throw new BusinessLogicError('Order is not flagged for manual review', 'manual_review_required');
    }

    if (!order.shopifyOrderId) {
        throw new ValidationError('Order has no Shopify ID');
    }

    // Use approved amount or fall back to remitted amount
    const syncAmount = approvedAmount || order.codRemittedAmount || order.totalAmount;

    // Ensure Shopify client is loaded
    await shopifyClient.loadFromDatabase();

    if (!shopifyClient.isConfigured()) {
        throw new ValidationError('Shopify is not configured');
    }

    const syncResult = await shopifyClient.markOrderAsPaid(
        order.shopifyOrderId,
        syncAmount,
        order.codRemittanceUtr || '',
        order.codRemittedAt!
    );

    if (syncResult.success) {
        await req.prisma.order.update({
            where: { id: order.id },
            data: {
                codShopifySyncStatus: 'synced',
                codShopifySyncedAt: new Date(),
                codShopifySyncError: null,
                codRemittedAmount: syncAmount, // Update with approved amount
            }
        });

        res.json({
            success: true,
            message: `Order ${order.orderNumber} synced to Shopify`,
            transaction: syncResult.transaction,
        });
    } else {
        await req.prisma.order.update({
            where: { id: order.id },
            data: {
                codShopifySyncStatus: 'failed',
                codShopifySyncError: syncResult.error,
            }
        });

        throw new ValidationError(syncResult.error || 'Shopify sync failed');
    }
}));

/**
 * POST /api/remittance/reset
 * Reset remittance data for specific orders (admin only, for testing)
 */
router.post('/reset', asyncHandler(async (req: Request, res: Response) => {
    const { orderNumbers, clearDateRange } = req.body as { orderNumbers?: string[]; clearDateRange?: boolean };

    if (!orderNumbers || !Array.isArray(orderNumbers)) {
        throw new ValidationError('orderNumbers array required');
    }

    const result = await req.prisma.order.updateMany({
        where: {
            orderNumber: { in: orderNumbers.map(String) }
        },
        data: {
            codRemittedAt: null,
            codRemittanceUtr: null,
            codRemittedAmount: null,
            codShopifySyncStatus: null,
            codShopifySyncError: null,
            codShopifySyncedAt: null,
        }
    });

    // Also clear date range if requested
    if (clearDateRange) {
        await req.prisma.systemSetting.deleteMany({
            where: {
                key: { in: ['cod_remittance_earliest_date', 'cod_remittance_latest_date'] }
            }
        });
    }

    res.json({
        success: true,
        message: `Reset ${result.count} orders`,
        count: result.count,
    });
}));

/**
 * Fix payment method for orders with COD remittance but labeled Prepaid
 * @route POST /api/remittance/fix-payment-method
 * @returns {Object} { success, message, fixed, cacheFixed, orders[] }
 * @description Finds orders with codRemittedAt but paymentMethod='Prepaid', sets to 'COD'. Also fixes ShopifyOrderCache.
 */
router.post('/fix-payment-method', asyncHandler(async (req: Request, res: Response) => {
    // Find orders with COD remittance data but wrong payment method
    const affectedOrders = await req.prisma.order.findMany({
        where: {
            codRemittedAt: { not: null },
            paymentMethod: 'Prepaid',
        },
        select: {
            id: true,
            orderNumber: true,
            paymentMethod: true,
            codRemittedAt: true,
        }
    });

    if (affectedOrders.length === 0) {
        res.json({
            success: true,
            message: 'No orders need fixing',
            fixed: 0,
        });
        return;
    }

    // Fix them - set to COD
    const result = await req.prisma.order.updateMany({
        where: {
            codRemittedAt: { not: null },
            paymentMethod: 'Prepaid',
        },
        data: {
            paymentMethod: 'COD',
        }
    });

    // Also fix the ShopifyOrderCache entries
    const orderNumbers = affectedOrders.map(o => o.orderNumber);
    const cacheResult = await req.prisma.shopifyOrderCache.updateMany({
        where: {
            orderNumber: { in: orderNumbers },
        },
        data: {
            paymentMethod: 'COD',
        }
    });

    res.json({
        success: true,
        message: `Fixed ${result.count} orders from Prepaid to COD`,
        fixed: result.count,
        cacheFixed: cacheResult.count,
        orders: affectedOrders.map(o => o.orderNumber),
    });
}));

export default router;
