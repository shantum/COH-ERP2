/**
 * Fingerprint Attendance XLSX Parser
 *
 * Parses monthly attendance reports from biometric fingerprint machines.
 * The XLSX format has 12-row blocks per employee:
 *   Row 1: Employee header (code, name, department, designation, DOJ)
 *   Row 2: Header row for "Status" per day
 *   Row 3: Status values (P/A/WO etc.)
 *   Row 4: Header for "Shift"
 *   Row 5: Shift values (GS etc.)
 *   Row 6: Header for "In Time"
 *   Row 7: In time values (HH:MM)
 *   Row 8: Header for "Out Time"
 *   Row 9: Out time values (HH:MM)
 *   Row 10: Header for "Late By" / "Early By" / "OT" / "Duration" / "Work Dur."
 *   Row 11: Corresponding values
 *   Row 12: Blank separator row
 *
 * Days are columns: 1, 2, 3, ... 31
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
  period: string;         // e.g. "Jan 2026"
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
  // Validate HH:MM format
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

  // Convert to array of arrays (raw cell values)
  const rows: unknown[][] = XLSX.utils.sheet_to_json(sheet, {
    header: 1,
    raw: true,
    defval: null,
  });

  if (rows.length < 3) {
    throw new Error('File has too few rows to be a valid attendance report');
  }

  // Try to detect the period from the first few rows
  let period = '';
  let daysInMonth = 31;

  // Find the header row that says "Employee Code" or similar
  // and detect the date range from column headers
  const employees: EmployeeBlock[] = [];

  // Scan for employee blocks
  let i = 0;
  while (i < rows.length) {
    const row = rows[i];
    if (!row) { i++; continue; }

    // Detect employee header row: contains "Employee Code" or starts with an employee code pattern
    const firstCell = cellStr(row[0]);

    // Look for rows that start with a code like "E001" or numeric employee codes
    // The fingerprint report typically has the employee code in column 0 of the header row
    // and columns 1..31 are the day numbers

    // Detect the "Status" label row — it usually comes right after the employee header
    if (firstCell.toLowerCase().includes('status') ||
        firstCell.toLowerCase().includes('employee code') ||
        firstCell.toLowerCase() === 'date') {
      // This is a section header row, skip
      i++;
      continue;
    }

    // Try to detect period from a "Month Year" header row
    if (!period && firstCell.match(/^(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)/i)) {
      period = firstCell;
      i++;
      continue;
    }

    // Look for employee blocks: the pattern is usually:
    // Row with employee code/name, followed by rows with day data
    // Let's use a more robust approach - find rows that have day-column data

    // Alternative approach: look for the standard fingerprint report structure
    // which has a clearly labeled header section

    // Let me try parsing by looking for rows where column pattern matches
    // status codes (P, A, WO, etc.) in columns 1-31
    const block = tryParseEmployeeBlock(rows, i);
    if (block) {
      employees.push(block.employee);
      i = block.nextRow;

      // Detect days in month from the block
      if (block.employee.days.length > 0) {
        daysInMonth = Math.max(daysInMonth, Math.max(...block.employee.days.map(d => d.day)));
      }
      continue;
    }

    i++;
  }

  // If we haven't found the period, try to derive from file or set unknown
  if (!period) period = 'Unknown';

  return { period, daysInMonth, employees };
}

interface BlockResult {
  employee: EmployeeBlock;
  nextRow: number;
}

function tryParseEmployeeBlock(rows: unknown[][], startIdx: number): BlockResult | null {
  // Fingerprint reports typically have this layout for each employee:
  //
  // Row A: [EmpCode] [EmpName] [Dept] [Desig] [DOJ] ...
  // Row B: [Status] [P] [WO] [P] [A] [P] ... (status per day)
  // Row C: [Shift]  [GS] [GS] [GS] ... (shift per day)
  // Row D: [In Time] [09:00] [09:00] ...
  // Row E: [Out Time] [18:00] [18:00] ...
  // Row F: [Late By] [00:00] [00:10] ...
  // Row G: [Early By] [00:00] [00:05] ...
  // Row H: [OT] / [Overtime] [00:00] ...
  // Row I: [Duration] / [Work Dur.] [09:00] ...
  // Row J: blank separator

  // Look for a row that has an employee code/name pattern
  // and the next row contains status codes

  if (startIdx + 1 >= rows.length) return null;

  const headerRow = rows[startIdx];
  if (!headerRow || !headerRow[0]) return null;

  const headerFirstCell = cellStr(headerRow[0]);

  // Skip known label rows
  if (['status', 'shift', 'in time', 'out time', 'late by', 'early by',
       'overtime', 'ot', 'duration', 'work dur.', 'work dur', 'date',
       'employee code', 'sl no', 'sl.no', 's.no'].some(
    label => headerFirstCell.toLowerCase() === label ||
             headerFirstCell.toLowerCase().startsWith(label)
  )) {
    return null;
  }

  // This might be an employee row. Check if following rows have recognizable patterns.
  // Employee code is typically in the first cell

  // Try to find status row (could be same row or next row)
  // In some formats, the employee header and status are on separate rows
  // In others, the employee info is in the first few columns and days start from a column offset

  // Let's handle the common format where:
  // Row 0: Employee info line
  // Row 1: Status values for days 1-31

  // First, detect column layout by finding day numbers (1, 2, 3, ...) in a header row
  // This requires scanning backwards for a day-number header row

  // Common alternative: employee code is in col 0, name in col 1,
  // and days start from col 2 or later

  // Let's try a robust approach: look for a row containing mostly P/A/WO values
  let statusRowIdx = -1;
  let shiftRowIdx = -1;
  let inTimeRowIdx = -1;
  let outTimeRowIdx = -1;
  let lateByRowIdx = -1;
  let earlyByRowIdx = -1;
  let otRowIdx = -1;
  let durationRowIdx = -1;

  // Scan from startIdx up to startIdx+12 for labeled rows
  for (let j = startIdx; j < Math.min(startIdx + 14, rows.length); j++) {
    const row = rows[j];
    if (!row) continue;
    const label = cellStr(row[0]).toLowerCase();

    if (label === 'status') statusRowIdx = j;
    else if (label === 'shift') shiftRowIdx = j;
    else if (label === 'in time' || label === 'intime' || label === 'in-time') inTimeRowIdx = j;
    else if (label === 'out time' || label === 'outtime' || label === 'out-time') outTimeRowIdx = j;
    else if (label === 'late by' || label === 'lateby' || label === 'late-by') lateByRowIdx = j;
    else if (label === 'early by' || label === 'earlyby' || label === 'early-by') earlyByRowIdx = j;
    else if (label === 'ot' || label === 'overtime' || label === 'over time') otRowIdx = j;
    else if (label === 'duration' || label === 'work dur.' || label === 'work dur' || label === 'tot dur' || label === 'tot. dur') durationRowIdx = j;
  }

  // If we can't find a status row, this isn't a valid employee block
  if (statusRowIdx < 0) return null;

  // The employee info is in the rows between startIdx and statusRowIdx
  // Parse employee code and name from the header row
  let employeeCode = '';
  let name = '';
  let department: string | null = null;
  let designation: string | null = null;

  // Employee info could be in header row cells
  const empRow = rows[startIdx];
  if (empRow) {
    // Common layout: [Code] [Name] or [Code: E001, Name: John Smith, ...]
    employeeCode = cellStr(empRow[0]);
    name = cellStr(empRow[1]) || employeeCode;

    // Sometimes code and name are combined
    const codeMatch = employeeCode.match(/^([A-Z]?\d+)\s*[-:]\s*(.+)$/i);
    if (codeMatch) {
      employeeCode = codeMatch[1];
      name = codeMatch[2];
    }

    if (empRow.length > 2) department = cellStr(empRow[2]) || null;
    if (empRow.length > 3) designation = cellStr(empRow[3]) || null;
  }

  if (!employeeCode) return null;

  // Parse day data from the labeled rows
  // Day columns typically start at column 1 (col 0 is the label)
  const statusRow = rows[statusRowIdx];
  const shiftRow = shiftRowIdx >= 0 ? rows[shiftRowIdx] : null;
  const inTimeRow = inTimeRowIdx >= 0 ? rows[inTimeRowIdx] : null;
  const outTimeRow = outTimeRowIdx >= 0 ? rows[outTimeRowIdx] : null;
  const lateByRow = lateByRowIdx >= 0 ? rows[lateByRowIdx] : null;
  const earlyByRow = earlyByRowIdx >= 0 ? rows[earlyByRowIdx] : null;
  const otRow = otRowIdx >= 0 ? rows[otRowIdx] : null;
  const durationRow = durationRowIdx >= 0 ? rows[durationRowIdx] : null;

  const days: DayRecord[] = [];

  // Determine column offset (where day 1 starts)
  // Usually column 1, but could vary
  const colOffset = 1;

  if (statusRow) {
    for (let col = colOffset; col < statusRow.length; col++) {
      const day = col - colOffset + 1;
      if (day > 31) break;

      const status = cellStr(statusRow[col]).toUpperCase();
      if (!status) continue; // Skip empty columns

      // Only include if it's a recognizable status
      if (!['P', 'A', 'WO', 'WOP', 'HD', 'L', 'PL', 'CL', 'SL', 'ML', 'OD', 'CO'].includes(status)) {
        // Might be an unrecognized code — still include it
        if (status.length > 5) continue; // Too long, probably not a status
      }

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
  }

  if (days.length === 0) return null;

  // Determine the next row after this block
  const maxRow = Math.max(
    statusRowIdx, shiftRowIdx, inTimeRowIdx, outTimeRowIdx,
    lateByRowIdx, earlyByRowIdx, otRowIdx, durationRowIdx
  );

  // Skip 1-2 blank rows after the block
  let nextRow = maxRow + 1;
  while (nextRow < rows.length && (!rows[nextRow] || rows[nextRow].every(c => !c || cellStr(c) === ''))) {
    nextRow++;
  }

  return {
    employee: { employeeCode, name, department, designation, days },
    nextRow,
  };
}
