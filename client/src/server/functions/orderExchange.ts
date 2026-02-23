/**
 * Order Exchange Server Function
 *
 * Source order lookup for exchange creation.
 * Extracted from orders.ts for maintainability.
 */

import { createServerFn } from '@tanstack/react-start';
import { getPrisma } from '@coh/shared/services/db';
import { authMiddleware } from '../middleware/auth';
import { getOrderForExchangeSchema } from './orderTypes';
import type { GetOrderForExchangeResult } from './orderTypes';

// ============================================
// GET ORDER FOR EXCHANGE - Source order lookup
// ============================================

/**
 * Server Function: Get order for exchange
 *
 * Simple order lookup by order number for exchange creation.
 * Returns order with customer info and order lines for reference.
 */
export const getOrderForExchange = createServerFn({ method: 'GET' })
    .middleware([authMiddleware])
    .inputValidator((input: unknown) => getOrderForExchangeSchema.parse(input))
    .handler(async ({ data }): Promise<GetOrderForExchangeResult> => {
        try {
            const prisma = await getPrisma();

            const order = await prisma.order.findFirst({
                where: {
                    orderNumber: { contains: data.orderNumber, mode: 'insensitive' },
                },
                include: {
                    orderLines: {
                        include: {
                            sku: {
                                include: {
                                    variation: {
                                        include: {
                                            product: {
                                                select: { name: true, imageUrl: true },
                                            },
                                        },
                                    },
                                },
                            },
                        },
                        orderBy: { id: 'asc' },
                    },
                },
            });

            if (!order) {
                return { success: false, error: 'Order not found' };
            }

            // Count existing exchanges for order number preview
            const exchangeCount = await prisma.order.count({
                where: { originalOrderId: order.id },
            });

            return {
                success: true,
                data: {
                    id: order.id,
                    orderNumber: order.orderNumber,
                    customerId: order.customerId,
                    customerName: order.customerName,
                    customerEmail: order.customerEmail,
                    customerPhone: order.customerPhone,
                    shippingAddress: order.shippingAddress,
                    totalAmount: order.totalAmount,
                    orderDate: order.orderDate.toISOString(),
                    exchangeCount,
                    orderLines: order.orderLines.map((line) => ({
                        id: line.id,
                        skuId: line.skuId,
                        qty: line.qty,
                        unitPrice: line.unitPrice,
                        lineStatus: line.lineStatus,
                        sku: {
                            id: line.sku.id,
                            skuCode: line.sku.skuCode,
                            size: line.sku.size,
                            variation: {
                                colorName: line.sku.variation.colorName,
                                imageUrl: line.sku.variation.imageUrl,
                                product: {
                                    name: line.sku.variation.product.name,
                                    imageUrl: line.sku.variation.product.imageUrl,
                                },
                            },
                        },
                    })),
                },
            };
        } catch (error: unknown) {
            console.error('[Server Function] Error in getOrderForExchange:', error);
            return {
                success: false,
                error: error instanceof Error ? error.message : 'Unknown error',
            };
        }
    });
