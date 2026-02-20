/**
 * Finance Zod Schemas
 *
 * Validation schemas for invoices, payments, ledger entries, and search params.
 */

import { z } from 'zod';

// ============================================
// SEARCH PARAMS (URL state)
// ============================================

export const FinanceSearchParams = z.object({
  /** Active tab */
  tab: z.enum(['dashboard', 'invoices', 'payments', 'pnl', 'cashflow', 'bank-import', 'marketplace', 'parties', 'transaction-types']).catch('dashboard'),
  /** Bank import: bank filter */
  bankFilter: z.enum(['all', 'hdfc', 'razorpayx', 'hdfc_cc', 'icici_cc']).optional().catch(undefined),
  /** Bank import: status filter (simplified) */
  bankStatus: z.enum(['all', 'pending', 'confirmed', 'skipped']).optional().catch(undefined),
  /** Bank import: sub-view */
  bankView: z.enum(['list', 'import']).optional().catch(undefined),
  /** Invoice type filter */
  type: z.enum(['payable', 'receivable']).optional().catch(undefined),
  /** Invoice status filter */
  status: z.string().optional().catch(undefined),
  /** Invoice category filter */
  category: z.string().optional().catch(undefined),
  /** Payment direction filter (bank perspective: debit = money out, credit = money in) */
  direction: z.enum(['debit', 'credit']).optional().catch(undefined),
  /** Payment bank filter */
  bank: z.string().optional().catch(undefined),
  /** Payment match status filter */
  matchStatus: z.enum(['all', 'unmatched', 'matched']).optional().catch(undefined),
  /** Payment category filter (party or bank txn category) */
  paymentCategory: z.string().optional().catch(undefined),
  /** Parties tab: filter by TransactionType ID */
  partyTxnType: z.string().optional().catch(undefined),
  /** Search query */
  search: z.string().optional().catch(undefined),
  /** Page number */
  page: z.coerce.number().int().positive().catch(1),
  /** Items per page */
  limit: z.coerce.number().int().positive().max(200).catch(50),
  /** Modal state */
  modal: z.enum(['create-invoice', 'view-invoice']).optional().catch(undefined),
  /** Record ID for modals */
  modalId: z.string().optional().catch(undefined),
  /** Date range filter — from */
  dateFrom: z.string().optional().catch(undefined),
  /** Date range filter — to */
  dateTo: z.string().optional().catch(undefined),
  /** Invoice sort column */
  sortBy: z.enum(['createdAt', 'invoiceDate', 'billingPeriod', 'dueDate']).optional().catch(undefined),
  /** Sort direction */
  sortDir: z.enum(['asc', 'desc']).optional().catch(undefined),
});
export type FinanceSearchParams = z.infer<typeof FinanceSearchParams>;

// ============================================
// INVOICE SCHEMAS
// ============================================

export const CreateInvoiceLineSchema = z.object({
  description: z.string().optional(),
  hsnCode: z.string().optional(),
  qty: z.number().positive().optional(),
  unit: z.string().optional(),
  rate: z.number().optional(),
  amount: z.number().optional(),
  gstPercent: z.number().min(0).max(100).optional(),
  gstAmount: z.number().optional(),
  // Fabric matching (only for category='fabric' invoices)
  fabricColourId: z.string().uuid().optional(),
  matchedTxnId: z.string().uuid().optional(),
  matchType: z.enum(['auto_matched', 'manual_matched', 'new_entry']).optional(),
});

export const CreateInvoiceSchema = z.object({
  invoiceNumber: z.string().optional(),
  type: z.enum(['payable', 'receivable']),
  category: z.string(),
  invoiceDate: z.string().optional(),
  dueDate: z.string().optional(),
  billingPeriod: z.string().regex(/^\d{4}-\d{2}$/).optional(),
  partyId: z.string().uuid().optional(),
  customerId: z.string().uuid().optional(),
  subtotal: z.number().optional(),
  gstRate: z.number().min(0).max(100).optional(),
  gstAmount: z.number().optional(),
  totalAmount: z.number().positive(),
  orderId: z.string().uuid().optional(),
  notes: z.string().optional(),
  lines: z.array(CreateInvoiceLineSchema).optional(),
});
export type CreateInvoiceInput = z.infer<typeof CreateInvoiceSchema>;

