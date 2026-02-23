/**
 * Attendance Import Routes
 *
 * Upload fingerprint XLSX, preview matched/unmatched employees,
 * then confirm to create AttendanceRecords + LeaveRecords.
 */

import { Router } from 'express';
import type { Request, Response } from 'express';
import multer from 'multer';
import path from 'path';
import fs from 'fs';
import { randomUUID } from 'crypto';
import { requireAdmin } from '../middleware/auth.js';
import { asyncHandler } from '../middleware/asyncHandler.js';
import logger from '../utils/logger.js';
import { parseAttendanceXlsx } from '../services/attendanceImport/parseXlsx.js';
import type { EmployeeBlock, DayRecord } from '../services/attendanceImport/parseXlsx.js';

const log = logger.child({ module: 'attendanceImport' });
const router = Router();

// ============================================
// MULTER CONFIG
// ============================================

const UPLOAD_DIR = '/tmp/attendance-import-uploads';
if (!fs.existsSync(UPLOAD_DIR)) {
  fs.mkdirSync(UPLOAD_DIR, { recursive: true });
}

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, UPLOAD_DIR),
  filename: (_req, file, cb) => {
    const unique = `${Date.now()}-${Math.round(Math.random() * 1e4)}`;
    cb(null, `${unique}-${file.originalname}`);
  },
});

const upload = multer({
  storage,
  limits: { fileSize: 10 * 1024 * 1024 }, // 10MB
  fileFilter: (_req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    if (['.xls', '.xlsx'].includes(ext)) {
      cb(null, true);
    } else {
      cb(new Error('Only XLS and XLSX files are allowed'));
    }
  },
});

// ============================================
// In-memory preview cache (keyed by previewId)
// Auto-expires after 30 minutes
// ============================================

interface PreviewData {
  parsedEmployees: EmployeeBlock[];
  matchedEmployees: {
    employeeId: string;
    employeeCode: string;
    name: string;
    matchedName: string;
    days: DayRecord[];
  }[];
  unmatchedNames: string[];
  month: number;
  year: number;
  daysInMonth: number;
  createdAt: number;
}

const previewCache = new Map<string, PreviewData>();

// Cleanup stale previews every 10 minutes
setInterval(() => {
  const cutoff = Date.now() - 30 * 60 * 1000;
  for (const [key, val] of previewCache) {
    if (val.createdAt < cutoff) previewCache.delete(key);
  }
}, 10 * 60 * 1000);

// ============================================
// POST /preview — Parse XLSX, match employees, return preview
// ============================================

