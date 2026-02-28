/**
 * Tracking Cache Service
 *
 * Single in-memory cache for all iThink Logistics tracking data.
 * Keeps every registered AWB fresh within 5 minutes.
 *
 * Consumers call get()/getMany() — they never hit the iThink API directly.
 * The service refreshes stale entries in the background, batching into
 * groups of 10 (iThink API limit).
 *
 * Side effects (DB writes, event logs) are handled by registered
 * onStatusChange callbacks — the cache itself never writes to the DB.
 *
 * Lifecycle:
 *   - start(): seed from DB, begin refresh loop
 *   - stop(): clear timers
 *   - register(awb, orderInfo): add AWB to active tracking
 *   - unregister(awb): remove from cache
 */

import { Prisma } from '@prisma/client';
import prisma from '../lib/prisma.js';
import ithinkClient from './ithinkLogistics/index.js';
import { trackingLogger } from '../utils/logger.js';
import { trackWorkerRun } from '../utils/workerRunTracker.js';
import { storeTrackingResponsesBatch } from './trackingResponseStorage.js';
import { type TrackingStatus, type PaymentMethod, isTerminalStatus } from '../config/types.js';
import {
    resolveTrackingStatus,
} from '../config/mappings/trackingStatus.js';
import type { IThinkRawTrackingResponse } from '../types/ithinkApi.js';
import { formatRawToTrackingData } from './ithinkLogistics/tracking.js';

// ============================================
// CONSTANTS
// ============================================

/** How fresh each entry must be (ms) */
const STALE_THRESHOLD_MS = 60 * 60 * 1000; // 60 minutes

/** How often the refresh loop ticks (ms) */
const REFRESH_LOOP_INTERVAL_MS = 60 * 1000; // 60 seconds

/** Max entries to refresh per tick — prevents thundering herd.
 *  With 10 per API batch and 1s delay, 100 entries = ~10 API calls = ~10s per tick. */
const MAX_PER_TICK = 100;

/** iThink API batch size */
const BATCH_SIZE = 10;

/** Delay between API batches (ms) */
const BATCH_DELAY_MS = 1_000;

/** Delay before first refresh after start (ms) */
const STARTUP_DELAY_MS = 30 * 1000; // 30 seconds

/** Grace period before evicting terminal AWBs (ms) */
const TERMINAL_GRACE_MS = 30 * 60 * 1000; // 30 minutes

/** TTL for ad-hoc lookups (unregistered AWBs) */
const ADHOC_TTL_MS = 2 * 60 * 1000; // 2 minutes

// ============================================
// TYPES
// ============================================

/** Info about the order that owns this AWB */
export interface OrderInfo {
    orderId: string;
    orderNumber: string;
    paymentMethod: PaymentMethod;
    customerId: string | null;
    rtoInitiatedAt: Date | null;
}

/** A single cache entry */
export interface CacheEntry {
    awb: string;
    rawResponse: IThinkRawTrackingResponse;
    internalStatus: TrackingStatus | null;
    lastFetched: Date;
    orderInfo: OrderInfo;
    /** If true, this is a one-off lookup — not actively refreshed */
    adhoc?: boolean;
    /** When the entry should be evicted (terminal or adhoc entries) */
    expiresAt?: Date;
}

/** Callback fired when an AWB's status changes */
export type StatusChangeCallback = (
    awb: string,
    entry: CacheEntry,
    previousStatus: TrackingStatus | null,
) => Promise<void>;

/** Cache status for monitoring */
export interface CacheStatus {
    isRefreshing: boolean;
    schedulerActive: boolean;
    entryCount: number;
    oldestEntryAge: number | null; // ms since lastFetched
    lastRefreshAt: Date | null;
    lastRefreshResult: RefreshResult | null;
}

/** Result of a refresh cycle */
export interface RefreshResult {
    startedAt: string;
    awbsChecked: number;
    updated: number;
    delivered: number;
    rto: number;
    errors: number;
    apiCalls: number;
    durationMs: number;
    error: string | null;
}

