import { useState, useMemo } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useServerFn } from '@tanstack/react-start';
import { useNavigate } from '@tanstack/react-router';
import { Route } from '../../routes/_authenticated/payroll';
import {
  getAttendanceSummary,
  upsertLeaveRecord,
  deleteLeaveRecord,
  getAttendanceRecords,
} from '../../server/functions/payroll';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
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
import { Textarea } from '@/components/ui/textarea';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import {
  ChevronLeft,
  ChevronRight,
  Loader2,
  Check,
  Trash2,
  Upload,
} from 'lucide-react';
import {
  type PayrollSearchParams,
  LEAVE_TYPES,
  LEAVE_TYPE_LABELS,
  ATTENDANCE_STATUS_LABELS,
  getSundays,
} from '@coh/shared';
import { MONTH_NAMES, LoadingState } from './shared';
import { useAuth } from '../../hooks/useAuth';
import { isAdminUser } from '../../types';

const ATTENDANCE_API_BASE = import.meta.env.PROD ? '/api' : 'http://localhost:3001/api';

interface PreviewResult {
  previewId: string;
  period: string;
  totalEmployeesInFile: number;
  matchedCount: number;
  unmatchedCount: number;
  unmatchedNames: string[];
  matched: {
    employeeCode: string;
    nameInFile: string;
    nameInSystem: string;
    presentDays: number;
    absentDays: number;
    weeklyOffs: number;
    totalDays: number;
  }[];
  summary: { totalPresent: number; totalAbsent: number; totalWO: number };
}

interface ConfirmResult {
  success: boolean;
  importBatchId: string;
  matchedEmployees: number;
  attendanceRecordsCreated: number;
  attendanceRecordsUpdated: number;
  leaveRecordsCreated: number;
  leaveRecordsDeleted: number;
}

