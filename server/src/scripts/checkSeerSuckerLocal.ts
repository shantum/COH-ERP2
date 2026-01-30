import dotenv from 'dotenv';
dotenv.config();
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

async function main() {
  const variations = await prisma.variation.findMany({
    where: {
      product: { name: { contains: "Seer Sucker", mode: "insensitive" } }
    },
    include: { product: { select: { name: true } } }
  });

  console.log("=== SEER SUCKER VARIATIONS ON LOCAL ===\n");
  if (variations.length === 0) {
    console.log("No Seer Sucker products found!");
  } else {
    for (const v of variations) {
      console.log(`${v.product?.name} | ${v.colorName}`);
    }
    console.log(`\nTotal: ${variations.length}`);
  }

  // Also check if fabric and colours exist
  const fabric = await prisma.fabric.findFirst({
    where: { name: "Seer Sucker" },
    include: { colours: true }
  });

  if (fabric) {
    console.log(`\n=== SEER SUCKER FABRIC EXISTS ===`);
    console.log(`Fabric ID: ${fabric.id}`);
    console.log(`Colours: ${fabric.colours.map(c => c.colourName).join(", ")}`);
  }
}

main().finally(() => prisma.$disconnect());
