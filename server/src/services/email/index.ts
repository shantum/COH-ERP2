/**
 * Email Service — unified email sending with logging, provider routing, and templates.
 *
 * Provider routing:
 *   - @creaturesofhabit.in → AWS SES (customer-facing)
 *   - @coh.one → Resend (internal/ERP)
 *
 * Every email is logged to the EmailLog table with delivery status.
 */

import { Resend } from 'resend';
import { env } from '../../config/env.js';
import logger from '../../utils/logger.js';
import { sendViaSes } from './sesClient.js';

const log = logger.child({ module: 'emailService' });

// ============================================
// CONSTANTS
// ============================================

const CUSTOMER_FROM = 'Creatures of Habit <noreply@creaturesofhabit.in>';
const INTERNAL_FROM = 'COH ERP <reports@coh.one>';

// ============================================
// TYPES
// ============================================

type Provider = 'ses' | 'resend';

interface SendOptions {
  to: string | string[];
  subject: string;
  html: string;
  text?: string;
  from?: string;

  /** Template key for logging/filtering */
  templateKey?: string;

  /** Link to a domain entity */
  entityType?: string;
  entityId?: string;

  /** User who triggered the send */
  createdById?: string;

  /** Extra metadata */
  metadata?: Record<string, unknown>;
}

interface SendResult {
  success: boolean;
  messageId?: string;
  emailLogId?: string;
  error?: string;
}

// ============================================
// PROVIDER ROUTING
// ============================================

function resolveProvider(fromEmail: string): Provider {
  if (fromEmail.includes('@creaturesofhabit.in')) return 'ses';
  return 'resend';
}

// ============================================
// RESEND CLIENT
// ============================================

let resendClient: Resend | null = null;
function getResend(): Resend {
  if (!resendClient) {
    resendClient = new Resend(env.RESEND_API_KEY);
  }
  return resendClient;
}

async function sendViaResend(options: { to: string[]; from: string; subject: string; html: string; text?: string }): Promise<{ messageId: string }> {
  const { data, error } = await getResend().emails.send({
    from: options.from,
    to: options.to,
    subject: options.subject,
    html: options.html,
    text: options.text ?? '',
  });

  if (error) throw new Error(error.message);
  return { messageId: data?.id ?? '' };
}

// ============================================
// DB HELPERS
// ============================================

async function getDb() {
  const { getPrisma } = await import('@coh/shared/services/db');
  return getPrisma();
}

// ============================================
// DB LOGGING
// ============================================

async function logEmail(params: {
  toEmail: string;
  fromEmail: string;
  subject: string;
  htmlContent: string;
  textContent?: string;
  provider: Provider;
  templateKey?: string;
  entityType?: string;
  entityId?: string;
  createdById?: string;
  metadata?: Record<string, unknown>;
  status: string;
  messageId?: string;
  error?: string;
  sentAt?: Date;
}): Promise<string | undefined> {
  try {
    const prisma = await getDb();
    const record = await prisma.emailLog.create({
      data: {
        toEmail: params.toEmail,
        fromEmail: params.fromEmail,
        subject: params.subject,
        htmlContent: params.htmlContent,
        textContent: params.textContent,
        provider: params.provider,
        templateKey: params.templateKey,
        entityType: params.entityType,
        entityId: params.entityId,
        createdById: params.createdById,
        metadata: params.metadata ? JSON.parse(JSON.stringify(params.metadata)) : undefined,
        status: params.status,
        messageId: params.messageId,
        error: params.error,
        sentAt: params.sentAt,
      },
    });
    return record.id;
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    log.error({ error: msg }, 'Failed to log email to DB');
    return undefined;
  }
}

async function updateEmailLog(id: string, data: { status?: string; messageId?: string; sentAt?: Date; error?: string }) {
  try {
    const prisma = await getDb();
    await prisma.emailLog.update({ where: { id }, data });
  } catch { /* non-critical — don't break email flow for logging failures */ }
}

// ============================================
// MAIN SEND FUNCTION
// ============================================

/**
 * Send an email with automatic provider routing and DB logging.
 *
 * Uses SES for @creaturesofhabit.in, Resend for @coh.one.
 * Logs every send attempt to the EmailLog table.
 */
export async function sendEmail(options: SendOptions): Promise<SendResult> {
  const from = options.from ?? CUSTOMER_FROM;
  const toArray = Array.isArray(options.to) ? options.to : [options.to];
  const provider = resolveProvider(from);

  // Log as pending first
  const emailLogId = await logEmail({
    toEmail: toArray.join(', '),
    fromEmail: from,
    subject: options.subject,
    htmlContent: options.html,
    textContent: options.text,
    provider,
    templateKey: options.templateKey,
    entityType: options.entityType,
    entityId: options.entityId,
    createdById: options.createdById,
    metadata: options.metadata as Record<string, unknown>,
    status: 'pending',
  });

  try {
    let messageId: string;

    if (provider === 'ses') {
      const result = await sendViaSes({ to: toArray, from, subject: options.subject, html: options.html, text: options.text });
      messageId = result.messageId;
    } else {
      const result = await sendViaResend({ to: toArray, from, subject: options.subject, html: options.html, text: options.text });
      messageId = result.messageId;
    }

    // Update log to sent
    if (emailLogId) {
      await updateEmailLog(emailLogId, { status: 'sent', messageId, sentAt: new Date() });
    }

    log.info({ messageId, provider, to: toArray, subject: options.subject, templateKey: options.templateKey }, 'Email sent');
    return { success: true, messageId, emailLogId };

  } catch (err: unknown) {
    const errorMsg = err instanceof Error ? err.message : String(err);

    // Update log to failed
    if (emailLogId) {
      await updateEmailLog(emailLogId, { status: 'failed', error: errorMsg });
    }

    log.error({ error: errorMsg, provider, to: toArray, subject: options.subject }, 'Email send failed');
    return { success: false, error: errorMsg, emailLogId };
  }
}

// ============================================
// CONVENIENCE: CUSTOMER EMAIL
// ============================================

/** Send a customer-facing email from @creaturesofhabit.in */
export async function sendCustomerEmail(options: Omit<SendOptions, 'from'>): Promise<SendResult> {
  return sendEmail({ ...options, from: CUSTOMER_FROM });
}

/** Send an internal ERP email from @coh.one */
export async function sendInternalEmail(options: Omit<SendOptions, 'from'>): Promise<SendResult> {
  return sendEmail({ ...options, from: INTERNAL_FROM });
}

// Re-export templates
export * from './templates/index.js';
