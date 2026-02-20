import { parse } from 'csv-parse/sync';
import crypto from 'crypto';
import logger from '../../utils/logger.js';

const log = logger.child({ module: 'parseRazorpayReport' });

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface RazorpaySettlementLine {
  paymentId: string;
  razorpayOrderId: string;
  orderNumber: string;
  amount: number;    // In INR (divided by 100 from paise)
  fee: number;       // In INR
  tax: number;       // In INR
  netAmount: number; // amount - fee - tax
  type: string;      // "payment" | "refund" | "adjustment"
  method: string;
  settledAt: string;
}

export interface ParsedRazorpayReport {
  settlementId: string;
  fileHash: string;

  // Totals
  grossAmount: number;
  totalFee: number;
  totalTax: number;
  netSettlement: number;

  // Line items
  lines: RazorpaySettlementLine[];

  // Counts
  paymentCount: number;
  refundCount: number;
  adjustmentCount: number;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Round to 2 decimal places. */
function r2(n: number): number {
  return Math.round(n * 100) / 100;
}

/** Convert paise to INR (divide by 100) and round. */
function paiseToInr(paise: number): number {
  return r2(paise / 100);
}

/** Safely coerce a value to number, returning 0 for blanks/non-numeric. */
function toNum(val: string | undefined): number {
  if (val === null || val === undefined || val === '') return 0;
  const n = Number(val);
  return Number.isFinite(n) ? n : 0;
}

/** Strip BOM from CSV content. */
function stripBom(content: string): string {
  if (content.charCodeAt(0) === 0xfeff) {
    return content.slice(1);
  }
  return content;
}

/**
 * Try to extract an order number from the description field.
 * Common patterns: "Order #COH-12345", "COH-12345", etc.
 */
function extractOrderFromDescription(description: string): string {
  if (!description) return '';
  // Look for COH-style order numbers
  const match = description.match(/\b(COH-\d+)\b/i);
  return match ? match[1] : '';
}

// ---------------------------------------------------------------------------
// Main parser
// ---------------------------------------------------------------------------

export function parseRazorpayReport(csvContent: string): ParsedRazorpayReport {
  const fileHash = crypto.createHash('sha256').update(csvContent).digest('hex');
  const cleaned = stripBom(csvContent);

  log.info({ fileHash, contentLength: csvContent.length }, 'Starting Razorpay report parse');

  const records: Record<string, string>[] = parse(cleaned, {
    columns: true,
    skip_empty_lines: true,
    trim: true,
    relax_column_count: true,
  });

  if (records.length === 0) {
    throw new Error('CSV file is empty or has no data rows');
  }

  // Detect the order number column — could be "notes[order_number]" or "notes.order_number"
  const sampleKeys = Object.keys(records[0]);
  const notesOrderKey = sampleKeys.find(
    (k) => k.toLowerCase() === 'notes[order_number]' || k.toLowerCase() === 'notes.order_number'
  );

  if (notesOrderKey) {
    log.debug({ notesOrderKey }, 'Found order number column');
  } else {
    log.warn({ columns: sampleKeys }, 'No notes[order_number] column found — will try description fallback');
  }

  // Detect settlement ID — use the first non-empty one
  let settlementId = '';
  const settlementIds = new Set<string>();
  for (const row of records) {
    const sid = (row['settlement_id'] ?? '').trim();
    if (sid) {
      settlementIds.add(sid);
      if (!settlementId) settlementId = sid;
    }
  }

  if (settlementIds.size > 1) {
    log.warn(
      { settlementIds: Array.from(settlementIds), using: settlementId },
      'Multiple settlement IDs found — using the first one'
    );
  }

  if (!settlementId) {
    settlementId = `unknown_${fileHash.slice(0, 8)}`;
    log.warn('No settlement_id found in CSV — using hash-based fallback');
  }

  // Parse lines
  const lines: RazorpaySettlementLine[] = [];
  let grossAmount = 0;
  let totalFee = 0;
  let totalTax = 0;
  let paymentCount = 0;
  let refundCount = 0;
  let adjustmentCount = 0;

  for (const row of records) {
    const paymentId = (row['payment_id'] ?? '').trim();
    const razorpayOrderId = (row['order_id'] ?? '').trim();
    const type = (row['type'] ?? '').trim().toLowerCase();
    const method = (row['method'] ?? '').trim();
    const settledAt = (row['settled_at'] ?? '').trim();
    const description = (row['description'] ?? '').trim();

    // Amount fields are in paise
    const amountPaise = toNum(row['amount']);
    const feePaise = toNum(row['fee']);
    const taxPaise = toNum(row['tax']);

    const amount = paiseToInr(amountPaise);
    const fee = paiseToInr(feePaise);
    const tax = paiseToInr(taxPaise);
    const netAmount = r2(amount - fee - tax);

    // Extract order number from notes or description
    let orderNumber = '';
    if (notesOrderKey) {
      orderNumber = (row[notesOrderKey] ?? '').trim();
    }
    if (!orderNumber) {
      orderNumber = extractOrderFromDescription(description);
    }

    lines.push({
      paymentId,
      razorpayOrderId,
      orderNumber,
      amount,
      fee,
      tax,
      netAmount,
      type,
      method,
      settledAt,
    });

    // Accumulate totals
    grossAmount += amount;
    totalFee += fee;
    totalTax += tax;

    // Count by type
    if (type === 'payment') {
      paymentCount++;
    } else if (type === 'refund') {
      refundCount++;
    } else {
      adjustmentCount++;
    }
  }

  const netSettlement = r2(grossAmount - totalFee - totalTax);

  const result: ParsedRazorpayReport = {
    settlementId,
    fileHash,

    grossAmount: r2(grossAmount),
    totalFee: r2(totalFee),
    totalTax: r2(totalTax),
    netSettlement,

    lines,

    paymentCount,
    refundCount,
    adjustmentCount,
  };

  log.info(
    {
      settlementId,
      totalLines: lines.length,
      paymentCount,
      refundCount,
      adjustmentCount,
      grossAmount: result.grossAmount,
      netSettlement: result.netSettlement,
    },
    'Razorpay report parsed successfully'
  );

  return result;
}
