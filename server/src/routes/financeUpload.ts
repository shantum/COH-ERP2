/**
 * Finance Upload Routes
 *
 * File upload for invoices/receipts and file download.
 * Same pattern as fabricInvoices.ts but for the general finance system.
 * Auto-pushes uploaded files to Google Drive for CA access.
 */

import { Router } from 'express';
import type { Request, Response } from 'express';
import type { Prisma } from '@prisma/client';
import multer from 'multer';
import { requireAdmin } from '../middleware/auth.js';
import { asyncHandler } from '../middleware/asyncHandler.js';
import logger from '../utils/logger.js';
import { deferredExecutor } from '../services/deferredExecutor.js';
import { uploadInvoiceFile } from '../services/driveFinanceSync.js';
import driveFinanceSync from '../services/driveFinanceSync.js';
import { parseInvoice, parseIndianDate, type ParsedInvoice } from '../services/invoiceParser.js';
import { findPartyByNarration } from '../services/transactionTypeResolver.js';
import { randomUUID } from 'crypto';
import * as previewCache from '../services/invoicePreviewCache.js';
import type { EnrichmentPreview } from '../services/invoicePreviewCache.js';
import { computeFileHash, checkExactDuplicate, checkNearDuplicates } from '../services/invoiceDuplicateCheck.js';
import type { DuplicateResult, NearDuplicate } from '../services/invoiceDuplicateCheck.js';

// ============================================
// PARTY ENRICHMENT
// ============================================

interface EnrichmentResult {
  fieldsAdded: string[];
  bankMismatch: boolean;
  bankMismatchDetails?: string;
  partyCreated: boolean;
  partyName?: string;
}

/** Derive PAN from 15-char GSTIN (chars at index 2..11) */
function panFromGstin(gstin: string): string | null {
  if (gstin.length === 15) return gstin.slice(2, 12);
  return null;
}

/** Human-readable label for a Party field */
const FIELD_LABELS: Record<string, string> = {
  gstin: 'GSTIN',
  pan: 'PAN',
  email: 'Email',
  phone: 'Phone',
  address: 'Address',
  stateCode: 'State Code',
  bankAccountNumber: 'Bank Account',
  bankIfsc: 'Bank IFSC',
  bankName: 'Bank Name',
  bankAccountName: 'Beneficiary Name',
};

/**
 * Auto-fill missing Party fields from AI-parsed invoice data.
 * Bank details: only fill if party has none; flag mismatch if different.
 */
async function enrichPartyFromInvoice(
  prisma: Request['prisma'],
  partyId: string,
  parsed: ParsedInvoice,
): Promise<EnrichmentResult> {
  const result: EnrichmentResult = { fieldsAdded: [], bankMismatch: false, partyCreated: false };

  const party = await prisma.party.findUnique({
    where: { id: partyId },
    select: {
      gstin: true, pan: true, email: true, phone: true,
      address: true, stateCode: true,
      bankAccountNumber: true, bankIfsc: true, bankName: true, bankAccountName: true,
    },
  });
  if (!party) return result;

  // Map: partyField → parsed value
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

  // Non-bank: fill if party is missing
  for (const { field, value } of nonBankFields) {
    if (value && !party[field]) {
      updates[field] = value;
      result.fieldsAdded.push(FIELD_LABELS[field] ?? field);
    }
  }

  // Bank: fill only if party has NO bank details at all
  const partyHasBank = !!party.bankAccountNumber;
  const invoiceHasBank = !!parsed.supplierBankAccountNumber;

  if (invoiceHasBank && !partyHasBank) {
    // Party has no bank info → auto-fill
    for (const { field, value } of bankFields) {
      if (value) {
        updates[field] = value;
        result.fieldsAdded.push(FIELD_LABELS[field] ?? field);
      }
    }
  } else if (invoiceHasBank && partyHasBank) {
    // Both have bank info → check for mismatch
    const invoiceAcct = parsed.supplierBankAccountNumber?.replace(/\s/g, '') ?? '';
    const partyAcct = party.bankAccountNumber?.replace(/\s/g, '') ?? '';
    if (invoiceAcct && partyAcct && invoiceAcct !== partyAcct) {
      result.bankMismatch = true;
      result.bankMismatchDetails = `Invoice: ${parsed.supplierBankAccountNumber} (${parsed.supplierBankIfsc ?? '?'}) vs ERP: ${party.bankAccountNumber} (${party.bankIfsc ?? '?'})`;
    }
  }

  // Apply updates
  if (Object.keys(updates).length > 0) {
    await prisma.party.update({
      where: { id: partyId },
      data: updates,
    });
    log.info({ partyId, fieldsAdded: result.fieldsAdded }, 'Party enriched from invoice');
  }

  return result;
}

