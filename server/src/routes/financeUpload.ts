/**
 * Finance Upload Routes
 *
 * File upload for invoices/receipts and file download.
 * Same pattern as fabricInvoices.ts but for the general finance system.
 * Auto-pushes uploaded files to Google Drive for CA access.
 */

import { Router } from 'express';
import type { Request, Response } from 'express';
import multer from 'multer';
import { requireAdmin } from '../middleware/auth.js';
import { asyncHandler } from '../middleware/asyncHandler.js';
import logger from '../utils/logger.js';
import { deferredExecutor } from '../services/deferredExecutor.js';
import { uploadInvoiceFile } from '../services/driveFinanceSync.js';
import driveFinanceSync from '../services/driveFinanceSync.js';
import { parseInvoice, parseIndianDate } from '../services/invoiceParser.js';
import { findPartyByNarration } from '../services/transactionTypeResolver.js';

const log = logger.child({ module: 'financeUpload' });
const router = Router();

// ============================================
// MULTER CONFIG
// ============================================

const ALLOWED_MIME_TYPES = [
  'application/pdf',
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/gif',
];

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 }, // 10MB
  fileFilter: (_req, file, cb) => {
    if (ALLOWED_MIME_TYPES.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error(`Unsupported file type: ${file.mimetype}. Use PDF, JPEG, PNG, or WebP.`));
    }
  },
});

// ============================================
// POST /upload — Upload file + attach to invoice
// ============================================

router.post('/upload', requireAdmin, upload.single('file'), asyncHandler(async (req: Request, res: Response) => {
  if (!req.file) {
    res.status(400).json({ error: 'No file uploaded' });
    return;
  }

  const { invoiceId } = req.body;
  if (!invoiceId) {
    res.status(400).json({ error: 'invoiceId is required' });
    return;
  }

  const { buffer, originalname, mimetype, size } = req.file;

  log.info({ fileName: originalname, mimeType: mimetype, size, invoiceId }, 'Finance file upload received');

  // Attach file to invoice
  const invoice = await req.prisma.invoice.update({
    where: { id: invoiceId },
    data: {
      fileData: buffer,
      fileName: originalname,
      fileMimeType: mimetype,
      fileSizeBytes: size,
    },
    select: { id: true, fileName: true, fileSizeBytes: true },
  });

  // Fire-and-forget: push to Google Drive in background
  deferredExecutor.enqueue(
    async () => { await uploadInvoiceFile(invoiceId); },
    { action: 'driveUploadInvoice' }
  );

  res.json({ success: true, invoice });
}));

// ============================================
// POST /upload-and-parse — AI-parse invoice file, create draft Invoice
// ============================================

