import { PrismaClient } from "@prisma/client";

if (!process.env.DATABASE_URL) {
  console.error("DATABASE_URL environment variable is required");
  process.exit(1);
}

const prisma = new PrismaClient();

async function main() {
  // Check with "seersucker" (one word)
  const variations = await prisma.variation.findMany({
    where: {
      product: { name: { contains: "seersucker", mode: "insensitive" } }
    },
    include: {
      product: { select: { name: true } },
      bomLines: {
        where: { role: { code: "main", type: { code: "FABRIC" } } },
        include: { fabricColour: { select: { colourName: true } } }
      }
    },
    orderBy: { colorName: "asc" }
  });

  console.log("=== SEERSUCKER VARIATIONS ON PRODUCTION ===\n");

  if (variations.length === 0) {
    console.log("No Seersucker products found!");
  } else {
    for (const v of variations) {
      const linked = v.bomLines[0]?.fabricColour?.colourName || "NOT LINKED";
      console.log(`${v.product?.name} | ${v.colorName} → ${linked}`);
    }
    console.log(`\nTotal: ${variations.length} variations`);
  }

  // Check available Seer Sucker colours
  const fabric = await prisma.fabric.findFirst({
    where: { name: "Seer Sucker" },
    include: { colours: true }
  });

  if (fabric) {
    console.log(`\n=== SEER SUCKER COLOURS AVAILABLE ===`);
    for (const c of fabric.colours) {
      console.log(`  - ${c.colourName}`);
    }
  }
}

main().finally(() => prisma.$disconnect());
