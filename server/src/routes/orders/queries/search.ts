/**
 * Order Search
 * Global search across all tabs
 */

import { Router } from 'express';
import type { Request, Response } from 'express';
import type { Prisma } from '@prisma/client';
import { orderLogger } from '../../../utils/logger.js';

const router: Router = Router();

// ============================================
// TYPE DEFINITIONS
// ============================================

interface SearchAllQuery {
    q?: string;
    limit?: string;
}

interface TabResult {
    tab: string;
    orders: SearchResultOrder[];
}

interface SearchResultOrder {
    id: string;
    orderNumber: string;
    customerName: string | null;
    status: string;
    paymentMethod: string | null;
    totalAmount: number | null;
    orderDate: Date | null;
    trackingStatus: string | null;
    awbNumber: string | null;
}

interface TabNames {
    [key: string]: string;
}

// Helper for tab display names
function getTabDisplayName(tab: string): string {
    const names: TabNames = {
        open: 'Open',
        shipped: 'Shipped',
        rto: 'RTO',
        cod_pending: 'COD Pending',
        archived: 'Archived'
    };
    return names[tab] || tab;
}

// ============================================
// SEARCH ALL
// ============================================

/**
 * GET /orders/search-all
 *
 * Search across ALL tabs and return results grouped by tab.
 * Used for global order search functionality.
 *
 * Query params:
 * - q: Search query (required, min 2 chars)
 * - limit: Max results per tab (default: 5)
 */
router.get('/search-all', async (req: Request, res: Response) => {
    try {
        const { q, limit = '5' } = req.query as SearchAllQuery;

        if (!q || q.trim().length < 2) {
            return res.json({ results: [], query: q || '' });
        }

        const searchTerm = q.trim();
        const take = Math.min(Number(limit), 20); // Cap at 20 per tab

        // Build search OR clause
        const searchWhere: Prisma.OrderWhereInput = {
            OR: [
                { orderNumber: { contains: searchTerm, mode: 'insensitive' } },
                { customerName: { contains: searchTerm, mode: 'insensitive' } },
                { awbNumber: { contains: searchTerm } },
                { customerEmail: { contains: searchTerm, mode: 'insensitive' } },
                { customerPhone: { contains: searchTerm } },
            ]
        };

        // Define tab filters (matching ORDER_VIEWS)
        const tabs: Record<string, Prisma.OrderWhereInput> = {
            open: {
                AND: [
                    searchWhere,
                    { status: 'open', isArchived: false }
                ]
            },
            shipped: {
                AND: [
                    searchWhere,
                    { status: { in: ['shipped', 'delivered'] }, isArchived: false },
                    { NOT: { trackingStatus: { in: ['rto_in_transit', 'rto_delivered'] } } },
                    { NOT: { AND: [{ paymentMethod: 'COD' }, { trackingStatus: 'delivered' }, { codRemittedAt: null }] } }
                ]
            },
            rto: {
                AND: [
                    searchWhere,
                    { trackingStatus: { in: ['rto_in_transit', 'rto_delivered'] }, isArchived: false }
                ]
            },
            cod_pending: {
                AND: [
                    searchWhere,
                    { paymentMethod: 'COD', trackingStatus: 'delivered', codRemittedAt: null, isArchived: false }
                ]
            },
            archived: {
                AND: [
                    searchWhere,
                    { isArchived: true }
                ]
            }
        };

        // Query all tabs in parallel
        const queries = Object.entries(tabs).map(([tabName, where]) =>
            req.prisma.order.findMany({
                where,
                select: {
                    id: true,
                    orderNumber: true,
                    customerName: true,
                    status: true,
                    paymentMethod: true,
                    totalAmount: true,
                    orderDate: true,
                    trackingStatus: true,
                    awbNumber: true,
                },
                orderBy: { orderDate: 'desc' },
                take,
            }).then((orders): TabResult => ({ tab: tabName, orders }))
        );

        const tabResults = await Promise.all(queries);

        // Format response
        const results = tabResults
            .filter((r) => r.orders.length > 0)
            .map((r) => ({
                tab: r.tab,
                tabName: getTabDisplayName(r.tab),
                count: r.orders.length,
                orders: r.orders.map((o) => ({
                    id: o.id,
                    orderNumber: o.orderNumber,
                    customerName: o.customerName,
                    status: o.status,
                    paymentMethod: o.paymentMethod,
                    totalAmount: o.totalAmount,
                    trackingStatus: o.trackingStatus,
                    awbNumber: o.awbNumber,
                }))
            }));

        res.json({
            query: searchTerm,
            totalResults: results.reduce((sum, r) => sum + r.count, 0),
            results
        });

    } catch (error) {
        orderLogger.error({ error: (error as Error).message }, 'Search all error');
        res.status(500).json({ error: 'Search failed' });
    }
});

export default router;
