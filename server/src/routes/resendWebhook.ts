/**
 * Resend Inbound Email Webhook
 *
 * Receives forwarded invoice emails via Resend's email.received webhook,
 * processes PDF/image attachments through the AI invoice parser,
 * and creates draft invoices for review.
 *
 * Flow:
 * 1. Verify webhook signature (svix)
 * 2. Fetch full email + attachments from Resend API
 * 3. For each supported attachment: parse, match supplier, create draft invoice
 * 4. Always return 200 to prevent Resend retries
 */

import { Router } from 'express';
import type { Request, Response } from 'express';
import { Resend } from 'resend';
import { Webhook } from 'svix';
import { z } from 'zod';
import { env } from '../config/env.js';
import { asyncHandler } from '../middleware/asyncHandler.js';
import logger from '../utils/logger.js';
import { parseInvoice, parseIndianDate, type ParsedInvoice } from '../services/invoiceParser.js';
import { computeFileHash, checkExactDuplicate } from '../services/invoiceDuplicateCheck.js';
import { matchInvoiceLines } from '../services/invoiceMatcher.js';
import { findPartyByNarration } from '../services/transactionTypeResolver.js';
import { deferredExecutor } from '../services/deferredExecutor.js';
import { uploadInvoiceFile } from '../services/driveFinanceSync.js';
import { sendEmail } from '../services/emailService.js';
import { saveFile, buildInvoicePath } from '../services/fileStorageService.js';

const log = logger.child({ module: 'resendWebhook' });
const router = Router();

// ============================================
// RESEND CLIENT
// ============================================

const resend = new Resend(env.RESEND_API_KEY);

// ============================================
// SUPPORTED ATTACHMENT TYPES
// ============================================

const SUPPORTED_MIME_TYPES = new Set([
  'application/pdf',
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/gif',
]);

// ============================================
// WEBHOOK PAYLOAD SCHEMA
// ============================================

const WebhookPayloadSchema = z.object({
  type: z.string(),
  created_at: z.string(),
  data: z.object({
    email_id: z.string(),
    created_at: z.string(),
    from: z.string(),
    to: z.array(z.string()),
    subject: z.string().optional(),
    attachments: z.array(z.object({
      id: z.string(),
      filename: z.string().nullable().optional(),
      content_type: z.string(),
    })).optional(),
  }),
});

// ============================================
// PARTY ENRICHMENT (duplicated from financeUpload.ts — inline in route)
// ============================================

/** Derive PAN from 15-char GSTIN (chars at index 2..11) */
function panFromGstin(gstin: string): string | null {
  if (gstin.length === 15) return gstin.slice(2, 12);
  return null;
}

/**
 * Auto-fill missing Party fields from AI-parsed invoice data.
 * Bank details: only fill if party has none; flag mismatch if different.
 */
async function enrichPartyFromInvoice(
  prisma: Request['prisma'],
  partyId: string,
  parsed: ParsedInvoice,
): Promise<{ fieldsAdded: string[] }> {
  const party = await prisma.party.findUnique({
    where: { id: partyId },
    select: {
      gstin: true, pan: true, email: true, phone: true,
      address: true, stateCode: true,
      bankAccountNumber: true, bankIfsc: true, bankName: true, bankAccountName: true,
    },
  });
  if (!party) return { fieldsAdded: [] };

  const FIELD_LABELS: Record<string, string> = {
    gstin: 'GSTIN', pan: 'PAN', email: 'Email', phone: 'Phone',
    address: 'Address', stateCode: 'State Code',
    bankAccountNumber: 'Bank Account', bankIfsc: 'Bank IFSC',
    bankName: 'Bank Name', bankAccountName: 'Beneficiary Name',
  };

  const nonBankFields: Array<{ field: keyof typeof party; value: string | null | undefined }> = [
    { field: 'gstin', value: parsed.supplierGstin },
    { field: 'pan', value: parsed.supplierPan ?? (parsed.supplierGstin ? panFromGstin(parsed.supplierGstin) : null) },
    { field: 'email', value: parsed.supplierEmail },
    { field: 'phone', value: parsed.supplierPhone },
    { field: 'address', value: parsed.supplierAddress },
    { field: 'stateCode', value: parsed.supplierStateCode },
  ];

  const bankFields: Array<{ field: keyof typeof party; value: string | null | undefined }> = [
    { field: 'bankAccountNumber', value: parsed.supplierBankAccountNumber },
    { field: 'bankIfsc', value: parsed.supplierBankIfsc },
    { field: 'bankName', value: parsed.supplierBankName },
    { field: 'bankAccountName', value: parsed.supplierBankAccountName },
  ];

  const updates: Record<string, string> = {};
  const fieldsAdded: string[] = [];

  for (const { field, value } of nonBankFields) {
    if (value && !party[field]) {
      updates[field] = value;
      fieldsAdded.push(FIELD_LABELS[field] ?? field);
    }
  }

  const partyHasBank = !!party.bankAccountNumber;
  const invoiceHasBank = !!parsed.supplierBankAccountNumber;

  if (invoiceHasBank && !partyHasBank) {
    for (const { field, value } of bankFields) {
      if (value) {
        updates[field] = value;
        fieldsAdded.push(FIELD_LABELS[field] ?? field);
      }
    }
  }

  if (Object.keys(updates).length > 0) {
    await prisma.party.update({ where: { id: partyId }, data: updates });
    log.info({ partyId, fieldsAdded }, 'Party enriched from emailed invoice');
  }

  return { fieldsAdded };
}

