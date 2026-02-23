import { useState, useCallback } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useServerFn } from '@tanstack/react-start';
import { useNavigate } from '@tanstack/react-router';
import { Route } from '../../routes/_authenticated/payroll';
import {
  listEmployees,
  getEmployee,
  createEmployee,
  updateEmployee,
  listTailorsForLinking,
} from '../../server/functions/payroll';
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
import { Plus, Loader2, Check, X, Pencil } from 'lucide-react';
import {
  type PayrollSearchParams,
  DEPARTMENTS,
  getDepartmentLabel,
  GROSS_MULTIPLIER,
} from '@coh/shared';
import { formatINR, LoadingState, Pagination } from './shared';

export default function EmployeesTab() {
  const search = Route.useSearch();
  const navigate = useNavigate();
  const queryClient = useQueryClient();

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
                    <td className="p-3 text-muted-foreground">{emp.designation ?? '\u2014'}</td>
                    <td className="p-3 text-right font-mono">{formatINR(emp.basicSalary)}</td>
                    <td className="p-3 text-right font-mono">{formatINR(emp.basicSalary * GROSS_MULTIPLIER)}</td>
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

      {showModal && (
        <EmployeeModal
          employeeId={editId}
          onClose={() => { setShowModal(false); setEditId(null); }}
          onSaved={() => {
            setShowModal(false);
            setEditId(null);
            queryClient.invalidateQueries({ queryKey: ['payroll'] });
          }}
        />
      )}
    </div>
  );
}

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
    employeeCode: '',
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

  const [formLoaded, setFormLoaded] = useState(false);
  if (isEdit && emp && !formLoaded) {
    setForm({
      name: emp.name,
      employeeCode: emp.employeeCode ?? '',
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
            employeeCode: form.employeeCode || null,
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
            ...(form.employeeCode ? { employeeCode: form.employeeCode } : {}),
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

  const gross = parseFloat(form.basicSalary) * GROSS_MULTIPLIER || 0;

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
            <div className="grid grid-cols-2 gap-3">
              <div className="col-span-2">
                <Label>Name *</Label>
                <Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
              </div>
              <div>
                <Label>Employee Code</Label>
                <Input value={form.employeeCode} onChange={(e) => setForm({ ...form, employeeCode: e.target.value })} placeholder="e.g. E001" />
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
                    {isEdit && emp?.tailorId && emp.tailor && !tailorsData?.tailors?.find(t => t.id === emp.tailorId) && (
                      <SelectItem value={emp.tailorId}>{emp.tailor.name} (current)</SelectItem>
                    )}
                  </SelectContent>
                </Select>
              </div>
            </div>

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