// ============================================
// SERVICE
// ============================================

class TrackingCacheService {
    private cache = new Map<string, CacheEntry>();
    private callbacks: StatusChangeCallback[] = [];
    private refreshTimer: NodeJS.Timeout | null = null;
    private startupTimer: NodeJS.Timeout | null = null;
    private isRefreshing = false;
    private lastRefreshAt: Date | null = null;
    private lastRefreshResult: RefreshResult | null = null;

    // ------------------------------------------
    // PUBLIC: Read API
    // ------------------------------------------

    /**
     * Get tracking data for a single AWB.
     * Returns from cache if available; falls through to iThink API for unregistered AWBs.
     */
    async get(awb: string): Promise<CacheEntry | null> {
        const entry = this.cache.get(awb);
        if (entry && !this.isExpired(entry)) {
            return entry;
        }

        // Cache miss — fetch from API as ad-hoc lookup
        return this.fetchAdHoc(awb);
    }

    /**
     * Get tracking data for multiple AWBs.
     * Cache hits are returned immediately; misses are batched into API calls.
     */
    async getMany(awbs: string[]): Promise<Map<string, CacheEntry>> {
        const result = new Map<string, CacheEntry>();
        const misses: string[] = [];

        for (const awb of awbs) {
            const entry = this.cache.get(awb);
            if (entry && !this.isExpired(entry)) {
                result.set(awb, entry);
            } else {
                misses.push(awb);
            }
        }

        if (misses.length > 0) {
            const fetched = await this.fetchBatchAdHoc(misses);
            for (const [awb, entry] of fetched) {
                result.set(awb, entry);
            }
        }

        return result;
    }

    // ------------------------------------------
    // PUBLIC: Registration
    // ------------------------------------------

    /** Add an AWB to active tracking */
    register(awb: string, orderInfo: OrderInfo): void {
        const existing = this.cache.get(awb);
        if (existing && !existing.adhoc) {
            // Already registered — update orderInfo in case it changed
            existing.orderInfo = orderInfo;
            return;
        }

        this.cache.set(awb, {
            awb,
            rawResponse: {} as IThinkRawTrackingResponse, // placeholder until first fetch
            internalStatus: null,
            lastFetched: new Date(0), // immediately stale
            orderInfo,
        });

        trackingLogger.debug({ awb }, 'Registered AWB for tracking');
    }

    /** Remove an AWB from the cache */
    unregister(awb: string): void {
        this.cache.delete(awb);
    }

    /** Check if an AWB is actively tracked */
    has(awb: string): boolean {
        const entry = this.cache.get(awb);
        return !!entry && !entry.adhoc;
    }

    // ------------------------------------------
    // PUBLIC: Lifecycle
    // ------------------------------------------

    /** Start the service: seed from DB then begin refresh loop */
    start(): void {
        if (this.refreshTimer) {
            trackingLogger.debug('Cache service already running');
            return;
        }

        trackingLogger.info('Starting tracking cache service');

        // Seed + first refresh after short delay
        this.startupTimer = setTimeout(async () => {
            this.startupTimer = null;
            await this.seed();
            await trackWorkerRun('tracking_cache_refresh', () => this.refresh(), 'startup');
        }, STARTUP_DELAY_MS);

        // Refresh loop
        this.refreshTimer = setInterval(() => {
            trackWorkerRun('tracking_cache_refresh', () => this.refresh(), 'scheduled').catch(() => {});
        }, REFRESH_LOOP_INTERVAL_MS);
    }

    /** Stop the refresh loop */
    stop(): void {
        if (this.startupTimer) {
            clearTimeout(this.startupTimer);
            this.startupTimer = null;
        }
        if (this.refreshTimer) {
            clearInterval(this.refreshTimer);
            this.refreshTimer = null;
            trackingLogger.info('Tracking cache service stopped');
        }
    }

    /** Subscribe to status changes */
    onStatusChange(callback: StatusChangeCallback): void {
        this.callbacks.push(callback);
    }

