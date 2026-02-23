/**
 * Fingerprint Attendance XLSX Parser
 *
 * Parses monthly attendance reports from biometric fingerprint machines.
 *
 * Actual XLSX structure (12-row blocks per employee):
 *   Row 0: "EmployeeCode" in col 0, code in col 7, "EmployeeName" in col 14, name in col 19
 *   Row 1: Day headers "1-Sun", "2-Mon", ... starting at col 1
 *   Row 2: Summary text (Total Present - X Total Absent - Y ...)
 *   Row 3: "Shift" + values per day
 *   Row 4: "In Time" + values per day
 *   Row 5: "Out Time" + values per day
 *   Row 6: "Late By" + values per day
 *   Row 7: "Early By" + values per day
 *   Row 8: "Total OT" + values per day
 *   Row 9: "T Duration" + values per day
 *   Row 10: "Status" + values per day (P/A/WO etc.)
 *   Row 11: blank separator
 *
 * First 3 rows of the file are:
 *   Row 0: blank
 *   Row 1: title "Monthly Detailed Attendance Report(...)"
 *   Row 2: period "01-Feb-2026 to 22-Feb-2026"
 *   Row 3+: employee blocks
 */

import XLSX from 'xlsx';

// ============================================
// TYPES
// ============================================

export interface DayRecord {
  day: number;
  status: string;      // "P" | "A" | "WO" | "WOP" | "HD" | "L" | string
  shift: string | null;
  inTime: string | null;
  outTime: string | null;
  lateByMins: number;
  earlyByMins: number;
  overtimeMins: number;
  durationMins: number;
}

export interface EmployeeBlock {
  employeeCode: string;
  name: string;
  department: string | null;
  designation: string | null;
  days: DayRecord[];
}

export interface ParsedAttendanceReport {
  period: string;         // e.g. "01-Feb-2026 to 22-Feb-2026"
  daysInMonth: number;
  employees: EmployeeBlock[];
}

// ============================================
// HELPERS
// ============================================

/** Parse "HH:MM" duration string to minutes */
function timeToMins(val: unknown): number {
  if (val == null) return 0;
  const s = String(val).trim();
  if (!s || s === '00:00' || s === '0:00') return 0;
  const m = s.match(/^(\d{1,2}):(\d{2})$/);
  if (!m) return 0;
  return parseInt(m[1], 10) * 60 + parseInt(m[2], 10);
}

/** Parse time string, return null for empty/zero */
function parseTime(val: unknown): string | null {
  if (val == null) return null;
  const s = String(val).trim();
  if (!s || s === '00:00' || s === '0:00') return null;
  if (/^\d{1,2}:\d{2}$/.test(s)) return s;
  return null;
}

/** Get string value from cell, trimmed */
function cellStr(val: unknown): string {
  if (val == null) return '';
  return String(val).trim();
}

// ============================================
// PARSER
// ============================================

