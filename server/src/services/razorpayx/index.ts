/**
 * RazorpayX Service — Barrel Export
 *
 * API client for making outbound calls to RazorpayX.
 * Webhook handler is in webhookHandler.ts (used by the route).
 */

export {
  // Config
  isConfigured,
  RazorpayXError,

  // Contacts
  createContact,
  fetchContact,
  listContacts,
  updateContact,

  // Fund Accounts
  createFundAccount,
  fetchFundAccount,
  listFundAccounts,
  deactivateFundAccount,

  // Payouts
  createPayout,
  createCompositePayout,
  fetchPayout,
  listPayouts,
  cancelPayout,

  // Transactions
  listTransactions,
  fetchTransaction,

  // Balance
  fetchBalance,

  // Types
  type RazorpayXContact,
  type RazorpayXFundAccount,
  type RazorpayXPayout,
  type RazorpayXPayoutStatus,
  type RazorpayXTransaction,
  type RazorpayXBalance,
  type CreatePayoutParams,
} from './client.js';
