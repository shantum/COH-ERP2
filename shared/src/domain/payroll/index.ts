/**
 * Payroll Domain — calculations, constants, and attendance helpers.
 *
 * Single source of truth for all payroll math. Used by both
 * server functions (slip generation) and client (preview/display).
 */

// ============================================
// SALARY STRUCTURE
// ============================================

/** HRA = 40% of Basic */
export const HRA_PERCENT = 40;

/** Other Allowance = 60% of Basic */
export const OTHER_ALLOWANCE_PERCENT = 60;

/** Gross = Basic + HRA + Other = Basic x 2 */
export const GROSS_MULTIPLIER = 2;

// ============================================
// PROVIDENT FUND (PF)
// ============================================

/** Employee PF contribution: 12% of basic */
export const PF_EMPLOYEE_PERCENT = 12;

/** Employer PF contribution: 12% of basic */
export const PF_EMPLOYER_PERCENT = 12;

/** Employer PF admin charge: 1% of basic */
export const PF_ADMIN_PERCENT = 1;

/** PF wage cap — contributions calculated on min(basic, cap) */
export const PF_WAGE_CAP = 15_000;

// ============================================
// ESIC
// ============================================

/** Employee ESIC: 0.75% of gross */
export const ESIC_EMPLOYEE_PERCENT = 0.75;

/** Employer ESIC: 3.25% of gross */
export const ESIC_EMPLOYER_PERCENT = 3.25;

/** ESIC only applies if monthly gross <= this threshold */
export const ESIC_GROSS_THRESHOLD = 21_000;

// ============================================
// PROFESSIONAL TAX (Maharashtra)
// ============================================

/** Flat PT amount per month */
export const PT_AMOUNT = 200;

/** PT only applies if gross (fixed) > this threshold */
export const PT_GROSS_THRESHOLD = 10_000;

// ============================================
// DEPARTMENTS & STATUSES
// ============================================

export const DEPARTMENTS = ['production', 'office'] as const;
export type Department = (typeof DEPARTMENTS)[number];

export const PAYROLL_STATUSES = ['draft', 'confirmed', 'cancelled'] as const;
export type PayrollStatus = (typeof PAYROLL_STATUSES)[number];

// ============================================
// HELPERS
// ============================================

/** Round to 2 decimal places */
export function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

/** Get the number of calendar days in a given month/year */
export function getDaysInMonth(month: number, year: number): number {
  return new Date(year, month, 0).getDate();
}

/** Pro-rate a fixed amount by payable days */
export function proRate(fixedAmount: number, payableDays: number, daysInMonth: number): number {
  if (daysInMonth === 0) return 0;
  return round2(fixedAmount * payableDays / daysInMonth);
}

/**
 * Calculate PF on a basic amount, respecting the wage cap.
 * If fixed basic > cap, PF is calculated on cap (not earned basic).
 */
export function calculatePF(earnedBasic: number, fixedBasic: number, percent: number): number {
  const base = fixedBasic > PF_WAGE_CAP
    ? proRate(PF_WAGE_CAP, earnedBasic, fixedBasic)
    : earnedBasic;
  return round2(base * percent / 100);
}

// ============================================
// ATTENDANCE HELPERS
// ============================================

/** Returns a Set of day-of-month numbers that are Sundays */
export function getSundays(month: number, year: number): Set<number> {
  const sundays = new Set<number>();
  const daysInMonth = new Date(year, month, 0).getDate();
  for (let day = 1; day <= daysInMonth; day++) {
    if (new Date(year, month - 1, day).getDay() === 0) {
      sundays.add(day);
    }
  }
  return sundays;
}

interface LeaveForCalc {
  type: string; // "absent" | "half_day"
}

export function calculatePayableDays(
  daysInMonth: number,
  leaves: LeaveForCalc[],
): { fullDayLeaves: number; halfDayLeaves: number; payableDays: number } {
  let fullDayLeaves = 0;
  let halfDayLeaves = 0;

  for (const leave of leaves) {
    if (leave.type === 'absent') fullDayLeaves++;
    else if (leave.type === 'half_day') halfDayLeaves++;
  }

  const payableDays = Math.max(0, daysInMonth - fullDayLeaves - halfDayLeaves * 0.5);
  return { fullDayLeaves, halfDayLeaves, payableDays };
}