router.post('/preview', requireAdmin, upload.single('file'), asyncHandler(async (req: Request, res: Response) => {
  if (!req.file) {
    res.status(400).json({ error: 'No file uploaded' });
    return;
  }

  const filePath = req.file.path;
  log.info({ fileName: req.file.originalname }, 'Attendance XLSX preview requested');

  try {
    // Parse the XLSX file
    const parsed = parseAttendanceXlsx(filePath);

    if (parsed.employees.length === 0) {
      res.status(400).json({ error: 'No employee data found in the file. Check the format.' });
      return;
    }

    // Parse month/year from request body
    const month = parseInt(String(req.body.month), 10);
    const year = parseInt(String(req.body.year), 10);

    if (!month || !year || month < 1 || month > 12 || year < 2020) {
      res.status(400).json({ error: 'Valid month and year are required' });
      return;
    }

    // Fetch all employees to match by employeeCode
    const allEmployees = await req.prisma.employee.findMany({
      where: { isActive: true },
      select: { id: true, name: true, employeeCode: true },
    });

    // Build code -> employee map
    const codeMap = new Map<string, { id: string; name: string; employeeCode: string }>();
    for (const emp of allEmployees) {
      if (emp.employeeCode) {
        codeMap.set(emp.employeeCode.toUpperCase().trim(), emp as { id: string; name: string; employeeCode: string });
      }
    }

    // Also build a name map for fuzzy matching
    const nameMap = new Map<string, { id: string; name: string; employeeCode: string | null }>();
    for (const emp of allEmployees) {
      nameMap.set(emp.name.toLowerCase().trim(), emp);
    }

    const matchedEmployees: PreviewData['matchedEmployees'] = [];
    const unmatchedNames: string[] = [];

    for (const block of parsed.employees) {
      // Try matching by employee code first
      const codeKey = block.employeeCode.toUpperCase().trim();
      let matched = codeMap.get(codeKey);

      // Fallback: try matching by name
      if (!matched) {
        const nameKey = block.name.toLowerCase().trim();
        const byName = nameMap.get(nameKey);
        if (byName && byName.employeeCode) {
          matched = byName as { id: string; name: string; employeeCode: string };
        }
      }

      if (matched) {
        matchedEmployees.push({
          employeeId: matched.id,
          employeeCode: matched.employeeCode,
          name: block.name,
          matchedName: matched.name,
          days: block.days,
        });
      } else {
        unmatchedNames.push(`${block.employeeCode} - ${block.name}`);
      }
    }

    // Store preview for confirmation
    const previewId = randomUUID();
    const previewData: PreviewData = {
      parsedEmployees: parsed.employees,
      matchedEmployees,
      unmatchedNames,
      month,
      year,
      daysInMonth: new Date(year, month, 0).getDate(),
      createdAt: Date.now(),
    };
    previewCache.set(previewId, previewData);

    // Build summary stats
    let totalPresent = 0;
    let totalAbsent = 0;
    let totalWO = 0;
    for (const emp of matchedEmployees) {
      for (const d of emp.days) {
        if (d.status === 'P' || d.status === 'WOP') totalPresent++;
        else if (d.status === 'A') totalAbsent++;
        else if (d.status === 'WO') totalWO++;
      }
    }

    res.json({
      previewId,
      period: parsed.period,
      month,
      year,
      totalEmployeesInFile: parsed.employees.length,
      matchedCount: matchedEmployees.length,
      unmatchedCount: unmatchedNames.length,
      unmatchedNames,
      matched: matchedEmployees.map(e => ({
        employeeCode: e.employeeCode,
        nameInFile: e.name,
        nameInSystem: e.matchedName,
        presentDays: e.days.filter(d => d.status === 'P' || d.status === 'WOP').length,
        absentDays: e.days.filter(d => d.status === 'A').length,
        weeklyOffs: e.days.filter(d => d.status === 'WO').length,
        totalDays: e.days.length,
      })),
      summary: { totalPresent, totalAbsent, totalWO },
    });
  } finally {
    fs.unlink(filePath, () => {});
  }
}));

// ============================================
// POST /confirm — Import previewed data into DB
// ============================================

