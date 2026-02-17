/**
 * Bank Import Routes
 *
 * Upload CSV, categorize transactions, post to ledger.
 * Uses the bankImport service from server/src/services/bankImport/.
 */

import { Router } from 'express';
import type { Request, Response } from 'express';
import multer from 'multer';
import path from 'path';
import fs from 'fs';
import { requireAdmin } from '../middleware/auth.js';
import { asyncHandler } from '../middleware/asyncHandler.js';
import logger from '../utils/logger.js';
import {
  importHdfcStatement,
  importRazorpayxPayouts,
  categorizeTransactions,
  getDryRunSummary,
  postTransactions,
  parseHdfcRows,
  parseRazorpayxRows,
  checkDuplicateHashes,
  validateHdfcBalance,
  fetchActiveParties,
  categorizeSingleTxn,
} from '../services/bankImport/index.js';
import type { RawRow } from '../services/bankImport/index.js';
import {
  findPartyByNarration,
  resolveAccounting,
} from '../services/transactionTypeResolver.js';

const log = logger.child({ module: 'bankImport' });
const router = Router();

// ============================================
// MULTER CONFIG — CSV only, disk storage to /tmp
// ============================================

const UPLOAD_DIR = '/tmp/bank-import-uploads';
if (!fs.existsSync(UPLOAD_DIR)) {
  fs.mkdirSync(UPLOAD_DIR, { recursive: true });
}

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, UPLOAD_DIR),
  filename: (_req, file, cb) => {
    const unique = `${Date.now()}-${Math.round(Math.random() * 1e4)}`;
    cb(null, `${unique}-${file.originalname}`);
  },
});

const upload = multer({
  storage,
  limits: { fileSize: 5 * 1024 * 1024 }, // 5MB
  fileFilter: (_req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    if (ext === '.csv') {
      cb(null, true);
    } else {
      cb(new Error('Only CSV files are allowed'));
    }
  },
});

// ============================================
// POST /upload — Import a CSV into BankTransaction
// ============================================

router.post('/upload', requireAdmin, upload.single('file'), asyncHandler(async (req: Request, res: Response) => {
  if (!req.file) {
    res.status(400).json({ error: 'No file uploaded' });
    return;
  }

  const bank = req.body.bank as string;
  if (!bank || !['hdfc', 'razorpayx'].includes(bank)) {
    res.status(400).json({ error: 'bank must be "hdfc" or "razorpayx"' });
    return;
  }

  const filePath = req.file.path;
  log.info({ bank, fileName: req.file.originalname, filePath }, 'Bank CSV upload received');

  try {
    let result;
    if (bank === 'hdfc') {
      result = await importHdfcStatement(filePath);
    } else {
      result = await importRazorpayxPayouts(filePath);
    }

    log.info({ bank, newRows: result.newRows, skipped: result.skippedRows }, 'Bank import complete');
    res.json({ success: true, result });
  } finally {
    // Clean up uploaded file
    fs.unlink(filePath, () => {});
  }
}));

// ============================================
// POST /preview — Parse CSV + dedup + categorize in memory (NO DB write)
// ============================================

