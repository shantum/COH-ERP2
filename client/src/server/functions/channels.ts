/**
 * Channel Analytics Server Functions
 *
 * TanStack Start Server Functions for marketplace channel analytics.
 * Uses Kysely for high-performance aggregation queries.
 *
 * IMPORTANT: All database imports are dynamic to prevent Node.js code
 * from being bundled into the client.
 */

import { createServerFn } from '@tanstack/react-start';
import { z } from 'zod';
import { authMiddleware } from '../middleware/auth';

// ============================================
// INPUT SCHEMAS
// ============================================

const channelFilterSchema = z.object({
  channel: z.string().optional(),
  startDate: z.string().optional(),
  endDate: z.string().optional(),
});

const getChannelSummaryInputSchema = channelFilterSchema;

const getChannelTimeSeriesInputSchema = channelFilterSchema.extend({
  groupBy: z.enum(['day', 'week', 'month']).default('day'),
});

const getChannelOrdersInputSchema = channelFilterSchema.extend({
  page: z.number().int().positive().default(1),
  pageSize: z.number().int().positive().default(50),
  sortBy: z.string().optional(),
  sortDir: z.enum(['asc', 'desc']).default('desc'),
  fulfillmentStatus: z.string().optional(),
  orderType: z.string().optional(),
  skuCode: z.string().optional(),
  state: z.string().optional(),
});

const getChannelBreakdownInputSchema = channelFilterSchema.extend({
  groupBy: z.enum(['status', 'paymentType', 'channel', 'state']).default('channel'),
  limit: z.number().int().positive().default(20),
});

// ============================================
// RESPONSE TYPES
// ============================================

export interface ChannelSummary {
  totalRevenue: number;
  totalOrders: number;
  totalUnits: number;
  avgOrderValue: number;
  byChannel: Array<{
    channel: string;
    revenue: number;
    orders: number;
    units: number;
    aov: number;
  }>;
}

export interface TimeSeriesPoint {
  date: string;
  channel: string;
  revenue: number;
  orders: number;
  units: number;
}

export interface ChannelTimeSeries {
  data: TimeSeriesPoint[];
  channels: string[];
}

export interface BreakdownItem {
  label: string;
  revenue: number;
  orders: number;
  units: number;
  percent: number;
}

export interface ChannelBreakdown {
  groupBy: string;
  totalRevenue: number;
  data: BreakdownItem[];
}

export interface RTOAnalytics {
  totalOrders: number;
  rtoOrders: number;
  rtoRate: number;
  byChannel: Array<{
    channel: string;
    totalOrders: number;
    rtoOrders: number;
    rtoRate: number;
  }>;
  byState: Array<{
    state: string;
    totalOrders: number;
    rtoOrders: number;
    rtoRate: number;
  }>;
  byStatus: Array<{
    status: string;
    count: number;
    percent: number;
  }>;
}

export interface ChannelOrderRow {
  id: string;
  channel: string;
  channelOrderId: string;
  channelRef: string | null; // Channel Invoice No
  orderDate: string;
  orderType: string;
  fulfillmentStatus: string | null;
  skuCode: string;
  // Product info from our system
  productName: string | null;
  variationColor: string | null;
  size: string | null;
  quantity: number;
  shopifyMrp: number | null; // MRP from Shopify (in paise)
  buyerPrice: number | null;
  itemTotal: number | null;
  discountPercent: number | null;
  customerName: string | null;
  customerState: string | null;
  courierName: string | null;
  trackingNumber: string | null;
  // Date milestones
  invoiceNumber: string | null;
  dispatchDate: string | null;
  manifestedDate: string | null;
  deliveryDate: string | null;
}

