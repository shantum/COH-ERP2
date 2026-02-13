/**
 * Payroll Server Functions
 *
 * Employee CRUD, payroll run management, slip calculation, and finance integration.
 */

'use server';

import { createServerFn } from '@tanstack/react-start';
import { z } from 'zod';
import { authMiddleware } from '../middleware/auth';
import { getPrisma } from '@coh/shared/services/db';
import {
  CreateEmployeeSchema,
  UpdateEmployeeSchema,
  CreatePayrollRunSchema,
  UpdatePayrollSlipSchema,
  ConfirmPayrollRunSchema,
  ListEmployeesInput,
  ListPayrollRunsInput,
} from '@coh/shared/schemas/payroll';

// ============================================
// INLINE CALCULATION (avoid cross-project import)
// ============================================

// Payroll constants (duplicated from server config to avoid cross-project import)
const HRA_PERCENT = 40;
const OTHER_ALLOWANCE_PERCENT = 60;
const PF_EMPLOYEE_PERCENT = 12;
const PF_EMPLOYER_PERCENT = 12;
const PF_ADMIN_PERCENT = 1;
const PF_WAGE_CAP = 15_000;
const ESIC_EMPLOYEE_PERCENT = 0.75;
const ESIC_EMPLOYER_PERCENT = 3.25;
const ESIC_GROSS_THRESHOLD = 21_000;
const PT_AMOUNT = 200;
const PT_SALARY_THRESHOLD = 10_000;

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

function proRate(fixedAmount: number, payableDays: number, daysInMonth: number): number {
  if (daysInMonth === 0) return 0;
  return round2((fixedAmount * payableDays) / daysInMonth);
}

function calcPF(earnedBasic: number, fixedBasic: number, percent: number): number {
  const base =
    fixedBasic > PF_WAGE_CAP ? proRate(PF_WAGE_CAP, earnedBasic, fixedBasic) : earnedBasic;
  return round2((base * percent) / 100);
}

function getDaysInMonth(month: number, year: number): number {
  return new Date(year, month, 0).getDate();
}

interface CalcInput {
  basicSalary: number;
  pfApplicable: boolean;
  esicApplicable: boolean;
  ptApplicable: boolean;
  payableDays: number;
  daysInMonth: number;
  advances?: number;
  otherDeductions?: number;
}

function calculateSlip(input: CalcInput) {
  const {
    basicSalary,
    pfApplicable,
    esicApplicable,
    ptApplicable,
    payableDays,
    daysInMonth,
  } = input;
  const advances = input.advances ?? 0;
  const otherDed = input.otherDeductions ?? 0;

  const basicFixed = basicSalary;
  const hraFixed = round2((basicSalary * HRA_PERCENT) / 100);
  const otherAllowanceFixed = round2((basicSalary * OTHER_ALLOWANCE_PERCENT) / 100);
  const grossFixed = round2(basicFixed + hraFixed + otherAllowanceFixed);

  const basicEarned = proRate(basicFixed, payableDays, daysInMonth);
  const hraEarned = proRate(hraFixed, payableDays, daysInMonth);
  const otherAllowanceEarned = proRate(otherAllowanceFixed, payableDays, daysInMonth);
  const grossEarned = round2(basicEarned + hraEarned + otherAllowanceEarned);

  let pfEmployee = 0;
  if (pfApplicable) pfEmployee = calcPF(basicEarned, basicFixed, PF_EMPLOYEE_PERCENT);

  let esicEmployee = 0;
  if (esicApplicable && grossFixed <= ESIC_GROSS_THRESHOLD)
    esicEmployee = round2((grossEarned * ESIC_EMPLOYEE_PERCENT) / 100);

  let professionalTax = 0;
  if (ptApplicable && grossFixed > PT_SALARY_THRESHOLD) professionalTax = PT_AMOUNT;

  const totalDeductions = round2(pfEmployee + esicEmployee + professionalTax + advances + otherDed);
  const netPay = round2(grossEarned - totalDeductions);

  let pfEmployer = 0;
  let pfAdmin = 0;
  if (pfApplicable) {
    pfEmployer = calcPF(basicEarned, basicFixed, PF_EMPLOYER_PERCENT);
    pfAdmin = calcPF(basicEarned, basicFixed, PF_ADMIN_PERCENT);
  }

  let esicEmployer = 0;
  if (esicApplicable && grossFixed <= ESIC_GROSS_THRESHOLD)
    esicEmployer = round2((grossEarned * ESIC_EMPLOYER_PERCENT) / 100);

  const totalEmployerCost = round2(pfEmployer + pfAdmin + esicEmployer);
  const costToCompany = round2(grossEarned + totalEmployerCost);

  return {
    basicFixed,
    hraFixed,
    otherAllowanceFixed,
    grossFixed,
    basicEarned,
    hraEarned,
    otherAllowanceEarned,
    grossEarned,
    pfEmployee,
    esicEmployee,
    professionalTax,
    advances,
    otherDeductions: otherDed,
    totalDeductions,
    netPay,
    pfEmployer,
    pfAdmin,
    esicEmployer,
    totalEmployerCost,
    costToCompany,
  };
}

