/**
 * Bank Import V2 — Import Service
 *
 * Imports raw bank rows into BankTransaction table with hash-based dedup.
 * Supports: HDFC bank, RazorpayX payouts, RazorpayX charges, HDFC CC, ICICI CC.
 *
 * Each row gets a SHA-256 hash for dedup and a legacySourceId for audit matching.
 */

import { Prisma, PrismaClient } from '@prisma/client';
import { createHash, randomUUID } from 'crypto';
import fs from 'fs';

type JsonValue = Prisma.InputJsonValue;

const prisma = new PrismaClient();

// ============================================
// TYPES
// ============================================

export interface ImportResult {
  bank: string;
  fileName: string;
  totalRows: number;
  newRows: number;
  skippedRows: number;
  totalDebits: number;
  totalCredits: number;
  openingBalance?: number;
  closingBalance?: number;
  balanceMatched?: boolean;
  batchId: string;
}

interface RawRow {
  txnDate: Date;
  amount: number;
  direction: 'debit' | 'credit';
  narration?: string;
  reference?: string;
  utr?: string;
  closingBalance?: number;
  counterpartyName?: string;
  rawData: Record<string, unknown>;
  txnHash: string;
  legacySourceId: string;
}

// ============================================
// CSV PARSER (extracted from old scripts)
// ============================================

