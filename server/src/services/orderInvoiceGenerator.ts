/**
 * Order Invoice Generator
 *
 * Creates draft GST-compliant invoices from orders.
 * The order is the source of truth — the invoice is a "stamp" with computed GST.
 *
 * Flow:
 * 1. Order created (Shopify import or manual) → draft invoice (no number)
 * 2. Payment received → confirm invoice → assign sequential number
 *
 * Draft invoices:
 * - type = 'receivable'
 * - category = 'customer_order'
 * - status = 'draft'
 * - invoiceNumber = null (assigned on confirm)
 */

import type { PrismaClient } from '@prisma/client';
import { computeOrderGst, type GstLineInput } from '@coh/shared/domain';
import { dateToPeriod } from '@coh/shared';
import { COMPANY_GST } from '../config/finance/gst.js';
import logger from '../utils/logger.js';

const log = logger.child({ module: 'order-invoice-gen' });

interface GeneratedInvoice {
  invoiceId: string;
  orderId: string;
  totalAmount: number;
  gstAmount: number;
  lineCount: number;
}

/**
 * Generate a draft invoice for an order.
 * Idempotent — skips if an invoice already exists for this order.
 *
 * @param prisma - Prisma client
 * @param orderId - ERP Order ID
 * @returns Generated invoice info, or null if skipped
 */
export async function generateDraftInvoice(
  prisma: PrismaClient,
  orderId: string,
): Promise<GeneratedInvoice | null> {
  // Check if invoice already exists for this order
  const existingInvoice = await prisma.invoice.findFirst({
    where: { orderId, category: 'customer_order' },
    select: { id: true },
  });

  if (existingInvoice) {
    log.debug({ orderId, invoiceId: existingInvoice.id }, 'Invoice already exists, skipping');
    return null;
  }

  // Load order with lines, SKU (MRP), and Product (hsnCode)
  const order = await prisma.order.findUnique({
    where: { id: orderId },
    select: {
      id: true,
      orderNumber: true,
      channel: true,
      totalAmount: true,
      orderDate: true,
      customerId: true,
      customerState: true,
      orderLines: {
        where: { lineStatus: { not: 'cancelled' } },
        select: {
          id: true,
          qty: true,
          unitPrice: true,
          sku: {
            select: {
              mrp: true,
              variation: {
                select: {
                  product: {
                    select: { hsnCode: true },
                  },
                },
              },
            },
          },
        },
      },
    },
  });

  if (!order) {
    log.warn({ orderId }, 'Order not found');
    return null;
  }

  // Only auto-generate invoices for direct channels (Shopify, offline).
  // Marketplace channels (Myntra, AJIO, Nykaa, etc.) have different settlement
  // flows — invoices should be created during channel reconciliation.
  const DIRECT_CHANNELS = ['shopify', 'shopify_online', 'offline'];
  const channel = (order.channel ?? '').toLowerCase();
  if (!DIRECT_CHANNELS.some(c => channel === c || channel.startsWith(`${c}_`))) {
    log.debug({ orderId, orderNumber: order.orderNumber, channel: order.channel }, 'Marketplace order — skipping invoice');
    return null;
  }

  if (order.orderLines.length === 0) {
    log.debug({ orderId, orderNumber: order.orderNumber }, 'No active order lines, skipping invoice');
    return null;
  }

  // Build GST line inputs from order lines
  const gstLines: GstLineInput[] = order.orderLines.map((line) => ({
    amount: line.unitPrice * line.qty,
    mrp: line.sku.mrp,
    qty: line.qty,
    hsnCode: line.sku.variation.product.hsnCode || COMPANY_GST.DEFAULT_HSN,
  }));

  // Compute GST
  const gst = computeOrderGst(gstLines, order.customerState);

  // Look up admin user for createdById (critical rule: role = 'admin', lowercase)
  const admin = await prisma.user.findFirst({ where: { role: 'admin' } });
  if (!admin) {
    log.error('No admin user found — cannot create invoice');
    throw new Error('No admin user found. InventoryTransaction.createdById is required.');
  }

  // Create invoice + lines in a transaction
  const invoice = await prisma.invoice.create({
    data: {
      type: 'receivable',
      category: 'customer_order',
      status: 'draft',
      invoiceNumber: null, // Assigned on confirmation
      invoiceDate: order.orderDate,
      billingPeriod: dateToPeriod(order.orderDate),
      orderId: order.id,
      customerId: order.customerId,
      subtotal: gst.subtotal,
      gstRate: gst.effectiveGstRate,
      gstAmount: gst.gstAmount,
      gstType: gst.gstType,
      cgstAmount: gst.cgstAmount,
      sgstAmount: gst.sgstAmount,
      igstAmount: gst.igstAmount,
      totalAmount: gst.total,
      balanceDue: gst.total,
      createdById: admin.id,
      notes: `Auto-generated from order ${order.orderNumber}`,
      lines: {
        create: order.orderLines.map((line, i) => {
          const gstLine = gst.lines[i];
          return {
            description: `Order ${order.orderNumber} — line item`,
            hsnCode: gstLine.hsnCode,
            qty: line.qty,
            rate: line.unitPrice,
            amount: gstLine.taxableValue,
            gstPercent: gstLine.gstRate,
            gstAmount: gstLine.gstAmount,
            orderLineId: line.id,
          };
        }),
      },
    },
    select: { id: true },
  });

  log.info({
    invoiceId: invoice.id,
    orderId: order.id,
    orderNumber: order.orderNumber,
    totalAmount: gst.total,
    gstAmount: gst.gstAmount,
    gstType: gst.gstType,
    lineCount: order.orderLines.length,
  }, 'Draft invoice generated');

  return {
    invoiceId: invoice.id,
    orderId: order.id,
    totalAmount: gst.total,
    gstAmount: gst.gstAmount,
    lineCount: order.orderLines.length,
  };
}
