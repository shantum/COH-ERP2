/**
 * Finance Page
 *
 * Dashboard, Invoices, Payments, and Ledger tabs.
 */

import { useState, useMemo, useCallback, useRef, Fragment } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useServerFn } from '@tanstack/react-start';
import { useNavigate } from '@tanstack/react-router';
import { Route } from '../routes/_authenticated/finance';
import {
  getFinanceSummary,
  listInvoices,
  listPayments,
  listLedgerEntries,
  createInvoice,
  confirmInvoice,
  cancelInvoice,
  createFinancePayment,
  createManualEntry,
  findUnmatchedPayments,
  getMonthlyPnl,
  getPnlAccountDetail,
  getFinanceAlerts,
} from '../server/functions/finance';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription,
} from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import {
  IndianRupee, Plus, ArrowUpRight, ArrowDownLeft,
  Check, X, BookOpen, ChevronLeft, ChevronRight, Loader2, AlertCircle,
  ExternalLink, CloudUpload, Link2, Download,
} from 'lucide-react';
import {
  type FinanceSearchParams,
  INVOICE_CATEGORIES,
  INVOICE_STATUSES,
  PAYMENT_METHODS,
  CHART_OF_ACCOUNTS,
  getCategoryLabel,
} from '@coh/shared';

// ============================================
// MAIN PAGE
// ============================================

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
          <TabsTrigger value="ledger">Ledger</TabsTrigger>
          <TabsTrigger value="pnl">P&L</TabsTrigger>
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
        <TabsContent value="ledger" className="mt-4">
          <LedgerTab search={search} />
        </TabsContent>
        <TabsContent value="pnl" className="mt-4">
          <PnlTab />
        </TabsContent>
      </Tabs>
    </div>
  );
}

// ============================================
// DASHBOARD TAB
// ============================================

const TYPE_LABELS: Record<string, string> = {
  asset: 'Assets',
  liability: 'Liabilities',
  income: 'Income',
  direct_cost: 'Direct Costs',
  expense: 'Expenses',
  equity: 'Equity',
};

