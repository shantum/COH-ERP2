/**
 * Thin route handlers for channel import endpoints.
 * Delegates heavy logic to specialized modules.
 */

import { Router } from 'express';
import type { Request, Response } from 'express';
import multer from 'multer';
import { randomUUID } from 'crypto';
import { authenticateToken } from '../../middleware/auth.js';
import { asyncHandler } from '../../middleware/asyncHandler.js';
import type { ChannelImportResults } from './types.js';
import { parseCSVBuffer, parseDate, normalizeChannel } from './csvParser.js';
import { upsertChannelOrderLine } from './channelOrderLineUpsert.js';
import { cleanCSVCache, setCsvCache } from './csvCache.js';
import { buildPreview } from './previewBuilder.js';
import { executeImport } from './orderImporter.js';

const router: Router = Router();

// Configure multer for file uploads (memory storage, 10MB limit for large reports)
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 }, // 10MB limit
  fileFilter: (_req, file, cb) => {
    if (file.mimetype === 'text/csv' || file.originalname.endsWith('.csv')) {
      cb(null, true);
    } else {
      cb(new Error('Only CSV files are allowed'));
    }
  },
});

// ============================================
// IMPORT CHANNEL DATA (analytics-only)
// ============================================

router.post('/import', authenticateToken, upload.single('file'), asyncHandler(async (req: Request, res: Response) => {
  try {
    const file = req.file as Express.Multer.File | undefined;
    if (!file) {
      res.status(400).json({ error: 'No file uploaded' });
      return;
    }

    const results: ChannelImportResults = { created: 0, updated: 0, skipped: 0, errors: [] };
    const rows = await parseCSVBuffer(file.buffer);

    if (rows.length === 0) {
      res.status(400).json({ error: 'CSV file is empty or has no valid rows' });
      return;
    }

    const userId = (req as unknown as { user?: { userId?: string } }).user?.userId;
    let minDate: Date | null = null;
    let maxDate: Date | null = null;
    const channelsFound = new Set<string>();

    const importBatch = await req.prisma.channelImportBatch.create({
      data: {
        channel: 'pending',
        filename: file.originalname,
        rowsTotal: rows.length,
        rowsImported: 0,
        rowsSkipped: 0,
        rowsUpdated: 0,
        importedBy: userId,
      },
    });

    for (let i = 0; i < rows.length; i++) {
      const row = rows[i];
      const rowNum = i + 2;

      try {
        const channelOrderId = row['Order Id']?.trim();
        const channelItemId = row['Item ID']?.trim();
        if (!channelOrderId || !channelItemId) {
          results.errors.push({ row: rowNum, error: 'Missing Order Id or Item ID' });
          results.skipped++;
          continue;
        }

        const orderDate = parseDate(row['Order Date(IST)'], row['Order Time(IST)']);
        if (!orderDate) {
          results.errors.push({ row: rowNum, error: `Invalid order date: ${row['Order Date(IST)']}` });
          results.skipped++;
          continue;
        }

        if (!minDate || orderDate < minDate) minDate = orderDate;
        if (!maxDate || orderDate > maxDate) maxDate = orderDate;
        channelsFound.add(normalizeChannel(row['Channel Name']));

        await upsertChannelOrderLine(req.prisma, row, importBatch.id);
        results.created++;
      } catch (rowError) {
        const errorMessage = rowError instanceof Error ? rowError.message : 'Unknown error';
        results.errors.push({ row: rowNum, error: errorMessage });
        results.skipped++;
      }
    }

    const channelSummary = channelsFound.size === 1
      ? Array.from(channelsFound)[0]
      : channelsFound.size > 0 ? 'multiple' : 'unknown';

    await req.prisma.channelImportBatch.update({
      where: { id: importBatch.id },
      data: {
        channel: channelSummary,
        rowsImported: results.created,
        rowsUpdated: results.updated,
        rowsSkipped: results.skipped,
        errors: results.errors.length > 0 ? JSON.stringify(results.errors.slice(0, 100)) : null,
        dateRangeStart: minDate,
        dateRangeEnd: maxDate,
      },
    });

    res.json({
      message: 'Import completed',
      batchId: importBatch.id,
      totalRows: rows.length,
      channels: Array.from(channelsFound),
      dateRange: {
        start: minDate?.toISOString().split('T')[0] || null,
        end: maxDate?.toISOString().split('T')[0] || null,
      },
      results: {
        created: results.created,
        updated: results.updated,
        skipped: results.skipped,
        errorCount: results.errors.length,
        errors: results.errors.slice(0, 10),
      },
    });
  } catch (error) {
    console.error('Channel import error:', error);
    res.status(500).json({ error: 'Failed to import channel data' });
  }
}));

// ============================================
// PREVIEW ORDER IMPORT
// ============================================

router.post('/preview-import', authenticateToken, upload.single('file'), asyncHandler(async (req: Request, res: Response) => {
  try {
    const file = req.file as Express.Multer.File | undefined;
    if (!file) {
      res.status(400).json({ error: 'No file uploaded' });
      return;
    }

    const rows = await parseCSVBuffer(file.buffer);
    if (rows.length === 0) {
      res.status(400).json({ error: 'CSV file is empty or has no valid rows' });
      return;
    }

    // Store parsed rows in server-side cache (avoids sending full CSV back to client)
    cleanCSVCache();
    const cacheKey = randomUUID();
    setCsvCache(cacheKey, rows);

    const response = await buildPreview(req, rows, cacheKey);
    res.json(response);
  } catch (error) {
    console.error('Preview import error:', error);
    res.status(500).json({ error: 'Failed to preview import' });
  }
}));

// ============================================
// EXECUTE ORDER IMPORT
// ============================================

router.post('/execute-import', authenticateToken, asyncHandler(async (req: Request, res: Response) => {
  try {
    await executeImport(req, res);
  } catch (error) {
    console.error('Execute import error:', error);
    res.status(500).json({ error: 'Failed to execute import' });
  }
}));

// ============================================
// GET IMPORT HISTORY
// ============================================

router.get('/import-history', authenticateToken, asyncHandler(async (req: Request, res: Response) => {
  try {
    const batches = await req.prisma.channelImportBatch.findMany({
      orderBy: { importedAt: 'desc' },
      take: 50,
    });

    res.json(batches);
  } catch (error) {
    console.error('Get import history error:', error);
    res.status(500).json({ error: 'Failed to get import history' });
  }
}));

// ============================================
// DELETE IMPORT BATCH
// ============================================

router.delete('/import-batch/:batchId', authenticateToken, asyncHandler(async (req: Request, res: Response) => {
  try {
    const batchIdParam = req.params.batchId;
    const batchId = Array.isArray(batchIdParam) ? batchIdParam[0] : batchIdParam;

    // Delete all lines from this batch
    const deleteResult = await req.prisma.channelOrderLine.deleteMany({
      where: { importBatchId: batchId },
    });

    // Delete the batch record
    await req.prisma.channelImportBatch.delete({
      where: { id: batchId },
    });

    res.json({
      message: 'Import batch deleted',
      deletedLines: deleteResult.count,
    });
  } catch (error) {
    console.error('Delete import batch error:', error);
    res.status(500).json({ error: 'Failed to delete import batch' });
  }
}));

export default router;
