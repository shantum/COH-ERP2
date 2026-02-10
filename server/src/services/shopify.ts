import type { AxiosInstance, AxiosResponse } from 'axios';
import axios, { AxiosError } from 'axios';
import prisma from '../lib/prisma.js';
import { shopifyLogger } from '../utils/logger.js';

// ============================================
// TYPES & INTERFACES
// ============================================

/**
 * Rate limit state tracking for Shopify API
 */
interface RateLimitState {
    remaining: number;
    lastUpdated: number | null;
    retryAfter: number | null;
}

/**
 * Options for fetching orders
 */
interface OrderOptions {
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
interface CustomerOptions {
    since_id?: string;
    created_at_min?: string;
    updated_at_min?: string;
    limit?: number;
}

/**
 * Options for fetching products
 */
interface ProductOptions {
    since_id?: string;
    limit?: number;
    status?: 'active' | 'archived' | 'draft' | 'any';
}

/**
 * Retry options for API requests
 */
interface RetryOptions {
    maxRetries?: number;
    baseDelay?: number;
}

/**
 * Configuration returned by getConfig()
 */
interface ShopifyConfigStatus {
    configured: boolean;
    shopDomain: string | null;
    apiVersion: string;
}

/**
 * Result of marking an order as paid
 */
interface MarkPaidResult {
    success: boolean;
    transaction?: ShopifyTransaction;
    error?: string;
    errorCode?: number;
    shouldRetry?: boolean;
}

/**
 * Shopify inventory location
 */
interface ShopifyLocation {
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
interface SetInventoryResult {
    success: boolean;
    error?: string;
    inventoryItemId?: string;
    locationId?: string;
    quantity?: number;
}

/**
 * Inventory item details from GraphQL
 */
interface InventoryItemInfo {
    inventoryItemId: string;
    sku: string;
    variantId: string;
    productId: string;
    title: string;
    inventoryQuantity: number;
}

// ============================================
// SHOPIFY API RESPONSE TYPES
// ============================================

/**
 * Shopify address object
 */
interface ShopifyAddress {
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
interface FormattedAddress {
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
interface ShopifyLineItem {
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
interface ShopifyFulfillment {
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
interface ShopifyOrder {
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
interface ShopifyCustomer {
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
interface ShopifyVariant {
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
interface ShopifyProductOption {
    id: number;
    product_id: number;
    name: string;
    position: number;
    values: string[];
}

/**
 * Shopify product image
 */
interface ShopifyImage {
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
interface ShopifyProduct {
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
interface ShopifyMetafield {
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
interface ShopifyTransaction {
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
interface ProductFeedGraphQLResponse {
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

// ============================================
// SHOPIFY CLIENT CLASS
// ============================================

/**
 * Shopify Admin API client for importing orders and customers
 *
 * Configuration is loaded from:
 * 1. Database (SystemSetting table) - takes priority
 * 2. Environment variables as fallback
 *
 * Features:
 * - Automatic rate limit handling with exponential backoff
 * - Request retry on transient failures
 * - Detailed error logging
 */
class ShopifyClient {
    private shopDomain: string | undefined;
    private accessToken: string | undefined;
    private readonly apiVersion: string = '2024-10';
    private client: AxiosInstance | null = null;
    private rateLimitState: RateLimitState;

    constructor() {
        this.shopDomain = process.env.SHOPIFY_SHOP_DOMAIN;
        this.accessToken = process.env.SHOPIFY_ACCESS_TOKEN;

        // Rate limiting state
        this.rateLimitState = {
            remaining: 40,       // Shopify default bucket size
            lastUpdated: null,
            retryAfter: null,
        };

        this.initializeClient();
    }

