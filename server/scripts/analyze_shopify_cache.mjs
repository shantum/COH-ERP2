import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  // Get Shopify product cache for "Linen Polo" products
  const shopifyCache = await prisma.shopifyProductCache.findMany({
    where: {
      OR: [
        { id: '8544447824069' },
        { id: '8543119605957' }
      ]
    }
  });
  
  console.log('=== Shopify Product Cache for Linen Polo ===');
  for (const cache of shopifyCache) {
    const raw = JSON.parse(cache.rawData);
    console.log('\n--- Shopify Product ID:', cache.id, '---');
    console.log('Title:', raw.title);
    console.log('Handle:', raw.handle);
    console.log('Product Type:', raw.product_type);
    console.log('Vendor:', raw.vendor);
    console.log('Tags:', raw.tags);
    console.log('Options:', JSON.stringify(raw.options, null, 2));
    console.log('Variant count:', raw.variants?.length);
    if (raw.variants && raw.variants.length > 0) {
      console.log('Sample variant:', JSON.stringify(raw.variants[0], null, 2));
    }
  }
  
  // Look for a common pattern in Shopify handles
  const allProducts = await prisma.shopifyProductCache.findMany({
    orderBy: { title: 'asc' }
  });
  
  // Group by title
  const byTitle = {};
  for (const p of allProducts) {
    const raw = JSON.parse(p.rawData);
    if (!byTitle[raw.title]) byTitle[raw.title] = [];
    byTitle[raw.title].push({ id: p.id, handle: raw.handle, tags: raw.tags, product_type: raw.product_type });
  }
  
  const duplicateTitles = Object.entries(byTitle).filter(([, v]) => v.length > 1);
  console.log('\n=== Shopify Products with duplicate titles ===');
  console.log(JSON.stringify(duplicateTitles, null, 2));
}

main().finally(() => prisma.$disconnect());
