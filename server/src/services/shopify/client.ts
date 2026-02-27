import type { AxiosInstance, AxiosResponse } from 'axios';
import axios, { AxiosError } from 'axios';
import prisma from '../../lib/prisma.js';
import { shopifyLogger } from '../../utils/logger.js';
import type {
    RateLimitState,
    RetryOptions,
    ShopifyClientContext,
    ShopifyConfigStatus,
    OrderOptions,
    CustomerOptions,
    ProductOptions,
    ShopifyOrder,
    ShopifyCustomer,
    ShopifyProduct,
    ShopifyMetafield,
    ShopifyTransaction,
    ShopifyAddress,
    FormattedAddress,
    MarkPaidResult,
    ShopifyLocation,
    SetInventoryResult,
    InventoryItemInfo,
    ProductFeedData,
} from './types.js';

// Feature module imports
import * as ordersFn from './orders.js';
import * as customersFn from './customers.js';
import * as productsFn from './products.js';
import * as paymentsFn from './payments.js';
import * as graphqlFn from './graphql.js';
import * as inventoryFn from './inventory.js';
import * as utilsFn from './utils.js';
import * as metafieldsFn from './metafields.js';

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
export class ShopifyClient {
    private shopDomain: string | undefined;
    private accessToken: string | undefined;
    private readonly apiVersion: string = '2024-10';
    private _client: AxiosInstance | null = null;
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