export const UpdateInvoiceSchema = z.object({
  id: z.string().uuid(),
  invoiceNumber: z.string().optional(),
  category: z.string().optional(),
  invoiceDate: z.string().optional(),
  dueDate: z.string().optional(),
  billingPeriod: z.string().regex(/^\d{4}-\d{2}$/).nullable().optional(),
  partyId: z.string().uuid().nullable().optional(),
  customerId: z.string().uuid().nullable().optional(),
  subtotal: z.number().nullable().optional(),
  gstRate: z.number().min(0).max(100).nullable().optional(),
  gstAmount: z.number().nullable().optional(),
  totalAmount: z.number().positive().optional(),
  notes: z.string().nullable().optional(),
});
export type UpdateInvoiceInput = z.infer<typeof UpdateInvoiceSchema>;

// ============================================
// BANK TRANSACTION-INVOICE MATCHING
// ============================================

export const MatchAllocationSchema = z.object({
  bankTransactionId: z.string().uuid(),
  invoiceId: z.string().uuid(),
  amount: z.number().positive(),
  notes: z.string().optional(),
});
export type MatchAllocationInput = z.infer<typeof MatchAllocationSchema>;

// ============================================
// LIST QUERY PARAMS (server function inputs)
// ============================================

export const ListInvoicesInput = z.object({
  type: z.enum(['payable', 'receivable']).optional(),
  status: z.string().optional(),
  category: z.string().optional(),
  search: z.string().optional(),
  dateFrom: z.string().optional(),
  dateTo: z.string().optional(),
  sortBy: z.enum(['createdAt', 'invoiceDate', 'billingPeriod', 'dueDate']).optional(),
  sortDir: z.enum(['asc', 'desc']).optional(),
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().positive().max(200).default(50),
}).optional();

export const ListPaymentsInput = z.object({
  direction: z.enum(['debit', 'credit']).optional(),
  bank: z.string().optional(),
  matchStatus: z.enum(['all', 'unmatched', 'matched']).optional(),
  paymentCategory: z.string().optional(),
  search: z.string().optional(),
  dateFrom: z.string().optional(),
  dateTo: z.string().optional(),
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().positive().max(200).default(50),
}).optional();

/** Payment category filters with user-friendly labels */
export const PAYMENT_CATEGORY_FILTERS = [
  { code: 'fabric', label: 'Fabric' },
  { code: 'trims', label: 'Trims' },
  { code: 'service', label: 'Services' },
  { code: 'logistics', label: 'Logistics' },
  { code: 'packaging', label: 'Packaging' },
  { code: 'marketing', label: 'Marketing' },
  { code: 'rent', label: 'Rent' },
  { code: 'salary', label: 'Salary & Payroll' },
  { code: 'software', label: 'Software' },
  { code: 'statutory', label: 'Statutory & Fees' },
  { code: 'refund', label: 'Customer Refunds' },
  { code: 'inter_account', label: 'Inter-account' },
  { code: 'other', label: 'Other' },
] as const;

// ============================================
// DISPLAY CONSTANTS (shared between client + server)
// ============================================

export const PARTY_CATEGORIES = [
  'fabric', 'trims', 'service', 'rent', 'marketing',
  'logistics', 'packaging', 'salary', 'statutory', 'software', 'refund', 'other',
] as const;

export type PartyCategory = (typeof PARTY_CATEGORIES)[number];

export const INVOICE_CATEGORIES = [
  'fabric', 'trims', 'service', 'logistics', 'rent', 'salary',
  'marketing', 'packaging', 'equipment', 'marketplace', 'marketplace_commission', 'marketplace_promo',
  'software', 'customer_order', 'statutory', 'other',
] as const;

export type InvoiceCategory = (typeof INVOICE_CATEGORIES)[number];

const CATEGORY_LABELS: Record<string, string> = {
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
  refund: 'Refund',
  other: 'Other',
};

export function getCategoryLabel(category: string): string {
  return CATEGORY_LABELS[category] ?? category;
}

/**
 * Generate a narration for a payment based on available context.
 * e.g. "Being amount paid for Rent to CMM for 2026-01"
 */
export function generatePaymentNarration(opts: {
  partyName?: string | null;
  category?: string | null;
  invoiceNumber?: string | null;
  billingPeriod?: string | null;
}): string {
  const parts: string[] = ['Being amount paid'];

  if (opts.category) {
    parts.push(`for ${getCategoryLabel(opts.category)}`);
  }

  if (opts.partyName) {
    parts.push(`to ${opts.partyName}`);
  }

  if (opts.invoiceNumber) {
    parts.push(`against invoice ${opts.invoiceNumber}`);
  }

  if (opts.billingPeriod) {
    parts.push(`for ${opts.billingPeriod}`);
  }

  return parts.join(' ');
}

