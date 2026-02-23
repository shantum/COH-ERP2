import { useMemo, useCallback } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useServerFn } from '@tanstack/react-start';
import { useNavigate } from '@tanstack/react-router';
import { Route } from '../../routes/_authenticated/payroll';
import { listEmployees, getAttendanceSummary } from '../../server/functions/payroll';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Checkbox } from '@/components/ui/checkbox';
import { Badge } from '@/components/ui/badge';
import {
  type PayrollSearchParams,
  DEPARTMENTS,
  getDepartmentLabel,
} from '@coh/shared';
import { LoadingState, MONTH_NAMES, Pagination } from './shared';

function formatDays(value: number): string {
  return Number.isInteger(value) ? String(value) : value.toFixed(1);
}

export default function AttendanceOverviewTab() {
  const search = Route.useSearch();
  const navigate = useNavigate();

  const now = new Date();
  const month = now.getMonth() + 1;
  const year = now.getFullYear();

  const listFn = useServerFn(listEmployees);
  const attendanceFn = useServerFn(getAttendanceSummary);

  const { data: employeesData, isLoading: loadingEmployees } = useQuery({
    queryKey: ['payroll', 'employees-overview', search.department, search.search, search.showInactive, search.page],
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

  const { data: attendanceData, isLoading: loadingAttendance } = useQuery({
    queryKey: ['payroll', 'attendance-overview', month, year],
    queryFn: () => attendanceFn({ data: { month, year } }),
  });

  const setSearch = useCallback(
    (updates: Partial<PayrollSearchParams>) => {
      navigate({ to: '/payroll', search: { ...search, ...updates }, replace: true });
    },
    [navigate, search],
  );

  const daysInMonth = attendanceData?.daysInMonth ?? new Date(year, month, 0).getDate();

  const leaveSummaryByEmployee = useMemo(() => {
    const map = new Map<string, { absent: number; halfDay: number }>();

    for (const leave of attendanceData?.leaveRecords ?? []) {
      const current = map.get(leave.employeeId) ?? { absent: 0, halfDay: 0 };
      if (leave.type === 'absent') current.absent += 1;
      if (leave.type === 'half_day') current.halfDay += 1;
      map.set(leave.employeeId, current);
    }

    return map;
  }, [attendanceData?.leaveRecords]);

  const rows = useMemo(() => {
    return (employeesData?.employees ?? []).map((emp) => {
      if (!emp.isActive) {
        return {
          employee: emp,
          absent: null,
          halfDay: null,
          payableDays: null,
          attendancePct: null,
        };
      }

      const leaveSummary = leaveSummaryByEmployee.get(emp.id) ?? { absent: 0, halfDay: 0 };
      const payableDays = Math.max(0, daysInMonth - leaveSummary.absent - leaveSummary.halfDay * 0.5);
      const attendancePct = daysInMonth > 0 ? (payableDays / daysInMonth) * 100 : 0;

      return {
        employee: emp,
        absent: leaveSummary.absent,
        halfDay: leaveSummary.halfDay,
        payableDays,
        attendancePct,
      };
    });
  }, [daysInMonth, employeesData?.employees, leaveSummaryByEmployee]);

  const totals = useMemo(() => {
    const activeRows = rows.filter((row) => row.employee.isActive);
    const totalAbsent = activeRows.reduce((sum, row) => sum + (row.absent ?? 0), 0);
    const totalHalfDay = activeRows.reduce((sum, row) => sum + (row.halfDay ?? 0), 0);
    const avgAttendance = activeRows.length > 0
      ? activeRows.reduce((sum, row) => sum + (row.attendancePct ?? 0), 0) / activeRows.length
      : 0;

    return {
      trackedEmployees: activeRows.length,
      totalAbsent,
      totalHalfDay,
      avgAttendance,
    };
  }, [rows]);

  if (loadingEmployees || loadingAttendance) {
    return <LoadingState />;
  }

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
        <Badge variant="outline">Current month: {MONTH_NAMES[month - 1]} {year}</Badge>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-4">
        <div className="border rounded-lg p-3">
          <div className="text-xs text-muted-foreground">Tracked Employees</div>
          <div className="text-lg font-bold">{totals.trackedEmployees}</div>
        </div>
        <div className="border rounded-lg p-3">
          <div className="text-xs text-muted-foreground">Total Absent Days</div>
          <div className="text-lg font-bold text-red-600">{totals.totalAbsent}</div>
        </div>
        <div className="border rounded-lg p-3">
          <div className="text-xs text-muted-foreground">Total Half Days</div>
          <div className="text-lg font-bold text-amber-600">{totals.totalHalfDay}</div>
        </div>
        <div className="border rounded-lg p-3">
          <div className="text-xs text-muted-foreground">Average Attendance</div>
          <div className="text-lg font-bold">{totals.avgAttendance.toFixed(1)}%</div>
        </div>
      </div>

      <div className="border rounded-lg overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-muted/50">
            <tr>
              <th className="text-left p-3 font-medium">Name</th>
              <th className="text-left p-3 font-medium">Machine ID</th>
              <th className="text-left p-3 font-medium">Dept</th>
              <th className="text-left p-3 font-medium">Designation</th>
              <th className="text-right p-3 font-medium">Absent</th>
              <th className="text-right p-3 font-medium">Half-Day</th>
              <th className="text-right p-3 font-medium">Payable Days</th>
              <th className="text-right p-3 font-medium">Attendance %</th>
              <th className="text-center p-3 font-medium">Status</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.employee.id} className="border-t hover:bg-muted/30">
                <td className="p-3 font-medium">{row.employee.name}</td>
                <td className="p-3 text-muted-foreground font-mono">{row.employee.employeeCode ?? '-'}</td>
                <td className="p-3 text-muted-foreground">{getDepartmentLabel(row.employee.department)}</td>
                <td className="p-3 text-muted-foreground">{row.employee.designation ?? '-'}</td>
                <td className="p-3 text-right font-mono">{row.absent ?? '-'}</td>
                <td className="p-3 text-right font-mono">{row.halfDay ?? '-'}</td>
                <td className="p-3 text-right font-mono">{row.payableDays === null ? '-' : formatDays(row.payableDays)}</td>
                <td className="p-3 text-right font-mono">{row.attendancePct === null ? '-' : `${row.attendancePct.toFixed(1)}%`}</td>
                <td className="p-3 text-center">
                  <Badge variant={row.employee.isActive ? 'default' : 'secondary'}>
                    {row.employee.isActive ? 'Active' : 'Inactive'}
                  </Badge>
                </td>
              </tr>
            ))}
            {rows.length === 0 && (
              <tr>
                <td colSpan={9} className="p-8 text-center text-muted-foreground">No employees found</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {employeesData && (
        <Pagination
          page={employeesData.page}
          total={employeesData.total}
          limit={employeesData.limit}
          onPageChange={(page) => setSearch({ page })}
        />
      )}
    </div>
  );
}
