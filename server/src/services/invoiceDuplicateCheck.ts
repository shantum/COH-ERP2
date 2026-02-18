/**
 * Invoice Duplicate Detection
 *
 * Two layers:
 * 1. Hard block: exact file hash OR same invoiceNumber+party
 * 2. Soft warning: same party + similar amount + similar date (near-duplicates)
 */

import { createHash } from 'crypto';
import type { PrismaClient } from '@prisma/client';

// ============================================
// TYPES
// ============================================

export interface DuplicateResult {
  reason: 'file_hash' | 'invoice_number';
  existingInvoiceId: string;
  existingInvoiceNumber: string | null;
  partyName: string | null;
  fileName: string | null;
}

export interface NearDuplicate {
  invoiceId: string;
  invoiceNumber: string | null;
  totalAmount: number;
  invoiceDate: Date | null;
  partyName: string | null;
  fileName: string | null;
}

// ============================================
// HASH
// ============================================

export function computeFileHash(buffer: Buffer): string {
  return createHash('sha256').update(buffer).digest('hex');
}

// ============================================
// EXACT DUPLICATE CHECK (hard block)
// ============================================

const EXCLUDED_STATUSES = ['cancelled'];

/**
 * Check for exact duplicates by file hash and/or invoiceNumber+party.
 * Returns the first match found, or null if no duplicate.
 */
export async function checkExactDuplicate(
  prisma: PrismaClient,
  fileHash: string,
  partyId?: string,
  invoiceNumber?: string | null,
): Promise<DuplicateResult | null> {
  // 1. Check file hash
  const byHash = await prisma.invoice.findFirst({
    where: {
      fileHash,
      status: { notIn: EXCLUDED_STATUSES },
    },
    select: {
      id: true,
      invoiceNumber: true,
      fileName: true,
      party: { select: { name: true } },
    },
  });

  if (byHash) {
    return {
      reason: 'file_hash',
      existingInvoiceId: byHash.id,
      existingInvoiceNumber: byHash.invoiceNumber,
      partyName: byHash.party?.name ?? null,
      fileName: byHash.fileName,
    };
  }

  // 2. Check invoiceNumber + party (only if both present)
  if (partyId && invoiceNumber) {
    const byNumber = await prisma.invoice.findFirst({
      where: {
        partyId,
        invoiceNumber,
        status: { notIn: EXCLUDED_STATUSES },
      },
      select: {
        id: true,
        invoiceNumber: true,
        fileName: true,
        party: { select: { name: true } },
      },
    });

    if (byNumber) {
      return {
        reason: 'invoice_number',
        existingInvoiceId: byNumber.id,
        existingInvoiceNumber: byNumber.invoiceNumber,
        partyName: byNumber.party?.name ?? null,
        fileName: byNumber.fileName,
      };
    }
  }

  return null;
}

// ============================================
// NEAR-DUPLICATE CHECK (soft warning)
// ============================================

const AMOUNT_TOLERANCE = 10; // ±₹10
const DATE_TOLERANCE_DAYS = 7;

/**
 * Find invoices from the same party with similar amount and date.
 * Returns up to 5 near-matches for display.
 */
export async function checkNearDuplicates(
  prisma: PrismaClient,
  partyId?: string,
  totalAmount?: number | null,
  invoiceDate?: Date | null,
): Promise<NearDuplicate[]> {
  if (!partyId || totalAmount == null || !invoiceDate) return [];

  const dateFrom = new Date(invoiceDate);
  dateFrom.setDate(dateFrom.getDate() - DATE_TOLERANCE_DAYS);
  const dateTo = new Date(invoiceDate);
  dateTo.setDate(dateTo.getDate() + DATE_TOLERANCE_DAYS);

  const matches = await prisma.invoice.findMany({
    where: {
      partyId,
      status: { notIn: EXCLUDED_STATUSES },
      totalAmount: {
        gte: totalAmount - AMOUNT_TOLERANCE,
        lte: totalAmount + AMOUNT_TOLERANCE,
      },
      invoiceDate: {
        gte: dateFrom,
        lte: dateTo,
      },
    },
    select: {
      id: true,
      invoiceNumber: true,
      totalAmount: true,
      invoiceDate: true,
      fileName: true,
      party: { select: { name: true } },
    },
    take: 5,
    orderBy: { invoiceDate: 'desc' },
  });

  return matches.map(m => ({
    invoiceId: m.id,
    invoiceNumber: m.invoiceNumber,
    totalAmount: m.totalAmount,
    invoiceDate: m.invoiceDate,
    partyName: m.party?.name ?? null,
    fileName: m.fileName,
  }));
}