/**
 * Create a new Party from AI-parsed invoice data when no match is found.
 */
async function createPartyFromInvoice(
  prisma: Request['prisma'],
  parsed: ParsedInvoice,
): Promise<{ partyId: string; partyName: string } | null> {
  const name = parsed.supplierName?.trim();
  if (!name) return null;

  const optionalFields: Array<{ key: string; value: string | null | undefined }> = [
    { key: 'gstin', value: parsed.supplierGstin },
    { key: 'pan', value: parsed.supplierPan ?? (parsed.supplierGstin ? panFromGstin(parsed.supplierGstin) : null) },
    { key: 'email', value: parsed.supplierEmail },
    { key: 'phone', value: parsed.supplierPhone },
    { key: 'address', value: parsed.supplierAddress },
    { key: 'stateCode', value: parsed.supplierStateCode },
    { key: 'bankAccountNumber', value: parsed.supplierBankAccountNumber },
    { key: 'bankIfsc', value: parsed.supplierBankIfsc },
    { key: 'bankName', value: parsed.supplierBankName },
    { key: 'bankAccountName', value: parsed.supplierBankAccountName },
  ];

  const extras: Record<string, string> = {};
  for (const { key, value } of optionalFields) {
    if (value) extras[key] = value;
  }

  try {
    const newParty = await prisma.party.create({
      data: {
        name,
        category: 'other',
        isActive: true,
        aliases: [name.toUpperCase()],
        ...extras,
      },
      select: { id: true, name: true },
    });
    log.info({ partyId: newParty.id, name: newParty.name }, 'New Party created from emailed invoice');
    return { partyId: newParty.id, partyName: newParty.name };
  } catch (err: unknown) {
    log.warn({ name, error: err instanceof Error ? err.message : err }, 'Failed to create party from emailed invoice');
    return null;
  }
}

// ============================================
// WEBHOOK SIGNATURE VERIFICATION
// ============================================

function verifyWebhookSignature(req: Request): boolean {
  const secret = env.RESEND_WEBHOOK_SECRET;
  if (!secret) {
    log.warn('RESEND_WEBHOOK_SECRET not set — skipping signature verification');
    return true;
  }

  const svixId = req.headers['svix-id'] as string | undefined;
  const svixTimestamp = req.headers['svix-timestamp'] as string | undefined;
  const svixSignature = req.headers['svix-signature'] as string | undefined;

  if (!svixId || !svixTimestamp || !svixSignature) {
    log.warn('Missing svix signature headers');
    return false;
  }

  try {
    const wh = new Webhook(secret);
    const rawBody = req.rawBody;
    if (!rawBody) {
      log.error('rawBody not captured — cannot verify webhook signature');
      return false;
    }
    wh.verify(rawBody, {
      'svix-id': svixId,
      'svix-timestamp': svixTimestamp,
      'svix-signature': svixSignature,
    });
    return true;
  } catch (err: unknown) {
    log.warn({ error: err instanceof Error ? err.message : err }, 'Webhook signature verification failed');
    return false;
  }
}

// ============================================
// PROCESS SINGLE ATTACHMENT
// ============================================

interface AttachmentResult {
  attachmentId: string;
  filename: string | null;
  invoiceId: string | null;
  invoiceNumber: string | null;
  supplierName: string | null;
  totalAmount: number | null;
  aiConfidence: number;
  error: string | null;
  duplicate: boolean;
}

