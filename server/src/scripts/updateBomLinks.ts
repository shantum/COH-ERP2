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
  // Seer Sucker (if products exist)
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
  { productPattern: "Brush Terry", colorPattern: "Carbon Black", fabricName: "Brush Terry", colourName: "Black" },

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
  console.log("=== Updating BOM Line Fabric Colour Links ===\n");

  // Pre-fetch all fabric colours
  const fabricColours = await prisma.fabricColour.findMany({
    include: { fabric: true }
  });

  const colourMap = new Map<string, string>();
  for (const fc of fabricColours) {
    colourMap.set(`${fc.fabric.name}|${fc.colourName}`, fc.id);
  }

  let totalUpdated = 0;

  for (const mapping of MAPPINGS) {
    const fabricColourId = colourMap.get(`${mapping.fabricName}|${mapping.colourName}`);

    if (!fabricColourId) {
      console.log(`SKIP: ${mapping.fabricName} > ${mapping.colourName} not found`);
      continue;
    }

    // Find BOM lines that match but have null fabricColourId
    const result = await prisma.variationBomLine.updateMany({
      where: {
        roleId: MAIN_FABRIC_ROLE_ID,
        fabricColourId: null,
        variation: {
          product: { name: { contains: mapping.productPattern, mode: "insensitive" } },
          colorName: { contains: mapping.colorPattern, mode: "insensitive" }
        }
      },
      data: { fabricColourId: fabricColourId }
    });

    if (result.count > 0) {
      console.log(`UPDATED ${result.count}: ${mapping.productPattern} | ${mapping.colorPattern} → ${mapping.fabricName} > ${mapping.colourName}`);
      totalUpdated += result.count;
    }
  }

  // Also create BOM lines for variations that don't have any
  console.log("\n=== Creating missing BOM lines ===\n");

  for (const mapping of MAPPINGS) {
    const fabricColourId = colourMap.get(`${mapping.fabricName}|${mapping.colourName}`);

    if (!fabricColourId) continue;

    // Find variations without any main fabric BOM line
    const variationsWithoutBom = await prisma.variation.findMany({
      where: {
        product: { name: { contains: mapping.productPattern, mode: "insensitive" } },
        colorName: { contains: mapping.colorPattern, mode: "insensitive" },
        bomLines: {
          none: { roleId: MAIN_FABRIC_ROLE_ID }
        }
      },
      select: { id: true }
    });

    if (variationsWithoutBom.length > 0) {
      const bomLines = variationsWithoutBom.map(v => ({
        variationId: v.id,
        roleId: MAIN_FABRIC_ROLE_ID,
        fabricColourId: fabricColourId,
      }));

      const result = await prisma.variationBomLine.createMany({
        data: bomLines,
        skipDuplicates: true
      });

      if (result.count > 0) {
        console.log(`CREATED ${result.count}: ${mapping.productPattern} | ${mapping.colorPattern} → ${mapping.fabricName} > ${mapping.colourName}`);
        totalUpdated += result.count;
      }
    }
  }

  console.log(`\n=== SUMMARY ===`);
  console.log(`Total BOM links updated/created: ${totalUpdated}`);
}

main().finally(() => prisma.$disconnect());
