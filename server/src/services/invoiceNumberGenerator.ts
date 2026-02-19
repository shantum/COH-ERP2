/**
 * Invoice Number Generator
 *
 * Generates sequential, gap-free invoice numbers for customer order invoices.
 * Uses atomic UPDATE ... RETURNING on InvoiceSequence table for concurrency safety.
 *
 * Format: COH/25-26/00001
 *
 * Draft invoices have invoiceNumber = null.
 * Number is assigned only on confirmation (payment received).
 */

import type { PrismaClient } from '@prisma/client';
import logger from '../utils/logger.js';

const log = logger.child({ module: 'invoice-number-gen' });

interface SequenceResult {
  currentNumber: number;
  fiscalYear: string;
}

/**
 * Get the fiscal year string for a given date.
 * Indian fiscal year: April 1 → March 31.
 * e.g. Feb 2026 → "25-26", May 2026 → "26-27"
 */
export function getFiscalYear(date: Date = new Date()): string {
  const month = date.getMonth(); // 0-indexed (0=Jan, 3=Apr)
  const year = date.getFullYear();
  const startYear = month >= 3 ? year : year - 1; // Apr-Dec = current year, Jan-Mar = previous year
  const endYear = startYear + 1;
  return `${String(startYear).slice(2)}-${String(endYear).slice(2)}`;
}

/**
 * Atomically assign the next invoice number.
 * Uses UPDATE ... RETURNING for gap-free, concurrency-safe numbering.
 *
 * @param prisma - Prisma client (or transaction client)
 * @param prefix - Invoice prefix (default: 'COH')
 * @returns Formatted invoice number, e.g. "COH/25-26/00001"
 */
export async function assignNextInvoiceNumber(
  prisma: PrismaClient | Parameters<Parameters<PrismaClient['$transaction']>[0]>[0],
  prefix = 'COH',
): Promise<string> {
  const fiscalYear = getFiscalYear();

  // Atomic increment — UPDATE ... RETURNING prevents race conditions
  const result = await (prisma as PrismaClient).$queryRaw<SequenceResult[]>`
    UPDATE "InvoiceSequence"
    SET "currentNumber" = "currentNumber" + 1,
        "fiscalYear" = ${fiscalYear}
    WHERE "prefix" = ${prefix}
    RETURNING "currentNumber", "fiscalYear"
  `;

  if (!result || result.length === 0) {
    log.error({ prefix }, 'InvoiceSequence row not found — was it seeded?');
    throw new Error(`InvoiceSequence not found for prefix "${prefix}". Run the migration to seed it.`);
  }

  const { currentNumber, fiscalYear: fy } = result[0];
  const paddedNumber = String(currentNumber).padStart(5, '0');
  const invoiceNumber = `${prefix}/${fy}/${paddedNumber}`;

  log.info({ invoiceNumber }, 'Assigned invoice number');
  return invoiceNumber;
}
