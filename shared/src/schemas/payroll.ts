/**
 * Payroll Zod Schemas
 *
 * Validation schemas for employees, payroll runs, and URL search params.
 */

import { z } from 'zod';

// ============================================
// SEARCH PARAMS (URL state)
// ============================================

export const PayrollSearchParams = z.object({
  tab: z.enum(['employees', 'runs']).catch('employees'),
  search: z.string().optional().catch(undefined),
  department: z.string().optional().catch(undefined),
  status: z.string().optional().catch(undefined),
  showInactive: z.coerce.boolean().catch(false),
  page: z.coerce.number().int().positive().catch(1),
  limit: z.coerce.number().int().positive().max(200).catch(50),
  modal: z.enum(['create-employee', 'edit-employee', 'create-run', 'view-run']).optional().catch(undefined),
  modalId: z.string().optional().catch(undefined),
});
export type PayrollSearchParams = z.infer<typeof PayrollSearchParams>;

// ============================================
// EMPLOYEE SCHEMAS
// ============================================

export const CreateEmployeeSchema = z.object({
  name: z.string().min(1, 'Name is required'),
  employeeCode: z.string().optional(),
  phone: z.string().optional(),
  email: z.string().email().optional().or(z.literal('')),
  dateOfJoining: z.string().optional(),
  department: z.enum(['production', 'office']),
  designation: z.string().optional(),
  basicSalary: z.number().positive('Basic salary must be positive'),
  pfApplicable: z.boolean().default(true),
  esicApplicable: z.boolean().default(false),
  ptApplicable: z.boolean().default(true),
  bankAccountName: z.string().optional(),
  bankAccountNumber: z.string().optional(),
  bankIfsc: z.string().optional(),
  bankName: z.string().optional(),
  pan: z.string().optional(),
  aadhaar: z.string().optional(),
  uan: z.string().optional(),
  esicNumber: z.string().optional(),
  tailorId: z.string().uuid().optional(),
});
export type CreateEmployeeInput = z.infer<typeof CreateEmployeeSchema>;

export const UpdateEmployeeSchema = z.object({
  id: z.string().uuid(),
  name: z.string().min(1).optional(),
  employeeCode: z.string().nullable().optional(),
  phone: z.string().nullable().optional(),
  email: z.string().email().nullable().optional().or(z.literal('')),
  dateOfJoining: z.string().nullable().optional(),
  dateOfExit: z.string().nullable().optional(),
  department: z.enum(['production', 'office']).optional(),
  designation: z.string().nullable().optional(),
  basicSalary: z.number().positive().optional(),
  pfApplicable: z.boolean().optional(),
  esicApplicable: z.boolean().optional(),
  ptApplicable: z.boolean().optional(),
  bankAccountName: z.string().nullable().optional(),
  bankAccountNumber: z.string().nullable().optional(),
  bankIfsc: z.string().nullable().optional(),
  bankName: z.string().nullable().optional(),
  pan: z.string().nullable().optional(),
  aadhaar: z.string().nullable().optional(),
  uan: z.string().nullable().optional(),
  esicNumber: z.string().nullable().optional(),
  tailorId: z.string().uuid().nullable().optional(),
  isActive: z.boolean().optional(),
});
export type UpdateEmployeeInput = z.infer<typeof UpdateEmployeeSchema>;

// ============================================
// PAYROLL RUN SCHEMAS
// ============================================

export const CreatePayrollRunSchema = z.object({
  month: z.number().int().min(1).max(12),
  year: z.number().int().min(2020).max(2099),
  notes: z.string().optional(),
});
export type CreatePayrollRunInput = z.infer<typeof CreatePayrollRunSchema>;

export const UpdatePayrollSlipSchema = z.object({
  id: z.string().uuid(),
  payableDays: z.number().min(0).optional(),
  advances: z.number().min(0).optional(),
  otherDeductions: z.number().min(0).optional(),
});
export type UpdatePayrollSlipInput = z.infer<typeof UpdatePayrollSlipSchema>;

export const ConfirmPayrollRunSchema = z.object({
  id: z.string().uuid(),
});
export type ConfirmPayrollRunInput = z.infer<typeof ConfirmPayrollRunSchema>;

// ============================================
// LIST QUERY PARAMS
// ============================================

export const ListEmployeesInput = z.object({
  search: z.string().optional(),
  department: z.string().optional(),
  isActive: z.boolean().optional(),
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().positive().max(200).default(50),
}).optional();

export const ListPayrollRunsInput = z.object({
  status: z.string().optional(),
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().positive().max(200).default(50),
}).optional();

// ============================================
// DISPLAY CONSTANTS (shared between client + server)
// ============================================

export const DEPARTMENTS = ['production', 'office'] as const;

export const DEPARTMENT_LABELS: Record<string, string> = {
  production: 'Production',
  office: 'Office',
};

export function getDepartmentLabel(dept: string): string {
  return DEPARTMENT_LABELS[dept] ?? dept;
}

export const PAYROLL_STATUSES = ['draft', 'confirmed', 'cancelled'] as const;

export const PAYROLL_STATUS_LABELS: Record<string, string> = {
  draft: 'Draft',
  confirmed: 'Confirmed',
  cancelled: 'Cancelled',
};
