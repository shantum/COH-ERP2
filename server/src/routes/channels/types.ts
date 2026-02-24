/**
 * Type definitions for channel import routes.
 */

/**
 * CSV column mapping from BT report to ChannelOrderLine
 */
export interface BtReportRow {
  'Order Id'?: string;
  'Channel Name'?: string;
  'Channel Ref'?: string;
  'Item ID'?: string;
  'Order Date(IST)'?: string;
  'Order Time(IST)'?: string;
  'Order Type'?: string;
  'Financial Status'?: string;
  'Fulfillment Status'?: string;
  'SKU Codes'?: string;
  'Channel SKU Code'?: string;
  'SKU Titles'?: string;
  'Quantity'?: string;
  'MRP'?: string;
  "Seller's Price"?: string;
  "Buyer's Price"?: string;
  'Item Total'?: string;
  'Item Total Discount Value'?: string;
  'Order Total Amount'?: string;
  'TAX %'?: string;
  'TAX type'?: string;
  'TAX Amount'?: string;
  'Courier Name'?: string;
  'Courier Tracking Number'?: string;
  'Dispatch By Date'?: string;
  'Dispatch Date'?: string;
  'Manifested Date'?: string;
  'Channel Delivery Date'?: string;
  'BT Return Date'?: string;
  'Channel Return Date'?: string;
  'Customer Name'?: string;
  'Phone'?: string;
  'Address Line 1'?: string;
  'Address Line 2'?: string;
  'City'?: string;
  'State'?: string;
  'Zip'?: string;
  'Invoice Number'?: string;
  'Batch No.'?: string;
  'HSN Code'?: string;
}

/**
 * Import results structure
 */
export interface ChannelImportResults {
  created: number;
  updated: number;
  skipped: number;
  errors: Array<{ row: number; error: string }>;
}

export interface PreviewLine {
  channelItemId: string;
  skuCode: string;
  skuId: string | null;
  skuMatched: boolean;
  skuTitle: string | null;
  qty: number;
  unitPrice: number;
  fulfillmentStatus: string;
  previousStatus?: string;
  courierName: string | null;
  awbNumber: string | null;
  dispatchDate: string | null;
  manifestedDate: string | null;
  deliveryDate: string | null;
}

export interface PreviewOrder {
  channelOrderId: string;
  channelRef: string;
  channel: string;
  importStatus: 'new' | 'existing_unchanged' | 'existing_updated';
  existingOrderId?: string;
  orderDate: string;
  orderType: string;
  customerName: string | null;
  customerPhone: string | null;
  address1: string | null;
  address2: string | null;
  city: string | null;
  state: string | null;
  zip: string | null;
  dispatchByDate: string | null;
  lines: PreviewLine[];
  totalAmount: number;
}

export interface PreviewResponse {
  orders: PreviewOrder[];
  summary: {
    totalOrders: number;
    newOrders: number;
    existingUnchanged: number;
    existingUpdated: number;
    unmatchedSkus: string[];
  };
  cacheKey: string;
}
