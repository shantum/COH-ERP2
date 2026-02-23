/**
 * Payroll Server Functions
 *
 * Employee CRUD, payroll run management, slip calculation, and finance integration.
 */

'use server';

import { createServerFn } from '@tanstack/react-start';
import { z } from 'zod';
import { authMiddleware } from '../middleware/auth';
import { getPrisma, type PrismaTransaction } from '@coh/shared/services/db';
import {
  CreateEmployeeSchema,
  UpdateEmployeeSchema,
  CreatePayrollRunSchema,
  UpdatePayrollSlipSchema,
  ConfirmPayrollRunSchema,
  ListEmployeesInput,
  ListPayrollRunsInput,
  UpsertLeaveRecordSchema,
  DeleteLeaveRecordSchema,
  GetAttendanceSummarySchema,
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

    // Fetch leave records for the month to auto-calculate payableDays
    const monthStart = new Date(data.year, data.month - 1, 1);
    const monthEnd = new Date(data.year, data.month, 0);
    const leaveRecords = await prisma.leaveRecord.findMany({
      where: {
        date: { gte: monthStart, lte: monthEnd },
        employeeId: { in: employees.map((e) => e.id) },
      },
    });

    // Group leaves by employeeId
    const leavesByEmployee = new Map<string, { type: string }[]>();
    for (const lr of leaveRecords) {
      const existing = leavesByEmployee.get(lr.employeeId) ?? [];
      existing.push({ type: lr.type });
      leavesByEmployee.set(lr.employeeId, existing);
    }

    // Calculate slips for all employees
    const slipData = employees.map((emp) => {
      const empLeaves = leavesByEmployee.get(emp.id) ?? [];
      let fullDayLeaves = 0;
      let halfDayLeaves = 0;
      for (const l of empLeaves) {
        if (l.type === 'absent') fullDayLeaves++;
        else if (l.type === 'half_day') halfDayLeaves++;
      }
      const payableDays = Math.max(0, daysInMonth - fullDayLeaves - halfDayLeaves * 0.5);

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
        isManualDays: false,
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

    // Create all invoices + update run status atomically
    await prisma.$transaction(async (tx: PrismaTransaction) => {
      for (const slip of run.slips) {
        if (slip.netPay <= 0) continue;

        const salaryLabel = `${run.year}-${String(run.month).padStart(2, '0')}`;

        const invoice = await tx.invoice.create({
          data: {
            type: 'payable',
            category: 'salary',
            status: 'confirmed',
            invoiceDate: new Date(run.year, run.month - 1, new Date(run.year, run.month, 0).getDate()),
            billingPeriod: salaryLabel,
            totalAmount: slip.netPay,
            balanceDue: slip.netPay,
            ...(slip.employee.partyId ? { partyId: slip.employee.partyId } : {}),
            notes: `Salary for ${monthLabel}`,
            createdById: userId,
          },
        });

        await tx.payrollSlip.update({
          where: { id: slip.id },
          data: { invoiceId: invoice.id },
        });
      }

      await tx.payrollRun.update({
        where: { id: run.id },
        data: {
          status: 'confirmed',
          confirmedAt: new Date(),
          confirmedById: userId,
        },
      });
    }, { timeout: 30000 });

    return { success: true as const };
  });

// ============================================
// PAYROLL RUN — CANCEL
// ============================================

export const cancelPayrollRun = createServerFn({ method: 'POST' })
  .middleware([authMiddleware])
  .inputValidator((input: unknown) => z.object({ id: z.string().uuid() }).parse(input))
  .handler(async ({ data }) => {
    const prisma = await getPrisma();

    const run = await prisma.payrollRun.findUnique({
      where: { id: data.id },
      include: {
        slips: {
          select: {
            id: true,
            invoiceId: true,
            invoice: { select: { id: true, status: true } },
          },
        },
      },
    });

    if (!run) return { success: false as const, error: 'Payroll run not found' };
    if (run.status === 'cancelled') return { success: false as const, error: 'Already cancelled' };

    // Cancel invoices + update run status atomically
    await prisma.$transaction(async (tx: PrismaTransaction) => {
      if (run.status === 'confirmed') {
        for (const slip of run.slips) {
          if (slip.invoice) {
            await tx.invoice.update({
              where: { id: slip.invoice.id },
              data: { status: 'cancelled' },
            });
          }
          if (slip.invoiceId) {
            await tx.payrollSlip.update({
              where: { id: slip.id },
              data: { invoiceId: null },
            });
          }
        }
      }

      await tx.payrollRun.update({
        where: { id: run.id },
        data: { status: 'cancelled' },
      });
    }, { timeout: 30000 });

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

// ============================================
// ATTENDANCE — GET SUMMARY
// ============================================

export const getAttendanceSummary = createServerFn({ method: 'POST' })
  .middleware([authMiddleware])
  .inputValidator((input: unknown) => GetAttendanceSummarySchema.parse(input))
  .handler(async ({ data }) => {
    const prisma = await getPrisma();

    const employees = await prisma.employee.findMany({
      where: { isActive: true },
      select: { id: true, name: true, department: true },
      orderBy: { name: 'asc' },
    });

    const monthStart = new Date(data.year, data.month - 1, 1);
    const monthEnd = new Date(data.year, data.month, 0);

    const leaveRecords = await prisma.leaveRecord.findMany({
      where: {
        date: { gte: monthStart, lte: monthEnd },
      },
      select: {
        id: true,
        employeeId: true,
        date: true,
        type: true,
        reason: true,
      },
    });

    const daysInMonth = getDaysInMonth(data.month, data.year);

    return {
      success: true as const,
      employees,
      leaveRecords: leaveRecords.map((lr) => ({
        ...lr,
        date: lr.date.toISOString().split('T')[0],
      })),
      daysInMonth,
      month: data.month,
      year: data.year,
    };
  });

// ============================================
// ATTENDANCE — UPSERT LEAVE RECORD
// ============================================

export const upsertLeaveRecord = createServerFn({ method: 'POST' })
  .middleware([authMiddleware])
  .inputValidator((input: unknown) => UpsertLeaveRecordSchema.parse(input))
  .handler(async ({ data, context }) => {
    const prisma = await getPrisma();
    const userId = context.user.id;

    // Reject if date is a Sunday
    const dateObj = new Date(data.date + 'T00:00:00Z');
    if (dateObj.getDay() === 0) {
      return { success: false as const, error: 'Cannot mark leave on a Sunday' };
    }

    const record = await prisma.leaveRecord.upsert({
      where: {
        employeeId_date: {
          employeeId: data.employeeId,
          date: dateObj,
        },
      },
      create: {
        employeeId: data.employeeId,
        date: dateObj,
        type: data.type,
        ...(data.reason ? { reason: data.reason } : {}),
        createdById: userId,
      },
      update: {
        type: data.type,
        reason: data.reason ?? null,
      },
    });

    return { success: true as const, record };
  });

// ============================================
// ATTENDANCE — DELETE LEAVE RECORD
// ============================================

export const deleteLeaveRecord = createServerFn({ method: 'POST' })
  .middleware([authMiddleware])
  .inputValidator((input: unknown) => DeleteLeaveRecordSchema.parse(input))
  .handler(async ({ data }) => {
    const prisma = await getPrisma();
    const dateObj = new Date(data.date + 'T00:00:00Z');

    const existing = await prisma.leaveRecord.findUnique({
      where: {
        employeeId_date: {
          employeeId: data.employeeId,
          date: dateObj,
        },
      },
    });

    if (!existing) {
      return { success: false as const, error: 'No leave record found for this date' };
    }

    await prisma.leaveRecord.delete({
      where: { id: existing.id },
    });

    return { success: true as const };
  });
