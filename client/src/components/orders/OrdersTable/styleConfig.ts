/**
 * Orders Table Style Configuration
 *
 * All visual styling tokens for the orders table in one place.
 * Change colors here — no need to touch logic files.
 *
 * Tailwind classes only. Each value is a space-separated className string.
 */

import { ALL_COLUMN_IDS, type ColumnId } from './constants';

// ─── Column index lookup (O(1) from column ID to position) ──────────────────
export const COLUMN_INDEX: Record<ColumnId, number> = Object.fromEntries(
    ALL_COLUMN_IDS.map((id, i) => [id, i])
) as Record<ColumnId, number>;

// ─── Column zones (Sets of indices for O(1) membership checks) ──────────────
const range = (start: number, end: number): Set<number> => {
    const s = new Set<number>();
    for (let i = start; i <= end; i++) s.add(i);
    return s;
};

/** Order-level columns: orderInfo through customerTags (indices 0-7), excluding shipByDate (4) */
export const ORDER_INFO_ZONE = new Set([...range(0, 7)].filter(i => i !== 4));

/** Columns that never highlight (returnStatus=9, customize=10) */
const EXCLUDED = new Set([9, 10]);
const exclude = (s: Set<number>): Set<number> => new Set([...s].filter(i => !EXCLUDED.has(i)));

/** Line-level highlight zones, keyed by how far the waterfall extends */
export const LINE_ZONES = {
    productToStock: exclude(range(8, 12)),    // Product, Qty, AssignStock (skip return/customize)
    productToFabric: exclude(range(8, 13)),   // + FabricBalance
    productToPickPack: exclude(range(8, 15)), // + Workflow, PickPack
    productToNotes: exclude(range(8, 17)),    // + Production, Notes
    allColumns: range(0, 22),                 // Full row (terminal states keep everything)
} as const;

// ─── Resolved line states ────────────────────────────────────────────────────
export type ResolvedLineState =
    | 'blocked' | 'inProduction' | 'customized' | 'withStock'
    | 'allocated' | 'picked' | 'packed' | 'shipped' | 'cancelled';

// ─── Cell background per resolved state ──────────────────────────────────────
export const LINE_CELL_BG: Record<ResolvedLineState, string> = {
    blocked: 'bg-yellow-100',
    inProduction: 'bg-amber-100',
    customized: 'bg-orange-100',
    withStock: 'bg-teal-100',
    allocated: 'bg-emerald-100',
    picked: 'bg-emerald-200',
    packed: 'bg-emerald-300',
    shipped: 'bg-emerald-200',
    cancelled: 'bg-gray-100',
};

// ─── Which zone each state highlights ────────────────────────────────────────
export const LINE_HIGHLIGHT_CONFIG: Record<ResolvedLineState, Set<number>> = {
    blocked: LINE_ZONES.productToStock,
    inProduction: new Set([...LINE_ZONES.productToStock, 16]), // productToStock + production
    customized: LINE_ZONES.productToStock,
    withStock: LINE_ZONES.productToFabric,
    allocated: new Set([...LINE_ZONES.productToFabric, 16]), // productToFabric + production
    picked: new Set([...LINE_ZONES.productToPickPack, 16, 6]), // productToPickPack + production + customerNotes
    packed: LINE_ZONES.productToPickPack,
    shipped: LINE_ZONES.allColumns,
    cancelled: LINE_ZONES.allColumns,
};

// ─── TR-level styles (borders + text effects only, NO backgrounds) ───────────
export const ROW_TR_STYLES: Record<ResolvedLineState, string> = {
    blocked: '',
    inProduction: '',
    customized: '',
    withStock: '',
    allocated: '',
    picked: '',
    packed: '',
    shipped: 'line-through',
    cancelled: 'text-gray-400 line-through opacity-60',
};

// ─── First-line separator (top border on first line of each order) ──────────
export const FIRST_LINE_CLASS = 'border-t border-gray-400';

// ─── Cell text colors by status (used in individual columns) ────────────────
export const CELL_STATUS_TEXT = {
    shipped: 'text-green-700',
    packed: 'text-green-600',
    picked: 'text-green-500',
    allocated: 'text-green-500',
    cancelled: 'text-gray-400 line-through',
} as const;

// ─── Stock cell ─────────────────────────────────────────────────────────────
export const STOCK_COLORS = {
    sufficient: 'text-green-600',
    insufficient: 'text-red-600',
} as const;

// ─── Fabric balance cell ────────────────────────────────────────────────────
export const FABRIC_BALANCE_COLORS = {
    positive: 'text-green-600',
    zero: 'text-gray-400',
} as const;