export interface ChannelOrdersResponse {
  data: ChannelOrderRow[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
}

export interface ImportBatch {
  id: string;
  channel: string;
  filename: string;
  rowsTotal: number;
  rowsImported: number;
  rowsSkipped: number;
  rowsUpdated: number;
  dateRangeStart: string | null;
  dateRangeEnd: string | null;
  importedAt: string;
}

// ============================================
// HELPER FUNCTIONS
// ============================================

function parseFilterDates(startDate?: string, endDate?: string): { start: Date | null; end: Date | null } {
  return {
    start: startDate ? new Date(startDate) : null,
    end: endDate ? new Date(endDate) : null,
  };
}

function paiseToRupees(paise: number | null): number {
  return paise ? paise / 100 : 0;
}

// ============================================
// SERVER FUNCTIONS
// ============================================

/**
 * Get channel summary metrics (revenue, orders, AOV by channel)
 */
export const getChannelSummary = createServerFn({ method: 'GET' })
  .middleware([authMiddleware])
  .inputValidator((input: unknown) => getChannelSummaryInputSchema.parse(input))
  .handler(async ({ data }): Promise<ChannelSummary> => {
    const { getKysely } = await import('@coh/shared/services/db');
    const db = await getKysely();

    const { channel, startDate, endDate } = data;
    const { start, end } = parseFilterDates(startDate, endDate);

    // Build query with filters
    let query = db
      .selectFrom('ChannelOrderLine')
      .select([
        'channel',
        (eb) => eb.fn.sum<number>('itemTotal').as('revenue'),
        (eb) => eb.fn.countAll<number>().as('orderCount'),
        (eb) => eb.fn.sum<number>('quantity').as('units'),
      ])
      .groupBy('channel');

    if (channel) {
      query = query.where('channel', '=', channel);
    }
    if (start) {
      query = query.where('orderDate', '>=', start);
    }
    if (end) {
      query = query.where('orderDate', '<=', end);
    }

    const results = await query.execute();

    // Calculate totals
    let totalRevenue = 0;
    let totalOrders = 0;
    let totalUnits = 0;

    const byChannel = results.map((row) => {
      const revenue = paiseToRupees(Number(row.revenue) || 0);
      const orders = Number(row.orderCount) || 0;
      const units = Number(row.units) || 0;

      totalRevenue += revenue;
      totalOrders += orders;
      totalUnits += units;

      return {
        channel: row.channel,
        revenue,
        orders,
        units,
        aov: orders > 0 ? Math.round(revenue / orders) : 0,
      };
    });

    return {
      totalRevenue,
      totalOrders,
      totalUnits,
      avgOrderValue: totalOrders > 0 ? Math.round(totalRevenue / totalOrders) : 0,
      byChannel,
    };
  });

/**
 * Get time series data for revenue over time by channel
 */
export const getChannelTimeSeries = createServerFn({ method: 'GET' })
  .middleware([authMiddleware])
  .inputValidator((input: unknown) => getChannelTimeSeriesInputSchema.parse(input))
  .handler(async ({ data }): Promise<ChannelTimeSeries> => {
    const { getKysely } = await import('@coh/shared/services/db');
    const { sql } = await import('kysely');
    const db = await getKysely();

    const { channel, startDate, endDate, groupBy } = data;
    const { start, end } = parseFilterDates(startDate, endDate);

    // Default to last 30 days if no date range
    const effectiveStart = start || new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
    const effectiveEnd = end || new Date();

    // Build date truncation based on groupBy
    const dateTrunc = groupBy === 'week' ? 'week' : groupBy === 'month' ? 'month' : 'day';

    let query = db
      .selectFrom('ChannelOrderLine')
      .select([
        sql<string>`date_trunc(${sql.lit(dateTrunc)}, "orderDate")::date`.as('date'),
        'channel',
        (eb) => eb.fn.sum<number>('itemTotal').as('revenue'),
        (eb) => eb.fn.countAll<number>().as('orderCount'),
        (eb) => eb.fn.sum<number>('quantity').as('units'),
      ])
      .where('orderDate', '>=', effectiveStart)
      .where('orderDate', '<=', effectiveEnd)
      .groupBy([sql`date_trunc(${sql.lit(dateTrunc)}, "orderDate")::date`, 'channel'])
      .orderBy('date');

    if (channel) {
      query = query.where('channel', '=', channel);
    }

    const results = await query.execute();

    // Get unique channels
    const channelsSet = new Set<string>();
    const dataPoints: TimeSeriesPoint[] = results.map((row) => {
      channelsSet.add(row.channel);
      return {
        date: row.date,
        channel: row.channel,
        revenue: paiseToRupees(Number(row.revenue) || 0),
        orders: Number(row.orderCount) || 0,
        units: Number(row.units) || 0,
      };
    });

    return {
      data: dataPoints,
      channels: Array.from(channelsSet).sort(),
    };
  });

/**
 * Get breakdown by status, payment type, channel, or state
 */
export const getChannelBreakdown = createServerFn({ method: 'GET' })
  .middleware([authMiddleware])
  .inputValidator((input: unknown) => getChannelBreakdownInputSchema.parse(input))
  .handler(async ({ data }): Promise<ChannelBreakdown> => {
    const { getKysely } = await import('@coh/shared/services/db');
    const db = await getKysely();

    const { channel, startDate, endDate, groupBy, limit } = data;
    const { start, end } = parseFilterDates(startDate, endDate);

    // Map groupBy to column name
    const columnMap: Record<string, string> = {
      status: 'fulfillmentStatus',
      paymentType: 'orderType',
      channel: 'channel',
      state: 'customerState',
    };
    const groupColumn = columnMap[groupBy] || 'channel';

    // Build query
    let query = db
      .selectFrom('ChannelOrderLine')
      .select([
        groupColumn as 'channel', // Use type assertion for dynamic column
        (eb) => eb.fn.sum<number>('itemTotal').as('revenue'),
        (eb) => eb.fn.countAll<number>().as('orderCount'),
        (eb) => eb.fn.sum<number>('quantity').as('units'),
      ])
      .groupBy(groupColumn)
      .orderBy('revenue', 'desc')
      .limit(limit);

    if (channel && groupBy !== 'channel') {
      query = query.where('channel', '=', channel);
    }
    if (start) {
      query = query.where('orderDate', '>=', start);
    }
    if (end) {
      query = query.where('orderDate', '<=', end);
    }

    const results = await query.execute();

    // Calculate total for percentages
    const totalRevenue = results.reduce((sum, r) => sum + (Number(r.revenue) || 0), 0);

    const breakdownData: BreakdownItem[] = results.map((row) => {
      const revenue = paiseToRupees(Number(row.revenue) || 0);
      return {
        label: (row as unknown as Record<string, string | null>)[groupColumn] || 'Unknown',
        revenue,
        orders: Number(row.orderCount) || 0,
        units: Number(row.units) || 0,
        percent: totalRevenue > 0 ? Math.round((Number(row.revenue) / totalRevenue) * 100) : 0,
      };
    });

    return {
      groupBy,
      totalRevenue: paiseToRupees(totalRevenue),
      data: breakdownData,
    };
  });

/**
 * Get RTO and return analytics
 */
export const getChannelRTOAnalytics = createServerFn({ method: 'GET' })
  .middleware([authMiddleware])
  .inputValidator((input: unknown) => channelFilterSchema.parse(input))
  .handler(async ({ data }): Promise<RTOAnalytics> => {
    const { getKysely } = await import('@coh/shared/services/db');
    const db = await getKysely();

    const { channel, startDate, endDate } = data;
    const { start, end } = parseFilterDates(startDate, endDate);

    // Build base where conditions
    const buildWhere = (qb: typeof db) => {
      let q = qb.selectFrom('ChannelOrderLine');
      if (channel) {
        q = q.where('channel', '=', channel) as typeof q;
      }
      if (start) {
        q = q.where('orderDate', '>=', start) as typeof q;
      }
      if (end) {
        q = q.where('orderDate', '<=', end) as typeof q;
      }
      return q;
    };

    // Get totals and RTO counts
    const [totals, byChannel, byState, byStatus] = await Promise.all([
      // Total orders and RTO
      buildWhere(db)
        .select([
          (eb) => eb.fn.countAll<number>().as('total'),
          (eb) => eb.fn.count<number>('returnDate').as('rtoCount'),
        ])
        .executeTakeFirst(),

      // By channel
      buildWhere(db)
        .select([
          'channel',
          (eb) => eb.fn.countAll<number>().as('total'),
          (eb) => eb.fn.count<number>('returnDate').as('rtoCount'),
        ])
        .groupBy('channel')
        .execute(),

      // By state (top 10)
      buildWhere(db)
        .select([
          'customerState',
          (eb) => eb.fn.countAll<number>().as('total'),
          (eb) => eb.fn.count<number>('returnDate').as('rtoCount'),
        ])
        .where('customerState', 'is not', null)
        .groupBy('customerState')
        .orderBy('total', 'desc')
        .limit(10)
        .execute(),

      // By fulfillment status
      buildWhere(db)
        .select([
          'fulfillmentStatus',
          (eb) => eb.fn.countAll<number>().as('count'),
        ])
        .groupBy('fulfillmentStatus')
        .orderBy('count', 'desc')
        .execute(),
    ]);

    const totalOrders = Number(totals?.total) || 0;
    const rtoOrders = Number(totals?.rtoCount) || 0;
    const totalForPercent = totalOrders || 1;

    return {
      totalOrders,
      rtoOrders,
      rtoRate: Math.round((rtoOrders / totalForPercent) * 100 * 10) / 10,
      byChannel: byChannel.map((row) => ({
        channel: row.channel,
        totalOrders: Number(row.total) || 0,
        rtoOrders: Number(row.rtoCount) || 0,
        rtoRate: Math.round((Number(row.rtoCount) / (Number(row.total) || 1)) * 100 * 10) / 10,
      })),
      byState: byState.map((row) => ({
        state: row.customerState || 'Unknown',
        totalOrders: Number(row.total) || 0,
        rtoOrders: Number(row.rtoCount) || 0,
        rtoRate: Math.round((Number(row.rtoCount) / (Number(row.total) || 1)) * 100 * 10) / 10,
      })),
      byStatus: byStatus.map((row) => ({
        status: row.fulfillmentStatus || 'Unknown',
        count: Number(row.count) || 0,
        percent: Math.round((Number(row.count) / totalForPercent) * 100),
      })),
    };
  });

/**
 * Get paginated channel order lines
 */
export const getChannelOrders = createServerFn({ method: 'POST' })
  .middleware([authMiddleware])
  .inputValidator((input: unknown) => getChannelOrdersInputSchema.parse(input))
  .handler(async ({ data }): Promise<ChannelOrdersResponse> => {
    const { getKysely } = await import('@coh/shared/services/db');
    const db = await getKysely();

    const {
      channel,
      startDate,
      endDate,
      page,
      pageSize,
      sortBy,
      sortDir,
      fulfillmentStatus,
      orderType,
      skuCode,
      state,
    } = data;
    const { start, end } = parseFilterDates(startDate, endDate);

    // Build base query
    let query = db.selectFrom('ChannelOrderLine');

    // Apply filters
    if (channel) {
      query = query.where('channel', '=', channel);
    }
    if (start) {
      query = query.where('orderDate', '>=', start);
    }
    if (end) {
      query = query.where('orderDate', '<=', end);
    }
    if (fulfillmentStatus) {
      query = query.where('fulfillmentStatus', '=', fulfillmentStatus);
    }
    if (orderType) {
      query = query.where('orderType', '=', orderType);
    }
    if (skuCode) {
      query = query.where('skuCode', 'ilike', `%${skuCode}%`);
    }
    if (state) {
      query = query.where('customerState', '=', state);
    }

    // Get total count
    const countResult = await query
      .select((eb) => eb.fn.countAll<number>().as('count'))
      .executeTakeFirst();
    const total = Number(countResult?.count) || 0;

    // Apply sorting
    const sortColumn = sortBy || 'orderDate';
    const validColumns = [
      'orderDate',
      'channel',
      'channelOrderId',
      'skuCode',
      'quantity',
      'itemTotal',
      'fulfillmentStatus',
      'customerState',
    ];
    const safeColumn = validColumns.includes(sortColumn) ? sortColumn : 'orderDate';

    // Get paginated data with SKU joins for product info
    const offset = (page - 1) * pageSize;
    const rows = await db
      .selectFrom('ChannelOrderLine as col')
      .leftJoin('Sku as s', 'col.skuCode', 's.skuCode')
      .leftJoin('Variation as v', 's.variationId', 'v.id')
      .leftJoin('Product as p', 'v.productId', 'p.id')
      .select([
        'col.id',
        'col.channel',
        'col.channelOrderId',
        'col.channelRef',
        'col.orderDate',
        'col.orderType',
        'col.fulfillmentStatus',
        'col.skuCode',
        'p.name as productName',
        'v.colorName as variationColor',
        's.size',
        's.mrp as skuMrp',
        'col.quantity',
        'col.buyerPrice',
        'col.itemTotal',
        'col.customerName',
        'col.customerState',
        'col.courierName',
        'col.trackingNumber',
        'col.invoiceNumber',
        'col.dispatchDate',
        'col.manifestedDate',
        'col.deliveryDate',
      ])
      .$if(!!channel, (qb) => qb.where('col.channel', '=', channel!))
      .$if(!!start, (qb) => qb.where('col.orderDate', '>=', start!))
      .$if(!!end, (qb) => qb.where('col.orderDate', '<=', end!))
      .$if(!!fulfillmentStatus, (qb) => qb.where('col.fulfillmentStatus', '=', fulfillmentStatus!))
      .$if(!!orderType, (qb) => qb.where('col.orderType', '=', orderType!))
      .$if(!!skuCode, (qb) => qb.where('col.skuCode', 'ilike', `%${skuCode}%`))
      .$if(!!state, (qb) => qb.where('col.customerState', '=', state!))
      .orderBy(`col.${safeColumn}` as 'col.orderDate', sortDir)
      .limit(pageSize)
      .offset(offset)
      .execute();

    return {
      data: rows.map((row) => {
        // Calculate discount % = (MRP - buyerPrice) / MRP * 100
        // Clamp to 0-99 range (negative = price higher than MRP, 100+ = invalid)
        const mrp = row.skuMrp ? row.skuMrp * 100 : null; // skuMrp is in rupees, convert to paise for comparison
        const buyerPrice = row.buyerPrice;
        let discountPercent: number | null = null;
        if (mrp && buyerPrice && mrp > 0) {
          const rawDiscount = Math.round(((mrp - buyerPrice) / mrp) * 100);
          discountPercent = rawDiscount < 0 ? null : Math.min(rawDiscount, 99);
        }

        return {
          id: row.id,
          channel: row.channel,
          channelOrderId: row.channelOrderId,
          channelRef: row.channelRef,
          orderDate: row.orderDate instanceof Date ? row.orderDate.toISOString() : String(row.orderDate),
          orderType: row.orderType,
          fulfillmentStatus: row.fulfillmentStatus,
          skuCode: row.skuCode,
          productName: row.productName,
          variationColor: row.variationColor,
          size: row.size,
          quantity: row.quantity,
          shopifyMrp: row.skuMrp ? row.skuMrp * 100 : null, // Convert rupees to paise for consistency
          buyerPrice: row.buyerPrice,
          itemTotal: row.itemTotal,
          discountPercent,
          customerName: row.customerName,
          customerState: row.customerState,
          courierName: row.courierName,
          trackingNumber: row.trackingNumber,
          invoiceNumber: row.invoiceNumber,
          dispatchDate: row.dispatchDate instanceof Date ? row.dispatchDate.toISOString() : row.dispatchDate ? String(row.dispatchDate) : null,
          manifestedDate: row.manifestedDate instanceof Date ? row.manifestedDate.toISOString() : row.manifestedDate ? String(row.manifestedDate) : null,
          deliveryDate: row.deliveryDate instanceof Date ? row.deliveryDate.toISOString() : row.deliveryDate ? String(row.deliveryDate) : null,
        };
      }),
      total,
      page,
      pageSize,
      totalPages: Math.ceil(total / pageSize),
    };
  });

/**
 * Get import batch history
 */
export const getImportHistory = createServerFn({ method: 'GET' })
  .middleware([authMiddleware])
  .handler(async (): Promise<ImportBatch[]> => {
    const { getKysely } = await import('@coh/shared/services/db');
    const db = await getKysely();

    const batches = await db
      .selectFrom('ChannelImportBatch')
      .select([
        'id',
        'channel',
        'filename',
        'rowsTotal',
        'rowsImported',
        'rowsSkipped',
        'rowsUpdated',
        'dateRangeStart',
        'dateRangeEnd',
        'importedAt',
      ])
      .orderBy('importedAt', 'desc')
      .limit(50)
      .execute();

    return batches.map((b) => ({
      id: b.id,
      channel: b.channel,
      filename: b.filename,
      rowsTotal: b.rowsTotal,
      rowsImported: b.rowsImported,
      rowsSkipped: b.rowsSkipped,
      rowsUpdated: b.rowsUpdated,
      dateRangeStart: b.dateRangeStart instanceof Date ? b.dateRangeStart.toISOString().split('T')[0] : null,
      dateRangeEnd: b.dateRangeEnd instanceof Date ? b.dateRangeEnd.toISOString().split('T')[0] : null,
      importedAt: b.importedAt instanceof Date ? b.importedAt.toISOString() : String(b.importedAt),
    }));
  });

/**
 * Get unique values for filters (channels, statuses, states)
 */
export const getChannelFilterOptions = createServerFn({ method: 'GET' })
  .middleware([authMiddleware])
  .handler(async () => {
    const { getKysely } = await import('@coh/shared/services/db');
    const db = await getKysely();

    const [channels, statuses, orderTypes, states] = await Promise.all([
      db
        .selectFrom('ChannelOrderLine')
        .select('channel')
        .distinct()
        .orderBy('channel')
        .execute(),
      db
        .selectFrom('ChannelOrderLine')
        .select('fulfillmentStatus')
        .distinct()
        .where('fulfillmentStatus', 'is not', null)
        .orderBy('fulfillmentStatus')
        .execute(),
      db
        .selectFrom('ChannelOrderLine')
        .select('orderType')
        .distinct()
        .orderBy('orderType')
        .execute(),
      db
        .selectFrom('ChannelOrderLine')
        .select('customerState')
        .distinct()
        .where('customerState', 'is not', null)
        .orderBy('customerState')
        .execute(),
    ]);

    return {
      channels: channels.map((r) => r.channel),
      statuses: statuses.map((r) => r.fulfillmentStatus).filter(Boolean) as string[],
      orderTypes: orderTypes.map((r) => r.orderType),
      states: states.map((r) => r.customerState).filter(Boolean) as string[],
    };
  });

/**
 * Get top products from channel data (grouped by product variation)
 */
export const getChannelTopProducts = createServerFn({ method: 'GET' })
  .middleware([authMiddleware])
  .inputValidator((input: unknown) =>
    channelFilterSchema.extend({
      limit: z.number().int().positive().default(10),
      groupBy: z.enum(['sku', 'variation']).default('variation'),
    }).parse(input)
  )
  .handler(async ({ data }) => {
    const { getKysely } = await import('@coh/shared/services/db');
    const db = await getKysely();

    const { channel, startDate, endDate, limit, groupBy } = data;
    const { start, end } = parseFilterDates(startDate, endDate);

    if (groupBy === 'variation') {
      // Group by product variation (product name + color) with joins
      let query = db
        .selectFrom('ChannelOrderLine as col')
        .leftJoin('Sku as s', 'col.skuCode', 's.skuCode')
        .leftJoin('Variation as v', 's.variationId', 'v.id')
        .leftJoin('Product as p', 'v.productId', 'p.id')
        .select([
          'v.id as variationId',
          'p.name as productName',
          'v.colorName',
          'v.imageUrl as variationImage', // Use variation image, not product
          (eb) => eb.fn.sum<number>('col.itemTotal').as('revenue'),
          (eb) => eb.fn.sum<number>('col.quantity').as('units'),
          (eb) => eb.fn.countAll<number>().as('orderCount'),
        ])
        .where('v.id', 'is not', null) // Only include matched products
        .groupBy(['v.id', 'p.name', 'v.colorName', 'v.imageUrl'])
        .orderBy('revenue', 'desc')
        .limit(limit);

      if (channel) {
        query = query.where('col.channel', '=', channel);
      }
      if (start) {
        query = query.where('col.orderDate', '>=', start);
      }
      if (end) {
        query = query.where('col.orderDate', '<=', end);
      }

      const results = await query.execute();

      return results.map((row) => ({
        variationId: row.variationId,
        productName: row.productName || 'Unknown Product',
        colorName: row.colorName || '',
        imageUrl: row.variationImage,
        revenue: paiseToRupees(Number(row.revenue) || 0),
        units: Number(row.units) || 0,
        orderCount: Number(row.orderCount) || 0,
      }));
    } else {
      // Original SKU-level grouping
      let query = db
        .selectFrom('ChannelOrderLine')
        .select([
          'skuCode',
          (eb) => eb.fn.max('skuTitle').as('skuTitle'),
          (eb) => eb.fn.sum<number>('itemTotal').as('revenue'),
          (eb) => eb.fn.sum<number>('quantity').as('units'),
          (eb) => eb.fn.countAll<number>().as('orderCount'),
        ])
        .groupBy('skuCode')
        .orderBy('revenue', 'desc')
        .limit(limit);

      if (channel) {
        query = query.where('channel', '=', channel);
      }
      if (start) {
        query = query.where('orderDate', '>=', start);
      }
      if (end) {
        query = query.where('orderDate', '<=', end);
      }

      const results = await query.execute();

      return results.map((row) => ({
        skuCode: row.skuCode,
        skuTitle: row.skuTitle,
        revenue: paiseToRupees(Number(row.revenue) || 0),
        units: Number(row.units) || 0,
        orderCount: Number(row.orderCount) || 0,
      }));
    }
  });

/**
 * Get top states from channel data
 */
export const getChannelTopStates = createServerFn({ method: 'GET' })
  .middleware([authMiddleware])
  .inputValidator((input: unknown) =>
    channelFilterSchema.extend({ limit: z.number().int().positive().default(10) }).parse(input)
  )
  .handler(async ({ data }) => {
    const { getKysely } = await import('@coh/shared/services/db');
    const db = await getKysely();

    const { channel, startDate, endDate, limit } = data;
    const { start, end } = parseFilterDates(startDate, endDate);

    let query = db
      .selectFrom('ChannelOrderLine')
      .select([
        'customerState',
        (eb) => eb.fn.sum<number>('itemTotal').as('revenue'),
        (eb) => eb.fn.sum<number>('quantity').as('units'),
        (eb) => eb.fn.countAll<number>().as('orderCount'),
      ])
      .where('customerState', 'is not', null)
      .groupBy('customerState')
      .orderBy('revenue', 'desc')
      .limit(limit);

    if (channel) {
      query = query.where('channel', '=', channel);
    }
    if (start) {
      query = query.where('orderDate', '>=', start);
    }
    if (end) {
      query = query.where('orderDate', '<=', end);
    }

    const results = await query.execute();

    return results.map((row) => ({
      state: row.customerState || 'Unknown',
      revenue: paiseToRupees(Number(row.revenue) || 0),
      units: Number(row.units) || 0,
      orderCount: Number(row.orderCount) || 0,
    }));
  });