// ============================================
// SLIP CALCULATION
// ============================================

export interface SlipInput {
  basicSalary: number;
  pfApplicable: boolean;
  esicApplicable: boolean;
  ptApplicable: boolean;
  payableDays: number;
  daysInMonth: number;
  advances?: number;
  otherDeductions?: number;
}

export interface SlipResult {
  // Fixed (full-month values)
  basicFixed: number;
  hraFixed: number;
  otherAllowanceFixed: number;
  grossFixed: number;

  // Earned (pro-rated)
  basicEarned: number;
  hraEarned: number;
  otherAllowanceEarned: number;
  grossEarned: number;

  // Employee deductions
  pfEmployee: number;
  esicEmployee: number;
  professionalTax: number;
  advances: number;
  otherDeductions: number;
  totalDeductions: number;

  // Net pay
  netPay: number;

  // Employer contributions
  pfEmployer: number;
  pfAdmin: number;
  esicEmployer: number;
  totalEmployerCost: number;
  costToCompany: number;
}

/**
 * Calculate a complete payroll slip for one employee.
 *
 * 1. Fixed components from basic salary
 * 2. Pro-rate by attendance
 * 3. Apply statutory deductions
 * 4. Calculate employer costs
 */
export function calculateSlip(input: SlipInput): SlipResult {
  const { basicSalary, pfApplicable, esicApplicable, ptApplicable, payableDays, daysInMonth } = input;
  const advances = input.advances ?? 0;
  const otherDeductions = input.otherDeductions ?? 0;

  // 1. Fixed components (full-month salary structure)
  const basicFixed = basicSalary;
  const hraFixed = round2(basicSalary * HRA_PERCENT / 100);
  const otherAllowanceFixed = round2(basicSalary * OTHER_ALLOWANCE_PERCENT / 100);
  const grossFixed = round2(basicFixed + hraFixed + otherAllowanceFixed);

  // 2. Pro-rate by payable days
  const basicEarned = proRate(basicFixed, payableDays, daysInMonth);
  const hraEarned = proRate(hraFixed, payableDays, daysInMonth);
  const otherAllowanceEarned = proRate(otherAllowanceFixed, payableDays, daysInMonth);
  const grossEarned = round2(basicEarned + hraEarned + otherAllowanceEarned);

  // 3. Employee deductions
  let pfEmployee = 0;
  if (pfApplicable) {
    pfEmployee = calculatePF(basicEarned, basicFixed, PF_EMPLOYEE_PERCENT);
  }

  let esicEmployee = 0;
  if (esicApplicable && grossFixed <= ESIC_GROSS_THRESHOLD) {
    esicEmployee = round2(grossEarned * ESIC_EMPLOYEE_PERCENT / 100);
  }

  let professionalTax = 0;
  if (ptApplicable && grossFixed > PT_GROSS_THRESHOLD) {
    professionalTax = PT_AMOUNT;
  }

  const totalDeductions = round2(pfEmployee + esicEmployee + professionalTax + advances + otherDeductions);

  // 4. Net pay
  const netPay = round2(grossEarned - totalDeductions);

  // 5. Employer contributions
  let pfEmployer = 0;
  let pfAdmin = 0;
  if (pfApplicable) {
    pfEmployer = calculatePF(basicEarned, basicFixed, PF_EMPLOYER_PERCENT);
    pfAdmin = calculatePF(basicEarned, basicFixed, PF_ADMIN_PERCENT);
  }

  let esicEmployer = 0;
  if (esicApplicable && grossFixed <= ESIC_GROSS_THRESHOLD) {
    esicEmployer = round2(grossEarned * ESIC_EMPLOYER_PERCENT / 100);
  }

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
    otherDeductions,
    totalDeductions,
    netPay,
    pfEmployer,
    pfAdmin,
    esicEmployer,
    totalEmployerCost,
    costToCompany,
  };
}