async function processAttachment(
  prisma: Request['prisma'],
  attachment: { id: string; filename?: string | null; content_type: string; download_url: string },
  emailId: string,
  emailFrom: string,
  emailSubject: string,
  adminUserId: string,
): Promise<AttachmentResult> {
  const { id: attachmentId, filename, content_type: contentType, download_url: downloadUrl } = attachment;

  const result: AttachmentResult = {
    attachmentId,
    filename: filename ?? null,
    invoiceId: null,
    invoiceNumber: null,
    supplierName: null,
    totalAmount: null,
    aiConfidence: 0,
    error: null,
    duplicate: false,
  };

  try {
    // 1. Download file content
    log.info({ attachmentId, filename, contentType }, 'Downloading attachment');
    const response = await fetch(downloadUrl);
    if (!response.ok) {
      result.error = `Download failed: ${response.status} ${response.statusText}`;
      return result;
    }
    const arrayBuffer = await response.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);

    // 2. Duplicate check (file hash)
    const fileHash = computeFileHash(buffer);
    const hashDuplicate = await checkExactDuplicate(prisma as any, fileHash);
    if (hashDuplicate) {
      log.info({ attachmentId, filename, existingInvoiceId: hashDuplicate.existingInvoiceId }, 'Duplicate file — skipping');
      result.duplicate = true;
      result.invoiceId = hashDuplicate.existingInvoiceId;
      return result;
    }

    // 3. Parse with AI
    let parsed: ParsedInvoice | null = null;
    let rawResponse = '';
    let aiModel = '';
    let aiConfidence = 0;

    try {
      const parseResult = await parseInvoice(buffer, contentType);
      parsed = parseResult.parsed;
      rawResponse = parseResult.rawResponse;
      aiModel = parseResult.model;
      aiConfidence = parsed.confidence;
    } catch (err: unknown) {
      log.error({ attachmentId, error: err instanceof Error ? err.message : err }, 'AI parsing failed for emailed attachment');
    }

    // 4. Match supplier to Party (alias + GSTIN)
    let partyId: string | undefined;
    let matchedPartyName: string | undefined;
    let matchedCategory = 'other';

    if (parsed?.supplierName || parsed?.supplierGstin) {
      const allParties = await prisma.party.findMany({
        where: { isActive: true },
        select: {
          id: true, name: true, aliases: true, category: true, gstin: true,
          tdsApplicable: true, tdsSection: true, tdsRate: true, invoiceRequired: true,
          transactionType: {
            select: {
              id: true, name: true, debitAccountCode: true, creditAccountCode: true,
              defaultGstRate: true, defaultTdsApplicable: true, defaultTdsSection: true,
              defaultTdsRate: true, invoiceRequired: true, expenseCategory: true,
            },
          },
        },
      });

      if (parsed?.supplierName) {
        const matched = findPartyByNarration(parsed.supplierName, allParties);
        if (matched) {
          partyId = matched.id;
          matchedPartyName = matched.name;
          matchedCategory = matched.category;
        }
      }

      if (!partyId && parsed?.supplierGstin) {
        const gstinParty = allParties.find(p => p.gstin === parsed!.supplierGstin);
        if (gstinParty) {
          partyId = gstinParty.id;
          matchedPartyName = gstinParty.name;
          matchedCategory = gstinParty.category;
        }
      }
    }

    // 5. Parse dates
    const invoiceDate = parsed ? parseIndianDate(parsed.invoiceDate) : null;
    const dueDate = parsed ? parseIndianDate(parsed.dueDate) : null;

    // 5b. Invoice number + party duplicate check
    if (parsed?.invoiceNumber && partyId) {
      const numberDuplicate = await checkExactDuplicate(prisma as any, '', partyId, parsed.invoiceNumber);
      if (numberDuplicate) {
        log.info({ attachmentId, filename, reason: 'invoice_number', existingInvoiceId: numberDuplicate.existingInvoiceId }, 'Duplicate invoice number — skipping');
        result.duplicate = true;
        result.invoiceId = numberDuplicate.existingInvoiceId;
        return result;
      }
    }

    // 6. Derive billingPeriod
    let billingPeriod = parsed?.billingPeriod ?? null;
    if (!billingPeriod && invoiceDate) {
      const ist = new Date(invoiceDate.getTime() + (5.5 * 60 * 60 * 1000));
      billingPeriod = `${ist.getUTCFullYear()}-${String(ist.getUTCMonth() + 1).padStart(2, '0')}`;
    }

    // 6b. Fabric matching
    const isFabric = matchedCategory === 'fabric';
    const fabricMatches = isFabric && parsed?.lines?.length
      ? await matchInvoiceLines(parsed.lines, partyId ?? null, prisma as any)
      : [];

    // 7. Build notes with email metadata
    const supplierName = parsed?.supplierName ?? null;
    const emailNote = `Via email from ${emailFrom} — ${emailSubject || '(no subject)'}`;
    const partyNote = supplierName && !partyId ? `Supplier: ${supplierName} (no party match)` : null;
    const failNote = !parsed ? 'AI parsing failed — fill in manually' : null;
    const notes = [emailNote, partyNote, failNote].filter(Boolean).join('\n');

    // 8. Save file to disk (dual-write: disk + DB blob)
    const effectiveFileName = filename ?? `email-attachment-${attachmentId}`;
    let filePath: string | null = null;
    try {
      filePath = buildInvoicePath(
        matchedPartyName ?? parsed?.supplierName,
        invoiceDate ?? new Date(),
        effectiveFileName,
      );
      await saveFile(filePath, buffer);
    } catch (err: unknown) {
      log.error({ error: err instanceof Error ? err.message : err }, 'Failed to save email attachment to disk');
      filePath = null;
    }

    // 9. Create draft Invoice + lines
    let invoice = await prisma.invoice.create({
      data: {
        type: 'payable',
        category: matchedCategory,
        status: 'draft',
        invoiceNumber: parsed?.invoiceNumber ?? null,
        invoiceDate,
        dueDate,
        billingPeriod,
        subtotal: parsed?.subtotal ?? null,
        gstRate: (() => {
          const lines = parsed?.lines ?? [];
          const rates = lines.map(l => l.gstPercent).filter((r): r is number => r != null && r > 0);
          if (rates.length === 0) return null;
          const counts = new Map<number, number>();
          for (const r of rates) counts.set(r, (counts.get(r) ?? 0) + 1);
          return [...counts.entries()].sort((a, b) => b[1] - a[1])[0][0];
        })(),
        gstAmount: parsed?.gstAmount ?? null,
        gstType: parsed?.gstType ?? null,
        cgstAmount: parsed?.cgstAmount ?? null,
        sgstAmount: parsed?.sgstAmount ?? null,
        igstAmount: parsed?.igstAmount ?? null,
        totalAmount: parsed?.totalAmount ?? 0,
        balanceDue: parsed?.totalAmount ?? 0,
        ...(partyId ? { partyId } : {}),
        fileData: buffer,
        ...(filePath ? { filePath } : {}),
        fileHash,
        fileName: effectiveFileName,
        fileMimeType: contentType,
        fileSizeBytes: buffer.length,
        ...(rawResponse ? { aiRawResponse: rawResponse } : {}),
        aiModel,
        aiConfidence,
        notes,
        createdById: adminUserId,
        lines: {
          create: (parsed?.lines ?? []).map((line, i) => {
            const match = fabricMatches[i];
            return {
              description: line.description ?? null,
              hsnCode: line.hsnCode ?? null,
              qty: line.qty ?? null,
              unit: line.unit ?? null,
              rate: line.rate ?? null,
              amount: line.amount ?? null,
              gstPercent: line.gstPercent ?? null,
              gstAmount: line.gstAmount ?? null,
              ...(match?.fabricColourId ? { fabricColourId: match.fabricColourId } : {}),
              ...(match?.matchedTxnId ? { matchedTxnId: match.matchedTxnId } : {}),
              ...(match?.matchType ? { matchType: match.matchType } : {}),
            };
          }),
        },
      },
      select: {
        id: true, invoiceNumber: true, partyId: true, totalAmount: true, aiConfidence: true,
        party: { select: { name: true } },
      },
    });

    log.info({ invoiceId: invoice.id, aiConfidence, partyMatched: !!partyId, emailFrom }, 'Draft invoice created from email');

    result.invoiceNumber = invoice.invoiceNumber;
    result.supplierName = invoice.party?.name ?? supplierName;
    result.totalAmount = invoice.totalAmount ? Number(invoice.totalAmount) : null;
    result.aiConfidence = aiConfidence;

    // 9. Enrich party or create new party
    if (parsed) {
      if (partyId) {
        await enrichPartyFromInvoice(prisma, partyId, parsed);
      } else if (parsed.supplierName) {
        const created = await createPartyFromInvoice(prisma, parsed);
        if (created) {
          await prisma.invoice.update({
            where: { id: invoice.id },
            data: {
              partyId: created.partyId,
              notes: emailNote, // Remove the "no party match" note
            },
          });
          invoice = { ...invoice, partyId: created.partyId };
        }
      }
    }

    // 10. Fire-and-forget: push to Google Drive
    deferredExecutor.enqueue(
      async () => { await uploadInvoiceFile(invoice.id); },
      { action: 'driveUploadInvoice' }
    );

    result.invoiceId = invoice.id;
    return result;
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    log.error({ attachmentId, filename, error: msg }, 'Failed to process email attachment');
    result.error = msg;
    return result;
  }
}

