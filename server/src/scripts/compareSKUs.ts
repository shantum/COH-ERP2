import 'dotenv/config';
import fs from 'fs';
import path from 'path';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function compareSKUs() {
  // Read CSV file
  const csvPath = '/Users/shantumgupta/Downloads/COH Orders Mastersheet - Inventory.csv';
  const csvContent = fs.readFileSync(csvPath, 'utf-8');
  const lines = csvContent.split('\n');

  // Parse SKUs from CSV (starting from row 4, which is index 3)
  const csvSkus: Map<string, { sku: string; productName: string; warehouseQty: number }> = new Map();

  for (let i = 3; i < lines.length; i++) {
    const line = lines[i];
    if (!line.trim()) continue;

    // Parse CSV properly handling commas
    const columns = line.split(',');
    const sku = columns[0]?.trim();
    const productName = columns[1]?.trim();
    const warehouseQty = parseInt(columns[5] || '0', 10) || 0; // Column F is WAREHOUSE Qty Balance

    if (sku && /^\d+$/.test(sku)) {
      csvSkus.set(sku, { sku, productName, warehouseQty });
    }
  }

  console.log(`\n📊 CSV Analysis:`);
  console.log(`   Total SKUs in CSV: ${csvSkus.size}`);

  // Get all SKUs from database
  const dbSkus = await prisma.sku.findMany({
    select: {
      id: true,
      skuCode: true,
      shopifyVariantId: true,
      size: true,
      variation: {
        select: {
          colorName: true,
          product: {
            select: {
              name: true,
            },
          },
        },
      },
    },
  });

  console.log(`   Total SKUs in database: ${dbSkus.length}`);

  // Create maps for comparison
  const dbSkuCodes = new Set(dbSkus.map(s => s.skuCode));
  const dbShopifyIds = new Set(dbSkus.map(s => s.shopifyVariantId).filter(Boolean));

  // Find SKUs in CSV but not in database
  const missingInDb: Array<{ sku: string; productName: string; warehouseQty: number }> = [];

  for (const [sku, data] of csvSkus) {
    // Check if SKU matches either skuCode or shopifyVariantId
    if (!dbSkuCodes.has(sku) && !dbShopifyIds.has(sku)) {
      missingInDb.push(data);
    }
  }

  // Find SKUs in database but not in CSV
  const missingInCsv: Array<{ skuCode: string; productName: string }> = [];

  for (const dbSku of dbSkus) {
    if (!csvSkus.has(dbSku.skuCode) && (!dbSku.shopifyVariantId || !csvSkus.has(dbSku.shopifyVariantId))) {
      missingInCsv.push({
        skuCode: dbSku.skuCode,
        productName: `${dbSku.variation.product.name} - ${dbSku.size} - ${dbSku.variation.colorName}`,
      });
    }
  }

  console.log(`\n❌ SKUs in CSV but MISSING from database: ${missingInDb.length}`);
  if (missingInDb.length > 0) {
    // Group by product
    const byProduct: Map<string, Array<{ sku: string; productName: string; warehouseQty: number }>> = new Map();
    for (const item of missingInDb) {
      const productMatch = item.productName.match(/^(.+?) - [A-Z0-9]+/);
      const productName = productMatch ? productMatch[1] : item.productName.split(' - ')[0] || 'Unknown';
      if (!byProduct.has(productName)) {
        byProduct.set(productName, []);
      }
      byProduct.get(productName)!.push(item);
    }

    // Sort by product name
    const sortedProducts = Array.from(byProduct.entries()).sort((a, b) => a[0].localeCompare(b[0]));

    console.log('\n   Missing SKUs by Product:');
    for (const [productName, skus] of sortedProducts) {
      console.log(`\n   📦 ${productName} (${skus.length} SKUs)`);
      for (const item of skus.slice(0, 10)) { // Show first 10
        console.log(`      - ${item.sku}: ${item.productName} (Warehouse: ${item.warehouseQty})`);
      }
      if (skus.length > 10) {
        console.log(`      ... and ${skus.length - 10} more`);
      }
    }
  }

  console.log(`\n⚠️  SKUs in database but NOT in CSV: ${missingInCsv.length}`);
  if (missingInCsv.length > 0 && missingInCsv.length <= 50) {
    for (const item of missingInCsv) {
      console.log(`   - ${item.skuCode}: ${item.productName}`);
    }
  } else if (missingInCsv.length > 50) {
    console.log(`   (Too many to list - showing first 20)`);
    for (const item of missingInCsv.slice(0, 20)) {
      console.log(`   - ${item.skuCode}: ${item.productName}`);
    }
  }

  // Export missing SKUs to CSV for easier review
  if (missingInDb.length > 0) {
    const outputPath = '/Users/shantumgupta/Downloads/missing_skus_from_db.csv';
    const csvHeader = 'SKU,Product Name,Warehouse Qty\n';
    const csvData = missingInDb
      .map(item => `${item.sku},"${item.productName.replace(/"/g, '""')}",${item.warehouseQty}`)
      .join('\n');
    fs.writeFileSync(outputPath, csvHeader + csvData);
    console.log(`\n📁 Missing SKUs exported to: ${outputPath}`);
  }

  await prisma.$disconnect();
}

compareSKUs().catch(console.error);
