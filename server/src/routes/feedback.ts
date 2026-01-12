import { Router } from 'express';
import type { Request, Response } from 'express';
import { asyncHandler } from '../middleware/asyncHandler.js';
import { authenticateToken } from '../middleware/auth.js';

const router: Router = Router();

// Get all feedback
router.get('/', asyncHandler(async (req: Request, res: Response) => {
    const { status, source, feedbackType, limit = 50 } = req.query;
    const where: Record<string, unknown> = {};
    if (status) where.status = status;
    if (source) where.source = source;
    if (feedbackType) where.feedbackType = feedbackType;

    const feedback = await req.prisma.feedback.findMany({
        where,
        include: {
            customer: { select: { id: true, firstName: true, lastName: true, email: true } },
            ratings: true,
            content: true,
            productLinks: { include: { sku: { include: { variation: { include: { product: true } } } } } },
            tags: true,
        },
        orderBy: { createdAt: 'desc' },
        take: Number(limit),
    });

    res.json(feedback);
}));

// Get single feedback
router.get('/:id', asyncHandler(async (req: Request, res: Response) => {
    const id = req.params.id as string;
    const feedback = await req.prisma.feedback.findUnique({
        where: { id },
        include: { customer: true, ratings: true, content: true, media: true, productLinks: true, tags: true },
    });
    if (!feedback) {
        res.status(404).json({ error: 'Not found' });
        return;
    }
    res.json(feedback);
}));

// Create feedback
router.post('/', authenticateToken, asyncHandler(async (req: Request, res: Response) => {
    const { customerId, orderId, source, feedbackType, ratings, content, productLinks, tags } = req.body;

    const feedback = await req.prisma.feedback.create({
        data: {
            customerId, orderId, source, feedbackType,
            ratings: ratings ? { create: ratings.map((r: { dimension: string; score: number }) => ({ dimension: r.dimension, score: r.score })) } : undefined,
            content: content ? { create: content } : undefined,
            productLinks: productLinks ? { create: productLinks } : undefined,
            tags: tags ? { create: tags.map((t: string) => ({ tag: t })) } : undefined,
        },
        include: { ratings: true, content: true },
    });

    res.status(201).json(feedback);
}));

// Update feedback status
router.put('/:id/status', authenticateToken, asyncHandler(async (req: Request, res: Response) => {
    const id = req.params.id as string;
    const { status } = req.body;
    const feedback = await req.prisma.feedback.update({ where: { id }, data: { status } });
    res.json(feedback);
}));

// Product feedback summary
router.get('/analytics/by-product', asyncHandler(async (req: Request, res: Response) => {
    const products = await req.prisma.product.findMany({ include: { variations: { include: { skus: true } } } });
    const feedbackLinks = await req.prisma.feedbackProductLink.findMany({ include: { feedback: { include: { ratings: true, content: true } } } });

    const summaries = products.map((p) => {
        const skuIds = p.variations.flatMap((v) => v.skus.map((s) => s.id));
        const links = feedbackLinks.filter((fl) => fl.skuId && skuIds.includes(fl.skuId));

        const ratings = links.flatMap((l) => l.feedback.ratings);
        const overallRatings = ratings.filter((r) => r.dimension === 'overall');
        const fitRatings = ratings.filter((r) => r.dimension === 'fit');
        const qualityRatings = ratings.filter((r) => r.dimension === 'quality');

        return {
            productId: p.id,
            productName: p.name,
            category: p.category,
            totalFeedback: links.length,
            avgOverall: overallRatings.length > 0 ? (overallRatings.reduce((s, r) => s + r.score, 0) / overallRatings.length).toFixed(1) : null,
            avgFit: fitRatings.length > 0 ? (fitRatings.reduce((s, r) => s + r.score, 0) / fitRatings.length).toFixed(1) : null,
            avgQuality: qualityRatings.length > 0 ? (qualityRatings.reduce((s, r) => s + r.score, 0) / qualityRatings.length).toFixed(1) : null,
            lowRatingAlert: overallRatings.length > 0 && (overallRatings.reduce((s, r) => s + r.score, 0) / overallRatings.length) < 3.5,
        };
    });

    res.json(summaries.filter((s) => s.totalFeedback > 0).sort((a, b) => b.totalFeedback - a.totalFeedback));
}));

export default router;
