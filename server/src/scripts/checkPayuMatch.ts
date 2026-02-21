import prisma from '../lib/prisma.js';

async function main() {
  const s = await prisma.payuSettlement.findFirst({
    where: { transactionCount: { gt: 0 } },
    orderBy: { settlementCompletedDate: 'desc' },
  });
  if (!s) { console.log('none'); return; }

  const txns = s.transactions as Array<{ merchantTransactionId: string; transactionAmount: number; transactionDate: string; action: string }>;
  console.log(`Settlement ${s.settlementId}, date: ${s.settlementCompletedDate}, txns: ${txns.length}`);

  for (const t of txns.slice(0, 6)) {
    const amt = typeof t.transactionAmount === 'string' ? parseFloat(t.transactionAmount) : t.transactionAmount;
    const txnDate = new Date(t.transactionDate);
    const dayBefore = new Date(txnDate.getTime() - 2 * 86400000);
    const dayAfter = new Date(txnDate.getTime() + 2 * 86400000);

    const matches = await prisma.order.findMany({
      where: {
        paymentMethod: 'Prepaid',
        totalAmount: { gte: amt - 1, lte: amt + 1 },
        orderDate: { gte: dayBefore, lte: dayAfter },
      },
      select: { orderNumber: true, totalAmount: true, orderDate: true },
    });
    console.log(`  ${t.merchantTransactionId.substring(0,8)} | ${t.transactionDate} | ${amt} | ${t.action} -> ${matches.length} matches: ${matches.map(o => `${o.orderNumber}(${o.totalAmount})`).join(', ')}`);
  }

  // Check: does Shopify store checkout_token in noteAttributes?
  const firstTxnId = txns[0].merchantTransactionId;
  const cacheHit = await prisma.$queryRaw<Array<{orderNumber: string}>>`
    SELECT "orderNumber" FROM "ShopifyOrderCache"
    WHERE "noteAttributesJson"::text LIKE ${'%' + firstTxnId + '%'}
    LIMIT 1
  `;
  console.log(`\nSearch noteAttributes for ${firstTxnId}: ${cacheHit.length > 0 ? cacheHit[0].orderNumber : 'not found'}`);

  await prisma.$disconnect();
}

main().catch(console.error);
