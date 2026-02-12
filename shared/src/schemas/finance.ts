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
  tab: z.enum(['dashboard', 'invoices', 'payments', 'ledger']).catch('dashboard'),
  /** Invoice type filter */
  type: z.enum(['payable', 'receivable']).optional().catch(undefined),
  /** Invoice status filter */
  status: z.string().optional().catch(undefined),
  /** Invoice category filter */
  category: z.string().optional().catch(undefined),
  /** Payment direction filter */
  direction: z.enum(['outgoing', 'incoming']).optional().catch(undefined),
  /** Payment method filter */
  method: z.string().optional().catch(undefined),
  /** Ledger account code filter */
  accountCode: z.string().optional().catch(undefined),
  /** Ledger source type filter */
  sourceType: z.string().optional().catch(undefined),
  /** Search query */
  search: z.string().optional().catch(undefined),
  /** Page number */
  page: z.coerce.number().int().positive().catch(1),
  /** Items per page */
  limit: z.coerce.number().int().positive().max(200).catch(50),
  /** Modal state */
  modal: z.enum(['create-invoice', 'create-payment', 'manual-entry', 'view-invoice', 'view-payment', 'view-entry']).optional().catch(undefined),
  /** Record ID for modals */
  modalId: z.string().optional().catch(undefined),
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
});

export const CreateInvoiceSchema = z.object({
  invoiceNumber: z.string().optional(),
  type: z.enum(['payable', 'receivable']),
  category: z.string(),
  invoiceDate: z.string().optional(),
  dueDate: z.string().optional(),
  supplierId: z.string().uuid().optional(),
  vendorId: z.string().uuid().optional(),
  customerId: z.string().uuid().optional(),
  counterpartyName: z.string().optional(),
  subtotal: z.number().optional(),
  gstAmount: z.number().optional(),
  totalAmount: z.number().positive(),
  orderId: z.string().uuid().optional(),
  fabricInvoiceId: z.string().uuid().optional(),
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
  supplierId: z.string().uuid().nullable().optional(),
  vendorId: z.string().uuid().nullable().optional(),
  customerId: z.string().uuid().nullable().optional(),
  counterpartyName: z.string().nullable().optional(),
  subtotal: z.number().nullable().optional(),
  gstAmount: z.number().nullable().optional(),
  totalAmount: z.number().positive().optional(),
  notes: z.string().nullable().optional(),
});
export type UpdateInvoiceInput = z.infer<typeof UpdateInvoiceSchema>;

// ============================================
// PAYMENT SCHEMAS
// ============================================

export const CreateFinancePaymentSchema = z.object({
  referenceNumber: z.string().optional(),
  direction: z.enum(['outgoing', 'incoming']),
  method: z.string(),
  amount: z.number().positive(),
  paymentDate: z.string(),
  supplierId: z.string().uuid().optional(),
  vendorId: z.string().uuid().optional(),
  customerId: z.string().uuid().optional(),
  counterpartyName: z.string().optional(),
  notes: z.string().optional(),
});
export type CreateFinancePaymentInput = z.infer<typeof CreateFinancePaymentSchema>;

// ============================================
// PAYMENT-INVOICE MATCHING
// ============================================

export const MatchPaymentInvoiceSchema = z.object({
  paymentId: z.string().uuid(),
  invoiceId: z.string().uuid(),
  amount: z.number().positive(),
  notes: z.string().optional(),
});
export type MatchPaymentInvoiceInput = z.infer<typeof MatchPaymentInvoiceSchema>;

// ============================================
// MANUAL LEDGER ENTRY
// ============================================

export const ManualLedgerLineSchema = z.object({
  accountCode: z.string(),
  debit: z.number().min(0).optional(),
  credit: z.number().min(0).optional(),
  description: z.string().optional(),
});

export const CreateManualLedgerEntrySchema = z.object({
  entryDate: z.string(),
  description: z.string().min(1),
  notes: z.string().optional(),
  lines: z.array(ManualLedgerLineSchema).min(2),
});
export type CreateManualLedgerEntryInput = z.infer<typeof CreateManualLedgerEntrySchema>;

// ============================================
// LIST QUERY PARAMS (server function inputs)
// ============================================

export const ListInvoicesInput = z.object({
  type: z.enum(['payable', 'receivable']).optional(),
  status: z.string().optional(),
  category: z.string().optional(),
  search: z.string().optional(),
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().positive().max(200).default(50),
}).optional();

export const ListPaymentsInput = z.object({
  direction: z.enum(['outgoing', 'incoming']).optional(),
  method: z.string().optional(),
  status: z.string().optional(),
  search: z.string().optional(),
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().positive().max(200).default(50),
}).optional();

export const ListLedgerEntriesInput = z.object({
  accountCode: z.string().optional(),
  sourceType: z.string().optional(),
  search: z.string().optional(),
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().positive().max(200).default(50),
}).optional();

// ============================================
// DISPLAY CONSTANTS (shared between client + server)
// ============================================

export const INVOICE_CATEGORIES = [
  'fabric', 'trims', 'service', 'logistics', 'rent', 'salary',
  'marketing', 'packaging', 'equipment', 'marketplace', 'customer_order', 'other',
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
  customer_order: 'Customer Order',
  other: 'Other',
};

export function getCategoryLabel(category: string): string {
  return CATEGORY_LABELS[category] ?? category;
}

export const INVOICE_STATUSES = ['draft', 'confirmed', 'partially_paid', 'paid', 'cancelled'] as const;

export const PAYMENT_METHODS = [
  'bank_transfer', 'upi', 'cash', 'cheque', 'card', 'razorpay',
  'shopflo', 'cod_remittance', 'marketplace_payout', 'adjustment', 'other',
] as const;

export const CHART_OF_ACCOUNTS = [
  { code: 'BANK', name: 'Bank', type: 'asset' },
  { code: 'CASH', name: 'Cash', type: 'asset' },
  { code: 'ACCOUNTS_RECEIVABLE', name: 'Money Customers Owe Us', type: 'asset' },
  { code: 'FABRIC_INVENTORY', name: 'Fabric Inventory', type: 'asset' },
  { code: 'FINISHED_GOODS', name: 'Finished Goods Inventory', type: 'asset' },
  { code: 'GST_INPUT', name: 'GST We Can Claim', type: 'asset' },
  { code: 'ADVANCES_GIVEN', name: 'Advances We Gave', type: 'asset' },
  { code: 'ACCOUNTS_PAYABLE', name: 'Money We Owe Vendors', type: 'liability' },
  { code: 'GST_OUTPUT', name: 'GST We Owe Government', type: 'liability' },
  { code: 'CUSTOMER_ADVANCES', name: 'Customer Advances', type: 'liability' },
  { code: 'SALES_REVENUE', name: 'Sales Revenue', type: 'income' },
  { code: 'COGS', name: 'Cost of Goods Sold', type: 'direct_cost' },
  { code: 'OPERATING_EXPENSES', name: 'Operating Expenses', type: 'expense' },
  { code: 'MARKETPLACE_FEES', name: 'Marketplace & Payment Fees', type: 'expense' },
  { code: 'OWNER_CAPITAL', name: 'Owner Capital', type: 'equity' },
  { code: 'RETAINED_EARNINGS', name: 'Retained Earnings', type: 'equity' },
] as const;
