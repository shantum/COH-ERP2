import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  // Check products that had multiple Shopify IDs merged
  const productsWithMultipleIds = await prisma.product.findMany({
    where: {
      shopifyProductIds: { isEmpty: false }
    },
    include: {
      variations: true
    }
  });
  
  console.log('=== Products with multiple linked Shopify IDs ===\n');
  
  for (const p of productsWithMultipleIds) {
    if (p.shopifyProductIds.length > 1) {
      console.log(`"${p.name}" (gender: ${p.gender})`);
      console.log(`  Shopify IDs: ${p.shopifyProductIds.join(', ')}`);
      console.log(`  Variations: ${p.variations.length}`);
      
      // Check the tags/gender of each linked Shopify product
      for (const sid of p.shopifyProductIds) {
        const cache = await prisma.shopifyProductCache.findUnique({ where: { id: sid } });
        if (cache) {
          const raw = JSON.parse(cache.rawData);
          const relatedTag = (raw.tags || '').includes('_related_women') ? 'women' : 
                            (raw.tags || '').includes('_related_men') ? 'men' : 'unisex';
          console.log(`    ${sid}: ${raw.handle} → tags suggest: ${relatedTag}`);
        }
      }
      console.log('');
    }
  }
}

main().finally(() => prisma.$disconnect());
