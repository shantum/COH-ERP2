/**
 * @module routes/returns/qc
 * QC workflow and analytics for returns
 *
 * Endpoints:
 * - GET /analytics/by-product: Get return analytics by product
 *
 * Note: Most QC operations are handled by the repacking queue (/api/repacking).
 * This module contains analytics and reporting endpoints specific to returns.
 */

import { Router } from 'express';
import type { Request, Response } from 'express';
import { authenticateToken } from '../../middleware/auth.js';
import { asyncHandler } from '../../middleware/asyncHandler.js';

const router: Router = Router();

// ============================================
// ANALYTICS
// ============================================

router.get('/analytics/by-product', authenticateToken, asyncHandler(async (req: Request, res: Response) => {
    const returnLines = await req.prisma.returnRequestLine.findMany({
        include: {
            sku: { include: { variation: { include: { product: true } } } },
            request: true,
        },
    });
    const orderLines = await req.prisma.orderLine.findMany({
        include: { sku: { include: { variation: { include: { product: true } } } } },
    });

    interface ProductStat {
        name: string;
        sold: number;
        returned: number;
    }
    const productStats: Record<string, ProductStat> = {};
    orderLines.forEach((ol) => {
        const pId = ol.sku?.variation?.product?.id;
        if (!pId) return;
        if (!productStats[pId]) {
            productStats[pId] = { name: ol.sku?.variation?.product?.name || '', sold: 0, returned: 0 };
        }
        productStats[pId].sold++;
    });
    returnLines.forEach((rl) => {
        const pId = rl.sku?.variation?.product?.id;
        if (!pId) return;
        if (productStats[pId] && rl.request?.requestType === 'return') {
            productStats[pId].returned++;
        }
    });

    const result = Object.entries(productStats).map(([id, s]) => ({
        productId: id,
        ...s,
        returnRate: s.sold > 0 ? ((s.returned / s.sold) * 100).toFixed(1) : '0',
    }));
    res.json(result.sort((a, b) => Number(b.returnRate) - Number(a.returnRate)));
}));

export default router;
