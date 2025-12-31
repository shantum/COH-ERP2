import { Router } from 'express';
import { authenticateToken } from '../middleware/auth.js';

const router = Router();

// Get all return requests
router.get('/', async (req, res) => {
    try {
        const { status, requestType, limit = 50 } = req.query;
        const where = {};
        if (status) where.status = status;
        if (requestType) where.requestType = requestType;

        const requests = await req.prisma.returnRequest.findMany({
            where,
            include: {
                originalOrder: true,
                customer: true,
                lines: { include: { sku: { include: { variation: { include: { product: true } } } } } },
                shipping: true,
            },
            orderBy: { createdAt: 'desc' },
            take: Number(limit),
        });

        const enriched = requests.map((r) => ({
            ...r,
            ageDays: Math.floor((Date.now() - new Date(r.createdAt).getTime()) / (1000 * 60 * 60 * 24)),
        }));

        res.json(enriched);
    } catch (error) {
        res.status(500).json({ error: 'Failed to fetch return requests' });
    }
});

// Get single request
router.get('/:id', async (req, res) => {
    try {
        const request = await req.prisma.returnRequest.findUnique({
            where: { id: req.params.id },
            include: {
                originalOrder: true,
                customer: true,
                lines: { include: { sku: true, exchangeSku: true } },
                shipping: true,
                statusHistory: { include: { changedBy: { select: { name: true } } }, orderBy: { createdAt: 'asc' } },
            },
        });
        if (!request) return res.status(404).json({ error: 'Not found' });
        res.json(request);
    } catch (error) {
        res.status(500).json({ error: 'Failed to fetch request' });
    }
});

// Create return request
router.post('/', authenticateToken, async (req, res) => {
    try {
        const { requestType, originalOrderId, reasonCategory, reasonDetails, lines } = req.body;
        const order = await req.prisma.order.findUnique({ where: { id: originalOrderId } });
        if (!order) return res.status(404).json({ error: 'Order not found' });

        const count = await req.prisma.returnRequest.count();
        const requestNumber = `RET-${new Date().getFullYear()}-${String(count + 1).padStart(4, '0')}`;

        const request = await req.prisma.returnRequest.create({
            data: {
                requestNumber, requestType, originalOrderId, customerId: order.customerId,
                reasonCategory, reasonDetails, status: 'requested',
                lines: { create: lines.map((l) => ({ skuId: l.skuId, qty: l.qty, exchangeSkuId: l.exchangeSkuId })) },
            },
            include: { lines: true },
        });

        await req.prisma.returnStatusHistory.create({
            data: { requestId: request.id, fromStatus: 'requested', toStatus: 'requested', changedById: req.user.id },
        });

        res.status(201).json(request);
    } catch (error) {
        res.status(500).json({ error: 'Failed to create request' });
    }
});

// Status updates
router.post('/:id/initiate-reverse', authenticateToken, async (req, res) => {
    try {
        const { courier, awbNumber, pickupScheduledAt } = req.body;
        await req.prisma.returnShipping.create({
            data: { requestId: req.params.id, direction: 'reverse', courier, awbNumber, pickupScheduledAt: pickupScheduledAt ? new Date(pickupScheduledAt) : null, status: 'scheduled' },
        });
        await updateStatus(req.prisma, req.params.id, 'reverse_initiated', req.user.id);
        res.json({ success: true });
    } catch (error) {
        res.status(500).json({ error: 'Failed' });
    }
});

router.post('/:id/mark-received', authenticateToken, async (req, res) => {
    try {
        await req.prisma.returnShipping.updateMany({ where: { requestId: req.params.id, direction: 'reverse' }, data: { status: 'delivered', receivedAt: new Date() } });
        await updateStatus(req.prisma, req.params.id, 'received', req.user.id);
        res.json({ success: true });
    } catch (error) {
        res.status(500).json({ error: 'Failed' });
    }
});

router.post('/:id/resolve', authenticateToken, async (req, res) => {
    try {
        const { resolutionType, resolutionNotes } = req.body;
        const request = await req.prisma.returnRequest.findUnique({ where: { id: req.params.id }, include: { lines: true } });

        await req.prisma.$transaction(async (tx) => {
            await tx.returnRequest.update({ where: { id: req.params.id }, data: { status: 'resolved', resolutionType, resolutionNotes } });
            for (const line of request.lines) {
                if (line.itemCondition !== 'damaged') {
                    await tx.inventoryTransaction.create({ data: { skuId: line.skuId, txnType: 'inward', qty: line.qty, reason: 'return_receipt', referenceId: request.id, createdById: req.user.id } });
                }
            }
        });
        res.json({ success: true });
    } catch (error) {
        res.status(500).json({ error: 'Failed' });
    }
});

// Analytics
router.get('/analytics/by-product', async (req, res) => {
    try {
        const returnLines = await req.prisma.returnRequestLine.findMany({ include: { sku: { include: { variation: { include: { product: true } } } }, request: true } });
        const orderLines = await req.prisma.orderLine.findMany({ include: { sku: { include: { variation: { include: { product: true } } } } } });

        const productStats = {};
        orderLines.forEach((ol) => {
            const pId = ol.sku.variation.product.id;
            if (!productStats[pId]) productStats[pId] = { name: ol.sku.variation.product.name, sold: 0, returned: 0 };
            productStats[pId].sold++;
        });
        returnLines.forEach((rl) => {
            const pId = rl.sku.variation.product.id;
            if (productStats[pId] && rl.request.requestType === 'return') productStats[pId].returned++;
        });

        const result = Object.entries(productStats).map(([id, s]) => ({ productId: id, ...s, returnRate: s.sold > 0 ? ((s.returned / s.sold) * 100).toFixed(1) : 0 }));
        res.json(result.sort((a, b) => b.returnRate - a.returnRate));
    } catch (error) {
        res.status(500).json({ error: 'Failed' });
    }
});

async function updateStatus(prisma, requestId, newStatus, userId, notes = null) {
    const request = await prisma.returnRequest.findUnique({ where: { id: requestId } });
    await prisma.returnRequest.update({ where: { id: requestId }, data: { status: newStatus } });
    await prisma.returnStatusHistory.create({ data: { requestId, fromStatus: request.status, toStatus: newStatus, changedById: userId, notes } });
}

export default router;
