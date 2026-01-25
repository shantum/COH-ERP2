/**
 * Thresholds Configuration Index
 *
 * Central export for all numeric threshold configurations.
 */

// Customer Tier Thresholds
export {
    TIER_THRESHOLDS,
    TIER_LABELS,
    TIER_COLORS,
    calculateTier,
    getTierOrder,
    compareTiers,
    shouldUpgradeTier,
} from './customerTiers.js';

// Order Timing Thresholds
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
} from './orderTiming.js';

// Inventory Thresholds
export {
    STOCK_ALERT_THRESHOLD_DAYS,
    DEFAULT_FABRIC_CONSUMPTION,
    DEFAULT_FABRIC_LEAD_TIME_DAYS,
    INVENTORY_THRESHOLDS,
    calculateDaysOfStock,
    needsReorder,
    calculateReorderQuantity,
} from './inventory.js';

// Return Thresholds - DEPRECATED
// All returns config is now in @coh/shared/domain/returns
// Keeping this comment for reference during migration
