import axios, { AxiosInstance, AxiosResponse, AxiosError } from 'axios';
import prisma from '../lib/prisma.js';
import { encrypt, decrypt } from '../utils/encryption.js';

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
                console.log('Converted admin URL to:', cleanDomain);
            }

            // If it doesn't have .myshopify.com, assume it's just the store name
            if (!cleanDomain.includes('.myshopify.com') && !cleanDomain.includes('.')) {
                cleanDomain = `${cleanDomain}.myshopify.com`;
            }

            const baseURL = `https://${cleanDomain}/admin/api/${this.apiVersion}`;
            console.log('Shopify API baseURL:', baseURL);

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
     * Load configuration from database settings
     */
    async loadFromDatabase(): Promise<void> {
        try {
            const domainSetting = await prisma.systemSetting.findUnique({
                where: { key: 'shopify_shop_domain' },
            });
            const tokenSetting = await prisma.systemSetting.findUnique({
                where: { key: 'shopify_access_token' },
            });

            if (domainSetting?.value) {
                this.shopDomain = domainSetting.value;
            }
            if (tokenSetting?.value) {
                // Decrypt the access token
                const decrypted = decrypt(tokenSetting.value);
                this.accessToken = decrypted ?? undefined;
            }

            this.initializeClient();
        } catch (error) {
            console.error('Failed to load Shopify config from database:', error);
        }
    }

    /**
     * Update configuration and reinitialize client
     */
    async updateConfig(shopDomain: string, accessToken?: string): Promise<void> {
        await prisma.systemSetting.upsert({
            where: { key: 'shopify_shop_domain' },
            update: { value: shopDomain },
            create: { key: 'shopify_shop_domain', value: shopDomain },
        });

        // Only update token if a new one is provided
        if (accessToken && accessToken !== 'KEEP_EXISTING') {
            // Encrypt the access token before storing
            const encryptedToken = encrypt(accessToken);
            if (encryptedToken) {
                await prisma.systemSetting.upsert({
                    where: { key: 'shopify_access_token' },
                    update: { value: encryptedToken },
                    create: { key: 'shopify_access_token', value: encryptedToken },
                });
                this.accessToken = accessToken;
            }
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
            console.log(`[Shopify] Rate limited, waiting ${Math.ceil(waitTime / 1000)}s...`);
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
                    console.warn(`[Shopify] Rate limited (429), retrying in ${Math.ceil(waitTime / 1000)}s (attempt ${attempt + 1}/${maxRetries + 1})`);
                    await new Promise(resolve => setTimeout(resolve, waitTime));
                    continue;
                }

                // 5xx errors - retry with exponential backoff
                if (status && status >= 500 && attempt < maxRetries) {
                    const waitTime = baseDelay * Math.pow(2, attempt);
                    console.warn(`[Shopify] Server error (${status}), retrying in ${Math.ceil(waitTime / 1000)}s (attempt ${attempt + 1}/${maxRetries + 1})`);
                    await new Promise(resolve => setTimeout(resolve, waitTime));
                    continue;
                }

                // Network errors - retry with backoff
                if (!axiosError.response && attempt < maxRetries) {
                    const waitTime = baseDelay * Math.pow(2, attempt);
                    console.warn(`[Shopify] Network error, retrying in ${Math.ceil(waitTime / 1000)}s (attempt ${attempt + 1}/${maxRetries + 1}): ${axiosError.message}`);
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

            if (orders.length === 0) break;

            allOrders.push(...orders);
            sinceId = String(orders[orders.length - 1].id);

            if (onProgress) {
                onProgress(allOrders.length, totalCount);
            }

            // Small delay to avoid rate limiting (in addition to automatic handling)
            await new Promise(resolve => setTimeout(resolve, 100));

            if (orders.length < limit) break;
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
     */
    async getProducts(options: ProductOptions = {}): Promise<ShopifyProduct[]> {
        if (!this.isConfigured()) {
            throw new Error('Shopify is not configured');
        }

        const params: Record<string, string | number> = {
            limit: Math.min(options.limit || 50, 250),
        };

        if (options.since_id) params.since_id = options.since_id;

        const response = await this.executeWithRetry<{ products: ShopifyProduct[] }>(
            () => this.client!.get('/products.json', { params })
        );
        return response.data.products;
    }

    /**
     * Fetch ALL products from Shopify with pagination
     */
    async getAllProducts(
        onProgress: ((fetched: number) => void) | null = null
    ): Promise<ShopifyProduct[]> {
        if (!this.isConfigured()) {
            throw new Error('Shopify is not configured');
        }

        const allProducts: ShopifyProduct[] = [];
        let hasMore = true;
        let pageInfo: string | null = null;

        while (hasMore) {
            const params: Record<string, string | number> = { limit: 250 };

            // Use cursor-based pagination
            if (pageInfo) {
                params.page_info = pageInfo;
            }

            const response = await this.executeWithRetry<{ products: ShopifyProduct[] }>(
                () => this.client!.get('/products.json', { params })
            );
            const products = response.data.products;

            if (products.length === 0) {
                hasMore = false;
            } else {
                allProducts.push(...products);

                // Report progress if callback provided
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
                    // Fallback to since_id pagination
                    if (products.length < 250) {
                        hasMore = false;
                    } else {
                        const lastId = products[products.length - 1].id;
                        params.since_id = lastId;
                        pageInfo = null;
                    }
                }
            }

            // Small delay to avoid rate limiting
            await new Promise(resolve => setTimeout(resolve, 100));
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
            console.error(`Failed to fetch metafields for product ${productId}:`, (error as Error).message);
            return [];
        }
    }

    /**
     * Extract gender from product data
     */
    extractGenderFromMetafields(
        metafields: ShopifyMetafield[] | null | undefined,
        productType: string | null = null
    ): 'women' | 'men' | 'unisex' {
        // First, try my_fields.gender metafield
        const genderField = metafields?.find(
            mf => mf.namespace === 'my_fields' && mf.key === 'gender'
        );

        if (genderField?.value) {
            return this.normalizeGender(genderField.value);
        }

        // Try custom.product_type_for_feed metafield (e.g., "Women Co-ord Set", "Men Shirt")
        const productTypeField = metafields?.find(
            mf => mf.namespace === 'custom' && mf.key === 'product_type_for_feed'
        );

        if (productTypeField?.value) {
            return this.normalizeGender(productTypeField.value);
        }

        // Fallback to main product_type field (e.g., "Women Co-ord Set")
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
            console.error('[COD Sync] Shopify not configured');
            return { success: false, error: 'Shopify is not configured', shouldRetry: false };
        }

        if (!shopifyOrderId) {
            console.error('[COD Sync] No Shopify order ID provided');
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

            console.log(`[COD Sync] Successfully marked order ${shopifyOrderId} as paid: $${amount}`);

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
            console.error(`[COD Sync] Failed to mark order ${shopifyOrderId} as paid:`, {
                shopifyOrderId,
                amount,
                utr,
                httpStatus: status,
                errorMessage: typeof errorMessage === 'object' ? JSON.stringify(errorMessage) : errorMessage,
                shouldRetry,
                requestData: transactionData,
            });

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
            console.error(`Failed to get transactions for order ${shopifyOrderId}:`, (error as Error).message);
            return [];
        }
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
shopifyClient.loadFromDatabase().catch(console.error);

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
};
