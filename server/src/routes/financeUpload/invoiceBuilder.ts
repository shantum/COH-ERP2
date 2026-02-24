/**
 * Invoice Builder — shared invoice creation payload logic.
 * Deduplicates the create-invoice logic between upload-and-parse and confirm-preview.
 */

import type { Request } from 'express';
import type { ParsedInvoice } from '../../services/invoiceParser.js';
import { parseIndianDate } from '../../services/invoiceParser.js';
import { matchInvoiceLines } from '../../services/invoiceMatcher.js';

/** The select clause used for invoice creation responses. */
export const INVOICE_SELECT = {
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
  gstType: true,
  cgstAmount: true,
  sgstAmount: true,
  igstAmount: true,
  totalAmount: true,
  aiConfidence: true,
  status: true,
  fileName: true,
  notes: true,
} as const;

/** Derive the most common GST rate from invoice lines. */
export function deriveGstRate(lines: ParsedInvoice['lines']): number | null {
  const rates = (lines ?? []).map(l => l.gstPercent).filter((r): r is number => r != null && r > 0);
  if (rates.length === 0) return null;
  const counts = new Map<number, number>();
  for (const r of rates) counts.set(r, (counts.get(r) ?? 0) + 1);
  return [...counts.entries()].sort((a, b) => b[1] - a[1])[0][0];
}

/** Derive billing period from invoice date. */
export function deriveBillingPeriod(invoiceDate: Date | null, existing?: string | null): string | null {
  if (existing) return existing;
  if (!invoiceDate) return null;
  const ist = new Date(invoiceDate.getTime() + (5.5 * 60 * 60 * 1000));
  return `${ist.getUTCFullYear()}-${String(ist.getUTCMonth() + 1).padStart(2, '0')}`;
}

export interface CreateInvoiceParams {
  prisma: Request['prisma'];
  parsed: ParsedInvoice | null;
  /** Merged parsed data (with user overrides applied, if any) */
  mergedParsed?: Record<string, unknown> | null;
  partyId?: string;
  category: string;
  userId: string;
  file: {
    buffer: Buffer;
    fileHash: string;
    originalname: string;
    mimetype: string;
    size: number;
  };
  rawResponse?: string;
  aiModel: string;
  aiConfidence: number;
}

/**
 * Create a draft Invoice + lines from parsed data.
 * Used by both upload-and-parse and confirm-preview routes.
 */
export async function createDraftInvoice(params: CreateInvoiceParams) {
  const { prisma, parsed, partyId, category, userId, file, rawResponse, aiModel, aiConfidence } = params;
  const mp = params.mergedParsed ?? parsed;

  const invoiceDate = mp ? parseIndianDate(mp.invoiceDate as string | null | undefined) : null;
  const dueDate = mp ? parseIndianDate(mp.dueDate as string | null | undefined) : null;
  const billingPeriod = deriveBillingPeriod(invoiceDate, (mp?.billingPeriod as string | null) ?? null);

  // Fabric matching removed — fabric colours must be selected manually
  const fabricMatches: Awaited<ReturnType<typeof matchInvoiceLines>> = [];

  const supplierName = parsed?.supplierName ?? null;

  const invoice = await prisma.invoice.create({
    data: {
      type: 'payable',
      category,
      status: 'draft',
      invoiceNumber: (mp?.invoiceNumber as string | null) ?? null,
      invoiceDate,
      dueDate,
      billingPeriod,
      subtotal: (mp?.subtotal as number | null) ?? null,
      gstRate: deriveGstRate(parsed?.lines ?? []),
      gstAmount: (mp?.gstAmount as number | null) ?? null,
      gstType: (mp?.gstType as string | null) ?? parsed?.gstType ?? null,
      cgstAmount: parsed?.cgstAmount ?? null,
      sgstAmount: parsed?.sgstAmount ?? null,
      igstAmount: parsed?.igstAmount ?? null,
      totalAmount: (mp?.totalAmount as number | null) ?? 0,
      balanceDue: (mp?.totalAmount as number | null) ?? 0,
      ...(partyId ? { partyId } : {}),
      fileData: file.buffer,
      fileHash: file.fileHash || undefined,
      fileName: file.originalname,
      fileMimeType: file.mimetype,
      fileSizeBytes: file.size,
      ...(rawResponse ? { aiRawResponse: rawResponse } : {}),
      aiModel,
      aiConfidence,
      notes: parsed
        ? (supplierName && !partyId ? `Supplier: ${supplierName} (no party match)` : null)
        : 'AI parsing failed — fill in manually',
      createdById: userId,
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
    select: INVOICE_SELECT,
  });

  return { invoice, supplierName };
}
