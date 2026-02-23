/**
 * Payroll Page
 *
 * Employees tab + Payroll Runs tab.
 */

import { useState, useCallback, useMemo } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useServerFn } from '@tanstack/react-start';
import { useNavigate } from '@tanstack/react-router';
import { Route } from '../routes/_authenticated/payroll';
import {
  listEmployees,
  getEmployee,
  createEmployee,
  updateEmployee,
  listPayrollRuns,
  getPayrollRun,
  createPayrollRun,
  updatePayrollSlip,
  confirmPayrollRun,
  cancelPayrollRun,
  listTailorsForLinking,
  getAttendanceSummary,
  upsertLeaveRecord,
  deleteLeaveRecord,
} from '../server/functions/payroll';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DialogDescription,
} from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Checkbox } from '@/components/ui/checkbox';
import {
  Calculator,
  Plus,
  Users,
  FileSpreadsheet,
  CalendarDays,
  Loader2,
  ChevronLeft,
  ChevronRight,
  Check,
  X,
  ArrowLeft,
  Pencil,
  Trash2,
} from 'lucide-react';
import {
  type PayrollSearchParams,
  DEPARTMENTS,
  getDepartmentLabel,
  PAYROLL_STATUS_LABELS,
  LEAVE_TYPES,
  LEAVE_TYPE_LABELS,
} from '@coh/shared';
import { Textarea } from '@/components/ui/textarea';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';

// ============================================
// HELPERS
// ============================================

function formatINR(amount: number): string {
  return '₹' + amount.toLocaleString('en-IN', { maximumFractionDigits: 0 });
}

const MONTH_NAMES = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

function StatusBadge({ status }: { status: string }) {
  const variant =
    status === 'confirmed' ? 'default' :
    status === 'draft' ? 'secondary' :
    status === 'cancelled' ? 'destructive' :
    'outline';
  return <Badge variant={variant}>{PAYROLL_STATUS_LABELS[status] ?? status}</Badge>;
}

function Pagination({ page, total, limit, onPageChange }: { page: number; total: number; limit: number; onPageChange: (p: number) => void }) {
  const totalPages = Math.ceil(total / limit);
  if (totalPages <= 1) return null;
  return (
    <div className="flex items-center justify-between mt-4 text-sm text-muted-foreground">
      <span>{total} total</span>
      <div className="flex items-center gap-2">
        <Button variant="outline" size="sm" disabled={page <= 1} onClick={() => onPageChange(page - 1)}>
          <ChevronLeft className="h-4 w-4" />
        </Button>
        <span>Page {page} of {totalPages}</span>
        <Button variant="outline" size="sm" disabled={page >= totalPages} onClick={() => onPageChange(page + 1)}>
          <ChevronRight className="h-4 w-4" />
        </Button>
      </div>
    </div>
  );
}

function LoadingState() {
  return (
    <div className="flex items-center justify-center p-12 text-muted-foreground">
      <Loader2 className="h-5 w-5 animate-spin mr-2" /> Loading...
    </div>
  );
}

// ============================================
// MAIN PAGE
// ============================================

export default function Payroll() {
  const search = Route.useSearch();
  const navigate = useNavigate();

  const handleTabChange = useCallback(
    (tab: string) => {
      navigate({
        to: '/payroll',
        search: { ...search, tab: tab as PayrollSearchParams['tab'], page: 1, modal: undefined, modalId: undefined },
        replace: true,
      });
    },
    [navigate, search],
  );

  return (
    <div className="p-4 max-w-[1400px] mx-auto">
      <div className="flex items-center justify-between mb-4">
        <h1 className="text-2xl font-bold flex items-center gap-2">
          <Calculator className="h-6 w-6" />
          Payroll
        </h1>
      </div>

      <Tabs value={search.tab || 'employees'} onValueChange={handleTabChange}>
        <TabsList>
          <TabsTrigger value="employees" className="gap-1.5">
            <Users className="h-4 w-4" /> Employees
          </TabsTrigger>
          <TabsTrigger value="runs" className="gap-1.5">
            <FileSpreadsheet className="h-4 w-4" /> Payroll Runs
          </TabsTrigger>
          <TabsTrigger value="attendance" className="gap-1.5">
            <CalendarDays className="h-4 w-4" /> Attendance
          </TabsTrigger>
        </TabsList>

        <TabsContent value="employees">
          <EmployeesTab />
        </TabsContent>
        <TabsContent value="runs">
          {search.modalId && search.modal === 'view-run' ? (
            <PayrollRunDetail runId={search.modalId} />
          ) : (
            <PayrollRunsTab />
          )}
        </TabsContent>
        <TabsContent value="attendance">
          <AttendanceTab />
        </TabsContent>
      </Tabs>
    </div>
  );
}

// ============================================
// EMPLOYEES TAB
// ============================================