    /** Force a refresh of all stale entries (for manual trigger) */
    async triggerRefresh(): Promise<RefreshResult | null> {
        return trackWorkerRun('tracking_cache_refresh', () => this.refresh(), 'manual');
    }

    /** Get service status */
    getStatus(): CacheStatus {
        let oldestAge: number | null = null;
        const now = Date.now();

        for (const entry of this.cache.values()) {
            if (entry.adhoc) continue;
            const age = now - entry.lastFetched.getTime();
            if (oldestAge === null || age > oldestAge) {
                oldestAge = age;
            }
        }

        return {
            isRefreshing: this.isRefreshing,
            schedulerActive: !!this.refreshTimer,
            entryCount: this.activeCount(),
            oldestEntryAge: oldestAge,
            lastRefreshAt: this.lastRefreshAt,
            lastRefreshResult: this.lastRefreshResult,
        };
    }

    // ------------------------------------------
    // INTERNAL: Seed from DB
    // ------------------------------------------

    private async seed(): Promise<void> {
        try {
            await ithinkClient.loadFromDatabase();

            if (!ithinkClient.isConfigured()) {
                trackingLogger.warn('iThink not configured — skipping seed');
                return;
            }

            const lines = await prisma.$queryRaw<Array<{
                awbNumber: string;
                trackingStatus: string | null;
                orderId: string;
                orderNumber: string;
                paymentMethod: string;
                customerId: string | null;
                rtoInitiatedAt: Date | null;
            }>>(Prisma.sql`
                SELECT DISTINCT ON (ol."awbNumber")
                    ol."awbNumber",
                    ol."trackingStatus",
                    ol."orderId",
                    o."orderNumber",
                    o."paymentMethod",
                    o."customerId",
                    ol."rtoInitiatedAt"
                FROM "OrderLine" ol
                INNER JOIN "Order" o ON ol."orderId" = o.id
                WHERE ol."awbNumber" IS NOT NULL
                    AND o."isArchived" = false
                    AND (ol."trackingStatus" IS NULL OR ol."trackingStatus" IN (
                        'in_transit', 'out_for_delivery', 'delivery_delayed',
                        'rto_initiated', 'rto_in_transit', 'manifested',
                        'picked_up', 'reached_destination', 'undelivered', 'not_picked'
                    ))
                ORDER BY ol."awbNumber", o."orderDate" DESC
            `);

            for (const line of lines) {
                if (line.awbNumber) {
                    this.register(line.awbNumber, {
                        orderId: line.orderId,
                        orderNumber: line.orderNumber,
                        paymentMethod: line.paymentMethod as PaymentMethod,
                        customerId: line.customerId,
                        rtoInitiatedAt: line.rtoInitiatedAt,
                    });
                }
            }

            trackingLogger.info({ count: lines.length }, 'Seeded tracking cache from DB');
        } catch (err) {
            trackingLogger.error({ error: (err as Error).message }, 'Failed to seed tracking cache');
        }
    }

    // ------------------------------------------
    // INTERNAL: Refresh loop
    // ------------------------------------------

