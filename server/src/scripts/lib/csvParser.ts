/**
 * CSV Parser for Google Sheets sync
 *
 * Parses two CSV exports:
 * - "Orders from COH.csv" - order lines with status columns
 * - "Inventory.csv" - SKU inventory balances
 */

import { parse } from 'csv-parse/sync';
import { readFileSync } from 'fs';

// ============================================
// TYPES
// ============================================

export interface OrderRow {
    orderNumber: string;
    skuCode: string;
    qty: number;
    channel: string;
    assigned: boolean;
    picked: boolean;
    packed: boolean;
    shipped: boolean;
    cohNote: string;
    orderNote: string;
    awb: string;
    courier: string;
    customerName: string;
    customerPhone: string;
    city: string;
    orderDate: Date | null;
    unitPrice: number;
    paymentMethod: string;
    shipByDate: Date | null;
    samplingDate: Date | null;
    source: string;
}

export interface InventoryRow {
    skuCode: string;
    qtyBal: number;       // Column C: total stock before assignment
    qtyAssigned: number;  // Column D: stock allocated to orders
    qtyBalance: number;   // Column E: stock remaining after assignment
}

export type ChannelMapping = 'shopify' | 'myntra' | 'ajio' | 'nykaa' | 'offline';

export interface ParsedData {
    orderRows: OrderRow[];
    orderNumberSet: Set<string>;
    ordersByNumber: Map<string, OrderRow[]>;
    inventoryRows: InventoryRow[];
    inventoryBySkuCode: Map<string, InventoryRow>;
}

// ============================================
// HELPERS
// ============================================

function parseBool(val: string | undefined): boolean {
    if (!val) return false;
    const v = val.trim().toUpperCase();
    return v === 'TRUE' || v === 'YES' || v === '1';
}

function parseNum(val: string | undefined, fallback = 0): number {
    if (!val || val.trim() === '') return fallback;
    const n = Number(val.trim().replace(/,/g, ''));
    return isNaN(n) ? fallback : n;
}

function parseDate(val: string | undefined): Date | null {
    if (!val || val.trim() === '') return null;
    const d = new Date(val.trim());
    if (isNaN(d.getTime())) return null;
    // Normalize to midnight UTC using local date components to avoid
    // timezone-induced date shifts (e.g. IST midnight -> previous day in UTC)
    return new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
}

function cleanStr(val: string | undefined): string {
    return (val ?? '').trim();
}

/**
 * Map CSV channel value to ERP channel
 */
export function mapChannel(rawChannel: string): { channel: ChannelMapping; isExchange: boolean } {
    const c = rawChannel.trim().toLowerCase();

    if (c.includes('myntra')) return { channel: 'myntra', isExchange: false };
    if (c.includes('ajio')) return { channel: 'ajio', isExchange: false };
    if (c.includes('nykaa')) return { channel: 'nykaa', isExchange: false };
    if (c.includes('manual exc')) return { channel: 'offline', isExchange: true };

    // Shopify-like channels
    return { channel: 'shopify', isExchange: false };
}

/**
 * Extract "SHIP BY <date>" from COH Note
 */
export function extractShipByDate(note: string): Date | null {
    const match = note.match(/SHIP\s+BY\s+(\d{1,2}\s+\w{3,9}(?:\s+\d{4})?)/i);
    if (!match) return null;

    let dateStr = match[1];
    // If no year, assume current year
    if (!/\d{4}/.test(dateStr)) {
        dateStr += ` ${new Date().getFullYear()}`;
    }
    const d = new Date(dateStr);
    return isNaN(d.getTime()) ? null : d;
}

/**
 * Detect payment method from channel string
 */
export function detectPaymentMethod(channel: string): string {
    const c = channel.trim().toLowerCase();
    if (c.includes('cod') || c.includes('cash on delivery')) return 'COD';
    return 'Prepaid';
}

// ============================================
// PARSERS
// ============================================

/**
 * Parse orders CSV from raw string content
 */
export function parseOrdersCsvFromString(raw: string): OrderRow[] {
    const records: Record<string, string>[] = parse(raw, {
        columns: true,
        skip_empty_lines: true,
        trim: true,
        relax_column_count: true,
    });

    const rows: OrderRow[] = [];

    for (const rec of records) {
        const orderNumber = cleanStr(rec['Order #'] || rec['Order Number'] || rec['Order No'] || '');
        const skuCode = cleanStr(rec['SKU'] || rec['Sku'] || rec['sku'] || '');

        // Skip rows without order number or SKU
        if (!orderNumber || !skuCode) continue;

        const channel = cleanStr(rec['Channel'] || rec['channel'] || '');
        const cohNote = cleanStr(rec['COH Note'] || rec['COH Notes'] || rec['coh_note'] || '');
        const orderNote = cleanStr(rec['Order Note'] || rec['Order Notes'] || rec['order_note'] || '');

        rows.push({
            orderNumber,
            skuCode,
            qty: parseNum(rec['Qty'] || rec['qty'] || rec['Quantity'], 1),
            channel,
            assigned: parseBool(rec['Assigned'] || rec['assigned']),
            picked: parseBool(rec['Picked'] || rec['picked']),
            packed: parseBool(rec['Packed'] || rec['packed']),
            shipped: parseBool(rec['Shipped'] || rec['shipped']),
            cohNote,
            orderNote,
            awb: cleanStr(rec['AWB'] || rec['awb'] || rec['AWB Number'] || ''),
            courier: cleanStr(rec['Courier'] || rec['courier'] || ''),
            customerName: cleanStr(rec['Customer Name'] || rec['Name'] || rec['name'] || ''),
            customerPhone: cleanStr(rec['Mob'] || rec['Phone'] || rec['phone'] || rec['Customer Phone'] || ''),
            city: cleanStr(rec['City'] || rec['city'] || ''),
            orderDate: parseDate(rec['Order'] || rec['Order Date'] || rec['order_date']),
            unitPrice: parseNum(rec['MRP'] || rec['Unit Price'] || rec['mrp'] || rec['Price']),
            paymentMethod: detectPaymentMethod(channel),
            shipByDate: extractShipByDate(cohNote),
            samplingDate: parseDate(rec['samplingDate'] || rec['Sampling Date'] || ''),
            source: cleanStr(rec['source_'] || rec['Source'] || ''),
        });
    }

    return rows;
}

