/**
 * Facebook Feed Health Monitor Configuration
 *
 * Settings for the feed health check that compares the OneCommerce/Socialshop
 * XML feed against ERP and Shopify data to find discrepancies.
 *
 * TO CHANGE SETTINGS:
 * Simply update the values below. Changes take effect on next health check.
 */

// ============================================
// FEED URL
// ============================================

/**
 * OneCommerce/Socialshop XML feed URL
 *
 * This is the Facebook catalog feed generated from Shopify product data.
 * Contains ~3,749 variant-level items with prices, stock, and availability.
 */
export const FACEBOOK_FEED_URL =
    'https://feedhub-storage.onecommerce.io/do/data_feed/facebook_feed/afd36b3d672e8229ba2f6871ecc76077.xml';

// ============================================
// CACHING
// ============================================

/**
 * How long to cache feed health results (ms)
 *
 * Feed data changes infrequently — 1 hour cache avoids
 * hammering the XML endpoint on every page load.
 */
export const FEED_HEALTH_CACHE_DURATION_MS = 60 * 60 * 1000; // 1 hour

// ============================================
// COMPARISON SETTINGS
// ============================================

/**
 * Price tolerance for mismatch detection (in INR)
 *
 * Small rounding differences are ignored. Only flag when
 * the price differs by more than this amount.
 */
export const PRICE_TOLERANCE = 1;

/**
 * Chunk size for database lookups
 *
 * Large IN clauses can choke Postgres. Chunk variant ID
 * lookups at this size to stay safe.
 */
export const DB_CHUNK_SIZE = 1000;
