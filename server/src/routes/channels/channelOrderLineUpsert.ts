/**
 * Upsert logic for ChannelOrderLine (analytics table).
 */

import type { BtReportRow } from './types.js';
import {
  normalizeChannel,
  parseDate,
  parseIntSafe,
  parsePriceToPaise,
  parseFloatSafe,
} from './csvParser.js';

/**
 * Upsert a single row into ChannelOrderLine (analytics table).
 * Used by both the analytics-only /import endpoint and the deferred analytics
 * upserts from /execute-import.
 */
export async function upsertChannelOrderLine(
  prismaClient: import('@prisma/client').PrismaClient,
  row: BtReportRow,
  importBatchId: string,
): Promise<void> {
  const channelOrderId = row['Order Id']!.trim();
  const channelItemId = row['Item ID']!.trim();
  const channel = normalizeChannel(row['Channel Name']);

  const lineData = {
    channel,
    channelOrderId,
    channelRef: row['Channel Ref']?.trim() || null,
    channelItemId,
    orderDate: parseDate(row['Order Date(IST)'], row['Order Time(IST)'])!,
    orderType: row['Order Type']?.trim() || 'Unknown',
    financialStatus: row['Financial Status']?.trim() || null,
    fulfillmentStatus: row['Fulfillment Status']?.trim() || null,
    skuCode: row['SKU Codes']?.trim() || 'UNKNOWN',
    channelSkuCode: row['Channel SKU Code']?.trim() || null,
    skuTitle: row['SKU Titles']?.trim() || null,
    quantity: parseIntSafe(row['Quantity'], 1),
    mrp: parsePriceToPaise(row['MRP']),
    sellerPrice: parsePriceToPaise(row["Seller's Price"]),
    buyerPrice: parsePriceToPaise(row["Buyer's Price"]),
    itemTotal: parsePriceToPaise(row['Item Total']),
    itemDiscount: parsePriceToPaise(row['Item Total Discount Value']),
    orderTotal: parsePriceToPaise(row['Order Total Amount']),
    taxPercent: parseFloatSafe(row['TAX %']),
    taxType: row['TAX type']?.trim() || null,
    taxAmount: parsePriceToPaise(row['TAX Amount']),
    courierName: row['Courier Name']?.trim() || null,
    trackingNumber: row['Courier Tracking Number']?.trim() || null,
    dispatchByDate: parseDate(row['Dispatch By Date']),
    dispatchDate: parseDate(row['Dispatch Date']),
    manifestedDate: parseDate(row['Manifested Date']),
    deliveryDate: parseDate(row['Channel Delivery Date']),
    returnDate: parseDate(row['BT Return Date']),
    channelReturnDate: parseDate(row['Channel Return Date']),
    customerName: row['Customer Name']?.trim() || null,
    customerCity: row['City']?.trim() || null,
    customerState: row['State']?.trim() || null,
    customerZip: row['Zip']?.trim() || null,
    invoiceNumber: row['Invoice Number']?.trim() || null,
    batchNo: row['Batch No.']?.trim() || null,
    hsnCode: row['HSN Code']?.trim() || null,
    importBatchId,
  };

  await prismaClient.channelOrderLine.upsert({
    where: {
      channel_channelOrderId_channelItemId: { channel, channelOrderId, channelItemId },
    },
    create: lineData,
    update: { ...lineData, importedAt: new Date() },
  });
}
