/**
 * @deprecated Use import-bank-v2.ts instead (Bank Import V2).
 *
 * Import RazorpayX Bank Statement (Bulk)
 *
 * Imports processed payouts from RazorpayX CSV into the Finance system.
 * Uses bulk inserts (3 queries) instead of row-by-row for speed.
 *
 * Categorization rules live in: server/src/config/finance/bankRules.ts
 *
 * Usage:
 *   cd server
 *   export $(grep -v '^#' .env | xargs)
 *   npx tsx scripts/import-bank-statement.ts [payouts.csv] [statement.csv]
 */

import { PrismaClient } from '@prisma/client';
import { randomUUID } from 'crypto';
import fs from 'fs';
import path from 'path';
import { getVendorRule, PURPOSE_RULES } from '../src/config/finance/bankRules.js';

const prisma = new PrismaClient();

const PAYOUTS_CSV = process.argv[2] || path.resolve(
  process.env.HOME!,
  'Downloads/payouts - 01 Jan 26 - 12 Feb 26.csv'
);

const STATEMENT_CSV = process.argv[3] || path.resolve(
  process.env.HOME!,
  'Downloads/account_statements - 01 Jan 26 - 11 Feb 26.csv'
);

// ============================================
// CSV PARSER
// ============================================

function parseCSVLine(line: string): string[] {
  const result: string[] = [];
  let current = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const char = line[i];
    if (inQuotes) {
      if (char === '"') {
        if (i + 1 < line.length && line[i + 1] === '"') { current += '"'; i++; }
        else { inQuotes = false; }
      } else { current += char; }
    } else {
      if (char === '"') { inQuotes = true; }
      else if (char === ',') { result.push(current); current = ''; }
      else { current += char; }
    }
  }
  result.push(current);
  return result;
}

function parseCSV(filePath: string): Record<string, string>[] {
  const content = fs.readFileSync(filePath, 'utf-8');
  const lines = content.split('\n').filter(l => l.trim());
  if (lines.length < 2) return [];
  const headers = parseCSVLine(lines[0]);
  return lines.slice(1).map(line => {
    const values = parseCSVLine(line);
    const row: Record<string, string> = {};
    headers.forEach((h, i) => { row[h.trim()] = (values[i] ?? '').trim(); });
    return row;
  });
}

// ============================================
// HELPERS
// ============================================

function parseDate(dateStr: string): Date {
  if (!dateStr) return new Date();
  const [datePart, timePart] = dateStr.split(' ');
  const [dd, mm, yyyy] = datePart.split('/');
  if (timePart) return new Date(`${yyyy}-${mm}-${dd}T${timePart}+05:30`);
  return new Date(`${yyyy}-${mm}-${dd}T00:00:00+05:30`);
}

function dateToPeriod(date: Date): string {
  const ist = new Date(date.getTime() + (5.5 * 60 * 60 * 1000));
  return `${ist.getUTCFullYear()}-${String(ist.getUTCMonth() + 1).padStart(2, '0')}`;
}

function extractNoteDescription(notes: string): string | null {
  if (!notes || notes === '{}') return null;
  try {
    const parsed = JSON.parse(notes);
    const keys = Object.keys(parsed);
    if (keys.length > 0 && keys[0] !== 'note') return keys[0];
    return null;
  } catch { return null; }
}

// ============================================
// MAIN
// ============================================