router.post('/preview', requireAdmin, upload.single('file'), asyncHandler(async (req: Request, res: Response) => {
  if (!req.file) {
    res.status(400).json({ error: 'No file uploaded' });
    return;
  }

  const bank = req.body.bank as string;
  if (!bank || !['hdfc', 'razorpayx'].includes(bank)) {
    res.status(400).json({ error: 'bank must be "hdfc" or "razorpayx"' });
    return;
  }

  const filePath = req.file.path;
  log.info({ bank, fileName: req.file.originalname, filePath }, 'Bank CSV preview requested');

  try {
    let parsed: RawRow[];
    let totalProcessed: number;

    if (bank === 'hdfc') {
      parsed = parseHdfcRows(filePath);
      totalProcessed = parsed.length;
    } else {
      const result = parseRazorpayxRows(filePath);
      parsed = result.rows;
      totalProcessed = result.totalProcessed;
    }

    // Check duplicates (read-only DB query)
    const allHashes = parsed.map(r => r.txnHash);
    const existingHashes = await checkDuplicateHashes(bank, allHashes);

    // Balance validation (HDFC only)
    const balanceCheck = bank === 'hdfc' ? validateHdfcBalance(parsed) : undefined;

    // Categorize in memory
    const parties = await fetchActiveParties();

    const bankAccountMap: Record<string, string> = {
      hdfc: 'BANK_HDFC',
      razorpayx: 'BANK_RAZORPAYX',
    };
    const bankAccount = bankAccountMap[bank] || 'BANK_HDFC';

    let partiesMatched = 0;
    let partiesUnmatched = 0;

    const previewRows = parsed.map(row => {
      const isDuplicate = existingHashes.has(row.txnHash);

      // Categorize using same logic as import
      const cat = categorizeSingleTxn(
        {
          bank,
          narration: row.narration || null,
          direction: row.direction,
          counterpartyName: row.counterpartyName || null,
          rawData: row.rawData,
          legacySourceId: row.legacySourceId,
        },
        parties,
      );

      // Resolve party
      let partyId = cat.partyId;
      let partyName = cat.counterpartyName;
      if (!partyId && partyName) {
        const matched = parties.find(p =>
          p.name.toLowerCase() === partyName!.toLowerCase() ||
          p.aliases.some(a => a.toLowerCase() === partyName!.toLowerCase())
        );
        if (matched) { partyId = matched.id; partyName = matched.name; }
      }

      if (!isDuplicate) {
        if (partyId) partiesMatched++;
        else partiesUnmatched++;
      }

      return {
        txnDate: row.txnDate,
        narration: row.narration || null,
        amount: row.amount,
        direction: row.direction,
        reference: row.reference || null,
        closingBalance: row.closingBalance,
        isDuplicate,
        partyName: partyName || null,
        partyId: partyId || null,
        category: cat.category || null,
        debitAccountCode: cat.debitAccount,
        creditAccountCode: cat.creditAccount,
      };
    });

    const newCount = previewRows.filter(r => !r.isDuplicate).length;
    const dupCount = previewRows.filter(r => r.isDuplicate).length;

    res.json({
      bank,
      totalRows: totalProcessed,
      newRows: newCount,
      duplicateRows: dupCount,
      balanceMatched: balanceCheck?.balanceMatched,
      openingBalance: balanceCheck?.openingBalance,
      closingBalance: balanceCheck?.closingBalance,
      partiesMatched,
      partiesUnmatched,
      rows: previewRows,
    });
  } finally {
    // Clean up temp file
    fs.unlink(filePath, () => {});
  }
}));

// ============================================
// POST /categorize — Apply rules to imported transactions
// ============================================

router.post('/categorize', requireAdmin, asyncHandler(async (req: Request, res: Response) => {
  const bank = req.body.bank as string | undefined;
  log.info({ bank }, 'Categorize triggered');

  const result = await categorizeTransactions(bank ? { bank } : undefined);
  log.info({ categorized: result.categorized, skipped: result.skipped }, 'Categorize complete');

  res.json({ success: true, result });
}));

// ============================================
// POST /post — Post categorized transactions to ledger
// ============================================

router.post('/post', requireAdmin, asyncHandler(async (req: Request, res: Response) => {
  const bank = req.body.bank as string | undefined;
  log.info({ bank }, 'Post triggered');

  const result = await postTransactions(bank ? { bank } : undefined);
  log.info({ posted: result.posted, errors: result.errors }, 'Post complete');

  res.json({ success: true, result });
}));

// ============================================
// GET /dry-run — Preview what posting would do
// ============================================

