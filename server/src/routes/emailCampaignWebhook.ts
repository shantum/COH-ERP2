/**
 * SES Campaign Delivery Webhook (via SNS)
 *
 * Handles AWS SES delivery notifications forwarded through SNS:
 * - Delivery → mark recipient as delivered
 * - Bounce → mark recipient as bounced, opt out customer
 * - Complaint → mark recipient as complained, opt out customer
 *
 * Also handles SES event destinations for open/click tracking
 * (if configured via SES Configuration Set).
 *
 * Flow:
 * 1. Validate SNS message (verify certificate signature)
 * 2. Handle SubscriptionConfirmation (auto-confirm)
 * 3. Parse SES notification from SNS Message
 * 4. Match to EmailCampaignRecipient via EmailLog.messageId
 * 5. Update recipient status + campaign aggregate counters
 * 6. Always return 200
 */

import { Router } from 'express';
import type { Request, Response } from 'express';
import https from 'node:https';
import crypto from 'node:crypto';
import { z } from 'zod';
import { asyncHandler } from '../middleware/asyncHandler.js';
import logger from '../utils/logger.js';
import prisma from '../lib/prisma.js';

const log = logger.child({ module: 'sesCampaignWebhook' });
const router = Router();

// ============================================
// SNS MESSAGE SCHEMAS
// ============================================

const SnsMessageSchema = z.object({
  Type: z.string(),
  MessageId: z.string().optional(),
  TopicArn: z.string().optional(),
  Message: z.string().optional(),
  SubscribeURL: z.string().optional(),
  SigningCertURL: z.string().optional(),
  Signature: z.string().optional(),
  SignatureVersion: z.string().optional(),
  Timestamp: z.string().optional(),
});

// SES Notification types within the SNS Message
const SesMailSchema = z.object({
  messageId: z.string(),
  destination: z.array(z.string()).optional(),
  source: z.string().optional(),
});

const SesBounceSchema = z.object({
  notificationType: z.literal('Bounce'),
  bounce: z.object({
    bounceType: z.string(),          // Permanent, Transient, Undetermined
    bounceSubType: z.string(),       // General, NoEmail, Suppressed, etc.
    bouncedRecipients: z.array(z.object({
      emailAddress: z.string(),
    })),
  }),
  mail: SesMailSchema,
});

const SesComplaintSchema = z.object({
  notificationType: z.literal('Complaint'),
  complaint: z.object({
    complainedRecipients: z.array(z.object({
      emailAddress: z.string(),
    })),
    complaintFeedbackType: z.string().optional(),
  }),
  mail: SesMailSchema,
});

const SesDeliverySchema = z.object({
  notificationType: z.literal('Delivery'),
  delivery: z.object({
    recipients: z.array(z.string()),
    timestamp: z.string(),
  }),
  mail: SesMailSchema,
});

// SES Event Destination events (open/click via Configuration Set)
const SesOpenSchema = z.object({
  eventType: z.literal('Open'),
  mail: SesMailSchema,
});

const SesClickSchema = z.object({
  eventType: z.literal('Click'),
  click: z.object({ link: z.string() }),
  mail: SesMailSchema,
});

// ============================================
// STATUS PROGRESSION
// ============================================

const STATUS_RANK: Record<string, number> = {
  pending: 0,
  sent: 1,
  delivered: 2,
  opened: 3,
  clicked: 4,
  bounced: 10,
  complained: 10,
  unsubscribed: 10,
};

// ============================================
// SNS SIGNATURE VERIFICATION
// ============================================

const CERT_CACHE = new Map<string, string>();

async function fetchCertificate(url: string): Promise<string> {
  const cached = CERT_CACHE.get(url);
  if (cached) return cached;

  // Only allow Amazon SNS certificate URLs
  const parsed = new URL(url);
  if (!parsed.hostname.endsWith('.amazonaws.com')) {
    throw new Error(`Untrusted certificate URL: ${url}`);
  }

  return new Promise((resolve, reject) => {
    https.get(url, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        CERT_CACHE.set(url, data);
        resolve(data);
      });
      res.on('error', reject);
    }).on('error', reject);
  });
}

