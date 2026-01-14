const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient();

async function main() {
  // Find all products
  const products = await prisma.product.findMany({
    select: { id: true, name: true, gender: true, shopifyProductId: true, shopifyHandle: true, createdAt: true }
  });
  
  // Group by name
  const byName = {};
  for (const p of products) {
    if (!byName[p.name]) byName[p.name] = [];
    byName[p.name].push(p);
  }
  
  // Filter to duplicates
  const duplicates = Object.entries(byName).filter(([, v]) => v.length > 1);
  
  console.log('=== Products with duplicate names ===');
  console.log(JSON.stringify(duplicates, null, 2));
  
  // Check Linen Polo specifically
  console.log('\n=== Products containing "Linen Polo" ===');
  const linePolo = products.filter(p => p.name.toLowerCase().includes('linen polo'));
  console.log(JSON.stringify(linePolo, null, 2));
  
  // Count totals
  console.log('\n=== Summary ===');
  console.log('Total products: ' + products.length);
  console.log('Unique names: ' + Object.keys(byName).length);
  console.log('Names with duplicates: ' + duplicates.length);
}

main().finally(() => prisma.$disconnect());
