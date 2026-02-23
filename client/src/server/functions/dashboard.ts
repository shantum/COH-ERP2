/**
 * Dashboard Server Functions
 *
 * TanStack Start Server Functions for dashboard analytics.
 * Uses Kysely for high-performance aggregation queries.
 * Implements server-side caching with 60s TTL.
 *
 * IMPORTANT: All database imports are dynamic to prevent Node.js code
 * from being bundled into the client.
 */

import { createServerFn } from '@tanstack/react-start';
import { z } from 'zod';
import { getISTMidnightAsUTC, getISTMonthStartAsUTC, getISTDayOfMonth, getISTDaysInMonth } from '@coh/shared';
import { authMiddleware } from '../middleware/auth';

// ============================================
// RESPONSE TYPES
// ============================================

export interface CustomerStats {
    newCustomers: number;
    returningCustomers: number;
    newPercent: number;
    returningPercent: number;
}

export interface RevenueData {
    total: number;
    orderCount: number;
    change: number | null;
    customers: CustomerStats;
}

export interface TopProduct {
    id: string;
    name: string;
    imageUrl: string | null;
    qty: number;
    orderCount: number;
    salesValue: number;
    variants: Array<{ name: string; qty: number }>;
}

export interface OrdersAnalyticsResponse {
    totalOrders: number;
    pendingOrders: number;
    allocatedOrders: number;
    readyToShip: number;
    totalUnits: number;
    paymentSplit: {
        cod: { count: number; amount: number };
        prepaid: { count: number; amount: number };
    };
    topProducts: TopProduct[];
    revenue: {
        today: RevenueData;
        yesterday: RevenueData;
        last7Days: RevenueData;
        last30Days: RevenueData;
        lastMonth: RevenueData;
        thisMonth: RevenueData;
    };
    /** Days elapsed in current month (for daily average calculations) - SSR-safe */
    daysInThisMonth: number;
    /** Total days in last month (for daily average calculations) - SSR-safe */
    daysInLastMonth: number;
}

// For top products dashboard card
export interface DashboardProductData {
    id: string;
    name: string;
    category?: string;
    colorName?: string;
    fabricName?: string | null;
    imageUrl: string | null;
    units: number;
    revenue: number;
    orderCount: number;
    variations?: Array<{ colorName: string; units: number }>;
}

export interface DashboardTopProductsResponse {
    level: 'product' | 'variation';
    days: number;
    data: DashboardProductData[];
}

// For top customers dashboard card
export interface DashboardTopProduct {
    name: string;
    units: number;
}

export interface DashboardCustomerData {
    id: string;
    name: string;
    email?: string;
    phone?: string;
    tier?: string;
    units: number;
    revenue: number;
    orderCount: number;
    topProducts: DashboardTopProduct[];
}

export interface DashboardTopCustomersResponse {
    period: string;
    data: DashboardCustomerData[];
}

// For top materials dashboard card
export interface TopMaterialsResultItem {
    id: string;
    name: string;
    colorHex?: string | null;
    fabricName?: string;
    materialName?: string;
    units: number;
    revenue: number;
    orderCount: number;
    productCount: number;
    topColours?: string[];
}

export interface DashboardTopMaterialsResponse {
    success: true;
    level: 'material' | 'fabric' | 'colour';
    days: number;
    data: TopMaterialsResultItem[];
}

// ============================================
// INPUT SCHEMAS
// ============================================

const getTopProductsInputSchema = z.object({
    days: z.number().int().min(-1).default(0),
    level: z.enum(['product', 'variation']).default('product'),
    limit: z.number().int().positive().default(15),
});

const getTopCustomersInputSchema = z.object({
    period: z.string().default('today'),
    limit: z.number().int().positive().default(10),
});

const getTopMaterialsInputSchema = z.object({
    days: z.number().int().min(-1).default(0),
    level: z.enum(['material', 'fabric', 'colour']).default('material'),
    limit: z.number().int().positive().default(15),
});

// ============================================
// CACHE HELPERS
// ============================================

async function getDashboardCache() {
    const { dashboardCache } = await import('@coh/shared/services/dashboard');
    return dashboardCache;
}

// ============================================
// SERVER FUNCTIONS
// ============================================

/**
 * Get orders analytics for dashboard
 *
 * Optimized version using Kysely aggregation queries.
 * Uses server-side cache with 60s TTL.
 */
