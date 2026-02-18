/**
 * Finance Page — thin shell that renders tab components.
 */

import { useCallback } from 'react';
import { useNavigate } from '@tanstack/react-router';
import { Route } from '../routes/_authenticated/finance';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { IndianRupee } from 'lucide-react';
import type { FinanceSearchParams } from '@coh/shared';

import DashboardTab from './finance/DashboardTab';
import InvoicesTab from './finance/InvoicesTab';
import PaymentsTab from './finance/PaymentsTab';
import PnlTab from './finance/PnlTab';
import CashFlowTab from './finance/CashFlowTab';
import BankImportTab from './finance/BankImportTab';
import PartiesTab from './finance/PartiesTab';
import TransactionTypesTab from './finance/TransactionTypesTab';

export default function Finance() {
  const search = Route.useSearch();
  const navigate = useNavigate();

  const handleTabChange = useCallback(
    (tab: string) => {
      navigate({
        to: '/finance',
        search: { ...search, tab: tab as FinanceSearchParams['tab'], page: 1 },
        replace: true,
      });
    },
    [navigate, search]
  );

  return (
    <div className="p-4 max-w-[1400px] mx-auto">
      <div className="flex items-center justify-between mb-4">
        <h1 className="text-2xl font-bold flex items-center gap-2">
          <IndianRupee className="h-6 w-6" />
          Finance
        </h1>
      </div>

      <Tabs value={search.tab || 'dashboard'} onValueChange={handleTabChange}>
        <TabsList>
          <TabsTrigger value="dashboard">Dashboard</TabsTrigger>
          <TabsTrigger value="invoices">Invoices</TabsTrigger>
          <TabsTrigger value="payments">Payments</TabsTrigger>
          <TabsTrigger value="pnl">P&L</TabsTrigger>
          <TabsTrigger value="cashflow">Cash Flow</TabsTrigger>
          <TabsTrigger value="bank-import">Bank Import</TabsTrigger>
          <TabsTrigger value="parties">Parties</TabsTrigger>
          <TabsTrigger value="transaction-types">Txn Types</TabsTrigger>
        </TabsList>

        <TabsContent value="dashboard" className="mt-4">
          <DashboardTab />
        </TabsContent>
        <TabsContent value="invoices" className="mt-4">
          <InvoicesTab search={search} />
        </TabsContent>
        <TabsContent value="payments" className="mt-4">
          <PaymentsTab search={search} />
        </TabsContent>
        <TabsContent value="pnl" className="mt-4">
          <PnlTab />
        </TabsContent>
        <TabsContent value="cashflow" className="mt-4">
          <CashFlowTab />
        </TabsContent>
        <TabsContent value="bank-import" className="mt-4">
          <BankImportTab search={search} />
        </TabsContent>
        <TabsContent value="parties" className="mt-4">
          <PartiesTab search={search} />
        </TabsContent>
        <TabsContent value="transaction-types" className="mt-4">
          <TransactionTypesTab />
        </TabsContent>
      </Tabs>
    </div>
  );
}