    private async refresh(): Promise<RefreshResult | null> {
        if (this.isRefreshing) {
            trackingLogger.debug('Refresh already in progress, skipping');
            return null;
        }

        this.isRefreshing = true;
        const startTime = Date.now();
        const now = Date.now();

        const result: RefreshResult = {
            startedAt: new Date().toISOString(),
            awbsChecked: 0,
            updated: 0,
            delivered: 0,
            rto: 0,
            errors: 0,
            apiCalls: 0,
            durationMs: 0,
            error: null,
        };

        try {
            // Evict expired entries (terminal grace period, adhoc TTL)
            this.evictExpired();

            // Ensure credentials are loaded
            await ithinkClient.loadFromDatabase();
            if (!ithinkClient.isConfigured()) {
                result.error = 'iThink not configured';
                return result;
            }

            // Collect oldest entries past the stale threshold.
            // Sort by age descending (oldest first), cap at MAX_PER_TICK
            // to spread load evenly across ticks instead of thundering herd.
            const candidates: Array<{ awb: string; age: number }> = [];
            for (const [awb, entry] of this.cache) {
                if (entry.adhoc) continue;
                const age = now - entry.lastFetched.getTime();
                if (age > STALE_THRESHOLD_MS) {
                    candidates.push({ awb, age });
                }
            }
            candidates.sort((a, b) => b.age - a.age);
            const staleAwbs = candidates.slice(0, MAX_PER_TICK).map(c => c.awb);

            result.awbsChecked = staleAwbs.length;

            // Always record that we ran
            this.lastRefreshAt = new Date();

            if (staleAwbs.length === 0) {
                this.lastRefreshResult = result;
                return result;
            }

            trackingLogger.info({ count: staleAwbs.length, total: candidates.length }, 'Refreshing stale AWBs');

            // Fetch in batches of 10
            for (let i = 0; i < staleAwbs.length; i += BATCH_SIZE) {
                const batch = staleAwbs.slice(i, i + BATCH_SIZE);
                result.apiCalls++;

                try {
                    const rawResults = await ithinkClient.trackShipments(batch);

                    // Store raw responses for debugging
                    const toStore = Object.entries(rawResults).map(([awb, data]) => ({
                        awbNumber: awb,
                        source: 'sync' as const,
                        statusCode: data.message === 'success' ? 200 : 404,
                        response: data,
                    }));
                    storeTrackingResponsesBatch(toStore).catch((err) => console.error('[tracking] Failed to store tracking responses:', err));

                    // Process each AWB
                    for (const awb of batch) {
                        const rawData = rawResults[awb];
                        const entry = this.cache.get(awb);
                        if (!entry || entry.adhoc) continue;

                        if (!rawData || rawData.message !== 'success') {
                            // API returned error — update lastFetched but keep existing data
                            entry.lastFetched = new Date();
                            continue;
                        }

                        const previousStatus = entry.internalStatus;
                        const newStatus = this.resolveStatus(rawData);

                        // Update cache entry
                        entry.rawResponse = rawData;
                        entry.internalStatus = newStatus;
                        entry.lastFetched = new Date();

                        result.updated++;

                        // Fire callbacks on status change
                        if (previousStatus !== newStatus) {
                            if (newStatus === 'delivered') result.delivered++;
                            if (newStatus?.startsWith('rto_')) result.rto++;

                            for (const cb of this.callbacks) {
                                try {
                                    await cb(awb, entry, previousStatus);
                                } catch (cbErr) {
                                    trackingLogger.error(
                                        { awb, error: (cbErr as Error).message },
                                        'Status change callback failed',
                                    );
                                }
                            }

                            // Schedule eviction for terminal statuses
                            if (newStatus && isTerminalStatus(newStatus)) {
                                entry.expiresAt = new Date(Date.now() + TERMINAL_GRACE_MS);
                            }
                        }
                    }

                    // Rate limiting between batches
                    if (i + BATCH_SIZE < staleAwbs.length) {
                        await new Promise(r => setTimeout(r, BATCH_DELAY_MS));
                    }
                } catch (batchErr) {
                    trackingLogger.error({ error: (batchErr as Error).message }, 'Batch fetch failed');
                    result.errors++;
                }
            }

            result.durationMs = Date.now() - startTime;
            this.lastRefreshAt = new Date();
            this.lastRefreshResult = result;

            trackingLogger.info({
                durationMs: result.durationMs,
                updated: result.updated,
                delivered: result.delivered,
                rto: result.rto,
                errors: result.errors,
            }, 'Cache refresh completed');

            return result;
        } catch (error) {
            result.error = (error as Error).message;
            result.durationMs = Date.now() - startTime;
            this.lastRefreshResult = result;
            trackingLogger.error({ error: result.error }, 'Cache refresh failed');
            return result;
        } finally {
            this.isRefreshing = false;
        }
    }

    // ------------------------------------------
    // INTERNAL: Ad-hoc lookups (unregistered AWBs)
    // ------------------------------------------

