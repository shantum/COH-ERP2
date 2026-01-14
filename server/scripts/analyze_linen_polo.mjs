import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  // Get Shopify product cache for "Linen Polo" products
  const shopifyCache = await prisma.shopifyProductCache.findMany({
    where: {
      title: { contains: 'Linen Polo' }
    }
  });
  
  console.log('=== Shopify Product Cache for Linen Polo ===');
  console.log('Found:', shopifyCache.length, 'entries');
  
  for (const cache of shopifyCache) {
    const raw = JSON.parse(cache.rawData);
    console.log('\n--- Shopify Product ID:', cache.id, '---');
    console.log('Title:', raw.title);
    console.log('Handle:', raw.handle);
    console.log('Product Type:', raw.product_type);
    console.log('Tags:', raw.tags);
    console.log('Options:', raw.options?.map(o => ({name: o.name, values: o.values})));
    console.log('Variant count:', raw.variants?.length);
    console.log('Variants (Color/Size):', raw.variants?.map(v => ({ 
      id: v.id,
      sku: v.sku, 
      option1: v.option1, 
      option2: v.option2,
      price: v.price 
    })));
  }
  
  // Look at related products/variations/skus
  console.log('\n\n=== ERP Product Structure ===');
  const products = await prisma.product.findMany({
    where: { name: 'The Linen Polo' },
    include: {
      variations: {
        include: {
          skus: true
        }
      }
    }
  });
  
  for (const p of products) {
    console.log('\n--- ERP Product:', p.id, '---');
    console.log('Name:', p.name);
    console.log('Gender:', p.gender);
    console.log('Shopify Product ID:', p.shopifyProductId);
    console.log('Handle:', p.shopifyHandle);
    console.log('Variations:');
    for (const v of p.variations) {
      console.log('  -', v.colorName, '| SKUs:', v.skus.map(s => `${s.skuCode} (${s.size})`).join(', '));
    }
  }
}

main().finally(() => prisma.$disconnect());
