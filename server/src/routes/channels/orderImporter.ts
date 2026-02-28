/**
 * Execute-import logic: creates/updates real ERP Orders from previewed channel data.
 */

import type { Request, Response } from 'express';
import { batchPushOrdersToSheet, updateSheetChannelDetails } from '../../services/sheetOrderPush.js';
import { recomputeOrderStatus } from '../../utils/orderStatus.js';
import { deferredExecutor } from '../../services/deferredExecutor.js';
import prisma from '../../lib/prisma.js';
import type { BtReportRow, PreviewOrder } from './types.js';
import { parseDate } from './csvParser.js';
import { upsertChannelOrderLine } from './channelOrderLineUpsert.js';
import { getCsvCache, deleteCsvCache } from './csvCache.js';

/**
 * Execute the order import: creates new orders and updates existing ones.
 * Streams progress via SSE.
 */
export async function executeImport(req: Request, res: Response): Promise<void> {
  const { selectedOrders, cacheKey, filename } = req.body as {
    selectedOrders: PreviewOrder[];
    cacheKey: string;
    filename: string;
  };

  if (!selectedOrders || selectedOrders.length === 0) {
    res.status(400).json({ error: 'No orders selected' });
    return;
  }

  // Look up cached CSV rows
  const rawRows: BtReportRow[] = (cacheKey ? getCsvCache(cacheKey) : null) ?? [];
  if (cacheKey) deleteCsvCache(cacheKey); // One-time use

  const userId = req.user?.id;

  // Create import batch
  const importBatch = await req.prisma.channelImportBatch.create({
    data: {
      channel: 'multiple',
      filename: filename || 'channel-import.csv',
      rowsTotal: rawRows.length,
      rowsImported: 0,
      rowsSkipped: 0,
      rowsUpdated: 0,
      importedBy: userId,
      importType: 'order_import',
    },
  });

  // Separate orders by type
  const newOrders = selectedOrders.filter(o => o.importStatus === 'new');
  const updatedOrders = selectedOrders.filter(o => o.importStatus === 'existing_updated' && o.existingOrderId);
  const totalOrders = newOrders.length + updatedOrders.length;

  // SSE streaming for progress
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');

  const sendProgress = (data: Record<string, unknown>) => {
    res.write(`data: ${JSON.stringify(data)}\n\n`);
  };

  let ordersCreated = 0;
  let ordersUpdated = 0;
  const errors: Array<{ order: string; error: string }> = [];
  const processingOrders: Array<{ id: string; orderNumber: string }> = [];

  const CHUNK_SIZE = 20;

  // ---- Process NEW orders in chunked transactions ----
  for (let i = 0; i < newOrders.length; i += CHUNK_SIZE) {
    const chunk = newOrders.slice(i, i + CHUNK_SIZE);
    try {
      const chunkResult = await req.prisma.$transaction(async (tx) => {
        const created: Array<{ id: string; orderNumber: string }> = [];
        const chunkErrors: Array<{ order: string; error: string }> = [];

        for (const previewOrder of chunk) {
          try {
            const matchedLines = previewOrder.lines.filter(l => l.skuMatched && l.skuId);
            if (matchedLines.length === 0) {
              chunkErrors.push({ order: previewOrder.channelRef, error: 'No matched SKUs' });
              continue;
            }

            const isCOD = previewOrder.orderType?.toUpperCase() === 'COD';
            const totalAmount = matchedLines.reduce((sum, l) => sum + l.unitPrice * l.qty, 0);

            let shippingAddress: string | null = null;
            if (previewOrder.city || previewOrder.state || previewOrder.zip || previewOrder.address1) {
              shippingAddress = JSON.stringify({
                address1: previewOrder.address1 || '',
                address2: previewOrder.address2 || '',
                city: previewOrder.city || '',
                state: previewOrder.state || '',
                zip: previewOrder.zip || '',
              });
            }

            const shipByDate = previewOrder.dispatchByDate ? new Date(previewOrder.dispatchByDate) : null;

            const order = await tx.order.create({
              data: {
                orderNumber: previewOrder.channelRef,
                channel: previewOrder.channel,
                channelOrderId: previewOrder.channelOrderId,
                customerName: previewOrder.customerName || 'Channel Customer',
                customerPhone: previewOrder.customerPhone || null,
                shippingAddress,
                orderDate: new Date(previewOrder.orderDate),
                totalAmount,
                paymentMethod: isCOD ? 'COD' : 'Prepaid',
                paymentStatus: isCOD ? 'pending' : 'paid',
                status: 'open',
                ...(shipByDate && !isNaN(shipByDate.getTime()) ? { shipByDate } : {}),
                orderLines: {
                  create: matchedLines.map(line => {
                    const status = line.fulfillmentStatus?.toLowerCase() || '';
                    const isShipped = status === 'shipped' || status === 'delivered' || status === 'manifested';
                    const isDelivered = status === 'delivered';
                    const isCancelled = status === 'cancelled';
                    const lineStatus = isDelivered ? 'delivered' : isShipped ? 'shipped' : isCancelled ? 'cancelled' : 'pending';
                    return {
                      skuId: line.skuId!,
                      qty: Math.max(line.qty, 1),
                      unitPrice: line.unitPrice,
                      lineStatus,
                      channelFulfillmentStatus: line.fulfillmentStatus || null,
                      channelItemId: line.channelItemId,
                      courier: line.courierName || null,
                      awbNumber: line.awbNumber || null,
                      ...(isShipped ? { shippedAt: line.dispatchDate ? new Date(line.dispatchDate) : new Date() } : {}),
                      ...(isDelivered ? { deliveredAt: line.deliveryDate ? new Date(line.deliveryDate) : new Date() } : {}),
                    };
                  }),
                },
              },
            });

            // Link ChannelOrderLines to this Order + OrderLines
            const createdLines = await tx.orderLine.findMany({
              where: { orderId: order.id },
              select: { id: true, channelItemId: true },
            });
            const lineIdMap = new Map(createdLines.filter(l => l.channelItemId).map(l => [l.channelItemId!, l.id]));

            // Batch: set orderId for all lines at once
            await tx.channelOrderLine.updateMany({
              where: {
                channel: previewOrder.channel,
                channelOrderId: previewOrder.channelOrderId,
                channelItemId: { in: matchedLines.map(l => l.channelItemId) },
              },
              data: { orderId: order.id },
            });

            // Parallel: set orderLineId for lines that have a mapping
            const orderLineUpdates = matchedLines
              .filter(l => lineIdMap.has(l.channelItemId))
              .map(l => tx.channelOrderLine.updateMany({
                where: {
                  channel: previewOrder.channel,
                  channelOrderId: previewOrder.channelOrderId,
                  channelItemId: l.channelItemId,
                },
                data: { orderLineId: lineIdMap.get(l.channelItemId)! },
              }));
            await Promise.all(orderLineUpdates);

            // Recompute order status inside transaction
            await recomputeOrderStatus(order.id, tx);

            created.push({ id: order.id, orderNumber: previewOrder.channelRef });

            // Track processing orders for sheet push
            const hasProcessing = matchedLines.some(l => l.fulfillmentStatus?.toLowerCase() === 'processing');
            if (hasProcessing) {
              processingOrders.push({ id: order.id, orderNumber: previewOrder.channelRef });
            }
          } catch (orderError) {
            const msg = orderError instanceof Error ? orderError.message : 'Unknown error';
            chunkErrors.push({ order: previewOrder.channelRef, error: msg });
          }
        }

        return { created: created.length, errors: chunkErrors };
      }, { timeout: 30000 });

      ordersCreated += chunkResult.created;
      errors.push(...chunkResult.errors);
    } catch (chunkError) {
      // Entire chunk rolled back
      const msg = chunkError instanceof Error ? chunkError.message : 'Unknown error';
      for (const o of chunk) {
        errors.push({ order: o.channelRef, error: `Chunk failed: ${msg}` });
      }
    }

    sendProgress({
      type: 'progress',
      completed: ordersCreated + ordersUpdated + errors.length,
      total: totalOrders,
      created: ordersCreated,
      updated: ordersUpdated,
      errors: errors.length,
    });
  }

  // ---- Process UPDATED orders in chunked transactions ----
  for (let i = 0; i < updatedOrders.length; i += CHUNK_SIZE) {
    const chunk = updatedOrders.slice(i, i + CHUNK_SIZE);
    try {
      const chunkResult = await req.prisma.$transaction(async (tx) => {
        let chunkUpdated = 0;
        const chunkErrors: Array<{ order: string; error: string }> = [];

        for (const previewOrder of chunk) {
          try {
            const shipByDate = previewOrder.dispatchByDate ? new Date(previewOrder.dispatchByDate) : null;
            if (shipByDate && !isNaN(shipByDate.getTime())) {
              await tx.order.update({
                where: { id: previewOrder.existingOrderId! },
                data: { shipByDate },
              });
            }

            const existingLines = await tx.orderLine.findMany({
              where: { orderId: previewOrder.existingOrderId! },
              select: { id: true, channelItemId: true, lineStatus: true },
            });
            const existingLineMap = new Map(existingLines.map(l => [l.channelItemId, { id: l.id, lineStatus: l.lineStatus }]));

            // Parallel: update existing order lines
            const existingLineUpdates = previewOrder.lines
              .filter(line => existingLineMap.has(line.channelItemId))
              .map(line => {
                const existing = existingLineMap.get(line.channelItemId)!;
                const status = line.fulfillmentStatus?.toLowerCase() || '';
                const isShipped = status === 'shipped' || status === 'delivered' || status === 'manifested';
                const isDelivered = status === 'delivered';
                const isCancelled = status === 'cancelled';

                let newLineStatus: string | undefined;
                if (existing.lineStatus === 'pending') {
                  if (isDelivered) newLineStatus = 'delivered';
                  else if (isShipped) newLineStatus = 'shipped';
                  else if (isCancelled) newLineStatus = 'cancelled';
                } else if (existing.lineStatus === 'shipped' && isDelivered) {
                  newLineStatus = 'delivered';
                }

                return tx.orderLine.update({
                  where: { id: existing.id },
                  data: {
                    channelFulfillmentStatus: line.fulfillmentStatus || null,
                    ...(line.courierName ? { courier: line.courierName } : {}),
                    ...(line.awbNumber ? { awbNumber: line.awbNumber } : {}),
                    ...(isShipped && line.dispatchDate ? { shippedAt: new Date(line.dispatchDate) } : {}),
                    ...(isDelivered && line.deliveryDate ? { deliveredAt: new Date(line.deliveryDate) } : {}),
                    ...(newLineStatus ? { lineStatus: newLineStatus } : {}),
                  },
                });
              });
            await Promise.all(existingLineUpdates);

            // Batch: link channelOrderLines for existing lines
            const existingChannelItemIds = previewOrder.lines
              .filter(line => existingLineMap.has(line.channelItemId))
              .map(line => line.channelItemId);
            if (existingChannelItemIds.length > 0) {
              // Set orderId for all at once
              await tx.channelOrderLine.updateMany({
                where: {
                  channel: previewOrder.channel,
                  channelOrderId: previewOrder.channelOrderId,
                  channelItemId: { in: existingChannelItemIds },
                },
                data: { orderId: previewOrder.existingOrderId },
              });
              // Set orderLineId in parallel
              const channelLineUpdates = existingChannelItemIds.map(channelItemId => {
                const existing = existingLineMap.get(channelItemId)!;
                return tx.channelOrderLine.updateMany({
                  where: {
                    channel: previewOrder.channel,
                    channelOrderId: previewOrder.channelOrderId,
                    channelItemId,
                  },
                  data: { orderLineId: existing.id },
                });
              });
              await Promise.all(channelLineUpdates);
            }

            // New lines: must create sequentially (need newLine.id), but link in parallel after
            const newLines = previewOrder.lines.filter(line => !existingLineMap.has(line.channelItemId) && line.skuId);
            const newLineResults: Array<{ channelItemId: string; orderLineId: string }> = [];
            for (const line of newLines) {
              const status = line.fulfillmentStatus?.toLowerCase() || '';
              const isShipped = status === 'shipped' || status === 'delivered' || status === 'manifested';
              const isDelivered = status === 'delivered';
              const isCancelled = status === 'cancelled';
              const initialLineStatus = isDelivered ? 'delivered' : isShipped ? 'shipped' : isCancelled ? 'cancelled' : 'pending';

              const newLine = await tx.orderLine.create({
                data: {
                  orderId: previewOrder.existingOrderId!,
                  skuId: line.skuId!,
                  qty: line.qty,
                  unitPrice: line.unitPrice,
                  lineStatus: initialLineStatus,
                  channelFulfillmentStatus: line.fulfillmentStatus || null,
                  channelItemId: line.channelItemId,
                  courier: line.courierName || null,
                  awbNumber: line.awbNumber || null,
                  ...(isShipped ? { shippedAt: line.dispatchDate ? new Date(line.dispatchDate) : new Date() } : {}),
                  ...(isDelivered ? { deliveredAt: line.deliveryDate ? new Date(line.deliveryDate) : new Date() } : {}),
                },
              });
              newLineResults.push({ channelItemId: line.channelItemId, orderLineId: newLine.id });
            }

            // Batch link new channelOrderLines
            if (newLineResults.length > 0) {
              await tx.channelOrderLine.updateMany({
                where: {
                  channel: previewOrder.channel,
                  channelOrderId: previewOrder.channelOrderId,
                  channelItemId: { in: newLineResults.map(r => r.channelItemId) },
                },
                data: { orderId: previewOrder.existingOrderId },
              });
              const newChannelLineUpdates = newLineResults.map(r =>
                tx.channelOrderLine.updateMany({
                  where: {
                    channel: previewOrder.channel,
                    channelOrderId: previewOrder.channelOrderId,
                    channelItemId: r.channelItemId,
                  },
                  data: { orderLineId: r.orderLineId },
                })
              );
              await Promise.all(newChannelLineUpdates);
            }

            await recomputeOrderStatus(previewOrder.existingOrderId!, tx);
            chunkUpdated++;
          } catch (orderError) {
            const msg = orderError instanceof Error ? orderError.message : 'Unknown error';
            chunkErrors.push({ order: previewOrder.channelRef, error: msg });
          }
        }

        return { updated: chunkUpdated, errors: chunkErrors };
      }, { timeout: 30000 });

      ordersUpdated += chunkResult.updated;
      errors.push(...chunkResult.errors);
    } catch (chunkError) {
      const msg = chunkError instanceof Error ? chunkError.message : 'Unknown error';
      for (const o of chunk) {
        errors.push({ order: o.channelRef, error: `Chunk failed: ${msg}` });
      }
    }

    sendProgress({
      type: 'progress',
      completed: ordersCreated + ordersUpdated + errors.length,
      total: totalOrders,
      created: ordersCreated,
      updated: ordersUpdated,
      errors: errors.length,
    });
  }

  // Update batch record with order counts
  await req.prisma.channelImportBatch.update({
    where: { id: importBatch.id },
    data: { ordersCreated, ordersUpdated },
  });

  // Build channel detail updates for sheet (used by deferred task)
  const channelDetailUpdates = selectedOrders.flatMap(order =>
    order.lines
      .filter(l => l.skuMatched && (l.fulfillmentStatus || l.courierName || l.awbNumber))
      .map(l => ({
        orderNumber: order.channelRef,
        skuCode: l.skuCode,
        channelStatus: l.fulfillmentStatus || null,
        courier: l.courierName || null,
        awb: l.awbNumber || null,
      }))
  );

  // ---- Inline: Batched sheet push (single API call) ----
  let sheetResult: { pushed: number; failed: number; errors: string[] } | null = null;
  if (processingOrders.length > 0) {
    sendProgress({ type: 'sheet_sync', status: 'started', total: processingOrders.length });
    try {
      const batchResult = await batchPushOrdersToSheet(processingOrders.map(o => o.id));
      sheetResult = { pushed: batchResult.pushed + batchResult.alreadyOnSheet, failed: batchResult.failed, errors: batchResult.errors };
      sendProgress({
        type: 'sheet_sync',
        status: batchResult.failed > 0 ? 'partial' : 'done',
        pushed: sheetResult.pushed,
        failed: batchResult.failed,
        total: processingOrders.length,
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Sheet sync failed';
      sheetResult = { pushed: 0, failed: processingOrders.length, errors: [msg] };
      sendProgress({ type: 'sheet_sync', status: 'failed', error: msg });
    }
  }

  // ---- Deferred: Sheet detail updates (runs after pushes — FIFO) ----
  if (channelDetailUpdates.length > 0) {
    const updates = [...channelDetailUpdates];
    deferredExecutor.enqueue(async () => {
      try {
        await updateSheetChannelDetails(updates);
      } catch (err) {
        console.error('Deferred sheet detail update failed:', err);
      }
    }, { action: 'channel_sheet_details' });
  }

  // ---- Deferred: Analytics upserts (lowest priority) ----
  if (rawRows.length > 0) {
    const batchId = importBatch.id;
    const rowsCopy = [...rawRows];
    deferredExecutor.enqueue(async () => {
      let upserted = 0;
      let skipped = 0;
      for (const row of rowsCopy) {
        try {
          const oid = row['Order Id']?.trim();
          const iid = row['Item ID']?.trim();
          if (!oid || !iid || !parseDate(row['Order Date(IST)'], row['Order Time(IST)'])) {
            skipped++;
            continue;
          }
          await upsertChannelOrderLine(prisma, row, batchId);
          upserted++;
        } catch (err) {
          console.error('[channels] Failed to upsert channel order line:', err);
          skipped++;
        }
      }
      await prisma.channelImportBatch.update({
        where: { id: batchId },
        data: { rowsImported: upserted, rowsSkipped: skipped },
      });
    }, { action: 'channel_analytics' });
  }

  // Send final complete event
  sendProgress({
    type: 'complete',
    batchId: importBatch.id,
    ordersCreated,
    ordersUpdated,
    errors: errors.slice(0, 20),
    ...(sheetResult ? { sheetSync: sheetResult } : {}),
  });
  res.end();
}
