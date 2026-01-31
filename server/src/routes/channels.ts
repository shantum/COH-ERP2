/**
 * @fileoverview Channel Import Routes - Handles BT CSV report uploads for marketplace channels
 *
 * Features:
 * - CSV import for Myntra, Ajio, Nykaa order data from BT reports
 * - Additive import: uploading Jan + Feb data combines them
 * - Deduplication on channel + channelOrderId + channelItemId
 * - Import batch tracking for audit trail
 *
 * Key Patterns:
 * - Multer memory storage for file uploads (10MB limit for large reports)
 * - Row-by-row upsert with error collection
 * - Price stored in paise for precision
 */

import { Router } from 'express';
import type { Request, Response } from 'express';
import { authenticateToken } from '../middleware/auth.js';
import { parse } from 'fast-csv';
import multer from 'multer';
import { Readable } from 'stream';

const router: Router = Router();

// ============================================
// TYPE DEFINITIONS
// ============================================

/**
 * CSV column mapping from BT report to ChannelOrderLine
 */
interface BtReportRow {
  'Order Id'?: string;
  'Channel Name'?: string;
  'Channel Ref'?: string;
  'Item ID'?: string;
  'Order Date(IST)'?: string;
  'Order Type'?: string;
  'Financial Status'?: string;
  'Fulfillment Status'?: string;
  'SKU Codes'?: string;
  'Channel SKU Code'?: string;
  'SKU Titles'?: string;
  'Quantity'?: string;
  'MRP'?: string;
  "Seller's Price"?: string;
  "Buyer's Price"?: string;
  'Item Total'?: string;
  'Item Total Discount Value'?: string;
  'Order Total Amount'?: string;
  'TAX %'?: string;
  'TAX type'?: string;
  'TAX Amount'?: string;
  'Courier Name'?: string;
  'Courier Tracking Number'?: string;
  'Dispatch By Date'?: string;
  'Dispatch Date'?: string;
  'Manifested Date'?: string;
  'Channel Delivery Date'?: string;
  'BT Return Date'?: string;
  'Channel Return Date'?: string;
  'Customer Name'?: string;
  'City'?: string;
  'State'?: string;
  'Zip'?: string;
  'Invoice Number'?: string;
  'Batch No.'?: string;
  'HSN Code'?: string;
}

/**
 * Import results structure
 */
interface ChannelImportResults {
  created: number;
  updated: number;
  skipped: number;
  errors: Array<{ row: number; error: string }>;
}

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
// HELPER FUNCTIONS
// ============================================

/**
 * Normalize channel name to lowercase standard format
 * Examples: "Myntra PPMP" → "myntra", "AJIO JIT" → "ajio"
 */
function normalizeChannel(raw: string | undefined): string {
  if (!raw) return 'unknown';
  const lower = raw.toLowerCase();
  if (lower.includes('myntra')) return 'myntra';
  if (lower.includes('ajio')) return 'ajio';
  if (lower.includes('nykaa')) return 'nykaa';
  return lower.replace(/[^a-z0-9]/g, '_');
}

/**
 * Parse price string to paise (handles "1,999.00" format)
 * Returns null for empty/invalid values
 */
function parsePriceToPaise(val: string | undefined): number | null {
  if (!val || val.trim() === '') return null;
  const cleaned = val.replace(/,/g, '').trim();
  const num = parseFloat(cleaned);
  return isNaN(num) ? null : Math.round(num * 100);
}

/**
 * Parse date string from BT report (handles multiple formats)
 * Format examples: "2024-01-15", "15-01-2024", "2024-01-15 14:30:00"
 */
function parseDate(val: string | undefined): Date | null {
  if (!val || val.trim() === '') return null;

  const trimmed = val.trim();

  // Try ISO format first (2024-01-15)
  let date = new Date(trimmed);
  if (!isNaN(date.getTime())) return date;

  // Try DD-MM-YYYY format
  const ddmmyyyy = trimmed.match(/^(\d{2})-(\d{2})-(\d{4})/);
  if (ddmmyyyy) {
    date = new Date(`${ddmmyyyy[3]}-${ddmmyyyy[2]}-${ddmmyyyy[1]}`);
    if (!isNaN(date.getTime())) return date;
  }

  return null;
}

/**
 * Parse integer with fallback
 */
function parseIntSafe(val: string | undefined, defaultVal: number = 1): number {
  if (!val || val.trim() === '') return defaultVal;
  const num = parseInt(val.replace(/,/g, '').trim(), 10);
  return isNaN(num) ? defaultVal : num;
}

/**
 * Parse float with fallback
 */
function parseFloatSafe(val: string | undefined): number | null {
  if (!val || val.trim() === '') return null;
  const num = parseFloat(val.replace(/,/g, '').trim());
  return isNaN(num) ? null : num;
}

// ============================================
// IMPORT CHANNEL DATA
// ============================================

