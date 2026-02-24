/**
 * @fileoverview Channel Import Routes - Handles BT CSV report uploads for marketplace channels
 *
 * Features:
 * - CSV import for Myntra, Ajio, Nykaa order data from BT reports
 * - Additive import: uploading Jan + Feb data combines them
 * - Deduplication on channel + channelOrderId + channelItemId
 * - Import batch tracking for audit trail
 * - Channel Order Import: creates real ERP Orders from BT CSV data
 *
 * Key Patterns:
 * - Multer memory storage for file uploads (10MB limit for large reports)
 * - Row-by-row upsert with error collection
 * - Price stored in paise for precision (analytics), rupees for ERP Orders
 */

import { Router } from 'express';
import type { Request, Response } from 'express';
import { authenticateToken } from '../middleware/auth.js';
import { parse } from 'fast-csv';
import multer from 'multer';
import { Readable } from 'stream';
import { randomUUID } from 'crypto';
import { batchPushOrdersToSheet, updateSheetChannelDetails } from '../services/sheetOrderPush.js';
import { recomputeOrderStatus } from '../utils/orderStatus.js';
import { deferredExecutor } from '../services/deferredExecutor.js';
import prisma from '../lib/prisma.js';

const router: Router = Router();

// ============================================
// CSV CACHE (avoids sending full CSV back through client)
// ============================================

const csvCache = new Map<string, { rows: BtReportRow[]; expiresAt: number }>();
const CSV_CACHE_TTL_MS = 15 * 60 * 1000; // 15 min

function cleanCSVCache() {
  const now = Date.now();
  for (const [key, val] of csvCache) {
    if (val.expiresAt < now) csvCache.delete(key);
  }
}

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
  'Order Time(IST)'?: string;
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
  'Phone'?: string;
  'Address Line 1'?: string;
  'Address Line 2'?: string;
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
const MONTH_MAP: Record<string, string> = {
  jan: '01', feb: '02', mar: '03', apr: '04', may: '05', jun: '06',
  jul: '07', aug: '08', sep: '09', oct: '10', nov: '11', dec: '12',
};

