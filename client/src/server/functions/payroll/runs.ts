'use server';

import { createServerFn } from '@tanstack/react-start';
import { z } from 'zod';
import { authMiddleware } from '../../middleware/auth';
import { getPrisma, type PrismaTransaction } from '@coh/shared/services/db';
import {
  CreatePayrollRunSchema,
  UpdatePayrollSlipSchema,
  ConfirmPayrollRunSchema,
  ListPayrollRunsInput,
} from '@coh/shared/schemas/payroll';
import { calculateSlip, getDaysInMonth, round2 } from '@coh/shared';

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
