/**
 * Invoice Validator Service
 *
 * Validates parsed invoice data against our company details.
 * Returns warnings (not blockers) shown in the upload preview.
 *
 * Checks:
 * 1. Company name — buyer on the invoice matches Cream on Hudson
 * 2. GST number — buyer GSTIN matches our company GSTIN
 * 3. GST calculation — math is correct + correct GST type (IGST vs CGST/SGST)
 */

import { COMPANY_GST } from '../config/finance/gst.js';
import type { ParsedInvoice } from './invoiceParser.js';

// ============================================
// TYPES
// ============================================

export interface InvoiceValidationWarning {
  type: 'company_name' | 'gst_number' | 'gst_calculation';
  severity: 'error' | 'warning';
  message: string;
  details?: string;
}

// ============================================
// COMPANY NAME CHECK
// ============================================

/** Check if buyer name matches "Canoe Design Pvt Ltd" */
function checkCompanyName(parsed: ParsedInvoice): InvoiceValidationWarning[] {
  const warnings: InvoiceValidationWarning[] = [];
  const buyerName = parsed.buyerName?.trim();

  if (!buyerName) {
    warnings.push({
      type: 'company_name',
      severity: 'warning',
      message: 'Buyer name not found on invoice',
      details: 'Could not identify our company as the buyer/recipient.',
    });
    return warnings;
  }

  const lower = buyerName.toLowerCase();
  const matches = lower.includes('canoe') && lower.includes('design');

  if (!matches) {
    warnings.push({
      type: 'company_name',
      severity: 'error',
      message: "Invoice buyer name doesn't match our company",
      details: `Found: "${buyerName}". Expected: "Canoe Design Pvt Ltd".`,
    });
  }

  return warnings;
}

// ============================================
// GST NUMBER CHECK
// ============================================

/** Check if buyer GSTIN matches our company GSTIN */
function checkGstNumber(parsed: ParsedInvoice): InvoiceValidationWarning[] {
  const warnings: InvoiceValidationWarning[] = [];

  // Skip if our GSTIN is not configured
  if (!COMPANY_GST.gstin) return warnings;

  // Only check if this appears to be a GST invoice
  const hasGst = (parsed.gstAmount != null && parsed.gstAmount > 0) ||
    (parsed.lines ?? []).some(l => l.gstPercent != null && l.gstPercent > 0);
  if (!hasGst) return warnings;

  const buyerGstin = parsed.buyerGstin?.trim();

  if (!buyerGstin) {
    warnings.push({
      type: 'gst_number',
      severity: 'warning',
      message: 'Buyer GSTIN not found on invoice',
      details: 'This appears to be a GST invoice but the buyer GSTIN was not detected.',
    });
    return warnings;
  }

  if (buyerGstin.toUpperCase() !== COMPANY_GST.gstin.toUpperCase()) {
    warnings.push({
      type: 'gst_number',
      severity: 'error',
      message: "Buyer GSTIN doesn't match our company GSTIN",
      details: `Invoice: ${buyerGstin} | Ours: ${COMPANY_GST.gstin}`,
    });
  }

  return warnings;
}

// ============================================
// GST CALCULATION CHECK
// ============================================

const MATH_TOLERANCE = 1; // Rs 1 tolerance for rounding

