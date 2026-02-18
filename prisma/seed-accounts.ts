/**
 * Seed Ledger Accounts
 *
 * Upserts the 16 chart-of-accounts entries from the finance config.
 * Safe to run multiple times — uses upsert on the unique `code` field.
 *
 * Usage: npx tsx prisma/seed-accounts.ts
 */

import { PrismaClient } from '@prisma/client';
import { CHART_OF_ACCOUNTS } from '@coh/shared/schemas/finance';

const prisma = new PrismaClient();

async function main() {
  console.log(`Seeding ${CHART_OF_ACCOUNTS.length} ledger accounts...`);

  for (const account of CHART_OF_ACCOUNTS) {
    await prisma.ledgerAccount.upsert({
      where: { code: account.code },
      update: {
        name: account.name,
        type: account.type,
        // Don't touch balance — maintained by trigger
      },
      create: {
        code: account.code,
        name: account.name,
        type: account.type,
        balance: 0,
      },
    });
    console.log(`  ${account.code} — ${account.name} (${account.type})`);
  }

  console.log('Done.');
}

main()
  .catch((e) => {
    console.error('Seed error:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