function buildSignatureString(message: z.infer<typeof SnsMessageSchema>): string {
  if (message.Type === 'Notification') {
    return [
      'Message', message.Message ?? '',
      'MessageId', message.MessageId ?? '',
      'Timestamp', message.Timestamp ?? '',
      'TopicArn', message.TopicArn ?? '',
      'Type', message.Type,
    ].join('\n') + '\n';
  }
  // SubscriptionConfirmation / UnsubscribeConfirmation
  return [
    'Message', message.Message ?? '',
    'MessageId', message.MessageId ?? '',
    'SubscribeURL', message.SubscribeURL ?? '',
    'Timestamp', message.Timestamp ?? '',
    'TopicArn', message.TopicArn ?? '',
    'Type', message.Type,
  ].join('\n') + '\n';
}

async function verifySnsSignature(message: z.infer<typeof SnsMessageSchema>): Promise<boolean> {
  try {
    if (!message.SigningCertURL || !message.Signature) return false;
    const cert = await fetchCertificate(message.SigningCertURL);
    const stringToSign = buildSignatureString(message);
    const verifier = crypto.createVerify('SHA1withRSA');
    verifier.update(stringToSign);
    return verifier.verify(cert, message.Signature, 'base64');
  } catch (err: unknown) {
    log.warn({ error: err instanceof Error ? err.message : err }, 'SNS signature verification failed');
    return false;
  }
}

// ============================================
// HELPER: Find campaign recipient by SES message ID
// ============================================

async function findRecipientBySesMessageId(sesMessageId: string) {
  // EmailLog.messageId stores the SES message ID
  // EmailCampaignRecipient.emailLogId stores the EmailLog.id
  const emailLog = await prisma.emailLog.findUnique({
    where: { messageId: sesMessageId },
    select: { id: true },
  });

  if (!emailLog) return null;

  return prisma.emailCampaignRecipient.findFirst({
    where: { emailLogId: emailLog.id },
    select: { id: true, campaignId: true, status: true, customerId: true },
  });
}

// ============================================
// HELPER: Update recipient + campaign counters
// ============================================

async function updateRecipientStatus(
  recipient: { id: string; campaignId: string; status: string; customerId: string },
  newStatus: string,
  counterField: string,
) {
  // Check status progression
  const currentRank = STATUS_RANK[recipient.status] ?? 0;
  const newRank = STATUS_RANK[newStatus] ?? 0;
  if (newRank <= currentRank && newRank < 10) return; // Don't downgrade

  const now = new Date();
  const statusUpdate: Record<string, unknown> = { status: newStatus };

  if (newStatus === 'delivered') statusUpdate.deliveredAt = now;
  if (newStatus === 'opened') {
    statusUpdate.openedAt = now;
    if (currentRank < STATUS_RANK['delivered']) statusUpdate.deliveredAt = now;
  }
  if (newStatus === 'clicked') {
    statusUpdate.clickedAt = now;
    if (currentRank < STATUS_RANK['opened']) statusUpdate.openedAt = now;
    if (currentRank < STATUS_RANK['delivered']) statusUpdate.deliveredAt = now;
  }

  await prisma.emailCampaignRecipient.update({
    where: { id: recipient.id },
    data: statusUpdate,
  });

  // Increment campaign counter
  await prisma.emailCampaign.update({
    where: { id: recipient.campaignId },
    data: { [counterField]: { increment: 1 } },
  });

  // Opt out on bounce/complaint
  if (newStatus === 'bounced' || newStatus === 'complained') {
    await prisma.customer.update({
      where: { id: recipient.customerId },
      data: { emailOptOut: true },
    }).catch(() => {});
  }

  log.info({ recipientId: recipient.id, campaignId: recipient.campaignId, newStatus }, 'Campaign recipient status updated');
}

// ============================================
// HELPER: Auto-confirm SNS subscription
// ============================================

