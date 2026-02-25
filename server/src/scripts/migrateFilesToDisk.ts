/**
 * One-time migration: copy invoice/bank-transaction file blobs from DB to disk.
 *
 * Idempotent — skips rows that already have a filePath set.
 * Processes in batches of 10 to avoid memory issues with large blobs.
 *
 * Usage: cd server && npx tsx src/scripts/migrateFilesToDisk.ts
 */

import 'dotenv/config';
import prisma from '../lib/prisma.js';
import { init, saveFile, buildInvoicePath, buildBankTransactionPath } from '../services/fileStorageService.js';

async function main() {
  await init();
  console.log('File storage initialized');

  // ── Invoices ──────────────────────────────
  let invoiceMigrated = 0;
  let invoiceErrors = 0;

  while (true) {
    const batch = await prisma.invoice.findMany({
      where: {
        fileData: { not: null },
        filePath: null,
      },
      select: {
        id: true,
        fileData: true,
        fileName: true,
        invoiceDate: true,
        createdAt: true,
        party: { select: { name: true } },
      },
      take: 10,
    });

    if (batch.length === 0) break;

    for (const inv of batch) {
      try {
        const date = inv.invoiceDate ?? inv.createdAt;
        const fileName = inv.fileName ?? `invoice-${inv.id.slice(0, 8)}.bin`;
        const filePath = buildInvoicePath(inv.party?.name, date, fileName);

        await saveFile(filePath, Buffer.from(inv.fileData!));
        await prisma.invoice.update({
          where: { id: inv.id },
          data: { filePath },
        });

        invoiceMigrated++;
        console.log(`  ✓ Invoice ${inv.id.slice(0, 8)} → ${filePath}`);
      } catch (err: unknown) {
        invoiceErrors++;
        console.error(`  ✗ Invoice ${inv.id.slice(0, 8)}: ${err instanceof Error ? err.message : err}`);
      }
    }
  }

  console.log(`\nInvoices: ${invoiceMigrated} migrated, ${invoiceErrors} errors`);

  // ── Bank Transactions ──────────────────────
  let bankTxnMigrated = 0;
  let bankTxnErrors = 0;

  while (true) {
    const batch = await prisma.bankTransaction.findMany({
      where: {
        fileData: { not: null },
        filePath: null,
      },
      select: {
        id: true,
        fileData: true,
        fileName: true,
        txnDate: true,
        party: { select: { name: true } },
      },
      take: 10,
    });

    if (batch.length === 0) break;

    for (const bt of batch) {
      try {
        const fileName = bt.fileName ?? `bank-txn-${bt.id.slice(0, 8)}.bin`;
        const filePath = buildBankTransactionPath(bt.party?.name, bt.txnDate, fileName);

        await saveFile(filePath, Buffer.from(bt.fileData!));
        await prisma.bankTransaction.update({
          where: { id: bt.id },
          data: { filePath },
        });

        bankTxnMigrated++;
        console.log(`  ✓ BankTxn ${bt.id.slice(0, 8)} → ${filePath}`);
      } catch (err: unknown) {
        bankTxnErrors++;
        console.error(`  ✗ BankTxn ${bt.id.slice(0, 8)}: ${err instanceof Error ? err.message : err}`);
      }
    }
  }

  console.log(`Bank transactions: ${bankTxnMigrated} migrated, ${bankTxnErrors} errors`);
  console.log(`\nDone! Total: ${invoiceMigrated + bankTxnMigrated} files migrated to disk.`);

  await prisma.$disconnect();
}

main().catch((err) => {
  console.error('Migration failed:', err);
  process.exit(1);
});