// ─── Post-ship column text colors ───────────────────────────────────────────
export const POST_SHIP_COLORS = {
    date: 'text-gray-700',
    dateEmpty: 'text-gray-300',
    deliveredDate: 'text-green-700',
    daysNormal: 'text-gray-700',
    daysWarning: 'text-amber-600',
    /** Threshold (inclusive) above which days show warning color */
    daysWarningThreshold: 7,
    rtoStatus: 'text-red-600',
    rtoDays: 'text-orange-600',
    daysSinceDelivery: 'text-gray-600',
    archivedDate: 'text-gray-600',
    codRemittedDate: 'text-green-700',
} as const;

// ─── Final status badges ────────────────────────────────────────────────────
export const FINAL_STATUS_STYLES: Record<string, string> = {
    delivered: 'bg-green-100 text-green-700',
    rto_received: 'bg-purple-100 text-purple-700',
    rto: 'bg-orange-100 text-orange-700',
    shipped: 'bg-blue-100 text-blue-700',
    cancelled: 'bg-gray-100 text-gray-600',
};
export const FINAL_STATUS_DEFAULT = 'bg-gray-100 text-gray-600';

// ─── Tracking status badges ─────────────────────────────────────────────────
export const TRACKING_STATUS_STYLES: Record<string, { bg: string; text: string; label: string }> = {
    in_transit: { bg: 'bg-blue-100', text: 'text-blue-700', label: 'In Transit' },
    manifested: { bg: 'bg-gray-100', text: 'text-gray-700', label: 'Manifested' },
    picked_up: { bg: 'bg-blue-100', text: 'text-blue-700', label: 'Picked Up' },
    reached_destination: { bg: 'bg-indigo-100', text: 'text-indigo-700', label: 'At Hub' },
    out_for_delivery: { bg: 'bg-amber-100', text: 'text-amber-700', label: 'Out for Delivery' },
    undelivered: { bg: 'bg-red-100', text: 'text-red-700', label: 'NDR' },
    delivered: { bg: 'bg-green-100', text: 'text-green-700', label: 'Delivered' },
    delivery_delayed: { bg: 'bg-amber-100', text: 'text-amber-700', label: 'Delayed' },
    rto_pending: { bg: 'bg-red-100', text: 'text-red-700', label: 'RTO Pending' },
    rto_initiated: { bg: 'bg-red-100', text: 'text-red-700', label: 'RTO' },
    rto_in_transit: { bg: 'bg-orange-100', text: 'text-orange-700', label: 'RTO In Transit' },
    rto_delivered: { bg: 'bg-purple-100', text: 'text-purple-700', label: 'RTO Received' },
    rto_received: { bg: 'bg-purple-100', text: 'text-purple-700', label: 'RTO Received' },
    cancelled: { bg: 'bg-gray-100', text: 'text-gray-700', label: 'Cancelled' },
};

// ─── Payment method badges ──────────────────────────────────────────────────
export const PAYMENT_STYLES = {
    cod: { bg: 'bg-orange-100', text: 'text-orange-700' },
    prepaid: { bg: 'bg-green-100', text: 'text-green-700' },
} as const;

// ─── Customization cell ─────────────────────────────────────────────────────
export const CUSTOMIZATION_COLORS = {
    active: 'bg-orange-100 text-orange-700 hover:bg-orange-200',
    inactive: 'text-gray-400 hover:text-orange-600 hover:bg-orange-50',
} as const;

// ─── Status legend (matches waterfall highlight colors) ─────────────────────
export const STATUS_LEGEND_ITEMS = [
    { color: 'bg-yellow-100', border: 'border-yellow-300', label: 'Pending (no stock)', desc: 'Waiting for inventory' },
    { color: 'bg-amber-100', border: 'border-amber-300', label: 'In Production', desc: 'Has production date set' },
    { color: 'bg-teal-100', border: 'border-teal-300', label: 'Ready to Allocate', desc: 'Has stock available' },
    { color: 'bg-emerald-100', border: 'border-emerald-300', label: 'Allocated', desc: 'Stock reserved' },
    { color: 'bg-emerald-200', border: 'border-emerald-400', label: 'Picked', desc: 'Ready to pack' },
    { color: 'bg-emerald-300', border: 'border-emerald-500', label: 'Packed', desc: 'Ready to ship' },
    { color: 'bg-emerald-200', border: 'border-emerald-400', label: 'Shipped', desc: 'Awaiting tracking' },
] as const;