    private async fetchAdHoc(awb: string): Promise<CacheEntry | null> {
        try {
            await ithinkClient.loadFromDatabase();
            const rawData = await ithinkClient.trackShipments(awb, true);
            const raw = rawData[awb];

            if (!raw || raw.message !== 'success') return null;

            const entry: CacheEntry = {
                awb,
                rawResponse: raw,
                internalStatus: this.resolveStatus(raw),
                lastFetched: new Date(),
                orderInfo: { orderId: '', orderNumber: '', paymentMethod: 'Prepaid', customerId: null, rtoInitiatedAt: null },
                adhoc: true,
                expiresAt: new Date(Date.now() + ADHOC_TTL_MS),
            };

            this.cache.set(awb, entry);
            return entry;
        } catch (err) {
            trackingLogger.error({ awb, error: (err as Error).message }, 'Ad-hoc tracking fetch failed');
            return null;
        }
    }

    private async fetchBatchAdHoc(awbs: string[]): Promise<Map<string, CacheEntry>> {
        const result = new Map<string, CacheEntry>();

        try {
            await ithinkClient.loadFromDatabase();

            // Batch into groups of 10
            for (let i = 0; i < awbs.length; i += BATCH_SIZE) {
                const batch = awbs.slice(i, i + BATCH_SIZE);
                const rawResults = await ithinkClient.trackShipments(batch);

                for (const awb of batch) {
                    const raw = rawResults[awb];
                    if (!raw || raw.message !== 'success') continue;

                    const entry: CacheEntry = {
                        awb,
                        rawResponse: raw,
                        internalStatus: this.resolveStatus(raw),
                        lastFetched: new Date(),
                        orderInfo: { orderId: '', orderNumber: '', paymentMethod: 'Prepaid', customerId: null, rtoInitiatedAt: null },
                        adhoc: true,
                        expiresAt: new Date(Date.now() + ADHOC_TTL_MS),
                    };

                    this.cache.set(awb, entry);
                    result.set(awb, entry);
                }

                if (i + BATCH_SIZE < awbs.length) {
                    await new Promise(r => setTimeout(r, BATCH_DELAY_MS));
                }
            }
        } catch (err) {
            trackingLogger.error({ error: (err as Error).message }, 'Batch ad-hoc tracking fetch failed');
        }

        return result;
    }

    // ------------------------------------------
    // INTERNAL: Helpers
    // ------------------------------------------

    /** Resolve iThink raw response to internal tracking status */
    private resolveStatus(raw: IThinkRawTrackingResponse): TrackingStatus {
        // Priority 1: cancel_status field
        if (raw.cancel_status?.toLowerCase() === 'approved') {
            return 'cancelled';
        }

        // Priority 2: Use current_status text (most reliable)
        // For RTO, also check last_scan_details
        const lastScanStatus = raw.last_scan_details?.status || '';
        const currentStatus = raw.current_status || '';
        const statusForMapping = lastScanStatus.toLowerCase().includes('rto')
            ? lastScanStatus
            : currentStatus;

        return resolveTrackingStatus(raw.current_status_code, statusForMapping);
    }

    /** Check if an entry has expired (adhoc TTL or terminal grace) */
    private isExpired(entry: CacheEntry): boolean {
        if (!entry.expiresAt) return false;
        return Date.now() > entry.expiresAt.getTime();
    }

    /** Remove expired entries */
    private evictExpired(): void {
        const now = Date.now();
        for (const [awb, entry] of this.cache) {
            if (entry.expiresAt && now > entry.expiresAt.getTime()) {
                this.cache.delete(awb);
                trackingLogger.debug({ awb }, 'Evicted expired cache entry');
            }
        }
    }

    /** Count of actively tracked (non-adhoc) entries */
    private activeCount(): number {
        let count = 0;
        for (const entry of this.cache.values()) {
            if (!entry.adhoc) count++;
        }
        return count;
    }
}

// ============================================
// SINGLETON
// ============================================

const trackingCacheService = new TrackingCacheService();

export default trackingCacheService;
export { TrackingCacheService };