// ============================================
// INLINE LEDGER HELPER (same as finance.ts)
// ============================================

interface LedgerLineInput {
  accountCode: string;
  debit?: number;
  credit?: number;
  description?: string;
}

async function inlineCreateLedgerEntry(
  prisma: Awaited<ReturnType<typeof getPrisma>>,
  input: {
    entryDate: Date;
    period: string;
    description: string;
    sourceType: string;
    sourceId?: string;
    lines: LedgerLineInput[];
    createdById: string;
    notes?: string;
  },
) {
  const { entryDate, period, description, sourceType, sourceId, lines, createdById, notes } = input;

  const totalDebit = lines.reduce((sum, l) => sum + (l.debit ?? 0), 0);
  const totalCredit = lines.reduce((sum, l) => sum + (l.credit ?? 0), 0);
  if (Math.abs(totalDebit - totalCredit) > 0.01) {
    throw new Error(
      `Debits (${totalDebit.toFixed(2)}) must equal credits (${totalCredit.toFixed(2)})`,
    );
  }

  const accountCodes = [...new Set(lines.map((l) => l.accountCode))];
  const accounts = await prisma.ledgerAccount.findMany({
    where: { code: { in: accountCodes } },
    select: { id: true, code: true },
  });
  const accountMap = new Map(accounts.map((a) => [a.code, a.id]));
  for (const code of accountCodes) {
    if (!accountMap.has(code)) throw new Error(`Unknown account code: ${code}`);
  }

  return prisma.ledgerEntry.create({
    data: {
      entryDate,
      period,
      description,
      sourceType,
      sourceId: sourceId ?? null,
      notes: notes ?? null,
      createdById,
      lines: {
        create: lines.map((line) => ({
          accountId: accountMap.get(line.accountCode)!,
          debit: line.debit ?? 0,
          credit: line.credit ?? 0,
          description: line.description ?? null,
        })),
      },
    },
  });
}

// ============================================
// EMPLOYEE — LIST
// ============================================

export const listEmployees = createServerFn({ method: 'POST' })
  .middleware([authMiddleware])
  .inputValidator((input: unknown) => ListEmployeesInput.parse(input))
  .handler(async ({ data }) => {
    const prisma = await getPrisma();
    const { search, department, isActive, page = 1, limit = 50 } = data ?? {};
    const skip = (page - 1) * limit;

    const where: Record<string, unknown> = {};
    if (typeof isActive === 'boolean') where.isActive = isActive;
    else where.isActive = true; // Default to active only
    if (department) where.department = department;
    if (search) {
      where.OR = [
        { name: { contains: search, mode: 'insensitive' } },
        { employeeCode: { contains: search, mode: 'insensitive' } },
        { designation: { contains: search, mode: 'insensitive' } },
      ];
    }

    const [employees, total] = await Promise.all([
      prisma.employee.findMany({
        where,
        orderBy: { name: 'asc' },
        skip,
        take: limit,
        include: { tailor: { select: { id: true, name: true } } },
      }),
      prisma.employee.count({ where }),
    ]);

    return { success: true as const, employees, total, page, limit };
  });

// ============================================
// EMPLOYEE — GET
// ============================================

