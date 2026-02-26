/**
 * RazorpayX API Client
 *
 * Handles authentication, request building, and error handling
 * for the RazorpayX Banking API.
 *
 * Base URL: https://api.razorpay.com/v1
 * Auth: HTTP Basic (key_id:key_secret)
 */

import { z } from 'zod';
import logger from '../../utils/logger.js';

const log = logger.child({ module: 'razorpayx' });

// ============================================
// CONFIG
// ============================================

function getConfig() {
  const keyId = process.env.RAZORPAYX_KEY_ID;
  const keySecret = process.env.RAZORPAYX_KEY_SECRET;
  const accountNumber = process.env.RAZORPAYX_ACCOUNT_NUMBER;

  if (!keyId || !keySecret || !accountNumber) {
    return null;
  }

  return { keyId, keySecret, accountNumber };
}

export function isConfigured(): boolean {
  return getConfig() !== null;
}

// ============================================
// HTTP CLIENT
// ============================================

const BASE_URL = 'https://api.razorpay.com/v1';

interface RequestOptions {
  method: 'GET' | 'POST' | 'PATCH';
  path: string;
  body?: Record<string, unknown>;
  query?: Record<string, string | number>;
}

async function request<T>(options: RequestOptions): Promise<T> {
  const config = getConfig();
  if (!config) {
    throw new Error('RazorpayX not configured. Set RAZORPAYX_KEY_ID, RAZORPAYX_KEY_SECRET, RAZORPAYX_ACCOUNT_NUMBER');
  }

  const url = new URL(`${BASE_URL}${options.path}`);
  if (options.query) {
    for (const [key, val] of Object.entries(options.query)) {
      url.searchParams.set(key, String(val));
    }
  }

  const authHeader = Buffer.from(`${config.keyId}:${config.keySecret}`).toString('base64');

  const fetchOptions: RequestInit = {
    method: options.method,
    headers: {
      'Authorization': `Basic ${authHeader}`,
      'Content-Type': 'application/json',
    },
  };

  if (options.body && options.method !== 'GET') {
    fetchOptions.body = JSON.stringify(options.body);
  }

  log.info({ method: options.method, path: options.path }, 'RazorpayX API request');

  const response = await fetch(url.toString(), fetchOptions);

  if (!response.ok) {
    const errorBody = await response.text();
    log.error({
      status: response.status,
      path: options.path,
      body: errorBody,
    }, 'RazorpayX API error');

    let errorMessage = `RazorpayX API ${response.status}`;
    try {
      const parsed = JSON.parse(errorBody);
      if (parsed.error?.description) {
        errorMessage = parsed.error.description;
      }
    } catch {
      // Use raw error text
      errorMessage = errorBody || errorMessage;
    }

    throw new RazorpayXError(errorMessage, response.status, options.path);
  }

  return response.json() as Promise<T>;
}

export class RazorpayXError extends Error {
  constructor(
    message: string,
    public statusCode: number,
    public path: string,
  ) {
    super(message);
    this.name = 'RazorpayXError';
  }
}

// ============================================
// RESPONSE TYPES
// ============================================

export interface RazorpayXContact {
  id: string;
  entity: 'contact';
  name: string;
  email: string | null;
  contact: string | null;
  type: string | null;
  reference_id: string | null;
  active: boolean;
  notes: Record<string, string>;
  created_at: number;
}

export interface RazorpayXFundAccount {
  id: string;
  entity: 'fund_account';
  contact_id: string;
  account_type: 'bank_account' | 'vpa' | 'card';
  bank_account?: {
    name: string;
    ifsc: string;
    account_number: string;
    bank_name: string;
  };
  vpa?: {
    address: string;
  };
  active: boolean;
  created_at: number;
}

export interface RazorpayXPayout {
  id: string;
  entity: 'payout';
  fund_account_id: string;
  fund_account: RazorpayXFundAccount;
  amount: number; // paise
  currency: string;
  fees: number;
  tax: number;
  mode: 'NEFT' | 'RTGS' | 'IMPS' | 'UPI' | 'card';
  purpose: string;
  status: RazorpayXPayoutStatus;
  utr: string | null;
  reference_id: string | null;
  narration: string | null;
  notes: Record<string, string>;
  failure_reason: string | null;
  status_details: { reason: string; description: string; source: string } | null;
  created_at: number;
}