function EmployeesTab() {
  const search = Route.useSearch();
  const navigate = useNavigate();
  const qc = useQueryClient();

  const listFn = useServerFn(listEmployees);
  const { data, isLoading } = useQuery({
    queryKey: ['payroll', 'employees', search.department, search.search, search.showInactive, search.page],
    queryFn: () =>
      listFn({
        data: {
          ...(search.department ? { department: search.department } : {}),
          ...(search.search ? { search: search.search } : {}),
          isActive: search.showInactive ? undefined : true,
          page: search.page,
          limit: search.limit,
        },
      }),
  });

  const setSearch = useCallback(
    (updates: Partial<PayrollSearchParams>) => {
      navigate({ to: '/payroll', search: { ...search, ...updates }, replace: true });
    },
    [navigate, search],
  );

  const [showModal, setShowModal] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);

  return (
    <div>
      {/* Filters */}
      <div className="flex flex-wrap gap-2 mb-4 items-center">
        <Input
          placeholder="Search employees..."
          value={search.search ?? ''}
          onChange={(e) => setSearch({ search: e.target.value || undefined, page: 1 })}
          className="w-60"
        />
        <Select
          value={search.department ?? 'all'}
          onValueChange={(v) => setSearch({ department: v === 'all' ? undefined : v, page: 1 })}
        >
          <SelectTrigger className="w-40">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Departments</SelectItem>
            {DEPARTMENTS.map((d) => (
              <SelectItem key={d} value={d}>{getDepartmentLabel(d)}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        <label className="flex items-center gap-2 text-sm text-muted-foreground cursor-pointer">
          <Checkbox
            checked={search.showInactive}
            onCheckedChange={(v) => setSearch({ showInactive: !!v, page: 1 })}
          />
          Show inactive
        </label>
        <div className="flex-1" />
        <Button onClick={() => { setEditId(null); setShowModal(true); }}>
          <Plus className="h-4 w-4 mr-1" /> Add Employee
        </Button>
      </div>

      {/* Table */}
      {isLoading ? (
        <LoadingState />
      ) : (
        <>
          <div className="border rounded-lg overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-muted/50">
                <tr>
                  <th className="text-left p-3 font-medium">Name</th>
                  <th className="text-left p-3 font-medium">Dept</th>
                  <th className="text-left p-3 font-medium">Designation</th>
                  <th className="text-right p-3 font-medium">Basic</th>
                  <th className="text-right p-3 font-medium">Gross</th>
                  <th className="text-center p-3 font-medium">PF</th>
                  <th className="text-center p-3 font-medium">ESIC</th>
                  <th className="text-center p-3 font-medium">PT</th>
                  <th className="text-center p-3 font-medium">Status</th>
                  <th className="p-3"></th>
                </tr>
              </thead>
              <tbody>
                {data?.employees?.map((emp) => (
                  <tr key={emp.id} className="border-t hover:bg-muted/30">
                    <td className="p-3 font-medium">{emp.name}</td>
                    <td className="p-3">
                      <Badge variant="outline">{getDepartmentLabel(emp.department)}</Badge>
                    </td>
                    <td className="p-3 text-muted-foreground">{emp.designation ?? '—'}</td>
                    <td className="p-3 text-right font-mono">{formatINR(emp.basicSalary)}</td>
                    <td className="p-3 text-right font-mono">{formatINR(emp.basicSalary * 2)}</td>
                    <td className="p-3 text-center">{emp.pfApplicable ? <Check className="h-4 w-4 text-green-600 mx-auto" /> : <X className="h-4 w-4 text-muted-foreground/40 mx-auto" />}</td>
                    <td className="p-3 text-center">{emp.esicApplicable ? <Check className="h-4 w-4 text-green-600 mx-auto" /> : <X className="h-4 w-4 text-muted-foreground/40 mx-auto" />}</td>
                    <td className="p-3 text-center">{emp.ptApplicable ? <Check className="h-4 w-4 text-green-600 mx-auto" /> : <X className="h-4 w-4 text-muted-foreground/40 mx-auto" />}</td>
                    <td className="p-3 text-center">
                      <Badge variant={emp.isActive ? 'default' : 'secondary'}>
                        {emp.isActive ? 'Active' : 'Inactive'}
                      </Badge>
                    </td>
                    <td className="p-3">
                      <Button variant="ghost" size="sm" onClick={() => { setEditId(emp.id); setShowModal(true); }}>
                        <Pencil className="h-3.5 w-3.5" />
                      </Button>
                    </td>
                  </tr>
                ))}
                {(!data?.employees || data.employees.length === 0) && (
                  <tr>
                    <td colSpan={10} className="p-8 text-center text-muted-foreground">No employees found</td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
          {data && (
            <Pagination
              page={data.page}
              total={data.total}
              limit={data.limit}
              onPageChange={(p) => setSearch({ page: p })}
            />
          )}
        </>
      )}

      {/* Create/Edit Modal */}
      {showModal && (
        <EmployeeModal
          employeeId={editId}
          onClose={() => { setShowModal(false); setEditId(null); }}
          onSaved={() => {
            setShowModal(false);
            setEditId(null);
            qc.invalidateQueries({ queryKey: ['payroll'] });
          }}
        />
      )}
    </div>
  );
}

// ============================================
// EMPLOYEE MODAL (Create / Edit)
// ============================================

function EmployeeModal({
  employeeId,
  onClose,
  onSaved,
}: {
  employeeId: string | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const isEdit = !!employeeId;

  const getFn = useServerFn(getEmployee);
  const createFn = useServerFn(createEmployee);
  const updateFn = useServerFn(updateEmployee);
  const tailorsFn = useServerFn(listTailorsForLinking);

  const { data: empData, isLoading: loadingEmp } = useQuery({
    queryKey: ['payroll', 'employee', employeeId],
    queryFn: () => getFn({ data: { id: employeeId! } }),
    enabled: isEdit,
  });

  const { data: tailorsData } = useQuery({
    queryKey: ['payroll', 'tailors-for-linking'],
    queryFn: () => tailorsFn(),
  });

  const emp = empData?.success ? empData.employee : null;

  const [form, setForm] = useState({
    name: '',
    department: 'production' as string,
    designation: '',
    basicSalary: '',
    pfApplicable: true,
    esicApplicable: false,
    ptApplicable: true,
    phone: '',
    email: '',
    dateOfJoining: '',
    bankAccountName: '',
    bankAccountNumber: '',
    bankIfsc: '',
    bankName: '',
    pan: '',
    aadhaar: '',
    uan: '',
    esicNumber: '',
    tailorId: '',
    isActive: true,
  });

  // Populate form when editing
  const [formLoaded, setFormLoaded] = useState(false);
  if (isEdit && emp && !formLoaded) {
    setForm({
      name: emp.name,
      department: emp.department,
      designation: emp.designation ?? '',
      basicSalary: String(emp.basicSalary),
      pfApplicable: emp.pfApplicable,
      esicApplicable: emp.esicApplicable,
      ptApplicable: emp.ptApplicable,
      phone: emp.phone ?? '',
      email: emp.email ?? '',
      dateOfJoining: emp.dateOfJoining ? new Date(emp.dateOfJoining).toISOString().split('T')[0] : '',
      bankAccountName: emp.bankAccountName ?? '',
      bankAccountNumber: emp.bankAccountNumber ?? '',
      bankIfsc: emp.bankIfsc ?? '',
      bankName: emp.bankName ?? '',
      pan: emp.pan ?? '',
      aadhaar: emp.aadhaar ?? '',
      uan: emp.uan ?? '',
      esicNumber: emp.esicNumber ?? '',
      tailorId: emp.tailorId ?? '',
      isActive: emp.isActive,
    });
    setFormLoaded(true);
  }

  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const handleSave = async () => {
    setSaving(true);
    setError('');
    try {
      const basicSalary = parseFloat(form.basicSalary);
      if (isNaN(basicSalary) || basicSalary <= 0) {
        setError('Enter a valid basic salary');
        setSaving(false);
        return;
      }
      if (!form.name.trim()) {
        setError('Name is required');
        setSaving(false);
        return;
      }

      if (isEdit) {
        const res = await updateFn({
          data: {
            id: employeeId!,
            name: form.name,
            department: form.department as 'production' | 'office',
            designation: form.designation || null,
            basicSalary,
            pfApplicable: form.pfApplicable,
            esicApplicable: form.esicApplicable,
            ptApplicable: form.ptApplicable,
            phone: form.phone || null,
            email: form.email || null,
            dateOfJoining: form.dateOfJoining || null,
            bankAccountName: form.bankAccountName || null,
            bankAccountNumber: form.bankAccountNumber || null,
            bankIfsc: form.bankIfsc || null,
            bankName: form.bankName || null,
            pan: form.pan || null,
            aadhaar: form.aadhaar || null,
            uan: form.uan || null,
            esicNumber: form.esicNumber || null,
            tailorId: form.tailorId || null,
            isActive: form.isActive,
          },
        });
        if (!res.success) { setError(res.error); setSaving(false); return; }
      } else {
        const res = await createFn({
          data: {
            name: form.name,
            department: form.department as 'production' | 'office',
            ...(form.designation ? { designation: form.designation } : {}),
            basicSalary,
            pfApplicable: form.pfApplicable,
            esicApplicable: form.esicApplicable,
            ptApplicable: form.ptApplicable,
            ...(form.phone ? { phone: form.phone } : {}),
            ...(form.email ? { email: form.email } : {}),
            ...(form.dateOfJoining ? { dateOfJoining: form.dateOfJoining } : {}),
            ...(form.bankAccountName ? { bankAccountName: form.bankAccountName } : {}),
            ...(form.bankAccountNumber ? { bankAccountNumber: form.bankAccountNumber } : {}),
            ...(form.bankIfsc ? { bankIfsc: form.bankIfsc } : {}),
            ...(form.bankName ? { bankName: form.bankName } : {}),
            ...(form.pan ? { pan: form.pan } : {}),
            ...(form.aadhaar ? { aadhaar: form.aadhaar } : {}),
            ...(form.uan ? { uan: form.uan } : {}),
            ...(form.esicNumber ? { esicNumber: form.esicNumber } : {}),
            ...(form.tailorId ? { tailorId: form.tailorId } : {}),
          },
        });
        if (!res.success) { setError('Failed to create employee'); setSaving(false); return; }
      }

      onSaved();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error');
    } finally {
      setSaving(false);
    }
  };

  const gross = parseFloat(form.basicSalary) * 2 || 0;

  return (
    <Dialog open onOpenChange={() => onClose()}>
      <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{isEdit ? 'Edit Employee' : 'Add Employee'}</DialogTitle>
          <DialogDescription>
            {isEdit ? 'Update employee details and salary structure.' : 'Add a new employee to the payroll system.'}
          </DialogDescription>
        </DialogHeader>

        {isEdit && loadingEmp ? (
          <LoadingState />
        ) : (
          <div className="space-y-4">
            {/* Basic Info */}
            <div className="grid grid-cols-2 gap-3">
              <div className="col-span-2">
                <Label>Name *</Label>
                <Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
              </div>
              <div>
                <Label>Department *</Label>
                <Select value={form.department} onValueChange={(v) => setForm({ ...form, department: v })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {DEPARTMENTS.map((d) => (
                      <SelectItem key={d} value={d}>{getDepartmentLabel(d)}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label>Designation</Label>
                <Input value={form.designation} onChange={(e) => setForm({ ...form, designation: e.target.value })} placeholder="e.g. Senior Tailor" />
              </div>
            </div>

            {/* Salary */}
            <div className="border rounded-lg p-3 bg-muted/30">
              <Label className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Salary Structure</Label>
              <div className="grid grid-cols-2 gap-3 mt-2">
                <div>
                  <Label>Basic Salary *</Label>
                  <Input type="number" value={form.basicSalary} onChange={(e) => setForm({ ...form, basicSalary: e.target.value })} placeholder="e.g. 12000" />
                </div>
                <div>
                  <Label>Gross (auto)</Label>
                  <Input value={gross ? formatINR(gross) : ''} disabled className="bg-muted" />
                </div>
              </div>
              <div className="flex gap-4 mt-3">
                <label className="flex items-center gap-2 text-sm cursor-pointer">
                  <Checkbox checked={form.pfApplicable} onCheckedChange={(v) => setForm({ ...form, pfApplicable: !!v })} /> PF
                </label>
                <label className="flex items-center gap-2 text-sm cursor-pointer">
                  <Checkbox checked={form.esicApplicable} onCheckedChange={(v) => setForm({ ...form, esicApplicable: !!v })} /> ESIC
                </label>
                <label className="flex items-center gap-2 text-sm cursor-pointer">
                  <Checkbox checked={form.ptApplicable} onCheckedChange={(v) => setForm({ ...form, ptApplicable: !!v })} /> PT
                </label>
              </div>
            </div>

            {/* Contact */}
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label>Phone</Label>
                <Input value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} />
              </div>
              <div>
                <Label>Email</Label>
                <Input value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} />
              </div>
              <div>
                <Label>Date of Joining</Label>
                <Input type="date" value={form.dateOfJoining} onChange={(e) => setForm({ ...form, dateOfJoining: e.target.value })} />
              </div>
              <div>
                <Label>Link to Tailor</Label>
                <Select value={form.tailorId || 'none'} onValueChange={(v) => setForm({ ...form, tailorId: v === 'none' ? '' : v })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">None</SelectItem>
                    {tailorsData?.tailors?.map((t) => (
                      <SelectItem key={t.id} value={t.id}>{t.name}</SelectItem>
                    ))}
                    {/* Include currently linked tailor when editing */}
                    {isEdit && emp?.tailorId && emp.tailor && !tailorsData?.tailors?.find(t => t.id === emp.tailorId) && (
                      <SelectItem value={emp.tailorId}>{emp.tailor.name} (current)</SelectItem>
                    )}
                  </SelectContent>
                </Select>
              </div>
            </div>

            {/* Statutory IDs (collapsible) */}
            <details className="border rounded-lg p-3">
              <summary className="text-sm font-medium cursor-pointer text-muted-foreground">
                Bank & Statutory Details
              </summary>
              <div className="grid grid-cols-2 gap-3 mt-3">
                <div><Label>Bank Name</Label><Input value={form.bankName} onChange={(e) => setForm({ ...form, bankName: e.target.value })} /></div>
                <div><Label>Account Name</Label><Input value={form.bankAccountName} onChange={(e) => setForm({ ...form, bankAccountName: e.target.value })} /></div>
                <div><Label>Account Number</Label><Input value={form.bankAccountNumber} onChange={(e) => setForm({ ...form, bankAccountNumber: e.target.value })} /></div>
                <div><Label>IFSC</Label><Input value={form.bankIfsc} onChange={(e) => setForm({ ...form, bankIfsc: e.target.value })} /></div>
                <div><Label>PAN</Label><Input value={form.pan} onChange={(e) => setForm({ ...form, pan: e.target.value })} /></div>
                <div><Label>Aadhaar</Label><Input value={form.aadhaar} onChange={(e) => setForm({ ...form, aadhaar: e.target.value })} /></div>
                <div><Label>UAN (PF)</Label><Input value={form.uan} onChange={(e) => setForm({ ...form, uan: e.target.value })} /></div>
                <div><Label>ESIC Number</Label><Input value={form.esicNumber} onChange={(e) => setForm({ ...form, esicNumber: e.target.value })} /></div>
              </div>
            </details>

            {/* Active toggle (only when editing) */}
            {isEdit && (
              <label className="flex items-center gap-2 text-sm cursor-pointer">
                <Checkbox checked={form.isActive} onCheckedChange={(v) => setForm({ ...form, isActive: !!v })} />
                Employee is active
              </label>
            )}

            {error && <p className="text-sm text-destructive">{error}</p>}
          </div>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button onClick={handleSave} disabled={saving}>
            {saving && <Loader2 className="h-4 w-4 animate-spin mr-1" />}
            {isEdit ? 'Save Changes' : 'Create Employee'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ============================================
// PAYROLL RUNS TAB
// ============================================

function PayrollRunsTab() {
  const search = Route.useSearch();
  const navigate = useNavigate();
  const qc = useQueryClient();

  const listFn = useServerFn(listPayrollRuns);
  const { data, isLoading } = useQuery({
    queryKey: ['payroll', 'runs', search.status, search.page],
    queryFn: () =>
      listFn({
        data: {
          ...(search.status ? { status: search.status } : {}),
          page: search.page,
          limit: search.limit,
        },
      }),
  });

  const setSearch = useCallback(
    (updates: Partial<PayrollSearchParams>) => {
      navigate({ to: '/payroll', search: { ...search, ...updates }, replace: true });
    },
    [navigate, search],
  );

  const [showCreateModal, setShowCreateModal] = useState(false);

  return (
    <div>
      {/* Filters */}
      <div className="flex flex-wrap gap-2 mb-4 items-center">
        <Select
          value={search.status ?? 'all'}
          onValueChange={(v) => setSearch({ status: v === 'all' ? undefined : v, page: 1 })}
        >
          <SelectTrigger className="w-40">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Statuses</SelectItem>
            <SelectItem value="draft">Draft</SelectItem>
            <SelectItem value="confirmed">Confirmed</SelectItem>
            <SelectItem value="cancelled">Cancelled</SelectItem>
          </SelectContent>
        </Select>
        <div className="flex-1" />
        <Button onClick={() => setShowCreateModal(true)}>
          <Plus className="h-4 w-4 mr-1" /> New Payroll Run
        </Button>
      </div>

      {/* Table */}
      {isLoading ? (
        <LoadingState />
      ) : (
        <>
          <div className="border rounded-lg overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-muted/50">
                <tr>
                  <th className="text-left p-3 font-medium">Month</th>
                  <th className="text-center p-3 font-medium">Status</th>
                  <th className="text-right p-3 font-medium">Employees</th>
                  <th className="text-right p-3 font-medium">Total Gross</th>
                  <th className="text-right p-3 font-medium">Deductions</th>
                  <th className="text-right p-3 font-medium">Net Pay</th>
                  <th className="text-right p-3 font-medium">Employer Cost</th>
                  <th className="text-left p-3 font-medium">Created By</th>
                </tr>
              </thead>
              <tbody>
                {data?.runs?.map((run) => (
                  <tr
                    key={run.id}
                    className="border-t hover:bg-muted/30 cursor-pointer"
                    onClick={() =>
                      setSearch({ modal: 'view-run', modalId: run.id })
                    }
                  >
                    <td className="p-3 font-medium">{MONTH_NAMES[run.month - 1]} {run.year}</td>
                    <td className="p-3 text-center"><StatusBadge status={run.status} /></td>
                    <td className="p-3 text-right">{run.employeeCount}</td>
                    <td className="p-3 text-right font-mono">{formatINR(run.totalGross)}</td>
                    <td className="p-3 text-right font-mono">{formatINR(run.totalDeductions)}</td>
                    <td className="p-3 text-right font-mono font-semibold">{formatINR(run.totalNetPay)}</td>
                    <td className="p-3 text-right font-mono">{formatINR(run.totalEmployerCost)}</td>
                    <td className="p-3 text-muted-foreground">{run.createdBy?.name}</td>
                  </tr>
                ))}
                {(!data?.runs || data.runs.length === 0) && (
                  <tr>
                    <td colSpan={8} className="p-8 text-center text-muted-foreground">No payroll runs found</td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
          {data && (
            <Pagination
              page={data.page}
              total={data.total}
              limit={data.limit}
              onPageChange={(p) => setSearch({ page: p })}
            />
          )}
        </>
      )}

      {/* Create Run Modal */}
      {showCreateModal && (
        <CreateRunModal
          onClose={() => setShowCreateModal(false)}
          onCreated={(id) => {
            setShowCreateModal(false);
            qc.invalidateQueries({ queryKey: ['payroll'] });
            setSearch({ modal: 'view-run', modalId: id });
          }}
        />
      )}
    </div>
  );
}

// ============================================
// CREATE RUN MODAL
// ============================================

function CreateRunModal({ onClose, onCreated }: { onClose: () => void; onCreated: (id: string) => void }) {
  const now = new Date();
  const [month, setMonth] = useState(now.getMonth() + 1);
  const [year, setYear] = useState(now.getFullYear());
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const createFn = useServerFn(createPayrollRun);

  const handleCreate = async () => {
    setSaving(true);
    setError('');
    try {
      const res = await createFn({ data: { month, year } });
      if (!res.success) {
        setError(res.error);
        setSaving(false);
        return;
      }
      onCreated(res.run.id);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error');
      setSaving(false);
    }
  };

  return (
    <Dialog open onOpenChange={() => onClose()}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>New Payroll Run</DialogTitle>
          <DialogDescription>Generate payroll for all active employees.</DialogDescription>
        </DialogHeader>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <Label>Month</Label>
            <Select value={String(month)} onValueChange={(v) => setMonth(parseInt(v))}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {MONTH_NAMES.map((m, i) => (
                  <SelectItem key={i} value={String(i + 1)}>{m}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label>Year</Label>
            <Select value={String(year)} onValueChange={(v) => setYear(parseInt(v))}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {[2025, 2026, 2027].map((y) => (
                  <SelectItem key={y} value={String(y)}>{y}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>
        {error && <p className="text-sm text-destructive">{error}</p>}
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button onClick={handleCreate} disabled={saving}>
            {saving && <Loader2 className="h-4 w-4 animate-spin mr-1" />}
            Generate Payroll
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ============================================
// PAYROLL RUN DETAIL VIEW
// ============================================

function PayrollRunDetail({ runId }: { runId: string }) {
  const search = Route.useSearch();
  const navigate = useNavigate();
  const qc = useQueryClient();

  const getFn = useServerFn(getPayrollRun);
  const updateSlipFn = useServerFn(updatePayrollSlip);
  const confirmFn = useServerFn(confirmPayrollRun);
  const cancelFn = useServerFn(cancelPayrollRun);

  const { data, isLoading, refetch } = useQuery({
    queryKey: ['payroll', 'run', runId],
    queryFn: () => getFn({ data: { id: runId } }),
  });

  const run = data?.success ? data.run : null;

  // Editing slip state
  const [editingSlip, setEditingSlip] = useState<string | null>(null);
  const [editDays, setEditDays] = useState('');
  const [editAdvances, setEditAdvances] = useState('');
  const [editOtherDed, setEditOtherDed] = useState('');
  const [savingSlip, setSavingSlip] = useState(false);

  const startEditSlip = (slip: { id: string; payableDays: number; advances: number; otherDeductions: number }) => {
    setEditingSlip(slip.id);
    setEditDays(String(slip.payableDays));
    setEditAdvances(String(slip.advances));
    setEditOtherDed(String(slip.otherDeductions));
  };

  const saveSlip = async () => {
    if (!editingSlip) return;
    setSavingSlip(true);
    try {
      await updateSlipFn({
        data: {
          id: editingSlip,
          payableDays: parseFloat(editDays),
          advances: parseFloat(editAdvances) || 0,
          otherDeductions: parseFloat(editOtherDed) || 0,
        },
      });
      setEditingSlip(null);
      refetch();
    } finally {
      setSavingSlip(false);
    }
  };

  // Confirm / Cancel
  const [confirming, setConfirming] = useState(false);
  const [cancelling, setCancelling] = useState(false);

  const handleConfirm = async () => {
    if (!run) return;
    setConfirming(true);
    try {
      await confirmFn({ data: { id: run.id } });
      refetch();
      qc.invalidateQueries({ queryKey: ['payroll', 'runs'] });
      qc.invalidateQueries({ queryKey: ['finance'] });
    } finally {
      setConfirming(false);
    }
  };

  const handleCancel = async () => {
    if (!run) return;
    setCancelling(true);
    try {
      await cancelFn({ data: { id: run.id } });
      refetch();
      qc.invalidateQueries({ queryKey: ['payroll', 'runs'] });
      qc.invalidateQueries({ queryKey: ['finance'] });
    } finally {
      setCancelling(false);
    }
  };

  const goBack = () => {
    navigate({
      to: '/payroll',
      search: { ...search, modal: undefined, modalId: undefined },
      replace: true,
    });
  };

  if (isLoading) return <LoadingState />;
  if (!run) return <p className="text-destructive p-4">Payroll run not found</p>;

  const isDraft = run.status === 'draft';

  return (
    <div>
      {/* Header */}
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-3">
          <Button variant="ghost" size="sm" onClick={goBack}>
            <ArrowLeft className="h-4 w-4 mr-1" /> Back
          </Button>
          <h2 className="text-xl font-bold">
            {MONTH_NAMES[run.month - 1]} {run.year} Payroll
          </h2>
          <StatusBadge status={run.status} />
        </div>
        <div className="flex gap-2">
          {isDraft && (
            <Button onClick={handleConfirm} disabled={confirming}>
              {confirming ? <Loader2 className="h-4 w-4 animate-spin mr-1" /> : <Check className="h-4 w-4 mr-1" />}
              Confirm & Create Invoices
            </Button>
          )}
          {run.status !== 'cancelled' && (
            <Button variant="destructive" onClick={handleCancel} disabled={cancelling}>
              {cancelling ? <Loader2 className="h-4 w-4 animate-spin mr-1" /> : <X className="h-4 w-4 mr-1" />}
              Cancel Run
            </Button>
          )}
        </div>
      </div>

      {/* Summary cards */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-3 mb-4">
        <SummaryCard label="Employees" value={String(run.employeeCount)} />
        <SummaryCard label="Total Gross" value={formatINR(run.totalGross)} />
        <SummaryCard label="Total Deductions" value={formatINR(run.totalDeductions)} />
        <SummaryCard label="Total Net Pay" value={formatINR(run.totalNetPay)} highlight />
        <SummaryCard label="Employer Cost" value={formatINR(run.totalEmployerCost)} />
      </div>

      {/* Slips Table */}
      <div className="border rounded-lg overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-muted/50">
            <tr>
              <th className="text-left p-2.5 font-medium">Employee</th>
              <th className="text-left p-2.5 font-medium">Dept</th>
              <th className="text-right p-2.5 font-medium">Days</th>
              <th className="text-right p-2.5 font-medium">Basic</th>
              <th className="text-right p-2.5 font-medium">Gross</th>
              <th className="text-right p-2.5 font-medium">PF</th>
              <th className="text-right p-2.5 font-medium">ESIC</th>
              <th className="text-right p-2.5 font-medium">PT</th>
              <th className="text-right p-2.5 font-medium">Advances</th>
              <th className="text-right p-2.5 font-medium">Deductions</th>
              <th className="text-right p-2.5 font-medium font-semibold">Net Pay</th>
              {isDraft && <th className="p-2.5"></th>}
            </tr>
          </thead>
          <tbody>
            {run.slips.map((slip) => {
              const isEditing = editingSlip === slip.id;
              return (
                <tr key={slip.id} className="border-t hover:bg-muted/30">
                  <td className="p-2.5 font-medium">{slip.employee.name}</td>
                  <td className="p-2.5">
                    <Badge variant="outline" className="text-xs">{getDepartmentLabel(slip.employee.department)}</Badge>
                  </td>
                  <td className="p-2.5 text-right">
                    {isEditing ? (
                      <Input
                        type="number"
                        value={editDays}
                        onChange={(e) => setEditDays(e.target.value)}
                        className="w-16 h-7 text-right text-sm"
                      />
                    ) : (
                      <span className={slip.isManualDays ? 'text-amber-600 font-medium' : ''}>
                        {slip.payableDays}/{slip.daysInMonth}
                      </span>
                    )}
                  </td>
                  <td className="p-2.5 text-right font-mono">{formatINR(slip.basicEarned)}</td>
                  <td className="p-2.5 text-right font-mono">{formatINR(slip.grossEarned)}</td>
                  <td className="p-2.5 text-right font-mono">{slip.pfEmployee > 0 ? formatINR(slip.pfEmployee) : '—'}</td>
                  <td className="p-2.5 text-right font-mono">{slip.esicEmployee > 0 ? formatINR(slip.esicEmployee) : '—'}</td>
                  <td className="p-2.5 text-right font-mono">{slip.professionalTax > 0 ? formatINR(slip.professionalTax) : '—'}</td>
                  <td className="p-2.5 text-right font-mono">
                    {isEditing ? (
                      <Input
                        type="number"
                        value={editAdvances}
                        onChange={(e) => setEditAdvances(e.target.value)}
                        className="w-20 h-7 text-right text-sm"
                      />
                    ) : (
                      slip.advances > 0 ? formatINR(slip.advances) : '—'
                    )}
                  </td>
                  <td className="p-2.5 text-right font-mono">{formatINR(slip.totalDeductions)}</td>
                  <td className="p-2.5 text-right font-mono font-semibold">{formatINR(slip.netPay)}</td>
                  {isDraft && (
                    <td className="p-2.5">
                      {isEditing ? (
                        <div className="flex gap-1">
                          <Button size="sm" variant="ghost" onClick={saveSlip} disabled={savingSlip}>
                            {savingSlip ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Check className="h-3.5 w-3.5" />}
                          </Button>
                          <Button size="sm" variant="ghost" onClick={() => setEditingSlip(null)}>
                            <X className="h-3.5 w-3.5" />
                          </Button>
                        </div>
                      ) : (
                        <Button size="sm" variant="ghost" onClick={() => startEditSlip(slip)}>
                          <Pencil className="h-3.5 w-3.5" />
                        </Button>
                      )}
                    </td>
                  )}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* Employer cost breakdown */}
      {run.slips.some(s => s.pfEmployer > 0 || s.esicEmployer > 0) && (
        <details className="mt-4 border rounded-lg p-3">
          <summary className="text-sm font-medium cursor-pointer text-muted-foreground">
            Employer Cost Breakdown
          </summary>
          <div className="border rounded-lg overflow-x-auto mt-2">
            <table className="w-full text-sm">
              <thead className="bg-muted/50">
                <tr>
                  <th className="text-left p-2.5 font-medium">Employee</th>
                  <th className="text-right p-2.5 font-medium">PF (Employer)</th>
                  <th className="text-right p-2.5 font-medium">PF Admin</th>
                  <th className="text-right p-2.5 font-medium">ESIC (Employer)</th>
                  <th className="text-right p-2.5 font-medium">Total Employer</th>
                  <th className="text-right p-2.5 font-medium font-semibold">CTC</th>
                </tr>
              </thead>
              <tbody>
                {run.slips.map((slip) => (
                  <tr key={slip.id} className="border-t">
                    <td className="p-2.5">{slip.employee.name}</td>
                    <td className="p-2.5 text-right font-mono">{slip.pfEmployer > 0 ? formatINR(slip.pfEmployer) : '—'}</td>
                    <td className="p-2.5 text-right font-mono">{slip.pfAdmin > 0 ? formatINR(slip.pfAdmin) : '—'}</td>
                    <td className="p-2.5 text-right font-mono">{slip.esicEmployer > 0 ? formatINR(slip.esicEmployer) : '—'}</td>
                    <td className="p-2.5 text-right font-mono">{formatINR(slip.totalEmployerCost)}</td>
                    <td className="p-2.5 text-right font-mono font-semibold">{formatINR(slip.costToCompany)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </details>
      )}
    </div>
  );
}

// ============================================
// ATTENDANCE TAB
// ============================================

function getSundays(month: number, year: number): Set<number> {
  const sundays = new Set<number>();
  const daysInMonth = new Date(year, month, 0).getDate();
  for (let day = 1; day <= daysInMonth; day++) {
    if (new Date(year, month - 1, day).getDay() === 0) {
      sundays.add(day);
    }
  }
  return sundays;
}

function AttendanceTab() {
  const search = Route.useSearch();
  const navigate = useNavigate();
  const qc = useQueryClient();

  const now = new Date();
  const month = search.attMonth ?? (now.getMonth() + 1);
  const year = search.attYear ?? now.getFullYear();

  const summaryFn = useServerFn(getAttendanceSummary);
  const upsertFn = useServerFn(upsertLeaveRecord);
  const deleteFn = useServerFn(deleteLeaveRecord);

  const queryKey = ['payroll', 'attendance', month, year];
  const { data, isLoading } = useQuery({
    queryKey,
    queryFn: () => summaryFn({ data: { month, year } }),
  });


  const sundays = useMemo(() => getSundays(month, year), [month, year]);
  const daysInMonth = data?.daysInMonth ?? new Date(year, month, 0).getDate();

  // Build a lookup: "employeeId:day" -> leave record
  const leaveMap = useMemo(() => {
    const map = new Map<string, { type: string; reason: string | null }>();
    if (!data?.leaveRecords) return map;
    for (const lr of data.leaveRecords) {
      // date comes as "YYYY-MM-DD" string from server
      const dateStr = typeof lr.date === 'string' ? lr.date : String(lr.date);
      const day = parseInt(dateStr.split('-')[2] ?? dateStr.split('T')[0]?.split('-')[2], 10);
      if (!isNaN(day)) {
        map.set(`${lr.employeeId}:${day}`, { type: lr.type, reason: lr.reason ?? null });
      }
    }
    return map;
  }, [data?.leaveRecords]);

  // Dialog state
  const [dialogOpen, setDialogOpen] = useState(false);
  const [dialogEmployee, setDialogEmployee] = useState<{ id: string; name: string } | null>(null);
  const [dialogDay, setDialogDay] = useState(0);
  const [dialogType, setDialogType] = useState<string>('absent');
  const [dialogReason, setDialogReason] = useState('');
  const [saving, setSaving] = useState(false);

  const openDialog = (emp: { id: string; name: string }, day: number) => {
    const existing = leaveMap.get(`${emp.id}:${day}`);
    setDialogEmployee(emp);
    setDialogDay(day);
    setDialogType(existing?.type ?? 'absent');
    setDialogReason(existing?.reason ?? '');
    setDialogOpen(true);
  };

  const handleSave = async () => {
    if (!dialogEmployee) return;
    setSaving(true);
    const dateStr = `${year}-${String(month).padStart(2, '0')}-${String(dialogDay).padStart(2, '0')}`;
    try {
      await upsertFn({
        data: {
          employeeId: dialogEmployee.id,
          date: dateStr,
          type: dialogType as 'absent' | 'half_day',
          ...(dialogReason ? { reason: dialogReason } : {}),
        },
      });
      qc.invalidateQueries({ queryKey });
      setDialogOpen(false);
    } finally {
      setSaving(false);
    }
  };

  const handleRemove = async () => {
    if (!dialogEmployee) return;
    setSaving(true);
    const dateStr = `${year}-${String(month).padStart(2, '0')}-${String(dialogDay).padStart(2, '0')}`;
    try {
      await deleteFn({ data: { employeeId: dialogEmployee.id, date: dateStr } });
      qc.invalidateQueries({ queryKey });
      setDialogOpen(false);
    } finally {
      setSaving(false);
    }
  };

  const setMonthYear = (m: number, y: number) => {
    navigate({
      to: '/payroll',
      search: { ...search, attMonth: m, attYear: y },
      replace: true,
    });
  };

  // Calculate summary stats
  const totalAbsent = data?.leaveRecords?.filter((l) => l.type === 'absent').length ?? 0;
  const totalHalf = data?.leaveRecords?.filter((l) => l.type === 'half_day').length ?? 0;

  // "P" shown for days up to today (only for current month)
  const today = (month === now.getMonth() + 1 && year === now.getFullYear()) ? now.getDate() : (month < now.getMonth() + 1 || year < now.getFullYear()) ? daysInMonth : 0;

  const dayNumbers = Array.from({ length: daysInMonth }, (_, i) => i + 1);

  return (
    <div>
      {/* Month/Year selector + summary */}
      <div className="flex flex-wrap gap-3 mb-4 items-center">
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => {
              const prev = month === 1 ? 12 : month - 1;
              const prevYear = month === 1 ? year - 1 : year;
              setMonthYear(prev, prevYear);
            }}
          >
            <ChevronLeft className="h-4 w-4" />
          </Button>
          <span className="text-sm font-semibold min-w-[100px] text-center">
            {MONTH_NAMES[month - 1]} {year}
          </span>
          <Button
            variant="outline"
            size="sm"
            onClick={() => {
              const next = month === 12 ? 1 : month + 1;
              const nextYear = month === 12 ? year + 1 : year;
              setMonthYear(next, nextYear);
            }}
          >
            <ChevronRight className="h-4 w-4" />
          </Button>
        </div>
        <div className="flex-1" />
        <div className="flex gap-3 text-sm text-muted-foreground">
          <span>{daysInMonth} days</span>
          <span className="text-red-600 font-medium">{totalAbsent} absent</span>
          <span className="text-amber-600 font-medium">{totalHalf} half-day</span>
        </div>
      </div>

      {isLoading ? (
        <LoadingState />
      ) : (
        <div className="border rounded-lg overflow-x-auto">
          <table className="text-sm border-collapse">
            <thead className="bg-muted/50">
              <tr>
                <th className="text-left p-2 font-medium sticky left-0 bg-muted/50 min-w-[140px] border-r">
                  Employee
                </th>
                {dayNumbers.map((d) => (
                  <th
                    key={d}
                    className={`text-center p-1 font-medium min-w-[32px] text-xs ${
                      sundays.has(d) ? 'bg-muted text-muted-foreground' : ''
                    }`}
                  >
                    {d}
                  </th>
                ))}
                <th className="text-center p-2 font-medium min-w-[70px] border-l">Days</th>
              </tr>
            </thead>
            <tbody>
              {data?.employees?.map((emp) => {
                // Calculate payable days for this employee
                const empLeaves = data.leaveRecords?.filter((l) => l.employeeId === emp.id) ?? [];
                const absences = empLeaves.filter((l) => l.type === 'absent').length;
                const halfs = empLeaves.filter((l) => l.type === 'half_day').length;
                const payable = daysInMonth - absences - halfs * 0.5;

                return (
                  <tr key={emp.id} className="border-t hover:bg-muted/20">
                    <td className="p-2 font-medium sticky left-0 bg-background border-r truncate max-w-[140px]">
                      {emp.name}
                    </td>
                    {dayNumbers.map((d) => {
                      const isSunday = sundays.has(d);
                      const leave = leaveMap.get(`${emp.id}:${d}`);

                      return (
                        <td
                          key={d}
                          className={`text-center p-0 ${
                            isSunday
                              ? 'bg-muted/60 cursor-default'
                              : 'cursor-pointer hover:bg-muted/40'
                          }`}
                          onClick={isSunday ? undefined : () => openDialog(emp, d)}
                        >
                          <div className="w-full h-8 flex items-center justify-center">
                            {isSunday ? (
                              <span className="text-[10px] text-muted-foreground/50">S</span>
                            ) : leave ? (
                              <span
                                className={`text-[10px] font-bold rounded px-1 py-0.5 ${
                                  leave.type === 'absent'
                                    ? 'bg-red-100 text-red-700 dark:bg-red-950 dark:text-red-400'
                                    : 'bg-amber-100 text-amber-700 dark:bg-amber-950 dark:text-amber-400'
                                }`}
                              >
                                {leave.type === 'absent' ? 'A' : 'HD'}
                              </span>
                            ) : d <= today ? (
                              <span className="text-[10px] text-green-600/60 font-medium">P</span>
                            ) : null}
                          </div>
                        </td>
                      );
                    })}
                    <td className="text-center p-2 font-mono text-sm border-l">
                      <span className={payable < daysInMonth ? 'text-amber-600 font-semibold' : ''}>
                        {payable % 1 === 0 ? payable : payable.toFixed(1)}
                      </span>
                      <span className="text-muted-foreground">/{daysInMonth}</span>
                    </td>
                  </tr>
                );
              })}
              {(!data?.employees || data.employees.length === 0) && (
                <tr>
                  <td colSpan={daysInMonth + 2} className="p-8 text-center text-muted-foreground">
                    No active employees
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}

      {/* Leave Dialog */}
      {dialogOpen && dialogEmployee && (
        <Dialog open onOpenChange={() => setDialogOpen(false)}>
          <DialogContent className="max-w-sm">
            <DialogHeader>
              <DialogTitle>
                {dialogEmployee.name} — {dialogDay} {MONTH_NAMES[month - 1]}
              </DialogTitle>
              <DialogDescription>Mark leave or remove existing record.</DialogDescription>
            </DialogHeader>
            <div className="space-y-4">
              <div>
                <Label className="mb-2 block">Leave Type</Label>
                <RadioGroup value={dialogType} onValueChange={setDialogType} className="flex gap-4">
                  {LEAVE_TYPES.map((t) => (
                    <label key={t} className="flex items-center gap-2 cursor-pointer">
                      <RadioGroupItem value={t} />
                      <span className="text-sm">{LEAVE_TYPE_LABELS[t]}</span>
                    </label>
                  ))}
                </RadioGroup>
              </div>
              <div>
                <Label>Reason (optional)</Label>
                <Textarea
                  value={dialogReason}
                  onChange={(e) => setDialogReason(e.target.value)}
                  placeholder="e.g. Sick leave, personal work..."
                  rows={2}
                />
              </div>
            </div>
            <DialogFooter className="flex gap-2">
              {leaveMap.has(`${dialogEmployee.id}:${dialogDay}`) && (
                <Button variant="destructive" onClick={handleRemove} disabled={saving} className="mr-auto">
                  <Trash2 className="h-4 w-4 mr-1" /> Remove
                </Button>
              )}
              <Button variant="outline" onClick={() => setDialogOpen(false)}>Cancel</Button>
              <Button onClick={handleSave} disabled={saving}>
                {saving && <Loader2 className="h-4 w-4 animate-spin mr-1" />}
                Save
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}
    </div>
  );
}

// ============================================
// SHARED COMPONENTS
// ============================================

function SummaryCard({ label, value, highlight }: { label: string; value: string; highlight?: boolean }) {
  return (
    <div className={`border rounded-lg p-3 ${highlight ? 'bg-primary/5 border-primary/20' : ''}`}>
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className={`text-lg font-bold ${highlight ? 'text-primary' : ''}`}>{value}</div>
    </div>
  );
}