export const getEmployee = createServerFn({ method: 'GET' })
  .middleware([authMiddleware])
  .inputValidator((input: unknown) => z.object({ id: z.string().uuid() }).parse(input))
  .handler(async ({ data }) => {
    const prisma = await getPrisma();

    const employee = await prisma.employee.findUnique({
      where: { id: data.id },
      include: {
        tailor: { select: { id: true, name: true } },
        party: { select: { id: true, name: true } },
        payrollSlips: {
          orderBy: { createdAt: 'desc' },
          take: 12,
          select: {
            id: true,
            payableDays: true,
            daysInMonth: true,
            grossEarned: true,
            totalDeductions: true,
            netPay: true,
            payrollRun: { select: { month: true, year: true, status: true } },
          },
        },
      },
    });

    if (!employee) return { success: false as const, error: 'Employee not found' };
    return { success: true as const, employee };
  });

// ============================================
// EMPLOYEE — CREATE
// ============================================

export const createEmployee = createServerFn({ method: 'POST' })
  .middleware([authMiddleware])
  .inputValidator((input: unknown) => CreateEmployeeSchema.parse(input))
  .handler(async ({ data }) => {
    const prisma = await getPrisma();

    // Create a Party record for finance invoices (category: 'statutory' for salary)
    const party = await prisma.party.create({
      data: {
        name: `Employee: ${data.name}`,
        category: 'statutory',
      },
    });

    const employee = await prisma.employee.create({
      data: {
        name: data.name,
        employeeCode: data.employeeCode,
        phone: data.phone,
        email: data.email || null,
        dateOfJoining: data.dateOfJoining ? new Date(data.dateOfJoining) : null,
        department: data.department,
        designation: data.designation,
        basicSalary: data.basicSalary,
        pfApplicable: data.pfApplicable,
        esicApplicable: data.esicApplicable,
        ptApplicable: data.ptApplicable,
        bankAccountName: data.bankAccountName,
        bankAccountNumber: data.bankAccountNumber,
        bankIfsc: data.bankIfsc,
        bankName: data.bankName,
        pan: data.pan,
        aadhaar: data.aadhaar,
        uan: data.uan,
        esicNumber: data.esicNumber,
        partyId: party.id,
        ...(data.tailorId ? { tailorId: data.tailorId } : {}),
      },
    });

    return { success: true as const, employee };
  });

// ============================================
// EMPLOYEE — UPDATE
// ============================================

export const updateEmployee = createServerFn({ method: 'POST' })
  .middleware([authMiddleware])
  .inputValidator((input: unknown) => UpdateEmployeeSchema.parse(input))
  .handler(async ({ data }) => {
    const prisma = await getPrisma();
    const { id, ...updates } = data;

    const existing = await prisma.employee.findUnique({ where: { id } });
    if (!existing) return { success: false as const, error: 'Employee not found' };

    const updateData: Record<string, unknown> = {};
    if (updates.name !== undefined) updateData.name = updates.name;
    if (updates.employeeCode !== undefined) updateData.employeeCode = updates.employeeCode;
    if (updates.phone !== undefined) updateData.phone = updates.phone;
    if (updates.email !== undefined) updateData.email = updates.email || null;
    if (updates.dateOfJoining !== undefined)
      updateData.dateOfJoining = updates.dateOfJoining ? new Date(updates.dateOfJoining) : null;
    if (updates.dateOfExit !== undefined)
      updateData.dateOfExit = updates.dateOfExit ? new Date(updates.dateOfExit) : null;
    if (updates.department !== undefined) updateData.department = updates.department;
    if (updates.designation !== undefined) updateData.designation = updates.designation;
    if (updates.basicSalary !== undefined) updateData.basicSalary = updates.basicSalary;
    if (updates.pfApplicable !== undefined) updateData.pfApplicable = updates.pfApplicable;
    if (updates.esicApplicable !== undefined) updateData.esicApplicable = updates.esicApplicable;
    if (updates.ptApplicable !== undefined) updateData.ptApplicable = updates.ptApplicable;
    if (updates.bankAccountName !== undefined) updateData.bankAccountName = updates.bankAccountName;
    if (updates.bankAccountNumber !== undefined) updateData.bankAccountNumber = updates.bankAccountNumber;
    if (updates.bankIfsc !== undefined) updateData.bankIfsc = updates.bankIfsc;
    if (updates.bankName !== undefined) updateData.bankName = updates.bankName;
    if (updates.pan !== undefined) updateData.pan = updates.pan;
    if (updates.aadhaar !== undefined) updateData.aadhaar = updates.aadhaar;
    if (updates.uan !== undefined) updateData.uan = updates.uan;
    if (updates.esicNumber !== undefined) updateData.esicNumber = updates.esicNumber;
    if (updates.tailorId !== undefined) updateData.tailorId = updates.tailorId;
    if (updates.isActive !== undefined) updateData.isActive = updates.isActive;

    const employee = await prisma.employee.update({ where: { id }, data: updateData });
    return { success: true as const, employee };
  });

