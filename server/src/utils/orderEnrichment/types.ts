/**
 * Order Enrichment Types
 * Types for the order enrichment pipeline
 */

import type {
    FulfillmentStage,
    LineStatusCounts,
    EnrichmentOptions,
    ShopifyCache,
    EnrichedShopifyCache,
} from '../patterns/types.js';

// Re-export commonly used types
export type { FulfillmentStage, LineStatusCounts, EnrichmentOptions, ShopifyCache, EnrichedShopifyCache };

/**
 * Enrichment types that can be applied to orders
 */
export type EnrichmentType =
    | 'fulfillmentStage'
    | 'lineStatusCounts'
    | 'customerStats'
    | 'addressResolution'
    | 'daysInTransit'
    | 'trackingStatus'
    | 'shopifyTracking'
    | 'daysSinceDelivery'
    | 'rtoStatus';

/**
 * Order line for enrichment (minimal fields needed)
 */
export interface OrderLineForEnrichment {
    lineStatus?: string | null;
    [key: string]: unknown;
}

/**
 * Order with orderLines and optional shopifyCache
 * Uses generic base with index signature for flexibility
 */
export interface OrderWithRelations {
    customerId?: string | null;
    orderNumber?: string;
    totalAmount?: number | null;
    shippedAt?: Date | string | null;
    deliveredAt?: Date | string | null;
    rtoInitiatedAt?: Date | string | null;
    rtoReceivedAt?: Date | string | null;
    trackingStatus?: string | null;
    orderLines?: OrderLineForEnrichment[];
    shopifyCache?: ShopifyCache | null;
    [key: string]: unknown;
}

/**
 * Enriched order with computed fields
 */
export interface EnrichedOrder {
    customerId?: string | null;
    orderNumber?: string;
    totalAmount?: number | null;
    shippedAt?: Date | string | null;
    deliveredAt?: Date | string | null;
    rtoInitiatedAt?: Date | string | null;
    rtoReceivedAt?: Date | string | null;
    trackingStatus?: string | null;
    orderLines?: OrderLineForEnrichment[];
    shopifyCache?: ShopifyCache | EnrichedShopifyCache | Record<string, never> | null;
    daysInTransit?: number;
    rtoStatus?: 'received' | 'in_transit';
    daysInRto?: number;
    daysSinceDelivery?: number;
    fulfillmentStage?: string;
    totalLines?: number;
    pendingLines?: number;
    allocatedLines?: number;
    pickedLines?: number;
    packedLines?: number;
    customerLtv?: number;
    customerOrderCount?: number;
    customerRtoCount?: number;
    customerTier?: string;
    pendingCount?: number;
    allocatedCount?: number;
    pickedCount?: number;
    packedCount?: number;
    shippedCount?: number;
    cancelledCount?: number;
    [key: string]: unknown;
}

/**
 * Fields returned by the customer stats enrichment query.
 * Used when merging stats results back into CPU-enriched orders.
 */
export interface CustomerStatsResult {
    id: string;
    customerLtv?: number | null;
    customerOrderCount?: number | null;
    customerTier?: string | null;
    fulfillmentStage?: string | null;
    pendingCount?: number | null;
    allocatedCount?: number | null;
    pickedCount?: number | null;
    packedCount?: number | null;
    shippedCount?: number | null;
    cancelledCount?: number | null;
    [key: string]: unknown;
}

/**
 * Order for tracking status determination
 */
export interface OrderForTrackingStatus {
    trackingStatus?: string | null;
    rtoReceivedAt?: Date | null;
    rtoInitiatedAt?: Date | null;
    status?: string;
    deliveredAt?: Date | null;
}