/**
 * Create a new Party from AI-parsed invoice data when no match is found.
 */
async function createPartyFromInvoice(
  prisma: Request['prisma'],
  parsed: ParsedInvoice,
): Promise<{ partyId: string; enrichment: EnrichmentResult } | null> {
  const name = parsed.supplierName?.trim();
  if (!name) return null;

  const fieldsAdded: string[] = [];

  // Build optional fields from AI-parsed data, tracking which were found
  const optionalFields: Array<{ key: keyof Prisma.PartyUncheckedCreateInput; value: string | null | undefined; label: string }> = [
    { key: 'gstin', value: parsed.supplierGstin, label: 'GSTIN' },
    { key: 'pan', value: parsed.supplierPan ?? (parsed.supplierGstin ? panFromGstin(parsed.supplierGstin) : null), label: 'PAN' },
    { key: 'email', value: parsed.supplierEmail, label: 'Email' },
    { key: 'phone', value: parsed.supplierPhone, label: 'Phone' },
    { key: 'address', value: parsed.supplierAddress, label: 'Address' },
    { key: 'stateCode', value: parsed.supplierStateCode, label: 'State Code' },
    { key: 'bankAccountNumber', value: parsed.supplierBankAccountNumber, label: 'Bank Account' },
    { key: 'bankIfsc', value: parsed.supplierBankIfsc, label: 'Bank IFSC' },
    { key: 'bankName', value: parsed.supplierBankName, label: 'Bank Name' },
    { key: 'bankAccountName', value: parsed.supplierBankAccountName, label: 'Beneficiary Name' },
  ];

  const extras: Partial<Prisma.PartyUncheckedCreateInput> = {};
  for (const { key, value, label } of optionalFields) {
    if (value) {
      (extras[key] as string) = value;
      fieldsAdded.push(label);
    }
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

    log.info({ partyId: newParty.id, name: newParty.name, fieldsAdded }, 'New Party created from invoice');

    return {
      partyId: newParty.id,
      enrichment: {
        fieldsAdded,
        bankMismatch: false,
        partyCreated: true,
        partyName: newParty.name,
      },
    };
  } catch (err: unknown) {
    // Unique constraint on name — party might already exist with exact name
    log.warn({ name, error: err instanceof Error ? err.message : err }, 'Failed to create party from invoice (possible duplicate name)');
    return null;
  }
}

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

  // Duplicate check: file hash
  const fileHash = computeFileHash(buffer);
  const duplicate = await checkExactDuplicate(req.prisma as any, fileHash);
  if (duplicate) {
    res.status(409).json({ duplicate: true, ...duplicate });
    return;
  }

  log.info({ fileName: originalname, mimeType: mimetype, size, invoiceId }, 'Finance file upload received');

  // Attach file to invoice
  const invoice = await req.prisma.invoice.update({
    where: { id: invoiceId },
    data: {
      fileData: buffer,
      fileName: originalname,
      fileMimeType: mimetype,
      fileSizeBytes: size,
      fileHash,
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

  // 0. File hash duplicate check
  const fileHash = computeFileHash(buffer);
  const hashDuplicate = await checkExactDuplicate(req.prisma as any, fileHash);
  if (hashDuplicate) {
    res.status(409).json({ duplicate: true, ...hashDuplicate });
    return;
  }

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

  // 3b. Invoice number + party duplicate check
  if (parsed?.invoiceNumber && partyId) {
    const numberDuplicate = await checkExactDuplicate(req.prisma as any, '', partyId, parsed.invoiceNumber);
    if (numberDuplicate) {
      res.status(409).json({ duplicate: true, ...numberDuplicate });
      return;
    }
  }

  // 4. Derive billingPeriod
  let billingPeriod = parsed?.billingPeriod ?? null;
  if (!billingPeriod && invoiceDate) {
    const ist = new Date(invoiceDate.getTime() + (5.5 * 60 * 60 * 1000));
    billingPeriod = `${ist.getUTCFullYear()}-${String(ist.getUTCMonth() + 1).padStart(2, '0')}`;
  }

  // 5. Create draft Invoice + lines
  const supplierName = parsed?.supplierName ?? null;
  let invoice = await req.prisma.invoice.create({
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
      fileHash,
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

  // 6. Enrich party data from parsed invoice
  let enrichment: EnrichmentResult = { fieldsAdded: [], bankMismatch: false, partyCreated: false };

  if (parsed) {
    if (partyId) {
      // Matched existing party — fill missing fields
      enrichment = await enrichPartyFromInvoice(req.prisma, partyId, parsed);
    } else if (parsed.supplierName) {
      // No match — try creating a new Party
      const created = await createPartyFromInvoice(req.prisma, parsed);
      if (created) {
        enrichment = created.enrichment;
        // Link the new party to the invoice
        await req.prisma.invoice.update({
          where: { id: invoice.id },
          data: { partyId: created.partyId, notes: null },
        });
        invoice = { ...invoice, partyId: created.partyId, party: { id: created.partyId, name: parsed.supplierName! } };
      }
    }
  }

  // 7. Fire-and-forget: push to Google Drive
  deferredExecutor.enqueue(
    async () => { await uploadInvoiceFile(invoice.id); },
    { action: 'driveUploadInvoice' }
  );

  res.json({ success: true, invoice: { ...invoice, supplierName }, aiConfidence, enrichment });
}));

// ============================================
// PREVIEW ENRICHMENT (read-only)
// ============================================

/**
 * Preview what enrichment WOULD happen without writing anything.
 * Returns field changes that would occur on confirm.
 */
async function previewEnrichment(
  prisma: Request['prisma'],
  partyId: string | undefined,
  parsed: ParsedInvoice,
): Promise<EnrichmentPreview> {
  if (partyId) {
    // Existing party — check what fields would be added
    const party = await prisma.party.findUnique({
      where: { id: partyId },
      select: {
        gstin: true, pan: true, email: true, phone: true,
        address: true, stateCode: true,
        bankAccountNumber: true, bankIfsc: true, bankName: true, bankAccountName: true,
      },
    });
    if (!party) return { willCreateNewParty: false, fieldsWillBeAdded: [], bankMismatch: false };

    const fieldsWillBeAdded: string[] = [];

    // Non-bank fields
    const nonBank: Array<{ field: keyof typeof party; value: string | null | undefined }> = [
      { field: 'gstin', value: parsed.supplierGstin },
      { field: 'pan', value: parsed.supplierPan ?? (parsed.supplierGstin ? panFromGstin(parsed.supplierGstin) : null) },
      { field: 'email', value: parsed.supplierEmail },
      { field: 'phone', value: parsed.supplierPhone },
      { field: 'address', value: parsed.supplierAddress },
      { field: 'stateCode', value: parsed.supplierStateCode },
    ];
    for (const { field, value } of nonBank) {
      if (value && !party[field]) fieldsWillBeAdded.push(FIELD_LABELS[field] ?? field);
    }

    // Bank fields
    const partyHasBank = !!party.bankAccountNumber;
    const invoiceHasBank = !!parsed.supplierBankAccountNumber;
    let bankMismatch = false;
    let bankMismatchDetails: string | undefined;

    if (invoiceHasBank && !partyHasBank) {
      const bankFields: Array<{ field: keyof typeof party; value: string | null | undefined }> = [
        { field: 'bankAccountNumber', value: parsed.supplierBankAccountNumber },
        { field: 'bankIfsc', value: parsed.supplierBankIfsc },
        { field: 'bankName', value: parsed.supplierBankName },
        { field: 'bankAccountName', value: parsed.supplierBankAccountName },
      ];
      for (const { field, value } of bankFields) {
        if (value) fieldsWillBeAdded.push(FIELD_LABELS[field] ?? field);
      }
    } else if (invoiceHasBank && partyHasBank) {
      const invoiceAcct = parsed.supplierBankAccountNumber?.replace(/\s/g, '') ?? '';
      const partyAcct = party.bankAccountNumber?.replace(/\s/g, '') ?? '';
      if (invoiceAcct && partyAcct && invoiceAcct !== partyAcct) {
        bankMismatch = true;
        bankMismatchDetails = `Invoice: ${parsed.supplierBankAccountNumber} (${parsed.supplierBankIfsc ?? '?'}) vs ERP: ${party.bankAccountNumber} (${party.bankIfsc ?? '?'})`;
      }
    }

    return { willCreateNewParty: false, fieldsWillBeAdded, bankMismatch, bankMismatchDetails };
  }

  if (parsed.supplierName) {
    // No party match — would create new party
    const fieldsWillBeAdded: string[] = [];
    const optionalFields: Array<{ value: string | null | undefined; label: string }> = [
      { value: parsed.supplierGstin, label: 'GSTIN' },
      { value: parsed.supplierPan ?? (parsed.supplierGstin ? panFromGstin(parsed.supplierGstin) : null), label: 'PAN' },
      { value: parsed.supplierEmail, label: 'Email' },
      { value: parsed.supplierPhone, label: 'Phone' },
      { value: parsed.supplierAddress, label: 'Address' },
      { value: parsed.supplierStateCode, label: 'State Code' },
      { value: parsed.supplierBankAccountNumber, label: 'Bank Account' },
      { value: parsed.supplierBankIfsc, label: 'Bank IFSC' },
      { value: parsed.supplierBankName, label: 'Bank Name' },
      { value: parsed.supplierBankAccountName, label: 'Beneficiary Name' },
    ];
    for (const { value, label } of optionalFields) {
      if (value) fieldsWillBeAdded.push(label);
    }
    return { willCreateNewParty: true, newPartyName: parsed.supplierName, fieldsWillBeAdded, bankMismatch: false };
  }

  return { willCreateNewParty: false, fieldsWillBeAdded: [], bankMismatch: false };
}

// ============================================
// POST /upload-preview — Parse invoice, return preview (NO DB write)
// ============================================

router.post('/upload-preview', requireAdmin, upload.single('file'), asyncHandler(async (req: Request, res: Response) => {
  if (!req.file) {
    res.status(400).json({ error: 'No file uploaded' });
    return;
  }

  const { buffer, originalname, mimetype, size } = req.file;
  log.info({ fileName: originalname, mimeType: mimetype, size }, 'Upload-preview received');

  // 0. File hash duplicate check (before expensive AI parse)
  const fileHash = computeFileHash(buffer);
  const hashDuplicate = await checkExactDuplicate(req.prisma as any, fileHash);
  if (hashDuplicate) {
    res.status(409).json({ duplicate: true, ...hashDuplicate });
    return;
  }

  // 1. Parse with AI
  let parsed: ParsedInvoice | null = null;
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
    log.error({ error: err instanceof Error ? err.message : err }, 'AI parsing failed');
    // Still return a preview — user can see "parsing failed" and cancel
  }

  // 2. Match supplier to Party (read-only)
  let partyMatch: { partyId: string; partyName: string; category: string } | null = null;
  if (parsed?.supplierName || parsed?.supplierGstin) {
    const allParties = await req.prisma.party.findMany({
      where: { isActive: true },
      select: { id: true, name: true, aliases: true, category: true, gstin: true },
    });

    if (parsed?.supplierName) {
      const matched = findPartyByNarration(parsed.supplierName, allParties as any);
      if (matched) partyMatch = { partyId: matched.id, partyName: matched.name, category: matched.category };
    }

    if (!partyMatch && parsed?.supplierGstin) {
      const gstinParty = allParties.find(p => p.gstin === parsed!.supplierGstin);
      if (gstinParty) partyMatch = { partyId: gstinParty.id, partyName: gstinParty.name, category: gstinParty.category };
    }
  }

  // 3. Invoice number + party duplicate check (after AI parse)
  if (parsed?.invoiceNumber && partyMatch?.partyId) {
    const numberDuplicate = await checkExactDuplicate(
      req.prisma as any, '', partyMatch.partyId, parsed.invoiceNumber,
    );
    if (numberDuplicate) {
      res.status(409).json({ duplicate: true, ...numberDuplicate });
      return;
    }
  }

  // 4. Near-duplicate check (soft warning)
  const invoiceDate = parsed ? parseIndianDate(parsed.invoiceDate) : null;
  const nearDuplicates = await checkNearDuplicates(
    req.prisma as any, partyMatch?.partyId, parsed?.totalAmount, invoiceDate,
  );

  // 5. Preview enrichment (read-only)
  const enrichmentPreview = parsed
    ? await previewEnrichment(req.prisma, partyMatch?.partyId, parsed)
    : { willCreateNewParty: false, fieldsWillBeAdded: [] as string[], bankMismatch: false };

  // 6. Cache for later confirm
  const previewId = randomUUID();
  previewCache.set(previewId, {
    fileBuffer: buffer,
    fileHash,
    originalname,
    mimetype,
    size,
    parsed,
    rawResponse,
    aiModel,
    aiConfidence,
    partyMatch,
    enrichmentPreview,
    createdAt: Date.now(),
  });

  // 7. Return preview data
  res.json({
    previewId,
    parsed,
    partyMatch,
    enrichmentPreview,
    nearDuplicates,
    aiConfidence,
    aiModel,
    fileName: originalname,
  });
}));

// ============================================
// POST /confirm-preview/:previewId — Save from cache
// ============================================

router.post('/confirm-preview/:previewId', requireAdmin, asyncHandler(async (req: Request, res: Response) => {
  const { previewId } = req.params;
  const cached = previewCache.get(previewId as string);

  if (!cached) {
    res.status(410).json({ error: 'Preview expired, please re-upload' });
    return;
  }

  const userId = req.user?.id;
  if (!userId) {
    res.status(401).json({ error: 'Not authenticated' });
    return;
  }

  const { fileBuffer: buffer, fileHash, originalname, mimetype, size, parsed, rawResponse, aiModel, aiConfidence, partyMatch } = cached;

  // Merge user overrides from request body (editable preview fields)
  const overrides = req.body ?? {};
  const mergedParsed = {
    ...parsed,
    ...(overrides.invoiceNumber !== undefined ? { invoiceNumber: overrides.invoiceNumber } : {}),
    ...(overrides.invoiceDate !== undefined ? { invoiceDate: overrides.invoiceDate } : {}),
    ...(overrides.dueDate !== undefined ? { dueDate: overrides.dueDate } : {}),
    ...(overrides.subtotal !== undefined ? { subtotal: overrides.subtotal } : {}),
    ...(overrides.gstAmount !== undefined ? { gstAmount: overrides.gstAmount } : {}),
    ...(overrides.totalAmount !== undefined ? { totalAmount: overrides.totalAmount } : {}),
    ...(overrides.billingPeriod !== undefined ? { billingPeriod: overrides.billingPeriod } : {}),
    ...(overrides.category !== undefined ? { category: overrides.category } : {}),
  };

  // Re-check for duplicates (race condition guard — someone may have uploaded between preview and confirm)
  if (fileHash) {
    const duplicate = await checkExactDuplicate(req.prisma as any, fileHash, partyMatch?.partyId, mergedParsed?.invoiceNumber);
    if (duplicate) {
      previewCache.remove(previewId as string);
      res.status(409).json({ duplicate: true, ...duplicate });
      return;
    }
  }

  // Re-fetch parties for enrichment (data may have changed since preview)
  let partyId = partyMatch?.partyId;
  let matchedCategory = partyMatch?.category ?? 'other';

  // If no party match was found at preview time, re-check (user may have created one)
  if (!partyId && (parsed?.supplierName || parsed?.supplierGstin)) {
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

    if (parsed?.supplierName) {
      const matched = findPartyByNarration(parsed.supplierName, allParties);
      if (matched) { partyId = matched.id; matchedCategory = matched.category; }
    }
    if (!partyId && parsed?.supplierGstin) {
      const gstinParty = allParties.find(p => p.gstin === parsed!.supplierGstin);
      if (gstinParty) { partyId = gstinParty.id; matchedCategory = gstinParty.category; }
    }
  }

  // Parse dates (use mergedParsed for user-editable fields)
  const invoiceDate = mergedParsed ? parseIndianDate(mergedParsed.invoiceDate) : null;
  const dueDate = mergedParsed ? parseIndianDate(mergedParsed.dueDate) : null;

  // Derive billingPeriod
  let billingPeriod = mergedParsed?.billingPeriod ?? null;
  if (!billingPeriod && invoiceDate) {
    const ist = new Date(invoiceDate.getTime() + (5.5 * 60 * 60 * 1000));
    billingPeriod = `${ist.getUTCFullYear()}-${String(ist.getUTCMonth() + 1).padStart(2, '0')}`;
  }

  // Create draft Invoice + lines (same logic as upload-and-parse)
  const supplierName = parsed?.supplierName ?? null;
  const finalCategory = overrides.category ?? matchedCategory;
  let invoice = await req.prisma.invoice.create({
    data: {
      type: 'payable',
      category: finalCategory,
      status: 'draft',
      invoiceNumber: mergedParsed?.invoiceNumber ?? null,
      invoiceDate,
      dueDate,
      billingPeriod,
      subtotal: mergedParsed?.subtotal ?? null,
      gstAmount: mergedParsed?.gstAmount ?? null,
      totalAmount: mergedParsed?.totalAmount ?? 0,
      balanceDue: mergedParsed?.totalAmount ?? 0,
      ...(partyId ? { partyId } : {}),
      fileData: buffer,
      fileHash: fileHash ?? undefined,
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

  log.info({ invoiceId: invoice.id, aiConfidence, partyMatched: !!partyId }, 'Invoice created from preview confirm');

  // Enrich party data
  let enrichment: EnrichmentResult = { fieldsAdded: [], bankMismatch: false, partyCreated: false };

  if (parsed) {
    if (partyId) {
      enrichment = await enrichPartyFromInvoice(req.prisma, partyId, parsed);
    } else if (parsed.supplierName) {
      const created = await createPartyFromInvoice(req.prisma, parsed);
      if (created) {
        enrichment = created.enrichment;
        await req.prisma.invoice.update({
          where: { id: invoice.id },
          data: { partyId: created.partyId, notes: null },
        });
        invoice = { ...invoice, partyId: created.partyId, party: { id: created.partyId, name: parsed.supplierName! } };
      }
    }
  }

  // Fire-and-forget: push to Google Drive
  deferredExecutor.enqueue(
    async () => { await uploadInvoiceFile(invoice.id); },
    { action: 'driveUploadInvoice' }
  );

  // Remove from cache
  previewCache.remove(previewId as string);

  res.json({ success: true, invoice: { ...invoice, supplierName }, aiConfidence, enrichment });
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
