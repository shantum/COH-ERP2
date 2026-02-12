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
