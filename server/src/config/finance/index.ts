/**
 * Finance Configuration
 *
 * TDS sections, thresholds, and helpers.
 * Chart of accounts and party categories live in @coh/shared.
 */

// ============================================
// TDS SECTIONS
// ============================================

export const TDS_SECTIONS = [
  '194C', // Contractor payments
  '194J', // Professional/technical fees
  '194I', // Rent
  '194H', // Commission/brokerage
] as const;

export type TdsSection = (typeof TDS_SECTIONS)[number];

// ============================================
// INVOICE CATEGORIES
// ============================================

export const INVOICE_CATEGORIES = [
  'fabric',
  'trims',
  'service',
  'logistics',
  'rent',
  'salary',
  'marketing',
  'packaging',
  'equipment',
  'marketplace',
  'marketplace_commission',
  'marketplace_promo',
  'software',
  'customer_order',
  'statutory',
  'other',
] as const;

export type InvoiceCategory = (typeof INVOICE_CATEGORIES)[number];

const CATEGORY_LABELS: Record<InvoiceCategory, string> = {
  fabric: 'Fabric',
  trims: 'Trims & Accessories',
  service: 'Service (Print, Wash, etc.)',
  logistics: 'Logistics & Shipping',
  rent: 'Rent',
  salary: 'Salary & Wages',
  marketing: 'Marketing & Ads',
  packaging: 'Packaging',
  equipment: 'Equipment & Tools',
  marketplace: 'Marketplace Fees',
  marketplace_commission: 'Marketplace Commission',
  marketplace_promo: 'Promotional & Banner',
  software: 'Software & Technology',
  customer_order: 'Customer Order',
  statutory: 'Statutory / TDS',
  other: 'Other',
};

// ============================================
// INVOICE STATUSES
// ============================================

export const INVOICE_STATUSES = [
  'draft',
  'confirmed',
  'partially_paid',
  'paid',
  'cancelled',
] as const;

export type InvoiceStatus = (typeof INVOICE_STATUSES)[number];

// ============================================
// INVOICE TYPES
// ============================================

export const INVOICE_TYPES = ['payable', 'receivable'] as const;

export type InvoiceType = (typeof INVOICE_TYPES)[number];

// ============================================
// PAYMENT METHODS
// ============================================

export const PAYMENT_METHODS = [
  'bank_transfer',
  'upi',
  'cash',
  'cheque',
  'card',
  'razorpay',
  'shopflo',
  'cod_remittance',
  'marketplace_payout',
  'adjustment',
  'other',
] as const;

export type PaymentMethod = (typeof PAYMENT_METHODS)[number];

// ============================================
// PAYMENT DIRECTIONS
// ============================================

export const PAYMENT_DIRECTIONS = ['outgoing', 'incoming'] as const;

export type PaymentDirection = (typeof PAYMENT_DIRECTIONS)[number];

// ============================================
// PAYMENT STATUSES
// ============================================

export const PAYMENT_STATUSES = ['draft', 'confirmed', 'cancelled'] as const;

export type PaymentStatus = (typeof PAYMENT_STATUSES)[number];

// ============================================
// BANK IMPORT THRESHOLDS
// ============================================

/** Outgoing payments below this amount skip AP and post directly as expenses */
export const AUTO_CLEAR_AMOUNT_THRESHOLD = 100;

// ============================================
// HELPER FUNCTIONS
// ============================================

/** Get display label for an invoice category */
export function getCategoryLabel(category: InvoiceCategory): string {
  return CATEGORY_LABELS[category] ?? category;
}
