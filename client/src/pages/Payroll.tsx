import { useCallback } from 'react';
import { useNavigate } from '@tanstack/react-router';
import { Route } from '../routes/_authenticated/payroll';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Calculator, Users, FileSpreadsheet, CalendarDays, LayoutDashboard } from 'lucide-react';
import type { PayrollSearchParams } from '@coh/shared';

import EmployeesTab from './payroll/EmployeesTab';
import AttendanceOverviewTab from './payroll/AttendanceOverviewTab';
import PayrollRunsTab, { PayrollRunDetail } from './payroll/PayrollRunsTab';
import AttendanceTab from './payroll/AttendanceTab';

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
            <LayoutDashboard className="h-4 w-4" /> Overview
          </TabsTrigger>
          <TabsTrigger value="salary" className="gap-1.5">
            <Users className="h-4 w-4" /> Salary
          </TabsTrigger>
          <TabsTrigger value="runs" className="gap-1.5">
            <FileSpreadsheet className="h-4 w-4" /> Payroll Runs
          </TabsTrigger>
          <TabsTrigger value="attendance" className="gap-1.5">
            <CalendarDays className="h-4 w-4" /> Attendance
          </TabsTrigger>
        </TabsList>

        <TabsContent value="employees">
          <AttendanceOverviewTab />
        </TabsContent>
        <TabsContent value="salary">
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