function DashboardTab() {
  const summaryFn = useServerFn(getFinanceSummary);
  const alertsFn = useServerFn(getFinanceAlerts);

  const { data, isLoading } = useQuery({
    queryKey: ['finance', 'summary'],
    queryFn: () => summaryFn(),
  });

  const { data: alertsData } = useQuery({
    queryKey: ['finance', 'alerts'],
    queryFn: () => alertsFn(),
  });

  const accounts = data?.success ? data.accounts : [];
  const summary = data?.success ? data.summary : null;

  // Group accounts by type — must be called every render (hooks rule)
  const grouped = useMemo(() => {
    const groups: Record<string, typeof accounts> = {};
    for (const acct of accounts) {
      if (!groups[acct.type]) groups[acct.type] = [];
      groups[acct.type].push(acct);
    }
    return groups;
  }, [accounts]);

  if (isLoading) return <LoadingState />;
  if (!data?.success || !summary) return <div className="text-muted-foreground">Failed to load summary</div>;

  const alerts = alertsData?.success ? alertsData.alerts : [];
  const errorCount = alertsData?.success ? alertsData.counts.errors : 0;
  const warningCount = alertsData?.success ? alertsData.counts.warnings : 0;

  return (
    <div className="space-y-6">
      {/* Integrity Alerts */}
      {alerts.length > 0 && (
        <div className="border border-amber-300 bg-amber-50 dark:bg-amber-950/20 dark:border-amber-800 rounded-lg p-4">
          <h3 className="font-semibold text-sm mb-3">
            Integrity Issues
            {errorCount > 0 && <span className="ml-2 text-xs bg-red-100 text-red-700 dark:bg-red-900 dark:text-red-300 px-2 py-0.5 rounded-full">{errorCount} errors</span>}
            {warningCount > 0 && <span className="ml-2 text-xs bg-amber-100 text-amber-700 dark:bg-amber-900 dark:text-amber-300 px-2 py-0.5 rounded-full">{warningCount} warnings</span>}
          </h3>
          <div className="space-y-2 max-h-[300px] overflow-y-auto">
            {alerts.map((alert: { severity: string; category: string; message: string; details?: string }, i: number) => (
              <div key={i} className={`text-sm flex gap-2 ${alert.severity === 'error' ? 'text-red-700 dark:text-red-400' : 'text-amber-700 dark:text-amber-400'}`}>
                <span className="shrink-0">{alert.severity === 'error' ? '!!' : '!'}</span>
                <div>
                  <span className="font-medium">{alert.category}:</span>{' '}
                  <span>{alert.message}</span>
                  {alert.details && <div className="text-xs text-muted-foreground mt-0.5">{alert.details}</div>}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Summary Cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <SummaryCard
          label="Accounts Receivable"
          value={summary.totalReceivable}
          subtitle={`${summary.openReceivableInvoices} open invoices`}
          color="text-green-700"
        />
        <SummaryCard
          label="Accounts Payable"
          value={summary.totalPayable}
          subtitle={`${summary.openPayableInvoices} open invoices`}
          color="text-red-700"
        />
        <SummaryCard
          label="HDFC Bank"
          value={accounts.find((a) => a.code === 'BANK_HDFC')?.balance ?? 0}
          color="text-blue-700"
        />
        <SummaryCard
          label="RazorpayX"
          value={accounts.find((a) => a.code === 'BANK_RAZORPAYX')?.balance ?? 0}
          color="text-blue-600"
        />
        <SummaryCard
          label="Cash"
          value={accounts.find((a) => a.code === 'CASH')?.balance ?? 0}
          color="text-amber-700"
        />
      </div>

      {/* Account Balances by Type */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {Object.entries(grouped).map(([type, accts]) => (
          <div key={type} className="border rounded-lg p-4">
            <h3 className="font-semibold text-sm text-muted-foreground uppercase mb-3">
              {TYPE_LABELS[type] ?? type}
            </h3>
            <div className="space-y-2">
              {accts.map((acct) => (
                <div key={acct.code} className="flex justify-between text-sm">
                  <span className="text-muted-foreground">{acct.name}</span>
                  <span className={`font-mono ${acct.balance < 0 ? 'text-red-600' : ''}`}>
                    {formatCurrency(acct.balance)}
                  </span>
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function SummaryCard({ label, value, subtitle, color = 'text-foreground' }: {
  label: string;
  value: number;
  subtitle?: string;
  color?: string;
}) {
  return (
    <div className="border rounded-lg p-4">
      <p className="text-sm text-muted-foreground">{label}</p>
      <p className={`text-2xl font-bold font-mono ${color}`}>{formatCurrency(value)}</p>
      {subtitle && <p className="text-xs text-muted-foreground mt-1">{subtitle}</p>}
    </div>
  );
}

// ============================================
// INVOICES TAB
// ============================================

function InvoicesTab({ search }: { search: FinanceSearchParams }) {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  // For the confirm dialog — stores the invoice being confirmed
  const [confirmingInvoice, setConfirmingInvoice] = useState<{
    id: string; type: string; counterpartyName: string | null; totalAmount: number;
    party?: { id: string; name: string } | null;
  } | null>(null);

  const driveSyncMutation = useMutation({
    mutationFn: async () => {
      const res = await fetch('/api/finance/drive/sync', { method: 'POST', credentials: 'include' });
      if (!res.ok) throw new Error('Drive sync failed');
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['finance'] });
    },
  });

  const listFn = useServerFn(listInvoices);
  const { data, isLoading } = useQuery({
    queryKey: ['finance', 'invoices', search.type, search.status, search.category, search.search, search.page],
    queryFn: () =>
      listFn({
        data: {
          ...(search.type ? { type: search.type } : {}),
          ...(search.status ? { status: search.status } : {}),
          ...(search.category ? { category: search.category } : {}),
          ...(search.search ? { search: search.search } : {}),
          page: search.page,
          limit: search.limit,
        },
      }),
  });

  const confirmFn = useServerFn(confirmInvoice);
  const cancelFn = useServerFn(cancelInvoice);

  const confirmMutation = useMutation({
    mutationFn: (params: { id: string; linkedPaymentId?: string }) => confirmFn({ data: params }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['finance'] });
      setConfirmingInvoice(null);
    },
  });

  const cancelMutation = useMutation({
    mutationFn: (id: string) => cancelFn({ data: { id } }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['finance'] });
    },
  });

  const updateSearch = useCallback(
    (updates: Partial<FinanceSearchParams>) => {
      setSelectedIds(new Set());
      navigate({ to: '/finance', search: { ...search, ...updates }, replace: true });
    },
    [navigate, search]
  );

  // Invoices eligible for payout selection: unpaid payables
  const selectableInvoices = useMemo(
    () =>
      (data?.invoices ?? []).filter(
        (inv) =>
          inv.type === 'payable' &&
          (inv.status === 'confirmed' || inv.status === 'partially_paid') &&
          inv.balanceDue > 0
      ),
    [data?.invoices]
  );

  const allSelectableSelected =
    selectableInvoices.length > 0 && selectableInvoices.every((inv) => selectedIds.has(inv.id));

  const toggleSelectAll = useCallback(() => {
    if (allSelectableSelected) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(selectableInvoices.map((inv) => inv.id)));
    }
  }, [allSelectableSelected, selectableInvoices]);

  const toggleSelect = useCallback((id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const handleDownloadPayoutCsv = useCallback(() => {
    if (selectedIds.size === 0 || !data?.invoices) return;
    const selected = data.invoices.filter((inv) => selectedIds.has(inv.id));

    // Validate bank details
    const missingBank = selected.filter(
      (inv) => !inv.party?.bankAccountNumber || !inv.party?.bankIfsc
    );
    const valid = selected.filter(
      (inv) => inv.party?.bankAccountNumber && inv.party?.bankIfsc
    );

    if (missingBank.length > 0) {
      const names = missingBank.map((inv) => inv.party?.name ?? inv.counterpartyName ?? 'Unknown').join(', ');
      if (valid.length === 0) {
        window.alert(`All selected invoices are missing bank details: ${names}`);
        return;
      }
      if (!window.confirm(`${missingBank.length} invoice(s) missing bank details will be skipped: ${names}.\n\nContinue with the remaining ${valid.length}?`)) {
        return;
      }
    }

    // Build CSV — RazorpayX 11-column format (headers must match their template exactly)
    const header = [
      'Beneficiary Name (Mandatory) Special characters not supported',
      "Beneficiary's Account Number (Mandatory) Typically 9-18 digits",
      "IFSC Code (Mandatory) 11 digit code of the beneficiary\u2019s bank account. Eg. HDFC0004277",
      'Payout Amount (Mandatory) Amount should be in rupees',
      'Payout Mode (Mandatory) Select IMPS/NEFT/RTGS',
      'Payout Narration (Optional) Will appear on bank statement (max 30 char with no special characters)',
      'Notes (Optional) A note for internal reference',
      'Phone Number (Optional)',
      'Email ID (Optional)',
      'Contact Reference ID (Optional) Eg: Employee ID or Customer ID',
      'Payout Reference ID (Optional) Eg: Bill no or Invoice No or Pay ID',
    ].join(',');

    const csvEscape = (v: string) =>
      v.includes(',') || v.includes('"') || v.includes('\n')
        ? '"' + v.replace(/"/g, '""') + '"'
        : v;
    const sanitizeNarration = (text: string) =>
      text.replace(/[^a-zA-Z0-9 ]/g, '').trim().slice(0, 30);

    const rows = valid.map((inv) => {
      const party = inv.party!;
      const amount = Math.round(inv.balanceDue * 100) / 100;
      const mode = amount >= 500000 ? 'NEFT' : 'IMPS';
      const beneficiary = party.bankAccountName || party.name;
      const narration = sanitizeNarration(party.name);
      const notes = (inv.invoiceNumber || inv.id) + ' ' + inv.category;
      const refId = inv.invoiceNumber || inv.id;

      return [
        csvEscape(beneficiary),
        party.bankAccountNumber!,
        party.bankIfsc!,
        String(amount),
        mode,
        csvEscape(narration),
        csvEscape(notes),
        (party.phone || '').replace(/^\+91/, ''),
        party.email || '',
        party.id,
        csvEscape(refId),
      ].join(',');
    });

    const csv = [header, ...rows].join('\n') + '\n';
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `razorpayx-payout-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }, [selectedIds, data?.invoices]);

  // When user clicks confirm on a payable draft, show the linking dialog
  // For receivable drafts, confirm directly
  const handleConfirmClick = useCallback((inv: NonNullable<typeof data>['invoices'][number]) => {
    if (inv.type === 'payable') {
      setConfirmingInvoice({
        id: inv.id,
        type: inv.type,
        counterpartyName: inv.party?.name ?? inv.counterpartyName,
        totalAmount: inv.totalAmount,
        party: inv.party,
      });
    } else {
      confirmMutation.mutate({ id: inv.id });
    }
  }, [confirmMutation]);

  return (
    <div className="space-y-4">
      {/* Filters */}
      <div className="flex flex-wrap items-center gap-2">
        <Select value={search.type ?? 'all'} onValueChange={(v) => updateSearch({ type: v === 'all' ? undefined : v as 'payable' | 'receivable', page: 1 })}>
          <SelectTrigger className="w-[140px]"><SelectValue placeholder="Type" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Types</SelectItem>
            <SelectItem value="payable">Payable</SelectItem>
            <SelectItem value="receivable">Receivable</SelectItem>
          </SelectContent>
        </Select>

        <Select value={search.status ?? 'all'} onValueChange={(v) => updateSearch({ status: v === 'all' ? undefined : v, page: 1 })}>
          <SelectTrigger className="w-[160px]"><SelectValue placeholder="Status" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Statuses</SelectItem>
            {INVOICE_STATUSES.map((s) => (
              <SelectItem key={s} value={s}>{s.replace('_', ' ')}</SelectItem>
            ))}
          </SelectContent>
        </Select>

        <Select value={search.category ?? 'all'} onValueChange={(v) => updateSearch({ category: v === 'all' ? undefined : v, page: 1 })}>
          <SelectTrigger className="w-[180px]"><SelectValue placeholder="Category" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Categories</SelectItem>
            {INVOICE_CATEGORIES.map((c) => (
              <SelectItem key={c} value={c}>{getCategoryLabel(c)}</SelectItem>
            ))}
          </SelectContent>
        </Select>

        <Input
          placeholder="Search invoices..."
          value={search.search ?? ''}
          onChange={(e) => updateSearch({ search: e.target.value || undefined, page: 1 })}
          className="w-[200px]"
        />

        <div className="ml-auto flex items-center gap-2">
          {selectedIds.size > 0 && (
            <Button variant="outline" onClick={handleDownloadPayoutCsv}>
              <Download className="h-4 w-4 mr-1" /> Download Payout CSV ({selectedIds.size})
            </Button>
          )}
          <Button
            variant="outline"
            onClick={() => driveSyncMutation.mutate()}
            disabled={driveSyncMutation.isPending}
            title="Upload pending files to Google Drive"
          >
            {driveSyncMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin mr-1" /> : <CloudUpload className="h-4 w-4 mr-1" />}
            Sync to Drive
          </Button>
          <Button onClick={() => setShowCreateModal(true)}>
            <Plus className="h-4 w-4 mr-1" /> New Invoice
          </Button>
        </div>
      </div>

      {/* Table */}
      {isLoading ? (
        <LoadingState />
      ) : (
        <>
          <div className="border rounded-lg overflow-hidden">
            <table className="w-full text-sm">
              <thead className="bg-muted/50">
                <tr>
                  <th className="p-3 w-10">
                    <input
                      type="checkbox"
                      className="h-4 w-4 rounded border-gray-300 accent-blue-600"
                      checked={allSelectableSelected && selectableInvoices.length > 0}
                      onChange={toggleSelectAll}
                      disabled={selectableInvoices.length === 0}
                    />
                  </th>
                  <th className="text-left p-3 font-medium">Invoice #</th>
                  <th className="text-left p-3 font-medium">Type</th>
                  <th className="text-left p-3 font-medium">Category</th>
                  <th className="text-left p-3 font-medium">Counterparty</th>
                  <th className="text-right p-3 font-medium">Total</th>
                  <th className="text-right p-3 font-medium">Balance Due</th>
                  <th className="text-left p-3 font-medium">Status</th>
                  <th className="text-left p-3 font-medium">Date</th>
                  <th className="text-right p-3 font-medium">Actions</th>
                </tr>
              </thead>
              <tbody>
                {data?.invoices?.map((inv) => {
                  const isSelectable =
                    inv.type === 'payable' &&
                    (inv.status === 'confirmed' || inv.status === 'partially_paid') &&
                    inv.balanceDue > 0;
                  return (
                  <tr key={inv.id} className="border-t hover:bg-muted/30">
                    <td className="p-3">
                      {isSelectable ? (
                        <input
                          type="checkbox"
                          className="h-4 w-4 rounded border-gray-300 accent-blue-600"
                          checked={selectedIds.has(inv.id)}
                          onChange={() => toggleSelect(inv.id)}
                        />
                      ) : (
                        <span className="block h-4 w-4" />
                      )}
                    </td>
                    <td className="p-3 font-mono text-xs">{inv.invoiceNumber ?? '—'}</td>
                    <td className="p-3">
                      <span className={`inline-flex items-center gap-1 text-xs ${inv.type === 'payable' ? 'text-red-600' : 'text-green-600'}`}>
                        {inv.type === 'payable' ? <ArrowUpRight className="h-3 w-3" /> : <ArrowDownLeft className="h-3 w-3" />}
                        {inv.type}
                      </span>
                    </td>
                    <td className="p-3 text-xs">{getCategoryLabel(inv.category as any)}</td>
                    <td className="p-3">
                      {inv.party?.name ??
                        (inv.customer ? [inv.customer.firstName, inv.customer.lastName].filter(Boolean).join(' ') || inv.customer.email : null) ??
                        inv.counterpartyName ?? '—'}
                    </td>
                    <td className="p-3 text-right font-mono">{formatCurrency(inv.totalAmount)}</td>
                    <td className="p-3 text-right">
                      <span className="font-mono">{formatCurrency(inv.balanceDue)}</span>
                      {inv.tdsAmount != null && inv.tdsAmount > 0 && (
                        <span className="block text-[10px] text-muted-foreground">TDS: {formatCurrency(inv.tdsAmount)}</span>
                      )}
                    </td>
                    <td className="p-3"><StatusBadge status={inv.status} /></td>
                    <td className="p-3 text-xs text-muted-foreground">{inv.invoiceDate ? new Date(inv.invoiceDate).toLocaleDateString('en-IN') : '—'}</td>
                    <td className="p-3 text-right">
                      <div className="flex items-center justify-end gap-1">
                        {inv.driveUrl && (
                          <a
                            href={inv.driveUrl}
                            target="_blank"
                            rel="noopener noreferrer"
                            title="Open in Google Drive"
                            className="inline-flex items-center justify-center h-8 w-8 rounded-md hover:bg-muted"
                          >
                            <ExternalLink className="h-3.5 w-3.5 text-blue-600" />
                          </a>
                        )}
                        {inv.status === 'draft' && (
                          <>
                            <Button
                              size="sm"
                              variant="ghost"
                              onClick={() => handleConfirmClick(inv)}
                              disabled={confirmMutation.isPending}
                              title="Confirm"
                            >
                              <Check className="h-3.5 w-3.5 text-green-600" />
                            </Button>
                            <Button
                              size="sm"
                              variant="ghost"
                              onClick={() => cancelMutation.mutate(inv.id)}
                              disabled={cancelMutation.isPending}
                              title="Cancel"
                            >
                              <X className="h-3.5 w-3.5 text-red-600" />
                            </Button>
                          </>
                        )}
                      </div>
                    </td>
                  </tr>
                  );
                })}
                {(!data?.invoices || data.invoices.length === 0) && (
                  <tr><td colSpan={10} className="p-8 text-center text-muted-foreground">No invoices found</td></tr>
                )}
              </tbody>
            </table>
          </div>

          <Pagination page={search.page} total={data?.total ?? 0} limit={search.limit} onPageChange={(p) => updateSearch({ page: p })} />
        </>
      )}

      {/* Create Invoice Modal */}
      <CreateInvoiceModal open={showCreateModal} onClose={() => setShowCreateModal(false)} />

      {/* Confirm + Link Payment Dialog (payable drafts only) */}
      {confirmingInvoice && (
        <ConfirmPayableDialog
          invoice={confirmingInvoice}
          isPending={confirmMutation.isPending}
          onConfirm={(linkedPaymentId) => confirmMutation.mutate({ id: confirmingInvoice.id, linkedPaymentId })}
          onClose={() => setConfirmingInvoice(null)}
        />
      )}
    </div>
  );
}

// ============================================
// PAYMENTS TAB
// ============================================

function PaymentsTab({ search }: { search: FinanceSearchParams }) {
  const navigate = useNavigate();
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [voucherPrefill, setVoucherPrefill] = useState<{
    type: 'payable' | 'receivable';
    totalAmount: number;
    counterpartyName: string;
    partyId?: string;
  } | null>(null);

  const listFn = useServerFn(listPayments);
  const { data, isLoading } = useQuery({
    queryKey: ['finance', 'payments', search.direction, search.method, search.matchStatus, search.search, search.page],
    queryFn: () =>
      listFn({
        data: {
          ...(search.direction ? { direction: search.direction } : {}),
          ...(search.method ? { method: search.method } : {}),
          ...(search.matchStatus && search.matchStatus !== 'all' ? { matchStatus: search.matchStatus } : {}),
          ...(search.search ? { search: search.search } : {}),
          page: search.page,
          limit: search.limit,
        },
      }),
  });

  const updateSearch = useCallback(
    (updates: Partial<FinanceSearchParams>) => {
      navigate({ to: '/finance', search: { ...search, ...updates }, replace: true });
    },
    [navigate, search]
  );

  return (
    <div className="space-y-4">
      {/* Filters */}
      <div className="flex flex-wrap items-center gap-2">
        <Select value={search.direction ?? 'all'} onValueChange={(v) => updateSearch({ direction: v === 'all' ? undefined : v as 'outgoing' | 'incoming', page: 1 })}>
          <SelectTrigger className="w-[140px]"><SelectValue placeholder="Direction" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All</SelectItem>
            <SelectItem value="outgoing">Outgoing</SelectItem>
            <SelectItem value="incoming">Incoming</SelectItem>
          </SelectContent>
        </Select>

        <Select value={search.method ?? 'all'} onValueChange={(v) => updateSearch({ method: v === 'all' ? undefined : v, page: 1 })}>
          <SelectTrigger className="w-[160px]"><SelectValue placeholder="Method" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Methods</SelectItem>
            {PAYMENT_METHODS.map((m) => (
              <SelectItem key={m} value={m}>{m.replace(/_/g, ' ')}</SelectItem>
            ))}
          </SelectContent>
        </Select>

        <Select value={search.matchStatus ?? 'all'} onValueChange={(v) => updateSearch({ matchStatus: v === 'all' ? undefined : v as 'unmatched' | 'matched', page: 1 })}>
          <SelectTrigger className="w-[190px]"><SelectValue placeholder="Match Status" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All</SelectItem>
            <SelectItem value="unmatched">Needs Documentation</SelectItem>
            <SelectItem value="matched">Fully Matched</SelectItem>
          </SelectContent>
        </Select>

        <Input
          placeholder="Search payments..."
          value={search.search ?? ''}
          onChange={(e) => updateSearch({ search: e.target.value || undefined, page: 1 })}
          className="w-[200px]"
        />

        <div className="ml-auto">
          <Button onClick={() => setShowCreateModal(true)}>
            <Plus className="h-4 w-4 mr-1" /> Record Payment
          </Button>
        </div>
      </div>

      {/* Table */}
      {isLoading ? (
        <LoadingState />
      ) : (
        <>
          <div className="border rounded-lg overflow-hidden">
            <table className="w-full text-sm">
              <thead className="bg-muted/50">
                <tr>
                  <th className="text-left p-3 font-medium">Reference</th>
                  <th className="text-left p-3 font-medium">Direction</th>
                  <th className="text-left p-3 font-medium">Method</th>
                  <th className="text-left p-3 font-medium">Counterparty</th>
                  <th className="text-right p-3 font-medium">Amount</th>
                  <th className="text-right p-3 font-medium">Matched</th>
                  <th className="text-left p-3 font-medium">Status</th>
                  <th className="text-left p-3 font-medium">Date</th>
                  <th className="text-right p-3 font-medium">Actions</th>
                </tr>
              </thead>
              <tbody>
                {data?.payments?.map((pmt) => (
                  <tr key={pmt.id} className="border-t hover:bg-muted/30">
                    <td className="p-3 font-mono text-xs">{pmt.referenceNumber ?? '—'}</td>
                    <td className="p-3">
                      <span className={`inline-flex items-center gap-1 text-xs ${pmt.direction === 'incoming' ? 'text-green-600' : 'text-red-600'}`}>
                        {pmt.direction === 'incoming' ? <ArrowDownLeft className="h-3 w-3" /> : <ArrowUpRight className="h-3 w-3" />}
                        {pmt.direction}
                      </span>
                    </td>
                    <td className="p-3 text-xs">{pmt.method.replace(/_/g, ' ')}</td>
                    <td className="p-3">
                      {pmt.party?.name ??
                        (pmt.customer ? [pmt.customer.firstName, pmt.customer.lastName].filter(Boolean).join(' ') || pmt.customer.email : null) ??
                        pmt.counterpartyName ?? '—'}
                    </td>
                    <td className="p-3 text-right font-mono">{formatCurrency(pmt.amount)}</td>
                    <td className="p-3 text-right font-mono text-muted-foreground">{formatCurrency(pmt.matchedAmount)}</td>
                    <td className="p-3"><StatusBadge status={pmt.status} /></td>
                    <td className="p-3 text-xs text-muted-foreground">{new Date(pmt.paymentDate).toLocaleDateString('en-IN')}</td>
                    <td className="p-3 text-right">
                      {pmt.unmatchedAmount > 0.01 && (
                        <Button
                          size="sm"
                          variant="outline"
                          className="text-xs h-7"
                          onClick={() => setVoucherPrefill({
                            type: 'payable',
                            totalAmount: Math.round(pmt.unmatchedAmount * 100) / 100,
                            counterpartyName: pmt.party?.name ?? pmt.counterpartyName ?? '',
                            ...(pmt.party?.id ? { partyId: pmt.party.id } : {}),
                          })}
                        >
                          <Plus className="h-3 w-3 mr-1" /> Voucher
                        </Button>
                      )}
                    </td>
                  </tr>
                ))}
                {(!data?.payments || data.payments.length === 0) && (
                  <tr><td colSpan={9} className="p-8 text-center text-muted-foreground">No payments found</td></tr>
                )}
              </tbody>
            </table>
          </div>

          <Pagination page={search.page} total={data?.total ?? 0} limit={search.limit} onPageChange={(p) => updateSearch({ page: p })} />
        </>
      )}

      <CreatePaymentModal open={showCreateModal} onClose={() => setShowCreateModal(false)} />

      {/* Create Voucher modal (pre-filled from payment row) */}
      <CreateInvoiceModal
        open={!!voucherPrefill}
        onClose={() => setVoucherPrefill(null)}
        prefill={voucherPrefill ?? undefined}
      />
    </div>
  );
}

// ============================================
// LEDGER TAB
// ============================================

function LedgerTab({ search }: { search: FinanceSearchParams }) {
  const navigate = useNavigate();
  const [showManualEntry, setShowManualEntry] = useState(false);

  const listFn = useServerFn(listLedgerEntries);
  const { data, isLoading } = useQuery({
    queryKey: ['finance', 'ledger', search.accountCode, search.sourceType, search.search, search.page],
    queryFn: () =>
      listFn({
        data: {
          ...(search.accountCode ? { accountCode: search.accountCode } : {}),
          ...(search.sourceType ? { sourceType: search.sourceType } : {}),
          ...(search.search ? { search: search.search } : {}),
          page: search.page,
          limit: search.limit,
        },
      }),
  });

  const updateSearch = useCallback(
    (updates: Partial<FinanceSearchParams>) => {
      navigate({ to: '/finance', search: { ...search, ...updates }, replace: true });
    },
    [navigate, search]
  );

  return (
    <div className="space-y-4">
      {/* Filters */}
      <div className="flex flex-wrap items-center gap-2">
        <Select value={search.accountCode ?? 'all'} onValueChange={(v) => updateSearch({ accountCode: v === 'all' ? undefined : v, page: 1 })}>
          <SelectTrigger className="w-[220px]"><SelectValue placeholder="Account" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Accounts</SelectItem>
            {CHART_OF_ACCOUNTS.map((a) => (
              <SelectItem key={a.code} value={a.code}>{a.name}</SelectItem>
            ))}
          </SelectContent>
        </Select>

        <Input
          placeholder="Search entries..."
          value={search.search ?? ''}
          onChange={(e) => updateSearch({ search: e.target.value || undefined, page: 1 })}
          className="w-[200px]"
        />

        <div className="ml-auto">
          <Button onClick={() => setShowManualEntry(true)}>
            <BookOpen className="h-4 w-4 mr-1" /> Manual Entry
          </Button>
        </div>
      </div>

      {/* Entries */}
      {isLoading ? (
        <LoadingState />
      ) : (
        <>
          <div className="space-y-3">
            {data?.entries?.map((entry) => {
              const totalDebit = entry.lines.reduce((s, l) => s + l.debit, 0);
              return (
                <div key={entry.id} className={`border rounded-lg p-4 ${entry.isReversed ? 'opacity-50' : ''}`}>
                  <div className="flex items-start justify-between mb-2">
                    <div>
                      <p className="font-medium text-sm">{entry.description}</p>
                      <p className="text-xs text-muted-foreground">
                        {new Date(entry.entryDate).toLocaleDateString('en-IN')}
                        {' · '}
                        {entry.sourceType.replace(/_/g, ' ')}
                        {entry.isReversed && ' · REVERSED'}
                        {' · by '}
                        {entry.createdBy.name}
                      </p>
                    </div>
                    <span className="font-mono text-sm font-medium">{formatCurrency(totalDebit)}</span>
                  </div>
                  <div className="grid grid-cols-2 gap-x-4 text-xs">
                    {entry.lines.map((line) => (
                      <div key={line.id} className="flex justify-between py-0.5">
                        <span className="text-muted-foreground">
                          {line.debit > 0 ? 'Dr' : 'Cr'} {line.account.name}
                        </span>
                        <span className="font-mono">
                          {formatCurrency(line.debit > 0 ? line.debit : line.credit)}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              );
            })}
            {(!data?.entries || data.entries.length === 0) && (
              <div className="p-8 text-center text-muted-foreground border rounded-lg">No ledger entries found</div>
            )}
          </div>

          <Pagination page={search.page} total={data?.total ?? 0} limit={search.limit} onPageChange={(p) => updateSearch({ page: p })} />
        </>
      )}

      <ManualEntryModal open={showManualEntry} onClose={() => setShowManualEntry(false)} />
    </div>
  );
}

// ============================================
// P&L TAB (accrual basis, grouped by period)
// ============================================

function PnlTab() {
  const pnlFn = useServerFn(getMonthlyPnl);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  // "2026-01::OPERATING_EXPENSES" format for account drill-down
  const [drilldown, setDrilldown] = useState<string | null>(null);

  const { data, isLoading } = useQuery({
    queryKey: ['finance', 'pnl'],
    queryFn: () => pnlFn(),
  });

  if (isLoading) return <LoadingState />;
  if (!data?.success) return <div className="text-muted-foreground text-center py-8">Failed to load P&L</div>;

  const months = data.months;

  const fmt = (n: number) => {
    const sign = n < 0 ? '-' : '';
    return `${sign}Rs ${Math.abs(n).toLocaleString('en-IN', { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`;
  };

  const toggle = (period: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(period)) next.delete(period);
      else next.add(period);
      return next;
    });
  };

  const toggleDrilldown = (period: string, code: string) => {
    const key = `${period}::${code}`;
    setDrilldown((prev) => (prev === key ? null : key));
  };

  const renderBreakdownRows = (
    period: string,
    lines: { code: string; name: string; amount: number }[],
    label: string,
    total: number,
  ) => {
    if (lines.length === 0) return null;
    return (
      <>
        <tr className="bg-muted/30">
          <td className="py-1.5 px-3 pl-8 font-medium text-muted-foreground text-xs uppercase tracking-wide" colSpan={5}>{label}</td>
          <td className="py-1.5 px-3 text-right font-medium text-xs">{fmt(total)}</td>
        </tr>
        {lines.map((l) => {
          const drillKey = `${period}::${l.code}`;
          const isDrilling = drilldown === drillKey;
          return (
            <Fragment key={l.code}>
              <tr
                className="bg-muted/15 hover:bg-muted/25 cursor-pointer"
                onClick={(e) => { e.stopPropagation(); toggleDrilldown(period, l.code); }}
              >
                <td className="py-1 px-3 pl-12 text-muted-foreground" colSpan={5}>
                  <span className="inline-block w-3 mr-1 text-xs">{isDrilling ? '▾' : '▸'}</span>
                  {l.name}
                </td>
                <td className="py-1 px-3 text-right text-muted-foreground">{fmt(l.amount)}</td>
              </tr>
              {isDrilling && <AccountDrilldown period={period} accountCode={l.code} fmt={fmt} />}
            </Fragment>
          );
        })}
      </>
    );
  };

  return (
    <div className="space-y-4">
      <h3 className="text-lg font-semibold">Monthly P&L (Accrual Basis)</h3>
      <p className="text-xs text-muted-foreground">Click a month to expand, then click any account to see what's inside</p>
      <div className="overflow-x-auto">
        <table className="w-full text-sm border-collapse">
          <thead>
            <tr className="border-b">
              <th className="text-left py-2 px-3 font-medium">Period</th>
              <th className="text-right py-2 px-3 font-medium">Revenue</th>
              <th className="text-right py-2 px-3 font-medium">COGS</th>
              <th className="text-right py-2 px-3 font-medium">Gross Profit</th>
              <th className="text-right py-2 px-3 font-medium">Expenses</th>
              <th className="text-right py-2 px-3 font-medium">Net Profit</th>
            </tr>
          </thead>
          <tbody>
            {months.map((m) => {
              const isExpanded = expanded.has(m.period);
              return (
                <Fragment key={m.period}>
                  <tr
                    className="border-b hover:bg-muted/50 cursor-pointer"
                    onClick={() => toggle(m.period)}
                  >
                    <td className="py-2 px-3 font-medium">
                      <span className="inline-block w-4 mr-1 text-muted-foreground">{isExpanded ? '▾' : '▸'}</span>
                      {m.period}
                    </td>
                    <td className="py-2 px-3 text-right">{fmt(m.revenue)}</td>
                    <td className="py-2 px-3 text-right">{fmt(m.cogs)}</td>
                    <td className={`py-2 px-3 text-right font-medium ${m.grossProfit >= 0 ? 'text-green-600' : 'text-red-600'}`}>
                      {fmt(m.grossProfit)}
                    </td>
                    <td className="py-2 px-3 text-right">{fmt(m.totalExpenses)}</td>
                    <td className={`py-2 px-3 text-right font-semibold ${m.netProfit >= 0 ? 'text-green-600' : 'text-red-600'}`}>
                      {fmt(m.netProfit)}
                    </td>
                  </tr>
                  {isExpanded && (
                    <>
                      {renderBreakdownRows(m.period, m.revenueLines, 'Revenue', m.revenue)}
                      {renderBreakdownRows(m.period, m.cogsLines, 'Cost of Goods Sold', m.cogs)}
                      {renderBreakdownRows(m.period, m.expenses, 'Operating Expenses', m.totalExpenses)}
                    </>
                  )}
                </Fragment>
              );
            })}
          </tbody>
        </table>
      </div>
      {months.length === 0 && (
        <div className="text-muted-foreground text-center py-8">No ledger entries found</div>
      )}
    </div>
  );
}

// Lazy-loaded account drill-down: shows categorized entries for one account+period
function AccountDrilldown({ period, accountCode, fmt }: {
  period: string;
  accountCode: string;
  fmt: (n: number) => string;
}) {
  const detailFn = useServerFn(getPnlAccountDetail);
  const [expandedCat, setExpandedCat] = useState<Set<string>>(new Set());

  const { data, isLoading } = useQuery({
    queryKey: ['finance', 'pnl-detail', period, accountCode],
    queryFn: () => detailFn({ data: { period, accountCode } }),
  });

  if (isLoading) {
    return (
      <tr className="bg-muted/5">
        <td colSpan={6} className="py-2 px-3 pl-16 text-muted-foreground text-xs">Loading...</td>
      </tr>
    );
  }

  if (!data?.success || data.categories.length === 0) {
    return (
      <tr className="bg-muted/5">
        <td colSpan={6} className="py-2 px-3 pl-16 text-muted-foreground text-xs">No entries</td>
      </tr>
    );
  }

  const toggleCat = (label: string) => {
    setExpandedCat((prev) => {
      const next = new Set(prev);
      if (next.has(label)) next.delete(label);
      else next.add(label);
      return next;
    });
  };

  return (
    <>
      {data.categories.map((cat: { label: string; total: number; lines: { description: string; amount: number; date: string; counterparty: string | null }[] }) => {
        const isCatExpanded = expandedCat.has(cat.label);
        return (
          <Fragment key={cat.label}>
            <tr
              className="bg-blue-50/50 dark:bg-blue-950/20 hover:bg-blue-50 dark:hover:bg-blue-950/30 cursor-pointer"
              onClick={(e) => { e.stopPropagation(); toggleCat(cat.label); }}
            >
              <td className="py-1 px-3 pl-16 text-xs font-medium" colSpan={5}>
                <span className="inline-block w-3 mr-1 text-muted-foreground">{isCatExpanded ? '▾' : '▸'}</span>
                {cat.label}
                <span className="ml-2 text-muted-foreground">({cat.lines.length})</span>
              </td>
              <td className="py-1 px-3 text-right text-xs font-medium">{fmt(cat.total)}</td>
            </tr>
            {isCatExpanded && cat.lines.map((line: { description: string; amount: number; date: string; counterparty: string | null }, i: number) => (
              <tr key={i} className="bg-blue-50/25 dark:bg-blue-950/10">
                <td className="py-0.5 px-3 pl-20 text-xs text-muted-foreground truncate max-w-[400px]" colSpan={4} title={line.description}>
                  {line.counterparty || line.description.slice(0, 60)}
                </td>
                <td className="py-0.5 px-3 text-xs text-muted-foreground">{line.date}</td>
                <td className="py-0.5 px-3 text-right text-xs text-muted-foreground">{fmt(line.amount)}</td>
              </tr>
            ))}
          </Fragment>
        );
      })}
    </>
  );
}

// ============================================
// CONFIRM PAYABLE DIALOG (link to payment)
// ============================================

function ConfirmPayableDialog({ invoice, isPending, onConfirm, onClose }: {
  invoice: { id: string; counterpartyName: string | null; totalAmount: number };
  isPending: boolean;
  onConfirm: (linkedPaymentId?: string) => void;
  onClose: () => void;
}) {
  const [selectedPaymentId, setSelectedPaymentId] = useState<string | null>(null);
  const findPaymentsFn = useServerFn(findUnmatchedPayments);

  const { data, isLoading } = useQuery({
    queryKey: ['finance', 'unmatched-payments', invoice.counterpartyName],
    queryFn: () => findPaymentsFn({
      data: {
        ...(invoice.counterpartyName ? { counterpartyName: invoice.counterpartyName } : {}),
      },
    }),
  });

  const payments = data?.success ? data.payments : [];

  return (
    <Dialog open onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Confirm Invoice</DialogTitle>
          <DialogDescription>
            {formatCurrency(invoice.totalAmount)} to {invoice.counterpartyName ?? 'vendor'}. Was this already paid?
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          {isLoading ? (
            <div className="flex items-center justify-center py-4 text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin mr-2" /> Finding matching payments...
            </div>
          ) : payments.length > 0 ? (
            <div className="space-y-2">
              <p className="text-sm text-muted-foreground">Found {payments.length} unmatched payment{payments.length !== 1 ? 's' : ''}:</p>
              <div className="max-h-[240px] overflow-y-auto space-y-1.5">
                {payments.map((pmt) => {
                  const debitAccount = pmt.ledgerEntry?.lines?.[0]?.account;
                  return (
                    <button
                      key={pmt.id}
                      type="button"
                      className={`w-full text-left p-3 rounded-lg border text-sm transition-colors ${
                        selectedPaymentId === pmt.id
                          ? 'border-blue-500 bg-blue-50 dark:bg-blue-950'
                          : 'hover:bg-muted/50'
                      }`}
                      onClick={() => setSelectedPaymentId(selectedPaymentId === pmt.id ? null : pmt.id)}
                    >
                      <div className="flex items-center justify-between">
                        <span className="font-medium">{formatCurrency(pmt.amount)}</span>
                        <span className="text-xs text-muted-foreground">
                          {new Date(pmt.paymentDate).toLocaleDateString('en-IN')}
                        </span>
                      </div>
                      <div className="flex items-center justify-between mt-1 text-xs text-muted-foreground">
                        <span>{pmt.counterpartyName ?? '—'}</span>
                        <span>{pmt.referenceNumber ?? pmt.method.replace(/_/g, ' ')}</span>
                      </div>
                      {debitAccount && debitAccount.code === 'UNMATCHED_PAYMENTS' && (
                        <span className="inline-flex items-center mt-1 text-[10px] text-amber-600 bg-amber-50 px-1.5 py-0.5 rounded">
                          suspense — will be reclassified
                        </span>
                      )}
                      {pmt.unmatchedAmount < pmt.amount && (
                        <span className="text-[10px] text-muted-foreground mt-0.5 block">
                          Unmatched: {formatCurrency(pmt.unmatchedAmount)}
                        </span>
                      )}
                    </button>
                  );
                })}
              </div>
            </div>
          ) : (
            <p className="text-sm text-muted-foreground py-2">No unmatched payments found for this vendor.</p>
          )}
        </div>

        <DialogFooter className="flex-col sm:flex-row gap-2">
          <Button variant="outline" onClick={onClose} disabled={isPending}>Cancel</Button>
          <Button
            variant="outline"
            onClick={() => onConfirm(undefined)}
            disabled={isPending}
          >
            {isPending && !selectedPaymentId ? <Loader2 className="h-4 w-4 animate-spin mr-1" /> : null}
            Confirm (no link)
          </Button>
          {selectedPaymentId && (
            <Button
              onClick={() => onConfirm(selectedPaymentId)}
              disabled={isPending}
            >
              {isPending ? <Loader2 className="h-4 w-4 animate-spin mr-1" /> : <Link2 className="h-4 w-4 mr-1" />}
              Confirm + Link Payment
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ============================================
// CREATE INVOICE MODAL
// ============================================

function CreateInvoiceModal({ open, onClose, prefill }: {
  open: boolean;
  onClose: () => void;
  prefill?: { type: 'payable' | 'receivable'; totalAmount: number; counterpartyName: string; partyId?: string };
}) {
  const queryClient = useQueryClient();
  const createFn = useServerFn(createInvoice);

  const [form, setForm] = useState({
    type: 'payable' as 'payable' | 'receivable',
    category: 'other' as string,
    invoiceNumber: '',
    counterpartyName: '',
    totalAmount: '',
    gstAmount: '',
    invoiceDate: new Date().toISOString().split('T')[0],
    billingPeriod: '',
    notes: '',
    partyId: undefined as string | undefined,
  });

  // When prefill changes (voucher button clicked), reset form with prefilled values
  const prevPrefillRef = useRef<typeof prefill>(undefined);
  if (prefill && prefill !== prevPrefillRef.current) {
    prevPrefillRef.current = prefill;
    setForm({
      type: prefill.type,
      category: 'other',
      invoiceNumber: '',
      counterpartyName: prefill.counterpartyName,
      totalAmount: String(prefill.totalAmount),
      gstAmount: '',
      invoiceDate: new Date().toISOString().split('T')[0],
      billingPeriod: '',
      notes: '',
      partyId: prefill.partyId,
    });
  }

  const mutation = useMutation({
    mutationFn: () =>
      createFn({
        data: {
          type: form.type,
          category: form.category,
          ...(form.invoiceNumber ? { invoiceNumber: form.invoiceNumber } : {}),
          ...(form.counterpartyName ? { counterpartyName: form.counterpartyName } : {}),
          totalAmount: Number(form.totalAmount),
          ...(form.gstAmount ? { gstAmount: Number(form.gstAmount) } : {}),
          ...(form.invoiceDate ? { invoiceDate: form.invoiceDate } : {}),
          ...(form.billingPeriod ? { billingPeriod: form.billingPeriod } : {}),
          ...(form.notes ? { notes: form.notes } : {}),
          ...(form.partyId ? { partyId: form.partyId } : {}),
        },
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['finance'] });
      onClose();
      resetForm();
    },
  });

  const resetForm = () => {
    prevPrefillRef.current = undefined;
    setForm({
      type: 'payable',
      category: 'other',
      invoiceNumber: '',
      counterpartyName: '',
      totalAmount: '',
      gstAmount: '',
      invoiceDate: new Date().toISOString().split('T')[0],
      billingPeriod: '',
      notes: '',
      partyId: undefined,
    });
  };

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>New Invoice</DialogTitle>
          <DialogDescription>Create a draft invoice. Confirm it later to create a ledger entry.</DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label>Type</Label>
              <Select value={form.type} onValueChange={(v) => setForm({ ...form, type: v as 'payable' | 'receivable' })}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="payable">Payable (we owe)</SelectItem>
                  <SelectItem value="receivable">Receivable (owed to us)</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>Category</Label>
              <Select value={form.category} onValueChange={(v) => setForm({ ...form, category: v })}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {INVOICE_CATEGORIES.map((c) => (
                    <SelectItem key={c} value={c}>{getCategoryLabel(c)}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          <div>
            <Label>Invoice Number</Label>
            <Input value={form.invoiceNumber} onChange={(e) => setForm({ ...form, invoiceNumber: e.target.value })} placeholder="Optional" />
          </div>
          <div>
            <Label>Counterparty</Label>
            <Input value={form.counterpartyName} onChange={(e) => setForm({ ...form, counterpartyName: e.target.value })} placeholder="Vendor/customer name" />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label>Total Amount</Label>
              <Input type="number" value={form.totalAmount} onChange={(e) => setForm({ ...form, totalAmount: e.target.value })} placeholder="0.00" />
            </div>
            <div>
              <Label>GST Amount</Label>
              <Input type="number" value={form.gstAmount} onChange={(e) => setForm({ ...form, gstAmount: e.target.value })} placeholder="0.00" />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label>Invoice Date</Label>
              <Input type="date" value={form.invoiceDate} onChange={(e) => setForm({ ...form, invoiceDate: e.target.value })} />
            </div>
            <div>
              <Label>Billing Period</Label>
              <Input type="month" value={form.billingPeriod} onChange={(e) => setForm({ ...form, billingPeriod: e.target.value })} placeholder="Optional" />
            </div>
          </div>
          <div>
            <Label>Notes</Label>
            <Textarea value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} rows={2} />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button
            onClick={() => mutation.mutate()}
            disabled={!form.totalAmount || Number(form.totalAmount) <= 0 || mutation.isPending}
          >
            {mutation.isPending ? <Loader2 className="h-4 w-4 animate-spin mr-1" /> : null}
            Create Draft
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ============================================
// CREATE PAYMENT MODAL
// ============================================

function CreatePaymentModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const queryClient = useQueryClient();
  const createFn = useServerFn(createFinancePayment);

  const [form, setForm] = useState({
    direction: 'outgoing' as 'outgoing' | 'incoming',
    method: 'bank_transfer' as string,
    amount: '',
    referenceNumber: '',
    counterpartyName: '',
    paymentDate: new Date().toISOString().split('T')[0],
    notes: '',
  });

  const mutation = useMutation({
    mutationFn: () =>
      createFn({
        data: {
          direction: form.direction,
          method: form.method,
          amount: Number(form.amount),
          ...(form.referenceNumber ? { referenceNumber: form.referenceNumber } : {}),
          ...(form.counterpartyName ? { counterpartyName: form.counterpartyName } : {}),
          paymentDate: form.paymentDate,
          ...(form.notes ? { notes: form.notes } : {}),
        },
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['finance'] });
      onClose();
      setForm({
        direction: 'outgoing',
        method: 'bank_transfer',
        amount: '',
        referenceNumber: '',
        counterpartyName: '',
        paymentDate: new Date().toISOString().split('T')[0],
        notes: '',
      });
    },
  });

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Record Payment</DialogTitle>
          <DialogDescription>Record a payment. This immediately creates a ledger entry.</DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label>Direction</Label>
              <Select value={form.direction} onValueChange={(v) => setForm({ ...form, direction: v as 'outgoing' | 'incoming' })}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="outgoing">Outgoing (we paid)</SelectItem>
                  <SelectItem value="incoming">Incoming (we received)</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>Method</Label>
              <Select value={form.method} onValueChange={(v) => setForm({ ...form, method: v })}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {PAYMENT_METHODS.map((m) => (
                    <SelectItem key={m} value={m}>{m.replace(/_/g, ' ')}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label>Amount</Label>
              <Input type="number" value={form.amount} onChange={(e) => setForm({ ...form, amount: e.target.value })} placeholder="0.00" />
            </div>
            <div>
              <Label>Reference #</Label>
              <Input value={form.referenceNumber} onChange={(e) => setForm({ ...form, referenceNumber: e.target.value })} placeholder="UTR, Txn ID" />
            </div>
          </div>
          <div>
            <Label>Counterparty</Label>
            <Input value={form.counterpartyName} onChange={(e) => setForm({ ...form, counterpartyName: e.target.value })} placeholder="Name" />
          </div>
          <div>
            <Label>Payment Date</Label>
            <Input type="date" value={form.paymentDate} onChange={(e) => setForm({ ...form, paymentDate: e.target.value })} />
          </div>
          <div>
            <Label>Notes</Label>
            <Textarea value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} rows={2} />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button
            onClick={() => mutation.mutate()}
            disabled={!form.amount || Number(form.amount) <= 0 || mutation.isPending}
          >
            {mutation.isPending ? <Loader2 className="h-4 w-4 animate-spin mr-1" /> : null}
            Record Payment
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ============================================
// MANUAL LEDGER ENTRY MODAL
// ============================================

interface ManualLine {
  accountCode: string;
  debit: string;
  credit: string;
  description: string;
}

function ManualEntryModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const queryClient = useQueryClient();
  const createFn = useServerFn(createManualEntry);

  const [description, setDescription] = useState('');
  const [entryDate, setEntryDate] = useState(new Date().toISOString().split('T')[0]);
  const [notes, setNotes] = useState('');
  const [lines, setLines] = useState<ManualLine[]>([
    { accountCode: '', debit: '', credit: '', description: '' },
    { accountCode: '', debit: '', credit: '', description: '' },
  ]);

  const updateLine = (idx: number, field: keyof ManualLine, value: string) => {
    const updated = [...lines];
    updated[idx] = { ...updated[idx], [field]: value };
    setLines(updated);
  };

  const addLine = () => setLines([...lines, { accountCode: '', debit: '', credit: '', description: '' }]);
  const removeLine = (idx: number) => {
    if (lines.length <= 2) return;
    setLines(lines.filter((_, i) => i !== idx));
  };

  const totalDebit = lines.reduce((s, l) => s + (Number(l.debit) || 0), 0);
  const totalCredit = lines.reduce((s, l) => s + (Number(l.credit) || 0), 0);
  const isBalanced = Math.abs(totalDebit - totalCredit) < 0.01 && totalDebit > 0;

  const mutation = useMutation({
    mutationFn: () =>
      createFn({
        data: {
          entryDate,
          description,
          ...(notes ? { notes } : {}),
          lines: lines
            .filter((l) => l.accountCode && (Number(l.debit) > 0 || Number(l.credit) > 0))
            .map((l) => ({
              accountCode: l.accountCode,
              ...(Number(l.debit) > 0 ? { debit: Number(l.debit) } : {}),
              ...(Number(l.credit) > 0 ? { credit: Number(l.credit) } : {}),
              ...(l.description ? { description: l.description } : {}),
            })),
        },
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['finance'] });
      onClose();
    },
  });

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>Manual Journal Entry</DialogTitle>
          <DialogDescription>Record a balanced double-entry. Debits must equal credits.</DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label>Description</Label>
              <Input value={description} onChange={(e) => setDescription(e.target.value)} placeholder="What's this for?" />
            </div>
            <div>
              <Label>Date</Label>
              <Input type="date" value={entryDate} onChange={(e) => setEntryDate(e.target.value)} />
            </div>
          </div>

          <div className="border rounded-lg p-3 space-y-2">
            <div className="grid grid-cols-[1fr_100px_100px_1fr_32px] gap-2 text-xs font-medium text-muted-foreground">
              <span>Account</span>
              <span className="text-right">Debit</span>
              <span className="text-right">Credit</span>
              <span>Note</span>
              <span />
            </div>
            {lines.map((line, idx) => (
              <div key={idx} className="grid grid-cols-[1fr_100px_100px_1fr_32px] gap-2">
                <Select value={line.accountCode || 'none'} onValueChange={(v) => updateLine(idx, 'accountCode', v === 'none' ? '' : v)}>
                  <SelectTrigger className="h-8 text-xs"><SelectValue placeholder="Account" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none" disabled>Select account</SelectItem>
                    {CHART_OF_ACCOUNTS.map((a) => (
                      <SelectItem key={a.code} value={a.code}>{a.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Input className="h-8 text-xs text-right" type="number" placeholder="0" value={line.debit} onChange={(e) => updateLine(idx, 'debit', e.target.value)} />
                <Input className="h-8 text-xs text-right" type="number" placeholder="0" value={line.credit} onChange={(e) => updateLine(idx, 'credit', e.target.value)} />
                <Input className="h-8 text-xs" placeholder="Note" value={line.description} onChange={(e) => updateLine(idx, 'description', e.target.value)} />
                <Button variant="ghost" size="sm" className="h-8 w-8 p-0" onClick={() => removeLine(idx)} disabled={lines.length <= 2}>
                  <X className="h-3 w-3" />
                </Button>
              </div>
            ))}
            <div className="flex items-center justify-between pt-2 border-t">
              <Button variant="outline" size="sm" onClick={addLine}>+ Add Line</Button>
              <div className="flex items-center gap-4 text-sm font-mono">
                <span>Dr: {formatCurrency(totalDebit)}</span>
                <span>Cr: {formatCurrency(totalCredit)}</span>
                {!isBalanced && totalDebit > 0 && (
                  <span className="text-red-500 flex items-center gap-1">
                    <AlertCircle className="h-3 w-3" /> Unbalanced
                  </span>
                )}
                {isBalanced && <span className="text-green-600"><Check className="h-4 w-4" /></span>}
              </div>
            </div>
          </div>

          <div>
            <Label>Notes</Label>
            <Textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button
            onClick={() => mutation.mutate()}
            disabled={!description || !isBalanced || mutation.isPending}
          >
            {mutation.isPending ? <Loader2 className="h-4 w-4 animate-spin mr-1" /> : null}
            Create Entry
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ============================================
// SHARED COMPONENTS
// ============================================

function StatusBadge({ status }: { status: string }) {
  const colors: Record<string, string> = {
    draft: 'bg-gray-100 text-gray-700',
    confirmed: 'bg-blue-100 text-blue-700',
    partially_paid: 'bg-amber-100 text-amber-700',
    paid: 'bg-green-100 text-green-700',
    cancelled: 'bg-red-100 text-red-700',
  };
  return (
    <span className={`inline-flex px-2 py-0.5 rounded-full text-xs font-medium ${colors[status] ?? 'bg-gray-100 text-gray-700'}`}>
      {status.replace(/_/g, ' ')}
    </span>
  );
}

function Pagination({ page, total, limit, onPageChange }: {
  page: number;
  total: number;
  limit: number;
  onPageChange: (page: number) => void;
}) {
  const totalPages = Math.ceil(total / limit);
  if (totalPages <= 1) return null;

  return (
    <div className="flex items-center justify-between text-sm">
      <span className="text-muted-foreground">
        {total} {total === 1 ? 'result' : 'results'}
      </span>
      <div className="flex items-center gap-2">
        <Button variant="outline" size="sm" onClick={() => onPageChange(page - 1)} disabled={page <= 1}>
          <ChevronLeft className="h-4 w-4" />
        </Button>
        <span>
          Page {page} of {totalPages}
        </span>
        <Button variant="outline" size="sm" onClick={() => onPageChange(page + 1)} disabled={page >= totalPages}>
          <ChevronRight className="h-4 w-4" />
        </Button>
      </div>
    </div>
  );
}

function LoadingState() {
  return (
    <div className="flex items-center justify-center p-8 text-muted-foreground">
      <Loader2 className="h-5 w-5 animate-spin mr-2" />
      Loading...
    </div>
  );
}

// ============================================
// HELPERS
// ============================================

function formatCurrency(amount: number): string {
  return new Intl.NumberFormat('en-IN', {
    style: 'currency',
    currency: 'INR',
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  }).format(amount);
}