export type RazorpayXPayoutStatus =
  | 'queued'
  | 'pending'
  | 'processing'
  | 'processed'
  | 'reversed'
  | 'cancelled'
  | 'rejected';

export interface RazorpayXTransaction {
  id: string;
  entity: 'transaction';
  account_number: string;
  amount: number; // paise
  currency: string;
  credit: number;
  debit: number;
  balance: number;
  source: {
    id: string;
    entity: string;
  };
  created_at: number;
}

export interface RazorpayXBalance {
  id: string;
  entity: 'balance';
  balance: number; // paise
  currency: string;
}

interface ListResponse<T> {
  entity: 'collection';
  count: number;
  items: T[];
}

// ============================================
// CONTACTS API
// ============================================

export async function createContact(params: {
  name: string;
  email?: string;
  contact?: string;
  type?: 'vendor' | 'customer' | 'employee' | 'self';
  reference_id?: string;
  notes?: Record<string, string>;
}): Promise<RazorpayXContact> {
  return request<RazorpayXContact>({
    method: 'POST',
    path: '/contacts',
    body: params as Record<string, unknown>,
  });
}

export async function fetchContact(contactId: string): Promise<RazorpayXContact> {
  return request<RazorpayXContact>({
    method: 'GET',
    path: `/contacts/${contactId}`,
  });
}

export async function listContacts(params?: {
  type?: string;
  count?: number;
  skip?: number;
}): Promise<ListResponse<RazorpayXContact>> {
  return request<ListResponse<RazorpayXContact>>({
    method: 'GET',
    path: '/contacts',
    query: params as Record<string, string | number> | undefined,
  });
}

export async function updateContact(
  contactId: string,
  params: Partial<{ name: string; email: string; contact: string; type: string; active: boolean; notes: Record<string, string> }>,
): Promise<RazorpayXContact> {
  return request<RazorpayXContact>({
    method: 'PATCH',
    path: `/contacts/${contactId}`,
    body: params as Record<string, unknown>,
  });
}

// ============================================
// FUND ACCOUNTS API
// ============================================

export async function createFundAccount(params: {
  contact_id: string;
  account_type: 'bank_account' | 'vpa';
  bank_account?: { name: string; ifsc: string; account_number: string };
  vpa?: { address: string };
}): Promise<RazorpayXFundAccount> {
  return request<RazorpayXFundAccount>({
    method: 'POST',
    path: '/fund_accounts',
    body: params as Record<string, unknown>,
  });
}

export async function fetchFundAccount(fundAccountId: string): Promise<RazorpayXFundAccount> {
  return request<RazorpayXFundAccount>({
    method: 'GET',
    path: `/fund_accounts/${fundAccountId}`,
  });
}

export async function listFundAccounts(params: {
  contact_id: string;
  count?: number;
  skip?: number;
}): Promise<ListResponse<RazorpayXFundAccount>> {
  return request<ListResponse<RazorpayXFundAccount>>({
    method: 'GET',
    path: '/fund_accounts',
    query: params as Record<string, string | number>,
  });
}

export async function deactivateFundAccount(fundAccountId: string): Promise<RazorpayXFundAccount> {
  return request<RazorpayXFundAccount>({
    method: 'PATCH',
    path: `/fund_accounts/${fundAccountId}`,
    body: { active: false },
  });
}

// ============================================
// PAYOUTS API
// ============================================

const CreatePayoutSchema = z.object({
  fund_account_id: z.string(),
  amount: z.number().int().positive(), // paise
  currency: z.literal('INR'),
  mode: z.enum(['NEFT', 'RTGS', 'IMPS', 'UPI']),
  purpose: z.enum(['refund', 'cashback', 'payout', 'salary', 'utility bill', 'vendor bill']),
  queue_if_low_balance: z.boolean().optional(),
  reference_id: z.string().optional(),
  narration: z.string().max(30).optional(),
  notes: z.record(z.string(), z.string()).optional(),
});

export type CreatePayoutParams = z.infer<typeof CreatePayoutSchema>;

export async function createPayout(params: CreatePayoutParams): Promise<RazorpayXPayout> {
  const validated = CreatePayoutSchema.parse(params);
  const config = getConfig();
  if (!config) throw new Error('RazorpayX not configured');

  return request<RazorpayXPayout>({
    method: 'POST',
    path: '/payouts',
    body: {
      ...validated,
      account_number: config.accountNumber,
    },
  });
}

