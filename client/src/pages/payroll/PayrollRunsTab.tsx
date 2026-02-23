import { useState, useCallback } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useServerFn } from '@tanstack/react-start';
import { useNavigate } from '@tanstack/react-router';
import { Route } from '../../routes/_authenticated/payroll';
import {
  listPayrollRuns,
  getPayrollRun,
  createPayrollRun,
  updatePayrollSlip,
  confirmPayrollRun,
  cancelPayrollRun,
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
import { Plus, Loader2, Check, X, ArrowLeft, Pencil } from 'lucide-react';
import { type PayrollSearchParams, getDepartmentLabel } from '@coh/shared';
import { formatINR, MONTH_NAMES, StatusBadge, LoadingState, Pagination, SummaryCard } from './shared';

export default function PayrollRunsTab() {
  const search = Route.useSearch();
  const navigate = useNavigate();
  const queryClient = useQueryClient();

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

      {showCreateModal && (
        <CreateRunModal
          onClose={() => setShowCreateModal(false)}
          onCreated={(id) => {
            setShowCreateModal(false);
            queryClient.invalidateQueries({ queryKey: ['payroll'] });
            setSearch({ modal: 'view-run', modalId: id });
          }}
        />
      )}
    </div>
  );
}

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

export function PayrollRunDetail({ runId }: { runId: string }) {
  const search = Route.useSearch();
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const getFn = useServerFn(getPayrollRun);
  const updateSlipFn = useServerFn(updatePayrollSlip);
  const confirmFn = useServerFn(confirmPayrollRun);
  const cancelFn = useServerFn(cancelPayrollRun);

  const { data, isLoading, refetch } = useQuery({
    queryKey: ['payroll', 'run', runId],
    queryFn: () => getFn({ data: { id: runId } }),
  });

  const run = data?.success ? data.run : null;

  const [editingSlip, setEditingSlip] = useState<string | null>(null);
  const [editDays, setEditDays] = useState('');
  const [editAdvances, setEditAdvances] = useState('');
  const [editOtherDeductions, setEditOtherDeductions] = useState('');
  const [savingSlip, setSavingSlip] = useState(false);

  const startEditSlip = (slip: { id: string; payableDays: number; advances: number; otherDeductions: number }) => {
    setEditingSlip(slip.id);
    setEditDays(String(slip.payableDays));
    setEditAdvances(String(slip.advances));
    setEditOtherDeductions(String(slip.otherDeductions));
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
          otherDeductions: parseFloat(editOtherDeductions) || 0,
        },
      });
      setEditingSlip(null);
      refetch();
    } finally {
      setSavingSlip(false);
    }
  };

  const [confirming, setConfirming] = useState(false);
  const [cancelling, setCancelling] = useState(false);

  const handleConfirm = async () => {
    if (!run) return;
    setConfirming(true);
    try {
      await confirmFn({ data: { id: run.id } });
      refetch();
      queryClient.invalidateQueries({ queryKey: ['payroll', 'runs'] });
      queryClient.invalidateQueries({ queryKey: ['finance'] });
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
      queryClient.invalidateQueries({ queryKey: ['payroll', 'runs'] });
      queryClient.invalidateQueries({ queryKey: ['finance'] });
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

      <div className="grid grid-cols-2 md:grid-cols-5 gap-3 mb-4">
        <SummaryCard label="Employees" value={String(run.employeeCount)} />
        <SummaryCard label="Total Gross" value={formatINR(run.totalGross)} />
        <SummaryCard label="Total Deductions" value={formatINR(run.totalDeductions)} />
        <SummaryCard label="Total Net Pay" value={formatINR(run.totalNetPay)} highlight />
        <SummaryCard label="Employer Cost" value={formatINR(run.totalEmployerCost)} />
      </div>

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
                  <td className="p-2.5 text-right font-mono">{slip.pfEmployee > 0 ? formatINR(slip.pfEmployee) : '\u2014'}</td>
                  <td className="p-2.5 text-right font-mono">{slip.esicEmployee > 0 ? formatINR(slip.esicEmployee) : '\u2014'}</td>
                  <td className="p-2.5 text-right font-mono">{slip.professionalTax > 0 ? formatINR(slip.professionalTax) : '\u2014'}</td>
                  <td className="p-2.5 text-right font-mono">
                    {isEditing ? (
                      <Input
                        type="number"
                        value={editAdvances}
                        onChange={(e) => setEditAdvances(e.target.value)}
                        className="w-20 h-7 text-right text-sm"
                      />
                    ) : (
                      slip.advances > 0 ? formatINR(slip.advances) : '\u2014'
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
                    <td className="p-2.5 text-right font-mono">{slip.pfEmployer > 0 ? formatINR(slip.pfEmployer) : '\u2014'}</td>
                    <td className="p-2.5 text-right font-mono">{slip.pfAdmin > 0 ? formatINR(slip.pfAdmin) : '\u2014'}</td>
                    <td className="p-2.5 text-right font-mono">{slip.esicEmployer > 0 ? formatINR(slip.esicEmployer) : '\u2014'}</td>
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
