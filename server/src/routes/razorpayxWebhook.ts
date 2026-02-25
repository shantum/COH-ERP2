/**
 * RazorpayX Webhook Route
 *
 * Receives webhook events from RazorpayX for payout status updates
 * and account transactions. Always returns 200 to prevent retries.
 *
 * Mount under /api/webhooks/razorpayx to get raw body capture
 * from the middleware in index.js.
 *
 * Webhook signature: HMAC-SHA256 of request body using webhook secret,
 * compared against X-Razorpay-Signature header.
 */

import crypto from 'crypto';
import { Router } from 'express';
import type { Request, Response, NextFunction } from 'express';
import type { PrismaClient } from '@prisma/client';
import {
  checkWebhookDuplicate as _checkWebhookDuplicate,
  updateWebhookLog as _updateWebhookLog,
} from '../utils/webhookUtils.js';
import { handleWebhookEvent, type WebhookEvent } from '../services/razorpayx/webhookHandler.js';
import logger from '../utils/logger.js';

const log = logger.child({ module: 'razorpayx-webhook-route' });
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
  webhookId: string | undefined,
) => Promise<DedupeResult>;

const updateWebhookLog = _updateWebhookLog as (
  prisma: PrismaClient,
  webhookId: string | undefined,
  status: string,
  error?: string | null,
  processingTime?: number | null,
  resultData?: unknown,
) => Promise<void>;

// ============================================
// TYPES
// ============================================

interface WebhookRequest extends Omit<Request, 'rawBody'> {
  rawBody?: string | Buffer;
  prisma: PrismaClient;
}

// ============================================
// SIGNATURE VERIFICATION MIDDLEWARE
// ============================================

function getWebhookSecret(): string | null {
  return process.env.RAZORPAYX_WEBHOOK_SECRET || null;
}

async function verifySignature(
  req: WebhookRequest,
  res: Response,
  next: NextFunction,
): Promise<void> {
  const secret = getWebhookSecret();

  // Dev mode: accept without verification if no secret configured
  if (!secret) {
    log.warn('RazorpayX webhook secret not configured — accepting without verification');
    return next();
  }

  const signature = req.get('X-Razorpay-Signature');

  if (!signature) {
    log.warn('Missing X-Razorpay-Signature header');
    res.status(401).json({ error: 'Missing signature' });
    return;
  }

  // Use raw body for HMAC — set by express.json verify middleware in index.js
  const rawBody = req.rawBody;
  const bodyStr = Buffer.isBuffer(rawBody) ? rawBody.toString('utf8') : (rawBody || '');

  const expected = crypto
    .createHmac('sha256', secret)
    .update(bodyStr)
    .digest('hex');

  // Constant-time comparison to prevent timing attacks
  const signatureBuffer = Buffer.from(signature);
  const expectedBuffer = Buffer.from(expected);

  if (signatureBuffer.length !== expectedBuffer.length ||
      !crypto.timingSafeEqual(signatureBuffer, expectedBuffer)) {
    log.warn('Invalid RazorpayX webhook signature');
    res.status(401).json({ error: 'Invalid signature' });
    return;
  }

  next();
}

// ============================================
// MAIN WEBHOOK HANDLER
// ============================================

router.post('/', verifySignature, async (req: WebhookRequest, res: Response): Promise<void> => {
  const startTime = Date.now();

  // Always return 200 immediately to prevent RazorpayX retries
  // Process the event async after responding
  const event = req.body as WebhookEvent;
  const eventType = event?.event || 'unknown';

  // Generate a stable webhook ID from the event for dedup
  const payoutId = event?.payload?.payout?.entity?.id;
  const txnId = event?.payload?.transaction?.entity?.id;
  const webhookId = `rpx-${eventType}-${payoutId || txnId || Date.now()}`;

  log.info({ event: eventType, webhookId }, 'RazorpayX webhook received');

  try {
    // Dedup check
    const dedup = await checkWebhookDuplicate(req.prisma, webhookId);
    if (dedup.duplicate && dedup.status === 'processed') {
      log.info({ webhookId }, 'Duplicate webhook, already processed');
      res.status(200).json({ status: 'ok', duplicate: true });
      return;
    }

    // Log the webhook
    await req.prisma.webhookLog.upsert({
      where: { webhookId },
      create: {
        webhookId,
        topic: eventType,
        resourceId: payoutId || txnId || undefined,
        source: 'razorpayx',
        status: 'received',
        payload: JSON.stringify(event).slice(0, 10000),
      },
      update: {
        status: 'received',
        receivedAt: new Date(),
      },
    });

    // Process the event
    const result = await handleWebhookEvent(req.prisma, event);

    const processingTime = Date.now() - startTime;
    await updateWebhookLog(req.prisma, webhookId, 'processed', null, processingTime, result);

    log.info({ webhookId, result, processingTime }, 'RazorpayX webhook processed');
    res.status(200).json({ status: 'ok', ...result });
  } catch (err) {
    const processingTime = Date.now() - startTime;
    const errorMessage = err instanceof Error ? err.message : String(err);

    log.error({ err, webhookId, eventType }, 'RazorpayX webhook processing failed');
    await updateWebhookLog(req.prisma, webhookId, 'failed', errorMessage, processingTime).catch(() => {});

    // Still return 200 to prevent retries — we'll handle the error via alerts
    res.status(200).json({ status: 'error', error: errorMessage });
  }
});

export default router;
