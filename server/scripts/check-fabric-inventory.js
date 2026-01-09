import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();

async function main() {
  // Get fabrics with their transaction counts
  const fabrics = await prisma.fabric.findMany({
    include: {
      fabricType: true,
      _count: { select: { transactions: true } }
    }
  });

  console.log('=== FABRICS: Transaction Entries vs Calculated Balance ===\n');

  let issues = [];

  for (const f of fabrics) {
    // Calculate balance from transactions (inward - outward)
    const inward = await prisma.fabricTransaction.aggregate({
      where: { fabricId: f.id, txnType: 'inward' },
      _sum: { qty: true }
    });
    const outward = await prisma.fabricTransaction.aggregate({
      where: { fabricId: f.id, txnType: 'outward' },
      _sum: { qty: true }
    });

    const inwardQty = inward._sum.qty || 0;
    const outwardQty = outward._sum.qty || 0;
    const balance = inwardQty - outwardQty;

    if (f._count.transactions === 0 && balance !== 0) {
      issues.push({ name: f.name, entries: f._count.transactions, balance });
    }

    if (f._count.transactions > 0 || balance !== 0) {
      console.log(`${f.name} | Txns: ${f._count.transactions} | In: ${inwardQty} | Out: ${outwardQty} | Balance: ${balance}`);
    }
  }

  if (issues.length > 0) {
    console.log('\n=== ISSUES: Fabrics with balance but no transactions ===');
    issues.forEach(i => console.log(`  ${i.name}: ${i.balance} (${i.entries} txns)`));
  } else {
    console.log('\n=== No issues found - all balances match transaction counts ===');
  }
}

main().catch(console.error).finally(() => prisma.$disconnect());
