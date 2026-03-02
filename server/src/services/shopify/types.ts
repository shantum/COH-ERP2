import type { AxiosInstance, AxiosResponse } from 'axios';

// ============================================
// INTERNAL TYPES
// ============================================

/**
 * Rate limit state tracking for Shopify API
 */
export interface RateLimitState {
    remaining: number;
    lastUpdated: number | null;
    retryAfter: number | null;
}

/**
 * Retry options for API requests
 */
export interface RetryOptions {
    maxRetries?: number;
    baseDelay?: number;
}

/**
 * Context object passed to feature module functions
 * so they can use the Axios client and retry logic without coupling to the class.
 */
export interface ShopifyClientContext {
    client: AxiosInstance;
    executeWithRetry: <T>(
        requestFn: () => Promise<AxiosResponse<T>>,
        options?: RetryOptions
    ) => Promise<AxiosResponse<T>>;
    executeGraphQL: <T>(query: string, variables?: Record<string, unknown>) => Promise<T>;
    isConfigured: () => boolean;
}

// ============================================
// OPTIONS TYPES
// ============================================

/**
 * Options for fetching orders
 */
export interface OrderOptions {
    status?: 'open' | 'closed' | 'cancelled' | 'any';
    since_id?: string;
    created_at_min?: string;
    created_at_max?: string;
    updated_at_min?: string;
    updated_at_max?: string;
    limit?: number;
}

/**
 * Options for fetching customers
 */
export interface CustomerOptions {
    since_id?: string;
    created_at_min?: string;
    updated_at_min?: string;
    limit?: number;
}

/**
 * Options for fetching products
 */
export interface ProductOptions {
    since_id?: string;
    limit?: number;
    status?: 'active' | 'archived' | 'draft' | 'any';
}

/**
 * Configuration returned by getConfig()
 */
export interface ShopifyConfigStatus {
    configured: boolean;
    shopDomain: string | null;
    apiVersion: string;
}

// ============================================
// SHOPIFY API RESPONSE TYPES
// ============================================

/**
 * Result of marking an order as paid
 */
export interface MarkPaidResult {
    success: boolean;
    transaction?: ShopifyTransaction;
    error?: string;
    errorCode?: number;
    shouldRetry?: boolean;
}

/**
 * Shopify inventory location
 */
export interface ShopifyLocation {
    id: string;
    name: string;
    address?: {
        address1?: string;
        city?: string;
        country?: string;
    };
}

/**
 * Result of setting inventory quantity
 */
export interface SetInventoryResult {
    success: boolean;
    error?: string;
    inventoryItemId?: string;
    locationId?: string;
    quantity?: number;
}

/**
 * Inventory item details from GraphQL
 */
export interface InventoryItemInfo {
    inventoryItemId: string;
    sku: string;
    variantId: string;
    productId: string;
    title: string;
    inventoryQuantity: number;
}

/**
 * Shopify address object
 */
export interface ShopifyAddress {
    first_name?: string;
    last_name?: string;
    address1?: string;
    address2?: string;
    city?: string;
    province?: string;
    country?: string;
    country_code?: string;
    zip?: string;
    phone?: string;
}

/**
 * Formatted address for ERP
 */
export interface FormattedAddress {
    address1: string;
    address2: string;
    city: string;
    province: string;
    country: string;
    zip: string;
    phone: string;
}

/**
 * Shopify line item
 */
export interface ShopifyLineItem {
    id: number;
    variant_id: number | null;
    product_id: number | null;
    title: string;
    variant_title?: string;
    sku?: string;
    quantity: number;
    price: string;
    total_discount: string;
    fulfillment_status?: string | null;
    grams?: number;
    properties?: Array<{ name: string; value: string }>;
    /** Discount allocations applied to this line item */
    discount_allocations?: Array<{ amount: string; discount_application_index?: number }>;
}

/**
 * Shopify fulfillment object
 */
export interface ShopifyFulfillment {
    id: number;
    order_id: number;
    status: string;
    tracking_company?: string;
    tracking_number?: string;
    tracking_numbers?: string[];
    tracking_url?: string;
    tracking_urls?: string[];
    created_at: string;
    updated_at: string;
    /** Line items included in this fulfillment (for partial/split shipments) */
    line_items?: Array<{ id: number; quantity?: number }>;
    /** Shipment status from carrier (in_transit, delivered, etc.) */
    shipment_status?: string | null;
}

/**
 * Shopify order object (partial - key fields used by ERP)
 */
