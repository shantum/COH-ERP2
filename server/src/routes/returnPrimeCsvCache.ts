/**
 * In-memory preview cache for Return Prime CSV enrichment.
 * Stores parsed rows between preview and execute confirmation.
 */

import type { ReturnPrimeCsvNormalizedRow, ReturnPrimeCsvParsedResult } from '../services/returnPrimeCsvEnrichment.js';

export interface ReturnPrimeCsvCacheEntry {
    sourceFile: string;
    parsed: ReturnPrimeCsvParsedResult;
    rows: ReturnPrimeCsvNormalizedRow[];
    expiresAt: number;
}

const CACHE_TTL_MS = 15 * 60 * 1000; // 15 minutes
const csvPreviewCache = new Map<string, ReturnPrimeCsvCacheEntry>();

export function cleanReturnPrimeCsvCache(): void {
    const now = Date.now();
    for (const [key, value] of csvPreviewCache) {
        if (value.expiresAt < now) {
            csvPreviewCache.delete(key);
        }
    }
}

export function setReturnPrimeCsvCache(
    key: string,
    sourceFile: string,
    parsed: ReturnPrimeCsvParsedResult
): void {
    csvPreviewCache.set(key, {
        sourceFile,
        parsed,
        rows: parsed.validRows,
        expiresAt: Date.now() + CACHE_TTL_MS,
    });
}

export function getReturnPrimeCsvCache(key: string): ReturnPrimeCsvCacheEntry | null {
    const entry = csvPreviewCache.get(key);
    if (!entry) return null;
    if (entry.expiresAt < Date.now()) {
        csvPreviewCache.delete(key);
        return null;
    }
    return entry;
}

export function deleteReturnPrimeCsvCache(key: string): void {
    csvPreviewCache.delete(key);
}
