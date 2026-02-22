/**
 * Entity Context Resolvers
 *
 * Read-only graph traversal functions that pull connected data
 * across domains for a single entity. Uses Prisma for relational
 * includes and Kysely for aggregations.
 *
 * ⚠️  DYNAMIC IMPORTS for Kysely sql tag — static imports break client bundling.
 */

import { getPrisma } from '../db/index.js';
import { getKysely } from '../db/index.js';
import type {
  OrderContext,
  OrderContextLine,
  OrderContextPayment,
  OrderContextCustomer,
  ProductContext,
  ProductContextVariation,
  ProductContextSalesVelocity,
  CustomerContext,
  CustomerContextOrderSummary,
} from './types.js';

// ============================================
// ORDER CONTEXT
// ============================================

/**
 * Get full context for a single order — customer, lines with SKU/product,
 * payments, shipping, returns.
 */
export async function getOrderContext(orderId: string): Promise<OrderContext> {
  const prisma = await getPrisma();

  const order = await prisma.order.findUniqueOrThrow({
    where: { id: orderId },
    include: {
      customer: {
        select: {
          id: true,
          email: true,
          firstName: true,
          lastName: true,
          phone: true,
          tier: true,
          orderCount: true,
          ltv: true,
          returnCount: true,
          rtoCount: true,
        },
      },
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
      payments: {
        orderBy: { recordedAt: 'desc' },
      },
    },
  });

  // Map lines
  const lines: OrderContextLine[] = order.orderLines.map((line) => {
    const unitPrice = line.unitPrice;
    const bomCost = line.sku.bomCost;
    const margin = unitPrice > 0 && bomCost != null
      ? Math.round(((unitPrice - bomCost) / unitPrice) * 100)
      : null;

    return {
      id: line.id,
      skuCode: line.sku.skuCode,
      skuId: line.skuId,
      size: line.sku.size,
      qty: line.qty,
      unitPrice,
      lineStatus: line.lineStatus,
      productName: line.sku.variation.product.name,
      colorName: line.sku.variation.colorName,
      imageUrl: line.sku.variation.imageUrl ?? line.sku.variation.product.imageUrl,
      bomCost,
      margin,
      awbNumber: line.awbNumber,
      courier: line.courier,
      trackingStatus: line.trackingStatus,
      shippedAt: line.shippedAt?.toISOString() ?? null,
      deliveredAt: line.deliveredAt?.toISOString() ?? null,
      returnStatus: line.returnStatus,
      returnQty: line.returnQty,
      returnReasonCategory: line.returnReasonCategory,
      returnResolution: line.returnResolution,
    };
  });

  // Map payments
  const payments: OrderContextPayment[] = order.payments.map((p) => ({
    id: p.id,
    amount: p.amount,
    paymentMethod: p.paymentMethod,
    reference: p.reference,
    recordedAt: p.recordedAt.toISOString(),
  }));

  // Map customer
  const customer: OrderContextCustomer | null = order.customer
    ? {
        id: order.customer.id,
        name: [order.customer.firstName, order.customer.lastName].filter(Boolean).join(' ') || order.customer.email,
        email: order.customer.email,
        phone: order.customer.phone,
        tier: order.customer.tier,
        orderCount: order.customer.orderCount,
        ltv: order.customer.ltv,
        returnCount: order.customer.returnCount,
        rtoCount: order.customer.rtoCount,
      }
    : null;

  // Compute aggregates
  const totalUnits = lines.reduce((sum, l) => sum + l.qty, 0);
  const linesWithCost = lines.filter((l) => l.bomCost != null);
  const totalBomCost = linesWithCost.length > 0
    ? linesWithCost.reduce((sum, l) => sum + (l.bomCost! * l.qty), 0)
    : null;
  const avgMargin = linesWithCost.length > 0
    ? Math.round(linesWithCost.reduce((sum, l) => sum + (l.margin ?? 0), 0) / linesWithCost.length)
    : null;
  const hasReturns = lines.some((l) => l.returnStatus != null);

  // Fulfillment stage
  const fulfillmentStage = computeFulfillmentStage(lines);

  return {
    id: order.id,
    orderNumber: order.orderNumber,
    orderDate: order.orderDate.toISOString(),
    channel: order.channel,
    status: order.status,
    totalAmount: order.totalAmount,
    paymentMethod: order.paymentMethod,
    paymentStatus: order.paymentStatus,
    isExchange: order.isExchange,
    shippingAddress: order.shippingAddress,
    internalNotes: order.internalNotes,
    customer,
    lines,
    payments,
    totalUnits,
    totalBomCost,
    avgMargin,
    hasReturns,
    fulfillmentStage,
  };
}

