/**
 * Return Prime Webhook Handler
 *
 * Receives webhooks from Return Prime and processes return requests.
 * Main entry point for the Return Prime integration.
 *
 * Webhook events:
 * - request/created: Logged only (returns created on approval)
 * - request/approved: Creates line-level returns in COH-ERP
 * - request/received: Updates status (if we didn't receive locally first)
 * - request/inspected: Updates RP status
 * - request/refunded: Marks refund complete (if not done locally)
 * - request/rejected: Updates resolution to rejected
 * - request/archived: Updates RP status
 * - request/updated: Updates timestamps
 */

import crypto from 'crypto';
import { Router, Request, Response, NextFunction } from 'express';
import { ReturnPrimeWebhookPayloadSchema, type ReturnPrimeWebhookPayload } from '@coh/shared/schemas';
import {
    checkWebhookDuplicate as _checkWebhookDuplicate,
    updateWebhookLog as _updateWebhookLog,
} from '../utils/webhookUtils.js';
import { matchReturnPrimeLinesToOrderLines, getMatchSummary } from '../utils/returnPrimeLineMatching.js';
import { mapReturnPrimeReason } from '../config/mappings/returnPrimeReasons.js';
import type { PrismaClient } from '@prisma/client';
import { broadcastOrderUpdate } from './sse.js';

const router = Router();

// ============================================
// TYPE-SAFE WRAPPERS FOR JS UTILITIES
// ============================================

interface DedupeResult {
    duplicate: boolean;
    status?: string;
    isRetry?: boolean;
    existing?: unknown;
}

const checkWebhookDuplicate = _checkWebhookDuplicate as (
    prisma: PrismaClient,
    webhookId: string | undefined
) => Promise<DedupeResult>;

const updateWebhookLog = _updateWebhookLog as (
    prisma: PrismaClient,
    webhookId: string | undefined,
    status: string,
    error?: string | null,
    processingTime?: number | null,
    resultData?: unknown
) => Promise<void>;

// ============================================
// TYPES
// ============================================

interface WebhookRequest extends Omit<Request, 'rawBody'> {
    rawBody?: string | Buffer;
    prisma: PrismaClient;
}

interface HandlerResult {
    action: string;
    [key: string]: unknown;
}

// ============================================
// WEBHOOK VERIFICATION MIDDLEWARE
// ============================================

/**
 * Get webhook secret from env or database
 */
async function getWebhookSecret(prisma: PrismaClient): Promise<string | null> {
    if (process.env.RETURNPRIME_WEBHOOK_SECRET) {
        return process.env.RETURNPRIME_WEBHOOK_SECRET;
    }

    try {
        const setting = await prisma.systemSetting.findUnique({
            where: { key: 'returnprime_webhook_secret' },
        });
        return setting?.value || null;
    } catch {
        return null;
    }
}

/**
 * Verify Return Prime webhook signature
 */
async function verifyReturnPrimeWebhook(
    req: WebhookRequest,
    res: Response,
    next: NextFunction
): Promise<void> {
    const secret = await getWebhookSecret(req.prisma);

    // Dev mode: accept without verification if no secret configured
    if (!secret) {
        console.warn('[ReturnPrime] Webhook secret not configured - accepting without verification');
        return next();
    }

    const signature = req.get('X-RP-Signature');
    const timestamp = req.get('X-RP-Timestamp');

    if (!signature) {
        res.status(401).json({ error: 'Missing signature header' });
        return;
    }

    // Prevent replay attacks - reject if older than 5 minutes
    if (timestamp) {
        const age = Date.now() - parseInt(timestamp, 10);
        if (age > 300000) {
            res.status(401).json({ error: 'Request too old' });
            return;
        }
    }

    // Verify HMAC signature
    const rawBody = req.rawBody;
    const bodyStr = Buffer.isBuffer(rawBody) ? rawBody.toString('utf8') : (rawBody || '');
    const payload = timestamp ? `${timestamp}.${bodyStr}` : bodyStr;
    const expected = crypto
        .createHmac('sha256', secret)
        .update(payload)
        .digest('hex');

    // Constant-time comparison
    const signatureBuffer = Buffer.from(signature);
    const expectedBuffer = Buffer.from(expected);

    if (signatureBuffer.length !== expectedBuffer.length ||
        !crypto.timingSafeEqual(signatureBuffer, expectedBuffer)) {
        res.status(401).json({ error: 'Invalid signature' });
        return;
    }

    next();
}

// ============================================
// MAIN ROUTE HANDLER
// ============================================