/**
 * Parse the Orders CSV file (thin wrapper over parseOrdersCsvFromString)
 */
export function parseOrdersCsv(filePath: string): OrderRow[] {
    const raw = readFileSync(filePath, 'utf-8');
    return parseOrdersCsvFromString(raw);
}

/**
 * Parse inventory CSV from raw string content
 */
export function parseInventoryCsvFromString(raw: string): InventoryRow[] {
    // The inventory CSV has 2 summary rows before the actual header row.
    // Row 1: category header (e.g. "rib ,,OFFICE,,,WAREHOUSE,...")
    // Row 2: totals row
    // Row 3: actual column headers (SKU, Product Name, Qty Bal, Qty Assigned, Qty Balance, ...)
    // Row 4+: data
    const lines = raw.split('\n');
    const dataWithHeader = lines.slice(2).join('\n');

    const records: Record<string, string>[] = parse(dataWithHeader, {
        columns: true,
        skip_empty_lines: true,
        trim: true,
        relax_column_count: true,
    });

    const rows: InventoryRow[] = [];

    for (const rec of records) {
        // SKU column - could be ERP skuCode or Shopify variant ID
        const skuCode = cleanStr(
            rec['SKU'] || rec['SKU Code'] || rec['Sku'] || rec['sku'] || rec['Code'] || ''
        );

        if (!skuCode) continue;
        // Skip formula errors or non-numeric SKU codes that aren't real
        if (skuCode.startsWith('#')) continue;

        // Columns: Qty Bal (C), Qty Assigned (D), Qty Balance (E)
        // Note: there may be duplicate "Qty Balance" headers — use positional fallback
        const headers = Object.keys(rec);
        const colC = rec['Qty Bal'] ?? rec[headers[2]] ?? '0';
        const colD = rec['Qty Assigned'] ?? rec[headers[3]] ?? '0';
        // Column E (first "Qty Balance") — careful with duplicates
        const colE = rec[headers[4]] ?? '0';

        rows.push({
            skuCode,
            qtyBal: parseNum(colC),
            qtyAssigned: parseNum(colD),
            qtyBalance: parseNum(colE),
        });
    }

    return rows;
}

/**
 * Parse the Inventory CSV file (thin wrapper over parseInventoryCsvFromString)
 */
export function parseInventoryCsv(filePath: string): InventoryRow[] {
    const raw = readFileSync(filePath, 'utf-8');
    return parseInventoryCsvFromString(raw);
}

/**
 * Build lookup structures from parsed CSV rows
 */
function buildParsedData(orderRows: OrderRow[], inventoryRows: InventoryRow[]): ParsedData {

    // Build order number set
    const orderNumberSet = new Set<string>();
    const ordersByNumber = new Map<string, OrderRow[]>();

    for (const row of orderRows) {
        orderNumberSet.add(row.orderNumber);

        const existing = ordersByNumber.get(row.orderNumber);
        if (existing) {
            existing.push(row);
        } else {
            ordersByNumber.set(row.orderNumber, [row]);
        }
    }

    // Build inventory map
    const inventoryBySkuCode = new Map<string, InventoryRow>();
    for (const row of inventoryRows) {
        inventoryBySkuCode.set(row.skuCode, row);
    }

    return {
        orderRows,
        orderNumberSet,
        ordersByNumber,
        inventoryRows,
        inventoryBySkuCode,
    };
}

/**
 * Parse both CSVs from raw string content and build lookup structures
 */
export function parseAllCsvsFromStrings(ordersCsv: string, inventoryCsv: string): ParsedData {
    const orderRows = parseOrdersCsvFromString(ordersCsv);
    const inventoryRows = parseInventoryCsvFromString(inventoryCsv);
    return buildParsedData(orderRows, inventoryRows);
}

/**
 * Parse both CSV files and build lookup structures
 */
export function parseAllCsvs(ordersPath: string, inventoryPath: string): ParsedData {
    const orderRows = parseOrdersCsv(ordersPath);
    const inventoryRows = parseInventoryCsv(inventoryPath);
    return buildParsedData(orderRows, inventoryRows);
}
