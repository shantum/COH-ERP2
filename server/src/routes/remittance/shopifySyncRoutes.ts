/**
 * Shopify sync routes for COD remittance (sync-orders, retry-sync, approve-manual)
 */

import { Router } from 'express';
import type { Request, Response } from 'express';
import shopifyClient from '../../services/shopify/index.js';
import { asyncHandler } from '../../middleware/asyncHandler.js';
import { ValidationError, NotFoundError, BusinessLogicError } from '../../utils/errors.js';
import type { SyncResults } from './csvUtils.js';

const router: Router = Router();

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
            console.error(`[remittance] Shopify sync failed for order ${order.orderNumber}:`, error.message);
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
            console.error(`[remittance] Shopify sync failed for order ${order.orderNumber}:`, error.message);
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

export default router;
