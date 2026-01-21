/**
 * Unified Order Search
 * Returns flattened order lines across ALL statuses for grid display
 * This is the primary search endpoint for the search-as-navigation pattern
 */

import { Router } from 'express';
import type { Request, Response } from 'express';
import type { Prisma } from '@prisma/client';
import {
    ORDER_UNIFIED_SELECT,
    enrichOrdersForView,
    flattenOrdersToRows,
} from '../../../utils/orderViews.js';
import { filterConfidentialFields } from '../../../middleware/permissions.js';
import { orderLogger } from '../../../utils/logger.js';

const router: Router = Router();

// ============================================
// TYPE DEFINITIONS
// ============================================

interface SearchUnifiedQuery {
    q?: string;
    page?: string;
    pageSize?: string;
}

// ============================================
// SEARCH UNIFIED
// ============================================

/**
 * GET /orders/search-unified
 *
 * Search across ALL orders (open, shipped, cancelled, archived)
 * and return flattened order line data for grid display.
 *
 * This endpoint:
 * - Searches order number, customer name/email/phone, AWB number
 * - Returns same data shape as the list endpoint (FlattenedOrderRow[])
 * - Includes ALL orders (cancelled, archived, etc.)
 * - Supports pagination
 *
 * Query params:
 * - q: Search query (required, min 2 chars)
 * - page: Page number (default: 1)
 * - pageSize: Results per page (default: 100, max: 500)
 */
router.get('/search-unified', async (req: Request, res: Response) => {
    try {
        const { q, page = '1', pageSize = '100' } = req.query as SearchUnifiedQuery;

        // Validate search query
        if (!q || q.trim().length < 2) {
            return res.json({
                data: [],
                pagination: { page: 1, pageSize: 100, total: 0, totalPages: 0 },
                searchQuery: q || '',
            });
        }

        const searchTerm = q.trim();
        const pageNum = Math.max(1, Number(page));
        const pageSizeNum = Math.min(Math.max(1, Number(pageSize)), 500);
        const skip = (pageNum - 1) * pageSizeNum;

        // Build search WHERE clause - search across ALL orders (including archived)
        // AWB numbers are now on OrderLine, not Order
        const searchWhere: Prisma.OrderWhereInput = {
            OR: [
                { orderNumber: { contains: searchTerm, mode: 'insensitive' } },
                { customerName: { contains: searchTerm, mode: 'insensitive' } },
                { customerEmail: { contains: searchTerm, mode: 'insensitive' } },
                { customerPhone: { contains: searchTerm } },
                // Search AWB numbers via order lines
                {
                    orderLines: {
                        some: {
                            awbNumber: { contains: searchTerm },
                        },
                    },
                },
            ],
        };

        // Execute count and data queries in parallel
        const [totalCount, orders] = await Promise.all([
            req.prisma.order.count({ where: searchWhere }),
            req.prisma.order.findMany({
                where: searchWhere,
                select: ORDER_UNIFIED_SELECT,
                orderBy: { orderDate: 'desc' },
                take: pageSizeNum,
                skip,
            }),
        ]);

        // Apply enrichments (customer stats, tracking info, etc.)
        // Use a comprehensive enrichment set for search results
        const enriched = await enrichOrdersForView(
            req.prisma,
            orders,
            ['fulfillmentStage', 'lineStatusCounts', 'customerStats', 'daysInTransit', 'rtoStatus', 'daysSinceDelivery']
        );

        // Flatten orders to rows for grid display
        const rows = flattenOrdersToRows(enriched);

        // Filter confidential fields based on user permissions
        // Note: Cast to any since FlattenedOrderRow doesn't have index signature
        const filteredRows = filterConfidentialFields(rows as any, req.userPermissions) as typeof rows;

        res.json({
            data: filteredRows,
            pagination: {
                page: pageNum,
                pageSize: pageSizeNum,
                total: totalCount,
                totalPages: Math.ceil(totalCount / pageSizeNum),
            },
            searchQuery: searchTerm,
        });

    } catch (error) {
        orderLogger.error({ error: (error as Error).message }, 'Search unified error');
        res.status(500).json({ error: 'Search failed' });
    }
});

export default router;
