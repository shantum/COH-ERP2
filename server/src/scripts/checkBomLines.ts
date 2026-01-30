import dotenv from 'dotenv';
dotenv.config();
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

const MAIN_FABRIC_ROLE_ID = "f37a964e-8d5b-4e6a-931d-35ed3ef01486";

async function main() {
  // Check Seer Sucker variations
  const seerSucker = await prisma.variation.findMany({
    where: {
      product: { name: { contains: "Seer Sucker", mode: "insensitive" } }
    },
    include: {
      product: { select: { name: true } },
      bomLines: {
        where: { roleId: MAIN_FABRIC_ROLE_ID },
        include: { fabricColour: { select: { colourName: true } } }
      }
    },
    take: 10
  });

  console.log("=== SEER SUCKER VARIATIONS ===");
  for (const v of seerSucker) {
    const bomLine = v.bomLines[0];
    const status = bomLine ? `✓ ${bomLine.fabricColour?.colourName}` : "NO BOM";
    console.log(`${v.product?.name} | ${v.colorName} → ${status}`);
  }

  // Check Hemp variations
  const hemp = await prisma.variation.findMany({
    where: {
      product: { name: { contains: "Hemp", mode: "insensitive" } }
    },
    include: {
      product: { select: { name: true } },
      bomLines: {
        where: { roleId: MAIN_FABRIC_ROLE_ID },
        include: { fabricColour: { select: { colourName: true } } }
      }
    },
    take: 10
  });

  console.log("\n=== HEMP VARIATIONS ===");
  for (const v of hemp) {
    const bomLine = v.bomLines[0];
    const status = bomLine ? `✓ ${bomLine.fabricColour?.colourName}` : "NO BOM";
    console.log(`${v.product?.name} | ${v.colorName} → ${status}`);
  }

  // Check total variations with/without BOM lines
  const totalVariations = await prisma.variation.count();
  const withBomLines = await prisma.variation.count({
    where: {
      bomLines: { some: { roleId: MAIN_FABRIC_ROLE_ID } }
    }
  });

  console.log(`\n=== SUMMARY ===`);
  console.log(`Total variations: ${totalVariations}`);
  console.log(`With main fabric BOM line: ${withBomLines}`);
  console.log(`Without: ${totalVariations - withBomLines}`);
}

main().finally(() => prisma.$disconnect());
