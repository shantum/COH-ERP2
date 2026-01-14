/**
 * Shopify helper utilities
 *
 * Shared utilities for working with Shopify data across services and routes.
 */

import type { ShopifyOrder, ShopifyFulfillment, ShopifyLineItem } from '../services/shopify.js';

// ============================================
// TYPE DEFINITIONS
// ============================================

/**
 * Extended fulfillment with shipment_status and line_items
 */
export interface ExtendedShopifyFulfillment extends ShopifyFulfillment {
    shipment_status?: string | null;
    line_items?: Array<{
        id: number;
        fulfillment_status?: string;
    }>;
}

/**
 * Extracted tracking information from fulfillments
 */
export interface ExtractedTrackingInfo {
    trackingNumber: string | null;
    trackingCompany: string | null;
    trackingUrl: string | null;
    shippedAt: Date | null;
    shipmentStatus: string | null;
    fulfillmentUpdatedAt: Date | null;
    deliveredAt: Date | null;
}

/**
 * Discount allocation on a line item
 */
export interface DiscountAllocation {
    amount: string;
    discount_application_index?: number;
}

/**
 * Note attribute from Shopify order
 */
export interface NoteAttribute {
    name: string;
    value: string;
}

// ============================================
// PAYMENT METHOD DETECTION
// ============================================

/**
 * Detect payment method from Shopify order data.
 *
 * BUSINESS RULES (priority order):
 * 1. Preserve COD status: Once an order is marked COD, it STAYS COD even after payment
 *    - This prevents confusion between payment status and fulfillment method
 * 2. Gateway detection:
 *    - Shopflo/Razorpay gateways = Prepaid
 *    - COD/Cash/Manual gateways = COD
 * 3. Financial status fallback:
 *    - Pending financial status + no prepaid gateway = likely COD (common for new orders)
 * 4. Default: Prepaid
 *
 * @param shopifyOrder - The Shopify order object from API/cache
 * @param existingPaymentMethod - Current payment method from DB (to preserve COD)
 * @returns 'COD' or 'Prepaid'
 *
 * @example
 * // New order with Razorpay gateway
 * detectPaymentMethod({ payment_gateway_names: ['Razorpay'] }) // => 'Prepaid'
 *
 * @example
 * // Order already marked COD - preserve it even if paid later
 * detectPaymentMethod({ payment_gateway_names: ['Razorpay'], financial_status: 'paid' }, 'COD') // => 'COD'
 *
 * @example
 * // Pending order with no prepaid gateway (likely COD)
 * detectPaymentMethod({ payment_gateway_names: [], financial_status: 'pending' }) // => 'COD'
 */
export function detectPaymentMethod(
    shopifyOrder: Pick<ShopifyOrder, 'payment_gateway_names' | 'financial_status'>,
    existingPaymentMethod: string | null = null
): 'COD' | 'Prepaid' {
    // RULE 1: Preserve COD status once set
    // Once COD, always COD - even if customer pays later
    if (existingPaymentMethod === 'COD') {
        return 'COD';
    }

    // Extract and normalize gateway names
    const gatewayNames = (shopifyOrder.payment_gateway_names || []).join(', ').toLowerCase();

    // RULE 2a: Check for prepaid gateways
    const isPrepaidGateway = gatewayNames.includes('shopflo') || gatewayNames.includes('razorpay');

    // RULE 2b: Check for COD gateways
    const isCodGateway = gatewayNames.includes('cod') ||
                         gatewayNames.includes('cash') ||
                         gatewayNames.includes('manual');

    // Apply detection rules
    if (isPrepaidGateway) {
        return 'Prepaid';
    }

    if (isCodGateway) {
        return 'COD';
    }

    // RULE 3: Financial status fallback
    // Pending payment + no prepaid gateway = likely COD (common for new orders)
    if (shopifyOrder.financial_status === 'pending' && !isPrepaidGateway) {
        return 'COD';
    }

    // RULE 4: Default to Prepaid
    return 'Prepaid';
}

// ============================================
// DISCOUNT CODE EXTRACTION
// ============================================

/**
 * Extract discount codes from a Shopify order as a comma-separated string.
 *
 * @param shopifyOrder - The Shopify order object
 * @returns Comma-separated discount codes or empty string if none
 *
 * @example
 * extractDiscountCodes({ discount_codes: [{ code: 'SUMMER10' }, { code: 'VIP' }] })
 * // => 'SUMMER10, VIP'
 */
export function extractDiscountCodes(
    shopifyOrder: Pick<ShopifyOrder, 'discount_codes'>
): string {
    return (shopifyOrder.discount_codes || [])
        .map(d => d.code)
        .join(', ') || '';
}

// ============================================
// TRACKING INFO EXTRACTION
// ============================================

