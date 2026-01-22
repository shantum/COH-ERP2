/**
 * Type declarations for constants.js
 */

export const DEFAULT_FABRIC_CONSUMPTION: number;
export const STOCK_ALERT_THRESHOLD_DAYS: number;
export const DEFAULT_FABRIC_LEAD_TIME_DAYS: number;
export const AUTO_ARCHIVE_DAYS: number;
export const RTO_WARNING_DAYS: number;
export const RTO_URGENT_DAYS: number;
export const DELIVERY_DELAYED_DAYS: number;

export const ORDER_LOCK_CONFIG: {
    timeoutMs: number;
};

export const TRACKING_STATUS_MAP: Record<string, string>;
export const PAYMENT_GATEWAY_MAP: Record<string, string>;

export const SYNC_WORKER_CONFIG: {
    deep: {
        batchSize: number;
        batchDelay: number;
        gcInterval: number;
        disconnectInterval: number;
    };
    incremental: {
        batchSize: number;
        batchDelay: number;
        gcInterval: number;
        disconnectInterval: number;
    };
    maxErrors: number;
};
