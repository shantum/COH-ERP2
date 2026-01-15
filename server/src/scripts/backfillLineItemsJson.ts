/**
 * One-time migration script to backfill lineItemsJson and related fields
 * from existing rawData in ShopifyOrderCache
 *
 * Run with: npx tsx src/scripts/backfillLineItemsJson.ts
 */

import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

interface ShopifyLineItem {
  id: number | string;
  sku?: string;
  title?: string;
  variant_title?: string;
  price?: string;
  quantity?: number;
  discount_allocations?: Array<{ amount: string }>;
}

interface ShopifyShippingLine {
  title?: string;
  price?: string;
}

interface ShopifyTaxLine {
  title?: string;
  price?: string;
  rate?: number;
}

interface ShopifyNoteAttribute {
  name?: string;
  value?: string;
}

interface ShopifyBillingAddress {
  address1?: string;
  address2?: string;
  country?: string;
  country_code?: string;
}

interface ShopifyOrderData {
  line_items?: ShopifyLineItem[];
  shipping_lines?: ShopifyShippingLine[];
  tax_lines?: ShopifyTaxLine[];
  note_attributes?: ShopifyNoteAttribute[];
  billing_address?: ShopifyBillingAddress;
}

async function backfillLineItemsJson() {
  const batchSize = 500;
  let totalProcessed = 0;
  let totalUpdated = 0;
  let totalErrors = 0;

  console.log('Starting backfill of lineItemsJson and related fields...\n');

  // Get total count first
  const totalCount = await prisma.shopifyOrderCache.count({
    where: {
      lineItemsJson: null,
      rawData: { not: '' },
    },
  });

  console.log(`Found ${totalCount} records to process\n`);

  if (totalCount === 0) {
    console.log('No records need backfilling. All done!');
    return;
  }

  while (true) {
    // Fetch batch of records that need backfilling
    const cacheEntries = await prisma.shopifyOrderCache.findMany({
      where: {
        lineItemsJson: null,
        rawData: { not: '' },
      },
      select: { id: true, rawData: true, orderNumber: true },
      take: batchSize,
    });

    if (cacheEntries.length === 0) {
      break;
    }

    // Process in parallel batches of 10
    const parallelBatchSize = 10;
    for (let i = 0; i < cacheEntries.length; i += parallelBatchSize) {
      const batch = cacheEntries.slice(i, i + parallelBatchSize);

      await Promise.all(batch.map(async (entry) => {
        try {
          const shopifyOrder = JSON.parse(entry.rawData) as ShopifyOrderData;

          // Extract line items JSON
          const lineItemsJson = JSON.stringify(
            (shopifyOrder.line_items || []).map(item => ({
              id: item.id,
              sku: item.sku || null,
              title: item.title || null,
              variant_title: item.variant_title || null,
              price: item.price || null,
              quantity: item.quantity || 0,
              discount_allocations: item.discount_allocations || [],
            }))
          );

          // Extract shipping lines JSON
          const shippingLinesJson = JSON.stringify(
            (shopifyOrder.shipping_lines || []).map(s => ({
              title: s.title || null,
              price: s.price || null,
            }))
          );

          // Extract tax lines JSON
          const taxLinesJson = JSON.stringify(
            (shopifyOrder.tax_lines || []).map(t => ({
              title: t.title || null,
              price: t.price || null,
              rate: t.rate || null,
            }))
          );

          // Extract note attributes JSON
          const noteAttributesJson = JSON.stringify(shopifyOrder.note_attributes || []);

          // Extract billing address
          const billing = shopifyOrder.billing_address;

          await prisma.shopifyOrderCache.update({
            where: { id: entry.id },
            data: {
              lineItemsJson,
              shippingLinesJson,
              taxLinesJson,
              noteAttributesJson,
              billingAddress1: billing?.address1 || null,
              billingAddress2: billing?.address2 || null,
              billingCountry: billing?.country || null,
              billingCountryCode: billing?.country_code || null,
            },
          });
          totalUpdated++;
        } catch (error) {
          totalErrors++;
          console.error(`Error processing ${entry.orderNumber || entry.id}: ${(error as Error).message}`);
        }
      }));
    }

    totalProcessed += cacheEntries.length;
    const progress = Math.round((totalProcessed / totalCount) * 100);
    console.log(`Progress: ${totalProcessed}/${totalCount} (${progress}%) - Updated: ${totalUpdated}, Errors: ${totalErrors}`);
  }

  console.log('\n========================================');
  console.log('Backfill complete!');
  console.log(`Total processed: ${totalProcessed}`);
  console.log(`Successfully updated: ${totalUpdated}`);
  console.log(`Errors: ${totalErrors}`);
  console.log('========================================');
}

backfillLineItemsJson()
  .catch((error) => {
    console.error('Fatal error:', error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