export function parseAttendanceXlsx(filePath: string): ParsedAttendanceReport {
  const workbook = XLSX.readFile(filePath, { cellDates: false });
  const sheet = workbook.Sheets[workbook.SheetNames[0]];
  if (!sheet) throw new Error('No sheets found in workbook');

  const rows: unknown[][] = XLSX.utils.sheet_to_json(sheet, {
    header: 1,
    raw: true,
    defval: null,
  });

  if (rows.length < 5) {
    throw new Error('File has too few rows to be a valid attendance report');
  }

  // Detect period from row 2 (e.g. "01-Feb-2026 to 22-Feb-2026")
  let period = '';
  for (let i = 0; i < Math.min(5, rows.length); i++) {
    const row = rows[i];
    if (!row) continue;
    const first = cellStr(row[0]);
    if (first.match(/^\d{2}-\w{3}-\d{4}\s+to\s+\d{2}-\w{3}-\d{4}$/i)) {
      period = first;
      break;
    }
  }

  // Scan for employee blocks
  const employees: EmployeeBlock[] = [];
  let maxDay = 0;
  let i = 0;

  while (i < rows.length) {
    const row = rows[i];
    if (!row) { i++; continue; }

    const firstCell = cellStr(row[0]);

    // Detect employee header: col 0 starts with "EmployeeCode"
    if (firstCell.toLowerCase().startsWith('employeecode')) {
      const block = parseEmployeeBlock(rows, i);
      if (block) {
        employees.push(block.employee);
        if (block.employee.days.length > 0) {
          maxDay = Math.max(maxDay, ...block.employee.days.map(d => d.day));
        }
        i = block.nextRow;
        continue;
      }
    }

    i++;
  }

  // Determine days in month from the data or period string
  let daysInMonth = maxDay || 31;
  if (period) {
    // Try to extract month/year from period to calculate actual days
    const match = period.match(/(\d{2})-(\w{3})-(\d{4})$/);
    if (match) {
      const monthNames: Record<string, number> = {
        jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6,
        jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12,
      };
      const m = monthNames[match[2].toLowerCase()];
      const y = parseInt(match[3], 10);
      if (m && y) {
        daysInMonth = new Date(y, m, 0).getDate();
      }
    }
  }

  if (!period) period = 'Unknown';

  return { period, daysInMonth, employees };
}

interface BlockResult {
  employee: EmployeeBlock;
  nextRow: number;
}

