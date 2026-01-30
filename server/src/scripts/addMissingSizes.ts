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

// Extract gender from CSV product name
function extractGender(name: string): 'men' | 'women' | null {
  if (name.toLowerCase().startsWith("men's")) return 'men';
  if (name.toLowerCase().startsWith("women's")) return 'women';
  return null;
}

interface MissingSizeSKU {
  skuCode: string;  // This is the SKU code from CSV
  csvProductName: string;
  size: string;
  color: string;
  warehouseQty: number;
}

async function addMissingSizes(dryRun = true) {
  console.log(`\n${dryRun ? '🔍 DRY RUN' : '🚀 EXECUTING'} - Add Missing Sizes\n`);
  console.log('='.repeat(70));

  // Read the original CSV to get Shopify variant IDs
  const csvPath = '/Users/shantumgupta/Downloads/COH Orders Mastersheet - Inventory.csv';
  const csvContent = fs.readFileSync(csvPath, 'utf-8');
  const lines = csvContent.split('\n');

  // Parse all SKUs from CSV
  const csvSkus: Map<string, { productName: string; warehouseQty: number }> = new Map();
  for (let i = 3; i < lines.length; i++) {
    const line = lines[i];
    if (!line.trim()) continue;
    const columns = line.split(',');
    const sku = columns[0]?.trim();
    const productName = columns[1]?.trim();
    const warehouseQty = parseInt(columns[5] || '0', 10) || 0;
    if (sku && /^\d+$/.test(sku)) {
      csvSkus.set(sku, { productName, warehouseQty });
    }
  }

  // Get all products with variations and SKUs from database
  const dbProducts = await prisma.product.findMany({
    select: {
      id: true,
      name: true,
      gender: true,
      variations: {
        select: {
          id: true,
          colorName: true,
          skus: {
            select: {
              skuCode: true,
              shopifyVariantId: true,
              size: true,
              mrp: true,
              fabricConsumption: true,
            },
          },
        },
      },
    },
  });

  // Build lookup maps - key is "normalizedName|gender" for gender-specific matching
  const productByNormalizedName = new Map<string, typeof dbProducts[0]>();
  const productByNormalizedNameAndGender = new Map<string, typeof dbProducts[0]>();

  for (const product of dbProducts) {
    const normalizedName = normalizeName(product.name);
    // Store by name only (for fallback)
    productByNormalizedName.set(normalizedName, product);
    // Store by name + gender (for precise matching)
    if (product.gender) {
      productByNormalizedNameAndGender.set(`${normalizedName}|${product.gender}`, product);
    }
  }

  // Find missing sizes
  const missingSizes: MissingSizeSKU[] = [];

  for (const [csvSkuCode, csvData] of csvSkus) {
    if (!csvData.productName || csvData.productName.toLowerCase().includes('delete')) continue;

    const parts = csvData.productName.split(' - ');
    if (parts.length < 3) continue;

    const baseProductName = parts[0].trim();
    const size = parts[1].trim();
    const color = parts.slice(2).join(' - ').trim();
    const normalizedProduct = normalizeName(baseProductName);
    const normalizedColor = color.toLowerCase().trim();
    const csvGender = extractGender(baseProductName);

    // Try gender-specific match first, then fallback to name-only
    let product = csvGender
      ? productByNormalizedNameAndGender.get(`${normalizedProduct}|${csvGender}`)
      : null;
    if (!product) {
      product = productByNormalizedName.get(normalizedProduct);
    }
    if (!product) continue;

    // Find matching variation
    const variation = product.variations.find(v => v.colorName.toLowerCase() === normalizedColor);
    if (!variation) continue;

    // Check if size exists
    const existingSku = variation.skus.find(s => s.size === size);
    if (existingSku) continue;

    // Check if this skuCode already exists anywhere
    const existingBySkuCode = await prisma.sku.findFirst({
      where: { skuCode: csvSkuCode },
      select: { skuCode: true },
    });
    if (existingBySkuCode) continue;

    missingSizes.push({
      skuCode: csvSkuCode,
      csvProductName: csvData.productName,
      size,
      color,
      warehouseQty: csvData.warehouseQty,
    });
  }

  console.log(`\nFound ${missingSizes.length} missing sizes to add:\n`);

  // Group by product for display
  const byProduct = new Map<string, MissingSizeSKU[]>();
  for (const item of missingSizes) {
    const parts = item.csvProductName.split(' - ');
    const key = `${parts[0]} - ${item.color}`;
    if (!byProduct.has(key)) byProduct.set(key, []);
    byProduct.get(key)!.push(item);
  }

  for (const [productColor, items] of byProduct) {
    console.log(`📦 ${productColor}`);
    console.log(`   Sizes to add: ${items.map(i => i.size).join(', ')}`);
    console.log(`   SKU codes: ${items.map(i => i.skuCode).join(', ')}`);
    console.log('');
  }

  if (dryRun) {
    console.log('\n⚠️  DRY RUN - No changes made. Run with dryRun=false to create SKUs.\n');
    await prisma.$disconnect();
    return;
  }

  // Create the missing SKUs
  console.log('\n🔄 Creating missing SKUs...\n');

  let created = 0;
  let errors = 0;

  for (const item of missingSizes) {
    const parts = item.csvProductName.split(' - ');
    const baseProductName = parts[0].trim();
    const normalizedProduct = normalizeName(baseProductName);
    const normalizedColor = item.color.toLowerCase().trim();
    const csvGender = extractGender(baseProductName);

    // Try gender-specific match first, then fallback to name-only
    let product = csvGender
      ? productByNormalizedNameAndGender.get(`${normalizedProduct}|${csvGender}`)
      : null;
    if (!product) {
      product = productByNormalizedName.get(normalizedProduct);
    }
    if (!product) {
      console.log(`❌ Product not found: ${baseProductName}`);
      errors++;
      continue;
    }

    const variation = product.variations.find(v => v.colorName.toLowerCase() === normalizedColor);
    if (!variation) {
      console.log(`❌ Variation not found: ${product.name} - ${item.color}`);
      errors++;
      continue;
    }

    // Get reference SKU for MRP and fabric consumption (use any existing SKU in this variation)
    const referenceSku = variation.skus[0];
    if (!referenceSku) {
      console.log(`❌ No reference SKU found for: ${product.name} - ${item.color}`);
      errors++;
      continue;
    }

    try {
      // Use the SKU code from the CSV directly
      const skuCode = item.skuCode;

      await prisma.sku.create({
        data: {
          skuCode,
          variationId: variation.id,
          size: item.size,
          // shopifyVariantId will be null - can be linked later when syncing from Shopify
          mrp: referenceSku.mrp,
          fabricConsumption: referenceSku.fabricConsumption,
          isActive: true,
          currentBalance: 0, // Will be updated by inventory transactions
        },
      });

      console.log(`✅ Created: ${product.name} - ${item.size} - ${item.color} (SKU: ${skuCode})`);
      created++;
    } catch (error) {
      console.log(`❌ Error creating SKU: ${item.csvProductName}`);
      console.log(`   ${error instanceof Error ? error.message : 'Unknown error'}`);
      errors++;
    }
  }

  console.log('\n' + '='.repeat(70));
  console.log(`\n✅ Created: ${created} SKUs`);
  console.log(`❌ Errors: ${errors}`);

  await prisma.$disconnect();
}

// Run in dry-run mode first
const isDryRun = process.argv.includes('--execute') ? false : true;
addMissingSizes(isDryRun).catch(console.error);
