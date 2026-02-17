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
  createInvoice,
  confirmInvoice,
  cancelInvoice,
  createFinancePayment,
  findUnmatchedPayments,
  getMonthlyPnl,
  getPnlAccountDetail,
  getFinanceAlerts,
  listBankTransactions,
  listTransactionTypes,
  listFinanceParties,
  updateFinanceParty,
  createFinanceParty,
  getPartyBalances,
  getTransactionType,
  createTransactionType,
  updateTransactionType,
  deleteTransactionType,
  searchCounterparties,
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
  Check, X, ChevronLeft, ChevronRight, Loader2, AlertCircle,
  ExternalLink, CloudUpload, Link2, Download, Upload, ArrowLeft,
  Pencil, Search, Trash2, History, AlertTriangle, Eye,
} from 'lucide-react';
import {
  type FinanceSearchParams,
  INVOICE_CATEGORIES,
  INVOICE_STATUSES,
  PAYMENT_METHODS,
  CHART_OF_ACCOUNTS,
  getCategoryLabel,
  BANK_TYPES,
  BANK_TXN_FILTER_OPTIONS,
  getBankLabel,
  getBankStatusLabel,
  isBankTxnPending,
  PARTY_CATEGORIES,
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
          <TabsTrigger value="pnl">P&L</TabsTrigger>
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

// ============================================
// DASHBOARD TAB
// ============================================

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

  const summary = data?.success ? data.summary : null;

  if (isLoading) return <LoadingState />;
  if (!data?.success || !summary) return <div className="text-muted-foreground">Failed to load summary</div>;

  const alerts = alertsData?.success ? alertsData.alerts : [];
  const errorCount = alertsData?.success ? alertsData.counts.errors : 0;
  const warningCount = alertsData?.success ? alertsData.counts.warnings : 0;

  const fmtDate = (d: string | Date | null) => {
    if (!d) return '';
    return `as of ${new Date(d).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })}`;
  };

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
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-4">
        <SummaryCard
          label="Accounts Payable"
          value={summary.totalPayable}
          subtitle={`${summary.openPayableInvoices} open invoices`}
          color="text-red-700"
        />
        <SummaryCard
          label="Accounts Receivable"
          value={summary.totalReceivable}
          subtitle={`${summary.openReceivableInvoices} open invoices`}
          color="text-green-700"
        />
        <SummaryCard
          label="HDFC Bank"
          value={summary.hdfcBalance}
          subtitle={fmtDate(summary.hdfcBalanceDate)}
          color="text-blue-700"
        />
        <SummaryCard
          label="RazorpayX"
          value={summary.rpxBalance}
          subtitle={fmtDate(summary.rpxBalanceDate)}
          color="text-blue-600"
        />
        {summary.suspenseBalance > 0 && (
          <SummaryCard
            label="Suspense"
            value={summary.suspenseBalance}
            subtitle="needs reclassifying"
            color="text-amber-700"
          />
        )}
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
  const [showUploadDialog, setShowUploadDialog] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  // For the confirm dialog — stores the invoice being confirmed
  const [confirmingInvoice, setConfirmingInvoice] = useState<{
    id: string; type: string; totalAmount: number;
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
      const names = missingBank.map((inv) => inv.party?.name ?? 'Unknown').join(', ');
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
          <Button variant="outline" onClick={() => setShowUploadDialog(true)}>
            <Upload className="h-4 w-4 mr-1" /> Upload Invoice
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
                        '—'}
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

      {/* Upload Invoice Dialog */}
      <UploadInvoiceDialog
        open={showUploadDialog}
        onClose={() => setShowUploadDialog(false)}
        onSuccess={() => queryClient.invalidateQueries({ queryKey: ['finance'] })}
      />

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
                  <th className="text-left p-3 font-medium">Date</th>
                  <th className="text-left p-3 font-medium">Payment</th>
                  <th className="text-left p-3 font-medium">Party</th>
                  <th className="text-right p-3 font-medium">Amount</th>
                  <th className="text-left p-3 font-medium">Category</th>
                  <th className="text-left p-3 font-medium">GST / TDS</th>
                  <th className="text-left p-3 font-medium">Invoice</th>
                  <th className="text-left p-3 font-medium">Period</th>
                  <th className="text-center p-3 font-medium">Doc</th>
                </tr>
              </thead>
              <tbody>
                {data?.payments?.map((pmt) => {
                  const partyName = pmt.party?.name ??
                    (pmt.customer ? [pmt.customer.firstName, pmt.customer.lastName].filter(Boolean).join(' ') || pmt.customer.email : null) ??
                    '—';
                  const category = pmt.party?.category ?? pmt.bankTransaction?.category ?? null;
                  const inv = pmt.allocations?.[0]?.invoice;
                  const gstRate = pmt.party?.transactionType?.defaultGstRate;
                  const gstAmt = gstRate ? Math.round(pmt.amount * gstRate / (100 + gstRate)) : null;
                  const hasTds = !!pmt.party?.tdsApplicable;
                  const tdsRate = pmt.party?.tdsRate;
                  const tdsAmt = hasTds && tdsRate ? Math.round(pmt.amount * tdsRate / 100) : null;

                  // Extract order info from refund rawData notes
                  let refundOrderInfo: string | null = null;
                  if (pmt.bankTransaction?.category === 'refund' && pmt.bankTransaction.rawData) {
                    try {
                      const raw = pmt.bankTransaction.rawData as Record<string, unknown>;
                      const notes = (raw.notes ?? raw.Notes) as Record<string, string> | string | undefined;
                      const notesStr = typeof notes === 'string' ? notes : notes ? Object.values(notes).join(' ') : '';
                      const orderMatch = notesStr.match(/(COH\d+|#\d{4,})/i);
                      if (orderMatch) refundOrderInfo = orderMatch[0];
                    } catch { /* ignore parse errors */ }
                  }

                  return (
                    <tr key={pmt.id} className="border-t hover:bg-muted/30">
                      <td className="p-3 text-xs whitespace-nowrap">{new Date(pmt.paymentDate).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: '2-digit' })}</td>
                      <td className="p-3">
                        <div className="flex items-center gap-1.5">
                          <span className={pmt.direction === 'incoming' ? 'text-green-600' : 'text-red-500'}>
                            {pmt.direction === 'incoming' ? <ArrowDownLeft className="h-3.5 w-3.5" /> : <ArrowUpRight className="h-3.5 w-3.5" />}
                          </span>
                          <span className="text-xs">{pmt.method.replace(/_/g, ' ')}</span>
                        </div>
                        {pmt.referenceNumber && (
                          <div className="font-mono text-[10px] text-muted-foreground mt-0.5 max-w-[180px] truncate" title={pmt.referenceNumber}>{pmt.referenceNumber}</div>
                        )}
                      </td>
                      <td className="p-3 max-w-[180px]">
                        <div className="truncate font-medium text-xs" title={typeof partyName === 'string' ? partyName : ''}>{partyName}</div>
                        {refundOrderInfo && (
                          <div className="text-[10px] text-muted-foreground mt-0.5">Order {refundOrderInfo}</div>
                        )}
                      </td>
                      <td className="p-3 text-right font-mono whitespace-nowrap">{formatCurrency(pmt.amount)}</td>
                      <td className="p-3">
                        {category ? (
                          <span className="inline-block bg-muted px-1.5 py-0.5 rounded text-[11px] capitalize">{getCategoryLabel(category)}</span>
                        ) : (
                          <span className="text-muted-foreground text-xs">—</span>
                        )}
                      </td>
                      <td className="p-3 text-xs">
                        <div className="flex flex-col gap-0.5">
                          {gstRate ? (
                            <span className="text-green-600">GST {gstRate}%{gstAmt ? ` (${formatCurrency(gstAmt)})` : ''}</span>
                          ) : pmt.party?.gstin ? (
                            <span className="text-green-600">GST</span>
                          ) : (
                            <span className="text-muted-foreground">No GST</span>
                          )}
                          {hasTds ? (
                            <span className="text-amber-600">TDS {tdsRate}%{tdsAmt ? ` (${formatCurrency(tdsAmt)})` : ''}</span>
                          ) : null}
                        </div>
                      </td>
                      <td className="p-3 text-xs">
                        {inv ? (
                          <div>
                            <div className="font-medium">{inv.invoiceNumber ?? 'Linked'}</div>
                            {inv.invoiceDate && (
                              <div className="text-muted-foreground text-[10px]">{new Date(inv.invoiceDate).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })}</div>
                            )}
                          </div>
                        ) : (
                          <span className={pmt.unmatchedAmount > 0.01 ? 'text-amber-500' : 'text-muted-foreground'}>
                            {pmt.unmatchedAmount > 0.01 ? 'None' : '—'}
                          </span>
                        )}
                      </td>
                      <td className="p-3 text-xs text-muted-foreground">{inv?.billingPeriod ?? '—'}</td>
                      <td className="p-3 text-center">
                        {pmt.driveUrl ? (
                          <a href={pmt.driveUrl} target="_blank" rel="noopener noreferrer" className="text-blue-600 hover:text-blue-800" title={pmt.fileName ?? 'View on Drive'}>
                            <ExternalLink className="h-3.5 w-3.5 inline" />
                          </a>
                        ) : pmt.fileName ? (
                          <span className="text-muted-foreground text-xs" title={pmt.fileName}>Local</span>
                        ) : (
                          <span className="text-muted-foreground text-xs">—</span>
                        )}
                      </td>
                    </tr>
                  );
                })}
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
              {isDrilling && <AccountDrilldown period={period} category={l.code} fmt={fmt} />}
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
        <div className="text-muted-foreground text-center py-8">No P&L data found</div>
      )}
    </div>
  );
}