router.post('/import', authenticateToken, upload.single('file'), async (req: Request, res: Response) => {
  try {
    const file = req.file as Express.Multer.File | undefined;
    if (!file) {
      res.status(400).json({ error: 'No file uploaded' });
      return;
    }

    const results: ChannelImportResults = {
      created: 0,
      updated: 0,
      skipped: 0,
      errors: [],
    };

    // Parse CSV from buffer
    const rows: BtReportRow[] = [];
    await new Promise<void>((resolve, reject) => {
      const stream = Readable.from(file.buffer.toString());
      stream
        .pipe(parse({ headers: true, trim: true }))
        .on('data', (row: BtReportRow) => rows.push(row))
        .on('end', resolve)
        .on('error', reject);
    });

    if (rows.length === 0) {
      res.status(400).json({ error: 'CSV file is empty or has no valid rows' });
      return;
    }

    // Create import batch record
    const userId = (req as unknown as { user?: { userId?: string } }).user?.userId;

    // Track date range for the batch
    let minDate: Date | null = null;
    let maxDate: Date | null = null;
    const channelsFound = new Set<string>();

    // Create batch record first
    const importBatch = await req.prisma.channelImportBatch.create({
      data: {
        channel: 'pending', // Will update after processing
        filename: file.originalname,
        rowsTotal: rows.length,
        rowsImported: 0,
        rowsSkipped: 0,
        rowsUpdated: 0,
        importedBy: userId,
      },
    });

    // Process each row
    for (let i = 0; i < rows.length; i++) {
      const row = rows[i];
      const rowNum = i + 2; // Account for header row

      try {
        // Validate required fields
        const channelOrderId = row['Order Id']?.trim();
        const channelItemId = row['Item ID']?.trim();
        const orderDateStr = row['Order Date(IST)'];
        const skuCode = row['SKU Codes']?.trim();

        if (!channelOrderId || !channelItemId) {
          results.errors.push({ row: rowNum, error: 'Missing Order Id or Item ID' });
          results.skipped++;
          continue;
        }

        const orderDate = parseDate(orderDateStr);
        if (!orderDate) {
          results.errors.push({ row: rowNum, error: `Invalid order date: ${orderDateStr}` });
          results.skipped++;
          continue;
        }

        // Track date range
        if (!minDate || orderDate < minDate) minDate = orderDate;
        if (!maxDate || orderDate > maxDate) maxDate = orderDate;

        const channel = normalizeChannel(row['Channel Name']);
        channelsFound.add(channel);

        // Build line data
        const lineData = {
          channel,
          channelOrderId,
          channelRef: row['Channel Ref']?.trim() || null,
          channelItemId,
          orderDate,
          orderType: row['Order Type']?.trim() || 'Unknown',
          financialStatus: row['Financial Status']?.trim() || null,
          fulfillmentStatus: row['Fulfillment Status']?.trim() || null,
          skuCode: skuCode || 'UNKNOWN',
          channelSkuCode: row['Channel SKU Code']?.trim() || null,
          skuTitle: row['SKU Titles']?.trim() || null,
          quantity: parseIntSafe(row['Quantity'], 1),
          mrp: parsePriceToPaise(row['MRP']),
          sellerPrice: parsePriceToPaise(row["Seller's Price"]),
          buyerPrice: parsePriceToPaise(row["Buyer's Price"]),
          itemTotal: parsePriceToPaise(row['Item Total']),
          itemDiscount: parsePriceToPaise(row['Item Total Discount Value']),
          orderTotal: parsePriceToPaise(row['Order Total Amount']),
          taxPercent: parseFloatSafe(row['TAX %']),
          taxType: row['TAX type']?.trim() || null,
          taxAmount: parsePriceToPaise(row['TAX Amount']),
          courierName: row['Courier Name']?.trim() || null,
          trackingNumber: row['Courier Tracking Number']?.trim() || null,
          dispatchByDate: parseDate(row['Dispatch By Date']),
          dispatchDate: parseDate(row['Dispatch Date']),
          manifestedDate: parseDate(row['Manifested Date']),
          deliveryDate: parseDate(row['Channel Delivery Date']),
          returnDate: parseDate(row['BT Return Date']),
          channelReturnDate: parseDate(row['Channel Return Date']),
          customerName: row['Customer Name']?.trim() || null,
          customerCity: row['City']?.trim() || null,
          customerState: row['State']?.trim() || null,
          customerZip: row['Zip']?.trim() || null,
          invoiceNumber: row['Invoice Number']?.trim() || null,
          batchNo: row['Batch No.']?.trim() || null,
          hsnCode: row['HSN Code']?.trim() || null,
          importBatchId: importBatch.id,
        };

        // Upsert: update if exists (by unique key), create if new
        const existing = await req.prisma.channelOrderLine.findUnique({
          where: {
            channel_channelOrderId_channelItemId: {
              channel,
              channelOrderId,
              channelItemId,
            },
          },
        });

        if (existing) {
          await req.prisma.channelOrderLine.update({
            where: { id: existing.id },
            data: {
              ...lineData,
              importedAt: new Date(), // Update import timestamp
            },
          });
          results.updated++;
        } else {
          await req.prisma.channelOrderLine.create({
            data: lineData,
          });
          results.created++;
        }
      } catch (rowError) {
        const errorMessage = rowError instanceof Error ? rowError.message : 'Unknown error';
        results.errors.push({ row: rowNum, error: errorMessage });
        results.skipped++;
      }
    }

    // Update batch record with final stats
    const channelSummary = channelsFound.size === 1
      ? Array.from(channelsFound)[0]
      : channelsFound.size > 0
        ? 'multiple'
        : 'unknown';

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
        errors: results.errors.slice(0, 10), // Return first 10 errors
      },
    });
  } catch (error) {
    console.error('Channel import error:', error);
    res.status(500).json({ error: 'Failed to import channel data' });
  }
});

// ============================================
// GET IMPORT HISTORY
// ============================================

router.get('/import-history', authenticateToken, async (req: Request, res: Response) => {
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
});

// ============================================
// DELETE IMPORT BATCH
// ============================================

router.delete('/import-batch/:batchId', authenticateToken, async (req: Request, res: Response) => {
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
});

export default router;
