/**
 * Invoice Preview Cache
 *
 * Simple in-memory cache for AI-parsed invoice data between preview and confirm.
 * Avoids re-running expensive AI parsing when user confirms.
 * 15-minute TTL, cleanup every 5 minutes.
 */

import type { ParsedInvoice } from './invoiceParser.js';

export interface CachedPreview {
  fileBuffer: Buffer;
  originalname: string;
  mimetype: string;
  size: number;
  parsed: ParsedInvoice | null;
  rawResponse: string;
  aiModel: string;
  aiConfidence: number;
  partyMatch: { partyId: string; partyName: string; category: string } | null;
  enrichmentPreview: EnrichmentPreview;
  createdAt: number;
}

export interface EnrichmentPreview {
  willCreateNewParty: boolean;
  newPartyName?: string;
  fieldsWillBeAdded: string[];
  bankMismatch: boolean;
  bankMismatchDetails?: string;
}

const TTL_MS = 15 * 60 * 1000; // 15 minutes
const CLEANUP_INTERVAL_MS = 5 * 60 * 1000; // 5 minutes

const cache = new Map<string, CachedPreview>();

/** Remove expired entries */
function cleanup() {
  const now = Date.now();
  for (const [key, entry] of cache) {
    if (now - entry.createdAt > TTL_MS) {
      cache.delete(key);
    }
  }
}

// Run cleanup periodically
const cleanupTimer = setInterval(cleanup, CLEANUP_INTERVAL_MS);
cleanupTimer.unref(); // Don't keep process alive

export function set(id: string, data: CachedPreview): void {
  cache.set(id, data);
}

export function get(id: string): CachedPreview | undefined {
  const entry = cache.get(id);
  if (!entry) return undefined;
  if (Date.now() - entry.createdAt > TTL_MS) {
    cache.delete(id);
    return undefined;
  }
  return entry;
}

export function remove(id: string): void {
  cache.delete(id);
}
