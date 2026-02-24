/**
 * Shared helpers, types, and constants for Fabrics tab components.
 */

// ── Formatters ──────────────────────────────────────────────

/** Format number with en-IN locale, up to 2 decimal places */
export function fmt(n: number | string): string {
    const num = typeof n === 'string' ? parseFloat(n) : n;
    if (isNaN(num)) return '0';
    return num.toLocaleString('en-IN', { maximumFractionDigits: 2 });
}

/** Format integer with en-IN locale */
export function fmtInt(n: number): string {
    return n.toLocaleString('en-IN', { maximumFractionDigits: 0 });
}

// ── Types ───────────────────────────────────────────────────

export interface ReorderItem {
    fabricColourId: string;
    materialName: string;
    fabricName: string;
    colourName: string;
    currentBalance: string;
    avgDailyConsumption: string;
    daysOfStock: number | null;
    suggestedOrderQty: number;
    leadTimeDays: number | null;
    party: string;
    status: 'ORDER NOW' | 'ORDER SOON' | 'OK';
}

export interface ConsumptionItem {
    fabricName: string;
    colourName: string;
    consumed30d: number;
}

export interface InwardTarget {
    id: string;
    colourName?: string;
    name: string;
    fabricName?: string;
    unit?: string;
}

export interface TxnRow {
    id: string;
    fabricColourId: string;
    txnType: string;
    qty: number;
    unit: string;
    reason: string;
    costPerUnit: number | null;
    referenceId: string | null;
    notes: string | null;
    partyId: string | null;
    createdById: string;
    createdAt: Date;
    fabricColour: {
        id: string;
        colourName: string;
        colourHex: string | null;
        fabric: {
            id: string;
            name: string;
            material: { id: string; name: string } | null;
        };
    };
    party: { id: string; name: string } | null;
    createdBy: { id: string; name: string } | null;
}

export interface ReconciliationItem {
    id: string;
    fabricColourId: string;
    colourName: string;
    fabricName: string;
    materialName: string;
    unit: string;
    systemQty: number;
    physicalQty: number | null;
    variance: number | null;
    adjustmentReason: string | null;
    notes: string | null;
}

export interface Reconciliation {
    id: string;
    status: string;
    createdAt: string | Date;
    items: ReconciliationItem[];
}

export interface ReconciliationHistoryItem {
    id: string;
    date: Date | null;
    status: string;
    itemsCount: number;
    adjustments: number;
    netChange: number;
    createdByName: string | null;
    createdAt: Date;
}

export interface TrimItem {
    id: string;
    code: string;
    name: string;
    category: string;
    description?: string | null;
    costPerUnit?: number | null;
    unit: string;
    partyId?: string | null;
    partyName?: string | null;
    leadTimeDays?: number | null;
    minOrderQty?: number | null;
    usageCount?: number;
    isActive: boolean;
}

export interface ServiceItem {
    id: string;
    code: string;
    name: string;
    category: string;
    description?: string | null;
    costPerJob?: number | null;
    costUnit: string;
    partyId?: string | null;
    partyName?: string | null;
    leadTimeDays?: number | null;
    usageCount?: number;
    isActive: boolean;
}

export interface TrimEditState extends Omit<TrimItem, 'costPerUnit' | 'leadTimeDays' | 'minOrderQty'> {
    costPerUnit: string;
    leadTimeDays: string;
    minOrderQty: string;
}

export interface ServiceEditState extends Omit<ServiceItem, 'costPerJob' | 'leadTimeDays'> {
    costPerJob: string;
    leadTimeDays: string;
}

// ── Constants ───────────────────────────────────────────────

export const TRIM_CATEGORIES = ['button', 'zipper', 'label', 'thread', 'elastic', 'tape', 'hook', 'drawstring', 'other'];
export const SERVICE_CATEGORIES = ['printing', 'embroidery', 'washing', 'dyeing', 'pleating', 'other'];

export const ADJUSTMENT_REASONS = {
    shortage: [
        { value: 'shrinkage', label: 'Shrinkage' },
        { value: 'wastage', label: 'Wastage' },
        { value: 'damaged', label: 'Damaged' },
        { value: 'loss', label: 'Loss/Theft' },
        { value: 'measurement_error', label: 'Measurement Error' },
    ],
    overage: [
        { value: 'found', label: 'Found/Uncounted' },
        { value: 'supplier_bonus', label: 'Supplier Bonus' },
        { value: 'measurement_error', label: 'Measurement Error' },
    ],
};
