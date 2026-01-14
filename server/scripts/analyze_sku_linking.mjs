import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  // Get all SKU codes that exist in the database
  const existingSkus = await prisma.sku.findMany({
    select: {
      skuCode: true,
      shopifyVariantId: true,
      variation: {
        select: {
          id: true,
          colorName: true,
          product: {
            select: {
              id: true,
              name: true,
              shopifyProductId: true
            }
          }
        }
      }
    }
  });
  
  console.log('=== SKU Uniqueness Analysis ===');
  console.log('Total SKUs in database:', existingSkus.length);
  
  // Check if any SKU codes are duplicated
  const skuMap = {};
  for (const sku of existingSkus) {
    if (!skuMap[sku.skuCode]) skuMap[sku.skuCode] = [];
    skuMap[sku.skuCode].push(sku);
  }
  
  const duplicates = Object.entries(skuMap).filter(([, v]) => v.length > 1);
  console.log('Duplicate SKU codes:', duplicates.length);
  if (duplicates.length > 0) {
    console.log('Duplicates:', JSON.stringify(duplicates.slice(0, 5), null, 2));
  }
  
  // Get Linen Polo Shopify products and their SKUs
  console.log('\n=== Linen Polo SKU Analysis ===');
  const linenPoloCache = await prisma.shopifyProductCache.findMany({
    where: { title: { contains: 'Linen Polo' } }
  });
  
  for (const cache of linenPoloCache) {
    const raw = JSON.parse(cache.rawData);
    console.log(`\n--- Shopify Product: ${cache.id} (${raw.handle}) ---`);
    
    for (const variant of raw.variants || []) {
      const skuInDb = existingSkus.find(s => s.skuCode === variant.sku);
      if (skuInDb) {
        console.log(`  SKU ${variant.sku} (${variant.option1}/${variant.option2})`);
        console.log(`    → Exists in ERP Product: "${skuInDb.variation.product.name}" (${skuInDb.variation.product.id})`);
        console.log(`    → ERP Product shopifyProductId: ${skuInDb.variation.product.shopifyProductId}`);
        console.log(`    → Match: ${skuInDb.variation.product.shopifyProductId === cache.id ? '✓' : '✗ MISMATCH'}`);
      } else {
        console.log(`  SKU ${variant.sku} - NOT IN DATABASE`);
      }
    }
  }
  
  // Check: can we trace ALL Linen Polo SKUs back to one Product?
  console.log('\n=== Product Consolidation Test ===');
  const allLinenPoloSkus = [];
  for (const cache of linenPoloCache) {
    const raw = JSON.parse(cache.rawData);
    for (const variant of raw.variants || []) {
      allLinenPoloSkus.push(variant.sku);
    }
  }
  
  const productsLinked = new Set();
  for (const skuCode of allLinenPoloSkus) {
    const found = existingSkus.find(s => s.skuCode === skuCode);
    if (found) {
      productsLinked.add(found.variation.product.id);
    }
  }
  console.log(`Linen Polo has ${allLinenPoloSkus.length} SKUs across ${linenPoloCache.length} Shopify products`);
  console.log(`These SKUs trace back to ${productsLinked.size} ERP Product(s)`);
  console.log('Product IDs:', [...productsLinked]);
}

main().finally(() => prisma.$disconnect());
