import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  // Get all Shopify product cache for "Linen Polo" products
  const shopifyCache = await prisma.shopifyProductCache.findMany({
    where: { title: { contains: 'Linen Polo' } }
  });
  
  console.log('=== Looking for Related Product Pattern ===\n');
  
  for (const cache of shopifyCache) {
    const raw = JSON.parse(cache.rawData);
    console.log('Product ID:', cache.id);
    console.log('Handle:', raw.handle);
    console.log('Tags:', raw.tags);
    
    // Check for metafields that might link products
    console.log('Metafields:', raw.metafields);
    console.log('Template Suffix:', raw.template_suffix);
    console.log('Published Scope:', raw.published_scope);
    console.log('---');
  }

  // Let's also look at the _related_ tag pattern
  console.log('\n=== Analyzing _related_ tags pattern ===');
  const allCache = await prisma.shopifyProductCache.findMany();
  const tagPatterns = {};
  
  for (const cache of allCache) {
    const raw = JSON.parse(cache.rawData);
    const tags = (raw.tags || '').split(', ');
    for (const tag of tags) {
      if (tag.startsWith('_related_')) {
        if (!tagPatterns[tag]) tagPatterns[tag] = [];
        tagPatterns[tag].push({ id: cache.id, title: raw.title, handle: raw.handle });
      }
    }
  }
  
  console.log('_related_ tags found:');
  for (const [tag, products] of Object.entries(tagPatterns)) {
    console.log(`  ${tag}: ${products.length} products`);
  }
  
  // Look specifically at "Linen Polo" tag
  console.log('\n=== Products with "Linen Polo" tag ===');
  for (const cache of allCache) {
    const raw = JSON.parse(cache.rawData);
    const tags = (raw.tags || '').split(', ');
    if (tags.includes('Linen Polo')) {
      console.log(`  ${raw.title} - ${raw.handle}`);
    }
  }
}

main().finally(() => prisma.$disconnect());
