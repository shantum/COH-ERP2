/**
 * RazorpayX Payout Routes
 *
 * Creates payouts from confirmed invoices via the RazorpayX API.
 * The webhook handler (razorpayxWebhook.ts) processes the async result
 * and creates BankTransactions + Allocations when payouts complete.
 *
 * Flow:
 *   Invoice (confirmed/partially_paid) → POST /api/razorpayx/payout
 *   → Validate Party has bank details → Create/reuse RazorpayX Contact + Fund Account
 *   → Create Payout with reference_id = invoiceId
 *   → Return payout status to UI
 *   → Webhook handles the rest (BankTransaction, Allocation, invoice status)
 */

import { Router } from 'express';
import type { Request, Response } from 'express';
import { z } from 'zod';
import { requireAdmin } from '../middleware/auth.js';
import { asyncHandler } from '../middleware/asyncHandler.js';
import {
  isConfigured,
  createPayout,
  createCompositePayout,
  createPayoutLink,
  createContact,
  createFundAccount,
  fetchBalance,
  fetchPayout,
  listFundAccounts,
  type RazorpayXFundAccount,
} from '../services/razorpayx/index.js';
import logger from '../utils/logger.js';

const log = logger.child({ module: 'razorpayx-payout' });
const router = Router();

// ============================================
// SCHEMAS
// ============================================

const CreatePayoutFromInvoiceSchema = z.object({
  invoiceId: z.string().min(1),
  mode: z.enum(['NEFT', 'RTGS', 'IMPS', 'UPI']).optional(),
  narration: z.string().max(30).optional(),
  queueIfLowBalance: z.boolean().optional(),
});

const BulkPayoutSchema = z.object({
  invoiceIds: z.array(z.string().min(1)).min(1).max(50),
  mode: z.enum(['NEFT', 'RTGS', 'IMPS', 'UPI']).optional(),
  queueIfLowBalance: z.boolean().optional(),
});

// ============================================
// HELPERS
// ============================================

/** Pick payout mode based on amount if not specified */
function defaultMode(amountInr: number): 'NEFT' | 'RTGS' | 'IMPS' {
  if (amountInr >= 200000) return 'NEFT'; // ≥2L → NEFT (RTGS min is 2L but NEFT is cheaper)
  return 'IMPS'; // <2L → IMPS (instant)
}

/** Sanitize narration for RazorpayX (alphanumeric + spaces only, max 30 chars) */
function sanitizeNarration(text: string): string {
  return text.replace(/[^a-zA-Z0-9 ]/g, '').trim().slice(0, 30);
}

/**
 * Ensure a Party has a RazorpayX Contact and Fund Account.
 * Creates them if they don't exist, stores IDs back on Party.
 */
async function ensureRazorpayxContact(
  prisma: Request['prisma'],
  party: {
    id: string;
    name: string;
    email: string | null;
    phone: string | null;
    category: string;
    razorpayContactId: string | null;
    bankAccountName: string | null;
    bankAccountNumber: string | null;
    bankIfsc: string | null;
  },
): Promise<{ contactId: string; fundAccountId: string }> {
  let contactId = party.razorpayContactId;

  // Create contact if needed
  if (!contactId) {
    const contact = await createContact({
      name: party.name,
      ...(party.email ? { email: party.email } : {}),
      ...(party.phone ? { contact: party.phone } : {}),
      type: 'vendor',
      reference_id: party.id,
      notes: { partyId: party.id, category: party.category },
    });
    contactId = contact.id;

    // Store contact ID on Party for future use
    await prisma.party.update({
      where: { id: party.id },
      data: { razorpayContactId: contactId },
    });
    log.info({ partyId: party.id, contactId }, 'Created RazorpayX contact');
  }

  // Find or create fund account
  const existingAccounts = await listFundAccounts({ contact_id: contactId });
  let fundAccount: RazorpayXFundAccount | undefined;

  // Look for a matching active bank account
  if (existingAccounts.items.length > 0) {
    fundAccount = existingAccounts.items.find(
      (fa) =>
        fa.active &&
        fa.account_type === 'bank_account' &&
        fa.bank_account?.account_number === party.bankAccountNumber &&
        fa.bank_account?.ifsc === party.bankIfsc,
    );
    // If no exact match, use any active bank account
    if (!fundAccount) {
      fundAccount = existingAccounts.items.find(
        (fa) => fa.active && fa.account_type === 'bank_account',
      );
    }
  }

  if (!fundAccount) {
    fundAccount = await createFundAccount({
      contact_id: contactId,
      account_type: 'bank_account',
      bank_account: {
        name: party.bankAccountName || party.name,
        ifsc: party.bankIfsc!,
        account_number: party.bankAccountNumber!,
      },
    });
    log.info({ partyId: party.id, fundAccountId: fundAccount.id }, 'Created RazorpayX fund account');
  }

  return { contactId, fundAccountId: fundAccount.id };
}

