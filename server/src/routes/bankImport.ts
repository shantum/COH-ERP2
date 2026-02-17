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

export default router;