// ============================================
// PAYROLL RUNS — LIST
// ============================================

export const listPayrollRuns = createServerFn({ method: 'POST' })
  .middleware([authMiddleware])
  .inputValidator((input: unknown) => ListPayrollRunsInput.parse(input))
  .handler(async ({ data }) => {
    const prisma = await getPrisma();
    const { status, page = 1, limit = 50 } = data ?? {};
    const skip = (page - 1) * limit;

    const where: Record<string, unknown> = {};
    if (status) where.status = status;

    const [runs, total] = await Promise.all([
      prisma.payrollRun.findMany({
        where,
        orderBy: [{ year: 'desc' }, { month: 'desc' }],
        skip,
        take: limit,
        include: {
          createdBy: { select: { name: true } },
          confirmedBy: { select: { name: true } },
        },
      }),
      prisma.payrollRun.count({ where }),
    ]);

    return { success: true as const, runs, total, page, limit };
  });

// ============================================
// PAYROLL RUN — CREATE (draft + generate slips)
// ============================================

export const createPayrollRun = createServerFn({ method: 'POST' })
  .middleware([authMiddleware])
  .inputValidator((input: unknown) => CreatePayrollRunSchema.parse(input))
  .handler(async ({ data, context }) => {
    const prisma = await getPrisma();
    const userId = context.user.id;

    // Check for existing run
    const existing = await prisma.payrollRun.findUnique({
      where: { month_year: { month: data.month, year: data.year } },
    });
    if (existing) {
      return { success: false as const, error: `Payroll run for ${data.month}/${data.year} already exists` };
    }

    // Get all active employees
    const employees = await prisma.employee.findMany({
      where: { isActive: true },
    });

    if (employees.length === 0) {
      return { success: false as const, error: 'No active employees found' };
    }

    const daysInMonth = getDaysInMonth(data.month, data.year);
    const payableDays = daysInMonth; // Default: full month, user can adjust

    // Calculate slips for all employees
    const slipData = employees.map((emp) => {
      const calc = calculateSlip({
        basicSalary: emp.basicSalary,
        pfApplicable: emp.pfApplicable,
        esicApplicable: emp.esicApplicable,
        ptApplicable: emp.ptApplicable,
        payableDays,
        daysInMonth,
      });

      return {
        employeeId: emp.id,
        daysInMonth,
        payableDays,
        ...calc,
      };
    });

    // Calculate totals
    const totalGross = round2(slipData.reduce((s, sl) => s + sl.grossEarned, 0));
    const totalDeductions = round2(slipData.reduce((s, sl) => s + sl.totalDeductions, 0));
    const totalNetPay = round2(slipData.reduce((s, sl) => s + sl.netPay, 0));
    const totalEmployerCost = round2(slipData.reduce((s, sl) => s + sl.totalEmployerCost, 0));

    const run = await prisma.payrollRun.create({
      data: {
        month: data.month,
        year: data.year,
        status: 'draft',
        totalGross,
        totalDeductions,
        totalNetPay,
        totalEmployerCost,
        employeeCount: employees.length,
        notes: data.notes,
        createdById: userId,
        slips: {
          create: slipData,
        },
      },
      include: {
        slips: {
          include: { employee: { select: { id: true, name: true, department: true } } },
        },
      },
    });

    return { success: true as const, run };
  });

// ============================================
// PAYROLL RUN — GET (with slips)
// ============================================