function parseDate(val: string | undefined, timeVal?: string): Date | null {
  if (!val || val.trim() === '') return null;

  const trimmed = val.trim();
  const time = timeVal?.trim() || '';

  // BT report format: "11-Feb-2026" (DD-Mon-YYYY) + time "10:52:20" (IST)
  const ddMonYyyy = trimmed.match(/^(\d{1,2})-([A-Za-z]{3})-(\d{4})/);
  if (ddMonYyyy) {
    const [, dd, mon, yyyy] = ddMonYyyy;
    const mm = MONTH_MAP[mon.toLowerCase()];
    if (mm) {
      const timeParts = time.split(':');
      const hh = (timeParts[0] || '00').padStart(2, '0');
      const mi = timeParts[1] || '00';
      const ss = timeParts[2] || '00';
      // All BT report dates are IST — use +05:30 offset
      const date = new Date(`${yyyy}-${mm}-${dd.padStart(2, '0')}T${hh}:${mi}:${ss}+05:30`);
      if (!isNaN(date.getTime())) return date;
    }
  }

  // Try ISO-like format (2024-01-15, 2024-01-15 14:30:00, 2024-01-15T14:30:00Z)
  // If no timezone info present, treat as IST (all BT report dates are IST)
  const timeStr = time || '00:00:00';
  const isoLike = trimmed.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (isoLike) {
    // If it already has timezone info (Z or +/-offset), parse as-is
    if (/[Zz]|[+-]\d{2}:\d{2}$/.test(trimmed)) {
      const date = new Date(trimmed);
      if (!isNaN(date.getTime())) return date;
    }
    // Otherwise treat as IST
    const datePart = `${isoLike[1]}-${isoLike[2]}-${isoLike[3]}`;
    const date = new Date(`${datePart}T${timeStr}+05:30`);
    if (!isNaN(date.getTime())) return date;
  }

  // Try DD-MM-YYYY format (numeric month) — treat as IST
  const ddmmyyyy = trimmed.match(/^(\d{2})-(\d{2})-(\d{4})/);
  if (ddmmyyyy) {
    const date = new Date(`${ddmmyyyy[3]}-${ddmmyyyy[2]}-${ddmmyyyy[1]}T${timeStr}+05:30`);
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

/**
 * Parse price string to rupees (float). For ERP Orders where unitPrice is stored as Float.
 */
function parsePriceToRupees(val: string | undefined): number {
  if (!val || val.trim() === '') return 0;
  const cleaned = val.replace(/,/g, '').trim();
  const num = parseFloat(cleaned);
  return isNaN(num) ? 0 : num;
}

/**
 * Check if phone number is a marketplace placeholder (all same digits, etc.)
 */
function isPlaceholderPhone(phone: string | null): boolean {
  if (!phone) return true;
  const cleaned = phone.replace(/\D/g, '');
  if (!cleaned) return true;
  if (/^(\d)\1+$/.test(cleaned)) return true; // 9999999999, 0000000000
  if (cleaned === '1234567890') return true;
  return false;
}

/**
 * Check if this is an AJIO warehouse order (not a real customer)
 */
function isWarehouseOrder(channel: string, customerName: string | null, city: string | null): boolean {
  if (channel !== 'ajio') return false;
  const combined = `${customerName ?? ''} ${city ?? ''}`.toLowerCase();
  return combined.includes('ajio') || combined.includes('unit 106') || combined.includes('sangram complex');
}

/**
 * Parse CSV buffer into BtReportRow array
 */
async function parseCSVBuffer(buffer: Buffer): Promise<BtReportRow[]> {
  const rows: BtReportRow[] = [];
  await new Promise<void>((resolve, reject) => {
    const stream = Readable.from(buffer.toString());
    stream
      .pipe(parse({ headers: true, trim: true }))
      .on('data', (row: BtReportRow) => rows.push(row))
      .on('end', resolve)
      .on('error', reject);
  });
  return rows;
}

/**
 * Upsert a single row into ChannelOrderLine (analytics table).
 * Extracted from the /import endpoint so both analytics + order import can use it.
 */
async function upsertChannelOrderLine(
  prismaClient: import('@prisma/client').PrismaClient,
  row: BtReportRow,
  importBatchId: string,
): Promise<void> {
  const channelOrderId = row['Order Id']!.trim();
  const channelItemId = row['Item ID']!.trim();
  const channel = normalizeChannel(row['Channel Name']);

  const lineData = {
    channel,
    channelOrderId,
    channelRef: row['Channel Ref']?.trim() || null,
    channelItemId,
    orderDate: parseDate(row['Order Date(IST)'], row['Order Time(IST)'])!,
    orderType: row['Order Type']?.trim() || 'Unknown',
    financialStatus: row['Financial Status']?.trim() || null,
    fulfillmentStatus: row['Fulfillment Status']?.trim() || null,
    skuCode: row['SKU Codes']?.trim() || 'UNKNOWN',
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
    importBatchId,
  };

  await prismaClient.channelOrderLine.upsert({
    where: {
      channel_channelOrderId_channelItemId: { channel, channelOrderId, channelItemId },
    },
    create: lineData,
    update: { ...lineData, importedAt: new Date() },
  });
}

// ============================================
// PREVIEW + EXECUTE ORDER IMPORT TYPES
// ============================================

interface PreviewLine {
  channelItemId: string;
  skuCode: string;
  skuId: string | null;
  skuMatched: boolean;
  skuTitle: string | null;
  qty: number;
  unitPrice: number;
  fulfillmentStatus: string;
  previousStatus?: string;
  courierName: string | null;
  awbNumber: string | null;
  dispatchDate: string | null;
  manifestedDate: string | null;
  deliveryDate: string | null;
}

interface PreviewOrder {
  channelOrderId: string;
  channelRef: string;
  channel: string;
  importStatus: 'new' | 'existing_unchanged' | 'existing_updated';
  existingOrderId?: string;
  orderDate: string;
  orderType: string;
  customerName: string | null;
  customerPhone: string | null;
  address1: string | null;
  address2: string | null;
  city: string | null;
  state: string | null;
  zip: string | null;
  dispatchByDate: string | null;
  lines: PreviewLine[];
  totalAmount: number;
}

interface PreviewResponse {
  orders: PreviewOrder[];
  summary: {
    totalOrders: number;
    newOrders: number;
    existingUnchanged: number;
    existingUpdated: number;
    unmatchedSkus: string[];
  };
  cacheKey: string;
}

// ============================================
// IMPORT CHANNEL DATA (analytics-only)
// ============================================

router.post('/import', authenticateToken, upload.single('file'), async (req: Request, res: Response) => {
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
});

// ============================================
// PREVIEW ORDER IMPORT
// ============================================

router.post('/preview-import', authenticateToken, upload.single('file'), async (req: Request, res: Response) => {
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

    // Group rows by Order Id
    const orderGroups = new Map<string, BtReportRow[]>();
    for (const row of rows) {
      const orderId = row['Order Id']?.trim();
      if (!orderId) continue;
      const group = orderGroups.get(orderId) || [];
      group.push(row);
      orderGroups.set(orderId, group);
    }

    // Collect all unique SKU codes for batch lookup
    const allSkuCodes = new Set<string>();
    for (const group of orderGroups.values()) {
      for (const row of group) {
        const code = row['SKU Codes']?.trim();
        if (code) allSkuCodes.add(code);
      }
    }

    // Batch lookup: SKUs by skuCode or shopifyVariantId
    const skuCodesArray = Array.from(allSkuCodes);
    const matchedSkus = skuCodesArray.length > 0
      ? await req.prisma.sku.findMany({
          where: {
            OR: [
              { skuCode: { in: skuCodesArray } },
              { shopifyVariantId: { in: skuCodesArray } },
            ],
          },
          select: { id: true, skuCode: true, shopifyVariantId: true },
        })
      : [];

    // Build SKU lookup map (code → sku)
    const skuMap = new Map<string, { id: string; skuCode: string }>();
    for (const sku of matchedSkus) {
      skuMap.set(sku.skuCode, sku);
      if (sku.shopifyVariantId) {
        skuMap.set(sku.shopifyVariantId, sku);
      }
    }

    // Collect all channelRefs + alternate formats for batch lookup of existing orders
    // Myntra: CSV has full UUID "abc12345-xxxx-...", old imports stored first 8 chars "abc12345"
    // Nykaa: CSV has "NYK-xxx-xxx-x-x--1", old imports stored "NYK-xxx-xxx-x-x"
    const allChannelRefs = new Set<string>();
    const alternateRefs = new Map<string, string>(); // alternate → full CSV ref
    for (const group of orderGroups.values()) {
      const ref = group[0]['Channel Ref']?.trim();
      if (!ref) continue;
      allChannelRefs.add(ref);
      const channel = normalizeChannel(group[0]['Channel Name']);
      if (channel === 'myntra' && ref.includes('-')) {
        const short = ref.split('-')[0];
        allChannelRefs.add(short);
        alternateRefs.set(short, ref);
      }
      if (channel === 'nykaa' && ref.endsWith('--1')) {
        const trimmed = ref.slice(0, -3); // strip "--1"
        allChannelRefs.add(trimmed);
        alternateRefs.set(trimmed, ref);
      }
    }

    const existingOrders = allChannelRefs.size > 0
      ? await req.prisma.order.findMany({
          where: { orderNumber: { in: Array.from(allChannelRefs) } },
          include: { orderLines: { select: { id: true, channelItemId: true, channelFulfillmentStatus: true, courier: true, awbNumber: true } } },
        })
      : [];
    // Map by both exact orderNumber AND resolve alternates back to full CSV ref
    const existingOrderMap = new Map<string, typeof existingOrders[0]>();
    for (const o of existingOrders) {
      existingOrderMap.set(o.orderNumber, o);
      const fullRef = alternateRefs.get(o.orderNumber);
      if (fullRef) existingOrderMap.set(fullRef, o);
    }

    // Build preview orders
    const previewOrders: PreviewOrder[] = [];
    const unmatchedSkus = new Set<string>();

    for (const [btOrderId, group] of orderGroups) {
      const firstRow = group[0];
      const channelRef = firstRow['Channel Ref']?.trim() || btOrderId;
      const channel = normalizeChannel(firstRow['Channel Name']);
      const orderDate = parseDate(firstRow['Order Date(IST)'], firstRow['Order Time(IST)']);
      const dispatchByDate = parseDate(firstRow['Dispatch By Date']);

      const existingOrder = existingOrderMap.get(channelRef);

      // Build lines
      const lines: PreviewLine[] = [];
      let anyLineChanged = false;
      for (const row of group) {
        const skuCode = row['SKU Codes']?.trim() || '';
        const matched = skuMap.get(skuCode);
        if (!matched) unmatchedSkus.add(skuCode);

        const fulfillmentStatus = row['Fulfillment Status']?.trim() || '';
        const channelItemId = row['Item ID']?.trim() || '';

        // Check if this line exists on the existing order
        let previousStatus: string | undefined;
        let lineChanged = false;
        const csvCourier = row['Courier Name']?.trim() || null;
        const csvAwb = row['Courier Tracking Number']?.trim() || null;

        if (existingOrder) {
          const existingLine = existingOrder.orderLines.find(l => l.channelItemId === channelItemId);
          if (existingLine) {
            // Check fulfillment status change
            if (existingLine.channelFulfillmentStatus && existingLine.channelFulfillmentStatus !== fulfillmentStatus) {
              previousStatus = existingLine.channelFulfillmentStatus;
              lineChanged = true;
            }
            // Check courier or AWB change
            if ((csvCourier && csvCourier !== existingLine.courier) ||
                (csvAwb && csvAwb !== existingLine.awbNumber)) {
              lineChanged = true;
            }
          }
        }

        lines.push({
          channelItemId,
          skuCode,
          skuId: matched?.id ?? null,
          skuMatched: !!matched,
          skuTitle: row['SKU Titles']?.trim() || null,
          qty: parseIntSafe(row['Quantity'], 1),
          unitPrice: parsePriceToRupees(row["Buyer's Price"]),
          fulfillmentStatus,
          ...(previousStatus ? { previousStatus } : {}),
          courierName: csvCourier,
          awbNumber: csvAwb,
          dispatchDate: parseDate(row['Dispatch Date'])?.toISOString() || null,
          manifestedDate: parseDate(row['Manifested Date'])?.toISOString() || null,
          deliveryDate: parseDate(row['Channel Delivery Date'])?.toISOString() || null,
        });

        if (lineChanged) anyLineChanged = true;
      }

      // Determine import status
      let importStatus: PreviewOrder['importStatus'] = 'new';
      if (existingOrder) {
        importStatus = anyLineChanged ? 'existing_updated' : 'existing_unchanged';
      }

      const totalAmount = lines.reduce((sum, l) => sum + l.unitPrice * l.qty, 0);

      const customerName = firstRow['Customer Name']?.trim() || null;
      const rawPhone = firstRow['Phone']?.trim() || null;
      const customerPhone = isPlaceholderPhone(rawPhone) ? null : rawPhone;
      const city = firstRow['City']?.trim() || null;
      const warehouse = isWarehouseOrder(channel, customerName, city);

      previewOrders.push({
        channelOrderId: btOrderId,
        channelRef,
        channel,
        importStatus,
        ...(existingOrder ? { existingOrderId: existingOrder.id } : {}),
        orderDate: orderDate?.toISOString() || '',
        orderType: firstRow['Order Type']?.trim() || 'Unknown',
        customerName: warehouse ? null : customerName,
        customerPhone: warehouse ? null : customerPhone,
        address1: warehouse ? null : (firstRow['Address Line 1']?.trim() || null),
        address2: warehouse ? null : (firstRow['Address Line 2']?.trim() || null),
        city: warehouse ? null : city,
        state: warehouse ? null : (firstRow['State']?.trim() || null),
        zip: warehouse ? null : (firstRow['Zip']?.trim() || null),
        dispatchByDate: dispatchByDate?.toISOString() || null,
        lines,
        totalAmount,
      });
    }

    // Sort: new first, then updated, then unchanged
    const statusOrder = { new: 0, existing_updated: 1, existing_unchanged: 2 };
    previewOrders.sort((a, b) => statusOrder[a.importStatus] - statusOrder[b.importStatus]);

    const summary = {
      totalOrders: previewOrders.length,
      newOrders: previewOrders.filter(o => o.importStatus === 'new').length,
      existingUnchanged: previewOrders.filter(o => o.importStatus === 'existing_unchanged').length,
      existingUpdated: previewOrders.filter(o => o.importStatus === 'existing_updated').length,
      unmatchedSkus: Array.from(unmatchedSkus).filter(Boolean),
    };

    // Store parsed rows in server-side cache (avoids sending full CSV back to client)
    cleanCSVCache();
    const cacheKey = randomUUID();
    csvCache.set(cacheKey, { rows, expiresAt: Date.now() + CSV_CACHE_TTL_MS });

    const response: PreviewResponse = { orders: previewOrders, summary, cacheKey };
    res.json(response);
  } catch (error) {
    console.error('Preview import error:', error);
    res.status(500).json({ error: 'Failed to preview import' });
  }
});

// ============================================
// EXECUTE ORDER IMPORT
// ============================================

router.post('/execute-import', authenticateToken, async (req: Request, res: Response) => {
  try {
    const { selectedOrders, cacheKey, filename } = req.body as {
      selectedOrders: PreviewOrder[];
      cacheKey: string;
      filename: string;
    };

    if (!selectedOrders || selectedOrders.length === 0) {
      res.status(400).json({ error: 'No orders selected' });
      return;
    }

    // Look up cached CSV rows
    const cached = cacheKey ? csvCache.get(cacheKey) : null;
    const rawRows: BtReportRow[] = cached?.rows ?? [];
    if (cached) csvCache.delete(cacheKey); // One-time use

    const userId = (req as unknown as { user?: { userId?: string } }).user?.userId;

    // Create import batch
    const importBatch = await req.prisma.channelImportBatch.create({
      data: {
        channel: 'multiple',
        filename: filename || 'channel-import.csv',
        rowsTotal: rawRows.length,
        rowsImported: 0,
        rowsSkipped: 0,
        rowsUpdated: 0,
        importedBy: userId,
        importType: 'order_import',
      },
    });

    // Separate orders by type
    const newOrders = selectedOrders.filter(o => o.importStatus === 'new');
    const updatedOrders = selectedOrders.filter(o => o.importStatus === 'existing_updated' && o.existingOrderId);
    const totalOrders = newOrders.length + updatedOrders.length;

    // SSE streaming for progress
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no');

    const sendProgress = (data: Record<string, unknown>) => {
      res.write(`data: ${JSON.stringify(data)}\n\n`);
    };

    let ordersCreated = 0;
    let ordersUpdated = 0;
    const errors: Array<{ order: string; error: string }> = [];
    const processingOrders: Array<{ id: string; orderNumber: string }> = [];

    const CHUNK_SIZE = 20;

    // ---- Process NEW orders in chunked transactions ----
    for (let i = 0; i < newOrders.length; i += CHUNK_SIZE) {
      const chunk = newOrders.slice(i, i + CHUNK_SIZE);
      try {
        const chunkResult = await req.prisma.$transaction(async (tx) => {
          const created: Array<{ id: string; orderNumber: string }> = [];
          const chunkErrors: Array<{ order: string; error: string }> = [];

          for (const previewOrder of chunk) {
            try {
              const matchedLines = previewOrder.lines.filter(l => l.skuMatched && l.skuId);
              if (matchedLines.length === 0) {
                chunkErrors.push({ order: previewOrder.channelRef, error: 'No matched SKUs' });
                continue;
              }

              const isCOD = previewOrder.orderType?.toUpperCase() === 'COD';
              const totalAmount = matchedLines.reduce((sum, l) => sum + l.unitPrice * l.qty, 0);

              let shippingAddress: string | null = null;
              if (previewOrder.city || previewOrder.state || previewOrder.zip || previewOrder.address1) {
                shippingAddress = JSON.stringify({
                  address1: previewOrder.address1 || '',
                  address2: previewOrder.address2 || '',
                  city: previewOrder.city || '',
                  state: previewOrder.state || '',
                  zip: previewOrder.zip || '',
                });
              }

              const shipByDate = previewOrder.dispatchByDate ? new Date(previewOrder.dispatchByDate) : null;

              const order = await tx.order.create({
                data: {
                  orderNumber: previewOrder.channelRef,
                  channel: previewOrder.channel,
                  channelOrderId: previewOrder.channelOrderId,
                  customerName: previewOrder.customerName || 'Channel Customer',
                  customerPhone: previewOrder.customerPhone || null,
                  shippingAddress,
                  orderDate: new Date(previewOrder.orderDate),
                  totalAmount,
                  paymentMethod: isCOD ? 'COD' : 'Prepaid',
                  paymentStatus: isCOD ? 'pending' : 'paid',
                  status: 'open',
                  ...(shipByDate && !isNaN(shipByDate.getTime()) ? { shipByDate } : {}),
                  orderLines: {
                    create: matchedLines.map(line => {
                      const status = line.fulfillmentStatus?.toLowerCase() || '';
                      const isShipped = status === 'shipped' || status === 'delivered' || status === 'manifested';
                      const isDelivered = status === 'delivered';
                      const isCancelled = status === 'cancelled';
                      const lineStatus = isDelivered ? 'delivered' : isShipped ? 'shipped' : isCancelled ? 'cancelled' : 'pending';
                      return {
                        skuId: line.skuId!,
                        qty: Math.max(line.qty, 1),
                        unitPrice: line.unitPrice,
                        lineStatus,
                        channelFulfillmentStatus: line.fulfillmentStatus || null,
                        channelItemId: line.channelItemId,
                        courier: line.courierName || null,
                        awbNumber: line.awbNumber || null,
                        ...(isShipped ? { shippedAt: line.dispatchDate ? new Date(line.dispatchDate) : new Date() } : {}),
                        ...(isDelivered ? { deliveredAt: line.deliveryDate ? new Date(line.deliveryDate) : new Date() } : {}),
                      };
                    }),
                  },
                },
              });

              // Link ChannelOrderLines to this Order + OrderLines
              const createdLines = await tx.orderLine.findMany({
                where: { orderId: order.id },
                select: { id: true, channelItemId: true },
              });
              const lineIdMap = new Map(createdLines.filter(l => l.channelItemId).map(l => [l.channelItemId!, l.id]));

              // Batch: set orderId for all lines at once
              await tx.channelOrderLine.updateMany({
                where: {
                  channel: previewOrder.channel,
                  channelOrderId: previewOrder.channelOrderId,
                  channelItemId: { in: matchedLines.map(l => l.channelItemId) },
                },
                data: { orderId: order.id },
              });

              // Parallel: set orderLineId for lines that have a mapping
              const orderLineUpdates = matchedLines
                .filter(l => lineIdMap.has(l.channelItemId))
                .map(l => tx.channelOrderLine.updateMany({
                  where: {
                    channel: previewOrder.channel,
                    channelOrderId: previewOrder.channelOrderId,
                    channelItemId: l.channelItemId,
                  },
                  data: { orderLineId: lineIdMap.get(l.channelItemId)! },
                }));
              await Promise.all(orderLineUpdates);

              // Recompute order status inside transaction
              await recomputeOrderStatus(order.id, tx);

              created.push({ id: order.id, orderNumber: previewOrder.channelRef });

              // Track processing orders for sheet push
              const hasProcessing = matchedLines.some(l => l.fulfillmentStatus?.toLowerCase() === 'processing');
              if (hasProcessing) {
                processingOrders.push({ id: order.id, orderNumber: previewOrder.channelRef });
              }
            } catch (orderError) {
              const msg = orderError instanceof Error ? orderError.message : 'Unknown error';
              chunkErrors.push({ order: previewOrder.channelRef, error: msg });
            }
          }

          return { created: created.length, errors: chunkErrors };
        }, { timeout: 30000 });

        ordersCreated += chunkResult.created;
        errors.push(...chunkResult.errors);
      } catch (chunkError) {
        // Entire chunk rolled back
        const msg = chunkError instanceof Error ? chunkError.message : 'Unknown error';
        for (const o of chunk) {
          errors.push({ order: o.channelRef, error: `Chunk failed: ${msg}` });
        }
      }

      sendProgress({
        type: 'progress',
        completed: ordersCreated + ordersUpdated + errors.length,
        total: totalOrders,
        created: ordersCreated,
        updated: ordersUpdated,
        errors: errors.length,
      });
    }

    // ---- Process UPDATED orders in chunked transactions ----
    for (let i = 0; i < updatedOrders.length; i += CHUNK_SIZE) {
      const chunk = updatedOrders.slice(i, i + CHUNK_SIZE);
      try {
        const chunkResult = await req.prisma.$transaction(async (tx) => {
          let chunkUpdated = 0;
          const chunkErrors: Array<{ order: string; error: string }> = [];

          for (const previewOrder of chunk) {
            try {
              const shipByDate = previewOrder.dispatchByDate ? new Date(previewOrder.dispatchByDate) : null;
              if (shipByDate && !isNaN(shipByDate.getTime())) {
                await tx.order.update({
                  where: { id: previewOrder.existingOrderId! },
                  data: { shipByDate },
                });
              }

              const existingLines = await tx.orderLine.findMany({
                where: { orderId: previewOrder.existingOrderId! },
                select: { id: true, channelItemId: true, lineStatus: true },
              });
              const existingLineMap = new Map(existingLines.map(l => [l.channelItemId, { id: l.id, lineStatus: l.lineStatus }]));

              // Parallel: update existing order lines
              const existingLineUpdates = previewOrder.lines
                .filter(line => existingLineMap.has(line.channelItemId))
                .map(line => {
                  const existing = existingLineMap.get(line.channelItemId)!;
                  const status = line.fulfillmentStatus?.toLowerCase() || '';
                  const isShipped = status === 'shipped' || status === 'delivered' || status === 'manifested';
                  const isDelivered = status === 'delivered';
                  const isCancelled = status === 'cancelled';

                  let newLineStatus: string | undefined;
                  if (existing.lineStatus === 'pending') {
                    if (isDelivered) newLineStatus = 'delivered';
                    else if (isShipped) newLineStatus = 'shipped';
                    else if (isCancelled) newLineStatus = 'cancelled';
                  } else if (existing.lineStatus === 'shipped' && isDelivered) {
                    newLineStatus = 'delivered';
                  }

                  return tx.orderLine.update({
                    where: { id: existing.id },
                    data: {
                      channelFulfillmentStatus: line.fulfillmentStatus || null,
                      ...(line.courierName ? { courier: line.courierName } : {}),
                      ...(line.awbNumber ? { awbNumber: line.awbNumber } : {}),
                      ...(isShipped && line.dispatchDate ? { shippedAt: new Date(line.dispatchDate) } : {}),
                      ...(isDelivered && line.deliveryDate ? { deliveredAt: new Date(line.deliveryDate) } : {}),
                      ...(newLineStatus ? { lineStatus: newLineStatus } : {}),
                    },
                  });
                });
              await Promise.all(existingLineUpdates);

              // Batch: link channelOrderLines for existing lines
              const existingChannelItemIds = previewOrder.lines
                .filter(line => existingLineMap.has(line.channelItemId))
                .map(line => line.channelItemId);
              if (existingChannelItemIds.length > 0) {
                // Set orderId for all at once
                await tx.channelOrderLine.updateMany({
                  where: {
                    channel: previewOrder.channel,
                    channelOrderId: previewOrder.channelOrderId,
                    channelItemId: { in: existingChannelItemIds },
                  },
                  data: { orderId: previewOrder.existingOrderId },
                });
                // Set orderLineId in parallel
                const channelLineUpdates = existingChannelItemIds.map(channelItemId => {
                  const existing = existingLineMap.get(channelItemId)!;
                  return tx.channelOrderLine.updateMany({
                    where: {
                      channel: previewOrder.channel,
                      channelOrderId: previewOrder.channelOrderId,
                      channelItemId,
                    },
                    data: { orderLineId: existing.id },
                  });
                });
                await Promise.all(channelLineUpdates);
              }

              // New lines: must create sequentially (need newLine.id), but link in parallel after
              const newLines = previewOrder.lines.filter(line => !existingLineMap.has(line.channelItemId) && line.skuId);
              const newLineResults: Array<{ channelItemId: string; orderLineId: string }> = [];
              for (const line of newLines) {
                const status = line.fulfillmentStatus?.toLowerCase() || '';
                const isShipped = status === 'shipped' || status === 'delivered' || status === 'manifested';
                const isDelivered = status === 'delivered';
                const isCancelled = status === 'cancelled';
                const initialLineStatus = isDelivered ? 'delivered' : isShipped ? 'shipped' : isCancelled ? 'cancelled' : 'pending';

                const newLine = await tx.orderLine.create({
                  data: {
                    orderId: previewOrder.existingOrderId!,
                    skuId: line.skuId!,
                    qty: line.qty,
                    unitPrice: line.unitPrice,
                    lineStatus: initialLineStatus,
                    channelFulfillmentStatus: line.fulfillmentStatus || null,
                    channelItemId: line.channelItemId,
                    courier: line.courierName || null,
                    awbNumber: line.awbNumber || null,
                    ...(isShipped ? { shippedAt: line.dispatchDate ? new Date(line.dispatchDate) : new Date() } : {}),
                    ...(isDelivered ? { deliveredAt: line.deliveryDate ? new Date(line.deliveryDate) : new Date() } : {}),
                  },
                });
                newLineResults.push({ channelItemId: line.channelItemId, orderLineId: newLine.id });
              }

              // Batch link new channelOrderLines
              if (newLineResults.length > 0) {
                await tx.channelOrderLine.updateMany({
                  where: {
                    channel: previewOrder.channel,
                    channelOrderId: previewOrder.channelOrderId,
                    channelItemId: { in: newLineResults.map(r => r.channelItemId) },
                  },
                  data: { orderId: previewOrder.existingOrderId },
                });
                const newChannelLineUpdates = newLineResults.map(r =>
                  tx.channelOrderLine.updateMany({
                    where: {
                      channel: previewOrder.channel,
                      channelOrderId: previewOrder.channelOrderId,
                      channelItemId: r.channelItemId,
                    },
                    data: { orderLineId: r.orderLineId },
                  })
                );
                await Promise.all(newChannelLineUpdates);
              }

              await recomputeOrderStatus(previewOrder.existingOrderId!, tx);
              chunkUpdated++;
            } catch (orderError) {
              const msg = orderError instanceof Error ? orderError.message : 'Unknown error';
              chunkErrors.push({ order: previewOrder.channelRef, error: msg });
            }
          }

          return { updated: chunkUpdated, errors: chunkErrors };
        }, { timeout: 30000 });

        ordersUpdated += chunkResult.updated;
        errors.push(...chunkResult.errors);
      } catch (chunkError) {
        const msg = chunkError instanceof Error ? chunkError.message : 'Unknown error';
        for (const o of chunk) {
          errors.push({ order: o.channelRef, error: `Chunk failed: ${msg}` });
        }
      }

      sendProgress({
        type: 'progress',
        completed: ordersCreated + ordersUpdated + errors.length,
        total: totalOrders,
        created: ordersCreated,
        updated: ordersUpdated,
        errors: errors.length,
      });
    }

    // Update batch record with order counts
    await req.prisma.channelImportBatch.update({
      where: { id: importBatch.id },
      data: { ordersCreated, ordersUpdated },
    });

    // Build channel detail updates for sheet (used by deferred task)
    const channelDetailUpdates = selectedOrders.flatMap(order =>
      order.lines
        .filter(l => l.skuMatched && (l.fulfillmentStatus || l.courierName || l.awbNumber))
        .map(l => ({
          orderNumber: order.channelRef,
          skuCode: l.skuCode,
          channelStatus: l.fulfillmentStatus || null,
          courier: l.courierName || null,
          awb: l.awbNumber || null,
        }))
    );

    // ---- Inline: Batched sheet push (single API call) ----
    let sheetResult: { pushed: number; failed: number; errors: string[] } | null = null;
    if (processingOrders.length > 0) {
      sendProgress({ type: 'sheet_sync', status: 'started', total: processingOrders.length });
      try {
        const batchResult = await batchPushOrdersToSheet(processingOrders.map(o => o.id));
        sheetResult = { pushed: batchResult.pushed + batchResult.alreadyOnSheet, failed: batchResult.failed, errors: batchResult.errors };
        sendProgress({
          type: 'sheet_sync',
          status: batchResult.failed > 0 ? 'partial' : 'done',
          pushed: sheetResult.pushed,
          failed: batchResult.failed,
          total: processingOrders.length,
        });
      } catch (err) {
        const msg = err instanceof Error ? err.message : 'Sheet sync failed';
        sheetResult = { pushed: 0, failed: processingOrders.length, errors: [msg] };
        sendProgress({ type: 'sheet_sync', status: 'failed', error: msg });
      }
    }

    // ---- Deferred: Sheet detail updates (runs after pushes — FIFO) ----
    if (channelDetailUpdates.length > 0) {
      const updates = [...channelDetailUpdates];
      deferredExecutor.enqueue(async () => {
        try {
          await updateSheetChannelDetails(updates);
        } catch (err) {
          console.error('Deferred sheet detail update failed:', err);
        }
      }, { action: 'channel_sheet_details' });
    }

    // ---- Deferred: Analytics upserts (lowest priority) ----
    if (rawRows.length > 0) {
      const batchId = importBatch.id;
      const rowsCopy = [...rawRows];
      deferredExecutor.enqueue(async () => {
        let upserted = 0;
        let skipped = 0;
        for (const row of rowsCopy) {
          try {
            const oid = row['Order Id']?.trim();
            const iid = row['Item ID']?.trim();
            if (!oid || !iid || !parseDate(row['Order Date(IST)'], row['Order Time(IST)'])) {
              skipped++;
              continue;
            }
            await upsertChannelOrderLine(prisma, row, batchId);
            upserted++;
          } catch {
            skipped++;
          }
        }
        await prisma.channelImportBatch.update({
          where: { id: batchId },
          data: { rowsImported: upserted, rowsSkipped: skipped },
        });
      }, { action: 'channel_analytics' });
    }

    // Send final complete event
    sendProgress({
      type: 'complete',
      batchId: importBatch.id,
      ordersCreated,
      ordersUpdated,
      errors: errors.slice(0, 20),
      ...(sheetResult ? { sheetSync: sheetResult } : {}),
    });
    res.end();
  } catch (error) {
    console.error('Execute import error:', error);
    res.status(500).json({ error: 'Failed to execute import' });
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
