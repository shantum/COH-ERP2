'use server';

import { createServerFn } from '@tanstack/react-start';
import { z } from 'zod';
import { authMiddleware } from '../../middleware/auth';
import { getPrisma } from '@coh/shared/services/db';
import {
  CreateEmployeeSchema,
  UpdateEmployeeSchema,
  ListEmployeesInput,
} from '@coh/shared/schemas/payroll';

async function generateEmployeeCode(prisma: Awaited<ReturnType<typeof getPrisma>>): Promise<string> {
  const existingCodes = await prisma.employee.findMany({
    where: { employeeCode: { not: null } },
    select: { employeeCode: true },
  });

  let maxNumeric = 0;
  let padWidth = 4;
  const existingSet = new Set(
    existingCodes
      .map((row) => row.employeeCode?.trim().toUpperCase())
      .filter((code): code is string => !!code),
  );

  for (const row of existingCodes) {
    const code = row.employeeCode?.trim();
    if (!code) continue;

    const numericMatch = code.match(/(\d+)(?!.*\d)/);
    if (!numericMatch) continue;

    const num = parseInt(numericMatch[1], 10);
    if (!isNaN(num)) {
      if (num > maxNumeric) maxNumeric = num;
      if (numericMatch[1].length > padWidth) padWidth = numericMatch[1].length;
    }
  }

  let next = maxNumeric + 1;
  let candidate = `EMP${String(next).padStart(padWidth, '0')}`;
  while (existingSet.has(candidate.toUpperCase())) {
    next += 1;
    candidate = `EMP${String(next).padStart(padWidth, '0')}`;
  }

  return candidate;
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
    const employeeCode = data.employeeCode?.trim() || await generateEmployeeCode(prisma);

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
        employeeCode,
        phone: data.phone,
        email: data.email || null,
        dateOfBirth: data.dateOfBirth ? new Date(data.dateOfBirth) : null,
        gender: data.gender ?? null,
        fatherOrSpouseName: data.fatherOrSpouseName ?? null,
        maritalStatus: data.maritalStatus ?? null,
        currentAddress: data.currentAddress ?? null,
        permanentAddress: data.permanentAddress ?? null,
        emergencyContactName: data.emergencyContactName ?? null,
        emergencyContactPhone: data.emergencyContactPhone ?? null,
        emergencyContactRelation: data.emergencyContactRelation ?? null,
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
        pfNumber: data.pfNumber ?? null,
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
  .handler(async ({ data, context }) => {
    const prisma = await getPrisma();
    const { id, ...updates } = data;

    const existing = await prisma.employee.findUnique({ where: { id } });
    if (!existing) return { success: false as const, error: 'Employee not found' };

    // Filter out undefined values and handle special date fields
    const updateData: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(updates)) {
      if (value === undefined) continue;
      if (key === 'dateOfJoining' || key === 'dateOfExit' || key === 'dateOfBirth') {
        updateData[key] = value ? new Date(value as string) : null;
      } else if (key === 'email') {
        updateData[key] = value || null;
      } else {
        updateData[key] = value;
      }
    }

    const employee = await prisma.employee.update({ where: { id }, data: updateData });

    // Auto-create SalaryRevision if salary or statutory flags changed
    const salaryFields = ['basicSalary', 'pfApplicable', 'esicApplicable', 'ptApplicable'] as const;
    const salaryChanged = salaryFields.some((field) => {
      if (updates[field] === undefined) return false;
      return updates[field] !== existing[field];
    });

    if (salaryChanged) {
      await prisma.salaryRevision.create({
        data: {
          employeeId: id,
          basicSalary: employee.basicSalary,
          pfApplicable: employee.pfApplicable,
          esicApplicable: employee.esicApplicable,
          ptApplicable: employee.ptApplicable,
          effectiveFrom: new Date(),
          reason: 'Updated via employee edit',
          createdById: context.user.id,
        },
      });
    }

    return { success: true as const, employee };
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
