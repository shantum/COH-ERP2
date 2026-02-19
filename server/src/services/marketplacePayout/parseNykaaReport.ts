import ExcelJS from 'exceljs';
import crypto from 'crypto';
import logger from '../../utils/logger.js';

const log = logger.child({ module: 'parseNykaaReport' });

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface NykaaOrderLine {
  nykaaOrderNo: string;
  baseOrderNo: string; // first 3 hyphen segments
  sku: string;
  mrp: number;
  nsv: number;
  commission: number;
  shippingCharge: number;
  returnCharge: number;
  tcs: number;
  finalPayout: number;
  finalStatus: string;
}

export interface ParsedNykaaReport {
  marketplace: 'nykaa_nf' | 'nykaa_popup';
  fileHash: string;

  // From Payout_Summary
  bannerDeduction: number;
  tdsAmount: number;
  otherIncome: number;
  netPayout: number;

  // Computed from order lines
  grossRevenue: number;
  totalCommission: number;
  shippingCharges: number;
  returnCharges: number;

  // Order stats
  orderLines: NykaaOrderLine[];
  deliveredCount: number;
  returnCount: number;
  cancelledCount: number;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Round to 2 decimal places. */
function r2(n: number): number {
  return Math.round(n * 100) / 100;
}

/** Safely coerce a cell value to number, returning 0 for blanks/non-numeric. */
function toNum(val: ExcelJS.CellValue): number {
  if (val === null || val === undefined) return 0;
  const n = Number(val);
  return Number.isFinite(n) ? n : 0;
}

/** Safely coerce a cell value to string. */
function toStr(val: ExcelJS.CellValue): string {
  if (val === null || val === undefined) return '';
  return String(val).trim();
}

/** Extract first 3 hyphen-separated segments: "BN-NFC-123456789-xxx" -> "BN-NFC-123456789" */
function extractBaseOrderNo(orderNo: string): string {
  const parts = orderNo.split('-');
  if (parts.length >= 3) {
    return parts.slice(0, 3).join('-');
  }
  return orderNo;
}

/**
 * Build a map of column-name -> column-index from the header row.
 * Normalises names to lowercase trimmed strings for resilient matching.
 */
function buildColumnMap(row: ExcelJS.Row): Map<string, number> {
  const map = new Map<string, number>();
  row.eachCell({ includeEmpty: false }, (cell, colNumber) => {
    const name = toStr(cell.value).toLowerCase();
    if (name) {
      map.set(name, colNumber);
    }
  });
  return map;
}

/**
 * Find a column index by trying multiple candidate names (all lowercased).
 * Returns undefined if none found.
 */
function findCol(colMap: Map<string, number>, ...candidates: string[]): number | undefined {
  for (const c of candidates) {
    const idx = colMap.get(c);
    if (idx !== undefined) return idx;
  }
  // Partial match fallback — useful for columns like "nsv= net sale value"
  for (const c of candidates) {
    for (const [key, idx] of colMap.entries()) {
      if (key.includes(c)) return idx;
    }
  }
  return undefined;
}

// ---------------------------------------------------------------------------
// Payout Summary parsing
// ---------------------------------------------------------------------------

interface PayoutSummaryData {
  marketplace: 'nykaa_nf' | 'nykaa_popup';
  bannerDeduction: number;
  tdsAmount: number;
  otherIncome: number;
  netPayout: number;
}

function parsePayoutSummary(sheet: ExcelJS.Worksheet): PayoutSummaryData {
  let marketplace: 'nykaa_nf' | 'nykaa_popup' = 'nykaa_nf';
  let bannerDeduction = 0;
  let tdsAmount = 0;
  let otherIncome = 0;
  let netPayout = 0;

  // Walk every row looking for label/value pairs.
  // Nykaa summary sheets use a two-column layout: label in col A, value in col B (or nearby).
  sheet.eachRow((row) => {
    const cells: string[] = [];
    row.eachCell({ includeEmpty: true }, (cell) => {
      cells.push(toStr(cell.value).toLowerCase());
    });

    const rowText = cells.join(' ');

    // Detect NF vs POPUP from "Common Name" or any cell mentioning it
    if (rowText.includes('common name') || rowText.includes('commonname')) {
      if (rowText.includes('popup')) {
        marketplace = 'nykaa_popup';
      } else if (rowText.includes('nf')) {
        marketplace = 'nykaa_nf';
      }
    }

    // Also detect from any cell containing NF / POPUP if we haven't overridden
    if (rowText.includes('popup') && !rowText.includes('common name')) {
      // Only override if "popup" appears as an identifier, not in generic text
      for (let c = 1; c <= row.cellCount; c++) {
        const v = toStr(row.getCell(c).value).toUpperCase();
        if (v === 'POPUP' || v.includes('POPUP')) {
          marketplace = 'nykaa_popup';
        }
      }
    }

    // Extract monetary values — look for known labels then grab the numeric cell
    const numericValue = (): number => {
      for (let c = 1; c <= row.cellCount; c++) {
        const n = toNum(row.getCell(c).value);
        if (n !== 0) return n;
      }
      return 0;
    };

    if (rowText.includes('banner deduction')) {
      bannerDeduction = r2(numericValue());
    } else if (rowText.includes('tds')) {
      tdsAmount = r2(numericValue());
    } else if (rowText.includes('other income')) {
      otherIncome = r2(numericValue());
    } else if (rowText.includes('net payout') || rowText.includes('net pay out')) {
      netPayout = r2(numericValue());
    }
  });

  log.info({ marketplace, bannerDeduction, tdsAmount, otherIncome, netPayout }, 'Parsed Payout_Summary');
  return { marketplace, bannerDeduction, tdsAmount, otherIncome, netPayout };
}

// ---------------------------------------------------------------------------
// Order sheet parsing
// ---------------------------------------------------------------------------

function parseOrderSheet(sheet: ExcelJS.Worksheet): NykaaOrderLine[] {
  const lines: NykaaOrderLine[] = [];

  // Find header row — first row where we can identify known columns
  let headerRow: ExcelJS.Row | undefined;
  let colMap: Map<string, number> | undefined;

  sheet.eachRow((row, rowNumber) => {
    if (headerRow) return; // already found
    const candidate = buildColumnMap(row);
    // Check for a known column to confirm this is the header
    if (findCol(candidate, 'nykaa_orderno', 'nykaa orderno', 'orderno')) {
      headerRow = row;
      colMap = candidate;
      log.debug({ sheet: sheet.name, headerRow: rowNumber, columns: Array.from(candidate.keys()) }, 'Found header row');
    }
  });

  if (!headerRow || !colMap) {
    log.warn({ sheet: sheet.name }, 'Could not find header row in order sheet — skipping');
    return lines;
  }

  // Resolve column indices
  const colOrderNo = findCol(colMap, 'nykaa_orderno', 'nykaa orderno', 'orderno');
  const colSku = findCol(colMap, 'vendor sku', 'sku');
  const colMrp = findCol(colMap, 'mrp');
  const colNsv = findCol(colMap, 'nsv', 'nsv=', 'net sale value');
  const colCommission = findCol(colMap, 'final commission amt per unit', 'commission amt', 'commission');
  const colShipping = findCol(colMap, 'shipping charges', 'shipping charge');
  const colReturn = findCol(colMap, 'return charges', 'return charge');
  const colTcs = findCol(colMap, 'tcs amt per unit', 'tcs amt', 'tcs');
  const colFinalPayout = findCol(colMap, 'final payout', 'finalpayout');
  const colStatus = findCol(colMap, 'finalstatus', 'final status', 'status');

  // Warn about missing columns
  const missing: string[] = [];
  if (!colOrderNo) missing.push('nykaa_orderno');
  if (!colSku) missing.push('sku');
  if (!colMrp) missing.push('mrp');
  if (!colNsv) missing.push('nsv');
  if (!colCommission) missing.push('commission');
  if (!colShipping) missing.push('shipping');
  if (!colReturn) missing.push('return');
  if (!colTcs) missing.push('tcs');
  if (!colFinalPayout) missing.push('final payout');
  if (!colStatus) missing.push('finalstatus');
  if (missing.length > 0) {
    log.warn({ sheet: sheet.name, missing }, 'Some columns not found — values will default to 0/empty');
  }

  const headerRowNumber = headerRow.number;

  sheet.eachRow((row, rowNumber) => {
    if (rowNumber <= headerRowNumber) return; // skip header and above

    const orderNo = colOrderNo ? toStr(row.getCell(colOrderNo).value) : '';
    if (!orderNo) return; // skip empty rows

    lines.push({
      nykaaOrderNo: orderNo,
      baseOrderNo: extractBaseOrderNo(orderNo),
      sku: colSku ? toStr(row.getCell(colSku).value) : '',
      mrp: r2(colMrp ? toNum(row.getCell(colMrp).value) : 0),
      nsv: r2(colNsv ? toNum(row.getCell(colNsv).value) : 0),
      commission: r2(colCommission ? toNum(row.getCell(colCommission).value) : 0),
      shippingCharge: r2(colShipping ? toNum(row.getCell(colShipping).value) : 0),
      returnCharge: r2(colReturn ? toNum(row.getCell(colReturn).value) : 0),
      tcs: r2(colTcs ? toNum(row.getCell(colTcs).value) : 0),
      finalPayout: r2(colFinalPayout ? toNum(row.getCell(colFinalPayout).value) : 0),
      finalStatus: colStatus ? toStr(row.getCell(colStatus).value) : '',
    });
  });

  log.info({ sheet: sheet.name, lineCount: lines.length }, 'Parsed order sheet');
  return lines;
}

// ---------------------------------------------------------------------------
// Main parser
// ---------------------------------------------------------------------------

export async function parseNykaaReport(buffer: Buffer): Promise<ParsedNykaaReport> {
  const fileHash = crypto.createHash('sha256').update(buffer).digest('hex');
  log.info({ fileHash, bufferSize: buffer.length }, 'Starting Nykaa report parse');

  const workbook = new ExcelJS.Workbook();
  try {
    await workbook.xlsx.load(buffer as unknown as ExcelJS.Buffer);
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : 'Unknown error';
    log.error({ error: msg }, 'Failed to load XLSX workbook');
    throw new Error(`Failed to load Nykaa XLSX report: ${msg}`);
  }

  // 1. Parse Payout_Summary sheet
  const summarySheet = workbook.worksheets.find(
    (ws) => ws.name.toLowerCase().replace(/\s+/g, '_') === 'payout_summary'
  );

  if (!summarySheet) {
    log.error(
      { sheets: workbook.worksheets.map((ws) => ws.name) },
      'Payout_Summary sheet not found'
    );
    throw new Error(
      `Payout_Summary sheet not found. Available sheets: ${workbook.worksheets.map((ws) => ws.name).join(', ')}`
    );
  }

  const summary = parsePayoutSummary(summarySheet);

  // 2. Parse all order detail sheets (names matching *_Orders or *_Order)
  const orderSheetPattern = /_(orders?)$/i;
  const orderSheets = workbook.worksheets.filter((ws) => orderSheetPattern.test(ws.name));

  if (orderSheets.length === 0) {
    log.warn(
      { sheets: workbook.worksheets.map((ws) => ws.name) },
      'No order sheets found matching *_Order(s) pattern'
    );
  }

  const orderLines: NykaaOrderLine[] = [];
  for (const sheet of orderSheets) {
    const lines = parseOrderSheet(sheet);
    orderLines.push(...lines);
  }

  // 3. Compute aggregates
  let grossRevenue = 0;
  let totalCommission = 0;
  let shippingCharges = 0;
  let returnCharges = 0;
  let deliveredCount = 0;
  let returnCount = 0;
  let cancelledCount = 0;

  for (const line of orderLines) {
    const status = line.finalStatus.toLowerCase();

    if (status === 'delivered') {
      grossRevenue += line.nsv;
      totalCommission += line.commission;
      deliveredCount++;
    } else if (status === 'return' || status === 'returned') {
      returnCount++;
    } else if (status === 'cancelled' || status === 'canceled') {
      cancelledCount++;
    }

    // Shipping and return charges apply across all lines regardless of status
    shippingCharges += line.shippingCharge;
    returnCharges += line.returnCharge;
  }

  const result: ParsedNykaaReport = {
    marketplace: summary.marketplace,
    fileHash,

    bannerDeduction: summary.bannerDeduction,
    tdsAmount: summary.tdsAmount,
    otherIncome: summary.otherIncome,
    netPayout: summary.netPayout,

    grossRevenue: r2(grossRevenue),
    totalCommission: r2(totalCommission),
    shippingCharges: r2(shippingCharges),
    returnCharges: r2(returnCharges),

    orderLines,
    deliveredCount,
    returnCount,
    cancelledCount,
  };

  log.info(
    {
      marketplace: result.marketplace,
      totalLines: orderLines.length,
      deliveredCount,
      returnCount,
      cancelledCount,
      grossRevenue: result.grossRevenue,
      netPayout: result.netPayout,
    },
    'Nykaa report parsed successfully'
  );

  return result;
}
