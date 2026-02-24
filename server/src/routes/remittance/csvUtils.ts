/**
 * CSV parsing utilities for COD remittance reconciliation
 */

// Type for normalized CSV record
export type NormalizedRecord = Record<string, string | undefined>;

// Type for upload results
export interface UploadResults {
    total: number;
    matched: number;
    updated: number;
    alreadyPaid: number;
    notFound: Array<{ orderNumber: string; customer: string; amount: string }>;
    errors: Array<{ record?: Record<string, unknown>; orderNumber?: string; error: string }>;
    skipped?: number;
    shopifySynced?: number;
    shopifyFailed?: number;
    manualReview?: number;
    dateRange?: { earliest: string; latest: string };
}

// Type for sync results
export interface SyncResults {
    total: number;
    synced: number;
    failed: number;
    alreadySynced?: number;
    errors: Array<{ orderNumber: string; error: string }>;
}

/**
 * Parse date string from CSV (formats: "06-Jan-26", "2026-01-06", etc.)
 */
export function parseDate(dateStr: string | undefined | null): Date | null {
    if (!dateStr) return null;

    // Try "DD-Mon-YY" format (e.g., "06-Jan-26")
    const monthMap: Record<string, number> = {
        'jan': 0, 'feb': 1, 'mar': 2, 'apr': 3, 'may': 4, 'jun': 5,
        'jul': 6, 'aug': 7, 'sep': 8, 'oct': 9, 'nov': 10, 'dec': 11
    };

    const match = dateStr.match(/^(\d{1,2})-([A-Za-z]{3})-(\d{2})$/);
    if (match) {
        const day = parseInt(match[1]);
        const month = monthMap[match[2].toLowerCase()];
        let year = parseInt(match[3]);
        // Assume 20xx for 2-digit years
        year = year < 50 ? 2000 + year : 1900 + year;
        return new Date(year, month, day);
    }

    // Try ISO format or other standard formats
    const parsed = new Date(dateStr);
    return isNaN(parsed.getTime()) ? null : parsed;
}

/**
 * Normalize column names from CSV headers
 */
export function normalizeColumnName(name: string): string {
    const normalized = name.toLowerCase().replace(/[^a-z0-9]/g, '');
    const mappings: Record<string, string> = {
        'awbno': 'awb',
        'awbnumber': 'awb',
        'orderno': 'orderNumber',
        'ordernumber': 'orderNumber',
        'price': 'amount',
        'codamount': 'amount',
        'remittancedate': 'remittanceDate',
        'remittanceutr': 'utr',
        'utr': 'utr',
    };
    return mappings[normalized] || normalized;
}
