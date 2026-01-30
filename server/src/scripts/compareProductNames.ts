import 'dotenv/config';
import fs from 'fs';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function compareProductNames() {
  // Read missing SKUs CSV
  const csvPath = '/Users/shantumgupta/Downloads/missing_skus_from_db.csv';
  const csvContent = fs.readFileSync(csvPath, 'utf-8');
  const lines = csvContent.split('\n').slice(1);

  // Get unique product names from CSV (base names without size/color)
  const csvProductNames = new Set<string>();
  for (const line of lines) {
    if (!line.trim()) continue;
    const match = line.match(/^(\d+),"(.*)","?(\d+)"?$/);
    if (match && match[2]) {
      const parts = match[2].split(' - ');
      if (parts.length >= 1 && !parts[0].toLowerCase().includes('delete')) {
        csvProductNames.add(parts[0].trim());
      }
    }
  }

  // Get all product names from database
  const dbProducts = await prisma.product.findMany({
    select: { name: true },
  });
  const dbProductNames = new Set(dbProducts.map(p => p.name));

  console.log('\n📊 Product Name Comparison\n');
  console.log('=' .repeat(70));

  console.log(`\nCSV unique product names: ${csvProductNames.size}`);
  console.log(`Database product names: ${dbProductNames.size}`);

  // Find close matches
  console.log('\n🔍 Looking for close matches...\n');

  const csvNames = Array.from(csvProductNames).filter(n => n.length > 0).sort();
  const dbNames = Array.from(dbProductNames).sort();

  // Simple similarity - check if one contains the other or differs slightly
  const potentialMatches: Array<{ csv: string; db: string; similarity: string }> = [];

  for (const csvName of csvNames) {
    // Exact match check
    if (dbProductNames.has(csvName)) continue;

    // Find potential matches in DB
    for (const dbName of dbNames) {
      const csvLower = csvName.toLowerCase().replace(/['']/g, "'");
      const dbLower = dbName.toLowerCase().replace(/['']/g, "'");

      // Check if one contains the other
      if (csvLower.includes(dbLower) || dbLower.includes(csvLower)) {
        potentialMatches.push({ csv: csvName, db: dbName, similarity: 'contains' });
        continue;
      }

      // Check word overlap
      const csvWords = csvLower.split(/\s+/).filter(w => w.length > 2);
      const dbWords = dbLower.split(/\s+/).filter(w => w.length > 2);
      const overlap = csvWords.filter(w => dbWords.includes(w)).length;
      const totalWords = Math.max(csvWords.length, dbWords.length);

      if (overlap >= totalWords * 0.7 && overlap >= 2) {
        potentialMatches.push({ csv: csvName, db: dbName, similarity: `${overlap}/${totalWords} words` });
      }
    }
  }

  if (potentialMatches.length > 0) {
    console.log('Potential matches found:\n');
    for (const match of potentialMatches.slice(0, 30)) {
      console.log(`   CSV: "${match.csv}"`);
      console.log(`   DB:  "${match.db}"`);
      console.log(`   Similarity: ${match.similarity}\n`);
    }
  }

  // Show unmatched CSV products
  console.log('\n❌ CSV Products with NO match in DB:\n');
  let count = 0;
  for (const csvName of csvNames) {
    if (!dbProductNames.has(csvName) && csvName.length > 0) {
      console.log(`   - ${csvName}`);
      count++;
      if (count >= 40) {
        console.log(`   ... and ${csvNames.length - count} more`);
        break;
      }
    }
  }

  // Show some DB products to compare
  console.log('\n✅ Sample DB Product Names (for comparison):\n');
  for (const name of dbNames.slice(0, 30)) {
    console.log(`   - ${name}`);
  }
  if (dbNames.length > 30) {
    console.log(`   ... and ${dbNames.length - 30} more`);
  }

  await prisma.$disconnect();
}

compareProductNames().catch(console.error);