export default function AttendanceTab() {
  const { user } = useAuth();
  const isAdmin = isAdminUser(user);
  const search = Route.useSearch();
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const now = new Date();
  const month = search.attMonth ?? (now.getMonth() + 1);
  const year = search.attYear ?? now.getFullYear();

  const summaryFn = useServerFn(getAttendanceSummary);
  const upsertFn = useServerFn(upsertLeaveRecord);
  const deleteFn = useServerFn(deleteLeaveRecord);
  const attRecordsFn = useServerFn(getAttendanceRecords);

  const queryKey = ['payroll', 'attendance', month, year];
  const { data, isLoading } = useQuery({
    queryKey,
    queryFn: () => summaryFn({ data: { month, year } }),
  });

  const { data: fingerprintData } = useQuery({
    queryKey: ['payroll', 'attendance-records', month, year],
    queryFn: () => attRecordsFn({ data: { month, year } }),
  });

  const sundays = useMemo(() => getSundays(month, year), [month, year]);
  const daysInMonth = data?.daysInMonth ?? new Date(year, month, 0).getDate();

  const leaveMap = useMemo(() => {
    const map = new Map<string, { type: string; reason: string | null }>();
    if (!data?.leaveRecords) return map;
    for (const lr of data.leaveRecords) {
      const dateStr = typeof lr.date === 'string' ? lr.date : String(lr.date);
      const day = parseInt(dateStr.split('-')[2] ?? dateStr.split('T')[0]?.split('-')[2], 10);
      if (!isNaN(day)) {
        map.set(`${lr.employeeId}:${day}`, { type: lr.type, reason: lr.reason ?? null });
      }
    }
    return map;
  }, [data?.leaveRecords]);

  const fingerprintMap = useMemo(() => {
    const map = new Map<string, {
      status: string; inTime: string | null; outTime: string | null;
      durationMins: number; lateByMins: number; earlyByMins: number; overtimeMins: number;
    }>();
    if (!fingerprintData?.records) return map;
    for (const r of fingerprintData.records) {
      const dateStr = typeof r.date === 'string' ? r.date : String(r.date);
      const day = parseInt(dateStr.split('-')[2], 10);
      if (!isNaN(day)) {
        map.set(`${r.employeeId}:${day}`, {
          status: r.status,
          inTime: r.inTime,
          outTime: r.outTime,
          durationMins: r.durationMins,
          lateByMins: r.lateByMins,
          earlyByMins: r.earlyByMins,
          overtimeMins: r.overtimeMins,
        });
      }
    }
    return map;
  }, [fingerprintData?.records]);

  const hasFingerprint = fingerprintMap.size > 0;

  const [dialogOpen, setDialogOpen] = useState(false);
  const [dialogEmployee, setDialogEmployee] = useState<{ id: string; name: string } | null>(null);
  const [dialogDay, setDialogDay] = useState(0);
  const [dialogType, setDialogType] = useState<string>('absent');
  const [dialogReason, setDialogReason] = useState('');
  const [saving, setSaving] = useState(false);

  const [importOpen, setImportOpen] = useState(false);

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
      queryClient.invalidateQueries({ queryKey });
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
      queryClient.invalidateQueries({ queryKey });
      setDialogOpen(false);
    } finally {
      setSaving(false);
    }
  };

  const setMonthYear = (m: number, y: number) => {
    navigate({
      to: '/payroll',
      search: { ...search, attMonth: m, attYear: y } as PayrollSearchParams,
      replace: true,
    });
  };

  const totalAbsent = data?.leaveRecords?.filter((l) => l.type === 'absent').length ?? 0;
  const totalHalf = data?.leaveRecords?.filter((l) => l.type === 'half_day').length ?? 0;

  const lastPresentDay = (month === now.getMonth() + 1 && year === now.getFullYear()) ? now.getDate() : (month < now.getMonth() + 1 || year < now.getFullYear()) ? daysInMonth : 0;

  const dayNumbers = Array.from({ length: daysInMonth }, (_, i) => i + 1);

  return (
    <div>
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
        <div className="flex gap-3 text-sm text-muted-foreground items-center">
          <span>{daysInMonth} days</span>
          <span className="text-red-600 font-medium">{totalAbsent} absent</span>
          <span className="text-amber-600 font-medium">{totalHalf} half-day</span>
          {hasFingerprint && (
            <Badge variant="outline" className="text-xs">Fingerprint data loaded</Badge>
          )}
          {isAdmin && <Button variant="outline" size="sm" onClick={() => setImportOpen(true)}>
            <Upload className="h-4 w-4 mr-1" /> Import XLSX
          </Button>}
        </div>
      </div>

      {isLoading ? (
        <LoadingState />
      ) : (
        <TooltipProvider delayDuration={200}>
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
                        const fingerprintRecord = fingerprintMap.get(`${emp.id}:${d}`);

                        const cellContent = (
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
                            ) : fingerprintRecord ? (
                              <span className={`text-[10px] font-bold rounded px-1 py-0.5 ${
                                fingerprintRecord.status === 'P' ? 'bg-green-100 text-green-700 dark:bg-green-950 dark:text-green-400' :
                                fingerprintRecord.status === 'WO' ? 'bg-gray-100 text-gray-500 dark:bg-gray-900 dark:text-gray-500' :
                                'text-green-600/60'
                              }`}>
                                {fingerprintRecord.status === 'WO' ? 'WO' : 'P'}
                              </span>
                            ) : d <= lastPresentDay ? (
                              <span className="text-[10px] text-green-600/60 font-medium">P</span>
                            ) : null}
                          </div>
                        );

                        if (fingerprintRecord && !isSunday) {
                          return (
                            <td
                              key={d}
                              className={`text-center p-0 ${isAdmin ? 'cursor-pointer hover:bg-muted/40' : ''}`}
                              onClick={isAdmin ? () => openDialog(emp, d) : undefined}
                            >
                              <Tooltip>
                                <TooltipTrigger asChild>{cellContent}</TooltipTrigger>
                                <TooltipContent side="top" className="text-xs">
                                  <div className="space-y-0.5">
                                    <div className="font-semibold">{ATTENDANCE_STATUS_LABELS[fingerprintRecord.status] ?? fingerprintRecord.status}</div>
                                    {fingerprintRecord.inTime && <div>In: {fingerprintRecord.inTime}</div>}
                                    {fingerprintRecord.outTime && <div>Out: {fingerprintRecord.outTime}</div>}
                                    {fingerprintRecord.durationMins > 0 && <div>Duration: {Math.floor(fingerprintRecord.durationMins / 60)}h {fingerprintRecord.durationMins % 60}m</div>}
                                    {fingerprintRecord.lateByMins > 0 && <div className="text-amber-400">Late: {fingerprintRecord.lateByMins}m</div>}
                                    {fingerprintRecord.earlyByMins > 0 && <div className="text-amber-400">Early: {fingerprintRecord.earlyByMins}m</div>}
                                    {fingerprintRecord.overtimeMins > 0 && <div className="text-blue-400">OT: {fingerprintRecord.overtimeMins}m</div>}
                                  </div>
                                </TooltipContent>
                              </Tooltip>
                            </td>
                          );
                        }

                        return (
                          <td
                            key={d}
                            className={`text-center p-0 ${
                              isSunday
                                ? 'bg-muted/60 cursor-default'
                                : isAdmin ? 'cursor-pointer hover:bg-muted/40' : ''
                            }`}
                            onClick={isSunday || !isAdmin ? undefined : () => openDialog(emp, d)}
                          >
                            {cellContent}
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
        </TooltipProvider>
      )}

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
              {fingerprintMap.has(`${dialogEmployee.id}:${dialogDay}`) && (() => {
                const fingerprintRecord = fingerprintMap.get(`${dialogEmployee.id}:${dialogDay}`)!;
                return (
                  <div className="border rounded-lg p-3 bg-muted/30 text-sm space-y-1">
                    <div className="font-medium text-xs text-muted-foreground uppercase tracking-wide mb-1">Fingerprint Data</div>
                    <div className="grid grid-cols-2 gap-x-4 gap-y-0.5">
                      <span className="text-muted-foreground">Status:</span>
                      <span className="font-medium">{ATTENDANCE_STATUS_LABELS[fingerprintRecord.status] ?? fingerprintRecord.status}</span>
                      {fingerprintRecord.inTime && <><span className="text-muted-foreground">In:</span><span>{fingerprintRecord.inTime}</span></>}
                      {fingerprintRecord.outTime && <><span className="text-muted-foreground">Out:</span><span>{fingerprintRecord.outTime}</span></>}
                      {fingerprintRecord.durationMins > 0 && <><span className="text-muted-foreground">Duration:</span><span>{Math.floor(fingerprintRecord.durationMins / 60)}h {fingerprintRecord.durationMins % 60}m</span></>}
                      {fingerprintRecord.lateByMins > 0 && <><span className="text-muted-foreground">Late by:</span><span className="text-amber-600">{fingerprintRecord.lateByMins}m</span></>}
                      {fingerprintRecord.overtimeMins > 0 && <><span className="text-muted-foreground">Overtime:</span><span className="text-blue-600">{fingerprintRecord.overtimeMins}m</span></>}
                    </div>
                  </div>
                );
              })()}
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

      {importOpen && (
        <AttendanceImportDialog
          month={month}
          year={year}
          onClose={() => setImportOpen(false)}
          onImported={() => {
            setImportOpen(false);
            queryClient.invalidateQueries({ queryKey: ['payroll'] });
          }}
        />
      )}
    </div>
  );
}

