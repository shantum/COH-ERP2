/**
 * Channel Account Reconciliation — per-channel summary & order drilldown
 */

'use server';

import { z } from 'zod';
import { createServerFn } from '@tanstack/react-start';
import { authMiddleware } from '../../middleware/auth';
import { getPrisma } from '@coh/shared/services/db';

// ============================================
// CHANNEL GROUPS
// ============================================

const channelGroups = [
  { key: 'shopify_prepaid', label: 'Shopify (Prepaid)', channel: 'shopify', paymentMethod: 'Prepaid' as const },
  { key: 'shopify_cod', label: 'Shopify (COD)', channel: 'shopify', paymentMethod: 'COD' as const },
  { key: 'nykaa', label: 'Nykaa', channel: 'nykaa' },
  { key: 'myntra', label: 'Myntra', channel: 'myntra' },
  { key: 'ajio', label: 'Ajio', channel: 'ajio' },
] as const;

// ============================================
// CHANNEL RECONCILIATION SUMMARY
// ============================================

export const getChannelReconciliation = createServerFn({ method: 'GET' })
  .middleware([authMiddleware])
  .handler(async () => {
    const prisma = await getPrisma();

    const results = await Promise.all(
      channelGroups.map(async (group) => {
        const orderWhere = {
          channel: group.channel,
          isArchived: false,
          ...('paymentMethod' in group ? { paymentMethod: group.paymentMethod } : {}),
        };

        const [totalOrders, invoiceAgg] = await Promise.all([
          prisma.order.count({ where: orderWhere }),
          prisma.invoice.aggregate({
            where: {
              category: 'customer_order',
              order: orderWhere,
            },
            _sum: { totalAmount: true, paidAmount: true },
          }),
        ]);

        const grossReceivable = invoiceAgg._sum.totalAmount ?? 0;
        const settled = invoiceAgg._sum.paidAmount ?? 0;

        // For marketplace channels, sum commission invoices linked to the channel party
        let commissions = 0;
        if (!('paymentMethod' in group)) {
          const commAgg = await prisma.invoice.aggregate({
            where: {
              category: { in: ['marketplace_commission', 'marketplace_promo'] },
              party: { name: { contains: group.channel, mode: 'insensitive' } },
            },
            _sum: { totalAmount: true },
          });
          commissions = commAgg._sum.totalAmount ?? 0;
        }

        return {
          key: group.key,
          label: group.label,
          channel: group.channel,
          totalOrders,
          grossReceivable,
          settled,
          commissions,
          outstanding: grossReceivable - settled - commissions,
        };
      }),
    );

    // COD-specific metrics
    const now = new Date();
    const sevenDaysAgo = new Date(now);
    sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
    const fourteenDaysAgo = new Date(now);
    fourteenDaysAgo.setDate(fourteenDaysAgo.getDate() - 14);
    const twentyOneDaysAgo = new Date(now);
    twentyOneDaysAgo.setDate(twentyOneDaysAgo.getDate() - 21);

    const codDeliveredBase = {
      paymentMethod: 'COD',
      codRemittedAt: null as null,
      isArchived: false,
      orderLines: {
        some: { trackingStatus: 'delivered' },
        every: {
          OR: [
            { trackingStatus: 'delivered' },
            { lineStatus: 'cancelled' },
          ],
        },
      },
    };

    const [
      pendingRemittanceCount,
      pendingRemittanceAmount,
      rtoCount,
      rtoAmount,
      aging7,
      aging14,
      aging21,
      totalCodOrders,
      totalPrepaidOrders,
    ] = await Promise.all([
      // Pending remittance: delivered COD, not yet remitted
      prisma.order.count({ where: codDeliveredBase }),
      prisma.order.aggregate({ where: codDeliveredBase, _sum: { totalAmount: true } }),
      // RTO: COD orders with all lines in rto/rto_delivered status
      prisma.order.count({
        where: {
          paymentMethod: 'COD',
          isArchived: false,
          orderLines: {
            some: { trackingStatus: { in: ['rto_initiated', 'rto_delivered'] } },
            every: {
              OR: [
                { trackingStatus: { in: ['rto_initiated', 'rto_delivered'] } },
                { lineStatus: 'cancelled' },
              ],
            },
          },
        },
      }),
      prisma.order.aggregate({
        where: {
          paymentMethod: 'COD',
          isArchived: false,
          orderLines: {
            some: { trackingStatus: { in: ['rto_initiated', 'rto_delivered'] } },
            every: {
              OR: [
                { trackingStatus: { in: ['rto_initiated', 'rto_delivered'] } },
                { lineStatus: 'cancelled' },
              ],
            },
          },
        },
        _sum: { totalAmount: true },
      }),
      // Remittance aging buckets: delivered > N days ago, not remitted
      prisma.order.count({
        where: {
          ...codDeliveredBase,
          orderLines: {
            ...codDeliveredBase.orderLines,
            some: { trackingStatus: 'delivered', deliveredAt: { lte: sevenDaysAgo } },
          },
        },
      }),
      prisma.order.count({
        where: {
          ...codDeliveredBase,
          orderLines: {
            ...codDeliveredBase.orderLines,
            some: { trackingStatus: 'delivered', deliveredAt: { lte: fourteenDaysAgo } },
          },
        },
      }),
      prisma.order.count({
        where: {
          ...codDeliveredBase,
          orderLines: {
            ...codDeliveredBase.orderLines,
            some: { trackingStatus: 'delivered', deliveredAt: { lte: twentyOneDaysAgo } },
          },
        },
      }),
      // COD vs Prepaid split
      prisma.order.count({ where: { paymentMethod: 'COD', isArchived: false } }),
      prisma.order.count({ where: { paymentMethod: 'Prepaid', isArchived: false } }),
    ]);

    const codMetrics = {
      pendingRemittance: {
        count: pendingRemittanceCount,
        amount: pendingRemittanceAmount._sum.totalAmount ?? 0,
      },
      rto: {
        count: rtoCount,
        amount: rtoAmount._sum.totalAmount ?? 0,
      },
      remittanceAging: {
        over7Days: aging7,
        over14Days: aging14,
        over21Days: aging21,
      },
      split: {
        cod: totalCodOrders,
        prepaid: totalPrepaidOrders,
        codPercent: totalCodOrders + totalPrepaidOrders > 0
          ? Math.round((totalCodOrders / (totalCodOrders + totalPrepaidOrders)) * 100)
          : 0,
      },
    };

    return { success: true as const, channels: results, codMetrics };
  });

