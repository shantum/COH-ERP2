import axios from 'axios';
import prisma from '../lib/prisma.js';
import { encrypt, decrypt } from '../utils/encryption.js';

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
    constructor() {
        this.shopDomain = process.env.SHOPIFY_SHOP_DOMAIN;
        this.accessToken = process.env.SHOPIFY_ACCESS_TOKEN;
        this.apiVersion = '2024-10'; // Use a stable API version
        this.client = null;

        // Rate limiting state
        this.rateLimitState = {
            remaining: 40,       // Shopify default bucket size
            lastUpdated: null,
            retryAfter: null,
        };

        this.initializeClient();
    }

    initializeClient() {
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
    async loadFromDatabase() {
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
                this.accessToken = decrypt(tokenSetting.value);
            }

            this.initializeClient();
        } catch (error) {
            console.error('Failed to load Shopify config from database:', error);
        }
    }

    /**
     * Update configuration and reinitialize client
     */
    async updateConfig(shopDomain, accessToken) {
        await prisma.systemSetting.upsert({
            where: { key: 'shopify_shop_domain' },
            update: { value: shopDomain },
            create: { key: 'shopify_shop_domain', value: shopDomain },
        });

        // Only update token if a new one is provided
        if (accessToken && accessToken !== 'KEEP_EXISTING') {
            // Encrypt the access token before storing
            const encryptedToken = encrypt(accessToken);
            await prisma.systemSetting.upsert({
                where: { key: 'shopify_access_token' },
                update: { value: encryptedToken },
                create: { key: 'shopify_access_token', value: encryptedToken },
            });
            this.accessToken = accessToken;
        }

        this.shopDomain = shopDomain;
        this.initializeClient();
    }

    isConfigured() {
        return !!(this.shopDomain && this.accessToken);
    }

    getConfig() {
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
    updateRateLimitState(response) {
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
    async waitForRateLimit() {
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
     *
     * @param {Function} requestFn - Function that returns an axios promise
     * @param {Object} options - Retry options
     * @param {number} options.maxRetries - Maximum retry attempts (default: 3)
     * @param {number} options.baseDelay - Base delay in ms for exponential backoff (default: 1000)
     */
    async executeWithRetry(requestFn, options = {}) {
        const { maxRetries = 3, baseDelay = 1000 } = options;
        let lastError;

        for (let attempt = 0; attempt <= maxRetries; attempt++) {
            try {
                // Wait for rate limit if needed
                await this.waitForRateLimit();

                const response = await requestFn();

                // Update rate limit state from response
                this.updateRateLimitState(response);

                return response;
            } catch (error) {
                lastError = error;
                const status = error.response?.status;

                // Update rate limit state even on error responses
                if (error.response) {
                    this.updateRateLimitState(error.response);
                }

                // 429 = Rate limited - always retry with backoff
                if (status === 429) {
                    const retryAfter = error.response?.headers['retry-after'];
                    const waitTime = retryAfter ? parseFloat(retryAfter) * 1000 : baseDelay * Math.pow(2, attempt);
                    console.warn(`[Shopify] Rate limited (429), retrying in ${Math.ceil(waitTime / 1000)}s (attempt ${attempt + 1}/${maxRetries + 1})`);
                    await new Promise(resolve => setTimeout(resolve, waitTime));
                    continue;
                }

                // 5xx errors - retry with exponential backoff
                if (status >= 500 && attempt < maxRetries) {
                    const waitTime = baseDelay * Math.pow(2, attempt);
                    console.warn(`[Shopify] Server error (${status}), retrying in ${Math.ceil(waitTime / 1000)}s (attempt ${attempt + 1}/${maxRetries + 1})`);
                    await new Promise(resolve => setTimeout(resolve, waitTime));
                    continue;
                }

                // Network errors - retry with backoff
                if (!error.response && attempt < maxRetries) {
                    const waitTime = baseDelay * Math.pow(2, attempt);
                    console.warn(`[Shopify] Network error, retrying in ${Math.ceil(waitTime / 1000)}s (attempt ${attempt + 1}/${maxRetries + 1}): ${error.message}`);
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
     * @param {Object} options - Query options
     * @param {string} options.status - Order status filter (open, closed, cancelled, any)
     * @param {string} options.since_id - Only return orders after this ID
     * @param {string} options.created_at_min - Minimum creation date (ISO 8601)
     * @param {string} options.created_at_max - Maximum creation date (ISO 8601)
     * @param {string} options.updated_at_min - Minimum update date (ISO 8601) - for incremental sync
     * @param {string} options.updated_at_max - Maximum update date (ISO 8601)
     * @param {number} options.limit - Number of orders to return (max 250)
     */
    async getOrders(options = {}) {
        if (!this.isConfigured()) {
            throw new Error('Shopify is not configured');
        }

        const params = {
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

        const response = await this.executeWithRetry(
            () => this.client.get('/orders.json', { params })
        );
        return response.data.orders;
    }

    /**
     * Fetch a single order by ID
     */
    async getOrder(orderId) {
        if (!this.isConfigured()) {
            throw new Error('Shopify is not configured');
        }

        const response = await this.executeWithRetry(
            () => this.client.get(`/orders/${orderId}.json`)
        );
        return response.data.order;
    }

    /**
     * Get order count for status check
     */
    async getOrderCount(options = {}) {
        if (!this.isConfigured()) {
            throw new Error('Shopify is not configured');
        }

        const params = { status: options.status || 'any' };
        if (options.created_at_min) params.created_at_min = options.created_at_min;

        const response = await this.executeWithRetry(
            () => this.client.get('/orders/count.json', { params })
        );
        return response.data.count;
    }

    // ============================================
    // CUSTOMERS
    // ============================================

    /**
     * Fetch customers from Shopify
     * @param {Object} options - Query options
     * @param {string} options.since_id - Only return customers after this ID
     * @param {string} options.created_at_min - Minimum creation date
     * @param {string} options.updated_at_min - Minimum update date
     * @param {number} options.limit - Number of customers to return (max 250)
     */
    async getCustomers(options = {}) {
        if (!this.isConfigured()) {
            throw new Error('Shopify is not configured');
        }

        const params = {
            limit: Math.min(options.limit || 50, 250),
        };

        if (options.since_id) params.since_id = options.since_id;
        if (options.created_at_min) params.created_at_min = options.created_at_min;
        if (options.updated_at_min) params.updated_at_min = options.updated_at_min;

        const response = await this.executeWithRetry(
            () => this.client.get('/customers.json', { params })
        );
        return response.data.customers;
    }

    /**
     * Fetch a single customer by ID
     */
    async getCustomer(customerId) {
        if (!this.isConfigured()) {
            throw new Error('Shopify is not configured');
        }

        const response = await this.executeWithRetry(
            () => this.client.get(`/customers/${customerId}.json`)
        );
        return response.data.customer;
    }

    /**
     * Get customer count
     */
    async getCustomerCount() {
        if (!this.isConfigured()) {
            throw new Error('Shopify is not configured');
        }

        const response = await this.executeWithRetry(
            () => this.client.get('/customers/count.json')
        );
        return response.data.count;
    }

    /**
     * Fetch ALL orders using pagination (for bulk sync)
     * @param {Function} onProgress - Callback for progress updates (fetched, total)
     * @param {Object} options - Query options
     */
    async getAllOrders(onProgress, options = {}) {
        if (!this.isConfigured()) {
            throw new Error('Shopify is not configured');
        }

        const allOrders = [];
        let sinceId = null;
        const limit = 250; // Max allowed by Shopify
        const totalCount = await this.getOrderCount(options);

        while (true) {
            const params = {
                status: options.status || 'any',
                limit,
            };
            if (sinceId) params.since_id = sinceId;
            if (options.created_at_min) params.created_at_min = options.created_at_min;

            const response = await this.executeWithRetry(
                () => this.client.get('/orders.json', { params })
            );
            const orders = response.data.orders;

            if (orders.length === 0) break;

            allOrders.push(...orders);
            sinceId = orders[orders.length - 1].id;

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
     * @param {Function} onProgress - Callback for progress updates (fetched, total)
     */
    async getAllCustomers(onProgress) {
        if (!this.isConfigured()) {
            throw new Error('Shopify is not configured');
        }

        const allCustomers = [];
        let sinceId = null;
        const limit = 250; // Max allowed by Shopify
        const totalCount = await this.getCustomerCount();

        while (true) {
            const params = { limit };
            if (sinceId) params.since_id = sinceId;

            const response = await this.executeWithRetry(
                () => this.client.get('/customers.json', { params })
            );
            const customers = response.data.customers;

            if (customers.length === 0) break;

            allCustomers.push(...customers);
            sinceId = customers[customers.length - 1].id;

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
    async getProducts(options = {}) {
        if (!this.isConfigured()) {
            throw new Error('Shopify is not configured');
        }

        const params = {
            limit: Math.min(options.limit || 50, 250),
        };

        if (options.since_id) params.since_id = options.since_id;

        const response = await this.executeWithRetry(
            () => this.client.get('/products.json', { params })
        );
        return response.data.products;
    }

    /**
     * Fetch ALL products from Shopify with pagination
     * @param {Function} onProgress - Optional callback for progress updates
     */
    async getAllProducts(onProgress = null) {
        if (!this.isConfigured()) {
            throw new Error('Shopify is not configured');
        }

        const allProducts = [];
        let hasMore = true;
        let pageInfo = null;

        while (hasMore) {
            const params = { limit: 250 };

            // Use cursor-based pagination
            if (pageInfo) {
                params.page_info = pageInfo;
            }

            const response = await this.executeWithRetry(
                () => this.client.get('/products.json', { params })
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
                const linkHeader = response.headers.link;
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
    async getProductCount() {
        if (!this.isConfigured()) {
            throw new Error('Shopify is not configured');
        }

        const response = await this.executeWithRetry(
            () => this.client.get('/products/count.json')
        );
        return response.data.count;
    }

    /**
     * Fetch metafields for a product
     * @param {string} productId - Shopify product ID
     */
    async getProductMetafields(productId) {
        if (!this.isConfigured()) {
            throw new Error('Shopify is not configured');
        }

        try {
            const response = await this.executeWithRetry(
                () => this.client.get(`/products/${productId}/metafields.json`)
            );
            return response.data.metafields || [];
        } catch (error) {
            console.error(`Failed to fetch metafields for product ${productId}:`, error.message);
            return [];
        }
    }

    /**
     * Extract gender from product data
     * @param {Array} metafields - Array of metafield objects
     * @param {string} productType - Product type from main product data (e.g., "Women Co-ord Set")
     * @returns {string} - Gender value or 'unisex' as default
     */
    extractGenderFromMetafields(metafields, productType = null) {
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
     * @param {string} value - Raw gender value
     * @returns {string} - Normalized gender (women, men, or unisex)
     */
    normalizeGender(value) {
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
     *
     * @param {string} shopifyOrderId - Shopify order ID (numeric string)
     * @param {number} amount - Amount to mark as paid
     * @param {string} utr - Bank UTR reference
     * @param {Date} paidAt - When payment was received
     * @returns {Object} - { success, transaction, error, errorCode, shouldRetry }
     */
    async markOrderAsPaid(shopifyOrderId, amount, utr, paidAt = new Date()) {
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
            const response = await this.executeWithRetry(
                () => this.client.post(`/orders/${shopifyOrderId}/transactions.json`, transactionData),
                { maxRetries: 2 } // Limit retries for payment operations
            );

            console.log(`[COD Sync] Successfully marked order ${shopifyOrderId} as paid: $${amount}`);

            return {
                success: true,
                transaction: response.data.transaction,
            };
        } catch (error) {
            const status = error.response?.status;
            const errorData = error.response?.data;
            const errorMessage = errorData?.errors || errorData?.error || error.message;

            // Determine if this error is retryable
            const shouldRetry = status === 429 || status >= 500 || !error.response;

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
                error: typeof errorMessage === 'object' ? JSON.stringify(errorMessage) : errorMessage,
                errorCode: status,
                shouldRetry,
            };
        }
    }

    /**
     * Get transactions for a Shopify order
     * @param {string} shopifyOrderId - Shopify order ID
     */
    async getOrderTransactions(shopifyOrderId) {
        if (!this.isConfigured()) {
            throw new Error('Shopify is not configured');
        }

        try {
            const response = await this.executeWithRetry(
                () => this.client.get(`/orders/${shopifyOrderId}/transactions.json`)
            );
            return response.data.transactions || [];
        } catch (error) {
            console.error(`Failed to get transactions for order ${shopifyOrderId}:`, error.message);
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
    mapOrderStatus(shopifyOrder) {
        if (shopifyOrder.cancelled_at) return 'cancelled';
        // All non-cancelled orders start as 'open' in ERP
        // shipped/delivered status is managed by ERP ship action, not Shopify fulfillment
        return 'open';
    }

    /**
     * Map Shopify order channel to ERP channel
     */
    mapOrderChannel(shopifyOrder) {
        const source = shopifyOrder.source_name?.toLowerCase() || '';
        if (source.includes('web') || source.includes('online')) return 'shopify_online';
        if (source.includes('pos')) return 'shopify_pos';
        return 'shopify_online';
    }

    /**
     * Extract address object from Shopify address
     */
    formatAddress(shopifyAddress) {
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
