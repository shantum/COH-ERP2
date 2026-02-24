/**
 * CSV parsing utilities for BT report channel imports.
 */

import { parse } from 'fast-csv';
import { Readable } from 'stream';
import type { BtReportRow } from './types.js';

// ============================================
// HELPER FUNCTIONS
// ============================================

/**
 * Normalize channel name to lowercase standard format
 * Examples: "Myntra PPMP" -> "myntra", "AJIO JIT" -> "ajio"
 */
export function normalizeChannel(raw: string | undefined): string {
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
export function parsePriceToPaise(val: string | undefined): number | null {
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

export function parseDate(val: string | undefined, timeVal?: string): Date | null {
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
export function parseIntSafe(val: string | undefined, defaultVal: number = 1): number {
  if (!val || val.trim() === '') return defaultVal;
  const num = parseInt(val.replace(/,/g, '').trim(), 10);
  return isNaN(num) ? defaultVal : num;
}

/**
 * Parse float with fallback
 */
export function parseFloatSafe(val: string | undefined): number | null {
  if (!val || val.trim() === '') return null;
  const num = parseFloat(val.replace(/,/g, '').trim());
  return isNaN(num) ? null : num;
}

/**
 * Parse price string to rupees (float). For ERP Orders where unitPrice is stored as Float.
 */
export function parsePriceToRupees(val: string | undefined): number {
  if (!val || val.trim() === '') return 0;
  const cleaned = val.replace(/,/g, '').trim();
  const num = parseFloat(cleaned);
  return isNaN(num) ? 0 : num;
}

/**
 * Check if phone number is a marketplace placeholder (all same digits, etc.)
 */
export function isPlaceholderPhone(phone: string | null): boolean {
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
export function isWarehouseOrder(channel: string, customerName: string | null, city: string | null): boolean {
  if (channel !== 'ajio') return false;
  const combined = `${customerName ?? ''} ${city ?? ''}`.toLowerCase();
  return combined.includes('ajio') || combined.includes('unit 106') || combined.includes('sangram complex');
}

/**
 * Parse CSV buffer into BtReportRow array
 */
export async function parseCSVBuffer(buffer: Buffer): Promise<BtReportRow[]> {
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
