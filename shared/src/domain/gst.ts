/**
 * GST Calculator — Pure Functions
 *
 * Computes GST for order invoices. No DB access.
 * Shared between client (display) and server (invoice generation).
 *
 * Rules:
 * - MRP < ₹1000 → 5% GST
 * - MRP >= ₹1000 → 12% GST
 * - Intra-state (same state as company) → CGST + SGST (50/50 split)
 * - Inter-state (different state) → IGST (full amount)
 * - Company state: Maharashtra (27)
 */

import { GST_THRESHOLD, GST_RATE_BELOW_THRESHOLD, GST_RATE_ABOVE_THRESHOLD } from './constants.js';

// ============================================
// TYPES
// ============================================

export interface GstLineInput {
  /** Amount charged to customer (after discounts) */
  amount: number;
  /** MRP of the product (for GST rate determination) */
  mrp: number;
  /** Quantity */
  qty: number;
  /** HSN code (defaults to '6109') */
  hsnCode?: string;
}

export interface GstLineResult {
  amount: number;
  qty: number;
  hsnCode: string;
  gstRate: number;
  /** GST amount for this line (included in amount for B2C, or added on top) */
  gstAmount: number;
  /** Taxable value (amount excluding GST) */
  taxableValue: number;
}

export type GstType = 'igst' | 'cgst_sgst';

export interface OrderGstResult {
  lines: GstLineResult[];
  /** Sum of all line taxable values */
  subtotal: number;
  /** Total GST amount */
  gstAmount: number;
  /** Weighted average GST rate across lines */
  effectiveGstRate: number;
  /** GST type based on state comparison */
  gstType: GstType;
  /** CGST amount (intra-state only, 0 for inter-state) */
  cgstAmount: number;
  /** SGST amount (intra-state only, 0 for inter-state) */
  sgstAmount: number;
  /** IGST amount (inter-state only, 0 for intra-state) */
  igstAmount: number;
  /** Grand total (subtotal + gstAmount) */
  total: number;
}

// ============================================
// CONSTANTS
// ============================================

const COMPANY_STATE = 'Maharashtra';
const DEFAULT_HSN = '6109';

// ============================================
// CORE FUNCTIONS
// ============================================

/**
 * Get GST rate for a product based on its MRP.
 * Apparel: 5% below ₹1000, 12% at/above ₹1000.
 */
export function getGstRateForMrp(mrp: number): number {
  return mrp >= GST_THRESHOLD ? GST_RATE_ABOVE_THRESHOLD : GST_RATE_BELOW_THRESHOLD;
}

/**
 * Determine GST type based on customer state vs company state.
 * Same state → CGST + SGST (intra-state)
 * Different state → IGST (inter-state)
 */
export function determineGstType(customerState: string | null | undefined): GstType {
  if (!customerState) return 'igst'; // Default to inter-state if unknown
  return normalizeState(customerState) === normalizeState(COMPANY_STATE) ? 'cgst_sgst' : 'igst';
}

/**
 * Compute GST for an order's line items.
 *
 * For B2C (retail) sales, the selling price is inclusive of GST.
 * So we back-calculate the taxable value from the selling price:
 *   taxableValue = amount / (1 + gstRate/100)
 *   gstAmount = amount - taxableValue
 *
 * @param lines - Order line items with amount, MRP, qty
 * @param customerState - Customer's state (from shipping address)
 * @returns Complete GST breakdown
 */
export function computeOrderGst(
  lines: GstLineInput[],
  customerState: string | null | undefined,
): OrderGstResult {
  const gstType = determineGstType(customerState);

  const computedLines: GstLineResult[] = lines.map((line) => {
    const gstRate = getGstRateForMrp(line.mrp);
    // B2C: price is inclusive of GST
    const taxableValue = roundTo2(line.amount / (1 + gstRate / 100));
    const gstAmount = roundTo2(line.amount - taxableValue);

    return {
      amount: line.amount,
      qty: line.qty,
      hsnCode: line.hsnCode || DEFAULT_HSN,
      gstRate,
      gstAmount,
      taxableValue,
    };
  });

  const subtotal = roundTo2(computedLines.reduce((sum, l) => sum + l.taxableValue, 0));
  const gstAmount = roundTo2(computedLines.reduce((sum, l) => sum + l.gstAmount, 0));
  const total = roundTo2(subtotal + gstAmount);

  // Effective rate (weighted average)
  const effectiveGstRate = subtotal > 0 ? roundTo2((gstAmount / subtotal) * 100) : 0;

  // Split by GST type
  const cgstAmount = gstType === 'cgst_sgst' ? roundTo2(gstAmount / 2) : 0;
  const sgstAmount = gstType === 'cgst_sgst' ? roundTo2(gstAmount - cgstAmount) : 0; // Remainder to avoid rounding mismatch
  const igstAmount = gstType === 'igst' ? gstAmount : 0;

  return {
    lines: computedLines,
    subtotal,
    gstAmount,
    effectiveGstRate,
    gstType,
    cgstAmount,
    sgstAmount,
    igstAmount,
    total,
  };
}

// ============================================
// HELPERS
// ============================================

function roundTo2(n: number): number {
  return Math.round(n * 100) / 100;
}

function normalizeState(state: string): string {
  return state.trim().toLowerCase();
}
