import dotenv from 'dotenv';
dotenv.config();
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

const MAIN_FABRIC_ROLE_ID = "f37a964e-8d5b-4e6a-931d-35ed3ef01486";

interface LinkMapping {
  productPattern: string;
  colorPattern: string;
  fabricName: string;
  colourName: string;
}

// All the mappings we confirmed earlier
const MAPPINGS: LinkMapping[] = [
  // Seer Sucker
  { productPattern: "Seer Sucker", colorPattern: "Yellow", fabricName: "Seer Sucker", colourName: "Yellow" },
  { productPattern: "Seer Sucker", colorPattern: "Pink", fabricName: "Seer Sucker", colourName: "Pink" },
  { productPattern: "Seer Sucker", colorPattern: "White", fabricName: "Seer Sucker", colourName: "White" },
  { productPattern: "Seer Sucker", colorPattern: "Green", fabricName: "Seer Sucker", colourName: "Green" },
  { productPattern: "Seer Sucker", colorPattern: "Blue", fabricName: "Seer Sucker", colourName: "Blue" },

  // Brush Terry
  { productPattern: "Brush Terry", colorPattern: "Deep Sea Blue", fabricName: "Brush Terry", colourName: "Sky Blue" },
  { productPattern: "Brush Terry", colorPattern: "Light Turqouise", fabricName: "Brush Terry", colourName: "Turquoise" },
  { productPattern: "Brush Terry", colorPattern: "Light Turquoise", fabricName: "Brush Terry", colourName: "Turquoise" },
  { productPattern: "Brush Terry", colorPattern: "Forest Green", fabricName: "Brush Terry", colourName: "Green" },

  // Heavy Linen (Linen 25 Lea) - Jackets only
  { productPattern: "Buttondown Jacket", colorPattern: "Denim Blue", fabricName: "Linen 25 Lea", colourName: "Denim Blue" },
  { productPattern: "Bomber Jacket", colorPattern: "Denim Blue", fabricName: "Linen 25 Lea", colourName: "Denim Blue" },
  { productPattern: "Buttondown Jacket", colorPattern: "Rainforest Green", fabricName: "Linen 25 Lea", colourName: "Rain Forest Green" },
  { productPattern: "Bomber Jacket", colorPattern: "Rainforest Green", fabricName: "Linen 25 Lea", colourName: "Rain Forest Green" },

  // Hemp
  { productPattern: "Hemp", colorPattern: "Electric Blue", fabricName: "Hemp", colourName: "Blue" },
  { productPattern: "Hemp", colorPattern: "Natural", fabricName: "Hemp", colourName: "Beige" },
  { productPattern: "Hemp", colorPattern: "Silver Sand", fabricName: "Hemp", colourName: "Grey" },

  // Kat-Pati
  { productPattern: "Katpatti", colorPattern: "Grey Checks", fabricName: "Kat-Pati", colourName: "Black & White" },
];

async function main() {
  console.log("=== Linking Variations via BOM Lines ===\n");

  // Pre-fetch all fabric colours
  const fabricColours = await prisma.fabricColour.findMany({
    include: { fabric: true }
  });

  const colourMap = new Map<string, string>();
  for (const fc of fabricColours) {
    colourMap.set(`${fc.fabric.name}|${fc.colourName}`, fc.id);
  }

  let totalLinked = 0;
  let totalSkipped = 0;

  for (const mapping of MAPPINGS) {
    const fabricColourId = colourMap.get(`${mapping.fabricName}|${mapping.colourName}`);

    if (!fabricColourId) {
      console.log(`SKIP: ${mapping.fabricName} > ${mapping.colourName} not found`);
      continue;
    }

    // Find matching variations that don't have a BOM line yet
    const variations = await prisma.variation.findMany({
      where: {
        product: { name: { contains: mapping.productPattern, mode: "insensitive" } },
        colorName: { contains: mapping.colorPattern, mode: "insensitive" },
        bomLines: {
          none: { roleId: MAIN_FABRIC_ROLE_ID }
        }
      },
      select: {
        id: true,
        colorName: true,
        product: { select: { name: true } }
      }
    });

    if (variations.length === 0) {
      console.log(`SKIP: No unlinked variations for ${mapping.productPattern} | ${mapping.colorPattern}`);
      totalSkipped++;
      continue;
    }

    // Create BOM lines
    const bomLines = variations.map(v => ({
      variationId: v.id,
      roleId: MAIN_FABRIC_ROLE_ID,
      fabricColourId: fabricColourId,
    }));

    const result = await prisma.variationBomLine.createMany({
      data: bomLines,
      skipDuplicates: true
    });

    console.log(`LINKED ${result.count}: ${mapping.productPattern} | ${mapping.colorPattern} → ${mapping.fabricName} > ${mapping.colourName}`);
    totalLinked += result.count;
  }

  console.log(`\n=== SUMMARY ===`);
  console.log(`Total linked: ${totalLinked}`);
  console.log(`Patterns skipped: ${totalSkipped}`);
}

main().finally(() => prisma.$disconnect());
