import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient({
  datasources: {
    db: {
      url: "postgresql://postgres:WtdrObtamAvaSjbjhCAEXLNAlcMiCkCX@caboose.proxy.rlwy.net:20615/railway"
    }
  }
});

async function main() {
  // Get Linen 25 Lea colours
  const fabric = await prisma.fabric.findFirst({
    where: { name: "Linen 25 Lea" },
    include: { colours: true }
  });

  console.log("=== LINEN 25 LEA COLOURS AVAILABLE ===");
  fabric?.colours.forEach(c => console.log(`  - ${c.colourName}`));

  // Get unlinked Heavy Linen variations
  const variations = await prisma.variation.findMany({
    where: {
      OR: [
        { product: { name: { contains: "Heavy Linen", mode: "insensitive" } } },
      ],
      AND: {
        OR: [
          { bomLines: { none: { role: { code: "main", type: { code: "FABRIC" } } } } },
          { bomLines: { some: { role: { code: "main", type: { code: "FABRIC" } }, fabricColourId: null } } }
        ]
      }
    },
    include: { product: { select: { name: true } } },
    orderBy: { colorName: "asc" }
  });

  console.log("\n=== UNLINKED HEAVY LINEN VARIATIONS ===\n");

  // Group by color
  const byColor: Record<string, string[]> = {};
  for (const v of variations) {
    const color = v.colorName || "No color";
    if (!byColor[color]) byColor[color] = [];
    byColor[color].push(v.product?.name || "Unknown");
  }

  for (const [color, products] of Object.entries(byColor).sort()) {
    console.log(`${color}:`);
    products.forEach(p => console.log(`  - ${p}`));
  }

  console.log(`\nTotal: ${variations.length} variations`);
}

main().finally(() => prisma.$disconnect());
