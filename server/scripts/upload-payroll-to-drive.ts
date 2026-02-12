/**
 * Upload payroll register CSVs to Google Drive.
 * Folder structure: COH Finance → Payroll Registers → FY 2025-26 → files
 *
 * Usage: DATABASE_URL=... tsx server/scripts/upload-payroll-to-drive.ts
 */
import * as fs from 'fs';
import * as path from 'path';
import { uploadFile, ensureFolder } from '../src/services/googleDriveClient.js';
import { DRIVE_FINANCE_FOLDER_ID, getFinancialYear } from '../src/config/sync/drive.js';

const REGISTER_DIR = '/Users/shantumgupta/Downloads';
const FILES = [
  'Canoe-Design-Private-Limited_salary_register-2025-04-01.csv',
  'Canoe-Design-Private-Limited_salary_register-2025-05-01.csv',
  'Canoe-Design-Private-Limited_salary_register-2025-06-01.csv',
  'Canoe-Design-Private-Limited_salary_register-2025-07-01.csv',
  'Canoe-Design-Private-Limited_salary_register-2025-08-01.csv',
  'Canoe-Design-Private-Limited_salary_register-2025-09-01.csv',
  'Canoe-Design-Private-Limited_salary_register-2025-10-01.csv',
  'Canoe-Design-Private-Limited_salary_register-2025-11-01.csv',
  'Canoe-Design-Private-Limited_salary_register-2025-12-01.csv',
  'Canoe-Design-Private-Limited_salary_register-2026-01-01.csv',
];

async function main() {
  if (!DRIVE_FINANCE_FOLDER_ID) {
    throw new Error('DRIVE_FINANCE_FOLDER_ID not set in .env');
  }

  console.log('Setting up Drive folder structure...');

  // COH Finance → Payroll Registers
  const payrollFolderId = await ensureFolder(DRIVE_FINANCE_FOLDER_ID, 'Payroll Registers');
  console.log(`  Payroll Registers folder: ${payrollFolderId}`);

  // Cache FY folders
  const fyFolderCache = new Map<string, string>();

  for (const file of FILES) {
    const filePath = path.join(REGISTER_DIR, file);
    if (!fs.existsSync(filePath)) {
      console.log(`  ⚠ File not found: ${file}`);
      continue;
    }

    // Determine FY from filename date
    const match = file.match(/(\d{4})-(\d{2})-\d{2}\.csv$/);
    if (!match) { console.error(`Cannot parse date from ${file}`); continue; }
    const year = parseInt(match[1]);
    const month = parseInt(match[2]) - 1; // 0-indexed for Date
    const fy = getFinancialYear(new Date(year, month, 1));

    // Ensure FY subfolder
    if (!fyFolderCache.has(fy)) {
      const fyId = await ensureFolder(payrollFolderId, fy);
      fyFolderCache.set(fy, fyId);
      console.log(`  ${fy} folder: ${fyId}`);
    }
    const folderId = fyFolderCache.get(fy)!;

    // Upload
    const buffer = fs.readFileSync(filePath);
    const result = await uploadFile(folderId, file, 'text/csv', buffer);
    console.log(`  ✅ ${file} → ${result.webViewLink}`);
  }

  // Also upload the bank details CSV if it exists
  const bankDetailsFile = 'COH Salary Computation - 2025 - Bank Details.csv';
  const bankDetailsPath = path.join(REGISTER_DIR, bankDetailsFile);
  if (fs.existsSync(bankDetailsPath)) {
    const fy = 'FY 2025-26';
    const folderId = fyFolderCache.get(fy) ?? await ensureFolder(payrollFolderId, fy);
    const buffer = fs.readFileSync(bankDetailsPath);
    const result = await uploadFile(folderId, bankDetailsFile, 'text/csv', buffer);
    console.log(`  ✅ ${bankDetailsFile} → ${result.webViewLink}`);
  }

  console.log('\n✅ All files uploaded!');
}

main().catch(console.error);
