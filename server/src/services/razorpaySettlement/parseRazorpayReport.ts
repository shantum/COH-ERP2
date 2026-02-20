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
  orderReceipt: string;
  settlementId: string;
  amount: number;    // Gross amount in INR
  fee: number;       // Gateway fee in INR
  tax: number;       // GST on fee in INR
  netAmount: number; // credit column (amount - fee)
  type: string;      // "payment" | "refund"
  method: string;
  settledAt: string;
  cardNetwork: string;
}

export interface SettlementBatch {
  settlementId: string;
  amount: number;    // Settled amount
  settledAt: string;
  utr: string;       // Bank UTR for HDFC matching
}

export interface ParsedRazorpayReport {
  fileHash: string;

  // Totals (from payment rows only)
  grossAmount: number;
  totalFee: number;
  totalTax: number;
  netSettlement: number;

  // Line items (payment/refund rows only)
  lines: RazorpaySettlementLine[];

  // Settlement batches (for bank matching)
  settlements: SettlementBatch[];

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

// ---------------------------------------------------------------------------
// Main parser
// ---------------------------------------------------------------------------

/**
 * Parse a Razorpay "transactions" CSV export.
 *
 * Real format columns:
 *   entity_id, type, debit, credit, amount, currency, fee, tax, on_hold,
 *   settled, created_at, settled_at, settlement_id, description, notes,
 *   payment_id, arn, settlement_utr, order_id, order_receipt, method,
 *   upi_flow, card_network, card_issuer, card_type, dispute_id, additional_utr
 *
 * Key differences from what was assumed:
 *   - Amounts are in INR (not paise)
 *   - entity_id holds the payment/settlement ID (pay_xxx / setl_xxx)
 *   - type includes "settlement" rows (summary of settled batch)
 *   - order_receipt has Shopify receipt/payment session IDs
 *   - notes is a JSON string (not separate columns)
 */
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

  const sampleKeys = Object.keys(records[0]);
  log.debug({ columns: sampleKeys }, 'CSV columns detected');

  // Parse lines — separate payment/refund rows from settlement summary rows
  const lines: RazorpaySettlementLine[] = [];
  const settlements: SettlementBatch[] = [];
  let grossAmount = 0;
  let totalFee = 0;
  let totalTax = 0;
  let paymentCount = 0;
  let refundCount = 0;
  let adjustmentCount = 0;

  for (const row of records) {
    const entityId = (row['entity_id'] ?? '').trim();
    const type = (row['type'] ?? '').trim().toLowerCase();

    // Settlement summary rows — extract UTR for bank matching
    if (type === 'settlement') {
      const utr = (row['settlement_utr'] ?? row['additional_utr'] ?? '').trim();
      settlements.push({
        settlementId: entityId,
        amount: r2(toNum(row['debit'])),  // settlement rows use debit column
        settledAt: (row['settled_at'] ?? '').trim(),
        utr,
      });
      continue;
    }

    // Payment / refund / adjustment rows
    const razorpayOrderId = (row['order_id'] ?? '').trim();
    const orderReceipt = (row['order_receipt'] ?? '').trim();
    const method = (row['method'] ?? '').trim();
    const settledAt = (row['settled_at'] ?? '').trim();
    const settlementId = (row['settlement_id'] ?? '').trim();
    const cardNetwork = (row['card_network'] ?? '').trim();

    // Amounts are already in INR
    const amount = r2(toNum(row['amount']));
    const fee = r2(toNum(row['fee']));
    const tax = r2(toNum(row['tax']));
    const credit = r2(toNum(row['credit']));  // net amount after fees
    const netAmount = credit || r2(amount - fee - tax);

    lines.push({
      paymentId: entityId,  // entity_id = pay_xxx
      razorpayOrderId,
      orderReceipt,
      settlementId,
      amount,
      fee,
      tax,
      netAmount,
      type,
      method,
      settledAt,
      cardNetwork,
    });

    // Accumulate totals
    grossAmount += amount;
    totalFee += fee;
    totalTax += tax;

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
    fileHash,
    grossAmount: r2(grossAmount),
    totalFee: r2(totalFee),
    totalTax: r2(totalTax),
    netSettlement,
    lines,
    settlements,
    paymentCount,
    refundCount,
    adjustmentCount,
  };

  log.info(
    {
      totalLines: lines.length,
      settlementBatches: settlements.length,
      paymentCount,
      refundCount,
      adjustmentCount,
      grossAmount: result.grossAmount,
      totalFee: result.totalFee,
      totalTax: result.totalTax,
      netSettlement: result.netSettlement,
    },
    'Razorpay report parsed successfully'
  );

  return result;
}
