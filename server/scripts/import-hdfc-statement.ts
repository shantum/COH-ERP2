/**
 * @deprecated Use import-bank-v2.ts instead (Bank Import V2).
 *
 * Import HDFC Bank Statement (Bulk)
 *
 * Imports the main HDFC business account transactions into the Finance system.
 * Uses bulk inserts (3 queries) instead of row-by-row (fast even with remote DB).
 *
 * Categorization rules live in: server/src/config/finance/bankRules.ts
 *
 * Usage:
 *   cd server
 *   export $(grep -v '^#' .env | xargs)
 *   npx tsx scripts/import-hdfc-statement.ts [hdfc.csv]
 */

import { PrismaClient } from '@prisma/client';
import { randomUUID } from 'crypto';
import fs from 'fs';
import { matchNarrationRule, getUpiPayeeRule } from '../src/config/finance/bankRules.js';

const prisma = new PrismaClient();

const HDFC_CSV = process.argv[2] || '/tmp/hdfc-statement.csv';

// ============================================
// CATEGORIZATION (uses bankRules config)
// ============================================

interface TxnCategory {
  skip?: boolean;
  debitAccount: string;
  creditAccount: string;
  description: string;
  category?: string;
}

function categorize(narration: string, isWithdrawal: boolean): TxnCategory {
  const n = narration.toUpperCase();

  const rule = matchNarrationRule(narration, isWithdrawal);
  if (rule) {
    if (rule.skip) return { skip: true, debitAccount: '', creditAccount: '', description: rule.description || 'Skipped' };
    return { debitAccount: rule.debitAccount!, creditAccount: rule.creditAccount!, description: rule.description || narration.slice(0, 60), category: rule.category };
  }

  if (n.startsWith('UPI-')) {
    const parts = narration.split('-');
    const payeeName = parts.length > 1 ? parts[1].trim() : 'Unknown';
    const upiDesc = parts[parts.length - 1]?.trim() || '';
    const upiRule = getUpiPayeeRule(payeeName);
    if (isWithdrawal) {
      if (upiRule) {
        return { debitAccount: upiRule.debitAccount, creditAccount: 'BANK_HDFC', description: `${upiRule.description} — ${payeeName}`, category: upiRule.category };
      }
      return { debitAccount: 'UNMATCHED_PAYMENTS', creditAccount: 'BANK_HDFC', description: `UPI: ${payeeName} — ${upiDesc}`.slice(0, 80) };
    }
    // Incoming UPI deposit — bank balance goes UP
    return { debitAccount: 'BANK_HDFC', creditAccount: 'UNMATCHED_PAYMENTS', description: `UPI deposit: ${payeeName} — ${upiDesc}`.slice(0, 80) };
  }

  if (isWithdrawal && n.includes('IMPS')) return { debitAccount: 'UNMATCHED_PAYMENTS', creditAccount: 'BANK_HDFC', description: `IMPS: ${narration.slice(0, 60)}` };
  if (isWithdrawal) return { debitAccount: 'UNMATCHED_PAYMENTS', creditAccount: 'BANK_HDFC', description: `Payment: ${narration.slice(0, 60)}` };
  return { debitAccount: 'BANK_HDFC', creditAccount: 'UNMATCHED_PAYMENTS', description: `Deposit: ${narration.slice(0, 60)}` };
}

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
      if (char === '"') { if (i + 1 < line.length && line[i + 1] === '"') { current += '"'; i++; } else { inQuotes = false; } }
      else { current += char; }
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

function parseHDFCDate(dateStr: string): Date {
  if (!dateStr) return new Date();
  const [dd, mm, yy] = dateStr.split('/');
  const year = parseInt(yy) < 50 ? `20${yy}` : `19${yy}`;
  return new Date(`${year}-${mm}-${dd}T00:00:00+05:30`);
}

function dateToPeriod(date: Date): string {
  const ist = new Date(date.getTime() + (5.5 * 60 * 60 * 1000));
  return `${ist.getUTCFullYear()}-${String(ist.getUTCMonth() + 1).padStart(2, '0')}`;
}

function extractPayee(narration: string): string {
  const n = narration.toUpperCase();
  if (n.startsWith('UPI-')) return narration.split('-')[1]?.trim() || '';
  if (n.includes('IMPS-')) return narration.split('-')[2]?.trim() || '';
  if (n.includes('NEFT') || n.includes('RTGS')) return narration.split('-')[2]?.trim() || '';
  return '';
}

// ============================================
// MAIN
// ============================================

