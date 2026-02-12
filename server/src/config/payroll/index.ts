/**
 * Payroll Configuration
 *
 * All salary structure rates, statutory thresholds, and payroll helpers.
 * No magic numbers in business logic — everything lives here.
 */

// ============================================
// SALARY STRUCTURE
// ============================================

/** HRA = 40% of Basic */
export const HRA_PERCENT = 40;

/** Other Allowance = 60% of Basic */
export const OTHER_ALLOWANCE_PERCENT = 60;

/** Gross = Basic + HRA + Other = Basic × 2 */
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

/** ESIC only applies if monthly gross ≤ this threshold */
export const ESIC_GROSS_THRESHOLD = 21_000;

// ============================================
// PROFESSIONAL TAX (Maharashtra)
// ============================================

/** Flat PT amount per month */
export const PT_AMOUNT = 200;

/** PT only applies if salary > this threshold */
export const PT_SALARY_THRESHOLD = 10_000;

// ============================================
// DEPARTMENTS
// ============================================

export const DEPARTMENTS = ['production', 'office'] as const;
export type Department = (typeof DEPARTMENTS)[number];

// ============================================
// PAYROLL RUN STATUSES
// ============================================

export const PAYROLL_STATUSES = ['draft', 'confirmed', 'cancelled'] as const;
export type PayrollStatus = (typeof PAYROLL_STATUSES)[number];

// ============================================
// HELPERS
// ============================================

/** Get the number of calendar days in a given month/year */
export function getDaysInMonth(month: number, year: number): number {
  return new Date(year, month, 0).getDate();
}

/** Pro-rate a fixed amount by payable days */
export function proRate(fixedAmount: number, payableDays: number, daysInMonth: number): number {
  if (daysInMonth === 0) return 0;
  return round2(fixedAmount * payableDays / daysInMonth);
}

/** Round to 2 decimal places */
export function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

/**
 * Calculate PF on a basic amount, respecting the wage cap.
 * If fixed basic > cap, PF is calculated on cap (not earned basic).
 */
export function calculatePF(earnedBasic: number, fixedBasic: number, percent: number): number {
  const base = fixedBasic > PF_WAGE_CAP
    ? proRate(PF_WAGE_CAP, earnedBasic, fixedBasic) // Pro-rate the cap
    : earnedBasic;
  return round2(base * percent / 100);
}
