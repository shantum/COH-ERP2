/**
 * Shopify helper utilities
 *
 * Shared utilities for working with Shopify data across services and routes.
 *
 * NOTE: Payment method detection rules are centralized in config/mappings/paymentGateway.ts
 */

import type { ShopifyOrder, ShopifyFulfillment } from '../services/shopify/index.js';
import { resolvePaymentMethod as resolvePaymentMethodFromConfig } from '../config/index.js';

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
 * Rules are defined in: config/mappings/paymentGateway.ts
 *
 * @param shopifyOrder - The Shopify order object from API/cache
 * @param existingPaymentMethod - Current payment method from DB (to preserve COD)
 * @returns 'COD' or 'Prepaid'
 *
 * @example
 * detectPaymentMethod({ payment_gateway_names: ['Razorpay'] }) // => 'Prepaid'
 * detectPaymentMethod({ payment_gateway_names: ['Razorpay'] }, 'COD') // => 'COD' (preserved)
 */
export function detectPaymentMethod(
    shopifyOrder: Pick<ShopifyOrder, 'payment_gateway_names' | 'financial_status'>,
    existingPaymentMethod: string | null = null
): 'COD' | 'Prepaid' {
    // Delegate to centralized config
    return resolvePaymentMethodFromConfig(
        shopifyOrder.payment_gateway_names || [],
        existingPaymentMethod,
        shopifyOrder.financial_status
    );
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

/**
 * Extract UTM attribution fields from Shopify note_attributes.
 * Shopify stores UTM params and click IDs as note attributes when
 * the customer arrives via a tracked link.
 */
export interface UtmFields {
    utmSource: string | null;
    utmMedium: string | null;
    utmCampaign: string | null;
    utmTerm: string | null;
    utmContent: string | null;
    fbclid: string | null;
    gclid: string | null;
    landingPage: string | null;
}

/**
 * Full order attribution — extracted from noteAttributes, Elevar cookies,
 * landing_site URL params, and referring_site inference.
 */
export interface OrderAttribution extends UtmFields {
    referringSite: string | null;
    landingPageUrl: string | null;
    customerType: string | null;
    origReferrer: string | null;
    checkoutId: string | null;
    sourceName: string | null;
    shopfloSessionId: string | null;
    elevarFbc: string | null;
    elevarFbp: string | null;
    elevarGaClientId: string | null;
    elevarVisitorId: string | null;
    elevarSessionId: string | null;
}

/** Raw Shopify order fields relevant to attribution */
export interface ShopifyOrderAttribution {
    landing_site?: string | null;
    referring_site?: string | null;
    source_name?: string | null;
}

const UTM_FIELD_MAP: Record<string, keyof UtmFields> = {
    utm_source: 'utmSource',
    utm_medium: 'utmMedium',
    utm_campaign: 'utmCampaign',
    utm_term: 'utmTerm',
    utm_content: 'utmContent',
    fbclid: 'fbclid',
    gclid: 'gclid',
    landing_page: 'landingPage',
    '_landing_page': 'landingPage',
};

// Referrer → source/medium inference map
const REFERRER_MAP: Array<{ pattern: RegExp; source: string; medium: string }> = [
    { pattern: /google\./i, source: 'google', medium: 'organic' },
    { pattern: /facebook\.com|fb\.com/i, source: 'facebook', medium: 'social' },
    { pattern: /instagram\.com/i, source: 'instagram', medium: 'social' },
    { pattern: /youtube\.com/i, source: 'youtube', medium: 'social' },
    { pattern: /t\.co|twitter\.com|x\.com/i, source: 'twitter', medium: 'social' },
    { pattern: /pinterest\./i, source: 'pinterest', medium: 'social' },
    { pattern: /bing\./i, source: 'bing', medium: 'organic' },
    { pattern: /yahoo\./i, source: 'yahoo', medium: 'organic' },
    { pattern: /duckduckgo\./i, source: 'duckduckgo', medium: 'organic' },
];

// ---- Parser helpers ----

/** Parse _elevar__fbc cookie → fbclid. Format: fb.1.<timestamp>.<fbclid> */
function parseFbclidFromElevarFbc(fbc: string): string | null {
    if (!fbc) return null;
    // fbclid is everything after the 3rd dot (fbclid itself may contain dots)
    const parts = fbc.split('.');
    if (parts.length < 4) return null;
    return parts.slice(3).join('.');
}

/** Parse _elevar__ga cookie → GA client ID. Format: GA1.1.<clientId>.<timestamp> */
function parseGaClientId(ga: string): string | null {
    if (!ga) return null;
    const parts = ga.split('.');
    if (parts.length < 4) return null;
    // Client ID is typically <random>.<timestamp> (parts 2+3)
    return `${parts[2]}.${parts[3]}`;
}

/** Parse _elevar_visitor_info JSON → user_id + session_id */
function parseElevarVisitorInfo(json: string): { userId: string | null; sessionId: string | null } {
    try {
        const data = JSON.parse(json);
        return {
            userId: data?.user_id || null,
            sessionId: data?.session_id || null,
        };
    } catch {
        return { userId: null, sessionId: null };
    }
}

/** Parse URL query params from a landing_site path (may or may not have origin) */
function parseUrlParams(landingSite: string): URLSearchParams | null {
    try {
        const url = new URL(landingSite, 'https://placeholder.com');
        return url.searchParams;
    } catch {
        return null;
    }
}

/** Infer source/medium from a referring_site URL */
function inferSourceFromReferrer(referrer: string): { source: string; medium: string } | null {
    if (!referrer || referrer === 'undefined') return null;
    for (const entry of REFERRER_MAP) {
        if (entry.pattern.test(referrer)) {
            return { source: entry.source, medium: entry.medium };
        }
    }
    return null;
}

/**
 * Backward-compatible extraction — returns only the original 8 UTM fields.
 * Used by existing callers that only need UtmFields.
 */
export function extractUtmFields(
    noteAttributes: NoteAttribute[] | undefined
): UtmFields {
    const full = extractOrderAttribution(noteAttributes);
    return {
        utmSource: full.utmSource,
        utmMedium: full.utmMedium,
        utmCampaign: full.utmCampaign,
        utmTerm: full.utmTerm,
        utmContent: full.utmContent,
        fbclid: full.fbclid,
        gclid: full.gclid,
        landingPage: full.landingPage,
    };
}

/**
 * Comprehensive order attribution extraction.
 *
 * Priority cascade:
 *   1. noteAttributes (explicit UTM params set by checkout scripts)
 *   2. Elevar cookies in noteAttributes (_elevar__fbc → fbclid, etc.)
 *   3. landing_site URL query params (from rawData)
 *   4. referring_site inference (from rawData)
 *
 * @param noteAttributes - Shopify note_attributes array
 * @param shopifyOrder - Optional raw Shopify order fields (landing_site, referring_site, source_name)
 */
export function extractOrderAttribution(
    noteAttributes: NoteAttribute[] | undefined,
    shopifyOrder?: ShopifyOrderAttribution,
): OrderAttribution {
    const result: OrderAttribution = {
        utmSource: null, utmMedium: null, utmCampaign: null,
        utmTerm: null, utmContent: null, fbclid: null, gclid: null, landingPage: null,
        referringSite: null, landingPageUrl: null, customerType: null,
        origReferrer: null, checkoutId: null, sourceName: null,
        shopfloSessionId: null,
        elevarFbc: null, elevarFbp: null, elevarGaClientId: null,
        elevarVisitorId: null, elevarSessionId: null,
    };

    // Build a lookup map from noteAttributes
    const attrMap = new Map<string, string>();
    if (noteAttributes) {
        for (const attr of noteAttributes) {
            if (attr.name && attr.value) {
                attrMap.set(attr.name.toLowerCase(), attr.value);
            }
        }
    }

    // ---- Source 1: Direct noteAttributes ----
    for (const [noteKey, fieldKey] of Object.entries(UTM_FIELD_MAP)) {
        const val = attrMap.get(noteKey);
        if (val) result[fieldKey] = val;
    }

    // Single-source noteAttribute fields
    result.customerType = attrMap.get('customer_type') || null;
    result.origReferrer = attrMap.get('orig_referrer') || null;
    result.checkoutId = attrMap.get('checkout_id') || null;
    result.shopfloSessionId = attrMap.get('long_session_id') || null;

    // ---- Source 2: Elevar cookies in noteAttributes ----
    const elevarFbc = attrMap.get('_elevar__fbc') || null;
    const elevarFbp = attrMap.get('_elevar__fbp') || null;
    const elevarGa = attrMap.get('_elevar__ga') || null;
    const elevarVisitorInfoRaw = attrMap.get('_elevar_visitor_info') || null;

    result.elevarFbc = elevarFbc;
    result.elevarFbp = elevarFbp;
    result.elevarGaClientId = elevarGa ? parseGaClientId(elevarGa) : null;

    if (elevarVisitorInfoRaw) {
        const { userId, sessionId } = parseElevarVisitorInfo(elevarVisitorInfoRaw);
        result.elevarVisitorId = userId;
        result.elevarSessionId = sessionId;
    }

    // fbclid fallback: parse from _elevar__fbc if not already set
    if (!result.fbclid && elevarFbc) {
        result.fbclid = parseFbclidFromElevarFbc(elevarFbc);
    }

    // ---- Source 3: landing_site URL params ----
    const landingSite = shopifyOrder?.landing_site;
    if (landingSite) {
        result.landingPageUrl = landingSite;

        // Extract path for landingPage fallback
        if (!result.landingPage) {
            try {
                const url = new URL(landingSite, 'https://placeholder.com');
                result.landingPage = url.pathname;
            } catch { /* ignore */ }
        }

        // Parse query params for UTM/click ID fallbacks
        const params = parseUrlParams(landingSite);
        if (params) {
            if (!result.utmSource) result.utmSource = params.get('utm_source');
            if (!result.utmMedium) result.utmMedium = params.get('utm_medium');
            if (!result.utmCampaign) result.utmCampaign = params.get('utm_campaign');
            if (!result.utmTerm) result.utmTerm = params.get('utm_term');
            if (!result.utmContent) result.utmContent = params.get('utm_content');
            if (!result.fbclid) result.fbclid = params.get('fbclid');
            if (!result.gclid) result.gclid = params.get('gclid');
        }
    }

    // ---- Source 4: referring_site ----
    const referringSite = shopifyOrder?.referring_site;
    if (referringSite && referringSite !== 'undefined') {
        result.referringSite = referringSite;

        // Infer source/medium from referrer if not already set
        if (!result.utmSource) {
            const inferred = inferSourceFromReferrer(referringSite);
            if (inferred) {
                result.utmSource = inferred.source;
                if (!result.utmMedium) result.utmMedium = inferred.medium;
            }
        }
    }

    // ---- Source 5: Raw order fields ----
    if (shopifyOrder?.source_name) {
        result.sourceName = shopifyOrder.source_name;
    }

    return result;
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