router.get('/dry-run', requireAdmin, asyncHandler(async (req: Request, res: Response) => {
  const bank = req.query.bank as string | undefined;
  const summary = await getDryRunSummary(bank ? { bank } : undefined);
  res.json({ success: true, summary });
}));

// ============================================
// POST /assign-party — Manually assign a party to a bank transaction
// ============================================

router.post('/assign-party', requireAdmin, asyncHandler(async (req: Request, res: Response) => {
  const { txnId, partyId } = req.body;
  if (!txnId || !partyId) {
    res.status(400).json({ error: 'txnId and partyId are required' });
    return;
  }

  // Fetch the party with TransactionType
  const party = await req.prisma.party.findUnique({
    where: { id: partyId },
    select: {
      id: true,
      name: true,
      aliases: true,
      category: true,
      tdsApplicable: true,
      tdsSection: true,
      tdsRate: true,
      invoiceRequired: true,
      transactionType: {
        select: {
          id: true,
          name: true,
          debitAccountCode: true,
          creditAccountCode: true,
          defaultGstRate: true,
          defaultTdsApplicable: true,
          defaultTdsSection: true,
          defaultTdsRate: true,
          invoiceRequired: true,
          expenseCategory: true,
        },
      },
    },
  });

  if (!party) {
    res.status(404).json({ error: 'Party not found' });
    return;
  }

  const txn = await req.prisma.bankTransaction.findUnique({
    where: { id: txnId },
    select: { id: true, bank: true, direction: true },
  });

  if (!txn) {
    res.status(404).json({ error: 'Bank transaction not found' });
    return;
  }

  // Resolve accounting from party's TransactionType
  const acct = resolveAccounting(party);
  const isDebit = txn.direction === 'debit';

  // Determine bank account based on bank type
  const bankAccountMap: Record<string, string> = {
    hdfc: 'BANK_HDFC',
    razorpayx: 'BANK_RAZORPAYX',
    hdfc_cc: 'CREDIT_CARD',
    icici_cc: 'CREDIT_CARD',
  };
  const bankAccount = bankAccountMap[txn.bank] || 'BANK_HDFC';

  const debitAccountCode = isDebit ? (acct.debitAccount || 'UNMATCHED_PAYMENTS') : bankAccount;
  const creditAccountCode = isDebit ? bankAccount : (acct.creditAccount || 'UNMATCHED_PAYMENTS');

  const updated = await req.prisma.bankTransaction.update({
    where: { id: txnId },
    data: {
      partyId: party.id,
      counterpartyName: party.name,
      debitAccountCode,
      creditAccountCode,
      category: acct.category || null,
    },
  });

  log.info({ txnId, partyId, partyName: party.name }, 'Party assigned to bank transaction');
  res.json({ success: true, transaction: updated });
}));

// ============================================
// PATCH /update — Edit bank transaction fields (party, accounts, category)
// ============================================