export function parseCSVLine(line: string): string[] {
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
// HASH HELPERS
// ============================================

function sha256(input: string): string {
  return createHash('sha256').update(input).digest('hex');
}

// ============================================
// DATE HELPERS
// ============================================

function parseHDFCDate(dateStr: string): Date {
  if (!dateStr) return new Date();
  const [dd, mm, yy] = dateStr.split('/');
  const year = parseInt(yy) < 50 ? `20${yy}` : `19${yy}`;
  return new Date(`${year}-${mm}-${dd}T00:00:00+05:30`);
}

function parseRazorpayDate(dateStr: string): Date {
  if (!dateStr) return new Date();
  const [datePart, timePart] = dateStr.split(' ');
  const [dd, mm, yyyy] = datePart.split('/');
  if (timePart) return new Date(`${yyyy}-${mm}-${dd}T${timePart}+05:30`);
  return new Date(`${yyyy}-${mm}-${dd}T00:00:00+05:30`);
}

// ============================================
// HDFC BANK IMPORT
// ============================================

export async function importHdfcStatement(filePath: string): Promise<ImportResult> {
  const rows = parseCSV(filePath);
  const fileName = filePath.split('/').pop() || filePath;
  const batchId = randomUUID();

  // Fetch existing hashes
  const existingHashes = new Set(
    (await prisma.bankTransaction.findMany({
      where: { bank: 'hdfc' },
      select: { txnHash: true },
    })).map(t => t.txnHash)
  );

  const parsed: RawRow[] = [];

  for (const row of rows) {
    const narration = row.narration ?? '';
    const ref = row.ref ?? '';
    const dateStr = row.date ?? '';
    const withdrawal = parseFloat((row.withdrawal ?? '').replace(/,/g, '')) || 0;
    const deposit = parseFloat((row.deposit ?? '').replace(/,/g, '')) || 0;
    const closingBal = parseFloat((row.closing_balance ?? row['closing balance'] ?? '').replace(/,/g, '')) || undefined;
    const amount = withdrawal || deposit;
    const isWithdrawal = withdrawal > 0;

    if (!narration || amount === 0) continue;

    const txnHash = sha256(`hdfc|${dateStr}|${narration}|${withdrawal}|${deposit}|${closingBal ?? ''}`);
    const legacySourceId = `hdfc_${dateStr}_${ref}_${amount}`;

    parsed.push({
      txnDate: parseHDFCDate(dateStr),
      amount,
      direction: isWithdrawal ? 'debit' : 'credit',
      narration,
      reference: ref || undefined,
      closingBalance: closingBal,
      rawData: row,
      txnHash,
      legacySourceId,
    });
  }

  // Balance validation
  let balanceMatched: boolean | undefined;
  let openingBalance: number | undefined;
  let closingBalance: number | undefined;

  if (parsed.length > 0 && parsed[0].closingBalance !== undefined) {
    const first = parsed[0];
    const deposit = first.direction === 'credit' ? first.amount : 0;
    const withdrawal = first.direction === 'debit' ? first.amount : 0;
    openingBalance = first.closingBalance! - deposit + withdrawal;
    closingBalance = parsed[parsed.length - 1].closingBalance;

    // Verify each row's closing balance
    balanceMatched = true;
    let prevClosing = openingBalance;
    for (const row of parsed) {
      if (row.closingBalance === undefined) continue;
      const dep = row.direction === 'credit' ? row.amount : 0;
      const wd = row.direction === 'debit' ? row.amount : 0;
      const expected = prevClosing + dep - wd;
      if (Math.abs(expected - row.closingBalance) > 0.01) {
        balanceMatched = false;
      }
      prevClosing = row.closingBalance;
    }
  }

  // Filter to new only
  const newRows = parsed.filter(r => !existingHashes.has(r.txnHash));

  // Bulk insert
  let totalDebits = 0;
  let totalCredits = 0;
  const CHUNK = 500;
  const txnData = newRows.map(r => {
    if (r.direction === 'debit') totalDebits += r.amount;
    else totalCredits += r.amount;

    return {
      id: randomUUID(),
      bank: 'hdfc',
      txnHash: r.txnHash,
      rawData: r.rawData as JsonValue,
      txnDate: r.txnDate,
      amount: r.amount,
      direction: r.direction,
      narration: r.narration,
      reference: r.reference,
      closingBalance: r.closingBalance,
      legacySourceId: r.legacySourceId,
      batchId,
      status: 'imported',
    };
  });

  // Create batch record first (FK constraint)
  await prisma.bankImportBatch.create({
    data: {
      id: batchId,
      bank: 'hdfc',
      fileName,
      rowCount: parsed.length,
      newCount: newRows.length,
      skippedCount: parsed.length - newRows.length,
      totalDebits,
      totalCredits,
      openingBalance,
      closingBalance,
      balanceMatched,
    },
  });

  for (let i = 0; i < txnData.length; i += CHUNK) {
    await prisma.bankTransaction.createMany({
      data: txnData.slice(i, i + CHUNK),
      skipDuplicates: true,
    });
  }

  return {
    bank: 'hdfc',
    fileName,
    totalRows: parsed.length,
    newRows: newRows.length,
    skippedRows: parsed.length - newRows.length,
    totalDebits,
    totalCredits,
    openingBalance,
    closingBalance,
    balanceMatched,
    batchId,
  };
}

// ============================================
// RAZORPAYX PAYOUTS IMPORT
// ============================================

function extractNoteDescription(notes: string): string | null {
  if (!notes || notes === '{}') return null;
  try {
    const parsed = JSON.parse(notes);
    const keys = Object.keys(parsed);
    if (keys.length > 0 && keys[0] !== 'note') return keys[0];
    return null;
  } catch { return null; }
}

export async function importRazorpayxPayouts(filePath: string): Promise<ImportResult> {
  const rows = parseCSV(filePath);
  const fileName = filePath.split('/').pop() || filePath;
  const batchId = randomUUID();

  const existingHashes = new Set(
    (await prisma.bankTransaction.findMany({
      where: { bank: 'razorpayx' },
      select: { txnHash: true },
    })).map(t => t.txnHash)
  );

  const processed = rows.filter(r => r.status === 'processed');
  const newRows: typeof txnData = [];
  let totalDebits = 0;
  let totalCredits = 0;

  const txnData = processed.map(row => {
    const payoutId = row.payout_id;
    const amount = parseFloat((row.amount ?? '').replace(/,/g, ''));
    const contactName = row.contact_name ?? '';
    const purpose = row.purpose ?? '';
    const utr = row.utr ?? '';
    const notes = row.notes ?? '{}';
    const processedAt = parseRazorpayDate(row.processed_at || row.created_at);

    if (!payoutId || amount === 0) return null;

    const txnHash = sha256(`razorpayx_payout|${payoutId}`);
    if (existingHashes.has(txnHash)) return null;
    existingHashes.add(txnHash);

    totalDebits += amount;

    return {
      id: randomUUID(),
      bank: 'razorpayx',
      txnHash,
      rawData: row as unknown as JsonValue,
      txnDate: processedAt,
      amount,
      direction: 'debit' as const,
      narration: `${purpose}: ${contactName}`,
      reference: payoutId,
      utr: utr || undefined,
      counterpartyName: contactName || undefined,
      legacySourceId: payoutId,
      batchId,
      status: 'imported',
    };
  }).filter((r): r is NonNullable<typeof r> => r !== null);

  await prisma.bankImportBatch.create({
    data: {
      id: batchId,
      bank: 'razorpayx',
      fileName,
      rowCount: processed.length,
      newCount: txnData.length,
      skippedCount: processed.length - txnData.length,
      totalDebits,
      totalCredits,
    },
  });

  const CHUNK = 500;
  for (let i = 0; i < txnData.length; i += CHUNK) {
    await prisma.bankTransaction.createMany({
      data: txnData.slice(i, i + CHUNK),
      skipDuplicates: true,
    });
  }

  return {
    bank: 'razorpayx',
    fileName,
    totalRows: processed.length,
    newRows: txnData.length,
    skippedRows: processed.length - txnData.length,
    totalDebits,
    totalCredits,
    batchId,
  };
}

// ============================================
// RAZORPAYX STATEMENT (CHARGES) IMPORT
// ============================================

export async function importRazorpayxStatement(filePath: string): Promise<ImportResult> {
  const rows = parseCSV(filePath);
  const fileName = filePath.split('/').pop() || filePath;
  const batchId = randomUUID();

  const existingHashes = new Set(
    (await prisma.bankTransaction.findMany({
      where: { bank: 'razorpayx' },
      select: { txnHash: true },
    })).map(t => t.txnHash)
  );

  // Bank charges = external source type with no UTR
  const bankCharges = rows.filter(r => r.source_type === 'external' && !(r.utr ?? '').trim());
  let totalDebits = 0;

  const txnData = bankCharges.map(row => {
    const txnId = row.transaction_id;
    const amount = parseFloat((row.amount ?? '').replace(/,/g, ''));
    const txnDate = parseRazorpayDate(row.created_at);

    if (!txnId || amount === 0) return null;

    const txnHash = sha256(`razorpayx_charge|${txnId}`);
    if (existingHashes.has(txnHash)) return null;
    existingHashes.add(txnHash);

    totalDebits += amount;

    return {
      id: randomUUID(),
      bank: 'razorpayx',
      txnHash,
      rawData: row as unknown as JsonValue,
      txnDate,
      amount,
      direction: 'debit' as const,
      narration: 'Bank charges (RazorpayX)',
      reference: txnId,
      legacySourceId: txnId,
      batchId,
      status: 'imported',
    };
  }).filter((r): r is NonNullable<typeof r> => r !== null);

  await prisma.bankImportBatch.create({
    data: {
      id: batchId,
      bank: 'razorpayx',
      fileName,
      rowCount: bankCharges.length,
      newCount: txnData.length,
      skippedCount: bankCharges.length - txnData.length,
      totalDebits,
      totalCredits: 0,
    },
  });

  const CHUNK = 500;
  for (let i = 0; i < txnData.length; i += CHUNK) {
    await prisma.bankTransaction.createMany({
      data: txnData.slice(i, i + CHUNK),
      skipDuplicates: true,
    });
  }

  return {
    bank: 'razorpayx',
    fileName,
    totalRows: bankCharges.length,
    newRows: txnData.length,
    skippedRows: bankCharges.length - txnData.length,
    totalDebits,
    totalCredits: 0,
    batchId,
  };
}

// ============================================
// CC CHARGES IMPORT
// ============================================

interface CCTransaction {
  date: string;
  description: string;
  amount: number;
  type: 'debit' | 'credit';
  card: 'hdfc' | 'icici';
  source: string;
}

function makeCcSourceId(txn: CCTransaction, idx: number): string {
  const shortDesc = txn.description.replace(/[^a-zA-Z0-9]/g, '').slice(0, 20).toLowerCase();
  return `cc_${txn.card}_${txn.date}_${shortDesc}_${txn.amount.toFixed(2)}_${idx}`;
}

function loadCcCsv(filePath: string, card: 'hdfc' | 'icici'): CCTransaction[] {
  if (!fs.existsSync(filePath)) return [];
  const content = fs.readFileSync(filePath, 'utf-8');
  const lines = content.split('\n').filter(l => l.trim());
  const transactions: CCTransaction[] = [];
  for (let i = 1; i < lines.length; i++) {
    const cols = parseCSVLine(lines[i]);
    const [date, desc, amountStr, type] = cols;
    if (!date || !desc || !amountStr) continue;
    const amount = parseFloat(amountStr);
    if (isNaN(amount) || amount === 0) continue;
    transactions.push({
      date, description: desc, amount,
      type: type === 'credit' ? 'credit' : 'debit',
      card, source: `${card === 'hdfc' ? 'xls' : 'csv'}_${cols[5] || 'unknown'}`,
    });
  }
  return transactions;
}

// Re-export for use by the CC import — the hardcoded transactions live in import-cc-charges.ts
// We'll import them from there to avoid massive duplication
export async function importCcCharges(): Promise<ImportResult> {
  // Dynamically import the hardcoded transactions from the old script's data
  // We reference them via a data file to keep this module clean
  const { hdfcPdfTransactions, iciciPdfTransactions } = await import('./ccData.js');

  const hdfcXls = loadCcCsv('/tmp/cc-statements/hdfc_all_transactions.csv', 'hdfc');
  const iciciCsv = loadCcCsv('/tmp/cc-statements/icici_csv_transactions.csv', 'icici');

  const allTransactions: CCTransaction[] = [
    ...hdfcPdfTransactions,
    ...hdfcXls,
    ...iciciCsv,
    ...iciciPdfTransactions,
  ];

  // Only debits (charges, not payments)
  const charges = allTransactions.filter(t => t.type === 'debit');
  const batchId = randomUUID();

  // Fetch existing hashes for both CC types
  const existingHashes = new Set(
    (await prisma.bankTransaction.findMany({
      where: { bank: { in: ['hdfc_cc', 'icici_cc'] } },
      select: { txnHash: true },
    })).map(t => t.txnHash)
  );

  let totalDebits = 0;

  const txnData = charges.map((txn, idx) => {
    const bank = txn.card === 'hdfc' ? 'hdfc_cc' : 'icici_cc';
    const txnHash = sha256(`${bank}|${txn.date}|${txn.description}|${txn.amount}|${txn.source}`);

    if (existingHashes.has(txnHash)) return null;
    existingHashes.add(txnHash);

    totalDebits += txn.amount;
    const legacySourceId = makeCcSourceId(txn, idx);

    return {
      id: randomUUID(),
      bank,
      txnHash,
      rawData: txn as unknown as JsonValue,
      txnDate: new Date(txn.date + 'T00:00:00+05:30'),
      amount: txn.amount,
      direction: 'debit' as const,
      narration: txn.description,
      reference: txn.source,
      legacySourceId,
      batchId,
      status: 'imported',
    };
  }).filter((r): r is NonNullable<typeof r> => r !== null);

  await prisma.bankImportBatch.create({
    data: {
      id: batchId,
      bank: 'cc',
      fileName: 'hardcoded + CSV files',
      rowCount: charges.length,
      newCount: txnData.length,
      skippedCount: charges.length - txnData.length,
      totalDebits,
      totalCredits: 0,
    },
  });

  const CHUNK = 500;
  for (let i = 0; i < txnData.length; i += CHUNK) {
    await prisma.bankTransaction.createMany({
      data: txnData.slice(i, i + CHUNK),
      skipDuplicates: true,
    });
  }

  return {
    bank: 'cc',
    fileName: 'hardcoded + CSV files',
    totalRows: charges.length,
    newRows: txnData.length,
    skippedRows: charges.length - txnData.length,
    totalDebits,
    totalCredits: 0,
    batchId,
  };
}