// ============================================
// POST /inbound — Resend email.received webhook
// ============================================

router.post('/inbound', asyncHandler(async (req: Request, res: Response) => {
  // Always return 200 to Resend to prevent retries
  const respond = () => res.status(200).json({ received: true });

  // 1. Verify webhook signature
  if (!verifyWebhookSignature(req)) {
    log.warn('Webhook signature verification failed — rejecting');
    respond();
    return;
  }

  // 2. Parse payload
  const parseResult = WebhookPayloadSchema.safeParse(req.body);
  if (!parseResult.success) {
    log.warn({ errors: parseResult.error.flatten() }, 'Invalid webhook payload');
    respond();
    return;
  }

  const payload = parseResult.data;

  // Only handle email.received events
  if (payload.type !== 'email.received') {
    log.info({ type: payload.type }, 'Ignoring non-email.received webhook event');
    respond();
    return;
  }

  const { email_id: emailId, from: emailFrom, to, subject: emailSubject } = payload.data;
  log.info({ emailId, from: emailFrom, to, subject: emailSubject }, 'Inbound email received');

  // Only process emails sent to invoices@coh.one
  const ALLOWED_RECIPIENT = 'invoices@coh.one';
  if (!to.some(addr => addr.toLowerCase() === ALLOWED_RECIPIENT)) {
    log.info({ emailId, to }, `Ignoring email not addressed to ${ALLOWED_RECIPIENT}`);
    respond();
    return;
  }

  // 3. Look up admin user for createdById
  const adminUser = await req.prisma.user.findFirst({ where: { role: 'admin' } });
  if (!adminUser) {
    log.error('No admin user found — cannot create invoices');
    respond();
    return;
  }

  // 4. Fetch full email via Resend API
  let emailData;
  try {
    const emailResult = await resend.emails.receiving.get(emailId);
    if (emailResult.error) {
      log.error({ emailId, error: emailResult.error }, 'Failed to fetch email from Resend');
      respond();
      return;
    }
    emailData = emailResult.data;
  } catch (err: unknown) {
    log.error({ emailId, error: err instanceof Error ? err.message : err }, 'Error fetching email from Resend');
    respond();
    return;
  }

  if (!emailData) {
    log.error({ emailId }, 'No email data returned from Resend');
    respond();
    return;
  }

  // 5. List attachments with download URLs
  let attachments: Array<{
    id: string;
    filename?: string | null;
    size: number;
    content_type: string;
    content_disposition: string;
    content_id?: string;
    download_url: string;
    expires_at: string;
  }> = [];

  try {
    const attachResult = await resend.emails.receiving.attachments.list({ emailId });
    if (attachResult.error) {
      log.error({ emailId, error: attachResult.error }, 'Failed to list attachments from Resend');
      respond();
      return;
    }
    attachments = attachResult.data?.data ?? [];
  } catch (err: unknown) {
    log.error({ emailId, error: err instanceof Error ? err.message : err }, 'Error listing attachments from Resend');
    respond();
    return;
  }

  // 6. Filter to supported MIME types
  const supported = attachments.filter(a => SUPPORTED_MIME_TYPES.has(a.content_type));
  log.info(
    { emailId, totalAttachments: attachments.length, supportedAttachments: supported.length },
    'Filtered attachments by MIME type',
  );

  if (supported.length === 0) {
    log.info({ emailId }, 'No supported attachments found in email');
    respond();
    return;
  }

  // 7. Process each attachment sequentially (avoid overwhelming AI API)
  const results: AttachmentResult[] = [];
  for (const attachment of supported) {
    const attachResult = await processAttachment(
      req.prisma,
      attachment,
      emailId,
      emailFrom,
      emailSubject ?? '(no subject)',
      adminUser.id,
    );
    results.push(attachResult);
    log.info(
      {
        attachmentId: attachResult.attachmentId,
        filename: attachResult.filename,
        invoiceId: attachResult.invoiceId,
        duplicate: attachResult.duplicate,
        error: attachResult.error,
      },
      'Attachment processing complete',
    );
  }

  const created = results.filter(r => r.invoiceId && !r.duplicate && !r.error).length;
  const duplicates = results.filter(r => r.duplicate).length;
  const errors = results.filter(r => r.error).length;

  log.info(
    { emailId, emailFrom, created, duplicates, errors, total: supported.length },
    'Inbound email processing complete',
  );

  // 8. Send confirmation email back to sender
  if (results.length > 0) {
    deferredExecutor.enqueue(async () => {
      try {
        const successResults = results.filter(r => r.invoiceId && !r.duplicate && !r.error);
        const dupResults = results.filter(r => r.duplicate);
        const errResults = results.filter(r => r.error);

        const rows = successResults.map(r => {
          const inv = r.invoiceNumber ?? '—';
          const supplier = r.supplierName ?? 'Unknown';
          const amount = r.totalAmount != null ? `₹${r.totalAmount.toLocaleString('en-IN')}` : '—';
          const confidence = `${Math.round(r.aiConfidence * 100)}%`;
          return `<tr><td style="padding:6px 12px;border:1px solid #e5e7eb">${r.filename ?? '—'}</td><td style="padding:6px 12px;border:1px solid #e5e7eb">${inv}</td><td style="padding:6px 12px;border:1px solid #e5e7eb">${supplier}</td><td style="padding:6px 12px;border:1px solid #e5e7eb">${amount}</td><td style="padding:6px 12px;border:1px solid #e5e7eb">${confidence}</td></tr>`;
        }).join('');

        const warnings: string[] = [];
        if (dupResults.length > 0) warnings.push(`${dupResults.length} duplicate(s) skipped`);
        if (errResults.length > 0) warnings.push(`${errResults.length} failed: ${errResults.map(r => r.error).join(', ')}`);

        const html = `
<div style="font-family:system-ui,sans-serif;max-width:600px">
  <h2 style="color:#16a34a;margin-bottom:4px">Invoice${successResults.length !== 1 ? 's' : ''} received</h2>
  <p style="color:#6b7280;margin-top:0">${successResults.length} draft invoice${successResults.length !== 1 ? 's' : ''} created from your email "<strong>${emailSubject ?? '(no subject)'}</strong>"</p>
  ${successResults.length > 0 ? `
  <table style="border-collapse:collapse;width:100%;font-size:14px;margin:16px 0">
    <thead><tr style="background:#f9fafb">
      <th style="padding:6px 12px;border:1px solid #e5e7eb;text-align:left">File</th>
      <th style="padding:6px 12px;border:1px solid #e5e7eb;text-align:left">Invoice #</th>
      <th style="padding:6px 12px;border:1px solid #e5e7eb;text-align:left">Supplier</th>
      <th style="padding:6px 12px;border:1px solid #e5e7eb;text-align:left">Amount</th>
      <th style="padding:6px 12px;border:1px solid #e5e7eb;text-align:left">Confidence</th>
    </tr></thead>
    <tbody>${rows}</tbody>
  </table>` : ''}
  ${warnings.length > 0 ? `<p style="color:#d97706;font-size:13px">⚠ ${warnings.join('. ')}</p>` : ''}
  <p style="color:#6b7280;font-size:13px">These invoices are saved as <strong>drafts</strong> — please review and confirm in the ERP.</p>
</div>`;

        await sendEmail({
          to: emailFrom,
          subject: `✓ ${successResults.length} draft invoice${successResults.length !== 1 ? 's' : ''} created — ${emailSubject ?? '(no subject)'}`,
          html,
        });
        log.info({ emailFrom, created: successResults.length }, 'Confirmation email sent');
      } catch (err: unknown) {
        log.error({ error: err instanceof Error ? err.message : err }, 'Failed to send confirmation email');
      }
    }, { action: 'sendInvoiceConfirmationEmail' });
  }

  respond();
}));

export default router;