function computeFulfillmentStage(lines: OrderContextLine[]): string {
  if (lines.length === 0) return 'empty';
  const statuses = lines.map((l) => l.lineStatus);
  if (statuses.every((s) => s === 'delivered')) return 'delivered';
  if (statuses.every((s) => s === 'shipped' || s === 'delivered')) return 'shipped';
  if (statuses.every((s) => s === 'packed' || s === 'shipped' || s === 'delivered')) return 'ready_to_ship';
  if (statuses.some((s) => s === 'picked' || s === 'packed')) return 'in_progress';
  if (statuses.every((s) => s === 'allocated')) return 'allocated';
  if (statuses.every((s) => s === 'cancelled')) return 'cancelled';
  return 'pending';
}

// ============================================
// PRODUCT CONTEXT
// ============================================

/**
 * Get full context for a product — variations, SKUs, stock levels,
 * sales velocity, return rate.
 */
export async function getProductContext(productId: string): Promise<ProductContext> {
  const prisma = await getPrisma();
  const db = await getKysely();
  const { sql } = await import('kysely');

  // Prisma: product + variations + SKUs
  const product = await prisma.product.findUniqueOrThrow({
    where: { id: productId },
    include: {
      variations: {
        include: {
          skus: {
            select: {
              id: true,
              skuCode: true,
              size: true,
              mrp: true,
              currentBalance: true,
              targetStockQty: true,
              bomCost: true,
              isActive: true,
            },
          },
        },
      },
    },
  });

  // Build date ranges for velocity
  const now = new Date();
  const days7Ago = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
  const days30Ago = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);

  // Kysely: sales velocity + return rate in parallel
  const [velocityResult, returnResult] = await Promise.all([
    // Sales velocity
    db
      .selectFrom('OrderLine')
      .innerJoin('Order', 'Order.id', 'OrderLine.orderId')
      .innerJoin('Sku', 'Sku.id', 'OrderLine.skuId')
      .innerJoin('Variation', 'Variation.id', 'Sku.variationId')
      .select([
        sql<number>`COALESCE(SUM("OrderLine"."qty") FILTER (WHERE "Order"."orderDate" >= ${days7Ago}), 0)::int`.as('units7d'),
        sql<number>`COALESCE(SUM("OrderLine"."qty" * "OrderLine"."unitPrice") FILTER (WHERE "Order"."orderDate" >= ${days7Ago}), 0)::numeric`.as('revenue7d'),
        sql<number>`COALESCE(SUM("OrderLine"."qty") FILTER (WHERE "Order"."orderDate" >= ${days30Ago}), 0)::int`.as('units30d'),
        sql<number>`COALESCE(SUM("OrderLine"."qty" * "OrderLine"."unitPrice") FILTER (WHERE "Order"."orderDate" >= ${days30Ago}), 0)::numeric`.as('revenue30d'),
      ])
      .where('Variation.productId', '=', productId)
      .where('OrderLine.lineStatus', '!=', 'cancelled')
      .executeTakeFirst(),

    // Return rate (30d): lines with return vs delivered lines
    db
      .selectFrom('OrderLine')
      .innerJoin('Order', 'Order.id', 'OrderLine.orderId')
      .innerJoin('Sku', 'Sku.id', 'OrderLine.skuId')
      .innerJoin('Variation', 'Variation.id', 'Sku.variationId')
      .select([
        sql<number>`COUNT(*) FILTER (WHERE "OrderLine"."returnStatus" IS NOT NULL)::int`.as('returnLines'),
        sql<number>`COUNT(*) FILTER (WHERE "OrderLine"."lineStatus" = 'delivered')::int`.as('deliveredLines'),
      ])
      .where('Variation.productId', '=', productId)
      .where('Order.orderDate', '>=', days30Ago)
      .executeTakeFirst(),
  ]);

  // Map variations
  const variations: ProductContextVariation[] = product.variations.map((v) => ({
    id: v.id,
    colorName: v.colorName,
    colorHex: v.colorHex,
    imageUrl: v.imageUrl,
    skus: v.skus.map((s) => ({
      id: s.id,
      skuCode: s.skuCode,
      size: s.size,
      mrp: s.mrp,
      currentBalance: s.currentBalance,
      targetStockQty: s.targetStockQty,
      bomCost: s.bomCost,
      isActive: s.isActive,
    })),
    totalStock: v.skus.reduce((sum, s) => sum + s.currentBalance, 0),
  }));

  // Aggregates
  const allSkus = variations.flatMap((v) => v.skus);
  const totalStock = allSkus.reduce((sum, s) => sum + s.currentBalance, 0);
  const lowStockSkus = allSkus.filter((s) => s.isActive && s.currentBalance < s.targetStockQty).length;
  const skusWithCost = allSkus.filter((s) => s.bomCost != null);
  const avgBomCost = skusWithCost.length > 0
    ? Math.round(skusWithCost.reduce((sum, s) => sum + s.bomCost!, 0) / skusWithCost.length)
    : null;

  const salesVelocity: ProductContextSalesVelocity = {
    last7Days: {
      units: velocityResult?.units7d ?? 0,
      revenue: Number(velocityResult?.revenue7d ?? 0),
    },
    last30Days: {
      units: velocityResult?.units30d ?? 0,
      revenue: Number(velocityResult?.revenue30d ?? 0),
    },
  };

  const deliveredLines = returnResult?.deliveredLines ?? 0;
  const returnLines = returnResult?.returnLines ?? 0;
  const returnRate30d = deliveredLines > 0
    ? Math.round((returnLines / deliveredLines) * 100)
    : null;

  return {
    id: product.id,
    name: product.name,
    imageUrl: product.imageUrl,
    isActive: product.isActive,
    variations,
    totalSkus: allSkus.length,
    totalStock,
    lowStockSkus,
    avgBomCost,
    salesVelocity,
    returnRate30d,
  };
}

