/**
 * Business Pulse — Real-time Business Snapshot
 *
 * Single function that runs parallel Kysely queries to compute
 * a comprehensive business health snapshot. Reuses existing
 * dashboard query functions where possible.
 *
 * ⚠️  DYNAMIC IMPORTS for Kysely sql tag — static imports break client bundling.
 */

import { getKysely } from '../db/index.js';
import { getISTMidnightAsUTC } from '../../utils/dateHelpers.js';
import type {
  BusinessPulse,
  PulseRevenue,
  PulseOrderPipeline,
  PulseInventory,
  PulseProduction,
  PulseCash,
  PulsePayables,
  PulseReceivables,
  PulseFulfillment,
  PulseMaterialHealth,
  PulseTopProduct,
} from './types.js';

/**
 * Get a complete business pulse snapshot.
 *
 * Runs ~8 queries in parallel for maximum speed.
 * Reuses 3 existing dashboard queries (revenue, pipeline, top products).
 */
export async function getBusinessPulse(): Promise<BusinessPulse> {
  const db = await getKysely();
  const { sql } = await import('kysely');

  // Date ranges
  const days7Ago = getISTMidnightAsUTC(-7);
  const days30Ago = getISTMidnightAsUTC(-30);

  // Import existing dashboard queries
  const {
    getAllRevenueMetrics,
    getPipelineAndPaymentSplit,
    getTopProductsKysely,
  } = await import('../db/queries/dashboard.js');

  // Run all queries in parallel
  const [
    revenueMetrics,
    pipelineData,
    topProducts7d,
    inventoryResult,
    productionResult,
    cashResult,
    payablesResult,
    receivablesResult,
    returnRateResult,
    fulfillmentResult,
    materialHealthResult,
  ] = await Promise.all([
    // 1. Revenue — reuse existing
    getAllRevenueMetrics(),

    // 2. Pipeline — reuse existing
    getPipelineAndPaymentSplit(),

    // 3. Top products (7d) — reuse existing
    getTopProductsKysely(days7Ago, null, 5),

    // 4. Inventory health
    db
      .selectFrom('Sku')
      .select([
        sql<number>`COUNT(*)::int`.as('totalSkus'),
        sql<number>`COALESCE(SUM("currentBalance"), 0)::int`.as('totalUnits'),
        sql<number>`COUNT(*) FILTER (WHERE "isActive" = true AND "currentBalance" < "targetStockQty")::int`.as('lowStockSkuCount'),
      ])
      .executeTakeFirst(),

    // 5. Production pipeline
    db
      .selectFrom('ProductionBatch')
      .select([
        sql<number>`COUNT(*)::int`.as('openBatches'),
        sql<number>`COALESCE(SUM("qtyPlanned"), 0)::int`.as('unitsPlanned'),
        sql<number>`COALESCE(SUM("qtyCompleted"), 0)::int`.as('unitsCompleted'),
      ])
      .where('status', 'not in', ['completed', 'cancelled'])
      .executeTakeFirst(),

    // 6. Cash position — latest closing balance per bank
    db
      .selectFrom('BankTransaction')
      .select([
        'bank',
        sql<number>`"closingBalance"`.as('balance'),
      ])
      .where('closingBalance', 'is not', null)
      .where('bank', 'in', ['hdfc', 'razorpayx'])
      .orderBy('txnDate', 'desc')
      .distinctOn('bank')
      .execute()
      .catch(() => [] as Array<{ bank: string; balance: number }>),

    // 7. Accounts payable
    db
      .selectFrom('Invoice')
      .select([
        sql<number>`COUNT(*)::int`.as('outstandingCount'),
        sql<number>`COALESCE(SUM("balanceDue"), 0)::numeric`.as('outstandingAmount'),
      ])
      .where('type', '=', 'payable')
      .where('status', 'not in', ['paid', 'cancelled'])
      .where('balanceDue', '>', 0)
      .executeTakeFirst(),

    // 8. Accounts receivable
    db
      .selectFrom('Invoice')
      .select([
        sql<number>`COUNT(*)::int`.as('outstandingCount'),
        sql<number>`COALESCE(SUM("balanceDue"), 0)::numeric`.as('outstandingAmount'),
      ])
      .where('type', '=', 'receivable')
      .where('status', 'not in', ['paid', 'cancelled'])
      .where('balanceDue', '>', 0)
      .executeTakeFirst(),

    // 9. Return rate (30d)
    db
      .selectFrom('OrderLine')
      .innerJoin('Order', 'Order.id', 'OrderLine.orderId')
      .select([
        sql<number>`COUNT(*) FILTER (WHERE "OrderLine"."returnStatus" IS NOT NULL)::int`.as('returnLines'),
        sql<number>`COUNT(*) FILTER (WHERE "OrderLine"."lineStatus" = 'delivered')::int`.as('deliveredLines'),
      ])
      .where('Order.orderDate', '>=', days30Ago)
      .executeTakeFirst(),

    // 10. Fulfillment speed (30d): avg days from order to ship
    db
      .selectFrom('OrderLine')
      .innerJoin('Order', 'Order.id', 'OrderLine.orderId')
      .select([
        sql<number>`AVG(EXTRACT(EPOCH FROM ("OrderLine"."shippedAt" - "Order"."orderDate")) / 86400)::numeric`.as('avgDaysToShip'),
      ])
      .where('OrderLine.shippedAt', 'is not', null)
      .where('Order.orderDate', '>=', days30Ago)
      .executeTakeFirst(),

    // 11. Material health: low-stock fabric colours
    db
      .selectFrom('FabricColour')
      .select([
        sql<number>`COUNT(*) FILTER (WHERE "currentBalance" < 5 AND "isOutOfStock" = false)::int`.as('lowStockCount'),
      ])
      .executeTakeFirst(),
  ]);

  // Assemble revenue
  const revenue: PulseRevenue = {
    today: revenueMetrics.today.total,
    last7Days: revenueMetrics.last7Days.total,
    last30Days: revenueMetrics.last30Days.total,
    mtd: revenueMetrics.thisMonth.total,
    todayOrderCount: revenueMetrics.today.orderCount,
    last30DaysOrderCount: revenueMetrics.last30Days.orderCount,
    newVsReturning: {
      newCustomers: revenueMetrics.last30Days.newCustomers,
      returningCustomers: revenueMetrics.last30Days.returningCustomers,
    },
  };

  // Assemble pipeline
  const orderPipeline: PulseOrderPipeline = {
    totalOrders: pipelineData.pipeline.totalOrders,
    pendingLines: pipelineData.pipeline.pendingLines,
    allocatedLines: pipelineData.pipeline.allocatedLines,
    pickedLines: pipelineData.pipeline.pickedLines,
    packedLines: pipelineData.pipeline.packedLines,
    totalUnits: pipelineData.pipeline.totalUnits,
  };

  // Assemble inventory
  const inventory: PulseInventory = {
    totalSkus: inventoryResult?.totalSkus ?? 0,
    totalUnits: inventoryResult?.totalUnits ?? 0,
    lowStockSkuCount: inventoryResult?.lowStockSkuCount ?? 0,
  };

  // Assemble production
  const production: PulseProduction = {
    openBatches: productionResult?.openBatches ?? 0,
    unitsPlanned: productionResult?.unitsPlanned ?? 0,
    unitsCompleted: productionResult?.unitsCompleted ?? 0,
  };

  // Assemble cash position
  const cashMap = new Map((cashResult as Array<{ bank: string; balance: number }>).map((r) => [r.bank, r.balance]));
  const cash: PulseCash = {
    hdfcBalance: cashMap.get('hdfc') ?? null,
    razorpayxBalance: cashMap.get('razorpayx') ?? null,
  };

  // Payables & receivables
  const payables: PulsePayables = {
    outstandingCount: payablesResult?.outstandingCount ?? 0,
    outstandingAmount: Number(payablesResult?.outstandingAmount ?? 0),
  };

  const receivables: PulseReceivables = {
    outstandingCount: receivablesResult?.outstandingCount ?? 0,
    outstandingAmount: Number(receivablesResult?.outstandingAmount ?? 0),
  };

  // Return rate
  const deliveredLines = returnRateResult?.deliveredLines ?? 0;
  const returnLines = returnRateResult?.returnLines ?? 0;
  const returnRate30d = deliveredLines > 0
    ? Math.round((returnLines / deliveredLines) * 100)
    : null;

  // Fulfillment speed
  const fulfillment: PulseFulfillment = {
    avgDaysToShip30d: fulfillmentResult?.avgDaysToShip != null
      ? Math.round(Number(fulfillmentResult.avgDaysToShip) * 10) / 10
      : null,
  };

  // Material health
  const materialHealth: PulseMaterialHealth = {
    lowStockFabricColours: materialHealthResult?.lowStockCount ?? 0,
  };

  // Top products
  const topProducts: PulseTopProduct[] = topProducts7d.map((p) => ({
    id: p.id,
    name: p.name,
    imageUrl: p.imageUrl,
    units: p.units,
    revenue: p.revenue,
  }));

  return {
    generatedAt: new Date().toISOString(),
    revenue,
    orderPipeline,
    inventory,
    production,
    cash,
    payables,
    receivables,
    returnRate30d,
    fulfillment,
    materialHealth,
    topProducts7d: topProducts,
  };
}
