import 'dotenv/config';
import fs from 'fs';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function analyzeMissingSKUs() {
  // Read missing SKUs CSV
  const csvPath = '/Users/shantumgupta/Downloads/missing_skus_from_db.csv';
  const csvContent = fs.readFileSync(csvPath, 'utf-8');
  const lines = csvContent.split('\n').slice(1); // Skip header

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

  // Build a map of product names to their existing sizes
  const productSizeMap: Map<string, {
    productName: string;
    colors: Map<string, Set<string>>; // color -> sizes
  }> = new Map();

  for (const product of dbProducts) {
    const colorMap = new Map<string, Set<string>>();
    for (const variation of product.variations) {
      const sizes = new Set(variation.skus.map(s => s.size));
      colorMap.set(variation.colorName, sizes);
    }
    productSizeMap.set(product.name.toLowerCase(), {
      productName: product.name,
      colors: colorMap,
    });
  }

  // Analyze missing SKUs
  const results = {
    existingProductMissingSize: [] as Array<{ sku: string; productName: string; size: string; color: string; warehouseQty: number }>,
    existingProductMissingColor: [] as Array<{ sku: string; productName: string; size: string; color: string; warehouseQty: number }>,
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
    // Format is typically: "Product Name - Size - Color"
    const parts = item.productName.split(' - ');
    if (parts.length < 3) {
      results.completelyMissingProduct.push(item);
      continue;
    }

    const baseProductName = parts[0].trim();
    const size = parts[1].trim();
    const color = parts.slice(2).join(' - ').trim(); // In case color has dashes

    // Check if product exists
    const existingProduct = productSizeMap.get(baseProductName.toLowerCase());

    if (!existingProduct) {
      results.completelyMissingProduct.push(item);
    } else {
      // Product exists, check if color exists
      const existingColors = existingProduct.colors;

      // Try to find matching color (case-insensitive)
      let matchingColor: string | null = null;
      for (const [existingColor] of existingColors) {
        if (existingColor.toLowerCase() === color.toLowerCase()) {
          matchingColor = existingColor;
          break;
        }
      }

      if (matchingColor) {
        // Color exists, must be missing size
        results.existingProductMissingSize.push({
          sku: item.sku,
          productName: baseProductName,
          size,
          color,
          warehouseQty: item.warehouseQty,
        });
      } else {
        // Product exists but color doesn't
        results.existingProductMissingColor.push({
          sku: item.sku,
          productName: baseProductName,
          size,
          color,
          warehouseQty: item.warehouseQty,
        });
      }
    }
  }

  // Print results
  console.log('\n📊 Missing SKU Analysis\n');
  console.log('=' .repeat(60));

  console.log(`\n✅ EXISTING PRODUCTS - MISSING SIZES: ${results.existingProductMissingSize.length}`);
  console.log('   (Product and color exist, just need to add the size)\n');

  // Group by product
  const bySizeProduct = new Map<string, typeof results.existingProductMissingSize>();
  for (const item of results.existingProductMissingSize) {
    const key = `${item.productName} - ${item.color}`;
    if (!bySizeProduct.has(key)) bySizeProduct.set(key, []);
    bySizeProduct.get(key)!.push(item);
  }

  for (const [key, items] of Array.from(bySizeProduct.entries()).slice(0, 20)) {
    const sizes = items.map(i => i.size).join(', ');
    const totalQty = items.reduce((sum, i) => sum + i.warehouseQty, 0);
    console.log(`   📦 ${key}`);
    console.log(`      Missing sizes: ${sizes}${totalQty > 0 ? ` (Total warehouse qty: ${totalQty})` : ''}`);
  }
  if (bySizeProduct.size > 20) {
    console.log(`   ... and ${bySizeProduct.size - 20} more product/color combinations`);
  }

  console.log(`\n🎨 EXISTING PRODUCTS - MISSING COLORS: ${results.existingProductMissingColor.length}`);
  console.log('   (Product exists but this color variation doesn\'t)\n');

  const byColorProduct = new Map<string, typeof results.existingProductMissingColor>();
  for (const item of results.existingProductMissingColor) {
    if (!byColorProduct.has(item.productName)) byColorProduct.set(item.productName, []);
    byColorProduct.get(item.productName)!.push(item);
  }

  for (const [productName, items] of Array.from(byColorProduct.entries()).slice(0, 20)) {
    const colors = [...new Set(items.map(i => i.color))].join(', ');
    const totalQty = items.reduce((sum, i) => sum + i.warehouseQty, 0);
    console.log(`   📦 ${productName}`);
    console.log(`      Missing colors: ${colors}${totalQty > 0 ? ` (Total warehouse qty: ${totalQty})` : ''}`);
  }
  if (byColorProduct.size > 20) {
    console.log(`   ... and ${byColorProduct.size - 20} more products`);
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

  for (const [productName, items] of Array.from(byMissingProduct.entries()).slice(0, 30)) {
    const totalQty = items.reduce((sum, i) => sum + i.warehouseQty, 0);
    console.log(`   📦 ${productName} (${items.length} SKUs)${totalQty > 0 ? ` - Warehouse qty: ${totalQty}` : ''}`);
  }
  if (byMissingProduct.size > 30) {
    console.log(`   ... and ${byMissingProduct.size - 30} more products`);
  }

  console.log(`\n🗑️  DELETED PRODUCTS: ${results.deletedProducts.length}`);
  console.log(`📭 EMPTY NAMES: ${results.emptyNames.length}`);

  // Summary with warehouse quantities
  const missingSizeWithStock = results.existingProductMissingSize.filter(i => i.warehouseQty > 0);
  const missingColorWithStock = results.existingProductMissingColor.filter(i => i.warehouseQty > 0);
  const missingProductWithStock = results.completelyMissingProduct.filter(i => i.warehouseQty > 0);

  console.log('\n' + '=' .repeat(60));
  console.log('\n📈 SUMMARY - Items WITH warehouse stock:\n');
  console.log(`   Missing sizes (easy fix):     ${missingSizeWithStock.length} SKUs`);
  console.log(`   Missing colors:               ${missingColorWithStock.length} SKUs`);
  console.log(`   Missing products:             ${missingProductWithStock.length} SKUs`);

  // Export actionable items
  const outputPath = '/Users/shantumgupta/Downloads/missing_skus_analysis.csv';
  const header = 'Category,SKU,Product Name,Size,Color,Warehouse Qty\n';
  const rows = [
    ...results.existingProductMissingSize.map(i => `Missing Size,${i.sku},"${i.productName}",${i.size},"${i.color}",${i.warehouseQty}`),
    ...results.existingProductMissingColor.map(i => `Missing Color,${i.sku},"${i.productName}",${i.size},"${i.color}",${i.warehouseQty}`),
    ...results.completelyMissingProduct.map(i => `Missing Product,${i.sku},"${i.productName}",,,${i.warehouseQty}`),
  ];
  fs.writeFileSync(outputPath, header + rows.join('\n'));
  console.log(`\n📁 Full analysis exported to: ${outputPath}`);

  await prisma.$disconnect();
}

analyzeMissingSKUs().catch(console.error);
