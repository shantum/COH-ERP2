import { Router } from 'express';
import type { Request, Response } from 'express';
import { authenticateToken } from '../../middleware/auth.js';
import { asyncHandler } from '../../middleware/asyncHandler.js';
import { NotFoundError } from '../../utils/errors.js';
import { chunkProcess } from '../../utils/asyncUtils.js';
import type { PrismaModelDelegate } from './types.js';

const router = Router();

// Inspect orders table
router.get('/inspect/orders', authenticateToken, asyncHandler(async (req: Request, res: Response) => {
    const limit = Math.min(parseInt(req.query.limit as string) || 50, 5000);
    const offset = parseInt(req.query.offset as string) || 0;

    const [data, total] = await Promise.all([
        req.prisma.order.findMany({
            take: limit,
            skip: offset,
            orderBy: { createdAt: 'desc' },
            include: {
                orderLines: {
                    include: { sku: { select: { skuCode: true } } }
                },
                customer: { select: { email: true, firstName: true, lastName: true } }
            }
        }),
        req.prisma.order.count()
    ]);

    res.json({ data, total, limit, offset });
}));

// Inspect customers table
router.get('/inspect/customers', authenticateToken, asyncHandler(async (req: Request, res: Response) => {
    const limit = Math.min(parseInt(req.query.limit as string) || 50, 5000);
    const offset = parseInt(req.query.offset as string) || 0;

    const [data, total] = await Promise.all([
        req.prisma.customer.findMany({
            take: limit,
            skip: offset,
            orderBy: { createdAt: 'desc' }
        }),
        req.prisma.customer.count()
    ]);

    res.json({ data, total, limit, offset });
}));

// Inspect products table
router.get('/inspect/products', authenticateToken, asyncHandler(async (req: Request, res: Response) => {
    const limit = Math.min(parseInt(req.query.limit as string) || 50, 5000);
    const offset = parseInt(req.query.offset as string) || 0;

    const [data, total] = await Promise.all([
        req.prisma.product.findMany({
            take: limit,
            skip: offset,
            orderBy: { createdAt: 'desc' },
            include: {
                variations: {
                    include: { skus: true }
                }
            }
        }),
        req.prisma.product.count()
    ]);

    res.json({ data, total, limit, offset });
}));

// Inspect SKUs table
router.get('/inspect/skus', authenticateToken, asyncHandler(async (req: Request, res: Response) => {
    const limit = Math.min(parseInt(req.query.limit as string) || 50, 5000);
    const offset = parseInt(req.query.offset as string) || 0;

    const [data, total] = await Promise.all([
        req.prisma.sku.findMany({
            take: limit,
            skip: offset,
            orderBy: { skuCode: 'desc' },
            include: {
                variation: {
                    include: { product: { select: { name: true, styleCode: true } } }
                }
            }
        }),
        req.prisma.sku.count()
    ]);

    res.json({ data, total, limit, offset });
}));

// Inspect Shopify Order Cache table
router.get('/inspect/shopify-order-cache', authenticateToken, asyncHandler(async (req: Request, res: Response) => {
    const limit = Math.min(parseInt(req.query.limit as string) || 50, 5000);
    const offset = parseInt(req.query.offset as string) || 0;

    const [data, total] = await Promise.all([
        req.prisma.shopifyOrderCache.findMany({
            take: limit,
            skip: offset,
            orderBy: { lastWebhookAt: 'desc' }
        }),
        req.prisma.shopifyOrderCache.count()
    ]);

    res.json({ data, total, limit, offset });
}));

// Inspect Shopify Product Cache table
router.get('/inspect/shopify-product-cache', authenticateToken, asyncHandler(async (req: Request, res: Response) => {
    const limit = Math.min(parseInt(req.query.limit as string) || 50, 5000);
    const offset = parseInt(req.query.offset as string) || 0;

    const [data, total] = await Promise.all([
        req.prisma.shopifyProductCache.findMany({
            take: limit,
            skip: offset,
            orderBy: { lastWebhookAt: 'desc' }
        }),
        req.prisma.shopifyProductCache.count()
    ]);

    res.json({ data, total, limit, offset });
}));

// Get all table names from Prisma - for dynamic table selector
router.get('/inspect/tables', authenticateToken, asyncHandler(async (req: Request, res: Response) => {
    // Get all model names from Prisma client
    // The _dmmf property contains the data model meta information
    const prismaAny = req.prisma as unknown as Record<string, unknown>;
    const modelNames = Object.keys(req.prisma).filter(key =>
        !key.startsWith('_') &&
        !key.startsWith('$') &&
        typeof prismaAny[key] === 'object' &&
        (prismaAny[key] as PrismaModelDelegate | null)?.findMany
    );

    // Convert to display format with counts (batched to prevent connection pool exhaustion)
    const tablesWithCounts = await chunkProcess(modelNames, async (name: string) => {
        try {
            const model = prismaAny[name] as PrismaModelDelegate;
            const count = await model.count();
            return {
                name,
                displayName: name.replace(/([A-Z])/g, ' $1').trim(),
                count
            };
        } catch {
            return { name, displayName: name.replace(/([A-Z])/g, ' $1').trim(), count: 0 };
        }
    }, 5);

    // Sort by name
    tablesWithCounts.sort((a, b) => a.displayName.localeCompare(b.displayName));

    res.json({ tables: tablesWithCounts });
}));

// Generic table inspector - inspect any table
router.get('/inspect/table/:tableName', authenticateToken, asyncHandler(async (req: Request, res: Response) => {
    const tableName = req.params.tableName as string;
    const limit = Math.min(parseInt(req.query.limit as string) || 50, 5000);
    const offset = parseInt(req.query.offset as string) || 0;

    // Validate table exists in Prisma
    const prismaAny = req.prisma as unknown as Record<string, unknown>;
    const model = prismaAny[tableName] as PrismaModelDelegate | undefined;
    if (!model || typeof model.findMany !== 'function') {
        throw new NotFoundError(`Table '${tableName}' not found`, 'Table', tableName);
    }

    // Try to find a suitable orderBy field
    const orderBy = { createdAt: 'desc' as const };

    // Get the data
    const [data, total] = await Promise.all([
        model.findMany({
            take: limit,
            skip: offset,
            orderBy
        }).catch(() =>
            // If createdAt doesn't exist, try without ordering
            model.findMany({
                take: limit,
                skip: offset
            })
        ),
        model.count()
    ]);

    res.json({ data, total, limit, offset, tableName });
}));

export default router;
