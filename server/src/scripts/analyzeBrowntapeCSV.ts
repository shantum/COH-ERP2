/**
 * Browntape CSV vs ERP Database Comparison Script
 *
 * Parses a Browntape export CSV and compares against our ERP database.
 * Run with: cd server && npx tsx src/scripts/analyzeBrowntapeCSV.ts
 */

import { parse } from 'csv-parse/sync';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const CSV_PATH = '/Users/shantumgupta/Downloads/btreport_1301229_8634_6979ba3f5de79.csv';

// ERP fields that have CSV equivalents
const ERP_MAPPED_CSV_COLUMNS: Record<string, string> = {
  // Order-level
  'Channel Ref': 'orderNumber',
  'Order Date(IST)': 'orderDate',
  'Channel Name': 'channel',
  'Customer Name': 'customerName',
  'Customer Email': 'customerEmail',
  'Phone': 'customerPhone',
  'Address Line 1': 'shippingAddress.addressLine1',
  'Address Line 2': 'shippingAddress.addressLine2',
  'City': 'shippingAddress.city',
  'State': 'shippingAddress.state',
  'Zip': 'shippingAddress.zip',
  'Country': 'shippingAddress.country',
  'Order Total Amount': 'totalAmount',
  'Order Type': 'paymentMethod',
  'Financial Status': 'paymentStatus',
  'Dispatch By Date': 'shipByDate',
  'Replaced Order Id': 'isExchange (indicator)',
  'ERP Order Reference': 'internalNotes (possible)',
  // OrderLine-level
  'SKU Codes': 'OrderLine.skuCode (via Sku.code)',
  'Fulfillment Status': 'OrderLine.lineStatus',
  'Courier Tracking Number': 'OrderLine.awbNumber',
  'Courier Name': 'OrderLine.courier',
  'Quantity': 'OrderLine.qty',
  'Seller\'s Price': 'OrderLine.unitPrice',
  'Expected Delivery Date': 'OrderLine.expectedDeliveryDate',
  'Dispatch Date': 'OrderLine.shippedAt',
  'Channel Delivery Date': 'OrderLine.deliveredAt',
  'BT Return Date': 'OrderLine.rtoInitiatedAt (approximate)',
  'Channel Return Date': 'OrderLine.rtoReceivedAt (approximate)',
  'Customer GSTIN': 'N/A but related',
};

// Browntape fulfillment status -> ERP lineStatus mapping
const FULFILLMENT_STATUS_MAP: Record<string, string[]> = {
  'processing': ['pending', 'allocated', 'picked', 'packed'],
  'shipped': ['shipped'],
  'delivered': ['delivered'],
  'cancelled': ['cancelled'],
  'returned': ['rto_initiated', 'rto_in_transit', 'rto_delivered'],
};

