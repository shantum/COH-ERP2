import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  console.log('=== Applying SKU-Driven Sync Schema Changes ===\n');
  
  // Check if columns already exist
  const productColumns = await prisma.$queryRaw`
    SELECT column_name FROM information_schema.columns 
    WHERE table_name = 'Product' AND column_name = 'shopifyProductIds'
  `;
  
  if (productColumns.length === 0) {
    console.log('Adding shopifyProductIds column to Product...');
    await prisma.$executeRaw`
      ALTER TABLE "Product" 
      ADD COLUMN IF NOT EXISTS "shopifyProductIds" TEXT[] DEFAULT '{}'
    `;
    console.log('✓ Added shopifyProductIds');
  } else {
    console.log('✓ shopifyProductIds already exists');
  }
  
  // Add variation columns
  const variationColumns = await prisma.$queryRaw`
    SELECT column_name FROM information_schema.columns 
    WHERE table_name = 'Variation' AND column_name = 'shopifySourceProductId'
  `;
  
  if (variationColumns.length === 0) {
    console.log('Adding shopifySourceProductId column to Variation...');
    await prisma.$executeRaw`
      ALTER TABLE "Variation" 
      ADD COLUMN IF NOT EXISTS "shopifySourceProductId" TEXT
    `;
    console.log('✓ Added shopifySourceProductId');
  } else {
    console.log('✓ shopifySourceProductId already exists');
  }
  
  const handleCol = await prisma.$queryRaw`
    SELECT column_name FROM information_schema.columns 
    WHERE table_name = 'Variation' AND column_name = 'shopifySourceHandle'
  `;
  
  if (handleCol.length === 0) {
    console.log('Adding shopifySourceHandle column to Variation...');
    await prisma.$executeRaw`
      ALTER TABLE "Variation" 
      ADD COLUMN IF NOT EXISTS "shopifySourceHandle" TEXT
    `;
    console.log('✓ Added shopifySourceHandle');
  } else {
    console.log('✓ shopifySourceHandle already exists');
  }
  
  // Add indexes
  console.log('\nAdding indexes...');
  
  try {
    await prisma.$executeRaw`
      CREATE INDEX IF NOT EXISTS "Product_name_idx" ON "Product"("name")
    `;
    console.log('✓ Product_name_idx');
  } catch (e) {
    console.log('  Product_name_idx already exists or error:', e.message);
  }
  
  try {
    await prisma.$executeRaw`
      CREATE INDEX IF NOT EXISTS "Variation_shopifySourceProductId_idx" ON "Variation"("shopifySourceProductId")
    `;
    console.log('✓ Variation_shopifySourceProductId_idx');
  } catch (e) {
    console.log('  Variation_shopifySourceProductId_idx already exists or error:', e.message);
  }
  
  // Populate shopifyProductIds from existing shopifyProductId
  console.log('\nPopulating shopifyProductIds from existing data...');
  const result = await prisma.$executeRaw`
    UPDATE "Product" 
    SET "shopifyProductIds" = ARRAY["shopifyProductId"]
    WHERE "shopifyProductId" IS NOT NULL 
      AND (array_length("shopifyProductIds", 1) IS NULL OR array_length("shopifyProductIds", 1) = 0)
  `;
  console.log(`✓ Updated ${result} products with shopifyProductIds`);
  
  console.log('\n=== Schema update complete ===');
}

main()
  .catch(e => console.error('Error:', e))
  .finally(() => prisma.$disconnect());