export const getOrdersAnalytics = createServerFn({ method: 'GET' })
    .middleware([authMiddleware])
    .handler(async (): Promise<OrdersAnalyticsResponse> => {
        try {
            // Check cache first
            const cache = await getDashboardCache();
            const cached = cache.get<OrdersAnalyticsResponse>('analytics:main');
            if (cached) return cached;

            // Import Kysely queries dynamically
            const {
                getPipelineAndPaymentSplit,
                getAllRevenueMetrics,
                getTopProductsKysely,
            } = await import('@coh/shared/services/db/queries');

            const last30DaysStart = getISTMidnightAsUTC(-30);

            // Execute all queries in parallel
            const [pipelineData, revenueData, topProductsData] = await Promise.all([
                getPipelineAndPaymentSplit(),
                getAllRevenueMetrics(),
                getTopProductsKysely(last30DaysStart, null, 10),
            ]);

            // Calculate days for averages in IST (server runs in UTC, but we need IST days)
            const daysInThisMonth = getISTDayOfMonth();
            const daysInLastMonth = getISTDaysInMonth(-1);

            // Build response matching existing format
            const result: OrdersAnalyticsResponse = {
                totalOrders: pipelineData.pipeline.totalOrders,
                pendingOrders: pipelineData.pipeline.pendingLines,
                allocatedOrders: pipelineData.pipeline.allocatedLines,
                readyToShip: pipelineData.pipeline.packedLines,
                totalUnits: pipelineData.pipeline.totalUnits,
                paymentSplit: {
                    cod: {
                        count: pipelineData.paymentSplit.codCount,
                        amount: pipelineData.paymentSplit.codAmount,
                    },
                    prepaid: {
                        count: pipelineData.paymentSplit.prepaidCount,
                        amount: pipelineData.paymentSplit.prepaidAmount,
                    },
                },
                topProducts: topProductsData.map((p) => ({
                    id: p.id,
                    name: p.name,
                    imageUrl: p.imageUrl,
                    qty: p.units,
                    orderCount: p.orderCount,
                    salesValue: p.revenue,
                    variants: [],
                })),
                revenue: {
                    today: {
                        total: revenueData.today.total,
                        orderCount: revenueData.today.orderCount,
                        change: revenueData.today.change,
                        customers: buildCustomerStats(revenueData.today.newCustomers, revenueData.today.returningCustomers),
                    },
                    yesterday: {
                        total: revenueData.yesterday.total,
                        orderCount: revenueData.yesterday.orderCount,
                        change: null,
                        customers: buildCustomerStats(revenueData.yesterday.newCustomers, revenueData.yesterday.returningCustomers),
                    },
                    last7Days: {
                        total: revenueData.last7Days.total,
                        orderCount: revenueData.last7Days.orderCount,
                        change: null,
                        customers: buildCustomerStats(revenueData.last7Days.newCustomers, revenueData.last7Days.returningCustomers),
                    },
                    last30Days: {
                        total: revenueData.last30Days.total,
                        orderCount: revenueData.last30Days.orderCount,
                        change: null,
                        customers: buildCustomerStats(revenueData.last30Days.newCustomers, revenueData.last30Days.returningCustomers),
                    },
                    lastMonth: {
                        total: revenueData.lastMonth.total,
                        orderCount: revenueData.lastMonth.orderCount,
                        change: null,
                        customers: buildCustomerStats(revenueData.lastMonth.newCustomers, revenueData.lastMonth.returningCustomers),
                    },
                    thisMonth: {
                        total: revenueData.thisMonth.total,
                        orderCount: revenueData.thisMonth.orderCount,
                        change: null,
                        customers: buildCustomerStats(revenueData.thisMonth.newCustomers, revenueData.thisMonth.returningCustomers),
                    },
                },
                daysInThisMonth,
                daysInLastMonth,
            };

            // Cache the result
            cache.set('analytics:main', result);

            return result;
        } catch (error: unknown) {
            console.error('[Server Function] Error in getOrdersAnalytics:', error);
            throw error;
        }
    });

/**
 * Get top products for dashboard card
 *
 * Optimized version using Kysely GROUP BY aggregation.
 */
