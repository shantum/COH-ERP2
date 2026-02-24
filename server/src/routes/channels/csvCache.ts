/**
 * In-memory CSV cache shared between preview-import and execute-import routes.
 * Avoids sending full CSV data back through the client.
 */

import type { BtReportRow } from './types.js';

interface CsvCacheEntry {
  rows: BtReportRow[];
  expiresAt: number;
}

const csvCache = new Map<string, CsvCacheEntry>();
const CSV_CACHE_TTL_MS = 15 * 60 * 1000; // 15 min

export function cleanCSVCache(): void {
  const now = Date.now();
  for (const [key, val] of csvCache) {
    if (val.expiresAt < now) csvCache.delete(key);
  }
}

export function setCsvCache(key: string, rows: BtReportRow[]): void {
  csvCache.set(key, { rows, expiresAt: Date.now() + CSV_CACHE_TTL_MS });
}

export function getCsvCache(key: string): BtReportRow[] | null {
  const entry = csvCache.get(key);
  if (!entry) return null;
  return entry.rows;
}

export function deleteCsvCache(key: string): void {
  csvCache.delete(key);
}