router.post('/', verifyReturnPrimeWebhook, async (req: WebhookRequest, res: Response): Promise<void> => {
    const startTime = Date.now();
    const webhookId = req.get('X-RP-Webhook-Id') ||
        `rp-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const topic = req.body.topic || req.get('X-RP-Topic') || 'unknown';

    console.log(`[ReturnPrime] Received webhook: ${topic} (${webhookId})`);

    try {
        // 1. Idempotency check
        const dedupe = await checkWebhookDuplicate(req.prisma, webhookId);
        if (dedupe.duplicate) {
            console.log(`[ReturnPrime] Skipping duplicate webhook: ${webhookId}`);
            res.status(200).json({ received: true, skipped: true, reason: 'duplicate' });
            return;
        }

        // 2. Log webhook receipt
        const requestBody = req.body as { request?: { id?: string } };
        await req.prisma.webhookLog.create({
            data: {
                webhookId,
                topic,
                source: 'returnprime',
                resourceId: requestBody.request?.id || 'unknown',
                status: 'processing',
                payload: JSON.stringify(req.body).slice(0, 50000),
            },
        });

        // 3. Validate payload
        const validation = ReturnPrimeWebhookPayloadSchema.safeParse(req.body);
        if (!validation.success) {
            const errorMsg = validation.error.issues.map(i => `${i.path.join('.')}: ${i.message}`).join('; ');
            console.error(`[ReturnPrime] Validation failed: ${errorMsg}`);
            await updateWebhookLog(req.prisma, webhookId, 'failed', errorMsg);
            res.status(200).json({ received: true, error: 'Validation failed' });
            return;
        }

        // 4. Route to handler
        const result = await routeToHandler(req.prisma, topic, validation.data);

        // 5. Update log with result
        const processingTime = Date.now() - startTime;
        await updateWebhookLog(req.prisma, webhookId, 'processed', null, processingTime, result);

        // 6. Broadcast SSE for real-time UI updates
        if (result.action !== 'logged' && result.action !== 'skipped') {
            const eventType = result.action === 'created'
                ? 'return_initiated' as const
                : 'return_status_updated' as const;
            broadcastOrderUpdate({ type: eventType }, null);
        }

        console.log(`[ReturnPrime] Processed ${topic} in ${processingTime}ms:`, result);
        res.status(200).json({ received: true, ...result });

    } catch (error) {
        const message = error instanceof Error ? error.message : 'Unknown error';
        console.error(`[ReturnPrime] Webhook error:`, error);

        await updateWebhookLog(req.prisma, webhookId, 'failed', message);

        // Always return 200 to prevent retries for errors we can't handle
        res.status(200).json({ received: true, error: message });
    }
});

// ============================================
// EVENT ROUTER
// ============================================

async function routeToHandler(
    prisma: PrismaClient,
    topic: string,
    payload: ReturnPrimeWebhookPayload
): Promise<HandlerResult> {
    switch (topic) {
        case 'request/created':
            return handleRequestCreated(prisma, payload);
        case 'request/approved':
            return handleRequestApproved(prisma, payload);
        case 'request/received':
            return handleRequestReceived(prisma, payload);
        case 'request/inspected':
            return handleRequestInspected(prisma, payload);
        case 'request/refunded':
            return handleRequestRefunded(prisma, payload);
        case 'request/rejected':
            return handleRequestRejected(prisma, payload);
        case 'request/archived':
            return handleRequestArchived(prisma, payload);
        case 'request/updated':
            return handleRequestUpdated(prisma, payload);
        default:
            console.warn(`[ReturnPrime] Unknown webhook topic: ${topic}`);
            return { action: 'skipped', reason: `unknown_topic: ${topic}` };
    }
}

// ============================================
// EVENT HANDLERS
// ============================================

/**
 * Handle request/created - Log only, don't create return until approved
 */
async function handleRequestCreated(
    _prisma: PrismaClient,
    payload: ReturnPrimeWebhookPayload
): Promise<HandlerResult> {
    console.info(`[ReturnPrime] Request created: ${payload.request_number} (awaiting approval)`);
    return { action: 'logged', reason: 'awaiting_approval' };
}

/**
 * Handle request/approved - Create line-level returns in COH-ERP
 * This is the main handler that creates returns
 */
async function handleRequestApproved(
    prisma: PrismaClient,
    payload: ReturnPrimeWebhookPayload
): Promise<HandlerResult> {
    // 1. Validate order reference exists
    if (!payload.order?.shopify_order_id) {
        return { action: 'skipped', reason: 'missing_shopify_order_id' };
    }

    const shopifyOrderId = String(payload.order.shopify_order_id);

    // 2. Find order by Shopify Order ID
    const order = await prisma.order.findUnique({
        where: { shopifyOrderId },
        include: {
            orderLines: {
                include: { sku: { select: { skuCode: true } } },
            },
        },
    });

    if (!order) {
        console.warn(`[ReturnPrime] Order not found for Shopify ID: ${shopifyOrderId}`);
        return {
            action: 'skipped',
            reason: 'order_not_found',
            shopifyOrderId,
        };
    }

    // 3. Check if already processed (idempotency at business level)
    const existingReturn = await prisma.orderLine.findFirst({
        where: {
            orderId: order.id,
            returnPrimeRequestId: payload.id,
        },
    });

    if (existingReturn) {
        return { action: 'skipped', reason: 'already_processed', requestId: payload.id };
    }

    // 4. Match line items
    const { matched, unmatched, alreadyReturning } = matchReturnPrimeLinesToOrderLines(
        payload.line_items,
        order.orderLines.map(ol => ({
            id: ol.id,
            shopifyLineId: ol.shopifyLineId,
            skuId: ol.skuId,
            qty: ol.qty,
            returnStatus: ol.returnStatus,
            sku: { skuCode: ol.sku.skuCode },
        }))
    );

    if (matched.length === 0) {
        console.warn(`[ReturnPrime] No matching lines for order ${order.orderNumber}:`, getMatchSummary({ matched, unmatched, alreadyReturning }));
        return {
            action: 'failed',
            reason: 'no_matching_lines',
            unmatched: unmatched.length,
            alreadyReturning: alreadyReturning.length,
        };
    }

    // 5. Generate batch number
    const batchNumber = await generateBatchNumber(prisma, order.id, order.orderNumber);
    const now = new Date();

    // 5b. Look up CSV enrichment for customer comment (RP reason is always "Others")
    const csvEnrichment = payload.request_number
        ? await prisma.returnPrimeCsvEnrichment.findFirst({
              where: { requestNumber: payload.request_number },
              select: { customerComment: true },
          })
        : null;

    // Resolve reason: webhook may have generic "Others" — check line-level details + CSV enrichment
    const rpReason = payload.reason;
    const firstLineComment = payload.line_items[0]?.customer_comment;
    const customerComment = firstLineComment || csvEnrichment?.customerComment || null;
    const firstLineReasonDetail = payload.line_items[0]?.reason_detail;
    const isGenericReason = !rpReason || rpReason.toLowerCase().trim() === 'others' || rpReason.toLowerCase().trim() === 'na';
    const reasonDetail = payload.reason_details || firstLineReasonDetail || (isGenericReason ? customerComment : null);
    const reasonCategory = isGenericReason && customerComment
        ? mapReturnPrimeReason(customerComment)
        : mapReturnPrimeReason(rpReason);

    // 6. Create line-level returns in transaction
    await prisma.$transaction(async (tx) => {
        for (const { orderLine, rpLine } of matched) {
            await tx.orderLine.update({
                where: { id: orderLine.id },
                data: {
                    // Return lifecycle
                    returnBatchNumber: batchNumber,
                    returnStatus: payload.shipping?.awb_number ? 'approved' : 'requested',
                    returnQty: rpLine.quantity,
                    returnRequestedAt: now,

                    // Reason from RP (enriched with CSV customer comment + line-level details)
                    returnReasonCategory: reasonCategory,
                    returnReasonDetail: reasonDetail,
                    ...(rpLine.customer_comment ? { returnNotes: rpLine.customer_comment } : {}),

                    // Resolution based on request type
                    returnResolution: payload.request_type === 'exchange' ? 'exchange' : 'refund',

                    // Customer's requested refund mode from RP
                    ...(payload.refund?.requested_mode ? { returnRefundRequestedMode: payload.refund.requested_mode } : {}),

                    // Return fee from RP (per-line shipping fee)
                    ...(rpLine.return_fee ? { returnShippingFee: rpLine.return_fee } : {}),

                    // Exchange product info — store exchange SKU if matched
                    ...(rpLine.exchange_product?.sku ? await matchExchangeSku(tx, rpLine.exchange_product.sku) : {}),

                    // Exchange price diff from RP (exchange product price - original price)
                    ...(rpLine.exchange_product?.price && rpLine.price
                        ? { returnExchangePriceDiff: rpLine.exchange_product.price - rpLine.price }
                        : {}),

                    // RP-created exchange Shopify order ID (for linking when order syncs)
                    ...(payload.exchange?.shopify_order_id
                        ? { returnPrimeExchangeShopifyOrderId: payload.exchange.shopify_order_id }
                        : {}),

                    // AWB if provided by Return Prime
                    ...(payload.shipping?.awb_number && {
                        returnAwbNumber: payload.shipping.awb_number,
                        returnCourier: payload.shipping.courier || null,
                        returnPickupType: 'arranged_by_us',
                        returnPickupScheduledAt: now,
                    }),

                    // Return Prime tracking
                    returnPrimeRequestId: payload.id,
                    returnPrimeRequestNumber: payload.request_number || null,
                    returnPrimeStatus: 'approved',
                    returnPrimeCreatedAt: payload.created_at ? new Date(payload.created_at) : now,
                    returnPrimeUpdatedAt: now,
                },
            });

            // Update SKU return count
            await tx.sku.update({
                where: { id: orderLine.skuId },
                data: { returnCount: { increment: rpLine.quantity } },
            });
        }

        // Update customer return count + save bank details from RP
        if (order.customerId) {
            await tx.customer.update({
                where: { id: order.customerId },
                data: {
                    returnCount: { increment: 1 },
                    // Save bank details from RP if provided and not already stored
                    ...(payload.customer?.bank?.account_number ? {
                        bankAccountName: payload.customer.bank.account_holder_name || undefined,
                        bankAccountNumber: payload.customer.bank.account_number,
                        bankIfsc: payload.customer.bank.ifsc_code || undefined,
                    } : {}),
                },
            });
        }
    });

    // 7. Eager-link RP exchange order if it already exists in our DB
    if (payload.exchange?.shopify_order_id) {
        try {
            await linkRpExchangeOrder(prisma, payload.exchange.shopify_order_id, order.id, matched.map(m => m.orderLine.id));
        } catch (err) {
            console.warn(`[ReturnPrime] Failed to eager-link exchange order:`, err instanceof Error ? err.message : err);
        }
    }

    console.log(`[ReturnPrime] Created return batch ${batchNumber} with ${matched.length} lines for order ${order.orderNumber}`);

    return {
        action: 'created',
        batchNumber,
        lineCount: matched.length,
        orderNumber: order.orderNumber,
        unmatchedCount: unmatched.length,
    };
}

/**
 * Handle request/received - Update status if we didn't receive locally
 */
async function handleRequestReceived(
    prisma: PrismaClient,
    payload: ReturnPrimeWebhookPayload
): Promise<HandlerResult> {
    const lines = await prisma.orderLine.findMany({
        where: { returnPrimeRequestId: payload.id },
    });

    if (lines.length === 0) {
        return { action: 'skipped', reason: 'no_matching_lines' };
    }

    // Only update RP status, don't override local status if already received
    await prisma.orderLine.updateMany({
        where: {
            returnPrimeRequestId: payload.id,
        },
        data: {
            returnPrimeStatus: 'received',
            returnPrimeUpdatedAt: new Date(),
        },
    });

    return { action: 'synced', status: 'received' };
}

/**
 * Handle request/inspected
 */
async function handleRequestInspected(
    prisma: PrismaClient,
    payload: ReturnPrimeWebhookPayload
): Promise<HandlerResult> {
    await prisma.orderLine.updateMany({
        where: { returnPrimeRequestId: payload.id },
        data: {
            returnPrimeStatus: 'inspected',
            returnPrimeUpdatedAt: new Date(),
        },
    });
    return { action: 'synced', status: 'inspected' };
}

/**
 * Handle request/refunded - Mark refund complete if not done locally
 */
async function handleRequestRefunded(
    prisma: PrismaClient,
    payload: ReturnPrimeWebhookPayload
): Promise<HandlerResult> {
    const now = new Date();

    // Use the most specific refund amount available
    const refundAmount = payload.refund?.refunded_amount
        ?? payload.refund?.amount
        ?? null;

    // Map RP actual_mode to our refund method
    const refundMethod = payload.refund?.actual_mode || 'payment_link';

    // Update lines that haven't been refunded locally
    await prisma.orderLine.updateMany({
        where: {
            returnPrimeRequestId: payload.id,
            returnRefundCompletedAt: null, // Don't overwrite COH-ERP refunds
        },
        data: {
            returnRefundCompletedAt: now,
            returnRefundMethod: refundMethod,
            returnRefundReference: payload.refund?.transaction_id || null,
            refundedAt: now,
            refundAmount,
            ...(payload.refund?.eligible_amount ? { returnGrossAmount: payload.refund.eligible_amount } : {}),
            ...(refundAmount ? { returnNetAmount: refundAmount } : {}),
            returnPrimeStatus: 'refunded',
            returnPrimeUpdatedAt: now,
        },
    });

    // Update RP status even for already-refunded lines
    await prisma.orderLine.updateMany({
        where: {
            returnPrimeRequestId: payload.id,
            returnRefundCompletedAt: { not: null },
        },
        data: {
            returnPrimeStatus: 'refunded',
            returnPrimeUpdatedAt: now,
        },
    });

    // Complete returns that were inspected
    await prisma.orderLine.updateMany({
        where: {
            returnPrimeRequestId: payload.id,
            returnStatus: { in: ['inspected', 'approved'] },
        },
        data: { returnStatus: 'refunded' },
    });

    return { action: 'refunded', refundId: payload.refund?.id };
}

/**
 * Handle request/rejected
 */
async function handleRequestRejected(
    prisma: PrismaClient,
    payload: ReturnPrimeWebhookPayload
): Promise<HandlerResult> {
    await prisma.orderLine.updateMany({
        where: { returnPrimeRequestId: payload.id },
        data: {
            returnResolution: 'rejected',
            returnPrimeStatus: 'rejected',
            returnPrimeUpdatedAt: new Date(),
            returnClosedReason: payload.rejection_reason || 'Rejected in Return Prime',
        },
    });
    return { action: 'rejected' };
}

/**
 * Handle request/archived
 */
async function handleRequestArchived(
    prisma: PrismaClient,
    payload: ReturnPrimeWebhookPayload
): Promise<HandlerResult> {
    await prisma.orderLine.updateMany({
        where: { returnPrimeRequestId: payload.id },
        data: {
            returnPrimeStatus: 'archived',
            returnPrimeUpdatedAt: new Date(),
        },
    });
    return { action: 'archived' };
}

/**
 * Handle request/updated
 */
async function handleRequestUpdated(
    prisma: PrismaClient,
    payload: ReturnPrimeWebhookPayload
): Promise<HandlerResult> {
    await prisma.orderLine.updateMany({
        where: { returnPrimeRequestId: payload.id },
        data: { returnPrimeUpdatedAt: new Date() },
    });
    return { action: 'updated' };
}

// ============================================
// HELPERS
// ============================================

/**
 * Try to match an exchange product SKU from RP to a COH SKU ID.
 * Returns { returnExchangeSkuId } if found, empty object otherwise.
 */
async function matchExchangeSku(
    tx: { sku: PrismaClient['sku'] },
    skuCode: string
): Promise<{ returnExchangeSkuId: string } | Record<string, never>> {
    try {
        const sku = await tx.sku.findFirst({
            where: { skuCode },
            select: { id: true },
        });
        if (sku) {
            return { returnExchangeSkuId: sku.id };
        }
    } catch {
        // Non-fatal — exchange SKU matching is best-effort
    }
    return {};
}

/**
 * Generate a batch number for grouped returns
 * Format: {orderNumber}/{sequence}
 */
async function generateBatchNumber(
    prisma: PrismaClient,
    orderId: string,
    orderNumber: string
): Promise<string> {
    // Count existing batches for this order
    const existingBatches = await prisma.orderLine.findMany({
        where: {
            orderId,
            returnBatchNumber: { not: null },
        },
        select: { returnBatchNumber: true },
        distinct: ['returnBatchNumber'],
    });

    const sequence = existingBatches.length + 1;
    return `${orderNumber}/${sequence}`;
}

/**
 * Link an RP-created exchange Shopify order to the return lines.
 * Finds the order by shopifyOrderId and marks it as exchange + links to original.
 */
async function linkRpExchangeOrder(
    prisma: PrismaClient,
    shopifyOrderId: string,
    originalOrderId: string,
    returnLineIds: string[],
): Promise<boolean> {
    const exchangeOrder = await prisma.order.findUnique({
        where: { shopifyOrderId },
        select: { id: true, isExchange: true },
    });

    if (!exchangeOrder) return false; // Not synced yet — will be linked lazily

    // Mark the Shopify order as an exchange order
    if (!exchangeOrder.isExchange) {
        await prisma.order.update({
            where: { id: exchangeOrder.id },
            data: {
                isExchange: true,
                originalOrderId,
                channel: 'exchange',
            },
        });
    }

    // Link return lines to the exchange order
    await prisma.orderLine.updateMany({
        where: { id: { in: returnLineIds } },
        data: { returnExchangeOrderId: exchangeOrder.id },
    });

    console.log(`[ReturnPrime] Linked exchange order ${exchangeOrder.id} (Shopify ${shopifyOrderId}) to ${returnLineIds.length} return lines`);
    return true;
}

export default router;
