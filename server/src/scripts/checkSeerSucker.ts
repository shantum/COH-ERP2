import { PrismaClient } from "@prisma/client";

if (!process.env.DATABASE_URL) {
  console.error("DATABASE_URL environment variable is required");
  process.exit(1);
}

const prisma = new PrismaClient();

async function main() {
  // Check Seer Sucker variations on production
  const variations = await prisma.variation.findMany({
    where: {
      product: { name: { contains: "Seer Sucker", mode: "insensitive" } }
    },
    include: {
      product: { select: { name: true } },
      bomLines: {
        where: { role: { code: "main", type: { code: "FABRIC" } } },
        include: { fabricColour: { select: { colourName: true, fabric: { select: { name: true } } } } }
      }
    },
    orderBy: { colorName: "asc" }
  });

  console.log("=== SEER SUCKER VARIATIONS ON PRODUCTION ===\n");

  if (variations.length === 0) {
    console.log("No Seer Sucker products found!");
    return;
  }

  for (const v of variations) {
    const linked = v.bomLines[0]?.fabricColour
      ? `✓ ${v.bomLines[0].fabricColour.fabric?.name} > ${v.bomLines[0].fabricColour.colourName}`
      : "NOT LINKED";
    console.log(`${v.product?.name} | ${v.colorName} → ${linked}`);
  }

  console.log(`\nTotal: ${variations.length} variations`);

  // Check available Seer Sucker colours
  const seerSuckerFabric = await prisma.fabric.findFirst({
    where: { name: "Seer Sucker" },
    include: { colours: true }
  });

  if (seerSuckerFabric) {
    console.log(`\n=== SEER SUCKER COLOURS AVAILABLE ===`);
    for (const c of seerSuckerFabric.colours) {
      console.log(`  - ${c.colourName}`);
    }
  }
}

main().finally(() => prisma.$disconnect());