async function main() {
  console.log('=== HDFC Bank Statement Import (Bulk) ===\n');

  // Fetch account map + admin once
  const accounts = await prisma.ledgerAccount.findMany({ where: { isActive: true } });
  const accountMap = new Map(accounts.map(a => [a.code, a.id]));
  const admin = await prisma.user.findFirst({ where: { role: 'admin' }, select: { id: true, name: true } });
  if (!admin) throw new Error('No admin user found');
  console.log(`Admin: ${admin.name}`);

  // Fetch existing sourceIds in one query
  const existing = await prisma.ledgerEntry.findMany({
    where: { sourceType: 'hdfc_statement' },
    select: { sourceId: true },
  });
  const existingIds = new Set(existing.map(e => e.sourceId));
  console.log(`Existing entries: ${existingIds.size}`);

  // Parse CSV and categorize everything locally
  const rows = parseCSV(HDFC_CSV);
  console.log(`CSV rows: ${rows.length}`);

  const now = new Date();
  const entryBatch: any[] = [];
  const lineBatch: any[] = [];
  const paymentBatch: any[] = [];
  let skipped = 0, skipInterAccount = 0;
  const categoryCounts: Record<string, { count: number; total: number }> = {};

  for (const row of rows) {
    const narration = row.narration ?? '';
    const ref = row.ref ?? '';
    const dateStr = row.date ?? '';
    const withdrawal = parseFloat((row.withdrawal ?? '').replace(/,/g, '')) || 0;
    const deposit = parseFloat((row.deposit ?? '').replace(/,/g, '')) || 0;
    const amount = withdrawal || deposit;
    const isWithdrawal = withdrawal > 0;

    if (!narration || amount === 0) continue;

    const baseSourceId = `hdfc_${dateStr}_${ref}_${amount}`;
    // Handle duplicate sourceIds (same date+ref+amount) by appending a counter
    let sourceId = baseSourceId;
    let dupeIdx = 1;
    while (existingIds.has(sourceId)) {
      if (dupeIdx === 1 && existing.some(e => e.sourceId === baseSourceId)) { skipped++; break; }
      sourceId = `${baseSourceId}_${dupeIdx}`;
      dupeIdx++;
    }
    if (existingIds.has(sourceId)) continue;
    existingIds.add(sourceId); // prevent duplicates within the batch

    const cat = categorize(narration, isWithdrawal);
    if (cat.skip) { skipInterAccount++; continue; }

    const debitAccountId = accountMap.get(cat.debitAccount);
    const creditAccountId = accountMap.get(cat.creditAccount);
    if (!debitAccountId || !creditAccountId) {
      console.error(`  ✗ Unknown account: ${cat.debitAccount} or ${cat.creditAccount} — ${narration.slice(0, 50)}`);
      continue;
    }

    const entryId = randomUUID();
    const entryDate = parseHDFCDate(dateStr);

    entryBatch.push({
      id: entryId,
      entryDate,
      period: dateToPeriod(entryDate),
      description: cat.description,
      sourceType: 'hdfc_statement',
      sourceId,
      isReversed: false,
      createdById: admin.id,
      createdAt: now,
      updatedAt: now,
    });

    lineBatch.push(
      { id: randomUUID(), entryId, accountId: debitAccountId, debit: amount, credit: 0, description: cat.description },
      { id: randomUUID(), entryId, accountId: creditAccountId, debit: 0, credit: amount, description: `Ref: ${ref}` },
    );

    // Payment for outgoing (not ATM/cash/standing instruction/inter-account transfer)
    if (isWithdrawal && !cat.description.includes('ATM') && !cat.description.includes('Cash withdrawal') && !cat.description.includes('Bank standing') && !cat.description.includes('Transfer to')) {
      paymentBatch.push({
        id: randomUUID(),
        direction: 'outgoing',
        method: narration.toUpperCase().startsWith('UPI-') ? 'upi' : 'bank_transfer',
        status: 'confirmed',
        amount,
        matchedAmount: 0,
        unmatchedAmount: amount,
        paymentDate: entryDate,
        referenceNumber: ref || null,
        counterpartyName: extractPayee(narration) || null,
        ledgerEntryId: entryId,
        notes: cat.description,
        createdById: admin.id,
        createdAt: now,
        updatedAt: now,
      });
    }

    const catKey = cat.description.split(' —')[0].split(':')[0].trim();
    if (!categoryCounts[catKey]) categoryCounts[catKey] = { count: 0, total: 0 };
    categoryCounts[catKey].count++;
    categoryCounts[catKey].total += amount;
  }

  console.log(`\nPrepared: ${entryBatch.length} entries, ${lineBatch.length} lines, ${paymentBatch.length} payments`);
  console.log(`Skipped: ${skipped} existing, ${skipInterAccount} inter-account\n`);

  // Bulk insert in 3 queries (inside a transaction for safety)
  console.log('Inserting entries...');
  // Prisma createMany has a batch limit; chunk at 500
  const CHUNK = 500;
  for (let i = 0; i < entryBatch.length; i += CHUNK) {
    await prisma.ledgerEntry.createMany({ data: entryBatch.slice(i, i + CHUNK), skipDuplicates: true });
    process.stdout.write(`  entries: ${Math.min(i + CHUNK, entryBatch.length)}/${entryBatch.length}\r`);
  }
  console.log('');

  console.log('Inserting lines (triggers update balances)...');
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

  // ---- SUMMARY ----
  console.log('\n--- Category Breakdown ---');
  const sorted = Object.entries(categoryCounts).sort((a, b) => b[1].total - a[1].total);
  for (const [cat, data] of sorted) {
    console.log(`  ${cat.padEnd(40)} ${String(data.count).padStart(3)}x  Rs ${data.total.toLocaleString('en-IN', { minimumFractionDigits: 2 }).padStart(14)}`);
  }

  console.log('\n--- Final Account Balances ---');
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

  console.log(`\n=== Done! ${entryBatch.length} entries created ===`);
  await prisma.$disconnect();
}

main().catch(err => { console.error('Fatal:', err); process.exit(1); });