async function main() {
  // Load env for DATABASE_URL
  const dotenv = await import('dotenv');
  dotenv.config({ path: path.resolve(__dirname, '../../.env') });

  // Use PrismaClient directly from the root-generated client
  const { PrismaClient } = await import('@prisma/client');
  const prisma = new PrismaClient();

  // 1. Parse CSV
  console.log('=== Browntape CSV Analysis ===\n');
  const csvContent = fs.readFileSync(CSV_PATH, 'utf-8');
  const records: Record<string, string>[] = parse(csvContent, {
    columns: true,
    skip_empty_lines: true,
    relax_quotes: true,
    relax_column_count: true,
    trim: true,
  });

  console.log(`Total CSV rows (line items): ${records.length}`);
  const csvColumns = Object.keys(records[0] || {});
  console.log(`CSV columns (${csvColumns.length}): ${csvColumns.join(', ')}\n`);

  // 2. Extract unique Channel Refs
  const channelRefSet = new Set<string>();
  const rowsByChannelRef = new Map<string, typeof records>();

  for (const row of records) {
    const ref = row['Channel Ref']?.trim();
    if (ref) {
      channelRefSet.add(ref);
      if (!rowsByChannelRef.has(ref)) {
        rowsByChannelRef.set(ref, []);
      }
      rowsByChannelRef.get(ref)!.push(row);
    }
  }

  const uniqueChannelRefs = Array.from(channelRefSet);
  console.log(`Unique Channel Refs (orders): ${uniqueChannelRefs.length}\n`);

  // 3. Query database for matching orders
  const matchedOrders = await prisma.order.findMany({
    where: {
      orderNumber: { in: uniqueChannelRefs },
    },
    include: {
      orderLines: {
        include: {
          sku: { select: { skuCode: true } },
        },
      },
    },
  });

  const matchedOrderMap = new Map(matchedOrders.map(o => [o.orderNumber, o]));
  const matchedRefs = new Set(matchedOrders.map(o => o.orderNumber));
  const unmatchedRefs = uniqueChannelRefs.filter(ref => !matchedRefs.has(ref));

  // 5a. Match summary
  console.log('=== MATCH SUMMARY ===');
  console.log(`Matched in ERP:   ${matchedRefs.size} / ${uniqueChannelRefs.length} orders`);
  console.log(`Unmatched:        ${unmatchedRefs.length} / ${uniqueChannelRefs.length} orders\n`);

  // 5b. List unmatched orders
  if (unmatchedRefs.length > 0) {
    console.log('=== UNMATCHED ORDERS (not in ERP) ===');
    console.log(`${'Channel Ref'.padEnd(45)} ${'Channel'.padEnd(20)} ${'Order Date'.padEnd(14)} ${'SKU'.padEnd(15)} Fulfillment`);
    console.log('-'.repeat(120));
    for (const ref of unmatchedRefs) {
      const rows = rowsByChannelRef.get(ref) || [];
      for (const row of rows) {
        console.log(
          `${(row['Channel Ref'] || '').padEnd(45)} ` +
          `${(row['Channel Name'] || '').padEnd(20)} ` +
          `${(row['Order Date(IST)'] || '').padEnd(14)} ` +
          `${(row['SKU Codes'] || '').padEnd(15)} ` +
          `${row['Fulfillment Status'] || ''}`
        );
      }
    }
    console.log();
  }

  // 5c. Fulfillment status comparison for matched orders
  console.log('=== FULFILLMENT STATUS COMPARISON (matched orders) ===\n');
  let mismatchCount = 0;
  let matchCount = 0;
  const mismatches: Array<{
    channelRef: string;
    sku: string;
    csvStatus: string;
    erpStatus: string;
    channel: string;
  }> = [];

  for (const ref of Array.from(matchedRefs)) {
    const erpOrder = matchedOrderMap.get(ref)!;
    const csvRows = rowsByChannelRef.get(ref) || [];

    for (const csvRow of csvRows) {
      const csvSku = csvRow['SKU Codes']?.trim();
      const csvFulfillment = csvRow['Fulfillment Status']?.trim()?.toLowerCase();

      // Find matching ERP line by SKU
      const erpLine = erpOrder.orderLines.find(
        l => l.sku.skuCode === csvSku
      );

      if (!erpLine) {
        mismatches.push({
          channelRef: ref,
          sku: csvSku || 'N/A',
          csvStatus: csvFulfillment || 'N/A',
          erpStatus: 'SKU NOT FOUND IN ERP',
          channel: csvRow['Channel Name'] || '',
        });
        mismatchCount++;
        continue;
      }

      const erpStatus = erpLine.lineStatus.toLowerCase();
      const expectedErpStatuses = FULFILLMENT_STATUS_MAP[csvFulfillment || ''] || [];
      const isMatch = expectedErpStatuses.includes(erpStatus);

      if (isMatch) {
        matchCount++;
      } else {
        mismatchCount++;
        mismatches.push({
          channelRef: ref,
          sku: csvSku || 'N/A',
          csvStatus: csvFulfillment || 'N/A',
          erpStatus: erpLine.lineStatus,
          channel: csvRow['Channel Name'] || '',
        });
      }
    }
  }

  console.log(`Status matches:    ${matchCount}`);
  console.log(`Status mismatches: ${mismatchCount}\n`);

  if (mismatches.length > 0) {
    console.log('--- Mismatched Lines ---');
    console.log(
      `${'Channel Ref'.padEnd(45)} ${'Channel'.padEnd(18)} ${'SKU'.padEnd(15)} ${'CSV Status'.padEnd(15)} ERP Status`
    );
    console.log('-'.repeat(120));
    for (const m of mismatches) {
      console.log(
        `${m.channelRef.padEnd(45)} ${m.channel.padEnd(18)} ${m.sku.padEnd(15)} ${m.csvStatus.padEnd(15)} ${m.erpStatus}`
      );
    }
    console.log();
  }

  // 5d. CSV columns with NO equivalent in ERP
  const mappedColumns = new Set(Object.keys(ERP_MAPPED_CSV_COLUMNS));
  const unmappedColumns = csvColumns.filter(col => !mappedColumns.has(col));

  console.log('=== CSV COLUMNS WITH NO ERP EQUIVALENT ===');
  console.log(`(${unmappedColumns.length} out of ${csvColumns.length} columns have no direct ERP field)\n`);
  for (const col of unmappedColumns) {
    // Show a sample value
    const sampleVal = records.find(r => r[col]?.trim())?.[ col]?.trim() || '(empty)';
    const truncated = sampleVal.length > 60 ? sampleVal.slice(0, 60) + '...' : sampleVal;
    console.log(`  - ${col.padEnd(35)} Sample: ${truncated}`);
  }

  console.log('\n=== CSV COLUMNS MAPPED TO ERP FIELDS ===');
  for (const [csvCol, erpField] of Object.entries(ERP_MAPPED_CSV_COLUMNS)) {
    console.log(`  ${csvCol.padEnd(35)} -> ${erpField}`);
  }

  await prisma.$disconnect();
  console.log('\nDone.');
}

main().catch(err => {
  console.error('Error:', err);
  process.exit(1);
});