/**
 * Extract tracking information from Shopify fulfillments.
 *
 * Finds the first fulfillment with a tracking number, or falls back to the first fulfillment.
 * Handles extended fulfillment data including shipment_status and delivered detection.
 *
 * @param fulfillments - Array of Shopify fulfillment objects
 * @returns Extracted tracking info with null values for missing fields
 *
 * @example
 * const trackingInfo = extractTrackingInfo(order.fulfillments);
 * console.log(trackingInfo.trackingNumber); // 'AWB123456'
 */
export function extractTrackingInfo(
    fulfillments: ExtendedShopifyFulfillment[] | undefined
): ExtractedTrackingInfo {
    // Return empty tracking info if no fulfillments
    if (!fulfillments || fulfillments.length === 0) {
        return {
            trackingNumber: null,
            trackingCompany: null,
            trackingUrl: null,
            shippedAt: null,
            shipmentStatus: null,
            fulfillmentUpdatedAt: null,
            deliveredAt: null,
        };
    }

    // Find fulfillment with tracking number, or use first one
    const fulfillment = fulfillments.find(f => f.tracking_number) || fulfillments[0];

    const shippedAt = fulfillment.created_at ? new Date(fulfillment.created_at) : null;
    const fulfillmentUpdatedAt = fulfillment.updated_at ? new Date(fulfillment.updated_at) : null;

    // Check for delivered status
    const isDelivered = fulfillment.line_items?.[0]?.fulfillment_status === 'fulfilled'
        && fulfillment.shipment_status === 'delivered';
    const deliveredAt = isDelivered && fulfillment.updated_at
        ? new Date(fulfillment.updated_at) : null;

    return {
        trackingNumber: fulfillment.tracking_number || null,
        trackingCompany: fulfillment.tracking_company || null,
        trackingUrl: fulfillment.tracking_url || fulfillment.tracking_urls?.[0] || null,
        shippedAt,
        shipmentStatus: fulfillment.shipment_status || null,
        fulfillmentUpdatedAt,
        deliveredAt,
    };
}

// ============================================
// INTERNAL NOTE EXTRACTION
// ============================================

/**
 * Extract internal/staff notes from Shopify note_attributes.
 *
 * Looks for attributes named 'internal_note' or 'staff_note'.
 *
 * @param noteAttributes - Array of note_attributes from Shopify order
 * @returns The internal note value or null if not found
 *
 * @example
 * extractInternalNote([{ name: 'internal_note', value: 'Rush order' }])
 * // => 'Rush order'
 */
export function extractInternalNote(
    noteAttributes: NoteAttribute[] | undefined
): string | null {
    if (!noteAttributes || noteAttributes.length === 0) {
        return null;
    }

    const noteEntry = noteAttributes.find(
        n => n.name === 'internal_note' || n.name === 'staff_note'
    );

    return noteEntry?.value || null;
}

// ============================================
// PRICE CALCULATION
// ============================================

/**
 * Calculate effective unit price after line-level discounts.
 *
 * Subtracts total discount allocations from the original price,
 * distributed per unit, and rounds to 2 decimal places.
 *
 * @param originalPrice - Original unit price before discounts
 * @param quantity - Number of units
 * @param discountAllocations - Array of discount allocations with amount strings
 * @returns Effective unit price rounded to 2 decimal places
 *
 * @example
 * calculateEffectiveUnitPrice(100, 2, [{ amount: '20' }])
 * // => 90 (100 - 20/2 = 90 per unit)
 */
export function calculateEffectiveUnitPrice(
    originalPrice: number,
    quantity: number,
    discountAllocations: DiscountAllocation[] | undefined
): number {
    if (quantity <= 0) {
        return originalPrice;
    }

    const totalDiscount = (discountAllocations || []).reduce(
        (sum, alloc) => sum + (parseFloat(alloc.amount) || 0),
        0
    );

    const effectiveUnitPrice = originalPrice - (totalDiscount / quantity);
    return Math.round(effectiveUnitPrice * 100) / 100; // Round to 2 decimal places
}

// ============================================
// SAFE COUNT FETCH HELPER
// ============================================

/**
 * Safely fetch a count with fallback to array length.
 *
 * Used to get counts from Shopify API with graceful degradation
 * when the count endpoint fails.
 *
 * @param fetchCount - Async function that fetches the count
 * @param fallbackArray - Array to use for fallback length
 * @param logger - Optional logger for debug output
 * @param context - Context string for log message
 * @returns The count or fallback array length
 */
export async function safeCountFetch<T>(
    fetchCount: () => Promise<number>,
    fallbackArray: T[],
    logger?: { debug: (obj: Record<string, unknown>, msg: string) => void },
    context = 'count fetch'
): Promise<number> {
    try {
        return await fetchCount();
    } catch (error: unknown) {
        const errorMessage = error instanceof Error ? error.message : 'Unknown error';
        logger?.debug({ error: errorMessage }, `${context} failed, using array length`);
        return fallbackArray.length;
    }
}
