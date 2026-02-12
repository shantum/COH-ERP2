/**
 * Import RazorpayPayroll salary register CSVs into PayrollRun + PayrollSlip records.
 *
 * Usage: DATABASE_URL=... tsx server/scripts/import-payroll-registers.ts
 */
import { PrismaClient } from '@prisma/client';
import * as fs from 'fs';
import * as path from 'path';

const prisma = new PrismaClient();

// CSV files to import (month is derived from filename)
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

// Name mapping: register name → DB employee name
const NAME_MAP: Record<string, string> = {
  'Bablu Dayal Turi': 'Bablu Turi',
  'Karishma Kristina Singh': 'Karishma Singh',
};

// Days in each month
function daysInMonth(month: number, year: number): number {
  return new Date(year, month, 0).getDate();
}

// Parse CSV (handles quoted fields)
function parseCSV(content: string): Record<string, string>[] {
  const lines = content.trim().split('\n');
  if (lines.length < 2) return [];

  const parseRow = (line: string): string[] => {
    const fields: string[] = [];
    let current = '';
    let inQuotes = false;
    for (const ch of line) {
      if (ch === '"') { inQuotes = !inQuotes; continue; }
      if (ch === ',' && !inQuotes) { fields.push(current.trim()); current = ''; continue; }
      current += ch;
    }
    fields.push(current.trim());
    return fields;
  };

  const headers = parseRow(lines[0]);
  const rows: Record<string, string>[] = [];
  for (let i = 1; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;
    const values = parseRow(line);
    const row: Record<string, string> = {};
    headers.forEach((h, idx) => { row[h] = values[idx] ?? ''; });
    rows.push(row);
  }
  return rows;
}

function num(val: string | undefined): number {
  if (!val) return 0;
  const n = parseFloat(val);
  return isNaN(n) ? 0 : n;
}

