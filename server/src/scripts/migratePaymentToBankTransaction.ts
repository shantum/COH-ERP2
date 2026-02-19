/**
 * Data Migration: Merge Payment into BankTransaction
 *
 * One-shot script that:
 * 1. Resolves 5 orphaned Payments (no linked BankTransaction)
 * 2. Copies matchedAmount, unmatchedAmount, notes, file/drive fields from Payment → BankTransaction
 * 3. Sets Allocation.bankTransactionId from BankTransaction linked to each Allocation's Payment
 * 4. Verifies all Allocations have bankTransactionId
 *
 * Usage:
 *   npx ts-node server/src/scripts/migratePaymentToBankTransaction.ts
 */

import 'dotenv/config';
import { getPrisma } from '@coh/shared/services/db';
import crypto from 'crypto';

async function migrate() {
  const prisma = await getPrisma();

  console.log('=== Phase 2: Data Migration — Payment → BankTransaction ===\n');

  // ─── Step 1: Resolve orphaned Payments ───

  console.log('Step 1: Resolving orphaned Payments...\n');

  await prisma.$transaction(async (tx) => {
    // 1a. Google Ads — link BankTxn d644319c to Payment 59c8dfff
    const googleAdsBt = await tx.bankTransaction.update({
      where: { id: 'd644319c-286e-4c55-8f29-ca1fb56fe9b6' },
      data: { paymentId: '59c8dfff-630f-4e4b-9824-18465483fce8' },
    });
    console.log(`  ✓ Google Ads: linked BankTxn ${googleAdsBt.id} to Payment 59c8dfff`);

    // 1b. Arkap Rib Balance (orphan e3cdcbe2) — move allocations to real payment fae8f800
    // The real Payment fae8f800 is on BankTxn f46ecefb and has 0 allocations
    const arkapRibAllocations = await tx.allocation.findMany({
      where: { paymentId: 'e3cdcbe2-b45b-4f9d-bb91-7f0df9f0d1d5' },
    });
    for (const alloc of arkapRibAllocations) {
      await tx.allocation.update({
        where: { id: alloc.id },
        data: { paymentId: 'fae8f800-ede6-4a6c-8a0c-346fd34bffc2' },
      });
    }
    // Update real payment's matchedAmount
    await tx.payment.update({
      where: { id: 'fae8f800-ede6-4a6c-8a0c-346fd34bffc2' },
      data: { matchedAmount: 52845, unmatchedAmount: 0 },
    });
    // Delete orphan
    await tx.payment.delete({ where: { id: 'e3cdcbe2-b45b-4f9d-bb91-7f0df9f0d1d5' } });
    console.log(`  ✓ Arkap Rib: moved ${arkapRibAllocations.length} allocation(s), deleted orphan e3cdcbe2`);

    // 1c. Arkap Advance (orphan b4cc98a0) — move allocations to real payment 0efc39af
    const arkapAdvAllocations = await tx.allocation.findMany({
      where: { paymentId: 'b4cc98a0-8d97-485c-b9ea-1a2c1625b6db' },
    });
    for (const alloc of arkapAdvAllocations) {
      await tx.allocation.update({
        where: { id: alloc.id },
        data: { paymentId: '0efc39af-2878-480b-8200-8888e0c0cd21' },
      });
    }
    await tx.payment.update({
      where: { id: '0efc39af-2878-480b-8200-8888e0c0cd21' },
      data: { matchedAmount: 25000, unmatchedAmount: 0 },
    });
    await tx.payment.delete({ where: { id: 'b4cc98a0-8d97-485c-b9ea-1a2c1625b6db' } });
    console.log(`  ✓ Arkap Advance: moved ${arkapAdvAllocations.length} allocation(s), deleted orphan b4cc98a0`);

    // 1d. WATI Pro (orphan e16ed2f6) — create synthetic BankTransaction
    const watiPayment = await tx.payment.findUniqueOrThrow({
      where: { id: 'e16ed2f6-beac-485e-8da0-816874e755f3' },
    });
    const watiHash = crypto.createHash('sha256')
      .update(`synthetic_wati_${watiPayment.id}`)
      .digest('hex');
    const watiBt = await tx.bankTransaction.create({
      data: {
        bank: 'hdfc_cc',
        txnHash: watiHash,
        rawData: { synthetic: true, source: 'migration', originalPaymentId: watiPayment.id },
        txnDate: watiPayment.paymentDate,
        amount: watiPayment.amount,
        direction: 'debit',
        narration: 'WATI.IO TSIM SHA T (synthetic — Jan 2026 CC statement not yet imported)',
        reference: watiPayment.referenceNumber,
        period: watiPayment.period,
        counterpartyName: 'WATI Pro',
        debitAccountCode: watiPayment.debitAccountCode,
        creditAccountCode: 'CREDIT_CARD',
        category: 'software',
        partyId: watiPayment.partyId,
        status: 'posted',
        paymentId: watiPayment.id,
      },
    });
    console.log(`  ✓ WATI Pro: created synthetic BankTxn ${watiBt.id}, linked to Payment e16ed2f6`);

    // 1e. Meghana refund (orphan 1aa24b67) — no allocations, safe to delete
    await tx.payment.delete({ where: { id: '1aa24b67-58d2-44ad-a7da-7c3818fcf4b7' } });
    console.log(`  ✓ Meghana refund: deleted orphan 1aa24b67 (no allocations)`);
  });

  console.log('\nStep 1 complete. Verifying no orphans remain...');
  const remainingOrphans = await prisma.$queryRaw<Array<{ count: bigint }>>`
    SELECT COUNT(*) as count FROM "Payment" p
    LEFT JOIN "BankTransaction" bt ON bt."paymentId" = p.id
    WHERE bt.id IS NULL
  `;
  console.log(`  Orphaned Payments: ${remainingOrphans[0].count}\n`);
  if (Number(remainingOrphans[0].count) > 0) {
    throw new Error('Still have orphaned Payments! Aborting.');
  }

  // ─── Step 2: Copy Payment fields → BankTransaction ───

  console.log('Step 2: Copying Payment fields to BankTransaction...\n');

  // Get all BankTransactions with linked Payments
  const bankTxns = await prisma.bankTransaction.findMany({
    where: { paymentId: { not: null } },
    select: {
      id: true,
      paymentId: true,
      payment: {
        select: {
          matchedAmount: true,
          unmatchedAmount: true,
          notes: true,
          fileData: true,
          fileName: true,
          fileMimeType: true,
          fileSizeBytes: true,
          driveFileId: true,
          driveUrl: true,
          driveUploadedAt: true,
        },
      },
    },
  });

  console.log(`  Found ${bankTxns.length} BankTransactions with linked Payments`);

  // Batch update in chunks
  const CHUNK_SIZE = 100;
  let updated = 0;
  for (let i = 0; i < bankTxns.length; i += CHUNK_SIZE) {
    const chunk = bankTxns.slice(i, i + CHUNK_SIZE);
    await prisma.$transaction(
      chunk.map((bt) => {
        const p = bt.payment!;
        return prisma.bankTransaction.update({
          where: { id: bt.id },
          data: {
            matchedAmount: p.matchedAmount,
            unmatchedAmount: p.unmatchedAmount,
            notes: p.notes,
            fileData: p.fileData,
            fileName: p.fileName,
            fileMimeType: p.fileMimeType,
            fileSizeBytes: p.fileSizeBytes,
            driveFileId: p.driveFileId,
            driveUrl: p.driveUrl,
            driveUploadedAt: p.driveUploadedAt,
          },
        });
      })
    );
    updated += chunk.length;
    if (updated % 500 === 0) console.log(`  ...${updated}/${bankTxns.length}`);
  }
  console.log(`  ✓ Copied fields for ${updated} BankTransactions\n`);

  // ─── Step 3: Set Allocation.bankTransactionId ───

  console.log('Step 3: Setting Allocation.bankTransactionId...\n');

  // For each allocation, find the BankTransaction linked to its Payment
  const allocations = await prisma.allocation.findMany({
    where: { bankTransactionId: null },
    select: { id: true, paymentId: true },
  });

  console.log(`  Found ${allocations.length} Allocations needing bankTransactionId`);

  if (allocations.length > 0) {
    // Build paymentId → bankTransactionId map
    const paymentIds = [...new Set(allocations.map((a) => a.paymentId).filter(Boolean))] as string[];
    const btByPayment = await prisma.bankTransaction.findMany({
      where: { paymentId: { in: paymentIds } },
      select: { id: true, paymentId: true },
    });
    const paymentToBt = new Map(btByPayment.map((bt) => [bt.paymentId!, bt.id]));

    let linked = 0;
    let missing = 0;
    for (let i = 0; i < allocations.length; i += CHUNK_SIZE) {
      const chunk = allocations.slice(i, i + CHUNK_SIZE);
      const updates = chunk
        .map((alloc) => {
          const btId = alloc.paymentId ? paymentToBt.get(alloc.paymentId) : undefined;
          if (!btId) {
            console.warn(`  ⚠ Allocation ${alloc.id} — no BankTxn for Payment ${alloc.paymentId}`);
            missing++;
            return null;
          }
          return prisma.allocation.update({
            where: { id: alloc.id },
            data: { bankTransactionId: btId },
          });
        })
        .filter(Boolean) as ReturnType<typeof prisma.allocation.update>[];

      if (updates.length > 0) {
        await prisma.$transaction(updates);
        linked += updates.length;
      }
    }
    console.log(`  ✓ Linked ${linked} Allocations, ${missing} missing\n`);
  }

  // ─── Step 4: Verify ───

  console.log('Step 4: Verification...\n');

  const [allocWithout, allocTotal, btWithMatched] = await Promise.all([
    prisma.allocation.count({ where: { bankTransactionId: null } }),
    prisma.allocation.count(),
    prisma.bankTransaction.count({ where: { matchedAmount: { gt: 0 } } }),
  ]);

  console.log(`  Total Allocations: ${allocTotal}`);
  console.log(`  Allocations without bankTransactionId: ${allocWithout}`);
  console.log(`  BankTransactions with matchedAmount > 0: ${btWithMatched}`);

  if (allocWithout > 0) {
    console.error('\n  ✗ FAILED — some Allocations still missing bankTransactionId!');
    process.exit(1);
  }

  console.log('\n=== Migration complete! ===');
  process.exit(0);
}

migrate().catch((err) => {
  console.error('Migration failed:', err);
  process.exit(1);
});