export interface ShopifyOrder {
    id: number;
    name: string;  // Order number like "#1001"
    order_number: number;
    email?: string;
    phone?: string;
    created_at: string;
    updated_at: string;
    cancelled_at: string | null;
    closed_at: string | null;
    financial_status: string;
    fulfillment_status: string | null;
    total_price: string;
    subtotal_price: string;
    total_tax: string;
    total_discounts: string;
    currency: string;
    source_name?: string;
    landing_site?: string | null;
    referring_site?: string | null;
    browser_ip?: string | null;
    discount_codes?: Array<{ code: string; amount: string; type: string }>;
    customer?: ShopifyCustomer;
    billing_address?: ShopifyAddress;
    shipping_address?: ShopifyAddress;
    line_items: ShopifyLineItem[];
    fulfillments?: ShopifyFulfillment[];
    note?: string;
    tags?: string;
    gateway?: string;
    payment_gateway_names?: string[];
    /** Staff/internal notes from Shopify admin */
    note_attributes?: Array<{ name: string; value: string }>;
    /** Shipping method details */
    shipping_lines?: Array<{ title: string; price: string }>;
    /** Tax breakdown */
    tax_lines?: Array<{ title: string; price: string; rate: number }>;
}

/**
 * Shopify customer object (partial)
 */
export interface ShopifyCustomer {
    id: number;
    email?: string;
    phone?: string;
    first_name?: string;
    last_name?: string;
    created_at: string;
    updated_at: string;
    orders_count: number;
    total_spent: string;
    default_address?: ShopifyAddress;
    tags?: string;
    note?: string;
    accepts_marketing?: boolean;
}

/**
 * Shopify product variant
 */
export interface ShopifyVariant {
    id: number;
    product_id: number;
    title: string;
    sku?: string;
    price: string;
    compare_at_price?: string | null;
    inventory_quantity?: number;
    option1?: string;
    option2?: string;
    option3?: string;
    barcode?: string;
    grams?: number;
    weight?: number;
    weight_unit?: string;
}

/**
 * Shopify product option
 */
export interface ShopifyProductOption {
    id: number;
    product_id: number;
    name: string;
    position: number;
    values: string[];
}

/**
 * Shopify product image
 */
export interface ShopifyImage {
    id: number;
    product_id: number;
    position: number;
    src: string;
    alt?: string;
    width?: number;
    height?: number;
}

/**
 * Shopify product object (partial)
 */
export interface ShopifyProduct {
    id: number;
    title: string;
    handle: string;
    body_html?: string;
    vendor?: string;
    product_type?: string;
    created_at: string;
    updated_at: string;
    published_at?: string;
    status: string;
    tags?: string;
    variants: ShopifyVariant[];
    options: ShopifyProductOption[];
    images?: ShopifyImage[];
}

/**
 * Shopify metafield object
 */
export interface ShopifyMetafield {
    id: number;
    namespace: string;
    key: string;
    value: string;
    type: string;
    created_at: string;
    updated_at: string;
}

/**
 * Shopify transaction object
 */
export interface ShopifyTransaction {
    id: number;
    order_id: number;
    kind: string;
    status: string;
    amount: string;
    gateway: string;
    authorization?: string;
    processed_at: string;
    created_at: string;
}

/**
 * Product feed enrichment types (from GraphQL)
 */
export interface ProductFeedGraphQLResponse {
    product: {
        collections?: {
            edges: Array<{ node: { id: string; title: string; handle: string } }>;
        };
        resourcePublications?: {
            edges: Array<{ node: { isPublished: boolean; publication: { name: string } } }>;
        };
        variants?: {
            edges: Array<{
                node: {
                    id: string;
                    title: string;
                    sku: string | null;
                    metafields?: {
                        edges: Array<{ node: { namespace: string; key: string; value: string; type: string } }>;
                    };
                    inventoryItem?: {
                        id: string;
                        inventoryLevels?: {
                            edges: Array<{
                                node: {
                                    id: string;
                                    location: { name: string };
                                    quantities: Array<{ name: string; quantity: number }>;
                                };
                            }>;
                        };
                    };
                };
            }>;
        };
    };
}

export interface VariantFeedData {
    variantId: string;
    sku: string | null;
    title: string;
    metafields: Array<{ namespace: string; key: string; value: string; type: string }>;
    inventoryLevels: Array<{
        locationName: string;
        quantities: Record<string, number>;
    }>;
}

export interface ProductFeedData {
    collections: Array<{ title: string; handle: string }>;
    salesChannels: Array<{ name: string; isPublished: boolean }>;
    variantEnrichments: VariantFeedData[];
}