export const getPayrollRun = createServerFn({ method: 'GET' })
  .middleware([authMiddleware])
  .inputValidator((input: unknown) => z.object({ id: z.string().uuid() }).parse(input))
  .handler(async ({ data }) => {
    const prisma = await getPrisma();

    const run = await prisma.payrollRun.findUnique({
      where: { id: data.id },
      include: {
        createdBy: { select: { name: true } },
        confirmedBy: { select: { name: true } },
        slips: {
          orderBy: { employee: { name: 'asc' } },
          include: {
            employee: {
              select: { id: true, name: true, department: true, designation: true, basicSalary: true },
            },
            invoice: { select: { id: true, status: true, invoiceNumber: true } },
          },
        },
      },
    });

    if (!run) return { success: false as const, error: 'Payroll run not found' };
    return { success: true as const, run };
  });

// ============================================
// PAYROLL SLIP — UPDATE (recalculate)
// ============================================

export const updatePayrollSlip = createServerFn({ method: 'POST' })
  .middleware([authMiddleware])
  .inputValidator((input: unknown) => UpdatePayrollSlipSchema.parse(input))
  .handler(async ({ data }) => {
    const prisma = await getPrisma();

    const slip = await prisma.payrollSlip.findUnique({
      where: { id: data.id },
      include: {
        employee: true,
        payrollRun: { select: { status: true, id: true } },
      },
    });

    if (!slip) return { success: false as const, error: 'Slip not found' };
    if (slip.payrollRun.status !== 'draft') {
      return { success: false as const, error: 'Can only edit slips in draft payroll runs' };
    }

    const payableDays = data.payableDays ?? slip.payableDays;
    const advances = data.advances ?? slip.advances;
    const otherDeductions = data.otherDeductions ?? slip.otherDeductions;

    const calc = calculateSlip({
      basicSalary: slip.employee.basicSalary,
      pfApplicable: slip.employee.pfApplicable,
      esicApplicable: slip.employee.esicApplicable,
      ptApplicable: slip.employee.ptApplicable,
      payableDays,
      daysInMonth: slip.daysInMonth,
      advances,
      otherDeductions,
    });

    const updated = await prisma.payrollSlip.update({
      where: { id: data.id },
      data: {
        payableDays,
        isManualDays: data.payableDays !== undefined,
        ...calc,
      },
    });

    // Recalculate run totals
    const allSlips = await prisma.payrollSlip.findMany({
      where: { payrollRunId: slip.payrollRun.id },
    });

    await prisma.payrollRun.update({
      where: { id: slip.payrollRun.id },
      data: {
        totalGross: round2(allSlips.reduce((s, sl) => s + sl.grossEarned, 0)),
        totalDeductions: round2(allSlips.reduce((s, sl) => s + sl.totalDeductions, 0)),
        totalNetPay: round2(allSlips.reduce((s, sl) => s + sl.netPay, 0)),
        totalEmployerCost: round2(allSlips.reduce((s, sl) => s + sl.totalEmployerCost, 0)),
      },
    });

    return { success: true as const, slip: updated };
  });

// ============================================
// PAYROLL RUN — CONFIRM (create salary invoices)
// ============================================

export const confirmPayrollRun = createServerFn({ method: 'POST' })
  .middleware([authMiddleware])
  .inputValidator((input: unknown) => ConfirmPayrollRunSchema.parse(input))
  .handler(async ({ data, context }) => {
    const prisma = await getPrisma();
    const userId = context.user.id;

    const run = await prisma.payrollRun.findUnique({
      where: { id: data.id },
      include: {
        slips: {
          include: {
            employee: { select: { id: true, name: true, partyId: true } },
          },
        },
      },
    });

    if (!run) return { success: false as const, error: 'Payroll run not found' };
    if (run.status !== 'draft') return { success: false as const, error: 'Can only confirm draft runs' };

    const monthNames = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    const monthLabel = `${monthNames[run.month - 1]} ${run.year}`;

    // Create salary invoice for each slip
    for (const slip of run.slips) {
      if (slip.netPay <= 0) continue;

      // Create payable invoice (salary category)
      const invoice = await prisma.invoice.create({
        data: {
          type: 'payable',
          category: 'salary',
          status: 'draft',
          invoiceDate: new Date(run.year, run.month - 1, new Date(run.year, run.month, 0).getDate()),
          totalAmount: slip.netPay,
          balanceDue: slip.netPay,
          counterpartyName: slip.employee.name,
          ...(slip.employee.partyId ? { partyId: slip.employee.partyId } : {}),
          notes: `Salary for ${monthLabel}`,
          createdById: userId,
        },
      });

      // Confirm the invoice (creates ledger entry: Dr OPERATING_EXPENSES, Cr ACCOUNTS_PAYABLE)
      const salaryLabel = `${run.year}-${String(run.month).padStart(2, '0')}`;
      const entry = await inlineCreateLedgerEntry(prisma, {
        entryDate: new Date(run.year, run.month - 1, new Date(run.year, run.month, 0).getDate()),
        period: salaryLabel,
        description: `Salary: ${slip.employee.name} - ${monthLabel}`,
        sourceType: 'invoice_confirmed',
        sourceId: invoice.id,
        lines: [
          { accountCode: 'OPERATING_EXPENSES', debit: slip.netPay, description: `Salary - ${slip.employee.name}` },
          { accountCode: 'ACCOUNTS_PAYABLE', credit: slip.netPay, description: `Salary payable - ${slip.employee.name}` },
        ],
        createdById: userId,
      });

      await prisma.invoice.update({
        where: { id: invoice.id },
        data: { status: 'confirmed', ledgerEntryId: entry.id },
      });

      // Link invoice to slip
      await prisma.payrollSlip.update({
        where: { id: slip.id },
        data: { invoiceId: invoice.id },
      });
    }

    // Update run status
    await prisma.payrollRun.update({
      where: { id: run.id },
      data: {
        status: 'confirmed',
        confirmedAt: new Date(),
        confirmedById: userId,
      },
    });

    return { success: true as const };
  });

