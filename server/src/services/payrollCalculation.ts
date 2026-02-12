/**
 * Payroll Calculation Service
 *
 * Pure function that takes employee salary info + attendance and returns
 * a complete slip calculation. No DB access — just math.
 */

import {
  HRA_PERCENT,
  OTHER_ALLOWANCE_PERCENT,
  PF_EMPLOYEE_PERCENT,
  PF_EMPLOYER_PERCENT,
  PF_ADMIN_PERCENT,
  PF_WAGE_CAP,
  ESIC_EMPLOYEE_PERCENT,
  ESIC_EMPLOYER_PERCENT,
  ESIC_GROSS_THRESHOLD,
  PT_AMOUNT,
  PT_SALARY_THRESHOLD,
  round2,
  proRate,
  calculatePF,
} from '../config/payroll/index.js';

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
  const otherDed = input.otherDeductions ?? 0;

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
  if (ptApplicable && grossFixed > PT_SALARY_THRESHOLD) {
    professionalTax = PT_AMOUNT;
  }

  const totalDeductions = round2(pfEmployee + esicEmployee + professionalTax + advances + otherDed);

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
