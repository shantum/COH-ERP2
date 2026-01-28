/**
 * Google Sheets CSV Fetcher
 *
 * Fetches CSV data from public Google Sheets using the export URL pattern.
 * No API key needed — works for sheets shared with "anyone with link".
 */

/**
 * Extract the Google Sheet ID from a URL or bare ID string.
 *
 * Supported formats:
 * - https://docs.google.com/spreadsheets/d/SHEET_ID/edit#gid=0
 * - https://docs.google.com/spreadsheets/d/SHEET_ID/
 * - SHEET_ID (bare 44-char alphanumeric string)
 */
export function extractSheetId(urlOrId: string): string {
    const trimmed = urlOrId.trim();

    // Try to extract from URL
    const match = trimmed.match(/\/spreadsheets\/d\/([a-zA-Z0-9_-]+)/);
    if (match) return match[1];

    // Assume it's a bare ID if it looks like one (alphanumeric + hyphens/underscores)
    if (/^[a-zA-Z0-9_-]{20,}$/.test(trimmed)) return trimmed;

    throw new Error(`Invalid Google Sheets URL or ID: ${trimmed}`);
}

/**
 * Fetch a single sheet tab as CSV text.
 *
 * @param sheetId - Google Sheets document ID
 * @param gid - Sheet tab GID (default "0" for the first tab)
 * @returns Raw CSV text
 */
export async function fetchSheetAsCsv(sheetId: string, gid: string = '0'): Promise<string> {
    const url = `https://docs.google.com/spreadsheets/d/${sheetId}/export?format=csv&gid=${gid}`;

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 30_000);

    try {
        const response = await fetch(url, {
            signal: controller.signal,
            headers: {
                'User-Agent': 'COH-ERP-SheetSync/1.0',
            },
        });

        if (!response.ok) {
            if (response.status === 404) {
                throw new Error('Sheet not found. Ensure the sheet is shared with "Anyone with the link".');
            }
            throw new Error(`Failed to fetch sheet (HTTP ${response.status}): ${response.statusText}`);
        }

        return await response.text();
    } finally {
        clearTimeout(timeout);
    }
}

/**
 * Fetch both orders and inventory CSVs from a Google Sheet.
 *
 * @param source.sheetId - Google Sheets document ID
 * @param source.ordersGid - GID for the orders tab (default "0")
 * @param source.inventoryGid - GID for the inventory tab (default "1")
 */
export async function fetchOrdersAndInventoryCsv(source: {
    sheetId: string;
    ordersGid?: string;
    inventoryGid?: string;
}): Promise<{ ordersCsv: string; inventoryCsv: string }> {
    const { sheetId, ordersGid = '0', inventoryGid = '1' } = source;

    const [ordersCsv, inventoryCsv] = await Promise.all([
        fetchSheetAsCsv(sheetId, ordersGid),
        fetchSheetAsCsv(sheetId, inventoryGid),
    ]);

    return { ordersCsv, inventoryCsv };
}
