'use server';

import { createServerFn } from '@tanstack/react-start';
import { authMiddleware } from '../../middleware/auth';
import { getPrisma } from '@coh/shared/services/db';
import {
  UpsertLeaveRecordSchema,
  DeleteLeaveRecordSchema,
  GetAttendanceSummarySchema,
} from '@coh/shared/schemas/payroll';
import { getDaysInMonth } from '@coh/shared';

import type { AttendanceRecord } from '@prisma/client';

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

// ============================================
// ATTENDANCE RECORDS — GET (fingerprint data)
// ============================================

export const getAttendanceRecords = createServerFn({ method: 'POST' })
  .middleware([authMiddleware])
  .inputValidator((input: unknown) => GetAttendanceSummarySchema.parse(input))
  .handler(async ({ data }) => {
    const prisma = await getPrisma();

    const monthStart = new Date(data.year, data.month - 1, 1);
    const monthEnd = new Date(data.year, data.month, 0);

    const records = await prisma.attendanceRecord.findMany({
      where: {
        date: { gte: monthStart, lte: monthEnd },
      },
      include: {
        employee: {
          select: { id: true, name: true, employeeCode: true },
        },
      },
      orderBy: [{ employee: { name: 'asc' } }, { date: 'asc' }],
    });

    return {
      success: true as const,
      records: records.map((r: AttendanceRecord & { employee: { id: string; name: string; employeeCode: string | null } }) => ({
        ...r,
        date: r.date.toISOString().split('T')[0],
      })),
      month: data.month,
      year: data.year,
    };
  });