// ============================================
// CUSTOMER CONTEXT
// ============================================

/**
 * Get full context for a customer — order history, return behavior, LTV.
 * Uses denormalized fields on Customer where available.
 */
export async function getCustomerContext(customerId: string): Promise<CustomerContext> {
  const prisma = await getPrisma();
  const db = await getKysely();
  const { sql } = await import('kysely');

  // Prisma: customer record
  const customer = await prisma.customer.findUniqueOrThrow({
    where: { id: customerId },
  });

  // Kysely: order summary aggregation
  const orderSummary = await db
    .selectFrom('Order')
    .select([
      sql<number>`COUNT(*)::int`.as('totalOrders'),
      sql<number>`COALESCE(SUM("totalAmount"), 0)::numeric`.as('totalSpent'),
      sql<string | null>`MIN("orderDate")::text`.as('firstOrderDate'),
      sql<string | null>`MAX("orderDate")::text`.as('lastOrderDate'),
      // Status breakdown
      sql<number>`COUNT(*) FILTER (WHERE "status" = 'open' AND "releasedToCancelled" = false)::int`.as('openOrders'),
      sql<number>`COUNT(*) FILTER (WHERE "releasedToShipped" = true)::int`.as('shippedOrders'),
      sql<number>`COUNT(*) FILTER (WHERE "releasedToCancelled" = true)::int`.as('cancelledOrders'),
    ])
    .where('Order.customerId', '=', customerId)
    .executeTakeFirst();

  const totalOrders = orderSummary?.totalOrders ?? 0;
  const totalSpent = Number(orderSummary?.totalSpent ?? 0);

  const orders: CustomerContextOrderSummary = {
    totalOrders,
    totalSpent,
    avgOrderValue: totalOrders > 0 ? Math.round(totalSpent / totalOrders) : 0,
    firstOrderDate: customer.firstOrderDate?.toISOString() ?? orderSummary?.firstOrderDate ?? null,
    lastOrderDate: customer.lastOrderDate?.toISOString() ?? orderSummary?.lastOrderDate ?? null,
    ordersByStatus: {
      open: orderSummary?.openOrders ?? 0,
      shipped: orderSummary?.shippedOrders ?? 0,
      cancelled: orderSummary?.cancelledOrders ?? 0,
    },
  };

  const returnRate = customer.orderCount > 0
    ? Math.round((customer.returnCount / customer.orderCount) * 100)
    : null;

  return {
    id: customer.id,
    email: customer.email,
    firstName: customer.firstName,
    lastName: customer.lastName,
    phone: customer.phone,
    tier: customer.tier,
    ltv: customer.ltv,
    orderCount: customer.orderCount,
    returnCount: customer.returnCount,
    exchangeCount: customer.exchangeCount,
    rtoCount: customer.rtoCount,
    rtoValue: Number(customer.rtoValue),
    acceptsMarketing: customer.acceptsMarketing,
    createdAt: customer.createdAt.toISOString(),
    orders,
    returnRate,
  };
}
