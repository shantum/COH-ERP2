import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient({
  datasources: {
    db: {
      url: "postgresql://postgres:WtdrObtamAvaSjbjhCAEXLNAlcMiCkCX@caboose.proxy.rlwy.net:20615/railway"
    }
  }
});

async function main() {
  // Get Linen 60 Lea colours
  const fabric = await prisma.fabric.findFirst({
    where: { name: "Linen 60 Lea" },
    include: { colours: true }
  });

  console.log("=== LINEN 60 LEA COLOURS AVAILABLE ===");
  fabric?.colours.forEach(c => console.log(`  - ${c.colourName}`));

  // Get unlinked Linen variations (exclude Heavy Linen, already done)
  const variations = await prisma.variation.findMany({
    where: {
      product: {
        name: { contains: "Linen", mode: "insensitive" },
        NOT: [
          { name: { contains: "Heavy Linen", mode: "insensitive" } },
          { name: { contains: "Buttondown Jacket", mode: "insensitive" } },
          { name: { contains: "Bomber Jacket", mode: "insensitive" } },
        ]
      },
      OR: [
        { bomLines: { none: { role: { code: "main", type: { code: "FABRIC" } } } } },
        { bomLines: { some: { role: { code: "main", type: { code: "FABRIC" } }, fabricColourId: null } } }
      ]
    },
    include: { product: { select: { name: true } } },
    orderBy: { colorName: "asc" }
  });

  console.log("\n=== UNLINKED LINEN VARIATIONS ===\n");

  // Group by color
  const byColor: Record<string, string[]> = {};
  for (const v of variations) {
    const color = v.colorName || "No color";
    if (!byColor[color]) byColor[color] = [];
    byColor[color].push(v.product?.name || "Unknown");
  }

  for (const [color, products] of Object.entries(byColor).sort()) {
    console.log(`${color} (${products.length}):`);
    products.forEach(p => console.log(`  - ${p}`));
  }

  console.log(`\nTotal: ${variations.length} variations`);
}

main().finally(() => prisma.$disconnect());
