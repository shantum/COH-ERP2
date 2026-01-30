import { PrismaClient } from "@prisma/client";

// Production database URL
const prisma = new PrismaClient({
  datasources: {
    db: {
      url: "postgresql://postgres:WtdrObtamAvaSjbjhCAEXLNAlcMiCkCX@caboose.proxy.rlwy.net:20615/railway"
    }
  }
});

async function main() {
  // Check what's already linked on production
  const linkedVariations = await prisma.variationBomLine.findMany({
    where: {
      role: { code: "main", type: { code: "FABRIC" } },
      fabricColourId: { not: null }
    },
    include: {
      variation: {
        include: { product: { select: { name: true } } }
      },
      fabricColour: {
        include: { fabric: { select: { name: true } } }
      }
    }
  });

  console.log("=== ALREADY LINKED ON PRODUCTION ===\n");

  // Group by fabric
  const byFabric: Record<string, string[]> = {};
  for (const line of linkedVariations) {
    const fabricName = line.fabricColour?.fabric?.name || "Unknown";
    const colourName = line.fabricColour?.colourName || "Unknown";
    const key = `${fabricName} > ${colourName}`;
    if (!byFabric[key]) byFabric[key] = [];
    byFabric[key].push(`${line.variation?.product?.name} | ${line.variation?.colorName}`);
  }

  for (const [fabric, products] of Object.entries(byFabric).sort()) {
    console.log(`\n${fabric} (${products.length} variations):`);
    const unique = [...new Set(products)];
    unique.slice(0, 5).forEach(p => console.log(`  - ${p}`));
    if (unique.length > 5) console.log(`  ... and ${unique.length - 5} more`);
  }

  console.log(`\n\nTotal linked: ${linkedVariations.length} variations`);

  // Check what mappings we want to do
  const mappings = [
    { productPattern: "Hemp", colorPattern: "Electric Blue", fabricName: "Hemp", colourName: "Blue" },
    { productPattern: "Hemp", colorPattern: "Natural", fabricName: "Hemp", colourName: "Beige" },
    { productPattern: "Hemp", colorPattern: "Silver Sand", fabricName: "Hemp", colourName: "Grey" },
    { productPattern: "Katpatti", colorPattern: "Grey Checks", fabricName: "Kat-Pati", colourName: "Black & White" },
    { productPattern: "Buttondown Jacket", colorPattern: "Denim Blue", fabricName: "Linen 25 Lea", colourName: "Denim Blue" },
    { productPattern: "Bomber Jacket", colorPattern: "Denim Blue", fabricName: "Linen 25 Lea", colourName: "Denim Blue" },
    { productPattern: "Buttondown Jacket", colorPattern: "Rainforest Green", fabricName: "Linen 25 Lea", colourName: "Rain Forest Green" },
    { productPattern: "Bomber Jacket", colorPattern: "Rainforest Green", fabricName: "Linen 25 Lea", colourName: "Rain Forest Green" },
  ];

  console.log("\n\n=== VARIATIONS TO LINK (not already linked) ===\n");

  for (const m of mappings) {
    // Find variations matching pattern that are NOT already linked
    const unlinked = await prisma.variation.findMany({
      where: {
        product: { name: { contains: m.productPattern, mode: "insensitive" } },
        colorName: { contains: m.colorPattern, mode: "insensitive" },
        OR: [
          { bomLines: { none: { role: { code: "main", type: { code: "FABRIC" } } } } },
          { bomLines: { some: { role: { code: "main", type: { code: "FABRIC" } }, fabricColourId: null } } }
        ]
      },
      include: { product: { select: { name: true } } }
    });

    if (unlinked.length > 0) {
      console.log(`${m.productPattern} | ${m.colorPattern} → ${m.fabricName} > ${m.colourName}`);
      unlinked.forEach(v => console.log(`  - ${v.product?.name} | ${v.colorName}`));
    }
  }
}

main().finally(() => prisma.$disconnect());
