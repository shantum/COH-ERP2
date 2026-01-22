/**
 * Type declarations for orderLock.js
 */

export function acquireOrderLock(shopifyOrderId: string, source?: string): boolean;
export function releaseOrderLock(shopifyOrderId: string): void;
export function isOrderLocked(shopifyOrderId: string): boolean;
export function getActiveLocks(): Array<{ orderId: string; source: string; acquiredAt: number }>;

export function withOrderLock<T>(
    shopifyOrderId: string,
    source: string,
    fn: () => Promise<T>
): Promise<{ locked: boolean; skipped?: boolean; reason?: string; result?: T }>;

export function getOrderLockStatus(): Array<{ orderId: string; source: string; age: number; expired: boolean }>;
export function clearAllOrderLocks(): void;
