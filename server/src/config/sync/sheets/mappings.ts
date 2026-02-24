/**
 * Source/destination mappings, return source normalization, and valid source lists.
 */

import type { TxnReason } from '../../../utils/patterns/types.js';

// ============================================
// RETURN SOURCE MAPPING
// ============================================

/**
 * Maps Return & Exchange Source values to normalized enum.
 */
export const RETURN_SOURCE_MAP: Record<string, 'RETURN' | 'EXCHANGE' | 'RTO' | 'REPACKING' | 'OTHER'> = {
    return: 'RETURN',
    'return ': 'RETURN',
    retrun: 'RETURN',
    retunr: 'RETURN',
    returm: 'RETURN',
    exchange: 'EXCHANGE',
    'exchange ': 'EXCHANGE',
    exchnage: 'EXCHANGE',
    excahnge: 'EXCHANGE',
    exchagne: 'EXCHANGE',
    exchnge: 'EXCHANGE',
    exchangeq: 'EXCHANGE',
    rto: 'RTO',
    'rto - used': 'RTO',
    repacking: 'REPACKING',
    other: 'OTHER',
    refund: 'OTHER',
    nykaa: 'OTHER',
    pima: 'OTHER',
};

export const DEFAULT_RETURN_SOURCE = 'OTHER' as const;

// ============================================
// INWARD SOURCE MAPPING
// ============================================

/**
 * Maps inward source (col E) to TXN_REASON values.
 * Unknown sources default to 'production'.
 */
export const INWARD_SOURCE_MAP: Record<string, TxnReason> = {
    sampling: 'production',
    production: 'production',
    tailor: 'production',
    repacking: 'return_receipt',
    return: 'return_receipt',
    adjustment: 'adjustment',
    received: 'production',
    warehouse: 'adjustment',
    'op stock': 'adjustment',
    alteration: 'production',
    rto: 'rto_received',
    reject: 'damage',
};

/**
 * Default reason when source is empty or unknown
 */
export const DEFAULT_INWARD_REASON: TxnReason = 'production';

/**
 * Valid sources for Inward (Live) entries.
 * Rows with sources not in this list are rejected during ingestion.
 */
export const VALID_INWARD_LIVE_SOURCES = ['sampling', 'repacking', 'adjustment', 'rto', 'return'] as const;

/**
 * Inward sources that trigger automatic fabric deduction.
 * When these sources come in, the system also creates FabricColourTransaction (outward)
 * to deduct the fabric used: qty x BOM consumption (SkuBomLine > VariationBomLine > Product.defaultFabricConsumption > 1.5).
 */
export const FABRIC_DEDUCT_SOURCES = ['sampling'] as const;

/**
 * Inward sources that trigger production ledger booking (Fabric -> Finished Goods).
 * Includes both sampling (new production) and adjustment (stock corrections).
 */
export const PRODUCTION_BOOKING_SOURCES = ['sampling', 'adjustment'] as const;

// ============================================
// OUTWARD DESTINATION MAPPING
// ============================================

/**
 * Maps outward destination (col E) to TXN_REASON values.
 * Used for non-order outward rows (OL Outward tab).
 */
export const OUTWARD_DESTINATION_MAP: Record<string, TxnReason> = {
    'op stock': 'adjustment',
    warehouse: 'adjustment',
    customer: 'order_allocation',
    tailor: 'adjustment',
};

/**
 * Default reason when destination is empty or unknown
 */
export const DEFAULT_OUTWARD_REASON: TxnReason = 'sale';