// ============================================
// ROUTES
// ============================================

/**
 * GET /api/razorpayx/status — Check if RazorpayX is configured
 */
router.get('/status', requireAdmin, asyncHandler(async (_req: Request, res: Response) => {
  if (!isConfigured()) {
    res.json({ configured: false, balance: null });
    return;
  }

  try {
    const balanceData = await fetchBalance();
    res.json({
      configured: true,
      balance: balanceData.balance / 100, // paise → INR
    });
  } catch (err) {
    log.error({ err }, 'Failed to fetch RazorpayX balance');
    res.json({ configured: true, balance: null, error: 'Failed to fetch balance' });
  }
}));

/**
 * POST /api/razorpayx/payout — Create a payout for a single invoice
 */
router.post('/payout', requireAdmin, asyncHandler(async (req: Request, res: Response) => {
  const parsed = CreatePayoutFromInvoiceSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.issues[0]?.message || 'Invalid request' });
    return;
  }

  if (!isConfigured()) {
    res.status(400).json({ error: 'RazorpayX is not configured. Set API keys in environment.' });
    return;
  }

  const { invoiceId, mode, narration, queueIfLowBalance } = parsed.data;

  // Load invoice with party
  const invoice = await req.prisma.invoice.findUnique({
    where: { id: invoiceId },
    include: {
      party: {
        select: {
          id: true, name: true, email: true, phone: true, category: true,
          razorpayContactId: true,
          bankAccountName: true, bankAccountNumber: true, bankIfsc: true,
        },
      },
    },
  });

  if (!invoice) {
    res.status(404).json({ error: 'Invoice not found' });
    return;
  }

  if (invoice.type !== 'payable') {
    res.status(400).json({ error: 'Only payable invoices can be paid via RazorpayX' });
    return;
  }

  if (invoice.status !== 'confirmed' && invoice.status !== 'partially_paid') {
    res.status(400).json({ error: `Invoice must be confirmed or partially paid. Current status: ${invoice.status}` });
    return;
  }

  if (invoice.balanceDue <= 0) {
    res.status(400).json({ error: 'Invoice has no balance due' });
    return;
  }

  if (!invoice.party) {
    res.status(400).json({ error: 'Invoice has no linked party' });
    return;
  }

  if (!invoice.party.bankAccountNumber || !invoice.party.bankIfsc) {
    res.status(400).json({ error: `Party "${invoice.party.name}" is missing bank details (account number or IFSC)` });
    return;
  }

  // Ensure RazorpayX contact + fund account exist
  const { fundAccountId } = await ensureRazorpayxContact(req.prisma, invoice.party);

  // Create the payout
  const payoutAmount = Math.round(invoice.balanceDue * 100); // INR → paise
  const payoutMode = mode || defaultMode(invoice.balanceDue);
  const payoutNarration = narration || sanitizeNarration(invoice.party.name);

  const payout = await createPayout({
    fund_account_id: fundAccountId,
    amount: payoutAmount,
    currency: 'INR',
    mode: payoutMode,
    purpose: 'vendor bill',
    reference_id: invoice.id,
    narration: payoutNarration,
    notes: {
      invoiceId: invoice.id,
      partyId: invoice.party.id,
      ...(invoice.invoiceNumber ? { invoiceNumber: invoice.invoiceNumber } : {}),
    },
    ...(queueIfLowBalance ? { queue_if_low_balance: true } : {}),
  });

  log.info({
    invoiceId,
    payoutId: payout.id,
    amount: invoice.balanceDue,
    mode: payoutMode,
    status: payout.status,
  }, 'Created RazorpayX payout');

  res.json({
    success: true,
    payout: {
      id: payout.id,
      status: payout.status,
      amount: payout.amount / 100,
      mode: payout.mode,
      utr: payout.utr,
      referenceId: payout.reference_id,
    },
  });
}));