router.patch('/update', requireAdmin, asyncHandler(async (req: Request, res: Response) => {
  const { txnId, partyId, debitAccountCode, creditAccountCode, category } = req.body;
  if (!txnId) {
    res.status(400).json({ error: 'txnId is required' });
    return;
  }

  const txn = await req.prisma.bankTransaction.findUnique({
    where: { id: txnId },
    select: { id: true, bank: true, direction: true, status: true },
  });

  if (!txn) {
    res.status(404).json({ error: 'Bank transaction not found' });
    return;
  }

  const data: Record<string, unknown> = {};

  // If partyId is provided, resolve accounting from party's TransactionType
  if (partyId !== undefined) {
    if (partyId === null) {
      // Clear party
      data.partyId = null;
      data.counterpartyName = null;
    } else {
      const party = await req.prisma.party.findUnique({
        where: { id: partyId },
        select: {
          id: true, name: true, category: true,
          transactionType: {
            select: {
              debitAccountCode: true, creditAccountCode: true, expenseCategory: true,
            },
          },
        },
      });

      if (!party) {
        res.status(404).json({ error: 'Party not found' });
        return;
      }

      data.partyId = party.id;
      data.counterpartyName = party.name;

      // Auto-fill accounts from party's TransactionType if not explicitly provided
      if (debitAccountCode === undefined && creditAccountCode === undefined && party.transactionType) {
        const isDebit = txn.direction === 'debit';
        const bankAccountMap: Record<string, string> = {
          hdfc: 'BANK_HDFC', razorpayx: 'BANK_RAZORPAYX',
          hdfc_cc: 'CREDIT_CARD', icici_cc: 'CREDIT_CARD',
        };
        const bankAccount = bankAccountMap[txn.bank] || 'BANK_HDFC';

        data.debitAccountCode = isDebit ? (party.transactionType.debitAccountCode || 'UNMATCHED_PAYMENTS') : bankAccount;
        data.creditAccountCode = isDebit ? bankAccount : (party.transactionType.creditAccountCode || 'UNMATCHED_PAYMENTS');
        data.category = party.transactionType.expenseCategory || party.category || null;
      }
    }
  }

  // Explicit account overrides
  if (debitAccountCode !== undefined) data.debitAccountCode = debitAccountCode;
  if (creditAccountCode !== undefined) data.creditAccountCode = creditAccountCode;
  if (category !== undefined) data.category = category;

  const updated = await req.prisma.bankTransaction.update({
    where: { id: txnId },
    data: data as any,
    select: {
      id: true, bank: true, txnDate: true, amount: true, direction: true,
      narration: true, reference: true, counterpartyName: true,
      debitAccountCode: true, creditAccountCode: true, category: true,
      status: true, partyId: true,
      party: { select: { id: true, name: true } },
    },
  });

  log.info({ txnId, updates: Object.keys(data) }, 'Bank transaction updated');
  res.json({ success: true, transaction: updated });
}));

// ============================================
// POST /skip — Mark transaction as skipped
// ============================================

router.post('/skip', requireAdmin, asyncHandler(async (req: Request, res: Response) => {
  const { txnId, reason } = req.body;
  if (!txnId) {
    res.status(400).json({ error: 'txnId is required' });
    return;
  }

  const updated = await req.prisma.bankTransaction.update({
    where: { id: txnId },
    data: { status: 'skipped', skipReason: reason || 'Manually skipped' },
    select: { id: true, status: true },
  });

  log.info({ txnId, reason }, 'Bank transaction skipped');
  res.json({ success: true, transaction: updated });
}));

// ============================================
// POST /unskip — Restore skipped transaction
// ============================================

router.post('/unskip', requireAdmin, asyncHandler(async (req: Request, res: Response) => {
  const { txnId } = req.body;
  if (!txnId) {
    res.status(400).json({ error: 'txnId is required' });
    return;
  }

  const updated = await req.prisma.bankTransaction.update({
    where: { id: txnId },
    data: { status: 'imported', skipReason: null },
    select: { id: true, status: true },
  });

  log.info({ txnId }, 'Bank transaction unskipped');
  res.json({ success: true, transaction: updated });
}));

// ============================================
// DELETE /:id — Delete a bank transaction
// ============================================

router.delete('/:id', requireAdmin, asyncHandler(async (req: Request, res: Response) => {
  const { id } = req.params;

  const txn = await req.prisma.bankTransaction.findUnique({
    where: { id: id as string },
    select: { id: true, status: true, paymentId: true, ledgerEntryId: true },
  });

  if (!txn) {
    res.status(404).json({ error: 'Bank transaction not found' });
    return;
  }

  // Don't delete posted transactions with linked records
  if (txn.paymentId || txn.ledgerEntryId) {
    res.status(400).json({ error: 'Cannot delete a transaction with linked payment or ledger entry' });
    return;
  }

  await req.prisma.bankTransaction.delete({ where: { id: id as string } });

  log.info({ txnId: id }, 'Bank transaction deleted');
  res.json({ success: true });
}));

export default router;