export const getTopProductsForDashboard = createServerFn({ method: 'GET' })
    .middleware([authMiddleware])
    .inputValidator((input: unknown) => getTopProductsInputSchema.parse(input))
    .handler(async ({ data }): Promise<DashboardTopProductsResponse> => {
        try {
            const { days, level, limit } = data;

            // Build cache key
            const cache = await getDashboardCache();
            const { topProductsCacheKey } = await import('@coh/shared/services/dashboard');
            const cacheKey = topProductsCacheKey(days, level);

            // Check cache
            const cached = cache.get<DashboardTopProductsResponse>(cacheKey);
            if (cached) {
                return cached;
            }

            // Calculate date filter
            const startDate = days === -1 ? getISTMidnightAsUTC(-1) :
                              days === 0 ? getISTMidnightAsUTC(0) :
                              getISTMidnightAsUTC(-days);
            const endDate = days === -1 ? getISTMidnightAsUTC(0) : null;

            // Import and execute query
            const { getTopProductsKysely, getTopVariationsKysely } = await import('@coh/shared/services/db/queries');

            if (level === 'variation') {
                const variations = await getTopVariationsKysely(startDate, endDate, limit);
                const result: DashboardTopProductsResponse = {
                    level: 'variation',
                    days,
                    data: variations.map((v) => ({
                        id: v.id,
                        name: v.productName,
                        colorName: v.colorName,
                        imageUrl: v.imageUrl,
                        units: v.units,
                        revenue: v.revenue,
                        orderCount: v.orderCount,
                    })),
                };
                cache.set(cacheKey, result);
                return result;
            }

            // Product level
            const products = await getTopProductsKysely(startDate, endDate, limit);
            const result: DashboardTopProductsResponse = {
                level: 'product',
                days,
                data: products.map((p) => ({
                    id: p.id,
                    name: p.name,
                    imageUrl: p.imageUrl,
                    units: p.units,
                    revenue: p.revenue,
                    orderCount: p.orderCount,
                })),
            };
            cache.set(cacheKey, result);
            return result;
        } catch (error: unknown) {
            console.error('[Server Function] Error in getTopProductsForDashboard:', error);
            throw error;
        }
    });

/**
 * Get top customers for dashboard card
 *
 * Optimized version using Kysely GROUP BY aggregation.
 */
export const getTopCustomersForDashboard = createServerFn({ method: 'GET' })
    .middleware([authMiddleware])
    .inputValidator((input: unknown) => getTopCustomersInputSchema.parse(input))
    .handler(async ({ data }): Promise<DashboardTopCustomersResponse> => {
        try {
            const { period, limit } = data;

            // Build cache key
            const cache = await getDashboardCache();
            const { topCustomersCacheKey } = await import('@coh/shared/services/dashboard');
            const cacheKey = topCustomersCacheKey(period);

            // Check cache
            const cached = cache.get<DashboardTopCustomersResponse>(cacheKey);
            if (cached) {
                return cached;
            }

            // Calculate date filter based on period
            let startDate: Date;
            let endDate: Date | null = null;

            switch (period) {
                case 'today':
                    startDate = getISTMidnightAsUTC(0);
                    break;
                case 'yesterday':
                    startDate = getISTMidnightAsUTC(-1);
                    endDate = getISTMidnightAsUTC(0);
                    break;
                case 'thisMonth':
                    startDate = getISTMonthStartAsUTC(0);
                    break;
                case 'lastMonth':
                    startDate = getISTMonthStartAsUTC(-1);
                    break;
                case '3months':
                    startDate = getISTMidnightAsUTC(-90);
                    break;
                case '6months':
                    startDate = getISTMidnightAsUTC(-180);
                    break;
                case '1year':
                    startDate = getISTMidnightAsUTC(-365);
                    break;
                default:
                    startDate = getISTMidnightAsUTC(0);
            }

            // Import and execute query
            const { getTopCustomersKysely } = await import('@coh/shared/services/db/queries');
            const customers = await getTopCustomersKysely(startDate, endDate, limit);

            const result: DashboardTopCustomersResponse = {
                period,
                data: customers.map((c) => ({
                    id: c.id,
                    name: c.name,
                    email: c.email,
                    phone: c.phone ?? undefined,
                    tier: c.tier ?? undefined,
                    units: c.units,
                    revenue: c.revenue,
                    orderCount: c.orderCount,
                    topProducts: [], // Simplified - no per-customer product breakdown
                })),
            };

            cache.set(cacheKey, result);
            return result;
        } catch (error: unknown) {
            console.error('[Server Function] Error in getTopCustomersForDashboard:', error);
            throw error;
        }
    });

/**
 * Get top materials for dashboard card
 *
 * Optimized version using Kysely multi-JOIN aggregation.
 */
