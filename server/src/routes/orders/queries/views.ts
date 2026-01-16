/**
 * Order Views
 * Main list endpoint (GET /) and single order endpoint (GET /:id)
 */

import { Router } from 'express';
import type { Request, Response } from 'express';
import {
    buildViewWhereClause,
    enrichOrdersForView,
    ORDER_UNIFIED_SELECT,
    getValidViewNames,
    getViewConfig,
} from '../../../utils/orderViews.js';
import { filterConfidentialFields } from '../../../middleware/permissions.js';
import { orderLogger } from '../../../utils/logger.js';

const router: Router = Router();

// ============================================
// TYPE DEFINITIONS
// ============================================

interface OrderListQuery {
    view?: string;
    limit?: string;
    offset?: string;
    days?: string;
    search?: string;
    sortBy?: string;
    [key: string]: string | undefined;
}

interface OrderWithLines {
    orderLines?: Array<{ lineStatus?: string | null }>;
    [key: string]: unknown;
}

// ============================================
// UNIFIED ORDERS LIST (View-based)
// ============================================

/**
 * GET /orders?view=<viewName>
 *
 * Unified endpoint for all order views.
 * Query params:
 * - view: open|shipped|rto|cod_pending|archived|all (default: open)
 * - limit: Number of orders to return
 * - offset: Pagination offset
 * - days: Date range filter (for views with dateFilter)
 * - search: Search across orderNumber, customerName, awbNumber, email, phone
 */
router.get('/', async (req: Request, res: Response) => {
    try {
        const {
            view = 'open',
            limit,
            offset = '0',
            days,
            search,
            sortBy,
            ...additionalFilters
        } = req.query as OrderListQuery;

        // Validate view
        const viewConfig = getViewConfig(view);
        if (!viewConfig) {
            return res.status(400).json({
                error: `Invalid view: ${view}`,
                validViews: getValidViewNames(),
            });
        }

        // Use view's default limit if not specified
        const take = Number(limit) || viewConfig.defaultLimit || 100;
        const skip = Number(offset);

        // Build WHERE clause using view config
        const where = buildViewWhereClause(view, {
            days,
            search,
            additionalFilters,
        });

        // Determine sort order
        let orderBy = viewConfig.orderBy;
        if (sortBy && ['orderDate', 'archivedAt', 'shippedAt', 'createdAt'].includes(sortBy)) {
            orderBy = { [sortBy]: 'desc' };
        }

        // Execute query with pagination
        const queries: Promise<unknown>[] = [
            req.prisma.order.count({ where }),
            req.prisma.order.findMany({
                where,
                select: ORDER_UNIFIED_SELECT,
                orderBy,
                take,
                skip,
            }),
        ];

        // Add aggregate for COD pending view
        if (view === 'cod_pending') {
            queries.push(
                req.prisma.order.aggregate({ where, _sum: { totalAmount: true } })
            );
        }

        const results = await Promise.all(queries);
        const totalCount = results[0] as number;
        const orders = results[1] as OrderWithLines[];
        const aggregateResult = view === 'cod_pending' ? results[2] as { _sum: { totalAmount: number | null } } : undefined;
        const totalPendingAmount = aggregateResult?._sum?.totalAmount || 0;

        // Apply view-specific enrichments
        const enriched = await enrichOrdersForView(
            req.prisma,
            orders,
            viewConfig.enrichment
        );

        // Filter confidential fields based on user permissions
        const filteredOrders = filterConfidentialFields(enriched, req.userPermissions);

        const response: Record<string, unknown> = {
            orders: filteredOrders,
            view,
            viewName: viewConfig.name,
            pagination: {
                total: totalCount,
                limit: take,
                offset: skip,
                hasMore: skip + orders.length < totalCount,
                page: Math.floor(skip / take) + 1,
                totalPages: Math.ceil(totalCount / take),
            },
        };

        // Add view-specific fields
        if (view === 'cod_pending') {
            response.totalPendingAmount = totalPendingAmount;
        }

        res.json(response);
    } catch (error) {
        orderLogger.error({ error: (error as Error).message }, 'Get orders error');
        res.status(500).json({ error: 'Failed to fetch orders' });
    }
});