/** Check GST math and GST type (IGST vs CGST/SGST) */
function checkGstCalculation(parsed: ParsedInvoice): InvoiceValidationWarning[] {
  const warnings: InvoiceValidationWarning[] = [];

  // --- Math check: subtotal + gstAmount ~ totalAmount ---
  if (
    parsed.subtotal != null &&
    parsed.gstAmount != null &&
    parsed.totalAmount != null
  ) {
    const expected = parsed.subtotal + parsed.gstAmount;
    const diff = Math.abs(expected - parsed.totalAmount);
    if (diff > MATH_TOLERANCE) {
      warnings.push({
        type: 'gst_calculation',
        severity: 'warning',
        message: 'Invoice totals do not add up',
        details: `Subtotal (${parsed.subtotal}) + GST (${parsed.gstAmount}) = ${expected}, but total is ${parsed.totalAmount} (off by Rs ${diff.toFixed(2)}).`,
      });
    }
  }

  // --- Line-level math check ---
  for (const line of parsed.lines ?? []) {
    if (
      line.amount != null &&
      line.gstPercent != null &&
      line.gstPercent > 0 &&
      line.gstAmount != null
    ) {
      const expectedGst = line.amount * line.gstPercent / 100;
      const diff = Math.abs(expectedGst - line.gstAmount);
      if (diff > MATH_TOLERANCE) {
        const desc = line.description
          ? `"${line.description.slice(0, 40)}"`
          : 'a line item';
        warnings.push({
          type: 'gst_calculation',
          severity: 'warning',
          message: `GST mismatch on ${desc}`,
          details: `Amount ${line.amount} x ${line.gstPercent}% = ${expectedGst.toFixed(2)}, but GST shown is ${line.gstAmount}.`,
        });
      }
    }
  }

  // --- CGST/SGST/IGST split consistency ---
  if (parsed.cgstAmount != null && parsed.sgstAmount != null && parsed.gstAmount != null) {
    const splitSum = parsed.cgstAmount + parsed.sgstAmount;
    const splitDiff = Math.abs(splitSum - parsed.gstAmount);
    if (splitDiff > MATH_TOLERANCE) {
      warnings.push({
        type: 'gst_calculation',
        severity: 'warning',
        message: 'CGST + SGST does not match total GST',
        details: `CGST (${parsed.cgstAmount}) + SGST (${parsed.sgstAmount}) = ${splitSum}, but total GST is ${parsed.gstAmount} (off by Rs ${splitDiff.toFixed(2)}).`,
      });
    }
  }

  if (parsed.igstAmount != null && parsed.gstAmount != null) {
    const igstDiff = Math.abs(parsed.igstAmount - parsed.gstAmount);
    if (igstDiff > MATH_TOLERANCE) {
      warnings.push({
        type: 'gst_calculation',
        severity: 'warning',
        message: 'IGST does not match total GST',
        details: `IGST (${parsed.igstAmount}) but total GST is ${parsed.gstAmount} (off by Rs ${igstDiff.toFixed(2)}).`,
      });
    }
  }

  // --- GST type vs split field mismatch ---
  if (parsed.gstType === 'cgst_sgst' && parsed.igstAmount != null && parsed.igstAmount > 0 && parsed.cgstAmount == null) {
    warnings.push({
      type: 'gst_calculation',
      severity: 'warning',
      message: 'GST type is CGST/SGST but only IGST amount found',
      details: `Invoice shows CGST/SGST type but has IGST amount of ${parsed.igstAmount} with no CGST/SGST amounts.`,
    });
  }

  if (parsed.gstType === 'igst' && parsed.cgstAmount != null && parsed.cgstAmount > 0 && parsed.igstAmount == null) {
    warnings.push({
      type: 'gst_calculation',
      severity: 'warning',
      message: 'GST type is IGST but CGST/SGST amounts found',
      details: `Invoice shows IGST type but has CGST amount of ${parsed.cgstAmount} with no IGST amount.`,
    });
  }

  // --- GST type check (IGST vs CGST/SGST based on state codes) ---
  const supplierState = parsed.supplierStateCode?.trim();
  const gstType = parsed.gstType;

  // Only check if we have both pieces of info
  if (supplierState && gstType) {
    const ourStateCode = COMPANY_GST.stateCode; // '27' = Maharashtra
    const isSameState = supplierState === ourStateCode;
    const expectedType = isSameState ? 'cgst_sgst' : 'igst';

    if (gstType !== expectedType) {
      const expectedLabel = expectedType === 'igst' ? 'IGST (inter-state)' : 'CGST/SGST (intra-state)';
      const actualLabel = gstType === 'igst' ? 'IGST (inter-state)' : 'CGST/SGST (intra-state)';
      warnings.push({
        type: 'gst_calculation',
        severity: 'warning',
        message: 'GST type may be incorrect',
        details: `Supplier state: ${supplierState}, our state: ${ourStateCode}. Expected ${expectedLabel}, but invoice shows ${actualLabel}.`,
      });
    }
  }

  return warnings;
}

// ============================================
// MAIN VALIDATOR
// ============================================

/**
 * Validate a parsed invoice and return warnings.
 * Pure function — no DB access.
 */
export function validateInvoice(parsed: ParsedInvoice): InvoiceValidationWarning[] {
  return [
    ...checkCompanyName(parsed),
    ...checkGstNumber(parsed),
    ...checkGstCalculation(parsed),
  ];
}
