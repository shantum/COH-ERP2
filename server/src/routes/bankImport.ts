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
} from '../services/bankImport/index.js';

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

export default router;