/**
 * POST /api/razorpayx/payout/bulk — Create payouts for multiple invoices
 */
router.post('/payout/bulk', requireAdmin, asyncHandler(async (req: Request, res: Response) => {
  const parsed = BulkPayoutSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.issues[0]?.message || 'Invalid request' });
    return;
  }

  if (!isConfigured()) {
    res.status(400).json({ error: 'RazorpayX is not configured' });
    return;
  }

  const { invoiceIds, mode, queueIfLowBalance } = parsed.data;

  // Load all invoices with parties
  const invoices = await req.prisma.invoice.findMany({
    where: { id: { in: invoiceIds } },
    include: {
      party: {
        select: {
          id: true, name: true, email: true, phone: true, category: true,
          razorpayContactId: true,
          bankAccountName: true, bankAccountNumber: true, bankIfsc: true,
        },
      },
    },
  });

  const results: Array<{
    invoiceId: string;
    invoiceNumber: string | null;
    partyName: string | null;
    success: boolean;
    payoutId?: string;
    status?: string;
    amount?: number;
    error?: string;
  }> = [];

  for (const invoice of invoices) {
    try {
      // Validate
      if (invoice.type !== 'payable') {
        results.push({ invoiceId: invoice.id, invoiceNumber: invoice.invoiceNumber, partyName: invoice.party?.name ?? null, success: false, error: 'Not a payable invoice' });
        continue;
      }
      if (invoice.status !== 'confirmed' && invoice.status !== 'partially_paid') {
        results.push({ invoiceId: invoice.id, invoiceNumber: invoice.invoiceNumber, partyName: invoice.party?.name ?? null, success: false, error: `Status: ${invoice.status}` });
        continue;
      }
      if (invoice.balanceDue <= 0) {
        results.push({ invoiceId: invoice.id, invoiceNumber: invoice.invoiceNumber, partyName: invoice.party?.name ?? null, success: false, error: 'No balance due' });
        continue;
      }
      if (!invoice.party?.bankAccountNumber || !invoice.party?.bankIfsc) {
        results.push({ invoiceId: invoice.id, invoiceNumber: invoice.invoiceNumber, partyName: invoice.party?.name ?? null, success: false, error: 'Missing bank details' });
        continue;
      }

      const { fundAccountId } = await ensureRazorpayxContact(req.prisma, invoice.party);

      const payoutAmount = Math.round(invoice.balanceDue * 100);
      const payoutMode = mode || defaultMode(invoice.balanceDue);

      const payout = await createPayout({
        fund_account_id: fundAccountId,
        amount: payoutAmount,
        currency: 'INR',
        mode: payoutMode,
        purpose: 'vendor bill',
        reference_id: invoice.id,
        narration: sanitizeNarration(invoice.party.name),
        notes: {
          invoiceId: invoice.id,
          partyId: invoice.party.id,
          ...(invoice.invoiceNumber ? { invoiceNumber: invoice.invoiceNumber } : {}),
        },
        ...(queueIfLowBalance ? { queue_if_low_balance: true } : {}),
      });

      results.push({
        invoiceId: invoice.id,
        invoiceNumber: invoice.invoiceNumber,
        partyName: invoice.party.name,
        success: true,
        payoutId: payout.id,
        status: payout.status,
        amount: payout.amount / 100,
      });

      log.info({ invoiceId: invoice.id, payoutId: payout.id, amount: invoice.balanceDue }, 'Bulk payout created');
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : String(err);
      log.error({ err, invoiceId: invoice.id }, 'Bulk payout failed');
      results.push({
        invoiceId: invoice.id,
        invoiceNumber: invoice.invoiceNumber,
        partyName: invoice.party?.name ?? null,
        success: false,
        error: errorMessage,
      });
    }
  }

  const succeeded = results.filter((r) => r.success).length;
  const failed = results.filter((r) => !r.success).length;

  res.json({ success: true, total: results.length, succeeded, failed, results });
}));