export const INVOICE_STATUSES = ['draft', 'confirmed', 'partially_paid', 'paid', 'cancelled'] as const;

export const PAYMENT_METHODS = [
  'bank_transfer', 'upi', 'cash', 'cheque', 'card', 'razorpay',
  'shopflo', 'cod_remittance', 'marketplace_payout', 'adjustment', 'other',
] as const;

// ============================================
// BANK IMPORT
// ============================================

export const BANK_TYPES = ['hdfc', 'razorpayx', 'hdfc_cc', 'icici_cc'] as const;
export type BankType = (typeof BANK_TYPES)[number];

export const BANK_TXN_STATUSES = ['imported', 'categorized', 'posted', 'skipped', 'legacy_posted'] as const;
export type BankTxnStatus = (typeof BANK_TXN_STATUSES)[number];

/** Simplified filter options for the UI (display only — no DB migration) */
export const BANK_TXN_FILTER_OPTIONS = ['pending', 'confirmed', 'skipped'] as const;
export type BankTxnFilterOption = (typeof BANK_TXN_FILTER_OPTIONS)[number];

/** Maps UI filter values to DB status values */
export const BANK_STATUS_FILTER_MAP: Record<BankTxnFilterOption, BankTxnStatus[]> = {
  pending: ['imported', 'categorized'],
  confirmed: ['posted', 'legacy_posted'],
  skipped: ['skipped'],
};

/** Maps DB status to display label */
export function getBankStatusLabel(status: string): string {
  if (status === 'imported' || status === 'categorized') return 'Pending';
  if (status === 'posted' || status === 'legacy_posted') return 'Confirmed';
  if (status === 'skipped') return 'Skipped';
  return status;
}

/** Check if a DB status is "pending" (editable/confirmable) */
export function isBankTxnPending(status: string): boolean {
  return status === 'imported' || status === 'categorized';
}

const BANK_LABELS: Record<string, string> = {
  hdfc: 'HDFC Bank',
  razorpayx: 'RazorpayX',
  hdfc_cc: 'HDFC CC',
  icici_cc: 'ICICI CC',
};

export function getBankLabel(bank: string): string {
  return BANK_LABELS[bank] ?? bank;
}

export const ListBankTransactionsInput = z.object({
  bank: z.string().optional(),
  status: z.string().optional(),
  batchId: z.string().optional(),
  search: z.string().optional(),
  dateFrom: z.string().optional(),
  dateTo: z.string().optional(),
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().positive().max(200).default(50),
}).optional();

// ============================================
// TRANSACTION TYPE SCHEMAS
// ============================================

export const ListPartiesInput = z.object({
  transactionTypeId: z.string().optional(),
  search: z.string().optional(),
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().positive().max(200).default(200),
}).optional();

export const UpdatePartySchema = z.object({
  id: z.string().uuid(),
  name: z.string().min(1).optional(),
  category: z.string().optional(),
  transactionTypeId: z.string().uuid().nullable().optional(),
  aliases: z.array(z.string()).optional(),
  tdsApplicable: z.boolean().optional(),
  tdsSection: z.string().nullable().optional(),
  tdsRate: z.number().nullable().optional(),
  invoiceRequired: z.boolean().optional(),
  paymentTermsDays: z.number().int().nullable().optional(),
  billingPeriodOffsetMonths: z.number().int().nullable().optional(),
  contactName: z.string().nullable().optional(),
  email: z.string().nullable().optional(),
  phone: z.string().nullable().optional(),
  gstin: z.string().nullable().optional(),
  pan: z.string().nullable().optional(),
  isActive: z.boolean().optional(),
});
export type UpdatePartyInput = z.infer<typeof UpdatePartySchema>;

export const CreatePartySchema = z.object({
  name: z.string().min(1),
  category: z.string(),
  transactionTypeId: z.string().uuid().optional(),
  aliases: z.array(z.string()).optional(),
  tdsApplicable: z.boolean().optional(),
  tdsSection: z.string().nullable().optional(),
  tdsRate: z.number().nullable().optional(),
  invoiceRequired: z.boolean().optional(),
  paymentTermsDays: z.number().int().nullable().optional(),
  billingPeriodOffsetMonths: z.number().int().nullable().optional(),
  contactName: z.string().nullable().optional(),
  email: z.string().nullable().optional(),
  phone: z.string().nullable().optional(),
  gstin: z.string().nullable().optional(),
  pan: z.string().nullable().optional(),
});
export type CreatePartyInput = z.infer<typeof CreatePartySchema>;