router.post('/upload-and-parse', requireAdmin, upload.single('file'), asyncHandler(async (req: Request, res: Response) => {
  if (!req.file) {
    res.status(400).json({ error: 'No file uploaded' });
    return;
  }

  const userId = req.user?.id;
  if (!userId) {
    res.status(401).json({ error: 'Not authenticated' });
    return;
  }

  const { buffer, originalname, mimetype, size } = req.file;
  log.info({ fileName: originalname, mimeType: mimetype, size }, 'Upload-and-parse invoice received');

  // 1. Parse with AI
  let parsed;
  let rawResponse = '';
  let aiModel = '';
  let aiConfidence = 0;

  try {
    const result = await parseInvoice(buffer, mimetype);
    parsed = result.parsed;
    rawResponse = result.rawResponse;
    aiModel = result.model;
    aiConfidence = parsed.confidence;
  } catch (err: unknown) {
    log.error({ error: err instanceof Error ? err.message : err }, 'AI parsing failed, creating empty draft');
    parsed = null;
  }

  // 2. Try to match supplier to a Party (alias-based + GSTIN fallback)
  let partyId: string | undefined;
  let matchedCategory = 'other';
  if (parsed?.supplierName || parsed?.supplierGstin) {
    // Fetch all active parties for alias matching
    const allParties = await req.prisma.party.findMany({
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

    // Try alias-based match on supplier name (same logic as bank import)
    if (parsed?.supplierName) {
      const matched = findPartyByNarration(parsed.supplierName, allParties);
      if (matched) {
        partyId = matched.id;
        matchedCategory = matched.category;
      }
    }

    // Fallback: GSTIN match
    if (!partyId && parsed?.supplierGstin) {
      const gstinParty = allParties.find(p => p.gstin === parsed.supplierGstin);
      if (gstinParty) {
        partyId = gstinParty.id;
        matchedCategory = gstinParty.category;
      }
    }
  }

  // 3. Parse dates
  const invoiceDate = parsed ? parseIndianDate(parsed.invoiceDate) : null;
  const dueDate = parsed ? parseIndianDate(parsed.dueDate) : null;

  // 4. Derive billingPeriod
  let billingPeriod = parsed?.billingPeriod ?? null;
  if (!billingPeriod && invoiceDate) {
    const ist = new Date(invoiceDate.getTime() + (5.5 * 60 * 60 * 1000));
    billingPeriod = `${ist.getUTCFullYear()}-${String(ist.getUTCMonth() + 1).padStart(2, '0')}`;
  }

  // 5. Create draft Invoice + lines
  const supplierName = parsed?.supplierName ?? null;
  const invoice = await req.prisma.invoice.create({
    data: {
      type: 'payable',
      category: matchedCategory,
      status: 'draft',
      invoiceNumber: parsed?.invoiceNumber ?? null,
      invoiceDate,
      dueDate,
      billingPeriod,
      subtotal: parsed?.subtotal ?? null,
      gstAmount: parsed?.gstAmount ?? null,
      totalAmount: parsed?.totalAmount ?? 0,
      balanceDue: parsed?.totalAmount ?? 0,
      ...(partyId ? { partyId } : {}),
      fileData: buffer,
      fileName: originalname,
      fileMimeType: mimetype,
      fileSizeBytes: size,
      ...(rawResponse ? { aiRawResponse: rawResponse } : {}),
      aiModel,
      aiConfidence,
      notes: parsed
        ? (supplierName && !partyId ? `Supplier: ${supplierName} (no party match)` : null)
        : 'AI parsing failed — fill in manually',
      createdById: userId,
      lines: {
        create: (parsed?.lines ?? []).map(line => ({
          description: line.description ?? null,
          hsnCode: line.hsnCode ?? null,
          qty: line.qty ?? null,
          unit: line.unit ?? null,
          rate: line.rate ?? null,
          amount: line.amount ?? null,
          gstPercent: line.gstPercent ?? null,
          gstAmount: line.gstAmount ?? null,
        })),
      },
    },
    select: {
      id: true,
      invoiceNumber: true,
      invoiceDate: true,
      dueDate: true,
      billingPeriod: true,
      partyId: true,
      party: { select: { id: true, name: true } },
      category: true,
      subtotal: true,
      gstAmount: true,
      totalAmount: true,
      aiConfidence: true,
      status: true,
      fileName: true,
      notes: true,
    },
  });

  log.info({ invoiceId: invoice.id, aiConfidence, partyMatched: !!partyId }, 'Draft invoice created from AI parse');

  // 6. Fire-and-forget: push to Google Drive
  deferredExecutor.enqueue(
    async () => { await uploadInvoiceFile(invoice.id); },
    { action: 'driveUploadInvoice' }
  );

  res.json({ success: true, invoice: { ...invoice, supplierName }, aiConfidence });
}));

// ============================================
// GET /:id/file — Download original file
// ============================================

router.get('/:id/file', requireAdmin, asyncHandler(async (req: Request, res: Response) => {
  const invoice = await req.prisma.invoice.findUnique({
    where: { id: req.params.id as string },
    select: { fileData: true, fileName: true, fileMimeType: true },
  });

  if (!invoice || !invoice.fileData) {
    res.status(404).json({ error: 'File not found' });
    return;
  }

  res.setHeader('Content-Type', invoice.fileMimeType!);
  res.setHeader('Content-Disposition', `inline; filename="${invoice.fileName}"`);
  res.send(Buffer.from(invoice.fileData));
}));

// ============================================
// GET /payment/:id/file — Download payment file
// ============================================

router.get('/payment/:id/file', requireAdmin, asyncHandler(async (req: Request, res: Response) => {
  const payment = await req.prisma.payment.findUnique({
    where: { id: req.params.id as string },
    select: { fileData: true, fileName: true, fileMimeType: true },
  });

  if (!payment || !payment.fileData) {
    res.status(404).json({ error: 'File not found' });
    return;
  }

  res.setHeader('Content-Type', payment.fileMimeType!);
  res.setHeader('Content-Disposition', `inline; filename="${payment.fileName}"`);
  res.send(Buffer.from(payment.fileData));
}));

// ============================================
// POST /drive/sync — Trigger manual sync of all pending files
// ============================================

router.post('/drive/sync', requireAdmin, asyncHandler(async (_req: Request, res: Response) => {
  log.info('Manual Drive sync triggered');
  const result = await driveFinanceSync.triggerSync();
  res.json({ success: true, ...result });
}));

// ============================================
// GET /drive/status — Drive sync status
// ============================================

router.get('/drive/status', requireAdmin, asyncHandler(async (_req: Request, res: Response) => {
  res.json(driveFinanceSync.getStatus());
}));

export default router;
