/**
 * Preview order grouping + SKU matching logic for the preview-import endpoint.
 */

import type { Request } from 'express';
import type { BtReportRow, PreviewLine, PreviewOrder, PreviewResponse } from './types.js';
import {
  normalizeChannel,
  parseDate,
  parseIntSafe,
  parsePriceToRupees,
  isPlaceholderPhone,
  isWarehouseOrder,
} from './csvParser.js';

/**
 * Build a preview response from parsed CSV rows.
 * Groups rows by Order Id, matches SKUs, checks existing orders, and returns
 * a structured preview with cache key for subsequent execute-import.
 */
export async function buildPreview(
  req: Request,
  rows: BtReportRow[],
  cacheKey: string,
): Promise<PreviewResponse> {
  // Group rows by Order Id
  const orderGroups = new Map<string, BtReportRow[]>();
  for (const row of rows) {
    const orderId = row['Order Id']?.trim();
    if (!orderId) continue;
    const group = orderGroups.get(orderId) || [];
    group.push(row);
    orderGroups.set(orderId, group);
  }

  // Collect all unique SKU codes for batch lookup
  const allSkuCodes = new Set<string>();
  for (const group of orderGroups.values()) {
    for (const row of group) {
      const code = row['SKU Codes']?.trim();
      if (code) allSkuCodes.add(code);
    }
  }

  // Batch lookup: SKUs by skuCode or shopifyVariantId
  const skuCodesArray = Array.from(allSkuCodes);
  const matchedSkus = skuCodesArray.length > 0
    ? await req.prisma.sku.findMany({
        where: {
          OR: [
            { skuCode: { in: skuCodesArray } },
            { shopifyVariantId: { in: skuCodesArray } },
          ],
        },
        select: { id: true, skuCode: true, shopifyVariantId: true },
      })
    : [];

  // Build SKU lookup map (code -> sku)
  const skuMap = new Map<string, { id: string; skuCode: string }>();
  for (const sku of matchedSkus) {
    skuMap.set(sku.skuCode, sku);
    if (sku.shopifyVariantId) {
      skuMap.set(sku.shopifyVariantId, sku);
    }
  }

  // Collect all channelRefs + alternate formats for batch lookup of existing orders
  // Myntra: CSV has full UUID "abc12345-xxxx-...", old imports stored first 8 chars "abc12345"
  // Nykaa: CSV has "NYK-xxx-xxx-x-x--1", old imports stored "NYK-xxx-xxx-x-x"
  const allChannelRefs = new Set<string>();
  const alternateRefs = new Map<string, string>(); // alternate -> full CSV ref
  for (const group of orderGroups.values()) {
    const ref = group[0]['Channel Ref']?.trim();
    if (!ref) continue;
    allChannelRefs.add(ref);
    const channel = normalizeChannel(group[0]['Channel Name']);
    if (channel === 'myntra' && ref.includes('-')) {
      const short = ref.split('-')[0];
      allChannelRefs.add(short);
      alternateRefs.set(short, ref);
    }
    if (channel === 'nykaa' && ref.endsWith('--1')) {
      const trimmed = ref.slice(0, -3); // strip "--1"
      allChannelRefs.add(trimmed);
      alternateRefs.set(trimmed, ref);
    }
  }

  const existingOrders = allChannelRefs.size > 0
    ? await req.prisma.order.findMany({
        where: { orderNumber: { in: Array.from(allChannelRefs) } },
        include: { orderLines: { select: { id: true, channelItemId: true, channelFulfillmentStatus: true, courier: true, awbNumber: true } } },
      })
    : [];
  // Map by both exact orderNumber AND resolve alternates back to full CSV ref
  const existingOrderMap = new Map<string, typeof existingOrders[0]>();
  for (const o of existingOrders) {
    existingOrderMap.set(o.orderNumber, o);
    const fullRef = alternateRefs.get(o.orderNumber);
    if (fullRef) existingOrderMap.set(fullRef, o);
  }

  // Build preview orders
  const previewOrders: PreviewOrder[] = [];
  const unmatchedSkus = new Set<string>();

  for (const [btOrderId, group] of orderGroups) {
    const firstRow = group[0];
    const channelRef = firstRow['Channel Ref']?.trim() || btOrderId;
    const channel = normalizeChannel(firstRow['Channel Name']);
    const orderDate = parseDate(firstRow['Order Date(IST)'], firstRow['Order Time(IST)']);
    const dispatchByDate = parseDate(firstRow['Dispatch By Date']);

    const existingOrder = existingOrderMap.get(channelRef);

    // Build lines
    const lines: PreviewLine[] = [];
    let anyLineChanged = false;
    for (const row of group) {
      const skuCode = row['SKU Codes']?.trim() || '';
      const matched = skuMap.get(skuCode);
      if (!matched) unmatchedSkus.add(skuCode);

      const fulfillmentStatus = row['Fulfillment Status']?.trim() || '';
      const channelItemId = row['Item ID']?.trim() || '';

      // Check if this line exists on the existing order
      let previousStatus: string | undefined;
      let lineChanged = false;
      const csvCourier = row['Courier Name']?.trim() || null;
      const csvAwb = row['Courier Tracking Number']?.trim() || null;

      if (existingOrder) {
        const existingLine = existingOrder.orderLines.find(l => l.channelItemId === channelItemId);
        if (existingLine) {
          // Check fulfillment status change
          if (existingLine.channelFulfillmentStatus && existingLine.channelFulfillmentStatus !== fulfillmentStatus) {
            previousStatus = existingLine.channelFulfillmentStatus;
            lineChanged = true;
          }
          // Check courier or AWB change
          if ((csvCourier && csvCourier !== existingLine.courier) ||
              (csvAwb && csvAwb !== existingLine.awbNumber)) {
            lineChanged = true;
          }
        }
      }

      lines.push({
        channelItemId,
        skuCode,
        skuId: matched?.id ?? null,
        skuMatched: !!matched,
        skuTitle: row['SKU Titles']?.trim() || null,
        qty: parseIntSafe(row['Quantity'], 1),
        unitPrice: parsePriceToRupees(row["Buyer's Price"]),
        fulfillmentStatus,
        ...(previousStatus ? { previousStatus } : {}),
        courierName: csvCourier,
        awbNumber: csvAwb,
        dispatchDate: parseDate(row['Dispatch Date'])?.toISOString() || null,
        manifestedDate: parseDate(row['Manifested Date'])?.toISOString() || null,
        deliveryDate: parseDate(row['Channel Delivery Date'])?.toISOString() || null,
      });

      if (lineChanged) anyLineChanged = true;
    }

    // Determine import status
    let importStatus: PreviewOrder['importStatus'] = 'new';
    if (existingOrder) {
      importStatus = anyLineChanged ? 'existing_updated' : 'existing_unchanged';
    }

    const totalAmount = lines.reduce((sum, l) => sum + l.unitPrice * l.qty, 0);

    const customerName = firstRow['Customer Name']?.trim() || null;
    const rawPhone = firstRow['Phone']?.trim() || null;
    const customerPhone = isPlaceholderPhone(rawPhone) ? null : rawPhone;
    const city = firstRow['City']?.trim() || null;
    const warehouse = isWarehouseOrder(channel, customerName, city);

    previewOrders.push({
      channelOrderId: btOrderId,
      channelRef,
      channel,
      importStatus,
      ...(existingOrder ? { existingOrderId: existingOrder.id } : {}),
      orderDate: orderDate?.toISOString() || '',
      orderType: firstRow['Order Type']?.trim() || 'Unknown',
      customerName: warehouse ? null : customerName,
      customerPhone: warehouse ? null : customerPhone,
      address1: warehouse ? null : (firstRow['Address Line 1']?.trim() || null),
      address2: warehouse ? null : (firstRow['Address Line 2']?.trim() || null),
      city: warehouse ? null : city,
      state: warehouse ? null : (firstRow['State']?.trim() || null),
      zip: warehouse ? null : (firstRow['Zip']?.trim() || null),
      dispatchByDate: dispatchByDate?.toISOString() || null,
      lines,
      totalAmount,
    });
  }

  // Sort: new first, then updated, then unchanged
  const statusOrder = { new: 0, existing_updated: 1, existing_unchanged: 2 };
  previewOrders.sort((a, b) => statusOrder[a.importStatus] - statusOrder[b.importStatus]);

  const summary = {
    totalOrders: previewOrders.length,
    newOrders: previewOrders.filter(o => o.importStatus === 'new').length,
    existingUnchanged: previewOrders.filter(o => o.importStatus === 'existing_unchanged').length,
    existingUpdated: previewOrders.filter(o => o.importStatus === 'existing_updated').length,
    unmatchedSkus: Array.from(unmatchedSkus).filter(Boolean),
  };

  return { orders: previewOrders, summary, cacheKey };
}
