import axios from 'axios';
import { PrismaClient } from '@prisma/client';
import { encrypt, decrypt } from '../utils/encryption.js';

const prisma = new PrismaClient();

/**
 * Shopify Admin API client for importing orders and customers
 *
 * Configuration is loaded from:
 * 1. Database (SystemSetting table) - takes priority
 * 2. Environment variables as fallback
 */
class ShopifyClient {
    constructor() {
        this.shopDomain = process.env.SHOPIFY_SHOP_DOMAIN;
        this.accessToken = process.env.SHOPIFY_ACCESS_TOKEN;
        this.apiVersion = '2024-10'; // Use a stable API version
        this.client = null;
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
    // ORDERS
    // ============================================

    /**
     * Fetch orders from Shopify
     * @param {Object} options - Query options
     * @param {string} options.status - Order status filter (open, closed, cancelled, any)
     * @param {string} options.since_id - Only return orders after this ID
     * @param {string} options.created_at_min - Minimum creation date (ISO 8601)
     * @param {string} options.created_at_max - Maximum creation date (ISO 8601)
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

        if (options.since_id) params.since_id = options.since_id;
        if (options.created_at_min) params.created_at_min = options.created_at_min;
        if (options.created_at_max) params.created_at_max = options.created_at_max;

        const response = await this.client.get('/orders.json', { params });
        return response.data.orders;
    }

    /**
     * Fetch a single order by ID
     */
    async getOrder(orderId) {
        if (!this.isConfigured()) {
            throw new Error('Shopify is not configured');
        }

        const response = await this.client.get(`/orders/${orderId}.json`);
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

        const response = await this.client.get('/orders/count.json', { params });
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

        const response = await this.client.get('/customers.json', { params });
        return response.data.customers;
    }

    /**
     * Fetch a single customer by ID
     */
    async getCustomer(customerId) {
        if (!this.isConfigured()) {
            throw new Error('Shopify is not configured');
        }

        const response = await this.client.get(`/customers/${customerId}.json`);
        return response.data.customer;
    }

    /**
     * Get customer count
     */
    async getCustomerCount() {
        if (!this.isConfigured()) {
            throw new Error('Shopify is not configured');
        }

        const response = await this.client.get('/customers/count.json');
        return response.data.count;
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

        const response = await this.client.get('/products.json', { params });
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

            const response = await this.client.get('/products.json', { params });
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

        const response = await this.client.get('/products/count.json');
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
            const response = await this.client.get(`/products/${productId}/metafields.json`);
            return response.data.metafields || [];
        } catch (error) {
            console.error(`Failed to fetch metafields for product ${productId}:`, error.message);
            return [];
        }
    }

    /**
     * Extract gender from product metafields
     * @param {Array} metafields - Array of metafield objects
     * @returns {string} - Gender value or 'unisex' as default
     */
    extractGenderFromMetafields(metafields) {
        // First, try my_fields.gender
        const genderField = metafields.find(
            mf => mf.namespace === 'my_fields' && mf.key === 'gender'
        );

        if (genderField?.value) {
            return this.normalizeGender(genderField.value);
        }

        // Try custom.product_type_for_feed (e.g., "Women Co-ord Set", "Men Shirt")
        const productTypeField = metafields.find(
            mf => mf.namespace === 'custom' && mf.key === 'product_type_for_feed'
        );

        if (productTypeField?.value) {
            return this.normalizeGender(productTypeField.value);
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
    // UTILITY METHODS
    // ============================================

    /**
     * Map Shopify order status to ERP status
     */
    mapOrderStatus(shopifyOrder) {
        const financialStatus = shopifyOrder.financial_status;
        const fulfillmentStatus = shopifyOrder.fulfillment_status;

        if (shopifyOrder.cancelled_at) return 'cancelled';
        if (fulfillmentStatus === 'fulfilled') return 'delivered';
        if (fulfillmentStatus === 'partial') return 'shipped';
        if (financialStatus === 'paid' || financialStatus === 'partially_paid') return 'open';
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