            this._client = axios.create({
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
        } catch (error: unknown) {
            shopifyLogger.error({ error: error instanceof Error ? error.message : 'Unknown error' }, 'Failed to load Shopify config from database');
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
            } catch (error: unknown) {
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

    /**
     * Execute a GraphQL query/mutation against Shopify Admin API
     */
    private async executeGraphQL<T>(query: string, variables?: Record<string, unknown>): Promise<T> {
        if (!this.isConfigured()) {
            throw new Error('Shopify is not configured');
        }

        const response = await this.executeWithRetry<{ data: T; errors?: Array<{ message: string }> }>(
            () => this._client!.post('/graphql.json', { query, variables })
        );

        if (response.data.errors && response.data.errors.length > 0) {
            const errorMessages = response.data.errors.map(e => e.message).join(', ');
            throw new Error(`GraphQL Error: ${errorMessages}`);
        }

        return response.data.data;
    }

    /**
     * Build the context object that feature modules need
     */
    private getContext(): ShopifyClientContext {
        return {
            client: this._client!,
            executeWithRetry: this.executeWithRetry.bind(this),
            executeGraphQL: this.executeGraphQL.bind(this),
            isConfigured: this.isConfigured.bind(this),
        };
    }

    // ============================================
    // ORDERS (delegates to orders module)
    // ============================================

    async getOrders(options: OrderOptions = {}): Promise<ShopifyOrder[]> {
        return ordersFn.getOrders(this.getContext(), options);
    }

    async getOrder(orderId: string | number): Promise<ShopifyOrder> {
        return ordersFn.getOrder(this.getContext(), orderId);
    }

    async getOrderCount(options: Pick<OrderOptions, 'status' | 'created_at_min'> = {}): Promise<number> {
        return ordersFn.getOrderCount(this.getContext(), options);
    }

    async getAllOrders(
        onProgress?: (fetched: number, total: number) => void,
        options: Pick<OrderOptions, 'status' | 'created_at_min'> = {}
    ): Promise<ShopifyOrder[]> {
        return ordersFn.getAllOrders(this.getContext(), onProgress, options);
    }

    // ============================================
    // CUSTOMERS (delegates to customers module)
    // ============================================

    async getCustomers(options: CustomerOptions = {}): Promise<ShopifyCustomer[]> {
        return customersFn.getCustomers(this.getContext(), options);
    }

    async getCustomer(customerId: string | number): Promise<ShopifyCustomer> {
        return customersFn.getCustomer(this.getContext(), customerId);
    }

    async getCustomerCount(): Promise<number> {
        return customersFn.getCustomerCount(this.getContext());
    }

    async getAllCustomers(
        onProgress?: (fetched: number, total: number) => void
    ): Promise<ShopifyCustomer[]> {
        return customersFn.getAllCustomers(this.getContext(), onProgress);
    }

    // ============================================
    // PRODUCTS (delegates to products module)
    // ============================================

    async getProducts(options: ProductOptions = {}): Promise<ShopifyProduct[]> {
        return productsFn.getProducts(this.getContext(), options);
    }

    async getAllProducts(
        onProgress: ((fetched: number) => void) | null = null
    ): Promise<ShopifyProduct[]> {
        return productsFn.getAllProducts(this.getContext(), onProgress);
    }

    async getProductCount(): Promise<number> {
        return productsFn.getProductCount(this.getContext());
    }

    async getProductMetafields(productId: string | number): Promise<ShopifyMetafield[]> {
        return productsFn.getProductMetafields(this.getContext(), productId);
    }

    extractGenderFromMetafields(
        metafields: ShopifyMetafield[] | null | undefined,
        productType: string | null = null,
        tags: string | null = null
    ): 'women' | 'men' | 'unisex' {
        return productsFn.extractGenderFromMetafields(metafields, productType, tags);
    }

    // ============================================
    // PAYMENTS (delegates to payments module)
    // ============================================

    async markOrderAsPaid(
        shopifyOrderId: string | number,
        amount: number,
        utr: string,
        paidAt: Date = new Date()
    ): Promise<MarkPaidResult> {
        return paymentsFn.markOrderAsPaid(this.getContext(), shopifyOrderId, amount, utr, paidAt);
    }

    async getOrderTransactions(shopifyOrderId: string | number): Promise<ShopifyTransaction[]> {
        return paymentsFn.getOrderTransactions(this.getContext(), shopifyOrderId);
    }

    // ============================================
    // GRAPHQL / PRODUCT FEED (delegates to graphql module)
    // ============================================

    async getProductFeedData(shopifyProductId: string | number): Promise<ProductFeedData> {
        return graphqlFn.getProductFeedData(this.getContext(), shopifyProductId);
    }

    // ============================================
    // INVENTORY (delegates to inventory module)
    // ============================================

    async getLocations(): Promise<ShopifyLocation[]> {
        return inventoryFn.getLocations(this.getContext());
    }

    async getInventoryItemBySku(sku: string): Promise<InventoryItemInfo | null> {
        return inventoryFn.getInventoryItemBySku(this.getContext(), sku);
    }

    async getInventoryItemsBySkus(skus: string[]): Promise<Map<string, InventoryItemInfo>> {
        return inventoryFn.getInventoryItemsBySkus(this.getContext(), skus);
    }

    async setInventoryQuantity(
        inventoryItemId: string,
        locationId: string,
        quantity: number
    ): Promise<SetInventoryResult> {
        return inventoryFn.setInventoryQuantity(this.getContext(), inventoryItemId, locationId, quantity);
    }

    async setInventoryQuantityBySku(
        sku: string,
        locationId: string,
        quantity: number
    ): Promise<SetInventoryResult> {
        return inventoryFn.setInventoryQuantityBySku(this.getContext(), sku, locationId, quantity);
    }

    async zeroOutInventoryForSkus(
        skus: string[],
        locationId: string
    ): Promise<{ sku: string; result: SetInventoryResult }[]> {
        return inventoryFn.zeroOutInventoryForSkus(this.getContext(), skus, locationId);
    }

    // ============================================
    // METAFIELDS (delegates to metafields module)
    // ============================================

    async setProductMetafields(
        shopifyProductId: string,
        fieldKeys: string[],
        values: Record<string, string>,
    ): Promise<metafieldsFn.MetafieldSetResult> {
        return metafieldsFn.setProductMetafields(this.getContext(), shopifyProductId, fieldKeys, values);
    }

    async setProductCategory(
        shopifyProductId: string,
        googleCategoryId: number,
    ): Promise<metafieldsFn.CategorySetResult> {
        return metafieldsFn.setProductCategory(this.getContext(), shopifyProductId, googleCategoryId);
    }

    // ============================================
    // UTILITY METHODS (delegates to utils module)
    // ============================================

    mapOrderStatus(shopifyOrder: ShopifyOrder): 'cancelled' | 'open' {
        return utilsFn.mapOrderStatus(shopifyOrder);
    }

    mapOrderChannel(shopifyOrder: ShopifyOrder): 'shopify_online' | 'shopify_pos' {
        return utilsFn.mapOrderChannel(shopifyOrder);
    }

    formatAddress(shopifyAddress: ShopifyAddress | null | undefined): FormattedAddress | null {
        return utilsFn.formatAddress(shopifyAddress);
    }
}
