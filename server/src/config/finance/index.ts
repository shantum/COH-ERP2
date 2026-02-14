/**
 * Finance Configuration
 *
 * Chart of accounts, invoice categories, payment methods, and helpers.
 * All financial constants live here — no magic strings in business logic.
 *
 * TO ADD A NEW ACCOUNT:
 * 1. Add entry to CHART_OF_ACCOUNTS
 * 2. Add the code to AccountCode type
 * 3. Run seed script to sync with database
 */

// ============================================
// ACCOUNT TYPES
// ============================================

export const ACCOUNT_TYPES = [
  'asset',
  'liability',
  'income',
  'direct_cost',
  'expense',
  'equity',
] as const;

export type AccountType = (typeof ACCOUNT_TYPES)[number];

// ============================================
// CHART OF ACCOUNTS (~16 accounts)
// ============================================

export interface AccountConfig {
  /** Unique code (stored in DB) */
  code: string;
  /** Display name */
  name: string;
  /** Account type */
  type: AccountType;
  /** Short description */
  description: string;
}

export const CHART_OF_ACCOUNTS: AccountConfig[] = [
  // --- Assets ---
  { code: 'BANK_HDFC', name: 'HDFC Bank Account', type: 'asset', description: 'Main business account' },
  { code: 'BANK_RAZORPAYX', name: 'RazorpayX Account', type: 'asset', description: 'Payout account for vendor payments' },
  { code: 'CASH', name: 'Cash', type: 'asset', description: 'Cash on hand' },
  { code: 'ACCOUNTS_RECEIVABLE', name: 'Money Customers Owe Us', type: 'asset', description: 'Outstanding customer payments' },
  { code: 'FABRIC_INVENTORY', name: 'Fabric Inventory', type: 'asset', description: 'Value of fabric in stock' },
  { code: 'FINISHED_GOODS', name: 'Finished Goods Inventory', type: 'asset', description: 'Value of finished goods in stock' },
  { code: 'GST_INPUT', name: 'GST We Can Claim', type: 'asset', description: 'Input GST credit' },
  { code: 'ADVANCES_GIVEN', name: 'Advances We Gave', type: 'asset', description: 'Advances paid to suppliers/vendors' },

  // --- Liabilities ---
  { code: 'ACCOUNTS_PAYABLE', name: 'Money We Owe Vendors', type: 'liability', description: 'Outstanding vendor/supplier payments' },
  { code: 'GST_OUTPUT', name: 'GST We Owe Government', type: 'liability', description: 'Output GST liability' },
  { code: 'CUSTOMER_ADVANCES', name: 'Customer Advances', type: 'liability', description: 'Prepayments received from customers' },
  { code: 'TDS_PAYABLE', name: 'TDS Payable', type: 'liability', description: 'TDS deducted at source, owed to government' },
  { code: 'LOAN_GETVANTAGE', name: 'GetVantage Loan', type: 'liability', description: 'Revenue-based financing loan from GetVantage' },
  { code: 'CREDIT_CARD', name: 'Credit Card', type: 'liability', description: 'Credit card balance — paid via CRED, charged for Shopify/subscriptions' },

  // --- Income ---
  { code: 'SALES_REVENUE', name: 'Sales Revenue', type: 'income', description: 'Revenue from product sales' },

  // --- Direct Costs ---
  { code: 'COGS', name: 'Cost of Goods Sold', type: 'direct_cost', description: 'Direct cost of products sold' },

  // --- Expenses ---
  { code: 'OPERATING_EXPENSES', name: 'Operating Expenses', type: 'expense', description: 'Rent, salary, marketing, etc.' },
  { code: 'MARKETPLACE_FEES', name: 'Marketplace & Payment Fees', type: 'expense', description: 'Platform commissions, payment gateway fees' },
  { code: 'UNMATCHED_PAYMENTS', name: 'Unmatched Payments (Suspense)', type: 'expense', description: 'Bank payments not yet matched to an invoice' },

  // --- Equity ---
  { code: 'OWNER_CAPITAL', name: 'Owner Capital', type: 'equity', description: 'Capital invested by owners' },
  { code: 'RETAINED_EARNINGS', name: 'Retained Earnings', type: 'equity', description: 'Accumulated profits/losses' },
];

export type AccountCode =
  | 'BANK_HDFC'
  | 'BANK_RAZORPAYX'
  | 'CASH'
  | 'ACCOUNTS_RECEIVABLE'
  | 'FABRIC_INVENTORY'
  | 'FINISHED_GOODS'
  | 'GST_INPUT'
  | 'ADVANCES_GIVEN'
  | 'ACCOUNTS_PAYABLE'
  | 'GST_OUTPUT'
  | 'CUSTOMER_ADVANCES'
  | 'TDS_PAYABLE'
  | 'LOAN_GETVANTAGE'
  | 'CREDIT_CARD'
  | 'SALES_REVENUE'
  | 'COGS'
  | 'OPERATING_EXPENSES'
  | 'MARKETPLACE_FEES'
  | 'UNMATCHED_PAYMENTS'
  | 'OWNER_CAPITAL'
  | 'RETAINED_EARNINGS';

// ============================================
// PARTY CATEGORIES
// ============================================

export const PARTY_CATEGORIES = [
  'fabric',
  'trims',
  'service',
  'rent',
  'marketing',
  'logistics',
  'packaging',
  'statutory',
  'other',
] as const;

export type PartyCategory = (typeof PARTY_CATEGORIES)[number];

const PARTY_CATEGORY_LABELS: Record<PartyCategory, string> = {
  fabric: 'Fabric Supplier',
  trims: 'Trims & Accessories',
  service: 'Service Provider',
  rent: 'Rent / Landlord',
  marketing: 'Marketing & Ads',
  logistics: 'Logistics & Shipping',
  packaging: 'Packaging',
  statutory: 'Government / Statutory',
  other: 'Other',
};

/** Get display label for a party category */
export function getPartyCategoryLabel(category: PartyCategory): string {
  return PARTY_CATEGORY_LABELS[category] ?? category;
}

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
// LEDGER SOURCE TYPES
// ============================================

export const LEDGER_SOURCE_TYPES = [
  'fabric_inward',
  'production_inward',
  'order_shipment',
  'payment_received',
  'invoice_confirmed',
  'invoice_payment_linked',
  'payment_outgoing',
  'hdfc_statement',
  'bank_payout',
  'bank_charge',
  'fabric_consumption',
  'shipment_cogs',
  'return_cogs_reversal',
  'manual',
  'adjustment',
  'cc_charge',
  'bank_import',
  'cc_charge_import',
] as const;

export type LedgerSourceType = (typeof LEDGER_SOURCE_TYPES)[number];

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

/** Look up an account config by its code */
export function getAccountByCode(code: string): AccountConfig | undefined {
  return CHART_OF_ACCOUNTS.find((a) => a.code === code);
}

/**
 * Debit-normal accounts: balance goes UP with debits (assets, expenses, direct costs).
 * Credit-normal accounts: balance goes UP with credits (liabilities, income, equity).
 */
export function isDebitNormal(type: AccountType): boolean {
  return type === 'asset' || type === 'expense' || type === 'direct_cost';
}