function AttendanceImportDialog({
  month,
  year,
  onClose,
  onImported,
}: {
  month: number;
  year: number;
  onClose: () => void;
  onImported: () => void;
}) {
  const [step, setStep] = useState<'upload' | 'preview' | 'done'>('upload');
  const [uploading, setUploading] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState('');
  const [preview, setPreview] = useState<PreviewResult | null>(null);
  const [result, setResult] = useState<ConfirmResult | null>(null);

  const handleUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setUploading(true);
    setError('');

    try {
      const formData = new FormData();
      formData.append('file', file);
      formData.append('month', String(month));
      formData.append('year', String(year));

      const res = await fetch(`${ATTENDANCE_API_BASE}/attendance-import/preview`, {
        method: 'POST',
        credentials: 'include',
        body: formData,
      });

      const data = await res.json();

      if (!res.ok) {
        setError(data.error || 'Upload failed');
        return;
      }

      setPreview(data);
      setStep('preview');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Upload failed');
    } finally {
      setUploading(false);
    }
  };

  const handleConfirm = async () => {
    if (!preview) return;
    setConfirming(true);
    setError('');

    try {
      const res = await fetch(`${ATTENDANCE_API_BASE}/attendance-import/confirm`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ previewId: preview.previewId }),
      });

      const data = await res.json();

      if (!res.ok) {
        setError(data.error || 'Import failed');
        return;
      }

      setResult(data);
      setStep('done');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Import failed');
    } finally {
      setConfirming(false);
    }
  };

  return (
    <Dialog open onOpenChange={() => onClose()}>
      <DialogContent className="max-w-lg max-h-[80vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>
            Import Fingerprint Attendance — {MONTH_NAMES[month - 1]} {year}
          </DialogTitle>
          <DialogDescription>
            {step === 'upload' && 'Upload the fingerprint machine XLSX report.'}
            {step === 'preview' && 'Review matched employees before importing.'}
            {step === 'done' && 'Import complete.'}
          </DialogDescription>
        </DialogHeader>

        {step === 'upload' && (
          <div className="space-y-4">
            <div className="border-2 border-dashed rounded-lg p-6 text-center">
              <Upload className="h-8 w-8 mx-auto text-muted-foreground mb-2" />
              <p className="text-sm text-muted-foreground mb-3">
                Upload .xlsx file from the fingerprint machine
              </p>
              <label className="cursor-pointer">
                <Input
                  type="file"
                  accept=".xls,.xlsx"
                  onChange={handleUpload}
                  disabled={uploading}
                  className="max-w-[250px] mx-auto"
                />
              </label>
              {uploading && (
                <div className="flex items-center justify-center mt-3 text-sm text-muted-foreground">
                  <Loader2 className="h-4 w-4 animate-spin mr-2" /> Parsing file...
                </div>
              )}
            </div>
            {error && <p className="text-sm text-destructive">{error}</p>}
          </div>
        )}

        {step === 'preview' && preview && (
          <div className="space-y-4">
            <div className="grid grid-cols-3 gap-2">
              <div className="border rounded p-2 text-center">
                <div className="text-lg font-bold">{preview.totalEmployeesInFile}</div>
                <div className="text-xs text-muted-foreground">In file</div>
              </div>
              <div className="border rounded p-2 text-center">
                <div className="text-lg font-bold text-green-600">{preview.matchedCount}</div>
                <div className="text-xs text-muted-foreground">Matched</div>
              </div>
              <div className="border rounded p-2 text-center">
                <div className={`text-lg font-bold ${preview.unmatchedCount > 0 ? 'text-amber-600' : ''}`}>
                  {preview.unmatchedCount}
                </div>
                <div className="text-xs text-muted-foreground">Unmatched</div>
              </div>
            </div>

            {preview.unmatchedCount > 0 && (
              <div className="bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800 rounded p-3 text-sm">
                <div className="font-medium text-amber-800 dark:text-amber-300 mb-1">
                  {preview.unmatchedCount} employee(s) could not be matched:
                </div>
                <ul className="list-disc ml-4 text-amber-700 dark:text-amber-400 text-xs">
                  {preview.unmatchedNames.map((n, i) => <li key={i}>{n}</li>)}
                </ul>
                <p className="text-xs text-amber-600 dark:text-amber-500 mt-1">
                  Add Employee Codes in the Employees tab to match them.
                </p>
              </div>
            )}

            {preview.matched.length > 0 && (
              <div className="border rounded-lg overflow-x-auto max-h-[250px]">
                <table className="w-full text-sm">
                  <thead className="bg-muted/50 sticky top-0">
                    <tr>
                      <th className="text-left p-2 font-medium">Code</th>
                      <th className="text-left p-2 font-medium">Name</th>
                      <th className="text-center p-2 font-medium">P</th>
                      <th className="text-center p-2 font-medium">A</th>
                      <th className="text-center p-2 font-medium">WO</th>
                    </tr>
                  </thead>
                  <tbody>
                    {preview.matched.map((emp, i) => (
                      <tr key={i} className="border-t">
                        <td className="p-2 font-mono text-xs">{emp.employeeCode}</td>
                        <td className="p-2">{emp.nameInSystem}</td>
                        <td className="p-2 text-center text-green-600 font-medium">{emp.presentDays}</td>
                        <td className="p-2 text-center text-red-600 font-medium">{emp.absentDays}</td>
                        <td className="p-2 text-center text-muted-foreground">{emp.weeklyOffs}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}

            <div className="flex gap-4 text-sm text-muted-foreground">
              <span>Total: <strong className="text-green-600">{preview.summary.totalPresent} P</strong></span>
              <span><strong className="text-red-600">{preview.summary.totalAbsent} A</strong></span>
              <span><strong>{preview.summary.totalWO} WO</strong></span>
            </div>

            {error && <p className="text-sm text-destructive">{error}</p>}
          </div>
        )}

        {step === 'done' && result && (
          <div className="space-y-4">
            <div className="text-center">
              <div className="h-12 w-12 rounded-full bg-green-100 dark:bg-green-950 flex items-center justify-center mx-auto mb-3">
                <Check className="h-6 w-6 text-green-600" />
              </div>
              <p className="font-medium">Import successful!</p>
            </div>
            <div className="grid grid-cols-2 gap-2 text-sm">
              <div className="border rounded p-2">
                <span className="text-muted-foreground">Employees:</span>{' '}
                <strong>{result.matchedEmployees}</strong>
              </div>
              <div className="border rounded p-2">
                <span className="text-muted-foreground">Records created:</span>{' '}
                <strong>{result.attendanceRecordsCreated}</strong>
              </div>
              <div className="border rounded p-2">
                <span className="text-muted-foreground">Records updated:</span>{' '}
                <strong>{result.attendanceRecordsUpdated}</strong>
              </div>
              <div className="border rounded p-2">
                <span className="text-muted-foreground">Leave records:</span>{' '}
                <strong>+{result.leaveRecordsCreated} / -{result.leaveRecordsDeleted}</strong>
              </div>
            </div>
          </div>
        )}

        <DialogFooter>
          {step === 'upload' && (
            <Button variant="outline" onClick={onClose}>Cancel</Button>
          )}
          {step === 'preview' && (
            <>
              <Button variant="outline" onClick={() => { setStep('upload'); setPreview(null); setError(''); }}>
                Back
              </Button>
              <Button onClick={handleConfirm} disabled={confirming || preview!.matchedCount === 0}>
                {confirming && <Loader2 className="h-4 w-4 animate-spin mr-1" />}
                Confirm Import ({preview!.matchedCount} employees)
              </Button>
            </>
          )}
          {step === 'done' && (
            <Button onClick={onImported}>Done</Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
