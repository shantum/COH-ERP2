/**
 * Google Ads BigQuery Data Transfer Configuration
 *
 * Google Ads data is imported via BigQuery Data Transfer Service.
 * Tables follow the pattern: ads_<Resource>_<customerId>
 * Cost fields are in micros (divide by 1,000,000 for INR).
 */

/** BigQuery dataset for Google Ads data transfer */
export const GOOGLE_ADS_DATASET = process.env.GOOGLE_ADS_DATASET || 'google_ads';

/** Google Ads customer ID (no dashes) */
export const GOOGLE_ADS_CUSTOMER_ID = process.env.GOOGLE_ADS_CUSTOMER_ID || '9396132768';

/** GCP project ID (same as GA4) */
export const GOOGLE_ADS_PROJECT = 'coh-erp';

/** Cache TTL — 15 min (data transfer runs daily, no need for short TTL) */
export const GADS_CACHE_TTL = 15 * 60 * 1000;
