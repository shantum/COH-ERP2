import 'dotenv/config';
import fs from 'fs';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

// Normalize product name by removing prefixes
function normalizeName(name: string): string {
  return name
    .replace(/^(Men's|Women's|The)\s+/i, '')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

async function analyzeMissingSKUs() {
  // Read missing SKUs CSV
  const csvPath = '/Users/shantumgupta/Downloads/missing_skus_from_db.csv';
  const csvContent = fs.readFileSync(csvPath, 'utf-8');
  const lines = csvContent.split('\n').slice(1);

  // Parse missing SKUs
  const missingSKUs: Array<{ sku: string; productName: string; warehouseQty: number }> = [];

  for (const line of lines) {
    if (!line.trim()) continue;
    const match = line.match(/^(\d+),"(.*)","?(\d+)"?$/);
    if (match) {
      missingSKUs.push({
        sku: match[1],
        productName: match[2],
        warehouseQty: parseInt(match[3], 10) || 0,
      });
    }
  }

  // Get all products from database with their variations
  const dbProducts = await prisma.product.findMany({
    select: {
      id: true,
      name: true,
      variations: {
        select: {
          id: true,
          colorName: true,
          skus: {
            select: {
              skuCode: true,
              size: true,
            },
          },
        },
      },
    },
  });

  // Build a map of NORMALIZED product names to their existing sizes
  const productSizeMap: Map<string, {
    originalName: string;
    colors: Map<string, { normalizedColor: string; sizes: Set<string> }>;
  }> = new Map();

  for (const product of dbProducts) {
    const normalizedProductName = normalizeName(product.name);
    const colorMap = new Map<string, { normalizedColor: string; sizes: Set<string> }>();

    for (const variation of product.variations) {
      const normalizedColor = variation.colorName.toLowerCase().trim();
      const sizes = new Set(variation.skus.map(s => s.size));
      colorMap.set(normalizedColor, { normalizedColor, sizes });
    }

    productSizeMap.set(normalizedProductName, {
      originalName: product.name,
      colors: colorMap,
    });
  }

  // Analyze missing SKUs
  const results = {
    existingProductMissingSize: [] as Array<{ sku: string; csvProduct: string; dbProduct: string; size: string; color: string; existingSizes: string; warehouseQty: number }>,
    existingProductMissingColor: [] as Array<{ sku: string; csvProduct: string; dbProduct: string; size: string; color: string; existingColors: string; warehouseQty: number }>,
    completelyMissingProduct: [] as Array<{ sku: string; productName: string; warehouseQty: number }>,
    deletedProducts: [] as Array<{ sku: string; productName: string; warehouseQty: number }>,
    emptyNames: [] as Array<{ sku: string; warehouseQty: number }>,
  };

  for (const item of missingSKUs) {
    // Skip empty product names
    if (!item.productName.trim()) {
      results.emptyNames.push({ sku: item.sku, warehouseQty: item.warehouseQty });
      continue;
    }

    // Skip deleted products
    if (item.productName.toLowerCase().includes('delete')) {
      results.deletedProducts.push(item);
      continue;
    }

    // Parse product name: "Women's Vintage V - XS - Red"
    const parts = item.productName.split(' - ');
    if (parts.length < 3) {
      results.completelyMissingProduct.push(item);
      continue;
    }

    const baseProductName = parts[0].trim();
    const normalizedBaseProduct = normalizeName(baseProductName);
    const size = parts[1].trim();
    const color = parts.slice(2).join(' - ').trim();
    const normalizedColor = color.toLowerCase().trim();

    // Check if normalized product exists
    const existingProduct = productSizeMap.get(normalizedBaseProduct);

    if (!existingProduct) {
      results.completelyMissingProduct.push(item);
    } else {
      // Product exists, check if color exists (normalized)
      const existingColorEntry = existingProduct.colors.get(normalizedColor);

      if (existingColorEntry) {
        // Color exists, check if size exists
        if (existingColorEntry.sizes.has(size)) {
          // This shouldn't happen - SKU should exist
          console.log(`⚠️  Unexpected: SKU ${item.sku} should exist - ${item.productName}`);
        } else {
          // Size is missing
          results.existingProductMissingSize.push({
            sku: item.sku,
            csvProduct: baseProductName,
            dbProduct: existingProduct.originalName,
            size,
            color,
            existingSizes: Array.from(existingColorEntry.sizes).join(', '),
            warehouseQty: item.warehouseQty,
          });
        }
      } else {
        // Product exists but color doesn't
        results.existingProductMissingColor.push({
          sku: item.sku,
          csvProduct: baseProductName,
          dbProduct: existingProduct.originalName,
          size,
          color,
          existingColors: Array.from(existingProduct.colors.keys()).join(', '),
          warehouseQty: item.warehouseQty,
        });
      }
    }
  }

  // Print results
  console.log('\n📊 Missing SKU Analysis (with normalized names)\n');
  console.log('=' .repeat(70));

  console.log(`\n✅ EXISTING PRODUCTS - MISSING SIZES: ${results.existingProductMissingSize.length}`);
  console.log('   (Product and color exist, just need to add the size)\n');

  // Group by product + color
  const bySizeProduct = new Map<string, typeof results.existingProductMissingSize>();
  for (const item of results.existingProductMissingSize) {
    const key = `${item.dbProduct} - ${item.color}`;
    if (!bySizeProduct.has(key)) bySizeProduct.set(key, []);
    bySizeProduct.get(key)!.push(item);
  }

  for (const [key, items] of Array.from(bySizeProduct.entries())) {
    const sizes = items.map(i => i.size).join(', ');
    const totalQty = items.reduce((sum, i) => sum + i.warehouseQty, 0);
    const existingSizes = items[0].existingSizes;
    console.log(`   📦 ${key}`);
    console.log(`      Missing sizes: ${sizes}`);
    console.log(`      Existing sizes: ${existingSizes}`);
    if (totalQty > 0) console.log(`      Warehouse qty: ${totalQty}`);
    console.log('');
  }

  console.log(`\n🎨 EXISTING PRODUCTS - MISSING COLORS: ${results.existingProductMissingColor.length}`);
  console.log('   (Product exists but this color variation doesn\'t)\n');

  const byColorProduct = new Map<string, typeof results.existingProductMissingColor>();
  for (const item of results.existingProductMissingColor) {
    const key = `${item.dbProduct} - ${item.color}`;
    if (!byColorProduct.has(key)) byColorProduct.set(key, []);
    byColorProduct.get(key)!.push(item);
  }

  for (const [key, items] of Array.from(byColorProduct.entries()).slice(0, 30)) {
    const sizes = items.map(i => i.size).join(', ');
    const totalQty = items.reduce((sum, i) => sum + i.warehouseQty, 0);
    console.log(`   📦 ${items[0].dbProduct}`);
    console.log(`      Missing color: ${items[0].color} (sizes: ${sizes})`);
    console.log(`      Existing colors: ${items[0].existingColors}`);
    if (totalQty > 0) console.log(`      Warehouse qty: ${totalQty}`);
    console.log('');
  }
  if (byColorProduct.size > 30) {
    console.log(`   ... and ${byColorProduct.size - 30} more`);
  }

  console.log(`\n❌ COMPLETELY MISSING PRODUCTS: ${results.completelyMissingProduct.length}`);
  console.log('   (Product doesn\'t exist at all in the system)\n');

  const byMissingProduct = new Map<string, typeof results.completelyMissingProduct>();
  for (const item of results.completelyMissingProduct) {
    const parts = item.productName.split(' - ');
    const baseName = parts[0] || 'Unknown';
    if (!byMissingProduct.has(baseName)) byMissingProduct.set(baseName, []);
    byMissingProduct.get(baseName)!.push(item);
  }

  for (const [productName, items] of Array.from(byMissingProduct.entries()).slice(0, 40)) {
    const totalQty = items.reduce((sum, i) => sum + i.warehouseQty, 0);
    console.log(`   📦 ${productName} (${items.length} SKUs)${totalQty > 0 ? ` - Warehouse qty: ${totalQty}` : ''}`);
  }
  if (byMissingProduct.size > 40) {
    console.log(`   ... and ${byMissingProduct.size - 40} more products`);
  }

  console.log(`\n🗑️  DELETED PRODUCTS: ${results.deletedProducts.length}`);
  console.log(`📭 EMPTY NAMES: ${results.emptyNames.length}`);

  // Summary with warehouse quantities
  const missingSizeWithStock = results.existingProductMissingSize.filter(i => i.warehouseQty > 0);
  const missingColorWithStock = results.existingProductMissingColor.filter(i => i.warehouseQty > 0);
  const missingProductWithStock = results.completelyMissingProduct.filter(i => i.warehouseQty > 0);

  console.log('\n' + '=' .repeat(70));
  console.log('\n📈 SUMMARY - Items WITH warehouse stock:\n');
  console.log(`   Missing sizes (easy fix):     ${missingSizeWithStock.length} SKUs`);
  console.log(`   Missing colors:               ${missingColorWithStock.length} SKUs`);
  console.log(`   Missing products:             ${missingProductWithStock.length} SKUs`);

  // Export actionable items
  const outputPath = '/Users/shantumgupta/Downloads/missing_skus_analysis_v2.csv';
  const header = 'Category,SKU,CSV Product,DB Product,Size,Color,Existing Sizes/Colors,Warehouse Qty\n';
  const rows = [
    ...results.existingProductMissingSize.map(i =>
      `Missing Size,${i.sku},"${i.csvProduct}","${i.dbProduct}",${i.size},"${i.color}","${i.existingSizes}",${i.warehouseQty}`),
    ...results.existingProductMissingColor.map(i =>
      `Missing Color,${i.sku},"${i.csvProduct}","${i.dbProduct}",${i.size},"${i.color}","${i.existingColors}",${i.warehouseQty}`),
    ...results.completelyMissingProduct.map(i =>
      `Missing Product,${i.sku},"${i.productName}",,,,${i.warehouseQty}`),
  ];
  fs.writeFileSync(outputPath, header + rows.join('\n'));
  console.log(`\n📁 Full analysis exported to: ${outputPath}`);

  await prisma.$disconnect();
}

analyzeMissingSKUs().catch(console.error);