/**
 * GET /api/razorpayx/payout/:payoutId — Check payout status
 */
router.get('/payout/:payoutId', requireAdmin, asyncHandler(async (req: Request, res: Response) => {
  if (!isConfigured()) {
    res.status(400).json({ error: 'RazorpayX is not configured' });
    return;
  }

  const payoutId = typeof req.params.payoutId === 'string' ? req.params.payoutId : req.params.payoutId[0];
  const payout = await fetchPayout(payoutId);

  res.json({
    id: payout.id,
    status: payout.status,
    amount: payout.amount / 100,
    mode: payout.mode,
    utr: payout.utr,
    referenceId: payout.reference_id,
    failureReason: payout.failure_reason,
    createdAt: payout.created_at,
  });
}));

// ============================================
// REFUND PAYOUT LINK (for return refunds)
// ============================================

const RefundPayoutLinkSchema = z.object({
  orderLineId: z.string().min(1),
  amount: z.number().int().positive(), // paise
  customerName: z.string().min(1),
  customerEmail: z.string().nullable().optional(),
  customerPhone: z.string().nullable().optional(),
  orderNumber: z.string().optional(),
  batchNumber: z.string().nullable().optional(),
  sendSms: z.boolean().optional(),
  sendEmail: z.boolean().optional(),
});

/**
 * POST /api/razorpayx/payout/refund — Create a payout link for a return refund.
 * Customer receives the link and enters their own bank/UPI details.
 * Called internally by sendReturnRefundLink server function.
 */
router.post('/payout/refund', asyncHandler(async (req: Request, res: Response) => {
  const parsed = RefundPayoutLinkSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.issues[0]?.message || 'Invalid request' });
    return;
  }

  if (!isConfigured()) {
    res.status(400).json({ error: 'RazorpayX is not configured' });
    return;
  }

  const { orderLineId, amount, customerName, customerEmail, customerPhone, orderNumber, batchNumber, sendSms, sendEmail } = parsed.data;
  const description = `Refund for order ${orderNumber || ''}${batchNumber ? ` (${batchNumber})` : ''}`.trim();

  try {
    const payoutLink = await createPayoutLink({
      amount,
      purpose: 'refund',
      description,
      contact: {
        name: customerName,
        ...(customerEmail ? { email: customerEmail } : {}),
        ...(customerPhone ? { contact: customerPhone } : {}),
      },
      receipt: orderLineId,
      notes: {
        type: 'return_refund',
        orderLineId,
        ...(orderNumber ? { orderNumber } : {}),
        ...(batchNumber ? { batchNumber } : {}),
      },
      send_sms: sendSms ?? !!customerPhone,
      send_email: sendEmail ?? !!customerEmail,
    });

    log.info({
      orderLineId,
      payoutLinkId: payoutLink.id,
      shortUrl: payoutLink.short_url,
      amount: amount / 100,
      status: payoutLink.status,
    }, 'Created refund payout link');

    res.json({
      success: true,
      payoutLinkId: payoutLink.id,
      shortUrl: payoutLink.short_url,
      status: payoutLink.status,
      amount: payoutLink.amount / 100,
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    log.error({ orderLineId, amount, error: message }, 'Refund payout link creation failed');
    res.status(500).json({ error: message });
  }
}));

export default router;