// Lazy-loaded drill-down: shows invoices for one category+period
function AccountDrilldown({ period, category, fmt }: {
  period: string;
  category: string;
  fmt: (n: number) => string;
}) {
  const detailFn = useServerFn(getPnlAccountDetail);
  const [expandedCat, setExpandedCat] = useState<Set<string>>(new Set());

  const { data, isLoading } = useQuery({
    queryKey: ['finance', 'pnl-detail', period, category],
    queryFn: () => detailFn({ data: { period, category } }),
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
// BANK IMPORT TAB
// ============================================

function BankImportTab({ search }: { search: FinanceSearchParams }) {
  const navigate = useNavigate();
  const isImportView = search.bankView === 'import';

  const updateSearch = useCallback(
    (updates: Partial<FinanceSearchParams>) => {
      navigate({ to: '/finance', search: { ...search, ...updates }, replace: true });
    },
    [navigate, search]
  );

  if (isImportView) {
    return <BankImportView onBack={() => updateSearch({ bankView: undefined })} />;
  }

  return <BankTransactionList search={search} updateSearch={updateSearch} />;
}

// ---- Transaction List View ----

function BankTransactionList({ search, updateSearch }: {
  search: FinanceSearchParams;
  updateSearch: (updates: Partial<FinanceSearchParams>) => void;
}) {
  const listFn = useServerFn(listBankTransactions);
  const queryClient = useQueryClient();
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [batchLoading, setBatchLoading] = useState(false);

  const bank = search.bankFilter && search.bankFilter !== 'all' ? search.bankFilter : undefined;
  const status = search.bankStatus && search.bankStatus !== 'all' ? search.bankStatus : undefined;

  const { data, isLoading } = useQuery({
    queryKey: ['finance', 'bank-transactions', bank, status, search.search, search.page],
    queryFn: () =>
      listFn({
        data: {
          ...(bank ? { bank } : {}),
          ...(status ? { status } : {}),
          ...(search.search ? { search: search.search } : {}),
          page: search.page,
          limit: search.limit,
        },
      }),
  });

  // Clear selection when filters/page change
  const prevKeyRef = useRef('');
  const filterKey = `${bank}-${status}-${search.search}-${search.page}`;
  if (filterKey !== prevKeyRef.current) {
    prevKeyRef.current = filterKey;
    if (selectedIds.size > 0) setSelectedIds(new Set());
  }

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ['finance', 'bank-transactions'] });
    setSelectedIds(new Set());
  };

  const handleSkip = async (txnId: string) => {
    await fetch('/api/bank-import/skip', {
      method: 'POST', credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ txnId }),
    });
    invalidate();
    setExpandedId(null);
  };

  const handleUnskip = async (txnId: string) => {
    await fetch('/api/bank-import/unskip', {
      method: 'POST', credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ txnId }),
    });
    invalidate();
    setExpandedId(null);
  };

  const handleDelete = async (txnId: string) => {
    if (!confirm('Delete this transaction?')) return;
    await fetch(`/api/bank-import/${txnId}`, {
      method: 'DELETE', credentials: 'include',
    });
    invalidate();
    setExpandedId(null);
  };

  const handleConfirm = async (txnId: string) => {
    const res = await fetch('/api/bank-import/confirm', {
      method: 'POST', credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ txnId }),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({ error: 'Failed to confirm' }));
      alert(err.error || 'Failed to confirm');
      return;
    }
    invalidate();
    setExpandedId(null);
  };

  const handleBatchConfirm = async () => {
    if (selectedIds.size === 0) return;
    setBatchLoading(true);
    try {
      await fetch('/api/bank-import/confirm-batch', {
        method: 'POST', credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ txnIds: [...selectedIds] }),
      });
      invalidate();
    } finally {
      setBatchLoading(false);
    }
  };

  const handleBatchSkip = async () => {
    if (selectedIds.size === 0) return;
    setBatchLoading(true);
    try {
      await fetch('/api/bank-import/skip-batch', {
        method: 'POST', credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ txnIds: [...selectedIds] }),
      });
      invalidate();
    } finally {
      setBatchLoading(false);
    }
  };

  const pendingTxns = data?.transactions?.filter((t) => isBankTxnPending(t.status)) ?? [];
  const allPendingSelected = pendingTxns.length > 0 && pendingTxns.every((t) => selectedIds.has(t.id));

  const toggleSelect = (id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const toggleSelectAll = () => {
    if (allPendingSelected) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(pendingTxns.map((t) => t.id)));
    }
  };

  return (
    <div className="space-y-4">
      {/* Filters */}
      <div className="flex flex-wrap items-center gap-2">
        <Select value={search.bankFilter ?? 'all'} onValueChange={(v) => updateSearch({ bankFilter: v as any, page: 1 })}>
          <SelectTrigger className="w-[150px]"><SelectValue placeholder="Bank" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Banks</SelectItem>
            {BANK_TYPES.map((b) => (
              <SelectItem key={b} value={b}>{getBankLabel(b)}</SelectItem>
            ))}
          </SelectContent>
        </Select>

        <Select value={search.bankStatus ?? 'all'} onValueChange={(v) => updateSearch({ bankStatus: v as any, page: 1 })}>
          <SelectTrigger className="w-[160px]"><SelectValue placeholder="Status" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All</SelectItem>
            {BANK_TXN_FILTER_OPTIONS.map((s) => (
              <SelectItem key={s} value={s} className="capitalize">{s.charAt(0).toUpperCase() + s.slice(1)}</SelectItem>
            ))}
          </SelectContent>
        </Select>

        <Input
          placeholder="Search narration..."
          value={search.search ?? ''}
          onChange={(e) => updateSearch({ search: e.target.value || undefined, page: 1 })}
          className="w-[200px]"
        />

        <div className="ml-auto">
          <Button onClick={() => updateSearch({ bankView: 'import' })}>
            <Upload className="h-4 w-4 mr-1" /> Import New
          </Button>
        </div>
      </div>

      {/* Batch action bar */}
      {selectedIds.size > 0 && (
        <div className="flex items-center gap-3 p-2 px-3 bg-blue-50 border border-blue-200 rounded-lg text-sm">
          <span className="font-medium">{selectedIds.size} selected</span>
          <Button size="sm" onClick={handleBatchConfirm} disabled={batchLoading}>
            {batchLoading ? <Loader2 className="h-3 w-3 animate-spin mr-1" /> : <Check className="h-3 w-3 mr-1" />}
            Confirm Selected
          </Button>
          <Button size="sm" variant="outline" onClick={handleBatchSkip} disabled={batchLoading}>
            Skip Selected
          </Button>
          <button type="button" className="ml-auto text-xs text-muted-foreground hover:text-foreground" onClick={() => setSelectedIds(new Set())}>
            Clear
          </button>
        </div>
      )}

      {/* Table */}
      {isLoading ? (
        <LoadingState />
      ) : (
        <>
          <div className="border rounded-lg overflow-hidden">
            <table className="w-full text-sm">
              <thead className="bg-muted/50">
                <tr>
                  <th className="p-3 w-8">
                    {pendingTxns.length > 0 && (
                      <input
                        type="checkbox"
                        checked={allPendingSelected}
                        onChange={toggleSelectAll}
                        className="rounded border-gray-300"
                      />
                    )}
                  </th>
                  <th className="text-left p-3 font-medium">Date</th>
                  <th className="text-left p-3 font-medium">Narration</th>
                  <th className="text-right p-3 font-medium">Amount</th>
                  <th className="text-left p-3 font-medium">Party</th>
                  <th className="text-left p-3 font-medium">Bank</th>
                  <th className="text-left p-3 font-medium">Status</th>
                  <th className="text-left p-3 font-medium w-28">Actions</th>
                </tr>
              </thead>
              <tbody>
                {data?.transactions?.map((txn) => {
                  const isExpanded = expandedId === txn.id;
                  const isPending = isBankTxnPending(txn.status);
                  const hasAccounts = !!txn.debitAccountCode && !!txn.creditAccountCode;
                  return (
                    <Fragment key={txn.id}>
                      <tr
                        className={`border-t hover:bg-muted/30 ${isExpanded ? 'bg-muted/20' : ''} ${txn.status === 'skipped' ? 'opacity-50' : ''}`}
                      >
                        <td className="p-3" onClick={(e) => e.stopPropagation()}>
                          {isPending && (
                            <input
                              type="checkbox"
                              checked={selectedIds.has(txn.id)}
                              onChange={() => toggleSelect(txn.id)}
                              className="rounded border-gray-300"
                            />
                          )}
                        </td>
                        <td className="p-3 text-xs text-muted-foreground whitespace-nowrap">
                          {new Date(txn.txnDate).toLocaleDateString('en-IN')}
                        </td>
                        <td className="p-3 text-xs max-w-[250px] truncate" title={txn.narration ?? ''}>
                          {txn.narration ?? '—'}
                        </td>
                        <td className={`p-3 text-right font-mono text-xs ${txn.direction === 'credit' ? 'text-green-600' : ''}`}>
                          {txn.direction === 'credit' ? '+' : ''}{formatCurrency(txn.amount)}
                        </td>
                        <td className="p-3 text-xs">
                          {txn.party?.name ?? txn.counterpartyName ?? <span className="text-amber-600">—</span>}
                        </td>
                        <td className="p-3 text-xs">{getBankLabel(txn.bank)}</td>
                        <td className="p-3"><BankStatusBadge status={txn.status} /></td>
                        <td className="p-3" onClick={(e) => e.stopPropagation()}>
                          <div className="flex items-center gap-1">
                            {isPending && (
                              <>
                                <button type="button" className="text-xs text-blue-600 hover:text-blue-800" onClick={() => setExpandedId(isExpanded ? null : txn.id)} title="Edit">
                                  <Pencil className="h-3.5 w-3.5" />
                                </button>
                                <button
                                  type="button"
                                  className="text-xs text-green-600 hover:text-green-800 disabled:opacity-30 disabled:cursor-not-allowed"
                                  onClick={() => handleConfirm(txn.id)}
                                  disabled={!hasAccounts}
                                  title={hasAccounts ? 'Confirm' : 'Set accounts first'}
                                >
                                  <Check className="h-3.5 w-3.5" />
                                </button>
                              </>
                            )}
                            {txn.status === 'skipped' ? (
                              <button type="button" className="text-xs text-blue-600 hover:text-blue-800" onClick={() => handleUnskip(txn.id)} title="Restore">
                                <History className="h-3.5 w-3.5" />
                              </button>
                            ) : isPending ? (
                              <button type="button" className="text-xs text-amber-600 hover:text-amber-800" onClick={() => handleSkip(txn.id)} title="Skip">
                                <X className="h-3.5 w-3.5" />
                              </button>
                            ) : null}
                            {(isPending || txn.status === 'skipped') && (
                              <button type="button" className="text-xs text-red-500 hover:text-red-700" onClick={() => handleDelete(txn.id)} title="Delete">
                                <Trash2 className="h-3.5 w-3.5" />
                              </button>
                            )}
                          </div>
                        </td>
                      </tr>
                      {isExpanded && (
                        <tr className="border-t bg-muted/10">
                          <td colSpan={8} className="p-3">
                            <BankTxnEditRow
                              txn={txn}
                              onSaved={() => { invalidate(); setExpandedId(null); }}
                              onClose={() => setExpandedId(null)}
                            />
                          </td>
                        </tr>
                      )}
                    </Fragment>
                  );
                })}
                {(!data?.transactions || data.transactions.length === 0) && (
                  <tr><td colSpan={8} className="p-8 text-center text-muted-foreground">No transactions found</td></tr>
                )}
              </tbody>
            </table>
          </div>

          <Pagination page={search.page} total={data?.total ?? 0} limit={search.limit} onPageChange={(p) => updateSearch({ page: p })} />
        </>
      )}
    </div>
  );
}