// ============================================
// TRANSACTION TYPE CRUD SCHEMAS
// ============================================

export const CreateTransactionTypeSchema = z.object({
  name: z.string().min(1),
  description: z.string().nullable().optional(),
  debitAccountCode: z.string().nullable().optional(),
  creditAccountCode: z.string().nullable().optional(),
  defaultGstRate: z.number().min(0).max(100).nullable().optional(),
  defaultTdsApplicable: z.boolean().optional(),
  defaultTdsSection: z.string().nullable().optional(),
  defaultTdsRate: z.number().nullable().optional(),
  invoiceRequired: z.boolean().optional(),
  expenseCategory: z.string().nullable().optional(),
});
export type CreateTransactionTypeInput = z.infer<typeof CreateTransactionTypeSchema>;

export const UpdateTransactionTypeSchema = z.object({
  id: z.string().uuid(),
  name: z.string().min(1).optional(),
  description: z.string().nullable().optional(),
  debitAccountCode: z.string().nullable().optional(),
  creditAccountCode: z.string().nullable().optional(),
  defaultGstRate: z.number().min(0).max(100).nullable().optional(),
  defaultTdsApplicable: z.boolean().optional(),
  defaultTdsSection: z.string().nullable().optional(),
  defaultTdsRate: z.number().nullable().optional(),
  invoiceRequired: z.boolean().optional(),
  expenseCategory: z.string().nullable().optional(),
  isActive: z.boolean().optional(),
});
export type UpdateTransactionTypeInput = z.infer<typeof UpdateTransactionTypeSchema>;

// ============================================
// BANK TRANSACTION PARTY ASSIGNMENT
// ============================================

export const AssignBankTxnPartySchema = z.object({
  txnId: z.string().uuid(),
  partyId: z.string().uuid(),
});
export type AssignBankTxnPartyInput = z.infer<typeof AssignBankTxnPartySchema>;

/** Upload/preview bank CSV — bank must be hdfc or razorpayx */
export const BankImportUploadSchema = z.object({
  bank: z.enum(['hdfc', 'razorpayx']),
});

/** Post pending transactions — bank is optional filter */
export const BankImportPostSchema = z.object({
  bank: z.string().optional(),
});

/** Confirm a single bank transaction */
export const BankImportConfirmSchema = z.object({
  txnId: z.string().uuid(),
});

/** Confirm multiple bank transactions */
export const BankImportConfirmBatchSchema = z.object({
  txnIds: z.array(z.string().uuid()).min(1),
});

/** Skip multiple bank transactions */
export const BankImportSkipBatchSchema = z.object({
  txnIds: z.array(z.string().uuid()).min(1),
  reason: z.string().optional(),
});

/** Update bank transaction fields */
export const BankImportUpdateSchema = z.object({
  txnId: z.string().uuid(),
  partyId: z.string().uuid().nullable().optional(),
  debitAccountCode: z.string().optional(),
  creditAccountCode: z.string().optional(),
  category: z.string().nullable().optional(),
});

/** Skip a single bank transaction */
export const BankImportSkipSchema = z.object({
  txnId: z.string().uuid(),
  reason: z.string().optional(),
});

/** Unskip a bank transaction */
export const BankImportUnskipSchema = z.object({
  txnId: z.string().uuid(),
});

/** Delete bank transaction by ID (from URL param) */
export const BankImportDeleteParamSchema = z.object({
  id: z.string().uuid(),
});

// ============================================
// CHART OF ACCOUNTS
// ============================================

// ============================================
// AUTO-MATCH PAYMENTS
// ============================================

export const ApplyAutoMatchesSchema = z.object({
  matches: z.array(z.object({
    bankTransactionId: z.string().uuid(),
    invoiceId: z.string().uuid(),
    amount: z.number().positive(),
  })),
});
export type ApplyAutoMatchesInput = z.infer<typeof ApplyAutoMatchesSchema>;

// ============================================
// CHART OF ACCOUNTS
// ============================================

/**
 * TO ADD A NEW ACCOUNT:
 * 1. Add entry to CHART_OF_ACCOUNTS
 * 2. Run seed script to sync with database
 */