async function main() {
  console.log('=== RazorpayX Bank Statement Import (Bulk) ===\n');
  console.log(`Payouts CSV: ${PAYOUTS_CSV}`);
  console.log(`Statement CSV: ${STATEMENT_CSV}`);

  // Fetch account map + admin once
  const accounts = await prisma.ledgerAccount.findMany({ where: { isActive: true } });
  const accountMap = new Map(accounts.map(a => [a.code, a.id]));
  const admin = await prisma.user.findFirst({ where: { role: 'admin' }, select: { id: true, name: true } });
  if (!admin) throw new Error('No admin user found');
  console.log(`Admin: ${admin.name}`);

  // Fetch existing sourceIds in one query
  const existingEntries = await prisma.ledgerEntry.findMany({
    where: { sourceType: { in: ['bank_payout', 'bank_charge'] } },
    select: { sourceId: true },
  });
  const existingIds = new Set(existingEntries.map(e => e.sourceId));
  console.log(`Existing entries: ${existingIds.size}`);

  // Pre-fetch open payable invoices for auto-matching by reference ID
  const openInvoices = await prisma.invoice.findMany({
    where: {
      type: 'payable',
      status: { in: ['confirmed', 'partially_paid'] },
      balanceDue: { gt: 0.01 },
    },
    select: {
      id: true, invoiceNumber: true, totalAmount: true,
      tdsAmount: true, paidAmount: true, balanceDue: true,
      status: true, partyId: true,
    },
  });
  // Index by invoice number AND by ID (payout ref could be either)
  const invoiceByNumber = new Map<string, typeof openInvoices[0]>();
  const invoiceById = new Map<string, typeof openInvoices[0]>();
  for (const inv of openInvoices) {
    if (inv.invoiceNumber) invoiceByNumber.set(inv.invoiceNumber, inv);
    invoiceById.set(inv.id, inv);
  }
  console.log(`Open invoices for matching: ${openInvoices.length}`);

  // ---- PHASE 1: Import processed payouts ----
  console.log('\n--- Phase 1: Payouts ---');
  const payouts = parseCSV(PAYOUTS_CSV);
  const processed = payouts.filter(r => r.status === 'processed');
  console.log(`Total: ${payouts.length}, Processed: ${processed.length}`);

  const now = new Date();
  const entryBatch: any[] = [];
  const lineBatch: any[] = [];
  const paymentBatch: any[] = [];
  let skipped = 0;
  const categoryCounts: Record<string, { count: number; total: number }> = {};
  // Track payments that matched an invoice for post-insert linking
  const matchQueue: { paymentId: string; invoiceId: string; amount: number }[] = [];

  for (const row of processed) {
    const payoutId = row.payout_id;
    const amount = parseFloat((row.amount ?? '').replace(/,/g, ''));
    const contactName = row.contact_name ?? '';
    const purpose = row.purpose ?? '';
    const utr = row.utr ?? '';
    const notes = row.notes ?? '{}';
    const processedAt = parseDate(row.processed_at || row.created_at);
    const noteDesc = extractNoteDescription(notes);

    if (!payoutId || amount === 0) continue;
    if (existingIds.has(payoutId)) { skipped++; continue; }
    existingIds.add(payoutId); // prevent duplicates within batch

    // Check for invoice reference (from our payout CSV generator)
    const referenceId = (row.reference_id || '').trim();
    const matchedInvoice = referenceId
      ? (invoiceByNumber.get(referenceId) || invoiceById.get(referenceId))
      : null;

    let debitAccount: string;
    let creditAccount = 'BANK_RAZORPAYX';
    let entryDesc: string;
    let paymentMethod = 'bank_transfer';

    if (matchedInvoice && purpose === 'vendor bill') {
      // Invoice exists — route through AP so the books balance
      // Invoice already did: Dr EXPENSE, Cr AP
      // Payment now does:   Dr AP, Cr BANK
      debitAccount = 'ACCOUNTS_PAYABLE';
      entryDesc = `Vendor: ${contactName} — Invoice ${referenceId}`;
    } else if (purpose === 'vendor bill') {
      const info = getVendorRule(contactName, purpose, noteDesc);
      debitAccount = info.debitAccount;
      const desc = noteDesc || info.description || info.category;
      entryDesc = `Vendor: ${desc} — ${contactName}`;
    } else if (PURPOSE_RULES[purpose]) {
      const rule = PURPOSE_RULES[purpose];
      debitAccount = rule.debitAccount;
      entryDesc = purpose === 'refund' ? `Customer refund — ${contactName}`
                : purpose === 'salary' ? `Salary: ${noteDesc || 'Salary'} — ${contactName}`
                : `Razorpay fee`;
      if (purpose === 'rzp_fees') paymentMethod = 'other';
    } else {
      debitAccount = 'UNMATCHED_PAYMENTS';
      entryDesc = `${purpose}: ${contactName}`;
    }

    const debitAccountId = accountMap.get(debitAccount);
    const creditAccountId = accountMap.get(creditAccount);
    if (!debitAccountId || !creditAccountId) {
      console.error(`  ✗ Unknown account: ${debitAccount} or ${creditAccount} — ${contactName}`);
      continue;
    }

    const entryId = randomUUID();

    entryBatch.push({
      id: entryId,
      entryDate: processedAt,
      period: dateToPeriod(processedAt),
      description: entryDesc,
      sourceType: 'bank_payout',
      sourceId: payoutId,
      isReversed: false,
      createdById: admin.id,
      createdAt: now,
      updatedAt: now,
    });

    lineBatch.push(
      { id: randomUUID(), entryId, accountId: debitAccountId, debit: amount, credit: 0, description: entryDesc },
      { id: randomUUID(), entryId, accountId: creditAccountId, debit: 0, credit: amount, description: `UTR: ${utr}` },
    );

    const paymentId = randomUUID();
    paymentBatch.push({
      id: paymentId,
      direction: 'outgoing',
      method: paymentMethod,
      status: 'confirmed',
      amount,
      matchedAmount: matchedInvoice ? amount : 0,
      unmatchedAmount: matchedInvoice ? 0 : amount,
      paymentDate: processedAt,
      referenceNumber: utr || null,
      counterpartyName: contactName || null,
      ...(matchedInvoice?.partyId ? { partyId: matchedInvoice.partyId } : {}),
      ledgerEntryId: entryId,
      notes: noteDesc || purpose,
      createdById: admin.id,
      createdAt: now,
      updatedAt: now,
    });

    // Queue for post-insert matching
    if (matchedInvoice) {
      matchQueue.push({ paymentId, invoiceId: matchedInvoice.id, amount });
    }

    const catKey = entryDesc.split(' —')[0].split(':')[0].trim();
    if (!categoryCounts[catKey]) categoryCounts[catKey] = { count: 0, total: 0 };
    categoryCounts[catKey].count++;
    categoryCounts[catKey].total += amount;
  }

  console.log(`\nPrepared: ${entryBatch.length} entries, ${lineBatch.length} lines, ${paymentBatch.length} payments`);
  console.log(`Skipped: ${skipped} existing\n`);

  // Bulk insert in chunks
  const CHUNK = 500;

  if (entryBatch.length > 0) {
    console.log('Inserting entries...');
    for (let i = 0; i < entryBatch.length; i += CHUNK) {
      await prisma.ledgerEntry.createMany({ data: entryBatch.slice(i, i + CHUNK), skipDuplicates: true });
      process.stdout.write(`  entries: ${Math.min(i + CHUNK, entryBatch.length)}/${entryBatch.length}\r`);
    }
    console.log('');

    console.log('Inserting lines...');
    for (let i = 0; i < lineBatch.length; i += CHUNK) {
      await prisma.ledgerEntryLine.createMany({ data: lineBatch.slice(i, i + CHUNK) });
      process.stdout.write(`  lines: ${Math.min(i + CHUNK, lineBatch.length)}/${lineBatch.length}\r`);
    }
    console.log('');

    console.log('Inserting payments...');
    for (let i = 0; i < paymentBatch.length; i += CHUNK) {
      await prisma.payment.createMany({ data: paymentBatch.slice(i, i + CHUNK) });
      process.stdout.write(`  payments: ${Math.min(i + CHUNK, paymentBatch.length)}/${paymentBatch.length}\r`);
    }
    console.log('');
  }

  // ---- PHASE 2: Auto-match payments to invoices ----
  if (matchQueue.length > 0) {
    console.log(`\n--- Phase 2: Auto-matching ${matchQueue.length} payments to invoices ---`);
    let matched = 0;
    for (const { paymentId, invoiceId, amount } of matchQueue) {
      try {
        await prisma.$transaction(async (tx) => {
          // Create the match record
          await tx.paymentInvoice.create({
            data: {
              id: randomUUID(),
              paymentId,
              invoiceId,
              amount,
              matchedAt: now,
              matchedById: admin.id,
            },
          });

          // Update invoice: increase paid, decrease balance, maybe mark paid
          const invoice = await tx.invoice.findUniqueOrThrow({ where: { id: invoiceId } });
          const newPaid = invoice.paidAmount + amount;
          const newBalance = invoice.balanceDue - amount;
          const newStatus = newBalance <= 0.01 ? 'paid' : 'partially_paid';
          await tx.invoice.update({
            where: { id: invoiceId },
            data: {
              paidAmount: newPaid,
              balanceDue: Math.max(0, newBalance),
              status: newStatus,
            },
          });

          console.log(`  ✓ Matched: ${invoice.invoiceNumber || invoiceId} — Rs ${amount.toLocaleString('en-IN')} → ${newStatus}`);
        });
        matched++;
      } catch (err) {
        console.error(`  ✗ Failed to match payment ${paymentId} → invoice ${invoiceId}:`, err instanceof Error ? err.message : err);
      }
    }
    console.log(`Auto-matched: ${matched}/${matchQueue.length}`);
  }

  // ---- PHASE 3: Bank charges (from statement CSV) ----
  console.log('\n--- Phase 3: Bank Charges ---');
  if (fs.existsSync(STATEMENT_CSV) && STATEMENT_CSV !== '/dev/null') {
    const statement = parseCSV(STATEMENT_CSV);
    const bankCharges = statement.filter(r => r.source_type === 'external' && !(r.utr ?? '').trim());
    console.log(`Bank charges found: ${bankCharges.length}`);

    const chargeEntries: any[] = [];
    const chargeLines: any[] = [];
    let chargeSkipped = 0;

    const opexId = accountMap.get('OPERATING_EXPENSES');
    const bankId = accountMap.get('BANK_RAZORPAYX');

    for (const row of bankCharges) {
      const txnId = row.transaction_id;
      const amount = parseFloat((row.amount ?? '').replace(/,/g, ''));
      const txnDate = parseDate(row.created_at);

      if (existingIds.has(txnId)) { chargeSkipped++; continue; }
      existingIds.add(txnId);

      const entryId = randomUUID();
      chargeEntries.push({
        id: entryId,
        entryDate: txnDate,
        period: dateToPeriod(txnDate),
        description: 'Bank charges (RazorpayX)',
        sourceType: 'bank_charge',
        sourceId: txnId,
        isReversed: false,
        createdById: admin.id,
        createdAt: now,
        updatedAt: now,
      });

      chargeLines.push(
        { id: randomUUID(), entryId, accountId: opexId, debit: amount, credit: 0, description: 'Bank charges' },
        { id: randomUUID(), entryId, accountId: bankId, debit: 0, credit: amount, description: 'Bank charge debit' },
      );
    }

    if (chargeEntries.length > 0) {
      for (let i = 0; i < chargeEntries.length; i += CHUNK) {
        await prisma.ledgerEntry.createMany({ data: chargeEntries.slice(i, i + CHUNK), skipDuplicates: true });
      }
      for (let i = 0; i < chargeLines.length; i += CHUNK) {
        await prisma.ledgerEntryLine.createMany({ data: chargeLines.slice(i, i + CHUNK) });
      }
    }
    console.log(`Bank charges: ${chargeEntries.length} created, ${chargeSkipped} skipped`);
  } else {
    console.log('No statement CSV provided, skipping bank charges.');
  }

  // ---- SUMMARY ----
  console.log('\n--- Category Breakdown ---');
  const sorted = Object.entries(categoryCounts).sort((a, b) => b[1].total - a[1].total);
  for (const [cat, data] of sorted) {
    console.log(`  ${cat.padEnd(40)} ${String(data.count).padStart(3)}x  Rs ${data.total.toLocaleString('en-IN', { minimumFractionDigits: 2 }).padStart(14)}`);
  }

  console.log('\n--- Account Balances ---');
  const finalAccounts = await prisma.ledgerAccount.findMany({
    where: { isActive: true },
    select: { code: true, name: true, balance: true },
    orderBy: { code: 'asc' },
  });
  for (const a of finalAccounts) {
    if (Math.abs(a.balance) > 0.01) {
      const fmt = a.balance < 0
        ? `-Rs ${Math.abs(a.balance).toLocaleString('en-IN', { minimumFractionDigits: 2 })}`
        : `Rs ${a.balance.toLocaleString('en-IN', { minimumFractionDigits: 2 })}`;
      console.log(`  ${a.code.padEnd(22)} ${a.name.padEnd(30)} ${fmt.padStart(16)}`);
    }
  }

  console.log(`\n=== Done! ${entryBatch.length} payout entries created ===`);
  await prisma.$disconnect();
}

main().catch(err => { console.error('Fatal:', err); process.exit(1); });