/** Composite payout — creates Contact + Fund Account + Payout in one call */
export async function createCompositePayout(params: {
  amount: number; // paise
  mode: 'NEFT' | 'RTGS' | 'IMPS' | 'UPI';
  purpose: string;
  fund_account: {
    account_type: 'bank_account' | 'vpa';
    bank_account?: { name: string; ifsc: string; account_number: string };
    vpa?: { address: string };
    contact: {
      name: string;
      type?: 'vendor' | 'customer' | 'employee' | 'self';
      reference_id?: string;
    };
  };
  reference_id?: string;
  narration?: string;
  notes?: Record<string, string>;
  queue_if_low_balance?: boolean;
}): Promise<RazorpayXPayout> {
  const config = getConfig();
  if (!config) throw new Error('RazorpayX not configured');

  return request<RazorpayXPayout>({
    method: 'POST',
    path: '/payouts',
    body: {
      ...params,
      currency: 'INR',
      account_number: config.accountNumber,
    },
  });
}

export async function fetchPayout(payoutId: string): Promise<RazorpayXPayout> {
  return request<RazorpayXPayout>({
    method: 'GET',
    path: `/payouts/${payoutId}`,
  });
}

export async function listPayouts(params?: {
  count?: number;
  skip?: number;
  from?: number;
  to?: number;
  status?: string;
}): Promise<ListResponse<RazorpayXPayout>> {
  const config = getConfig();
  if (!config) throw new Error('RazorpayX not configured');

  return request<ListResponse<RazorpayXPayout>>({
    method: 'GET',
    path: '/payouts',
    query: {
      account_number: config.accountNumber,
      ...(params as Record<string, string | number> | undefined),
    },
  });
}

export async function cancelPayout(payoutId: string): Promise<RazorpayXPayout> {
  return request<RazorpayXPayout>({
    method: 'POST',
    path: `/payouts/${payoutId}/cancel`,
    body: {},
  });
}

// ============================================
// TRANSACTIONS API
// ============================================

export async function listTransactions(params?: {
  count?: number;
  skip?: number;
  from?: number;
  to?: number;
  type?: string;
}): Promise<ListResponse<RazorpayXTransaction>> {
  const config = getConfig();
  if (!config) throw new Error('RazorpayX not configured');

  return request<ListResponse<RazorpayXTransaction>>({
    method: 'GET',
    path: '/transactions',
    query: {
      account_number: config.accountNumber,
      ...(params as Record<string, string | number> | undefined),
    },
  });
}

export async function fetchTransaction(transactionId: string): Promise<RazorpayXTransaction> {
  return request<RazorpayXTransaction>({
    method: 'GET',
    path: `/transactions/${transactionId}`,
  });
}

// ============================================
// PAYOUT LINKS API
// ============================================

export interface RazorpayXPayoutLinkResponse {
  id: string;
  entity: 'payout_link';
  amount: number; // paise
  currency: string;
  status: string;
  purpose: string;
  description: string | null;
  short_url: string; // The link to send to recipient
  contact: { name: string; email: string | null; contact: string | null };
  receipt: string | null;
  notes: Record<string, string>;
  created_at: number;
}

export async function createPayoutLink(params: {
  amount: number; // paise
  currency?: string;
  purpose: string;
  description?: string;
  contact: {
    name: string;
    email?: string;
    contact?: string; // phone
  };
  receipt?: string;
  notes?: Record<string, string>;
  send_sms?: boolean;
  send_email?: boolean;
}): Promise<RazorpayXPayoutLinkResponse> {
  const config = getConfig();
  if (!config) throw new Error('RazorpayX not configured');

  return request<RazorpayXPayoutLinkResponse>({
    method: 'POST',
    path: '/payout-links',
    body: {
      ...params,
      currency: params.currency || 'INR',
      account_number: config.accountNumber,
    },
  });
}

export async function fetchPayoutLink(linkId: string): Promise<RazorpayXPayoutLinkResponse> {
  return request<RazorpayXPayoutLinkResponse>({
    method: 'GET',
    path: `/payout-links/${linkId}`,
  });
}

// ============================================
// BALANCE API
// ============================================

export async function fetchBalance(): Promise<RazorpayXBalance> {
  const config = getConfig();
  if (!config) throw new Error('RazorpayX not configured');

  return request<RazorpayXBalance>({
    method: 'GET',
    path: '/balance',
    query: { account_number: config.accountNumber },
  });
}