export const getTopMaterials = createServerFn({ method: 'GET' })
    .middleware([authMiddleware])
    .inputValidator((input: unknown) => getTopMaterialsInputSchema.parse(input))
    .handler(async ({ data }): Promise<DashboardTopMaterialsResponse> => {
        try {
            const { days, level, limit } = data;

            // Build cache key
            const cache = await getDashboardCache();
            const { topMaterialsCacheKey } = await import('@coh/shared/services/dashboard');
            const cacheKey = topMaterialsCacheKey(days, level);

            // Check cache
            const cached = cache.get<DashboardTopMaterialsResponse>(cacheKey);
            if (cached) {
                return cached;
            }

            // Calculate date filter
            const startDate = days === -1 ? getISTMidnightAsUTC(-1) :
                              days === 0 ? getISTMidnightAsUTC(0) :
                              getISTMidnightAsUTC(-days);
            const endDate = days === -1 ? getISTMidnightAsUTC(0) : null;

            // Import queries
            const { getTopMaterialsKysely, getTopFabricsKysely, getTopFabricColoursKysely } = await import('@coh/shared/services/db/queries');

            if (level === 'colour') {
                const colours = await getTopFabricColoursKysely(startDate, endDate, limit);
                const result: DashboardTopMaterialsResponse = {
                    success: true,
                    level: 'colour',
                    days,
                    data: colours.map((c) => ({
                        id: c.id,
                        name: c.colourName,
                        colorHex: c.colourHex,
                        fabricName: c.fabricName,
                        materialName: c.materialName,
                        units: c.units,
                        revenue: c.revenue,
                        orderCount: c.orderCount,
                        productCount: c.productCount,
                    })),
                };
                cache.set(cacheKey, result);
                return result;
            }

            if (level === 'fabric') {
                const fabrics = await getTopFabricsKysely(startDate, endDate, limit);
                const result: DashboardTopMaterialsResponse = {
                    success: true,
                    level: 'fabric',
                    days,
                    data: fabrics.map((f) => ({
                        id: f.id,
                        name: f.name,
                        materialName: f.materialName,
                        units: f.units,
                        revenue: f.revenue,
                        orderCount: f.orderCount,
                        productCount: f.productCount,
                    })),
                };
                cache.set(cacheKey, result);
                return result;
            }

            // Material level
            const materials = await getTopMaterialsKysely(startDate, endDate, limit);
            const result: DashboardTopMaterialsResponse = {
                success: true,
                level: 'material',
                days,
                data: materials.map((m) => ({
                    id: m.id,
                    name: m.name,
                    units: m.units,
                    revenue: m.revenue,
                    orderCount: m.orderCount,
                    productCount: m.productCount,
                })),
            };

            cache.set(cacheKey, result);
            return result;
        } catch (error: unknown) {
            console.error('[Server Function] Error in getTopMaterials:', error);
            throw error;
        }
    });

/**
 * Invalidate dashboard cache
 *
 * Call this after mutations that affect dashboard metrics.
 */
export const invalidateDashboardCache = createServerFn({ method: 'POST' })
    .middleware([authMiddleware])
    .handler(async () => {
        try {
            const cache = await getDashboardCache();
            cache.invalidateAll();
            return { success: true };
        } catch (error: unknown) {
            console.error('[Server Function] Error invalidating dashboard cache:', error);
            return { success: false };
        }
    });

// ============================================
// WORKER STATUS
// ============================================

export interface WorkerStatusItem {
    id: string;
    name: string;
    interval: string;
    isRunning: boolean;
    schedulerActive: boolean;
    lastSyncAt: string | null;
    lastError: string | null;
}

export interface WorkerStatusResponse {
    workers: WorkerStatusItem[];
}

/**
 * Get status of all background workers for dashboard display
 */
export const getWorkerStatuses = createServerFn({ method: 'GET' })
    .middleware([authMiddleware])
    .handler(async (): Promise<WorkerStatusResponse> => {
        try {
            const { getInternalApiBaseUrl } = await import('../utils');
            const baseUrl = getInternalApiBaseUrl();
            const response = await fetch(`${baseUrl}/api/internal/worker-status`);

            if (!response.ok) {
                throw new Error(`Worker status request failed: ${response.status}`);
            }

            return await response.json() as WorkerStatusResponse;
        } catch (error: unknown) {
            console.error('[Server Function] Error in getWorkerStatuses:', error);
            throw error;
        }
    });

// ============================================
// HELPERS
// ============================================

function buildCustomerStats(newCustomers: number, returningCustomers: number): CustomerStats {
    const total = newCustomers + returningCustomers || 1;
    return {
        newCustomers,
        returningCustomers,
        newPercent: Math.round((newCustomers / total) * 100),
        returningPercent: Math.round((returningCustomers / total) * 100),
    };
}