// ============================================
// CHANNEL ORDER DRILLDOWN
// ============================================

const ChannelDrilldownInput = z.object({
  channel: z.string(),
  paymentMethod: z.string().optional(),
  unsettledOnly: z.boolean().optional(),
  dateFrom: z.string().optional(),
  dateTo: z.string().optional(),
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().positive().max(200).default(50),
});

export const getChannelOrderDrilldown = createServerFn({ method: 'POST' })
  .middleware([authMiddleware])
  .inputValidator((input: unknown) => ChannelDrilldownInput.parse(input))
  .handler(async ({ data }) => {
    const prisma = await getPrisma();
    const { channel, paymentMethod, unsettledOnly, dateFrom, dateTo, page, limit } = data;

    const orderWhere = {
      channel,
      isArchived: false,
      ...(paymentMethod ? { paymentMethod } : {}),
      ...(dateFrom || dateTo
        ? {
            orderDate: {
              ...(dateFrom ? { gte: new Date(dateFrom) } : {}),
              ...(dateTo ? { lte: new Date(dateTo) } : {}),
            },
          }
        : {}),
      ...(unsettledOnly
        ? {
            financeInvoices: {
              some: {
                category: 'customer_order',
                status: { not: 'paid' },
              },
            },
          }
        : {}),
    };

    const [orders, total] = await Promise.all([
      prisma.order.findMany({
        where: orderWhere,
        select: {
          id: true,
          orderNumber: true,
          orderDate: true,
          totalAmount: true,
          customerName: true,
          paymentMethod: true,
          codRemittedAt: true,
          financeInvoices: {
            where: { category: 'customer_order' },
            select: {
              id: true,
              invoiceNumber: true,
              status: true,
              totalAmount: true,
              paidAmount: true,
              balanceDue: true,
            },
            take: 1,
          },
        },
        orderBy: { orderDate: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
      }),
      prisma.order.count({ where: orderWhere }),
    ]);

    // Flatten invoice data into the order row for easier consumption
    const rows = orders.map((o) => {
      const inv = o.financeInvoices[0];
      return {
        id: o.id,
        orderNumber: o.orderNumber,
        orderDate: o.orderDate,
        totalAmount: o.totalAmount,
        customerName: o.customerName,
        paymentMethod: o.paymentMethod,
        codRemittedAt: o.codRemittedAt,
        invoiceId: inv?.id ?? null,
        invoiceNumber: inv?.invoiceNumber ?? null,
        invoiceStatus: inv?.status ?? 'no_invoice',
        invoicePaidAmount: inv?.paidAmount ?? 0,
        invoiceBalanceDue: inv?.balanceDue ?? 0,
      };
    });

    return { success: true as const, orders: rows, total, page, limit };
  });