router.post('/confirm', requireAdmin, asyncHandler(async (req: Request, res: Response) => {
  const { previewId } = req.body as { previewId?: string };

  if (!previewId) {
    res.status(400).json({ error: 'previewId is required' });
    return;
  }

  const preview = previewCache.get(previewId);
  if (!preview) {
    res.status(404).json({ error: 'Preview not found or expired. Please upload the file again.' });
    return;
  }

  const { matchedEmployees, month, year, daysInMonth } = preview;
  const importBatchId = randomUUID();

  log.info({
    previewId,
    matchedCount: matchedEmployees.length,
    month,
    year,
    importBatchId,
  }, 'Confirming attendance import');

  // Look up an admin user for createdById on LeaveRecords
  const adminUser = await req.prisma.user.findFirst({
    where: { role: 'admin' },
    select: { id: true },
  });

  if (!adminUser) {
    res.status(500).json({ error: 'No admin user found for record creation' });
    return;
  }

  let attendanceRecordsCreated = 0;
  let attendanceRecordsUpdated = 0;
  let leaveRecordsCreated = 0;
  let leaveRecordsDeleted = 0;

  // Process each matched employee
  for (const emp of matchedEmployees) {
    for (const day of emp.days) {
      if (day.day < 1 || day.day > daysInMonth) continue;

      const date = new Date(year, month - 1, day.day);

      // Upsert AttendanceRecord
      const existingAtt = await req.prisma.attendanceRecord.findUnique({
        where: { employeeId_date: { employeeId: emp.employeeId, date } },
      });

      if (existingAtt) {
        await req.prisma.attendanceRecord.update({
          where: { id: existingAtt.id },
          data: {
            status: day.status,
            shift: day.shift,
            inTime: day.inTime,
            outTime: day.outTime,
            lateByMins: day.lateByMins,
            earlyByMins: day.earlyByMins,
            overtimeMins: day.overtimeMins,
            durationMins: day.durationMins,
            importBatchId,
          },
        });
        attendanceRecordsUpdated++;
      } else {
        await req.prisma.attendanceRecord.create({
          data: {
            employeeId: emp.employeeId,
            date,
            status: day.status,
            shift: day.shift,
            inTime: day.inTime,
            outTime: day.outTime,
            lateByMins: day.lateByMins,
            earlyByMins: day.earlyByMins,
            overtimeMins: day.overtimeMins,
            durationMins: day.durationMins,
            importBatchId,
          },
        });
        attendanceRecordsCreated++;
      }

      // Handle LeaveRecords based on status
      if (day.status === 'A') {
        // Absent day: upsert a LeaveRecord with source=fingerprint_import
        // But don't overwrite manual records
        const existingLeave = await req.prisma.leaveRecord.findUnique({
          where: { employeeId_date: { employeeId: emp.employeeId, date } },
        });

        if (!existingLeave) {
          await req.prisma.leaveRecord.create({
            data: {
              employeeId: emp.employeeId,
              date,
              type: 'absent',
              source: 'fingerprint_import',
              reason: 'Fingerprint import — absent',
              createdById: adminUser.id,
            },
          });
          leaveRecordsCreated++;
        } else if (existingLeave.source === 'fingerprint_import') {
          // Update existing fingerprint-sourced record
          await req.prisma.leaveRecord.update({
            where: { id: existingLeave.id },
            data: { type: 'absent', reason: 'Fingerprint import — absent' },
          });
        }
        // If source === 'manual', don't touch it
      } else if (day.status === 'HD') {
        // Half day
        const existingLeave = await req.prisma.leaveRecord.findUnique({
          where: { employeeId_date: { employeeId: emp.employeeId, date } },
        });

        if (!existingLeave) {
          await req.prisma.leaveRecord.create({
            data: {
              employeeId: emp.employeeId,
              date,
              type: 'half_day',
              source: 'fingerprint_import',
              reason: 'Fingerprint import — half day',
              createdById: adminUser.id,
            },
          });
          leaveRecordsCreated++;
        } else if (existingLeave.source === 'fingerprint_import') {
          await req.prisma.leaveRecord.update({
            where: { id: existingLeave.id },
            data: { type: 'half_day', reason: 'Fingerprint import — half day' },
          });
        }
      } else if (day.status === 'P' || day.status === 'WOP') {
        // Present: delete any fingerprint-sourced LeaveRecord (correction)
        const existingLeave = await req.prisma.leaveRecord.findUnique({
          where: { employeeId_date: { employeeId: emp.employeeId, date } },
        });

        if (existingLeave && existingLeave.source === 'fingerprint_import') {
          await req.prisma.leaveRecord.delete({ where: { id: existingLeave.id } });
          leaveRecordsDeleted++;
        }
      }
      // WO days: no LeaveRecord action needed
    }
  }

  // Clean up the preview
  previewCache.delete(previewId);

  // Log domain event
  import('@coh/shared/services/eventLog').then(({ logEvent }) =>
    logEvent({
      domain: 'payroll',
      event: 'attendance.imported',
      entityType: 'AttendanceRecord',
      entityId: importBatchId,
      summary: `Imported attendance for ${matchedEmployees.length} employees (${month}/${year})`,
      meta: {
        importBatchId,
        month,
        year,
        attendanceRecordsCreated,
        attendanceRecordsUpdated,
        leaveRecordsCreated,
        leaveRecordsDeleted,
      },
      actorId: req.user?.id,
    })
  ).catch(() => {});

  log.info({
    importBatchId,
    attendanceRecordsCreated,
    attendanceRecordsUpdated,
    leaveRecordsCreated,
    leaveRecordsDeleted,
  }, 'Attendance import confirmed');

  res.json({
    success: true,
    importBatchId,
    matchedEmployees: matchedEmployees.length,
    attendanceRecordsCreated,
    attendanceRecordsUpdated,
    leaveRecordsCreated,
    leaveRecordsDeleted,
  });
}));

export default router;