export const CHART_OF_ACCOUNTS = [
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
  { code: 'CREDIT_CARD', name: 'Credit Card', type: 'liability', description: 'Credit card balance — paid via CRED' },
  // --- Income ---
  { code: 'SALES_REVENUE', name: 'Sales Revenue', type: 'income', description: 'Revenue from product sales' },
  // --- Direct Costs ---
  { code: 'COGS', name: 'Cost of Goods Sold', type: 'direct_cost', description: 'Direct cost of products sold' },
  // --- Expenses ---
  { code: 'OPERATING_EXPENSES', name: 'Operating Expenses', type: 'expense', description: 'Rent, salary, marketing, etc.' },
  { code: 'MARKETPLACE_FEES', name: 'Marketplace & Payment Fees', type: 'expense', description: 'Platform commissions, payment gateway fees' },
  { code: 'SOFTWARE_TECHNOLOGY', name: 'Software & Technology', type: 'expense', description: 'Shopify, SaaS subscriptions, tech tools' },
  { code: 'UNMATCHED_PAYMENTS', name: 'Unmatched Payments (Suspense)', type: 'expense', description: 'Bank payments not yet matched to an invoice' },
  // --- Equity ---
  { code: 'OWNER_CAPITAL', name: 'Owner Capital', type: 'equity', description: 'Capital invested by owners' },
  { code: 'RETAINED_EARNINGS', name: 'Retained Earnings', type: 'equity', description: 'Accumulated profits/losses' },
] as const;

export type AccountCode = (typeof CHART_OF_ACCOUNTS)[number]['code'];

// ============================================
// ACCOUNT REPORT NAMES (for P&L / cash flow display)
// ============================================

/**
 * Overrides for account display names in financial reports.
 * CHART_OF_ACCOUNTS has business-friendly names (e.g. "Money Customers Owe Us");
 * reports use standard accounting names (e.g. "Accounts Receivable").
 * Only accounts that differ need an entry here.
 */
const ACCOUNT_REPORT_NAME_OVERRIDES: Partial<Record<AccountCode, string>> = {
  ACCOUNTS_RECEIVABLE: 'Accounts Receivable',
  ACCOUNTS_PAYABLE: 'Accounts Payable',
  GST_INPUT: 'GST Input',
  GST_OUTPUT: 'GST Output',
  ADVANCES_GIVEN: 'Advances Given',
  FINISHED_GOODS: 'Finished Goods',
  UNMATCHED_PAYMENTS: 'Unmatched Payments',
  LOAN_GETVANTAGE: 'Loan (GetVantage)',
};

/** Lookup map built once from CHART_OF_ACCOUNTS + overrides */
const _accountReportNameMap: Record<string, string> = {};
for (const acct of CHART_OF_ACCOUNTS) {
  _accountReportNameMap[acct.code] = ACCOUNT_REPORT_NAME_OVERRIDES[acct.code as AccountCode] ?? acct.name;
}

/** Get the report-friendly display name for an account code. Falls back to title-casing. */
export function getAccountReportName(code: string): string {
  return _accountReportNameMap[code] ?? code.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}

// ============================================
// BANK ACCOUNT CODES (derived from chart)
// ============================================

/** Set of account codes that represent bank accounts (for filtering inter-bank transfers) */
export const BANK_ACCOUNT_CODES: Set<string> = new Set(
  CHART_OF_ACCOUNTS
    .filter((a) => a.type === 'asset' && a.code.startsWith('BANK_'))
    .map((a) => a.code),
);

// ============================================
// CASH FLOW CATEGORY LABELS (bank txn sub-categories)
// ============================================

/**
 * Bank-transaction-specific sub-categories not in the main CATEGORY_LABELS.
 * These appear in cash flow reports from bank transaction categorization.
 */
const BANK_TXN_CATEGORY_LABELS: Record<string, string> = {
  facebook_ads: 'Facebook Ads',
  google_ads: 'Google Ads',
  agency: 'Agencies',
  photoshoot: 'Photoshoot',
  cc_interest: 'CC Interest & Finance Charges',
  cc_fees: 'CC Fees & Markup',
  rzp_fees: 'Razorpay Fees',
  cod_remittance: 'COD Remittance',
  payu_settlement: 'PayU Settlement',
  uncategorized: 'Uncategorized',
};

/**
 * Get display label for a cash flow category.
 * Checks main CATEGORY_LABELS first, then bank-txn-specific labels, then title-cases.
 */
export function getCashFlowCategoryLabel(category: string | null): string {
  if (!category) return 'Uncategorized';
  return CATEGORY_LABELS[category]
    ?? BANK_TXN_CATEGORY_LABELS[category]
    ?? category.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}
