/**
 * COD Remittance Routes
 *
 * Handles COD remittance CSV upload and order payment status updates
 * With automatic sync to Shopify
 */

import express from 'express';
import multer from 'multer';
import { parse } from 'csv-parse/sync';
import shopifyClient from '../services/shopify.js';
import asyncHandler from '../middleware/asyncHandler.js';
import { ValidationError, NotFoundError, BusinessLogicError } from '../utils/errors.js';

const router = express.Router();

// Tolerance for amount mismatch (in percentage) before flagging for manual review
const AMOUNT_MISMATCH_TOLERANCE = 5; // 5%

// Configure multer for file upload (in memory)
const upload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: 10 * 1024 * 1024 }, // 10MB limit
    fileFilter: (req, file, cb) => {
        if (file.mimetype === 'text/csv' || file.originalname.endsWith('.csv')) {
            cb(null, true);
        } else {
            cb(new Error('Only CSV files are allowed'));
        }
    }
});

/**
 * Parse date string from CSV (formats: "06-Jan-26", "2026-01-06", etc.)
 */
function parseDate(dateStr) {
    if (!dateStr) return null;

    // Try "DD-Mon-YY" format (e.g., "06-Jan-26")
    const monthMap = {
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
 * POST /api/remittance/upload
 * Upload COD remittance CSV and mark orders as paid
 *
 * Expected CSV columns:
 * - AWB NO. (optional, can match by AWB)
 * - Order No. (required, matches orderNumber)
 * - Customer (informational)
 * - Price (COD amount)
 * - Remittance Date
 * - Remittance UTR (bank reference)
 */
router.post('/upload', upload.single('file'), asyncHandler(async (req, res) => {
    if (!req.file) {
        throw new ValidationError('No file uploaded');
    }

    // Parse CSV - strip BOM if present
    let csvContent = req.file.buffer.toString('utf-8');
    // Remove UTF-8 BOM if present
    if (csvContent.charCodeAt(0) === 0xFEFF) {
        csvContent = csvContent.slice(1);
    }
    let records;

    try {
        records = parse(csvContent, {
            columns: true,
            skip_empty_lines: true,
            trim: true,
            relax_column_count: true,
            bom: true, // Also tell csv-parse to handle BOM
        });
    } catch (parseError) {
        throw new ValidationError(`CSV parsing error: ${parseError.message}`);
    }

    if (records.length === 0) {
        throw new ValidationError('CSV file is empty');
    }

    // Normalize column names (handle variations)
    const normalizeColumnName = (name) => {
        const normalized = name.toLowerCase().replace(/[^a-z0-9]/g, '');
        const mappings = {
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
    };

    // Process each record
    const results = {
        total: records.length,
        matched: 0,
        updated: 0,
        alreadyPaid: 0,
        notFound: [],
        errors: [],
    };

    for (const record of records) {
        // Normalize keys
        const normalizedRecord = {};
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
        let syncError = null;

        if (amount && order.totalAmount) {
            const diff = Math.abs(amount - order.totalAmount);
            const percentDiff = (diff / order.totalAmount) * 100;
            if (percentDiff > AMOUNT_MISMATCH_TOLERANCE) {
                syncStatus = 'manual_review';
                syncError = `Amount mismatch: CSV=${amount}, Order=${order.totalAmount} (${percentDiff.toFixed(1)}% diff)`;
            }
        }

        // Update order with remittance details
        try {
            await req.prisma.order.update({
                where: { id: order.id },
                data: {
                    codRemittedAt: remittanceDate || new Date(),
                    codRemittanceUtr: utr,
                    codRemittedAmount: amount,
                    codShopifySyncStatus: syncStatus,
                    codShopifySyncError: syncError,
                }
            });
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
                            utr,
                            remittanceDate || new Date()
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
                            results.shopifySynced = (results.shopifySynced || 0) + 1;
                        } else {
                            await req.prisma.order.update({
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
                    // Don't fail the whole upload if Shopify sync fails
                    await req.prisma.order.update({
                        where: { id: order.id },
                        data: {
                            codShopifySyncStatus: 'failed',
                            codShopifySyncError: shopifyError.message,
                        }
                    });
                    results.shopifyFailed = (results.shopifyFailed || 0) + 1;
                }
            } else if (syncStatus === 'manual_review') {
                results.manualReview = (results.manualReview || 0) + 1;
            }

        } catch (updateError) {
            results.errors.push({
                orderNumber,
                error: updateError.message,
            });
        }
    }

    // Update date range tracking in SystemSetting
    if (results.updated > 0) {
        // Find min and max remittance dates from this batch
        const processedDates = [];
        for (const record of records) {
            const normalizedRecord = {};
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
 * GET /api/remittance/pending
 * Get COD orders that haven't been marked as paid yet
 */
router.get('/pending', asyncHandler(async (req, res) => {
    const { limit = 100 } = req.query;

    const orders = await req.prisma.order.findMany({
        where: {
            paymentMethod: 'COD',
            trackingStatus: 'delivered',
            codRemittedAt: null,
            isArchived: false,
        },
        select: {
            id: true,
            orderNumber: true,
            customerName: true,
            totalAmount: true,
            deliveredAt: true,
            awbNumber: true,
            courier: true,
        },
        orderBy: { deliveredAt: 'asc' },
        take: Number(limit),
    });

    const total = await req.prisma.order.count({
        where: {
            paymentMethod: 'COD',
            trackingStatus: 'delivered',
            codRemittedAt: null,
            isArchived: false,
        },
    });

    res.json({
        orders,
        total,
        pendingAmount: orders.reduce((sum, o) => sum + (o.totalAmount || 0), 0),
    });
}));

/**
 * GET /api/remittance/summary
 * Get COD remittance summary stats
 */
router.get('/summary', asyncHandler(async (req, res) => {
    const { days = 30 } = req.query;
    const fromDate = new Date();
    fromDate.setDate(fromDate.getDate() - Number(days));

    // Get counts
    const [pendingCount, paidCount, pendingAmount, paidAmount] = await Promise.all([
        req.prisma.order.count({
            where: {
                paymentMethod: 'COD',
                trackingStatus: 'delivered',
                codRemittedAt: null,
                isArchived: false,
            },
        }),
        req.prisma.order.count({
            where: {
                paymentMethod: 'COD',
                codRemittedAt: { not: null },
                codRemittedAt: { gte: fromDate },
            },
        }),
        req.prisma.order.aggregate({
            where: {
                paymentMethod: 'COD',
                trackingStatus: 'delivered',
                codRemittedAt: null,
                isArchived: false,
            },
            _sum: { totalAmount: true },
        }),
        req.prisma.order.aggregate({
            where: {
                paymentMethod: 'COD',
                codRemittedAt: { not: null },
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
            amount: pendingAmount._sum.totalAmount || 0,
        },
        paid: {
            count: paidCount,
            amount: paidAmount._sum.codRemittedAmount || 0,
            periodDays: Number(days),
        },
        processedRange: {
            earliest: earliestSetting?.value || null,
            latest: latestSetting?.value || null,
        },
    });
}));

/**
 * GET /api/remittance/failed
 * Get orders that failed Shopify sync
 */
router.get('/failed', asyncHandler(async (req, res) => {
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

    const statusCounts = {};
    for (const c of counts) {
        statusCounts[c.codShopifySyncStatus] = c._count;
    }

    res.json({
        orders,
        counts: statusCounts,
        total: orders.length,
    });
}));

/**
 * POST /api/remittance/sync-orders
 * Sync specific orders to Shopify by order number (for orders already marked as paid)
 */
router.post('/sync-orders', asyncHandler(async (req, res) => {
    const { orderNumbers } = req.body;

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
        return res.json({
            success: true,
            message: 'No orders to sync (may already be synced or missing Shopify ID)',
            results: { total: 0, synced: 0, failed: 0 }
        });
    }

    // Ensure Shopify client is loaded
    await shopifyClient.loadFromDatabase();

    if (!shopifyClient.isConfigured()) {
        throw new ValidationError('Shopify is not configured');
    }

    const results = {
        total: orders.length,
        synced: 0,
        failed: 0,
        alreadySynced: orderNumbers.length - orders.length,
        errors: [],
    };

    for (const order of orders) {
        try {
            const syncResult = await shopifyClient.markOrderAsPaid(
                order.shopifyOrderId,
                order.codRemittedAmount || order.totalAmount,
                order.codRemittanceUtr,
                order.codRemittedAt
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
                    error: syncResult.error,
                });
            }
        } catch (syncError) {
            await req.prisma.order.update({
                where: { id: order.id },
                data: {
                    codShopifySyncStatus: 'failed',
                    codShopifySyncError: syncError.message,
                }
            });
            results.failed++;
            results.errors.push({
                orderNumber: order.orderNumber,
                error: syncError.message,
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
 * POST /api/remittance/retry-sync
 * Retry Shopify sync for failed orders
 */
router.post('/retry-sync', asyncHandler(async (req, res) => {
    const { orderIds, all = false } = req.body;

    // Build where clause
    const where = {
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
        return res.json({ success: true, message: 'No orders to retry', results: { total: 0 } });
    }

    // Ensure Shopify client is loaded
    await shopifyClient.loadFromDatabase();

    if (!shopifyClient.isConfigured()) {
        throw new ValidationError('Shopify is not configured');
    }

    const results = {
        total: orders.length,
        synced: 0,
        failed: 0,
        errors: [],
    };

    for (const order of orders) {
        try {
            const syncResult = await shopifyClient.markOrderAsPaid(
                order.shopifyOrderId,
                order.codRemittedAmount || order.totalAmount,
                order.codRemittanceUtr,
                order.codRemittedAt
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
                    error: syncResult.error,
                });
            }
        } catch (syncError) {
            await req.prisma.order.update({
                where: { id: order.id },
                data: {
                    codShopifySyncStatus: 'failed',
                    codShopifySyncError: syncError.message,
                }
            });
            results.failed++;
            results.errors.push({
                orderNumber: order.orderNumber,
                error: syncError.message,
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
 * POST /api/remittance/approve-manual
 * Approve manual review orders and sync to Shopify
 */
router.post('/approve-manual', asyncHandler(async (req, res) => {
    const { orderId, approvedAmount } = req.body;

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
        order.codRemittanceUtr,
        order.codRemittedAt
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

        throw new ValidationError(syncResult.error);
    }
}));

/**
 * POST /api/remittance/reset
 * Reset remittance data for specific orders (admin only, for testing)
 */
router.post('/reset', asyncHandler(async (req, res) => {
    const { orderNumbers } = req.body;

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
    if (req.body.clearDateRange) {
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
 * POST /api/remittance/fix-payment-method
 * Fix orders that were incorrectly changed from COD to Prepaid
 * Any order with codRemittedAt set but paymentMethod='Prepaid' was likely COD
 */
router.post('/fix-payment-method', asyncHandler(async (req, res) => {
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
        return res.json({
            success: true,
            message: 'No orders need fixing',
            fixed: 0,
        });
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