    private initializeClient(): void {
        if (this.shopDomain && this.accessToken) {
            // Clean and convert the domain to the correct API format
            let cleanDomain = this.shopDomain
                .replace(/^https?:\/\//, '')
                .replace(/\/$/, '')
                .trim();

            // Convert admin.shopify.com/store/xxx format to xxx.myshopify.com
            const adminMatch = cleanDomain.match(/admin\.shopify\.com\/store\/([^\/]+)/);
            if (adminMatch) {
                cleanDomain = `${adminMatch[1]}.myshopify.com`;
                shopifyLogger.debug({ cleanDomain }, 'Converted admin URL');
            }

            // If it doesn't have .myshopify.com, assume it's just the store name
            if (!cleanDomain.includes('.myshopify.com') && !cleanDomain.includes('.')) {
                cleanDomain = `${cleanDomain}.myshopify.com`;
            }

            const baseURL = `https://${cleanDomain}/admin/api/${this.apiVersion}`;
            shopifyLogger.debug({ baseURL }, 'Shopify API initialized');

            this.client = axios.create({
                baseURL,
                headers: {
                    'X-Shopify-Access-Token': this.accessToken,
                    'Content-Type': 'application/json',
                },
                timeout: 30000, // 30 second timeout to prevent hung requests
            });
        }
    }

    /**
     * Load configuration - prefers env vars, falls back to database
     * Credentials should be set via environment variables for security
     */
    async loadFromDatabase(): Promise<void> {
        // Prefer environment variables (set in constructor)
        if (this.shopDomain && this.accessToken) {
            shopifyLogger.debug('Using Shopify credentials from environment variables');
            this.initializeClient();
            return;
        }

        // Fall back to database only if env vars not set
        try {
            const domainSetting = await prisma.systemSetting.findUnique({
                where: { key: 'shopify_shop_domain' },
            });
            const tokenSetting = await prisma.systemSetting.findUnique({
                where: { key: 'shopify_access_token' },
            });

            if (domainSetting?.value && !this.shopDomain) {
                this.shopDomain = domainSetting.value;
            }
            if (tokenSetting?.value && !this.accessToken) {
                // Database tokens are stored in plaintext now (no encryption)
                this.accessToken = tokenSetting.value;
                shopifyLogger.warn('Using Shopify credentials from database. Consider moving to environment variables.');
            }

            this.initializeClient();
        } catch (error) {
            shopifyLogger.error({ error: (error as Error).message }, 'Failed to load Shopify config from database');
        }
    }

    /**
     * Update configuration and reinitialize client
     * Note: For production, credentials should be set via environment variables
     */
    async updateConfig(shopDomain: string, accessToken?: string): Promise<void> {
        // Warn if trying to update while env vars are set
        if (process.env.SHOPIFY_ACCESS_TOKEN) {
            shopifyLogger.warn('Shopify credentials are set via environment variables. Database update will be ignored on restart.');
        }

        await prisma.systemSetting.upsert({
            where: { key: 'shopify_shop_domain' },
            update: { value: shopDomain },
            create: { key: 'shopify_shop_domain', value: shopDomain },
        });

        // Only update token if a new one is provided
        if (accessToken && accessToken !== 'KEEP_EXISTING') {
            // Store token in plaintext (no encryption - use env vars for security)
            await prisma.systemSetting.upsert({
                where: { key: 'shopify_access_token' },
                update: { value: accessToken },
                create: { key: 'shopify_access_token', value: accessToken },
            });
            this.accessToken = accessToken;
        }

        this.shopDomain = shopDomain;
        this.initializeClient();
    }

    isConfigured(): boolean {
        return !!(this.shopDomain && this.accessToken);
    }

    getConfig(): ShopifyConfigStatus {
        return {
            configured: this.isConfigured(),
            shopDomain: this.shopDomain || null,
            apiVersion: this.apiVersion,
        };
    }

    // ============================================
    // RATE LIMITING & RETRY LOGIC
    // ============================================

    /**
     * Update rate limit state from response headers
     */
    private updateRateLimitState(response: AxiosResponse): void {
        const callLimit = response.headers['x-shopify-shop-api-call-limit'];
        if (callLimit) {
            const [used, total] = callLimit.split('/').map(Number);
            this.rateLimitState.remaining = total - used;
            this.rateLimitState.lastUpdated = Date.now();
        }

        const retryAfter = response.headers['retry-after'];
        if (retryAfter) {
            this.rateLimitState.retryAfter = Date.now() + (parseFloat(retryAfter) * 1000);
        }
    }

    /**
     * Wait if we need to respect rate limits
     */
    private async waitForRateLimit(): Promise<void> {
        // If we have a retry-after time in the future, wait
        if (this.rateLimitState.retryAfter && Date.now() < this.rateLimitState.retryAfter) {
            const waitTime = this.rateLimitState.retryAfter - Date.now();
            shopifyLogger.debug({ waitMs: waitTime }, 'Rate limited, waiting');
            await new Promise(resolve => setTimeout(resolve, waitTime + 100));
            this.rateLimitState.retryAfter = null;
        }

        // If we're low on remaining calls, add a small delay
        if (this.rateLimitState.remaining < 5) {
            const delay = Math.max(500, (5 - this.rateLimitState.remaining) * 200);
            await new Promise(resolve => setTimeout(resolve, delay));
        }
    }

    /**
     * Execute a request with automatic retry and rate limit handling
     */
    private async executeWithRetry<T>(
        requestFn: () => Promise<AxiosResponse<T>>,
        options: RetryOptions = {}
    ): Promise<AxiosResponse<T>> {
        const { maxRetries = 3, baseDelay = 1000 } = options;
        let lastError: Error | undefined;

        for (let attempt = 0; attempt <= maxRetries; attempt++) {
            try {
                // Wait for rate limit if needed
                await this.waitForRateLimit();

                const response = await requestFn();

                // Update rate limit state from response
                this.updateRateLimitState(response);

                return response;
            } catch (error) {
                lastError = error as Error;
                const axiosError = error as AxiosError;
                const status = axiosError.response?.status;

                // Update rate limit state even on error responses
                if (axiosError.response) {
                    this.updateRateLimitState(axiosError.response);
                }

                // 429 = Rate limited - always retry with backoff
                if (status === 429) {
                    const retryAfterHeader = axiosError.response?.headers['retry-after'];
                    const retryAfter = retryAfterHeader ? parseFloat(retryAfterHeader as string) : null;
                    const waitTime = retryAfter ? retryAfter * 1000 : baseDelay * Math.pow(2, attempt);
                    shopifyLogger.warn({ waitMs: waitTime, attempt: attempt + 1, maxRetries: maxRetries + 1 }, 'Rate limited (429), retrying');
                    await new Promise(resolve => setTimeout(resolve, waitTime));
                    continue;
                }

                // 5xx errors - retry with exponential backoff
                if (status && status >= 500 && attempt < maxRetries) {
                    const waitTime = baseDelay * Math.pow(2, attempt);
                    shopifyLogger.warn({ status, waitMs: waitTime, attempt: attempt + 1, maxRetries: maxRetries + 1 }, 'Server error, retrying');
                    await new Promise(resolve => setTimeout(resolve, waitTime));
                    continue;
                }

                // Network errors - retry with backoff
                if (!axiosError.response && attempt < maxRetries) {
                    const waitTime = baseDelay * Math.pow(2, attempt);
                    shopifyLogger.warn({ error: axiosError.message, waitMs: waitTime, attempt: attempt + 1, maxRetries: maxRetries + 1 }, 'Network error, retrying');
                    await new Promise(resolve => setTimeout(resolve, waitTime));
                    continue;
                }

                // Other errors - don't retry
                throw error;
            }
        }

        throw lastError;
    }

    // ============================================
    // ORDERS
    // ============================================

    /**
     * Fetch orders from Shopify
     */
    async getOrders(options: OrderOptions = {}): Promise<ShopifyOrder[]> {
        if (!this.isConfigured()) {
            throw new Error('Shopify is not configured');
        }

        const params: Record<string, string | number> = {
            status: options.status || 'any',
            limit: Math.min(options.limit || 50, 250),
        };

        // Note: Shopify doesn't allow 'order' param when using since_id
        // since_id already implies ordering by ID (ascending)
        if (options.since_id) {
            params.since_id = options.since_id;
        } else {
            // Only use order param when not using since_id
            params.order = 'created_at asc';
        }

        if (options.created_at_min) params.created_at_min = options.created_at_min;
        if (options.created_at_max) params.created_at_max = options.created_at_max;
        if (options.updated_at_min) params.updated_at_min = options.updated_at_min;
        if (options.updated_at_max) params.updated_at_max = options.updated_at_max;

        const response = await this.executeWithRetry<{ orders: ShopifyOrder[] }>(
            () => this.client!.get('/orders.json', { params })
        );
        return response.data.orders;
    }

    /**
     * Fetch a single order by ID
     */
    async getOrder(orderId: string | number): Promise<ShopifyOrder> {
        if (!this.isConfigured()) {
            throw new Error('Shopify is not configured');
        }

        const response = await this.executeWithRetry<{ order: ShopifyOrder }>(
            () => this.client!.get(`/orders/${orderId}.json`)
        );
        return response.data.order;
    }

    /**
     * Get order count for status check
     */
    async getOrderCount(options: Pick<OrderOptions, 'status' | 'created_at_min'> = {}): Promise<number> {
        if (!this.isConfigured()) {
            throw new Error('Shopify is not configured');
        }

        const params: Record<string, string> = { status: options.status || 'any' };
        if (options.created_at_min) params.created_at_min = options.created_at_min;

        const response = await this.executeWithRetry<{ count: number }>(
            () => this.client!.get('/orders/count.json', { params })
        );
        return response.data.count;
    }

    // ============================================
    // CUSTOMERS
    // ============================================

    /**
     * Fetch customers from Shopify
     */
    async getCustomers(options: CustomerOptions = {}): Promise<ShopifyCustomer[]> {
        if (!this.isConfigured()) {
            throw new Error('Shopify is not configured');
        }

        const params: Record<string, string | number> = {
            limit: Math.min(options.limit || 50, 250),
        };

        if (options.since_id) params.since_id = options.since_id;
        if (options.created_at_min) params.created_at_min = options.created_at_min;
        if (options.updated_at_min) params.updated_at_min = options.updated_at_min;

        const response = await this.executeWithRetry<{ customers: ShopifyCustomer[] }>(
            () => this.client!.get('/customers.json', { params })
        );
        return response.data.customers;
    }

    /**
     * Fetch a single customer by ID
     */
    async getCustomer(customerId: string | number): Promise<ShopifyCustomer> {
        if (!this.isConfigured()) {
            throw new Error('Shopify is not configured');
        }

        const response = await this.executeWithRetry<{ customer: ShopifyCustomer }>(
            () => this.client!.get(`/customers/${customerId}.json`)
        );
        return response.data.customer;
    }

    /**
     * Get customer count
     */
    async getCustomerCount(): Promise<number> {
        if (!this.isConfigured()) {
            throw new Error('Shopify is not configured');
        }

        const response = await this.executeWithRetry<{ count: number }>(
            () => this.client!.get('/customers/count.json')
        );
        return response.data.count;
    }

    /**
     * Fetch ALL orders using pagination (for bulk sync)
     */
    async getAllOrders(
        onProgress?: (fetched: number, total: number) => void,
        options: Pick<OrderOptions, 'status' | 'created_at_min'> = {}
    ): Promise<ShopifyOrder[]> {
        if (!this.isConfigured()) {
            throw new Error('Shopify is not configured');
        }

        const allOrders: ShopifyOrder[] = [];
        let sinceId: string | null = null;
        const limit = 250; // Max allowed by Shopify
        const totalCount = await this.getOrderCount(options);

        // Track consecutive empty batches to detect true end of data
        let consecutiveSmallBatches = 0;
        const maxConsecutiveSmallBatches = 3;

        while (true) {
            const params: Record<string, string | number> = {
                status: options.status || 'any',
                limit,
            };
            if (sinceId) params.since_id = sinceId;
            if (options.created_at_min) params.created_at_min = options.created_at_min;

            const response = await this.executeWithRetry<{ orders: ShopifyOrder[] }>(
                () => this.client!.get('/orders.json', { params })
            );
            const orders = response.data.orders;

            // True end: no orders returned
            if (orders.length === 0) break;

            allOrders.push(...orders);
            sinceId = String(orders[orders.length - 1].id);

            if (onProgress) {
                onProgress(allOrders.length, totalCount);
            }

            // Small delay to avoid rate limiting (in addition to automatic handling)
            await new Promise(resolve => setTimeout(resolve, 100));

            // Check if we should stop:
            // - If we've fetched at least totalCount, we're done
            // - If batch is small AND we've had multiple consecutive small batches, stop
            // This handles gaps in Shopify IDs (deleted orders) while still stopping eventually
            if (orders.length < limit) {
                consecutiveSmallBatches++;
                if (allOrders.length >= totalCount || consecutiveSmallBatches >= maxConsecutiveSmallBatches) {
                    break;
                }
            } else {
                consecutiveSmallBatches = 0;
            }
        }

        return allOrders;
    }

    /**
     * Fetch ALL customers using pagination (for bulk sync)
     */
    async getAllCustomers(
        onProgress?: (fetched: number, total: number) => void
    ): Promise<ShopifyCustomer[]> {
        if (!this.isConfigured()) {
            throw new Error('Shopify is not configured');
        }

        const allCustomers: ShopifyCustomer[] = [];
        let sinceId: string | null = null;
        const limit = 250; // Max allowed by Shopify
        const totalCount = await this.getCustomerCount();

        while (true) {
            const params: Record<string, string | number> = { limit };
            if (sinceId) params.since_id = sinceId;

            const response = await this.executeWithRetry<{ customers: ShopifyCustomer[] }>(
                () => this.client!.get('/customers.json', { params })
            );
            const customers = response.data.customers;

            if (customers.length === 0) break;

            allCustomers.push(...customers);
            sinceId = String(customers[customers.length - 1].id);

            if (onProgress) {
                onProgress(allCustomers.length, totalCount);
            }

            // Small delay to avoid rate limiting (in addition to automatic handling)
            await new Promise(resolve => setTimeout(resolve, 100));

            if (customers.length < limit) break;
        }

        return allCustomers;
    }

    // ============================================
    // PRODUCTS (for SKU matching)
    // ============================================

    /**
     * Fetch products from Shopify (useful for SKU matching)
     * NOTE: Pass status to filter by product status. Default fetches only active products.
     * Use 'any' to fetch all statuses (makes 3 API calls internally).
     */
    async getProducts(options: ProductOptions = {}): Promise<ShopifyProduct[]> {
        if (!this.isConfigured()) {
            throw new Error('Shopify is not configured');
        }

        const limit = Math.min(options.limit || 50, 250);

        // Handle 'any' status by fetching all three statuses
        if (options.status === 'any') {
            const statuses: Array<'active' | 'archived' | 'draft'> = ['active', 'archived', 'draft'];
            const allProducts: ShopifyProduct[] = [];

            for (const status of statuses) {
                const params: Record<string, string | number> = { status, limit };
                if (options.since_id) params.since_id = options.since_id;

                const response = await this.executeWithRetry<{ products: ShopifyProduct[] }>(
                    () => this.client!.get('/products.json', { params })
                );
                allProducts.push(...response.data.products);
            }
            return allProducts;
        }

        // Single status fetch
        const params: Record<string, string | number> = { limit };
        if (options.status) params.status = options.status;
        if (options.since_id) params.since_id = options.since_id;

        const response = await this.executeWithRetry<{ products: ShopifyProduct[] }>(
            () => this.client!.get('/products.json', { params })
        );
        return response.data.products;
    }

    /**
     * Fetch ALL products from Shopify with pagination
     * Fetches all three statuses (active, archived, draft) to ensure complete sync.
     */
    async getAllProducts(
        onProgress: ((fetched: number) => void) | null = null
    ): Promise<ShopifyProduct[]> {
        if (!this.isConfigured()) {
            throw new Error('Shopify is not configured');
        }

        const allProducts: ShopifyProduct[] = [];
        const statuses: Array<'active' | 'archived' | 'draft'> = ['active', 'archived', 'draft'];

        // Fetch each status separately (Shopify API doesn't support 'any' for products)
        for (const status of statuses) {
            let hasMore = true;
            let pageInfo: string | null = null;
            let sinceId: string | null = null;

            while (hasMore) {
                // IMPORTANT: When using page_info, only limit is allowed (no status/filters)
                // The cursor "remembers" the original query params
                const params: Record<string, string | number> = pageInfo
                    ? { page_info: pageInfo, limit: 250 }
                    : sinceId
                        ? { status, since_id: sinceId, limit: 250 }
                        : { status, limit: 250 };

                const response = await this.executeWithRetry<{ products: ShopifyProduct[] }>(
                    () => this.client!.get('/products.json', { params })
                );
                const products = response.data.products;

                if (products.length === 0) {
                    hasMore = false;
                } else {
                    allProducts.push(...products);

                    if (onProgress) {
                        onProgress(allProducts.length);
                    }

                    // Check for pagination link header
                    const linkHeader = response.headers.link as string | undefined;
                    if (linkHeader && linkHeader.includes('rel="next"')) {
                        const nextMatch = linkHeader.match(/<[^>]*page_info=([^>&]*)[^>]*>;\s*rel="next"/);
                        pageInfo = nextMatch ? nextMatch[1] : null;
                        hasMore = !!pageInfo;
                    } else {
                        if (products.length < 250) {
                            hasMore = false;
                        } else {
                            sinceId = String(products[products.length - 1].id);
                            pageInfo = null;
                        }
                    }
                }

                // Small delay to avoid rate limiting
                await new Promise(resolve => setTimeout(resolve, 100));
            }
        }

        return allProducts;
    }

    /**
     * Get product count
     */
    async getProductCount(): Promise<number> {
        if (!this.isConfigured()) {
            throw new Error('Shopify is not configured');
        }

        const response = await this.executeWithRetry<{ count: number }>(
            () => this.client!.get('/products/count.json')
        );
        return response.data.count;
    }

    /**
     * Fetch metafields for a product
     */
    async getProductMetafields(productId: string | number): Promise<ShopifyMetafield[]> {
        if (!this.isConfigured()) {
            throw new Error('Shopify is not configured');
        }

        try {
            const response = await this.executeWithRetry<{ metafields: ShopifyMetafield[] }>(
                () => this.client!.get(`/products/${productId}/metafields.json`)
            );
            return response.data.metafields || [];
        } catch (error) {
            shopifyLogger.error({ productId, error: (error as Error).message }, 'Failed to fetch metafields for product');
            return [];
        }
    }

    /**
     * Extract gender from product data
     * Priority: 1. Tags (source of truth), 2. Metafields, 3. Product Type
     */
    extractGenderFromMetafields(
        metafields: ShopifyMetafield[] | null | undefined,
        productType: string | null = null,
        tags: string | null = null
    ): 'women' | 'men' | 'unisex' {
        // PRIORITY 1: Tags are the source of truth
        if (tags) {
            const tagLower = tags.toLowerCase();

            // Check for explicit _related_ tags first (most reliable)
            if (tagLower.includes('_related_women')) {
                return 'women';
            }
            if (tagLower.includes('_related_men')) {
                return 'men';
            }

            // Check for Women/Men in tags (e.g., "Women Top Wear", "Men Shirts")
            // Must check women first since "men" is substring of "women"
            if (tagLower.includes('women') || tagLower.includes('woman')) {
                return 'women';
            }
            if (tagLower.includes(' men') || tagLower.includes('men ') ||
                tagLower.startsWith('men') || tagLower.includes(',men')) {
                return 'men';
            }

            if (tagLower.includes('unisex')) {
                return 'unisex';
            }
        }

        // PRIORITY 2: Try my_fields.gender metafield
        const genderField = metafields?.find(
            mf => mf.namespace === 'my_fields' && mf.key === 'gender'
        );

        if (genderField?.value) {
            return this.normalizeGender(genderField.value);
        }

        // PRIORITY 3: Try custom.product_type_for_feed metafield
        const productTypeField = metafields?.find(
            mf => mf.namespace === 'custom' && mf.key === 'product_type_for_feed'
        );

        if (productTypeField?.value) {
            return this.normalizeGender(productTypeField.value);
        }

        // PRIORITY 4: Fallback to main product_type field
        if (productType) {
            return this.normalizeGender(productType);
        }

        return 'unisex';
    }

    /**
     * Normalize gender value to standard format
     */
    private normalizeGender(value: string): 'women' | 'men' | 'unisex' {
        if (!value) return 'unisex';

        const lowerValue = value.toLowerCase().trim();

        // Check for women/female indicators
        if (lowerValue.includes('women') || lowerValue.includes('woman') ||
            lowerValue.includes('female') || lowerValue.includes('girl') ||
            lowerValue.startsWith('w ') || lowerValue === 'f') {
            return 'women';
        }

        // Check for men/male indicators (must come after women check to avoid "women" matching "men")
        if (lowerValue.includes('men') || lowerValue.includes('man') ||
            lowerValue.includes('male') || lowerValue.includes('boy') ||
            lowerValue.startsWith('m ') || lowerValue === 'm') {
            return 'men';
        }

        if (lowerValue.includes('unisex') || lowerValue.includes('all')) {
            return 'unisex';
        }

        return 'unisex';
    }


    // ============================================
    // PAYMENT/TRANSACTION METHODS
    // ============================================

    /**
     * Mark a Shopify order as paid by creating a transaction
     * Used for COD orders when remittance is received
     *
     * IMPORTANT: Proper error logging for debugging COD sync issues
     */
    async markOrderAsPaid(
        shopifyOrderId: string | number,
        amount: number,
        utr: string,
        paidAt: Date = new Date()
    ): Promise<MarkPaidResult> {
        if (!this.isConfigured()) {
            shopifyLogger.error('Shopify not configured for COD sync');
            return { success: false, error: 'Shopify is not configured', shouldRetry: false };
        }

        if (!shopifyOrderId) {
            shopifyLogger.error('No Shopify order ID provided for COD sync');
            return { success: false, error: 'No Shopify order ID provided', shouldRetry: false };
        }

        const transactionData = {
            transaction: {
                kind: 'capture',          // capture = payment received
                status: 'success',
                amount: String(amount),
                gateway: 'Cash on Delivery',
                source: 'external',
                authorization: utr || `COD-${Date.now()}`,
                processed_at: paidAt.toISOString(),
            }
        };

        try {
            // Create a transaction to mark the order as paid
            const response = await this.executeWithRetry<{ transaction: ShopifyTransaction }>(
                () => this.client!.post(`/orders/${shopifyOrderId}/transactions.json`, transactionData),
                { maxRetries: 2 } // Limit retries for payment operations
            );

            shopifyLogger.info({ shopifyOrderId, amount }, 'Order marked as paid');

            return {
                success: true,
                transaction: response.data.transaction,
            };
        } catch (error) {
            const axiosError = error as AxiosError<{ errors?: unknown; error?: string }>;
            const status = axiosError.response?.status;
            const errorData = axiosError.response?.data;
            const errorMessage = errorData?.errors || errorData?.error || (error as Error).message;

            // Determine if this error is retryable
            const shouldRetry = status === 429 || (status !== undefined && status >= 500) || !axiosError.response;

            // Structured error logging for debugging
            shopifyLogger.error({
                shopifyOrderId,
                amount,
                utr,
                httpStatus: status,
                error: typeof errorMessage === 'object' ? JSON.stringify(errorMessage) : errorMessage,
                shouldRetry
            }, 'Failed to mark order as paid');

            return {
                success: false,
                error: typeof errorMessage === 'object' ? JSON.stringify(errorMessage) : String(errorMessage),
                errorCode: status,
                shouldRetry,
            };
        }
    }

    /**
     * Get transactions for a Shopify order
     */
    async getOrderTransactions(shopifyOrderId: string | number): Promise<ShopifyTransaction[]> {
        if (!this.isConfigured()) {
            throw new Error('Shopify is not configured');
        }

        try {
            const response = await this.executeWithRetry<{ transactions: ShopifyTransaction[] }>(
                () => this.client!.get(`/orders/${shopifyOrderId}/transactions.json`)
            );
            return response.data.transactions || [];
        } catch (error) {
            shopifyLogger.error({ shopifyOrderId, error: (error as Error).message }, 'Failed to get transactions for order');
            return [];
        }
    }

    // ============================================
    // PRODUCT FEED ENRICHMENT (GraphQL)
    // ============================================

    /**
     * Fetch full feed-level data for a product via GraphQL:
     * collections, publications (sales channels), variant metafields, inventory by location.
     * One API call for everything.
     */
    async getProductFeedData(shopifyProductId: string | number): Promise<ProductFeedData> {
        if (!this.isConfigured()) {
            throw new Error('Shopify is not configured');
        }

        const gid = `gid://shopify/Product/${shopifyProductId}`;

        const query = `
            query ProductFeedData($id: ID!) {
                product(id: $id) {
                    collections(first: 50) {
                        edges {
                            node {
                                id
                                title
                                handle
                            }
                        }
                    }
                    resourcePublications(first: 20) {
                        edges {
                            node {
                                isPublished
                                publication {
                                    name
                                }
                            }
                        }
                    }
                    variants(first: 100) {
                        edges {
                            node {
                                id
                                title
                                sku
                                metafields(first: 30) {
                                    edges {
                                        node {
                                            namespace
                                            key
                                            value
                                            type
                                        }
                                    }
                                }
                                inventoryItem {
                                    id
                                    inventoryLevels(first: 10) {
                                        edges {
                                            node {
                                                id
                                                location {
                                                    name
                                                }
                                                quantities(names: ["available", "committed", "on_hand"]) {
                                                    name
                                                    quantity
                                                }
                                            }
                                        }
                                    }
                                }
                            }
                        }
                    }
                }
            }
        `;

        try {
            const data = await this.executeGraphQL<ProductFeedGraphQLResponse>(query, { id: gid });
            const product = data.product;

            // Transform collections
            const collections = (product.collections?.edges ?? []).map(e => ({
                title: e.node.title,
                handle: e.node.handle,
            }));

            // Transform publications (sales channels)
            const salesChannels = (product.resourcePublications?.edges ?? []).map(e => ({
                name: e.node.publication.name,
                isPublished: e.node.isPublished,
            }));

            // Transform variant data
            const variantEnrichments: VariantFeedData[] = (product.variants?.edges ?? []).map(e => {
                const v = e.node;
                const variantId = v.id.replace('gid://shopify/ProductVariant/', '');

                const metafields = (v.metafields?.edges ?? []).map(mf => ({
                    namespace: mf.node.namespace,
                    key: mf.node.key,
                    value: mf.node.value,
                    type: mf.node.type,
                }));

                const inventoryLevels = (v.inventoryItem?.inventoryLevels?.edges ?? []).map(il => ({
                    locationName: il.node.location.name,
                    quantities: (il.node.quantities ?? []).reduce((acc: Record<string, number>, q) => {
                        acc[q.name] = q.quantity;
                        return acc;
                    }, {}),
                }));

                return {
                    variantId,
                    sku: v.sku ?? null,
                    title: v.title,
                    metafields,
                    inventoryLevels,
                };
            });

            return { collections, salesChannels, variantEnrichments };
        } catch (error) {
            shopifyLogger.error({ shopifyProductId, error: (error as Error).message }, 'Failed to fetch product feed data');
            return { collections: [], salesChannels: [], variantEnrichments: [] };
        }
    }

    // ============================================
    // GRAPHQL HELPER
    // ============================================

    /**
     * Execute a GraphQL query/mutation against Shopify Admin API
     */
    private async executeGraphQL<T>(query: string, variables?: Record<string, unknown>): Promise<T> {
        if (!this.isConfigured()) {
            throw new Error('Shopify is not configured');
        }

        const response = await this.executeWithRetry<{ data: T; errors?: Array<{ message: string }> }>(
            () => this.client!.post('/graphql.json', { query, variables })
        );

        if (response.data.errors && response.data.errors.length > 0) {
            const errorMessages = response.data.errors.map(e => e.message).join(', ');
            throw new Error(`GraphQL Error: ${errorMessages}`);
        }

        return response.data.data;
    }

    // ============================================
    // INVENTORY MANAGEMENT (GraphQL)
    // ============================================

    /**
     * Get all active inventory locations
     */
    async getLocations(): Promise<ShopifyLocation[]> {
        const query = `
            query GetLocations($first: Int!) {
                locations(first: $first) {
                    edges {
                        node {
                            id
                            name
                            address {
                                address1
                                city
                                country
                            }
                        }
                    }
                }
            }
        `;

        interface LocationsResponse {
            locations: {
                edges: Array<{
                    node: {
                        id: string;
                        name: string;
                        address?: {
                            address1?: string;
                            city?: string;
                            country?: string;
                        };
                    };
                }>;
            };
        }

        const data = await this.executeGraphQL<LocationsResponse>(query, { first: 50 });
        return data.locations.edges.map(edge => edge.node);
    }

    /**
     * Get inventory item info by SKU
     * Returns the inventory item ID needed for setting quantity
     */
    async getInventoryItemBySku(sku: string): Promise<InventoryItemInfo | null> {
        const query = `
            query GetVariantBySku($query: String!) {
                productVariants(first: 1, query: $query) {
                    edges {
                        node {
                            id
                            sku
                            title
                            inventoryQuantity
                            inventoryItem {
                                id
                            }
                            product {
                                id
                            }
                        }
                    }
                }
            }
        `;

        interface VariantResponse {
            productVariants: {
                edges: Array<{
                    node: {
                        id: string;
                        sku: string;
                        title: string;
                        inventoryQuantity: number;
                        inventoryItem: { id: string };
                        product: { id: string };
                    };
                }>;
            };
        }

        const data = await this.executeGraphQL<VariantResponse>(query, { query: `sku:${sku}` });

        if (data.productVariants.edges.length === 0) {
            return null;
        }

        const variant = data.productVariants.edges[0].node;
        return {
            inventoryItemId: variant.inventoryItem.id,
            sku: variant.sku,
            variantId: variant.id,
            productId: variant.product.id,
            title: variant.title,
            inventoryQuantity: variant.inventoryQuantity,
        };
    }

    /**
     * Get inventory items for multiple SKUs (batch lookup)
     * More efficient than individual lookups
     */
    async getInventoryItemsBySkus(skus: string[]): Promise<Map<string, InventoryItemInfo>> {
        if (skus.length === 0) return new Map();

        // Shopify query format: sku:SKU1 OR sku:SKU2 OR ...
        // Note: There's a query length limit, so we batch in groups of 50
        const results = new Map<string, InventoryItemInfo>();
        const batchSize = 50;

        for (let i = 0; i < skus.length; i += batchSize) {
            const batch = skus.slice(i, i + batchSize);
            const queryString = batch.map(sku => `sku:${sku}`).join(' OR ');

            const query = `
                query GetVariantsBySkus($query: String!, $first: Int!) {
                    productVariants(first: $first, query: $query) {
                        edges {
                            node {
                                id
                                sku
                                title
                                inventoryQuantity
                                inventoryItem {
                                    id
                                }
                                product {
                                    id
                                }
                            }
                        }
                    }
                }
            `;

            interface VariantsResponse {
                productVariants: {
                    edges: Array<{
                        node: {
                            id: string;
                            sku: string;
                            title: string;
                            inventoryQuantity: number;
                            inventoryItem: { id: string };
                            product: { id: string };
                        };
                    }>;
                };
            }

            const data = await this.executeGraphQL<VariantsResponse>(query, {
                query: queryString,
                first: batch.length,
            });

            for (const edge of data.productVariants.edges) {
                const variant = edge.node;
                results.set(variant.sku, {
                    inventoryItemId: variant.inventoryItem.id,
                    sku: variant.sku,
                    variantId: variant.id,
                    productId: variant.product.id,
                    title: variant.title,
                    inventoryQuantity: variant.inventoryQuantity,
                });
            }

            // Small delay between batches
            if (i + batchSize < skus.length) {
                await new Promise(resolve => setTimeout(resolve, 100));
            }
        }

        return results;
    }

    /**
     * Set inventory quantity for a specific inventory item at a location
     * Uses the newer inventorySetQuantities mutation (not deprecated)
     *
     * @param inventoryItemId - The GraphQL ID of the inventory item (gid://shopify/InventoryItem/xxx)
     * @param locationId - The GraphQL ID of the location (gid://shopify/Location/xxx)
     * @param quantity - The absolute quantity to set
     */
    async setInventoryQuantity(
        inventoryItemId: string,
        locationId: string,
        quantity: number
    ): Promise<SetInventoryResult> {
        const mutation = `
            mutation inventorySetQuantities($input: InventorySetQuantitiesInput!) {
                inventorySetQuantities(input: $input) {
                    inventoryAdjustmentGroup {
                        id
                        reason
                    }
                    userErrors {
                        field
                        message
                    }
                }
            }
        `;

        interface SetQuantitiesResponse {
            inventorySetQuantities: {
                inventoryAdjustmentGroup?: {
                    id: string;
                    reason?: string;
                };
                userErrors: Array<{ field?: string; message: string }>;
            };
        }

        try {
            const data = await this.executeGraphQL<SetQuantitiesResponse>(mutation, {
                input: {
                    name: 'available',
                    reason: 'correction',
                    ignoreCompareQuantity: true,
                    quantities: [
                        {
                            inventoryItemId,
                            locationId,
                            quantity,
                        }
                    ],
                },
            });

            if (data.inventorySetQuantities.userErrors.length > 0) {
                const errorMessages = data.inventorySetQuantities.userErrors.map(e => e.message).join(', ');
                shopifyLogger.error({ inventoryItemId, locationId, quantity, errors: data.inventorySetQuantities.userErrors }, 'Failed to set inventory quantity');
                return { success: false, error: errorMessages };
            }

            shopifyLogger.info({ inventoryItemId, locationId, quantity }, 'Inventory quantity set successfully');
            return {
                success: true,
                inventoryItemId,
                locationId,
                quantity,
            };
        } catch (error: unknown) {
            const message = error instanceof Error ? error.message : 'Unknown error';
            shopifyLogger.error({ inventoryItemId, locationId, quantity, error: message }, 'Exception setting inventory quantity');
            return { success: false, error: message };
        }
    }

    /**
     * Set inventory quantity by SKU (convenience method)
     * Looks up the inventory item ID from SKU, then sets quantity
     *
     * @param sku - The product variant SKU
     * @param locationId - The GraphQL ID of the location
     * @param quantity - The absolute quantity to set
     */
    async setInventoryQuantityBySku(
        sku: string,
        locationId: string,
        quantity: number
    ): Promise<SetInventoryResult> {
        // Look up inventory item by SKU
        const inventoryItem = await this.getInventoryItemBySku(sku);

        if (!inventoryItem) {
            shopifyLogger.warn({ sku }, 'SKU not found in Shopify');
            return { success: false, error: `SKU not found in Shopify: ${sku}` };
        }

        return this.setInventoryQuantity(inventoryItem.inventoryItemId, locationId, quantity);
    }

    /**
     * Set inventory to zero for multiple SKUs (batch operation)
     * Useful for zeroing out archived product stock
     *
     * @param skus - Array of SKUs to zero out
     * @param locationId - The GraphQL ID of the location
     * @returns Results for each SKU
     */
    async zeroOutInventoryForSkus(
        skus: string[],
        locationId: string
    ): Promise<{ sku: string; result: SetInventoryResult }[]> {
        const results: { sku: string; result: SetInventoryResult }[] = [];

        // Batch lookup all SKUs
        const inventoryItems = await this.getInventoryItemsBySkus(skus);

        for (const sku of skus) {
            const item = inventoryItems.get(sku);

            if (!item) {
                results.push({ sku, result: { success: false, error: `SKU not found: ${sku}` } });
                continue;
            }

            // Only set to zero if current quantity > 0
            if (item.inventoryQuantity <= 0) {
                results.push({
                    sku,
                    result: {
                        success: true,
                        inventoryItemId: item.inventoryItemId,
                        locationId,
                        quantity: 0,
                    }
                });
                continue;
            }

            const result = await this.setInventoryQuantity(item.inventoryItemId, locationId, 0);
            results.push({ sku, result });

            // Small delay between mutations
            await new Promise(resolve => setTimeout(resolve, 50));
        }

        return results;
    }

    // ============================================
    // UTILITY METHODS
    // ============================================

    /**
     * Map Shopify order status to ERP status
     *
     * NOTE: Shopify fulfillment status is informational only.
     * ERP manages its own shipped/delivered statuses via the Ship Order action.
     * Fulfillment data is stored in shopifyFulfillmentStatus for display purposes.
     */
    mapOrderStatus(shopifyOrder: ShopifyOrder): 'cancelled' | 'open' {
        if (shopifyOrder.cancelled_at) return 'cancelled';
        // All non-cancelled orders start as 'open' in ERP
        // shipped/delivered status is managed by ERP ship action, not Shopify fulfillment
        return 'open';
    }

    /**
     * Map Shopify order channel to ERP channel
     */
    mapOrderChannel(shopifyOrder: ShopifyOrder): 'shopify_online' | 'shopify_pos' {
        const source = shopifyOrder.source_name?.toLowerCase() || '';
        if (source.includes('web') || source.includes('online')) return 'shopify_online';
        if (source.includes('pos')) return 'shopify_pos';
        return 'shopify_online';
    }

    /**
     * Extract address object from Shopify address
     */
    formatAddress(shopifyAddress: ShopifyAddress | null | undefined): FormattedAddress | null {
        if (!shopifyAddress) return null;

        return {
            address1: shopifyAddress.address1 || '',
            address2: shopifyAddress.address2 || '',
            city: shopifyAddress.city || '',
            province: shopifyAddress.province || '',
            country: shopifyAddress.country || '',
            zip: shopifyAddress.zip || '',
            phone: shopifyAddress.phone || '',
        };
    }
}

// Export singleton instance
const shopifyClient = new ShopifyClient();

// Load configuration from database on startup
shopifyClient.loadFromDatabase().catch(err => shopifyLogger.error({ error: err.message }, 'Failed to load Shopify config'));

export default shopifyClient;

// Export types for use in other files
export type {
    ShopifyOrder,
    ShopifyCustomer,
    ShopifyProduct,
    ShopifyVariant,
    ShopifyLineItem,
    ShopifyFulfillment,
    ShopifyMetafield,
    ShopifyTransaction,
    ShopifyAddress,
    FormattedAddress,
    OrderOptions,
    CustomerOptions,
    ProductOptions,
    MarkPaidResult,
    ShopifyConfigStatus,
    ShopifyLocation,
    SetInventoryResult,
    InventoryItemInfo,
};
