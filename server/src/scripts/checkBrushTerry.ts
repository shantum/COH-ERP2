import dotenv from 'dotenv';
dotenv.config();
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

async function main() {
  const variations = await prisma.variation.findMany({
    where: {
      product: { name: { contains: "Brush Terry", mode: "insensitive" } }
    },
    include: {
      product: { select: { name: true } },
      bomLines: {
        where: { role: { code: "main", type: { code: "FABRIC" } } },
        include: { fabricColour: { select: { colourName: true } } }
      }
    }
  });

  console.log("=== BRUSH TERRY VARIATIONS ===\n");
  for (const v of variations) {
    const linked = v.bomLines[0]?.fabricColour?.colourName || "NOT LINKED";
    console.log(`${v.product?.name} | ${v.colorName} → ${linked}`);
  }
  console.log(`\nTotal: ${variations.length}`);
}

main().finally(() => prisma.$disconnect());
