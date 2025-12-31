import { Router } from 'express';
import { authenticateToken } from '../middleware/auth.js';

const router = Router();

// Get all feedback
router.get('/', async (req, res) => {
    try {
        const { status, source, feedbackType, limit = 50 } = req.query;
        const where = {};
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
    } catch (error) {
        res.status(500).json({ error: 'Failed to fetch feedback' });
    }
});

// Get single feedback
router.get('/:id', async (req, res) => {
    try {
        const feedback = await req.prisma.feedback.findUnique({
            where: { id: req.params.id },
            include: { customer: true, ratings: true, content: true, media: true, productLinks: true, tags: true },
        });
        if (!feedback) return res.status(404).json({ error: 'Not found' });
        res.json(feedback);
    } catch (error) {
        res.status(500).json({ error: 'Failed to fetch feedback' });
    }
});

// Create feedback
router.post('/', authenticateToken, async (req, res) => {
    try {
        const { customerId, orderId, source, feedbackType, ratings, content, productLinks, tags } = req.body;

        const feedback = await req.prisma.feedback.create({
            data: {
                customerId, orderId, source, feedbackType,
                ratings: ratings ? { create: ratings.map((r) => ({ dimension: r.dimension, score: r.score })) } : undefined,
                content: content ? { create: content } : undefined,
                productLinks: productLinks ? { create: productLinks } : undefined,
                tags: tags ? { create: tags.map((t) => ({ tag: t })) } : undefined,
            },
            include: { ratings: true, content: true },
        });

        res.status(201).json(feedback);
    } catch (error) {
        res.status(500).json({ error: 'Failed to create feedback' });
    }
});

// Update feedback status
router.put('/:id/status', authenticateToken, async (req, res) => {
    try {
        const { status } = req.body;
        const feedback = await req.prisma.feedback.update({ where: { id: req.params.id }, data: { status } });
        res.json(feedback);
    } catch (error) {
        res.status(500).json({ error: 'Failed to update status' });
    }
});

// Product feedback summary
router.get('/analytics/by-product', async (req, res) => {
    try {
        const products = await req.prisma.product.findMany({ include: { variations: { include: { skus: true } } } });
        const feedbackLinks = await req.prisma.feedbackProductLink.findMany({ include: { feedback: { include: { ratings: true, content: true } } } });

        const summaries = products.map((p) => {
            const skuIds = p.variations.flatMap((v) => v.skus.map((s) => s.id));
            const links = feedbackLinks.filter((fl) => skuIds.includes(fl.skuId));

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
    } catch (error) {
        res.status(500).json({ error: 'Failed to fetch analytics' });
    }
});

export default router;
