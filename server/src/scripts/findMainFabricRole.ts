import dotenv from 'dotenv';
dotenv.config();
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

async function main() {
  // Find the main fabric role
  const roles = await prisma.componentRole.findMany({
    include: { type: true }
  });

  console.log("=== COMPONENT ROLES ===\n");
  for (const role of roles) {
    console.log(`${role.code} (${role.type.code}): ${role.name} - ID: ${role.id}`);
  }

  // Look specifically for main + FABRIC
  const mainFabricRole = await prisma.componentRole.findFirst({
    where: {
      code: "main",
      type: { code: "FABRIC" }
    }
  });

  console.log("\n=== MAIN FABRIC ROLE ===");
  console.log(mainFabricRole);
}

main().finally(() => prisma.$disconnect());