async function main() {
  // Get admin user for createdById
  const admin = await prisma.user.findFirst({ where: { role: 'admin' } });
  if (!admin) throw new Error('No admin user found');

  // Load all employees by name
  const allEmployees = await prisma.employee.findMany();
  const employeeByName = new Map(allEmployees.map(e => [e.name, e]));

  console.log(`Found ${allEmployees.length} employees in DB`);

  for (const file of FILES) {
    const filePath = path.join(REGISTER_DIR, file);

    // Parse month/year from filename: ...-2025-07-01.csv
    const match = file.match(/(\d{4})-(\d{2})-\d{2}\.csv$/);
    if (!match) { console.error(`Cannot parse date from ${file}`); continue; }
    const year = parseInt(match[1]);
    const month = parseInt(match[2]);
    const dim = daysInMonth(month, year);

    console.log(`\n=== ${month}/${year} (${file}) ===`);

    // Check if run already exists
    const existing = await prisma.payrollRun.findUnique({
      where: { month_year: { month, year } }
    });
    if (existing) {
      console.log(`  PayrollRun already exists (${existing.status}), skipping`);
      continue;
    }

    // Parse CSV
    const content = fs.readFileSync(filePath, 'utf-8');
    const rows = parseCSV(content);
    console.log(`  Parsed ${rows.length} rows`);

    // Build slips
    const slips: Array<{
      employeeId: string;
      daysInMonth: number;
      payableDays: number;
      isManualDays: boolean;
      basicFixed: number;
      hraFixed: number;
      otherAllowanceFixed: number;
      grossFixed: number;
      basicEarned: number;
      hraEarned: number;
      otherAllowanceEarned: number;
      grossEarned: number;
      pfEmployee: number;
      esicEmployee: number;
      professionalTax: number;
      advances: number;
      otherDeductions: number;
      totalDeductions: number;
      netPay: number;
      pfEmployer: number;
      pfAdmin: number;
      esicEmployer: number;
      totalEmployerCost: number;
      costToCompany: number;
      registerData: Record<string, unknown>;
    }> = [];

    let totalGross = 0;
    let totalDeductions = 0;
    let totalNetPay = 0;
    let totalEmployerCost = 0;

    for (const row of rows) {
      const registerName = row['Name'];
      const netPay = num(row['Net Pay']);

      // Skip zero-pay rows
      if (netPay === 0 && num(row['Gross Salary']) === 0) {
        console.log(`  Skipping ${registerName} (zero pay)`);
        continue;
      }

      // Match to DB employee
      const dbName = NAME_MAP[registerName] ?? registerName;
      const employee = employeeByName.get(dbName);
      if (!employee) {
        console.error(`  ❌ No employee match for "${registerName}" (looked up "${dbName}")`);
        continue;
      }

      // Extract fields from register
      const basic = num(row['Basic Salary']);
      const da = num(row['DA']);
      const hra = num(row['HRA']);
      const sa = num(row['SA']);
      const lta = num(row['LTA']);
      const travel = num(row['Travel']);
      const travelAllowance = num(row['Travel Allowance']);
      const bonus = num(row['Bonus']);
      const diwaliGift = num(row['Diwali Gift']);
      const diwali = num(row['Diwali']);
      const salaryAdvAdj = num(row['Salary Advance Adjustment']);
      // Apr-Jun extra columns
      const ot = num(row['OT']);
      const overtime = num(row['Overtime']);
      const overtimeTravel = num(row['Overtime & Travel']) + num(row['Overtime + Travel']) + num(row['OT + Travel']);
      const washing = num(row['Washing']);
      const adjustment = num(row['Adjustment']);
      const travelMay = num(row['Travel May']);
      const travelJune = num(row['Travel June']);
      const gross = num(row['Gross Salary']);
      const pfEE = Math.abs(num(row['PF(EE)']));
      const pfER = Math.abs(num(row['PF(ER)']));
      const tds = Math.abs(num(row['TDS']));
      const reimb = num(row['Reimb']);
      const imprest = num(row['Imprest']);
      const advanceSalary = num(row['Advance Salary']);
      const loanEmi = Math.abs(num(row['Loan Emi']));
      const oneTimePayments = num(row['One-time Payments']);
      const workingDays = num(row['Working Days']);

      // Map to our fields
      const otherEarned = sa + lta + travel + travelAllowance + da + bonus + diwaliGift + diwali + salaryAdvAdj + ot + overtime + overtimeTravel + washing + adjustment + travelMay + travelJune;

      // Fixed = full month salary from employee record
      const basicFixed = employee.basicSalary;
      const hraFixed = basicFixed * 0.5; // RazorpayPayroll uses 50%
      const otherFixed = basicFixed * 0.5; // SA(30%) + LTA(20%)
      const grossFixed = basicFixed * 2;

      // Deductions (stored as positive)
      const advances = Math.abs(advanceSalary);
      const otherDed = loanEmi + Math.abs(oneTimePayments) + tds;
      const totalDed = pfEE + advances + otherDed;

      // Employer cost
      const empCost = pfER;

      // Store full register row as JSON (all original columns)
      const registerData: Record<string, unknown> = {
        source: 'razorpay_payroll',
        employeeId: row['Employee ID'],
        ...row,
      };
      // Convert numeric strings to numbers in registerData
      for (const [key, val] of Object.entries(registerData)) {
        if (key === 'Name' || key === 'source' || key === 'employeeId') continue;
        const n = parseFloat(val as string);
        if (!isNaN(n)) registerData[key] = n;
      }

      slips.push({
        employeeId: employee.id,
        daysInMonth: dim,
        payableDays: workingDays,
        isManualDays: false,
        basicFixed,
        hraFixed,
        otherAllowanceFixed: otherFixed,
        grossFixed,
        basicEarned: basic,
        hraEarned: hra,
        otherAllowanceEarned: otherEarned,
        grossEarned: gross,
        pfEmployee: pfEE,
        esicEmployee: 0,
        professionalTax: 0,
        advances,
        otherDeductions: otherDed,
        totalDeductions: totalDed,
        netPay,
        pfEmployer: pfER,
        pfAdmin: 0,
        esicEmployer: 0,
        totalEmployerCost: empCost,
        costToCompany: gross + empCost,
        registerData,
      });

      totalGross += gross;
      totalDeductions += totalDed;
      totalNetPay += netPay;
      totalEmployerCost += empCost;

      console.log(`  ✓ ${registerName} → net ₹${netPay.toLocaleString()}`);
    }

    if (slips.length === 0) {
      console.log('  No valid slips, skipping run creation');
      continue;
    }

    // Create PayrollRun + Slips in transaction
    const run = await prisma.payrollRun.create({
      data: {
        month,
        year,
        status: 'confirmed',
        totalGross,
        totalDeductions,
        totalNetPay,
        totalEmployerCost,
        employeeCount: slips.length,
        confirmedAt: new Date(year, month - 1, 15), // mid-month as approximate
        confirmedById: admin.id,
        createdById: admin.id,
        notes: `Imported from RazorpayPayroll register (${file})`,
        slips: {
          create: slips,
        },
      },
    });

    console.log(`  ✅ Created PayrollRun ${run.id} — ${slips.length} employees, net ₹${totalNetPay.toLocaleString()}`);
  }

  console.log('\n✅ Done!');
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