function parseEmployeeBlock(rows: unknown[][], startIdx: number): BlockResult | null {
  // Row layout within a block (12 rows):
  //   startIdx + 0: EmployeeCode header (code in col 7, name in col 19)
  //   startIdx + 1: Day headers (1-Sun, 2-Mon, ...)
  //   startIdx + 2: Summary text
  //   startIdx + 3: Shift
  //   startIdx + 4: In Time
  //   startIdx + 5: Out Time
  //   startIdx + 6: Late By
  //   startIdx + 7: Early By
  //   startIdx + 8: Total OT
  //   startIdx + 9: T Duration
  //   startIdx + 10: Status
  //   startIdx + 11: blank separator

  if (startIdx + 10 >= rows.length) return null;

  const headerRow = rows[startIdx];
  if (!headerRow) return null;

  // Extract employee code and name
  // Code is in col 7, name is in col 19 (based on actual file inspection)
  // But these positions might vary — scan for the values
  let employeeCode = '';
  let name = '';

  // The header row has: "EmployeeCode" at col 0, code value nearby,
  // "EmployeeName" at col 14, name value nearby
  // Scan the row for the pattern
  for (let c = 0; c < headerRow.length; c++) {
    const val = cellStr(headerRow[c]);
    if (val.toLowerCase().startsWith('employeecode')) {
      // Code should be in a nearby column (within next 10 cols)
      for (let k = c + 1; k < Math.min(c + 12, headerRow.length); k++) {
        const v = cellStr(headerRow[k]);
        if (v && !v.toLowerCase().startsWith('employee')) {
          employeeCode = v;
          break;
        }
      }
    }
    if (val.toLowerCase().startsWith('employeename')) {
      // Name should be in a nearby column
      for (let k = c + 1; k < Math.min(c + 12, headerRow.length); k++) {
        const v = cellStr(headerRow[k]);
        if (v && !v.toLowerCase().startsWith('employee')) {
          name = v;
          break;
        }
      }
    }
  }

  if (!employeeCode) return null;
  if (!name) name = employeeCode;

  // Find labeled rows by scanning from startIdx+2 to startIdx+12
  let statusRowIdx = -1;
  let shiftRowIdx = -1;
  let inTimeRowIdx = -1;
  let outTimeRowIdx = -1;
  let lateByRowIdx = -1;
  let earlyByRowIdx = -1;
  let otRowIdx = -1;
  let durationRowIdx = -1;

  for (let j = startIdx + 2; j < Math.min(startIdx + 14, rows.length); j++) {
    const row = rows[j];
    if (!row) continue;
    const label = cellStr(row[0]).toLowerCase();

    if (label === 'status') statusRowIdx = j;
    else if (label === 'shift') shiftRowIdx = j;
    else if (label === 'in time' || label === 'intime' || label === 'in-time') inTimeRowIdx = j;
    else if (label === 'out time' || label === 'outtime' || label === 'out-time') outTimeRowIdx = j;
    else if (label === 'late by' || label === 'lateby' || label === 'late-by') lateByRowIdx = j;
    else if (label === 'early by' || label === 'earlyby' || label === 'early-by') earlyByRowIdx = j;
    else if (label === 'total ot' || label === 'ot' || label === 'overtime' || label === 'over time') otRowIdx = j;
    else if (label === 't duration' || label === 'duration' || label === 'work dur.' || label === 'work dur' || label === 'tot dur' || label === 'tot. dur') durationRowIdx = j;
  }

  if (statusRowIdx < 0) return null;

  // Determine day column mapping from the day header row (startIdx + 1)
  // Format: "1-Sun", "2-Mon", etc. starting at col 1
  const dayHeaderRow = rows[startIdx + 1];
  const dayColMap: { col: number; day: number }[] = [];

  if (dayHeaderRow) {
    for (let c = 1; c < dayHeaderRow.length; c++) {
      const val = cellStr(dayHeaderRow[c]);
      const dayMatch = val.match(/^(\d{1,2})-/);
      if (dayMatch) {
        dayColMap.push({ col: c, day: parseInt(dayMatch[1], 10) });
      }
    }
  }

  // Fallback: if no day headers found, assume col 1 = day 1
  if (dayColMap.length === 0) {
    const statusRow = rows[statusRowIdx];
    if (statusRow) {
      for (let c = 1; c < statusRow.length; c++) {
        dayColMap.push({ col: c, day: c });
      }
    }
  }

  // Parse day records
  const statusRow = rows[statusRowIdx];
  const shiftRow = shiftRowIdx >= 0 ? rows[shiftRowIdx] : null;
  const inTimeRow = inTimeRowIdx >= 0 ? rows[inTimeRowIdx] : null;
  const outTimeRow = outTimeRowIdx >= 0 ? rows[outTimeRowIdx] : null;
  const lateByRow = lateByRowIdx >= 0 ? rows[lateByRowIdx] : null;
  const earlyByRow = earlyByRowIdx >= 0 ? rows[earlyByRowIdx] : null;
  const otRow = otRowIdx >= 0 ? rows[otRowIdx] : null;
  const durationRow = durationRowIdx >= 0 ? rows[durationRowIdx] : null;

  const days: DayRecord[] = [];

  for (const { col, day } of dayColMap) {
    if (day > 31) break;

    const status = statusRow ? cellStr(statusRow[col]).toUpperCase() : '';
    if (!status) continue;

    // Only include recognizable status codes (allow short unknown codes too)
    if (status.length > 5) continue;

    days.push({
      day,
      status,
      shift: shiftRow ? cellStr(shiftRow[col]) || null : null,
      inTime: inTimeRow ? parseTime(inTimeRow[col]) : null,
      outTime: outTimeRow ? parseTime(outTimeRow[col]) : null,
      lateByMins: lateByRow ? timeToMins(lateByRow[col]) : 0,
      earlyByMins: earlyByRow ? timeToMins(earlyByRow[col]) : 0,
      overtimeMins: otRow ? timeToMins(otRow[col]) : 0,
      durationMins: durationRow ? timeToMins(durationRow[col]) : 0,
    });
  }

  if (days.length === 0) return null;

  // Next row: skip past the block (12 rows typical) + any blank rows
  const maxRow = Math.max(
    statusRowIdx, shiftRowIdx, inTimeRowIdx, outTimeRowIdx,
    lateByRowIdx, earlyByRowIdx, otRowIdx, durationRowIdx
  );

  let nextRow = maxRow + 1;
  while (nextRow < rows.length) {
    const row = rows[nextRow];
    if (!row || row.every(c => c == null || cellStr(c) === '')) {
      nextRow++;
    } else {
      break;
    }
  }

  return {
    employee: { employeeCode, name, department: null, designation: null, days },
    nextRow,
  };
}