// ---- Inline Edit Row for Bank Transaction ----

function BankTxnEditRow({ txn, onSaved, onClose }: {
  txn: { id: string; partyId?: string | null; party?: { id: string; name: string } | null; debitAccountCode: string | null; creditAccountCode: string | null; category: string | null; narration: string | null; reference?: string | null; counterpartyName?: string | null; direction: string; bank: string };
  onSaved: () => void;
  onClose: () => void;
}) {
  const [debitAccount, setDebitAccount] = useState(txn.debitAccountCode ?? '');
  const [creditAccount, setCreditAccount] = useState(txn.creditAccountCode ?? '');
  const [category, setCategory] = useState(txn.category ?? '');
  const [saving, setSaving] = useState(false);
  const searchFn = useServerFn(searchCounterparties);
  const [partyQuery, setPartyQuery] = useState('');
  const [partyOpen, setPartyOpen] = useState(false);
  const [selectedParty, setSelectedParty] = useState<{ id: string; name: string } | null>(txn.party ?? null);

  const { data: partyResults } = useQuery({
    queryKey: ['finance', 'party-search', partyQuery],
    queryFn: () => searchFn({ data: { query: partyQuery, type: 'party' } }),
    enabled: partyQuery.length >= 2,
  });

  const parties = partyResults?.success ? partyResults.results : [];

  const handlePartySelect = (party: { id: string; name: string }) => {
    setSelectedParty(party);
    setPartyOpen(false);
    setPartyQuery('');
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      const body: Record<string, unknown> = { txnId: txn.id };

      // Party change
      if (selectedParty?.id !== (txn.party?.id ?? txn.partyId)) {
        body.partyId = selectedParty?.id ?? null;
      }

      // Account overrides (only if changed)
      if (debitAccount !== (txn.debitAccountCode ?? '')) body.debitAccountCode = debitAccount || null;
      if (creditAccount !== (txn.creditAccountCode ?? '')) body.creditAccountCode = creditAccount || null;
      if (category !== (txn.category ?? '')) body.category = category || null;

      if (Object.keys(body).length <= 1) { onClose(); return; } // Nothing changed

      const res = await fetch('/api/bank-import/update', {
        method: 'PATCH', credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (res.ok) onSaved();
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 gap-3 text-xs">
        {/* Full narration */}
        <div className="col-span-2">
          <span className="text-muted-foreground">Narration:</span>
          <p className="mt-0.5">{txn.narration ?? '—'}</p>
          {txn.reference && <p className="text-muted-foreground mt-0.5">Ref: {txn.reference}</p>}
        </div>

        {/* Party */}
        <div>
          <Label className="text-xs">Party</Label>
          <div className="relative mt-1">
            {selectedParty ? (
              <div className="flex items-center gap-2">
                <span className="text-sm">{selectedParty.name}</span>
                <button type="button" className="text-xs text-red-500 hover:text-red-700" onClick={() => setSelectedParty(null)}>
                  <X className="h-3 w-3" />
                </button>
              </div>
            ) : (
              <>
                <Input
                  value={partyQuery}
                  onChange={(e) => { setPartyQuery(e.target.value); setPartyOpen(true); }}
                  placeholder="Search party..."
                  className="h-8 text-xs"
                  onFocus={() => setPartyOpen(true)}
                />
                {partyOpen && partyQuery.length >= 2 && parties.length > 0 && (
                  <div className="absolute z-20 top-9 left-0 w-full bg-white border rounded-md shadow-lg max-h-[150px] overflow-y-auto">
                    {parties.map((p) => (
                      <button key={p.id} type="button" className="block w-full text-left px-3 py-1.5 text-xs hover:bg-muted/50" onClick={() => handlePartySelect(p)}>
                        {p.name}
                      </button>
                    ))}
                  </div>
                )}
              </>
            )}
          </div>
        </div>

        {/* Category */}
        <div>
          <Label className="text-xs">Category</Label>
          <Input value={category} onChange={(e) => setCategory(e.target.value)} className="h-8 text-xs mt-1" placeholder="e.g. vendor, service" />
        </div>

        {/* Debit Account */}
        <div>
          <Label className="text-xs">Debit Account</Label>
          <Select value={debitAccount} onValueChange={setDebitAccount}>
            <SelectTrigger className="h-8 text-xs mt-1"><SelectValue placeholder="Select..." /></SelectTrigger>
            <SelectContent>
              {CHART_OF_ACCOUNTS.map((a) => (
                <SelectItem key={a.code} value={a.code} className="text-xs">{a.name}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        {/* Credit Account */}
        <div>
          <Label className="text-xs">Credit Account</Label>
          <Select value={creditAccount} onValueChange={setCreditAccount}>
            <SelectTrigger className="h-8 text-xs mt-1"><SelectValue placeholder="Select..." /></SelectTrigger>
            <SelectContent>
              {CHART_OF_ACCOUNTS.map((a) => (
                <SelectItem key={a.code} value={a.code} className="text-xs">{a.name}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      <div className="flex gap-2">
        <Button size="sm" onClick={handleSave} disabled={saving}>
          {saving ? <Loader2 className="h-3 w-3 animate-spin mr-1" /> : <Check className="h-3 w-3 mr-1" />}
          Save
        </Button>
        <Button size="sm" variant="outline" onClick={onClose}>Cancel</Button>
      </div>
    </div>
  );
}

function BankStatusBadge({ status }: { status: string }) {
  const label = getBankStatusLabel(status);
  const colorMap: Record<string, string> = {
    Pending: 'bg-gray-100 text-gray-700',
    Confirmed: 'bg-green-100 text-green-700',
    Skipped: 'bg-yellow-100 text-yellow-700',
  };
  return (
    <span className={`inline-flex px-2 py-0.5 rounded-full text-xs font-medium ${colorMap[label] ?? 'bg-gray-100 text-gray-700'}`}>
      {label}
    </span>
  );
}

// ---- Import View (2-step: upload → preview → import → done) ----

type PreviewRow = {
  txnDate: string;
  narration: string | null;
  amount: number;
  direction: string;
  reference: string | null;
  closingBalance?: number;
  isDuplicate: boolean;
  partyName: string | null;
  partyId: string | null;
  category: string | null;
  debitAccountCode: string;
  creditAccountCode: string;
};

interface BankPreviewState {
  bank: string;
  totalRows: number;
  newRows: number;
  duplicateRows: number;
  balanceMatched?: boolean;
  partiesMatched: number;
  partiesUnmatched: number;
  rows: PreviewRow[];
}

function BankImportView({ onBack }: { onBack: () => void }) {
  const [step, setStep] = useState<'upload' | 'preview' | 'done'>('upload');
  const [selectedBank, setSelectedBank] = useState<string>('hdfc');
  const [file, setFile] = useState<File | null>(null);
  const [uploading, setUploading] = useState(false);
  const [bankPreview, setBankPreview] = useState<BankPreviewState | null>(null);
  const [importing, setImporting] = useState(false);
  const [importResult, setImportResult] = useState<{ newRows: number; skippedRows: number } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const queryClient = useQueryClient();

  // Step 1: Upload CSV → preview (no DB write)
  const handlePreview = async () => {
    if (!file) return;
    setUploading(true);
    setError(null);
    try {
      const formData = new FormData();
      formData.append('file', file);
      formData.append('bank', selectedBank);

      const res = await fetch('/api/bank-import/preview', {
        method: 'POST',
        credentials: 'include',
        body: formData,
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || 'Preview failed');

      setBankPreview(json);
      setStep('preview');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Preview failed');
    } finally {
      setUploading(false);
    }
  };

  // Step 2: Confirm → import to DB
  const handleImport = async () => {
    if (!file) return;
    setImporting(true);
    setError(null);
    try {
      const formData = new FormData();
      formData.append('file', file);
      formData.append('bank', selectedBank);

      const res = await fetch('/api/bank-import/upload', {
        method: 'POST',
        credentials: 'include',
        body: formData,
      });
      const json = await res.json();
      if (!res.ok || !json.success) throw new Error(json.error || 'Import failed');

      setImportResult({ newRows: json.result.newRows, skippedRows: json.result.skippedRows });
      setStep('done');
      queryClient.invalidateQueries({ queryKey: ['finance', 'bank-transactions'] });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Import failed');
    } finally {
      setImporting(false);
    }
  };

  const previewNewCount = bankPreview?.rows.filter(r => !r.isDuplicate).length ?? 0;

  return (
    <div className="space-y-6 max-w-3xl">
      <div className="flex items-center gap-3">
        <Button variant="ghost" size="sm" onClick={onBack}>
          <ArrowLeft className="h-4 w-4 mr-1" /> Back
        </Button>
        <h3 className="text-lg font-semibold">Import Bank Statement</h3>
      </div>

      {error && (
        <div className="border border-red-300 bg-red-50 text-red-700 rounded-lg p-3 text-sm flex items-center gap-2">
          <AlertCircle className="h-4 w-4 shrink-0" /> {error}
        </div>
      )}

      {/* Step 1: Upload */}
      {step === 'upload' && (
        <div className="border rounded-lg p-4 space-y-3">
          <div className="flex items-center gap-3">
            <Select value={selectedBank} onValueChange={setSelectedBank}>
              <SelectTrigger className="w-[160px]"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="hdfc">HDFC Bank</SelectItem>
                <SelectItem value="razorpayx">RazorpayX</SelectItem>
              </SelectContent>
            </Select>

            <label className="flex-1 border-2 border-dashed rounded-lg p-4 text-center cursor-pointer hover:bg-muted/30 transition-colors">
              <input
                type="file"
                accept=".csv"
                className="hidden"
                onChange={(e) => setFile(e.target.files?.[0] ?? null)}
              />
              {file ? (
                <span className="text-sm">{file.name} ({(file.size / 1024).toFixed(0)} KB)</span>
              ) : (
                <span className="text-sm text-muted-foreground">Click to select CSV file</span>
              )}
            </label>
          </div>

          <Button onClick={handlePreview} disabled={!file || uploading}>
            {uploading ? <Loader2 className="h-4 w-4 animate-spin mr-1" /> : <Eye className="h-4 w-4 mr-1" />}
            {uploading ? 'Parsing...' : 'Preview'}
          </Button>
        </div>
      )}

      {/* Step 2: Preview */}
      {step === 'preview' && bankPreview && (
        <div className="border rounded-lg p-4 space-y-3">
          <p className="text-sm text-muted-foreground">{file?.name} ({selectedBank.toUpperCase()})</p>

          {/* Summary bar */}
          <div className="flex flex-wrap gap-3 text-xs">
            <span className="px-2 py-1 rounded bg-green-50 text-green-700 font-medium">{bankPreview.newRows} new</span>
            {bankPreview.duplicateRows > 0 && (
              <span className="px-2 py-1 rounded bg-gray-100 text-gray-500">{bankPreview.duplicateRows} duplicates</span>
            )}
            <span className="px-2 py-1 rounded bg-green-50 text-green-700">{bankPreview.partiesMatched} matched</span>
            {bankPreview.partiesUnmatched > 0 && (
              <span className="px-2 py-1 rounded bg-amber-50 text-amber-700">{bankPreview.partiesUnmatched} unmatched</span>
            )}
            {bankPreview.balanceMatched !== undefined && (
              <span className={`px-2 py-1 rounded ${bankPreview.balanceMatched ? 'bg-green-50 text-green-700' : 'bg-red-50 text-red-700'}`}>
                Balance: {bankPreview.balanceMatched ? 'Pass' : 'Fail'}
              </span>
            )}
          </div>

          {/* Preview table */}
          {bankPreview.rows.length > 0 && (
            <div className="border rounded overflow-hidden max-h-[400px] overflow-y-auto">
              <table className="w-full text-xs">
                <thead className="bg-muted/50 sticky top-0">
                  <tr>
                    <th className="text-left p-2 font-medium">Date</th>
                    <th className="text-left p-2 font-medium">Narration</th>
                    <th className="text-right p-2 font-medium">Amount</th>
                    <th className="text-left p-2 font-medium">Party</th>
                    <th className="text-left p-2 font-medium w-16">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {bankPreview.rows.map((row, i) => (
                    <tr
                      key={i}
                      className={`border-t ${
                        row.isDuplicate ? 'opacity-40 line-through' : !row.partyId ? 'bg-amber-50' : ''
                      }`}
                    >
                      <td className="p-2 whitespace-nowrap">{new Date(row.txnDate).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })}</td>
                      <td className="p-2 max-w-[250px] truncate" title={row.narration ?? ''}>{row.narration ?? '—'}</td>
                      <td className={`p-2 text-right font-mono whitespace-nowrap ${row.direction === 'credit' ? 'text-green-600' : ''}`}>
                        {row.direction === 'credit' ? '+' : ''}{formatCurrency(row.amount)}
                      </td>
                      <td className="p-2">{row.partyName ?? <span className="text-amber-600">—</span>}</td>
                      <td className="p-2">
                        {row.isDuplicate ? <span className="text-gray-400">Dup</span> : <span className="text-green-600">New</span>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          <div className="flex gap-2">
            <Button variant="outline" onClick={() => { setStep('upload'); setBankPreview(null); }}>Back</Button>
            <Button onClick={handleImport} disabled={importing || previewNewCount === 0}>
              {importing ? <Loader2 className="h-4 w-4 animate-spin mr-1" /> : <Upload className="h-4 w-4 mr-1" />}
              {importing ? 'Importing...' : previewNewCount === 0 ? 'No new transactions' : `Import ${previewNewCount} Transactions`}
            </Button>
          </div>
        </div>
      )}

      {/* Done */}
      {step === 'done' && importResult && (
        <div className="border border-green-200 bg-green-50 rounded-lg p-4 space-y-3">
          <p className="text-sm font-medium text-green-700">Import complete</p>
          <p className="text-sm"><strong>{importResult.newRows}</strong> new transactions imported, <strong>{importResult.skippedRows}</strong> duplicates skipped</p>
          <p className="text-xs text-muted-foreground">You can edit party assignments and accounts in the transaction list.</p>
          <Button onClick={onBack}>
            <ArrowLeft className="h-4 w-4 mr-1" /> Back to Transactions
          </Button>
        </div>
      )}
    </div>
  );
}

// ============================================
// CONFIRM PAYABLE DIALOG (link to payment)
// ============================================

function ConfirmPayableDialog({ invoice, isPending, onConfirm, onClose }: {
  invoice: { id: string; totalAmount: number; party?: { id: string; name: string } | null };
  isPending: boolean;
  onConfirm: (linkedPaymentId?: string) => void;
  onClose: () => void;
}) {
  const [selectedPaymentId, setSelectedPaymentId] = useState<string | null>(null);
  const findPaymentsFn = useServerFn(findUnmatchedPayments);

  const { data, isLoading } = useQuery({
    queryKey: ['finance', 'unmatched-payments', invoice.party?.id ?? invoice.party?.name],
    queryFn: () => findPaymentsFn({
      data: {
        ...(invoice.party?.id ? { partyId: invoice.party.id } : {}),
        ...(invoice.party?.name ? { partyName: invoice.party.name } : {}),
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
            {formatCurrency(invoice.totalAmount)} to {invoice.party?.name ?? 'vendor'}. Was this already paid?
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
                {payments.map((pmt) => (
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
                        <span>{pmt.party?.name ?? '—'}</span>
                        <span>{pmt.referenceNumber ?? pmt.method.replace(/_/g, ' ')}</span>
                      </div>
                      {pmt.debitAccountCode === 'UNMATCHED_PAYMENTS' && (
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
                  ))}
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
// UPLOAD INVOICE DIALOG
// ============================================

interface InvoicePreview {
  previewId: string;
  parsed: {
    invoiceNumber?: string | null;
    invoiceDate?: string | null;
    dueDate?: string | null;
    billingPeriod?: string | null;
    supplierName?: string | null;
    supplierGstin?: string | null;
    supplierPan?: string | null;
    supplierAddress?: string | null;
    supplierEmail?: string | null;
    supplierPhone?: string | null;
    supplierBankAccountNumber?: string | null;
    supplierBankIfsc?: string | null;
    supplierBankName?: string | null;
    supplierBankAccountName?: string | null;
    subtotal?: number | null;
    gstAmount?: number | null;
    totalAmount?: number | null;
    lines?: Array<{
      description?: string | null;
      hsnCode?: string | null;
      qty?: number | null;
      unit?: string | null;
      rate?: number | null;
      amount?: number | null;
      gstPercent?: number | null;
      gstAmount?: number | null;
    }>;
    confidence?: number;
  } | null;
  partyMatch: { partyId: string; partyName: string; category: string } | null;
  enrichmentPreview: {
    willCreateNewParty: boolean;
    newPartyName?: string;
    fieldsWillBeAdded: string[];
    bankMismatch: boolean;
    bankMismatchDetails?: string;
  };
  aiConfidence: number;
  fileName: string;
}

interface InvoiceConfirmResult {
  invoiceNumber: string | null;
  counterpartyName: string | null;
  totalAmount: number;
  aiConfidence: number;
  enrichment?: {
    fieldsAdded: string[];
    bankMismatch: boolean;
    bankMismatchDetails?: string;
    partyCreated: boolean;
    partyName?: string;
  };
}

function UploadInvoiceDialog({ open, onClose, onSuccess }: {
  open: boolean;
  onClose: () => void;
  onSuccess: () => void;
}) {
  const [file, setFile] = useState<File | null>(null);
  const [uploading, setUploading] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [preview, setPreview] = useState<InvoicePreview | null>(null);
  const [result, setResult] = useState<InvoiceConfirmResult | null>(null);

  // Step 1: Upload + AI parse (no DB write)
  const handleUpload = async () => {
    if (!file) return;
    setUploading(true);
    setError(null);
    setPreview(null);
    try {
      const formData = new FormData();
      formData.append('file', file);

      const res = await fetch('/api/finance/upload-preview', {
        method: 'POST',
        credentials: 'include',
        body: formData,
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || 'Upload failed');

      setPreview(json);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Upload failed');
    } finally {
      setUploading(false);
    }
  };

  // Step 2: Confirm preview → save to DB
  const handleConfirm = async () => {
    if (!preview) return;
    setConfirming(true);
    setError(null);
    try {
      const res = await fetch(`/api/finance/confirm-preview/${preview.previewId}`, {
        method: 'POST',
        credentials: 'include',
      });
      const json = await res.json();

      if (res.status === 410) {
        // Preview expired
        setError('Preview expired, please re-upload');
        setPreview(null);
        return;
      }
      if (!res.ok || !json.success) throw new Error(json.error || 'Save failed');

      setResult({
        invoiceNumber: json.invoice.invoiceNumber,
        counterpartyName: json.invoice.party?.name ?? json.invoice.supplierName ?? null,
        totalAmount: json.invoice.totalAmount,
        aiConfidence: json.aiConfidence,
        enrichment: json.enrichment,
      });
      onSuccess();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Save failed');
    } finally {
      setConfirming(false);
    }
  };

  const handleClose = () => {
    setFile(null);
    setError(null);
    setPreview(null);
    setResult(null);
    onClose();
  };

  const p = preview?.parsed;
  const lines = p?.lines ?? [];

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) handleClose(); }}>
      <DialogContent className={preview && !result ? 'max-w-2xl' : 'max-w-md'}>
        <DialogHeader>
          <DialogTitle>{result ? 'Invoice Created' : preview ? 'Review Invoice' : 'Upload Invoice'}</DialogTitle>
          <DialogDescription>
            {result ? 'Draft saved successfully.' : preview ? 'Check the extracted details before saving.' : 'Upload a PDF or image and we will extract the details automatically.'}
          </DialogDescription>
        </DialogHeader>

        {error && (
          <div className="border border-red-300 bg-red-50 text-red-700 rounded-lg p-3 text-sm flex items-center gap-2">
            <AlertCircle className="h-4 w-4 shrink-0" /> {error}
          </div>
        )}

        {/* Step 3: Result */}
        {result ? (
          <div className="space-y-3">
            <div className="border border-green-200 bg-green-50 rounded-lg p-4 space-y-2">
              <p className="text-sm font-medium text-green-700">Draft invoice created</p>
              <div className="text-sm space-y-1">
                {result.invoiceNumber && <p><span className="text-muted-foreground">Invoice #:</span> {result.invoiceNumber}</p>}
                {result.counterpartyName && <p><span className="text-muted-foreground">Supplier:</span> {result.counterpartyName}</p>}
                <p><span className="text-muted-foreground">Total:</span> {formatCurrency(result.totalAmount)}</p>
                <p><span className="text-muted-foreground">AI Confidence:</span> {Math.round(result.aiConfidence * 100)}%</p>
              </div>
            </div>

            {result.enrichment?.partyCreated && (
              <div className="border border-blue-200 bg-blue-50 rounded-lg p-3 text-sm text-blue-700">
                New vendor created: <span className="font-medium">{result.enrichment.partyName}</span>
              </div>
            )}

            {result.enrichment && result.enrichment.fieldsAdded.length > 0 && !result.enrichment.partyCreated && (
              <div className="border border-blue-200 bg-blue-50 rounded-lg p-3 text-sm text-blue-700">
                Updated vendor info: {result.enrichment.fieldsAdded.join(', ')}
              </div>
            )}

            {result.enrichment?.bankMismatch && (
              <div className="border border-amber-300 bg-amber-50 rounded-lg p-3 text-sm text-amber-700 flex items-start gap-2">
                <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5" />
                <div>
                  <p className="font-medium">Bank details mismatch</p>
                  <p className="text-xs mt-0.5">{result.enrichment.bankMismatchDetails}</p>
                </div>
              </div>
            )}

            <DialogFooter>
              <Button onClick={handleClose}>Done</Button>
            </DialogFooter>
          </div>

        /* Step 2: Preview */
        ) : preview ? (
          <div className="space-y-4 max-h-[70vh] overflow-y-auto">
            {/* Invoice header */}
            <div className="grid grid-cols-2 gap-x-6 gap-y-1 text-sm">
              {p?.invoiceNumber && <div><span className="text-muted-foreground">Invoice #:</span> <span className="font-medium">{p.invoiceNumber}</span></div>}
              {p?.invoiceDate && <div><span className="text-muted-foreground">Date:</span> {p.invoiceDate}</div>}
              {p?.dueDate && <div><span className="text-muted-foreground">Due:</span> {p.dueDate}</div>}
              {p?.billingPeriod && <div><span className="text-muted-foreground">Period:</span> {p.billingPeriod}</div>}
            </div>

            {/* Supplier info */}
            <div className="border rounded-lg p-3 space-y-2">
              <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Supplier</p>
              <div className="text-sm space-y-1">
                {p?.supplierName && <p className="font-medium">{p.supplierName}</p>}
                {p?.supplierGstin && <p className="text-xs text-muted-foreground">GSTIN: {p.supplierGstin}</p>}
                {p?.supplierPan && <p className="text-xs text-muted-foreground">PAN: {p.supplierPan}</p>}
                {p?.supplierAddress && <p className="text-xs text-muted-foreground">{p.supplierAddress}</p>}
                {(p?.supplierEmail || p?.supplierPhone) && (
                  <p className="text-xs text-muted-foreground">
                    {[p.supplierEmail, p.supplierPhone].filter(Boolean).join(' | ')}
                  </p>
                )}
              </div>
            </div>

            {/* Party match */}
            <div>
              {preview.partyMatch ? (
                <span className="inline-flex items-center gap-1.5 text-xs px-2.5 py-1 rounded-full bg-green-100 text-green-700">
                  <Check className="h-3 w-3" /> Matched: {preview.partyMatch.partyName}
                </span>
              ) : p?.supplierName ? (
                <span className="inline-flex items-center gap-1.5 text-xs px-2.5 py-1 rounded-full bg-blue-100 text-blue-700">
                  <Plus className="h-3 w-3" /> New vendor: {p.supplierName}
                </span>
              ) : (
                <span className="inline-flex items-center gap-1.5 text-xs px-2.5 py-1 rounded-full bg-amber-100 text-amber-700">
                  <AlertTriangle className="h-3 w-3" /> No supplier found
                </span>
              )}
            </div>

            {/* Bank details */}
            {(p?.supplierBankAccountNumber || p?.supplierBankIfsc) && (
              <div className="border rounded-lg p-3 space-y-1">
                <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Bank Details</p>
                <div className="text-xs space-y-0.5">
                  {p?.supplierBankAccountNumber && <p>A/C: {p.supplierBankAccountNumber}</p>}
                  {p?.supplierBankIfsc && <p>IFSC: {p.supplierBankIfsc}</p>}
                  {p?.supplierBankName && <p>Bank: {p.supplierBankName}</p>}
                  {p?.supplierBankAccountName && <p>Name: {p.supplierBankAccountName}</p>}
                </div>
              </div>
            )}

            {/* Enrichment preview */}
            {preview.enrichmentPreview.fieldsWillBeAdded.length > 0 && !preview.enrichmentPreview.willCreateNewParty && (
              <div className="border border-blue-200 bg-blue-50 rounded-lg p-2.5 text-xs text-blue-700">
                Will add: {preview.enrichmentPreview.fieldsWillBeAdded.join(', ')}
              </div>
            )}
            {preview.enrichmentPreview.bankMismatch && (
              <div className="border border-amber-300 bg-amber-50 rounded-lg p-2.5 text-xs text-amber-700 flex items-start gap-2">
                <AlertTriangle className="h-3.5 w-3.5 shrink-0 mt-0.5" />
                <div>
                  <p className="font-medium">Bank details mismatch</p>
                  <p className="mt-0.5">{preview.enrichmentPreview.bankMismatchDetails}</p>
                </div>
              </div>
            )}

            {/* Line items */}
            {lines.length > 0 && (
              <div>
                <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide mb-1.5">Line Items</p>
                <div className="border rounded overflow-hidden">
                  <table className="w-full text-xs">
                    <thead className="bg-muted/50">
                      <tr>
                        <th className="text-left p-1.5 font-medium">Description</th>
                        <th className="text-left p-1.5 font-medium w-16">HSN</th>
                        <th className="text-right p-1.5 font-medium w-12">Qty</th>
                        <th className="text-right p-1.5 font-medium w-16">Rate</th>
                        <th className="text-right p-1.5 font-medium w-20">Amount</th>
                        <th className="text-right p-1.5 font-medium w-14">GST%</th>
                      </tr>
                    </thead>
                    <tbody>
                      {lines.map((line, i) => (
                        <tr key={i} className="border-t">
                          <td className="p-1.5 max-w-[200px] truncate" title={line.description ?? ''}>{line.description ?? '—'}</td>
                          <td className="p-1.5">{line.hsnCode ?? '—'}</td>
                          <td className="p-1.5 text-right">{line.qty != null ? `${line.qty}${line.unit ? ` ${line.unit}` : ''}` : '—'}</td>
                          <td className="p-1.5 text-right font-mono">{line.rate != null ? formatCurrency(line.rate) : '—'}</td>
                          <td className="p-1.5 text-right font-mono">{line.amount != null ? formatCurrency(line.amount) : '—'}</td>
                          <td className="p-1.5 text-right">{line.gstPercent != null ? `${line.gstPercent}%` : '—'}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}

            {/* Totals */}
            <div className="flex justify-end">
              <div className="text-sm space-y-0.5 text-right">
                {p?.subtotal != null && <p><span className="text-muted-foreground">Subtotal:</span> <span className="font-mono">{formatCurrency(p.subtotal)}</span></p>}
                {p?.gstAmount != null && <p><span className="text-muted-foreground">GST:</span> <span className="font-mono">{formatCurrency(p.gstAmount)}</span></p>}
                {p?.totalAmount != null && <p className="font-medium"><span className="text-muted-foreground">Total:</span> <span className="font-mono">{formatCurrency(p.totalAmount)}</span></p>}
              </div>
            </div>

            {/* AI confidence */}
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <div className={`w-2 h-2 rounded-full ${preview.aiConfidence >= 0.8 ? 'bg-green-500' : preview.aiConfidence >= 0.5 ? 'bg-amber-500' : 'bg-red-500'}`} />
              AI confidence: {Math.round(preview.aiConfidence * 100)}%
            </div>

            <DialogFooter>
              <Button variant="outline" onClick={handleClose}>Cancel</Button>
              <Button onClick={handleConfirm} disabled={confirming}>
                {confirming ? <Loader2 className="h-4 w-4 animate-spin mr-1" /> : <Check className="h-4 w-4 mr-1" />}
                {confirming ? 'Saving...' : 'Create Draft'}
              </Button>
            </DialogFooter>
          </div>

        /* Step 1: Upload */
        ) : (
          <div className="space-y-4">
            <label className="block border-2 border-dashed rounded-lg p-6 text-center cursor-pointer hover:bg-muted/30 transition-colors">
              <input
                type="file"
                accept=".pdf,.jpg,.jpeg,.png,.webp"
                className="hidden"
                onChange={(e) => setFile(e.target.files?.[0] ?? null)}
              />
              {file ? (
                <span className="text-sm">{file.name} ({(file.size / 1024).toFixed(0)} KB)</span>
              ) : (
                <div className="space-y-1">
                  <Upload className="h-8 w-8 mx-auto text-muted-foreground" />
                  <p className="text-sm text-muted-foreground">Click to select a file</p>
                  <p className="text-xs text-muted-foreground">PDF, JPEG, PNG, or WebP</p>
                </div>
              )}
            </label>

            <DialogFooter>
              <Button variant="outline" onClick={handleClose}>Cancel</Button>
              <Button onClick={handleUpload} disabled={!file || uploading}>
                {uploading ? <Loader2 className="h-4 w-4 animate-spin mr-1" /> : <Upload className="h-4 w-4 mr-1" />}
                {uploading ? 'Parsing...' : 'Upload'}
              </Button>
            </DialogFooter>
          </div>
        )}
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
  prefill?: { type: 'payable' | 'receivable'; totalAmount: number; partyId?: string };
}) {
  const queryClient = useQueryClient();
  const createFn = useServerFn(createInvoice);

  const [form, setForm] = useState({
    type: 'payable' as 'payable' | 'receivable',
    category: 'other' as string,
    invoiceNumber: '',
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
          <DialogDescription>Create a draft invoice. Confirm it later to book the expense.</DialogDescription>
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
          <DialogDescription>Record a payment transaction.</DialogDescription>
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
// TRANSACTION TYPES TAB
// ============================================

const ACCOUNT_LABELS: Record<string, string> = Object.fromEntries(
  CHART_OF_ACCOUNTS.map((a) => [a.code, a.name])
);

function TransactionTypesTab() {
  const queryClient = useQueryClient();
  const listTTFn = useServerFn(listTransactionTypes);
  const createTTFn = useServerFn(createTransactionType);
  const updateTTFn = useServerFn(updateTransactionType);
  const deleteTTFn = useServerFn(deleteTransactionType);

  const [editingId, setEditingId] = useState<string | null>(null);
  const [isCreating, setIsCreating] = useState(false);

  const { data, isLoading } = useQuery({
    queryKey: ['finance', 'transactionTypes'],
    queryFn: () => listTTFn(),
  });

  const types = data?.success ? data.types : [];

  const createMutation = useMutation({
    mutationFn: (input: any) => createTTFn({ data: input }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['finance', 'transactionTypes'] });
      setIsCreating(false);
    },
  });

  const updateMutation = useMutation({
    mutationFn: (input: any) => updateTTFn({ data: input }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['finance', 'transactionTypes'] });
      queryClient.invalidateQueries({ queryKey: ['finance', 'transactionType'] });
      setEditingId(null);
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (input: any) => deleteTTFn({ data: input }),
    onSuccess: (result) => {
      if (result.success) {
        queryClient.invalidateQueries({ queryKey: ['finance', 'transactionTypes'] });
        setEditingId(null);
      }
    },
  });

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-sm text-muted-foreground">{types.length} transaction types</p>
        <Button onClick={() => setIsCreating(true)} size="sm">
          <Plus className="h-4 w-4 mr-1" /> New Type
        </Button>
      </div>

      {isLoading ? (
        <LoadingState />
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {types.map((tt: any) => (
            <div
              key={tt.id}
              className="border rounded-lg p-4 hover:border-blue-300 cursor-pointer transition-colors"
              onClick={() => setEditingId(tt.id)}
            >
              <div className="flex items-start justify-between mb-2">
                <div>
                  <h3 className="font-medium">{tt.name}</h3>
                  {tt.description && <p className="text-xs text-muted-foreground mt-0.5">{tt.description}</p>}
                </div>
                <span className="text-xs bg-gray-100 px-2 py-0.5 rounded-full whitespace-nowrap">
                  {tt._count.parties} {tt._count.parties === 1 ? 'party' : 'parties'}
                </span>
              </div>
              <div className="space-y-1 text-xs text-muted-foreground">
                {tt.debitAccountCode && (
                  <div>Debit: <span className="text-foreground">{ACCOUNT_LABELS[tt.debitAccountCode] ?? tt.debitAccountCode}</span></div>
                )}
                {tt.creditAccountCode && (
                  <div>Credit: <span className="text-foreground">{ACCOUNT_LABELS[tt.creditAccountCode] ?? tt.creditAccountCode}</span></div>
                )}
                <div className="flex gap-3 mt-2">
                  {tt.defaultGstRate != null && (
                    <span className="bg-green-50 text-green-700 px-1.5 py-0.5 rounded">GST {tt.defaultGstRate}%</span>
                  )}
                  {tt.defaultTdsApplicable && (
                    <span className="bg-orange-50 text-orange-700 px-1.5 py-0.5 rounded">
                      TDS {tt.defaultTdsSection} @ {tt.defaultTdsRate}%
                    </span>
                  )}
                  {tt.invoiceRequired && (
                    <span className="bg-blue-50 text-blue-700 px-1.5 py-0.5 rounded">Invoice req.</span>
                  )}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Create Modal */}
      {isCreating && (
        <TransactionTypeFormModal
          onClose={() => setIsCreating(false)}
          onSave={(values) => createMutation.mutate(values)}
          saving={createMutation.isPending}
        />
      )}

      {/* Edit Modal */}
      {editingId && (
        <EditTransactionTypeModal
          id={editingId}
          onClose={() => setEditingId(null)}
          onSave={(values) => updateMutation.mutate(values)}
          onDelete={(id) => deleteMutation.mutate({ id })}
          saving={updateMutation.isPending}
          deleting={deleteMutation.isPending}
          deleteError={deleteMutation.data && !deleteMutation.data.success ? deleteMutation.data.error : undefined}
        />
      )}
    </div>
  );
}

function TransactionTypeFormModal({
  initial,
  onClose,
  onSave,
  saving,
  children,
}: {
  initial?: any;
  onClose: () => void;
  onSave: (values: any) => void;
  saving: boolean;
  children?: React.ReactNode;
}) {
  const [name, setName] = useState(initial?.name ?? '');
  const [description, setDescription] = useState(initial?.description ?? '');
  const [debitAccountCode, setDebitAccountCode] = useState(initial?.debitAccountCode ?? '');
  const [creditAccountCode, setCreditAccountCode] = useState(initial?.creditAccountCode ?? '');
  const [defaultGstRate, setDefaultGstRate] = useState(initial?.defaultGstRate?.toString() ?? '');
  const [defaultTdsApplicable, setDefaultTdsApplicable] = useState(initial?.defaultTdsApplicable ?? false);
  const [defaultTdsSection, setDefaultTdsSection] = useState(initial?.defaultTdsSection ?? '');
  const [defaultTdsRate, setDefaultTdsRate] = useState(initial?.defaultTdsRate?.toString() ?? '');
  const [invoiceRequired, setInvoiceRequired] = useState(initial?.invoiceRequired ?? true);
  const [expenseCategory, setExpenseCategory] = useState(initial?.expenseCategory ?? '');

  const handleSubmit = () => {
    if (!name.trim()) return;
    onSave({
      ...(initial?.id ? { id: initial.id } : {}),
      name: name.trim(),
      ...(description.trim() ? { description: description.trim() } : {}),
      ...(debitAccountCode ? { debitAccountCode } : { debitAccountCode: null }),
      ...(creditAccountCode ? { creditAccountCode } : { creditAccountCode: null }),
      ...(defaultGstRate !== '' ? { defaultGstRate: parseFloat(defaultGstRate) } : { defaultGstRate: null }),
      defaultTdsApplicable,
      ...(defaultTdsSection ? { defaultTdsSection } : { defaultTdsSection: null }),
      ...(defaultTdsRate !== '' ? { defaultTdsRate: parseFloat(defaultTdsRate) } : { defaultTdsRate: null }),
      invoiceRequired,
      ...(expenseCategory ? { expenseCategory } : { expenseCategory: null }),
    });
  };

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{initial ? 'Edit Transaction Type' : 'New Transaction Type'}</DialogTitle>
          <DialogDescription>
            {initial ? 'Update accounting rules for this type.' : 'Set up accounting rules for a new vendor category.'}
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div>
            <Label>Name *</Label>
            <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Fabric Purchase" />
          </div>
          <div>
            <Label>Description</Label>
            <Input value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Optional description" />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label>Debit Account</Label>
              <Select value={debitAccountCode || 'none'} onValueChange={(v) => setDebitAccountCode(v === 'none' ? '' : v)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">None</SelectItem>
                  {CHART_OF_ACCOUNTS.map((a) => (
                    <SelectItem key={a.code} value={a.code}>{a.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>Credit Account</Label>
              <Select value={creditAccountCode || 'none'} onValueChange={(v) => setCreditAccountCode(v === 'none' ? '' : v)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">None</SelectItem>
                  {CHART_OF_ACCOUNTS.map((a) => (
                    <SelectItem key={a.code} value={a.code}>{a.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label>Default GST Rate (%)</Label>
              <Input type="number" value={defaultGstRate} onChange={(e) => setDefaultGstRate(e.target.value)} placeholder="e.g. 18" />
              <div className="flex gap-1 mt-1">
                {[0, 5, 12, 18, 28].map((r) => (
                  <button key={r} type="button" className="text-xs px-1.5 py-0.5 rounded bg-gray-100 hover:bg-gray-200" onClick={() => setDefaultGstRate(String(r))}>{r}%</button>
                ))}
              </div>
            </div>
            <div>
              <Label>Expense Category</Label>
              <Select value={expenseCategory || 'none'} onValueChange={(v) => setExpenseCategory(v === 'none' ? '' : v)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">None</SelectItem>
                  {INVOICE_CATEGORIES.map((c) => (
                    <SelectItem key={c} value={c}>{getCategoryLabel(c)}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          <div className="space-y-2">
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={defaultTdsApplicable} onChange={(e) => setDefaultTdsApplicable(e.target.checked)} className="rounded" />
              TDS Applicable
            </label>
            {defaultTdsApplicable && (
              <div className="grid grid-cols-2 gap-3 pl-6">
                <div>
                  <Label>TDS Section</Label>
                  <Select value={defaultTdsSection || 'none'} onValueChange={(v) => setDefaultTdsSection(v === 'none' ? '' : v)}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="none">Select</SelectItem>
                      {['194C', '194J', '194I', '194H'].map((s) => (
                        <SelectItem key={s} value={s}>{s}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <Label>TDS Rate (%)</Label>
                  <Input type="number" value={defaultTdsRate} onChange={(e) => setDefaultTdsRate(e.target.value)} placeholder="e.g. 1" />
                </div>
              </div>
            )}
          </div>
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={invoiceRequired} onChange={(e) => setInvoiceRequired(e.target.checked)} className="rounded" />
            Invoice Required
          </label>
        </div>
        {children}
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button onClick={handleSubmit} disabled={saving || !name.trim()}>
            {saving && <Loader2 className="h-4 w-4 animate-spin mr-1" />}
            {initial ? 'Save Changes' : 'Create'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function EditTransactionTypeModal({
  id,
  onClose,
  onSave,
  onDelete,
  saving,
  deleting,
  deleteError,
}: {
  id: string;
  onClose: () => void;
  onSave: (values: any) => void;
  onDelete: (id: string) => void;
  saving: boolean;
  deleting: boolean;
  deleteError?: string;
}) {
  const getTTFn = useServerFn(getTransactionType);
  const { data, isLoading } = useQuery({
    queryKey: ['finance', 'transactionType', id],
    queryFn: () => getTTFn({ data: { id } }),
  });

  if (isLoading) {
    return (
      <Dialog open onOpenChange={(open) => !open && onClose()}>
        <DialogContent><LoadingState /></DialogContent>
      </Dialog>
    );
  }

  const tt = data?.success ? data.transactionType : null;
  if (!tt) {
    return (
      <Dialog open onOpenChange={(open) => !open && onClose()}>
        <DialogContent>
          <DialogHeader><DialogTitle>Not Found</DialogTitle></DialogHeader>
          <DialogDescription>Transaction type not found.</DialogDescription>
        </DialogContent>
      </Dialog>
    );
  }

  return (
    <TransactionTypeFormModal initial={tt} onClose={onClose} onSave={onSave} saving={saving}>
      {/* Changelog */}
      {tt.changeLogs && tt.changeLogs.length > 0 && (
        <div className="border-t pt-3 mt-3">
          <h4 className="text-sm font-medium flex items-center gap-1 mb-2">
            <History className="h-4 w-4" /> Change History
          </h4>
          <div className="max-h-48 overflow-y-auto space-y-1.5">
            {tt.changeLogs.map((log: any) => (
              <div key={log.id} className="text-xs text-muted-foreground flex gap-2">
                <span className="shrink-0">{new Date(log.createdAt).toLocaleDateString('en-IN')}</span>
                <span className="shrink-0 font-medium text-foreground">{log.changedBy.name}</span>
                <span>
                  {log.fieldName === '__created' ? (
                    <span className="text-green-600">Created</span>
                  ) : log.fieldName === '__deactivated' ? (
                    <span className="text-red-600">Deactivated</span>
                  ) : (
                    <>{log.fieldName}: <span className="line-through">{log.oldValue ?? '—'}</span> → <span className="text-foreground">{log.newValue ?? '—'}</span></>
                  )}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Delete button */}
      <div className="border-t pt-3 mt-3">
        {deleteError && (
          <p className="text-xs text-red-600 mb-2">{deleteError}</p>
        )}
        <Button
          variant="destructive"
          size="sm"
          onClick={() => onDelete(id)}
          disabled={deleting || (tt._count?.parties ?? 0) > 0}
        >
          {deleting ? <Loader2 className="h-4 w-4 animate-spin mr-1" /> : <Trash2 className="h-4 w-4 mr-1" />}
          Deactivate
          {(tt._count?.parties ?? 0) > 0 && ` (${tt._count.parties} parties using)`}
        </Button>
      </div>
    </TransactionTypeFormModal>
  );
}

// ============================================
// PARTIES TAB
// ============================================

function PartiesTab({ search }: { search: FinanceSearchParams }) {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const listFn = useServerFn(listFinanceParties);
  const listTTFn = useServerFn(listTransactionTypes);
  const updateFn = useServerFn(updateFinanceParty);
  const createFn = useServerFn(createFinanceParty);

  const balancesFn = useServerFn(getPartyBalances);
  const [editingParty, setEditingParty] = useState<any>(null);
  const [isCreating, setIsCreating] = useState(false);

  const { data: ttData } = useQuery({
    queryKey: ['finance', 'transactionTypes'],
    queryFn: () => listTTFn(),
  });

  const { data: balData } = useQuery({
    queryKey: ['finance', 'partyBalances'],
    queryFn: () => balancesFn(),
  });
  const balanceMap = useMemo(() => {
    if (!balData?.success) return new Map<string, { total_invoiced: number; total_paid: number; outstanding: number }>();
    return new Map(balData.balances.map((b: any) => [b.id, b]));
  }, [balData]);

  const { data, isLoading } = useQuery({
    queryKey: ['finance', 'parties', 'list', search.partyTxnType, search.search, search.page],
    queryFn: () => listFn({
      data: {
        transactionTypeId: search.partyTxnType,
        search: search.search,
        page: search.page,
        limit: 200,
      },
    }),
  });

  const updateMutation = useMutation({
    mutationFn: (input: any) => updateFn({ data: input }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['finance', 'parties'] });
      setEditingParty(null);
    },
  });

  const createMutation = useMutation({
    mutationFn: (input: any) => createFn({ data: input }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['finance', 'parties'] });
      setIsCreating(false);
    },
  });

  const updateSearch = useCallback((updates: Partial<FinanceSearchParams>) => {
    navigate({ to: '/finance', search: { ...search, ...updates }, replace: true });
  }, [navigate, search]);

  const parties = data?.success ? data.parties : [];
  const total = data?.success ? data.total : 0;
  const transactionTypes = ttData?.success ? ttData.types : [];

  return (
    <div className="space-y-4">
      {/* Filters */}
      <div className="flex items-center gap-3 flex-wrap">
        <div className="relative flex-1 min-w-[200px] max-w-md">
          <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Search by name or alias..."
            className="pl-8"
            defaultValue={search.search || ''}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                updateSearch({ search: (e.target as HTMLInputElement).value || undefined, page: 1 });
              }
            }}
          />
        </div>

        <Select
          value={search.partyTxnType || 'all'}
          onValueChange={(v) => updateSearch({ partyTxnType: v === 'all' ? undefined : v, page: 1 })}
        >
          <SelectTrigger className="w-[220px]">
            <SelectValue placeholder="Transaction Type" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Transaction Types</SelectItem>
            {transactionTypes.map((tt: any) => (
              <SelectItem key={tt.id} value={tt.id}>
                {tt.name} ({tt._count.parties})
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        <Button onClick={() => setIsCreating(true)} size="sm">
          <Plus className="h-4 w-4 mr-1" /> New Party
        </Button>
      </div>

      {/* Stats */}
      <div className="text-sm text-muted-foreground">
        {total} parties{search.partyTxnType ? ' (filtered)' : ''}
      </div>

      {/* Table */}
      {isLoading ? (
        <LoadingState />
      ) : (
        <div className="border rounded-lg overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b bg-muted/50">
                <th className="text-left p-3 font-medium">Name</th>
                <th className="text-left p-3 font-medium">Transaction Type</th>
                <th className="text-right p-3 font-medium">Invoiced</th>
                <th className="text-right p-3 font-medium">Paid</th>
                <th className="text-right p-3 font-medium">Outstanding</th>
                <th className="text-left p-3 font-medium">TDS</th>
                <th className="text-center p-3 font-medium">Invoice?</th>
                <th className="text-center p-3 font-medium">Active</th>
                <th className="text-center p-3 font-medium w-16"></th>
              </tr>
            </thead>
            <tbody>
              {parties.map((party: any) => (
                <tr key={party.id} className="border-b hover:bg-muted/30">
                  <td className="p-3">
                    <div className="font-medium">{party.name}</div>
                    <div className="text-xs text-muted-foreground">{party.category}</div>
                  </td>
                  <td className="p-3">
                    {party.transactionType ? (
                      <span className="inline-flex px-2 py-0.5 rounded-full text-xs bg-blue-100 text-blue-700">
                        {party.transactionType.name}
                      </span>
                    ) : (
                      <span className="text-xs text-muted-foreground">—</span>
                    )}
                  </td>
                  {(() => {
                    const bal = balanceMap.get(party.id);
                    return (
                      <>
                        <td className="p-3 text-right text-xs tabular-nums">{bal ? formatCurrency(bal.total_invoiced) : '—'}</td>
                        <td className="p-3 text-right text-xs tabular-nums">{bal ? formatCurrency(bal.total_paid) : '—'}</td>
                        <td className="p-3 text-right text-xs tabular-nums font-medium">
                          {bal && bal.outstanding > 0.01 ? (
                            <span className="text-amber-600">{formatCurrency(bal.outstanding)}</span>
                          ) : bal ? (
                            <span className="text-green-600">Settled</span>
                          ) : '—'}
                        </td>
                      </>
                    );
                  })()}
                  <td className="p-3 text-xs">
                    {party.tdsApplicable ? (
                      <span>{party.tdsSection} @ {party.tdsRate}%</span>
                    ) : (
                      <span className="text-muted-foreground">—</span>
                    )}
                  </td>
                  <td className="p-3 text-center">
                    {party.invoiceRequired ? (
                      <Check className="h-4 w-4 text-green-600 mx-auto" />
                    ) : (
                      <X className="h-4 w-4 text-gray-400 mx-auto" />
                    )}
                  </td>
                  <td className="p-3 text-center">
                    {party.isActive ? (
                      <span className="inline-flex h-2 w-2 rounded-full bg-green-500" />
                    ) : (
                      <span className="inline-flex h-2 w-2 rounded-full bg-gray-300" />
                    )}
                  </td>
                  <td className="p-3 text-center">
                    <Button variant="ghost" size="sm" onClick={() => setEditingParty(party)}>
                      <Pencil className="h-3.5 w-3.5" />
                    </Button>
                  </td>
                </tr>
              ))}
              {parties.length === 0 && (
                <tr>
                  <td colSpan={7} className="p-8 text-center text-muted-foreground">
                    No parties found
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}

      {/* Edit Modal */}
      {editingParty && (
        <PartyEditModal
          party={editingParty}
          transactionTypes={transactionTypes}
          onSave={(data) => updateMutation.mutate(data)}
          onClose={() => setEditingParty(null)}
          isSaving={updateMutation.isPending}
        />
      )}

      {/* Create Modal */}
      {isCreating && (
        <PartyEditModal
          party={null}
          transactionTypes={transactionTypes}
          onSave={(data) => createMutation.mutate(data)}
          onClose={() => setIsCreating(false)}
          isSaving={createMutation.isPending}
        />
      )}
    </div>
  );
}

// ============================================
// PARTY EDIT/CREATE MODAL
// ============================================

function PartyEditModal({
  party,
  transactionTypes,
  onSave,
  onClose,
  isSaving,
}: {
  party: any | null;
  transactionTypes: any[];
  onSave: (data: any) => void;
  onClose: () => void;
  isSaving: boolean;
}) {
  const isCreate = !party;
  const [name, setName] = useState(party?.name ?? '');
  const [category, setCategory] = useState(party?.category ?? 'other');
  const [transactionTypeId, setTransactionTypeId] = useState(party?.transactionTypeId ?? '');
  const [aliasInput, setAliasInput] = useState('');
  const [aliases, setAliases] = useState<string[]>(party?.aliases ?? []);
  const [tdsApplicable, setTdsApplicable] = useState(party?.tdsApplicable ?? false);
  const [tdsSection, setTdsSection] = useState(party?.tdsSection ?? '');
  const [tdsRate, setTdsRate] = useState<string>(party?.tdsRate?.toString() ?? '');
  const [invoiceRequired, setInvoiceRequired] = useState(party?.invoiceRequired ?? true);
  const [contactName, setContactName] = useState(party?.contactName ?? '');
  const [email, setEmail] = useState(party?.email ?? '');
  const [phone, setPhone] = useState(party?.phone ?? '');
  const [gstin, setGstin] = useState(party?.gstin ?? '');
  const [pan, setPan] = useState(party?.pan ?? '');
  const [isActive, setIsActive] = useState(party?.isActive ?? true);

  const addAlias = () => {
    const val = aliasInput.trim().toUpperCase();
    if (val && !aliases.includes(val)) {
      setAliases([...aliases, val]);
    }
    setAliasInput('');
  };

  const removeAlias = (index: number) => {
    setAliases(aliases.filter((_, i) => i !== index));
  };

  const handleSubmit = () => {
    if (isCreate) {
      onSave({
        name,
        category,
        ...(transactionTypeId ? { transactionTypeId } : {}),
        aliases,
        tdsApplicable,
        ...(tdsApplicable && tdsSection ? { tdsSection } : { tdsSection: null }),
        ...(tdsApplicable && tdsRate ? { tdsRate: parseFloat(tdsRate) } : { tdsRate: null }),
        invoiceRequired,
        contactName: contactName || null,
        email: email || null,
        phone: phone || null,
        gstin: gstin || null,
        pan: pan || null,
      });
    } else {
      onSave({
        id: party.id,
        name,
        category,
        transactionTypeId: transactionTypeId || null,
        aliases,
        tdsApplicable,
        tdsSection: tdsApplicable && tdsSection ? tdsSection : null,
        tdsRate: tdsApplicable && tdsRate ? parseFloat(tdsRate) : null,
        invoiceRequired,
        contactName: contactName || null,
        email: email || null,
        phone: phone || null,
        gstin: gstin || null,
        pan: pan || null,
        isActive,
      });
    }
  };

  return (
    <Dialog open onOpenChange={onClose}>
      <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{isCreate ? 'Create Party' : `Edit: ${party.name}`}</DialogTitle>
          <DialogDescription>
            {isCreate ? 'Add a new vendor, supplier, or counterparty.' : 'Update party details and bank matching aliases.'}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          {/* Name */}
          <div className="space-y-1">
            <Label>Name</Label>
            <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Vendor name" />
          </div>

          {/* Category + Transaction Type */}
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <Label>Category</Label>
              <Select value={category} onValueChange={setCategory}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {PARTY_CATEGORIES.map(c => (
                    <SelectItem key={c} value={c}>{getCategoryLabel(c)}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label>Transaction Type</Label>
              <Select value={transactionTypeId || 'none'} onValueChange={(v) => setTransactionTypeId(v === 'none' ? '' : v)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">— None —</SelectItem>
                  {transactionTypes.map((tt: any) => (
                    <SelectItem key={tt.id} value={tt.id}>{tt.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          {/* Aliases */}
          <div className="space-y-1">
            <Label>Aliases (for bank narration matching)</Label>
            <div className="flex gap-2">
              <Input
                value={aliasInput}
                onChange={(e) => setAliasInput(e.target.value)}
                placeholder="Add alias (auto-uppercased)"
                onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); addAlias(); } }}
                className="flex-1"
              />
              <Button type="button" variant="outline" size="sm" onClick={addAlias}>Add</Button>
            </div>
            <div className="flex flex-wrap gap-1 mt-1">
              {aliases.map((alias, i) => (
                <span key={i} className="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-gray-100 text-xs font-mono">
                  {alias}
                  <button onClick={() => removeAlias(i)} className="text-gray-400 hover:text-red-500">
                    <X className="h-3 w-3" />
                  </button>
                </span>
              ))}
            </div>
            <p className="text-xs text-muted-foreground mt-1">
              Use + for compound match: "RAZORPAY SOFTWARE+ESCROW" means both must appear.
            </p>
          </div>

          {/* TDS */}
          <div className="space-y-2">
            <div className="flex items-center gap-2">
              <input type="checkbox" checked={tdsApplicable} onChange={(e) => setTdsApplicable(e.target.checked)} id="tds-check" />
              <Label htmlFor="tds-check">TDS Applicable</Label>
            </div>
            {tdsApplicable && (
              <div className="grid grid-cols-2 gap-3 pl-5">
                <div className="space-y-1">
                  <Label className="text-xs">Section</Label>
                  <Select value={tdsSection || 'none'} onValueChange={(v) => setTdsSection(v === 'none' ? '' : v)}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="none">—</SelectItem>
                      <SelectItem value="194C">194C</SelectItem>
                      <SelectItem value="194J">194J</SelectItem>
                      <SelectItem value="194I">194I</SelectItem>
                      <SelectItem value="194H">194H</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1">
                  <Label className="text-xs">Rate %</Label>
                  <Input value={tdsRate} onChange={(e) => setTdsRate(e.target.value)} type="number" step="0.1" />
                </div>
              </div>
            )}
          </div>

          {/* Invoice Required */}
          <div className="flex items-center gap-2">
            <input type="checkbox" checked={invoiceRequired} onChange={(e) => setInvoiceRequired(e.target.checked)} id="inv-check" />
            <Label htmlFor="inv-check">Invoice Required</Label>
          </div>

          {/* Contact Info */}
          <details className="space-y-2">
            <summary className="text-sm font-medium cursor-pointer text-muted-foreground">Contact Info</summary>
            <div className="grid grid-cols-2 gap-3 pt-2">
              <div className="space-y-1">
                <Label className="text-xs">Contact Name</Label>
                <Input value={contactName} onChange={(e) => setContactName(e.target.value)} placeholder="Person name" />
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Email</Label>
                <Input value={email} onChange={(e) => setEmail(e.target.value)} placeholder="email@example.com" />
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Phone</Label>
                <Input value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="9876543210" />
              </div>
              <div className="space-y-1">
                <Label className="text-xs">GSTIN</Label>
                <Input value={gstin} onChange={(e) => setGstin(e.target.value)} placeholder="22AAAAA0000A1Z5" />
              </div>
              <div className="space-y-1">
                <Label className="text-xs">PAN</Label>
                <Input value={pan} onChange={(e) => setPan(e.target.value)} placeholder="AAAAA0000A" />
              </div>
            </div>
          </details>

          {/* Active toggle (only for edit) */}
          {!isCreate && (
            <div className="flex items-center gap-2">
              <input type="checkbox" checked={isActive} onChange={(e) => setIsActive(e.target.checked)} id="active-check" />
              <Label htmlFor="active-check">Active</Label>
            </div>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button onClick={handleSubmit} disabled={isSaving || !name.trim()}>
            {isSaving && <Loader2 className="h-4 w-4 mr-1 animate-spin" />}
            {isCreate ? 'Create' : 'Save'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
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
