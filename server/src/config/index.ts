/**
 * Centralized Configuration System
 *
 * This is the single source of truth for all application configuration.
 * All rules, thresholds, and mappings are defined here in a declarative,
 * well-organized structure.
 *
 * STRUCTURE:
 * - /mappings  - Input → Output transformations (gateway→method, status→status)
 * - /thresholds - Numeric comparisons (tier LTV, timing days)
 * - /sync      - Integration-specific settings (Shopify, iThink)
 * - /types.ts  - Shared type definitions
 *
 * TO FIND A SPECIFIC CONFIGURATION:
 * 1. Payment gateway rules → config/mappings/paymentGateway.ts
 * 2. Tracking status rules → config/mappings/trackingStatus.ts
 * 3. Customer tier thresholds → config/thresholds/customerTiers.ts
 * 4. Order timing (archive, RTO) → config/thresholds/orderTiming.ts
 * 5. Inventory thresholds → config/thresholds/inventory.ts
 * 6. Shopify sync settings → config/sync/shopify.ts
 * 7. iThink sync settings → config/sync/ithink.ts
 *
 * TO ADD A NEW CONFIGURATION:
 * 1. Create a new file in the appropriate folder
 * 2. Define the rules/thresholds with descriptions
 * 3. Export from the folder's index.ts
 * 4. Re-export from this file
 */

// ============================================
// TYPES
// ============================================

export type {
    TrackingStatus,
    PaymentMethod,
    CustomerTier,
    TierThresholds,
    BaseMappingRule,
} from './types.js';

export {
    TERMINAL_TRACKING_STATUSES,
    isTerminalStatus,
} from './types.js';

// ============================================
// MAPPING RULES
// ============================================

// Payment Gateway → Payment Method
export {
    PAYMENT_GATEWAY_RULES,
    DEFAULT_PAYMENT_METHOD,
    COD_FINANCIAL_STATUSES,
    resolvePaymentMethod,
    isPrepaidGateway,
    isCodGateway,
    type PaymentGatewayRule,
} from './mappings/index.js';

// Tracking Status Code → Internal Status
export {
    TRACKING_STATUS_RULES,
    DEFAULT_TRACKING_STATUS,
    resolveTrackingStatus,
    isRtoStatus,
    isDeliveredStatus,
    getStatusLabel,
    type StatusMappingRule,
} from './mappings/index.js';

// ============================================
// THRESHOLD CONFIGURATIONS
// ============================================

// Customer Tiers
export {
    TIER_THRESHOLDS,
    TIER_LABELS,
    TIER_COLORS,
    calculateTier,
    getTierOrder,
    compareTiers,
    shouldUpgradeTier,
} from './thresholds/index.js';

// Order Timing
export {
    AUTO_ARCHIVE_DAYS,
    ARCHIVE_TERMINAL_DAYS,
    ARCHIVE_CANCELLED_DAYS,
    AT_RISK_INACTIVE_DAYS,
    RTO_WARNING_DAYS,
    RTO_URGENT_DAYS,
    DELIVERY_DELAYED_DAYS,
    ORDER_TIMING,
    daysSince,
    shouldAutoArchive,
    getRtoUrgency,
    isDeliveryDelayed,
} from './thresholds/index.js';

// Inventory
export {
    STOCK_ALERT_THRESHOLD_DAYS,
    DEFAULT_FABRIC_CONSUMPTION,
    DEFAULT_FABRIC_LEAD_TIME_DAYS,
    INVENTORY_THRESHOLDS,
    calculateDaysOfStock,
    needsReorder,
    calculateReorderQuantity,
} from './thresholds/index.js';

// ============================================
// SYNC CONFIGURATIONS
// ============================================

// Shopify
export {
    SHOPIFY_BATCH_SIZE,
    SHOPIFY_CONCURRENCY_LIMIT,
    SHOPIFY_PREVIEW_METAFIELD_LIMIT,
    SHOPIFY_LOOKBACK_DAYS,
    ORDER_UPDATE_TRIGGER_FIELDS,
    SKIP_CUSTOMERS_WITHOUT_ORDERS,
    REQUIRE_CUSTOMER_EMAIL,
    SHOPIFY_CACHE_STALE_DAYS,
    SHOPIFY_CACHE_CLEANUP_BATCH_SIZE,
    SHOPIFY_SYNC,
    SYNC_WORKER_CONFIG,
    FULL_DUMP_CONFIG,
    type OrderUpdateTriggerField,
} from './sync/index.js';

// iThink
export {
    ITHINK_TRACKING_BATCH_SIZE,
    ITHINK_API_TIMEOUT_MS,
    ITHINK_API_RETRIES,
    ITHINK_RETRY_DELAY_MS,
    ITHINK_SYNC_INTERVAL_MINUTES,
    ITHINK_BATCH_DELAY_MS,
    ITHINK_STARTUP_DELAY_MS,
    ITHINK_SYNC_STATUSES,
    ITHINK_TERMINAL_STATUSES,
    ITHINK_BACKFILL_DEFAULT_DAYS,
    ITHINK_BACKFILL_DEFAULT_LIMIT,
    ITHINK_SYNC,
    CIRCUIT_BREAKER_CONFIG,
    ORDER_LOCK_CONFIG,
    shouldSyncStatus,
    isTerminalTrackingStatus,
} from './sync/index.js';