// Get single order
router.get('/:id', async (req: Request, res: Response) => {
    try {
        const orderId = req.params.id as string;
        const order = await req.prisma.order.findUnique({
            where: { id: orderId },
            include: {
                customer: true,
                orderLines: {
                    include: {
                        sku: {
                            include: {
                                variation: {
                                    include: {
                                        product: true,
                                        fabric: true,
                                    },
                                },
                            },
                        },
                        productionBatch: true,
                    },
                },
                returnRequests: true,
                shopifyCache: true,
            },
        });

        if (!order) {
            return res.status(404).json({ error: 'Order not found' });
        }

        let shopifyAdminUrl: string | null = null;
        if (order.shopifyOrderId) {
            const shopDomainSetting = await req.prisma.systemSetting.findUnique({
                where: { key: 'shopify_shop_domain' },
            });
            if (shopDomainSetting?.value) {
                const domain = shopDomainSetting.value;
                if (domain.includes('admin.shopify.com')) {
                    shopifyAdminUrl = `https://${domain}/orders/${order.shopifyOrderId}`;
                } else {
                    shopifyAdminUrl = `https://${domain}/admin/orders/${order.shopifyOrderId}`;
                }
            }
        }

        interface ShopifyDetails {
            subtotalPrice: string | null;
            totalPrice: string | null;
            totalTax: string | null;
            totalDiscounts: string | null;
            currency: string;
            financialStatus: string | null;
            fulfillmentStatus: string | null;
            discountCodes: unknown[];
            tags: string | null;
            customerNote: string | null;
            customerEmail: string | null;
            customerPhone: string | null;
            shippingAddress: unknown | null;
            billingAddress: unknown | null;
            shippingLines: Array<{ title: string; price: string }>;
            taxLines: Array<{ title: string; price: string; rate: number }>;
            lineItems: Array<{
                id: string;
                title: string;
                variantTitle: string | null;
                sku: string | null;
                quantity: number;
                price: string;
                totalDiscount: string;
                discountAllocations: Array<{ amount: string }>;
                imageUrl: string | null;
            }>;
            noteAttributes: unknown[];
        }

        let shopifyDetails: ShopifyDetails | null = null;
        const cache = order.shopifyCache;
        if (cache) {
            try {
                interface CachedLineItem {
                    id: number | string;
                    sku?: string | null;
                    title?: string | null;
                    variant_title?: string | null;
                    price?: string | null;
                    quantity?: number;
                    discount_allocations?: Array<{ amount: string }>;
                }
                interface CachedShippingLine {
                    title?: string | null;
                    price?: string | null;
                }
                interface CachedTaxLine {
                    title?: string | null;
                    price?: string | null;
                    rate?: number | null;
                }

                const lineItems: CachedLineItem[] = cache.lineItemsJson ? JSON.parse(cache.lineItemsJson) : [];
                const shippingLines: CachedShippingLine[] = cache.shippingLinesJson ? JSON.parse(cache.shippingLinesJson) : [];
                const taxLines: CachedTaxLine[] = cache.taxLinesJson ? JSON.parse(cache.taxLinesJson) : [];
                const noteAttributes = cache.noteAttributesJson ? JSON.parse(cache.noteAttributesJson) : [];

                // Get SKU images from lineItems
                const skuCodes = lineItems
                    .map((item) => item.sku)
                    .filter((sku): sku is string => Boolean(sku));

                const skuImages: Record<string, string | null> = {};
                if (skuCodes.length > 0) {
                    const skus = await req.prisma.sku.findMany({
                        where: { skuCode: { in: skuCodes } },
                        select: {
                            skuCode: true,
                            variation: {
                                select: {
                                    imageUrl: true,
                                    product: {
                                        select: { imageUrl: true }
                                    }
                                }
                            }
                        }
                    });
                    for (const sku of skus) {
                        skuImages[sku.skuCode] = sku.variation?.imageUrl || sku.variation?.product?.imageUrl || null;
                    }
                }

                // Build shipping address from cached columns
                const shippingAddress = cache.shippingAddress1 ? {
                    address1: cache.shippingAddress1,
                    address2: cache.shippingAddress2 || null,
                    city: cache.shippingCity || null,
                    province: cache.shippingProvince || cache.shippingState || null,
                    province_code: cache.shippingProvinceCode || null,
                    country: cache.shippingCountry || null,
                    country_code: cache.shippingCountryCode || null,
                    zip: cache.shippingZip || null,
                    name: cache.shippingName || null,
                    phone: cache.shippingPhone || null,
                } : null;

                // Build billing address from cached columns
                const billingAddress = cache.billingAddress1 ? {
                    address1: cache.billingAddress1,
                    address2: cache.billingAddress2 || null,
                    city: cache.billingCity || null,
                    province: cache.billingState || null,
                    country: cache.billingCountry || null,
                    country_code: cache.billingCountryCode || null,
                    zip: cache.billingZip || null,
                    name: cache.billingName || null,
                    phone: cache.billingPhone || null,
                } : null;

                shopifyDetails = {
                    subtotalPrice: cache.subtotalPrice?.toString() || null,
                    totalPrice: cache.totalPrice?.toString() || null,
                    totalTax: cache.totalTax?.toString() || null,
                    totalDiscounts: cache.totalDiscounts?.toString() || null,
                    currency: cache.currency || 'INR',
                    financialStatus: cache.financialStatus || null,
                    fulfillmentStatus: cache.fulfillmentStatus || null,
                    discountCodes: cache.discountCodes ? cache.discountCodes.split(', ').filter(Boolean).map(code => ({ code })) : [],
                    tags: cache.tags || null,
                    customerNote: cache.customerNotes || null,
                    customerEmail: cache.customerEmail || null,
                    customerPhone: cache.shippingPhone || cache.customerPhone || null,
                    shippingAddress,
                    billingAddress,
                    shippingLines: shippingLines.map((s) => ({
                        title: s.title || '',
                        price: s.price || '0',
                    })),
                    taxLines: taxLines.map((t) => ({
                        title: t.title || '',
                        price: t.price || '0',
                        rate: t.rate || 0,
                    })),
                    lineItems: lineItems.map((item) => {
                        const discountAllocations = item.discount_allocations || [];
                        const totalDiscount = discountAllocations.reduce(
                            (sum, d) => sum + (parseFloat(d.amount) || 0),
                            0
                        ).toFixed(2);
                        return {
                            id: String(item.id),
                            title: item.title || '',
                            variantTitle: item.variant_title || null,
                            sku: item.sku || null,
                            quantity: item.quantity || 0,
                            price: item.price || '0',
                            totalDiscount,
                            discountAllocations: discountAllocations.map((d) => ({
                                amount: d.amount,
                            })),
                            imageUrl: item.sku ? skuImages[item.sku] || null : null,
                        };
                    }),
                    noteAttributes,
                };
            } catch (e) {
                orderLogger.error({ error: (e as Error).message }, 'Error parsing Shopify cached JSON fields');
            }
        }

        const orderData = {
            ...order,
            shopifyDetails,
            shopifyAdminUrl,
        };

        // Filter confidential fields based on user permissions
        const filtered = filterConfidentialFields(orderData, req.userPermissions);
        res.json(filtered);
    } catch (error) {
        orderLogger.error({ error: (error as Error).message }, 'Get order error');
        res.status(500).json({ error: 'Failed to fetch order' });
    }
});

export default router;
