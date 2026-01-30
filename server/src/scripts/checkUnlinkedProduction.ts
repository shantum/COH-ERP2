import { PrismaClient } from "@prisma/client";

if (!process.env.DATABASE_URL) {
  console.error("DATABASE_URL environment variable is required");
  process.exit(1);
}

const prisma = new PrismaClient();

async function main() {
  // Find variations without a main fabric BOM line or with null fabricColourId
  const unlinked = await prisma.variation.findMany({
    where: {
      OR: [
        { bomLines: { none: { role: { code: "main", type: { code: "FABRIC" } } } } },
        { bomLines: { some: { role: { code: "main", type: { code: "FABRIC" } }, fabricColourId: null } } }
      ]
    },
    include: {
      product: { select: { name: true } }
    },
    orderBy: [
      { product: { name: "asc" } },
      { colorName: "asc" }
    ]
  });

  console.log("=== UNLINKED VARIATIONS ON PRODUCTION ===\n");

  // Group by product
  const byProduct: Record<string, string[]> = {};
  for (const v of unlinked) {
    const productName = v.product?.name || "Unknown";
    if (!byProduct[productName]) byProduct[productName] = [];
    byProduct[productName].push(v.colorName || "No color");
  }

  for (const [product, colors] of Object.entries(byProduct).sort()) {
    console.log(`\n${product} (${colors.length} variations):`);
    colors.forEach(c => console.log(`  - ${c}`));
  }

  console.log(`\n\n=== SUMMARY ===`);
  console.log(`Total unlinked variations: ${unlinked.length}`);
  console.log(`Products with unlinked variations: ${Object.keys(byProduct).length}`);
}

main().finally(() => prisma.$disconnect());