// ============================================
// PAYROLL RUN — CANCEL
// ============================================

export const cancelPayrollRun = createServerFn({ method: 'POST' })
  .middleware([authMiddleware])
  .inputValidator((input: unknown) => z.object({ id: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }) => {
    const prisma = await getPrisma();
    const userId = context.user.id;

    const run = await prisma.payrollRun.findUnique({
      where: { id: data.id },
      include: {
        slips: {
          select: {
            id: true,
            invoiceId: true,
            invoice: { select: { id: true, ledgerEntryId: true, status: true } },
          },
        },
      },
    });

    if (!run) return { success: false as const, error: 'Payroll run not found' };
    if (run.status === 'cancelled') return { success: false as const, error: 'Already cancelled' };

    // If confirmed, reverse the invoices
    if (run.status === 'confirmed') {
      for (const slip of run.slips) {
        if (slip.invoice && slip.invoice.ledgerEntryId) {
          // Reverse the ledger entry
          const original = await prisma.ledgerEntry.findUnique({
            where: { id: slip.invoice.ledgerEntryId },
            include: { lines: true },
          });

          if (original && !original.isReversed) {
            const reversal = await prisma.ledgerEntry.create({
              data: {
                entryDate: original.entryDate,
                period: original.period,
                description: `Reversal: ${original.description}`,
                sourceType: 'adjustment',
                notes: `Reversal of entry ${original.id}`,
                createdById: userId,
                lines: {
                  create: original.lines.map((line) => ({
                    accountId: line.accountId,
                    debit: line.credit,
                    credit: line.debit,
                    description: `Reversal: ${line.description ?? ''}`,
                  })),
                },
              },
            });

            await prisma.ledgerEntry.update({
              where: { id: original.id },
              data: { isReversed: true, reversedById: reversal.id },
            });
          }

          // Cancel the invoice
          await prisma.invoice.update({
            where: { id: slip.invoice.id },
            data: { status: 'cancelled' },
          });
        }

        // Unlink invoice from slip
        if (slip.invoiceId) {
          await prisma.payrollSlip.update({
            where: { id: slip.id },
            data: { invoiceId: null },
          });
        }
      }
    }

    await prisma.payrollRun.update({
      where: { id: run.id },
      data: { status: 'cancelled' },
    });

    return { success: true as const };
  });

// ============================================
// TAILORS (for employee linking dropdown)
// ============================================

export const listTailorsForLinking = createServerFn({ method: 'GET' })
  .middleware([authMiddleware])
  .handler(async () => {
    const prisma = await getPrisma();

    // Tailors not yet linked to any employee
    const tailors = await prisma.tailor.findMany({
      where: {
        isActive: true,
        employee: null,
      },
      select: { id: true, name: true },
      orderBy: { name: 'asc' },
    });

    return { success: true as const, tailors };
  });