async function confirmSubscription(subscribeUrl: string): Promise<void> {
  return new Promise((resolve, reject) => {
    https.get(subscribeUrl, (res) => {
      res.on('data', () => {});
      res.on('end', () => {
        log.info({ subscribeUrl }, 'SNS subscription confirmed');
        resolve();
      });
      res.on('error', reject);
    }).on('error', reject);
  });
}

// ============================================
// POST / — SNS notifications from SES
// ============================================

router.post('/', asyncHandler(async (req: Request, res: Response) => {
  res.status(200).json({ received: true });

  // 1. Parse SNS envelope
  const parseResult = SnsMessageSchema.safeParse(req.body);
  if (!parseResult.success) {
    log.warn({ errors: parseResult.error.issues }, 'Invalid SNS message');
    return;
  }

  const snsMessage = parseResult.data;

  // 2. Verify SNS signature
  const valid = await verifySnsSignature(snsMessage);
  if (!valid) {
    log.warn('SNS signature verification failed — ignoring');
    return;
  }

  // 3. Handle subscription confirmation
  if (snsMessage.Type === 'SubscriptionConfirmation' && snsMessage.SubscribeURL) {
    await confirmSubscription(snsMessage.SubscribeURL);
    return;
  }

  // 4. Only process Notification type
  if (snsMessage.Type !== 'Notification' || !snsMessage.Message) return;

  let sesEvent: unknown;
  try {
    sesEvent = JSON.parse(snsMessage.Message);
  } catch {
    log.warn('Failed to parse SES event JSON from SNS Message');
    return;
  }

  // 5. Try each SES event type

  // --- Delivery ---
  const deliveryResult = SesDeliverySchema.safeParse(sesEvent);
  if (deliveryResult.success) {
    const { mail } = deliveryResult.data;
    log.info({ messageId: mail.messageId }, 'SES delivery notification');
    const recipient = await findRecipientBySesMessageId(mail.messageId);
    if (recipient) await updateRecipientStatus(recipient, 'delivered', 'deliveredCount');
    return;
  }

  // --- Bounce ---
  const bounceResult = SesBounceSchema.safeParse(sesEvent);
  if (bounceResult.success) {
    const { mail, bounce } = bounceResult.data;
    log.info({ messageId: mail.messageId, bounceType: bounce.bounceType }, 'SES bounce notification');
    const recipient = await findRecipientBySesMessageId(mail.messageId);
    if (recipient) await updateRecipientStatus(recipient, 'bounced', 'bounceCount');

    // Also update EmailLog status
    await prisma.emailLog.updateMany({
      where: { messageId: mail.messageId },
      data: { status: 'bounced' },
    });
    return;
  }

  // --- Complaint ---
  const complaintResult = SesComplaintSchema.safeParse(sesEvent);
  if (complaintResult.success) {
    const { mail } = complaintResult.data;
    log.info({ messageId: mail.messageId }, 'SES complaint notification');
    const recipient = await findRecipientBySesMessageId(mail.messageId);
    if (recipient) await updateRecipientStatus(recipient, 'complained', 'unsubscribeCount');

    await prisma.emailLog.updateMany({
      where: { messageId: mail.messageId },
      data: { status: 'complained' },
    });
    return;
  }

  // --- Open (via SES Configuration Set event destination) ---
  const openResult = SesOpenSchema.safeParse(sesEvent);
  if (openResult.success) {
    const { mail } = openResult.data;
    log.info({ messageId: mail.messageId }, 'SES open event');
    const recipient = await findRecipientBySesMessageId(mail.messageId);
    if (recipient) await updateRecipientStatus(recipient, 'opened', 'openCount');
    return;
  }

  // --- Click (via SES Configuration Set event destination) ---
  const clickResult = SesClickSchema.safeParse(sesEvent);
  if (clickResult.success) {
    const { mail } = clickResult.data;
    log.info({ messageId: mail.messageId }, 'SES click event');
    const recipient = await findRecipientBySesMessageId(mail.messageId);
    if (recipient) await updateRecipientStatus(recipient, 'clicked', 'clickCount');
    return;
  }

  log.debug({ sesEvent }, 'Unhandled SES event type — ignoring');
}));

export default router;
