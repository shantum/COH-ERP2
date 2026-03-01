/**
 * Bank Transactions Tab — Unified view of all bank statement rows.
 *
 * Sub-tabs per bank account (HDFC, RazorpayX, HDFC CC, ICICI CC).
 * Merges old PaymentsTab + BankImportTab into one transparent view.
 */

import { useState, useCallback, useRef, useEffect, useMemo, Fragment } from 'react';
import { useAuth } from '../../hooks/useAuth';
import { isAdminUser } from '../../types';
import ConfirmModal from '../../components/common/ConfirmModal';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useServerFn } from '@tanstack/react-start';
import { useNavigate } from '@tanstack/react-router';
import { useDebounce } from '../../hooks/useDebounce';
import { useDebouncedSearch } from '../../hooks/useDebouncedSearch';
import {
  listBankTransactionsUnified, createFinanceParty,
  getAutoMatchSuggestions, applyAutoMatches,
  findUnpaidInvoices, updatePaymentNotes,
} from '../../server/functions/finance';
import { PartySearch } from '../../components/finance/PartySearch';
import { formatCurrency, formatPeriod, Pagination, LoadingState, downloadCsv } from './shared';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import { Checkbox } from '@/components/ui/checkbox';
import {
  ArrowUpRight, ArrowDownLeft, Loader2, Download, Upload,
  ExternalLink, Link2, Pencil, Check, X, Trash2, History,
  Plus, ArrowLeft, AlertCircle, Eye,
} from 'lucide-react';
import { showSuccess, showError } from '../../utils/toast';
import {
  type FinanceSearchParams,
  BANK_TYPES,
  BANK_TXN_FILTER_OPTIONS,
  CHART_OF_ACCOUNTS,
  INVOICE_CATEGORIES,
  PAYMENT_CATEGORY_FILTERS,
  getBankLabel,
  getBankStatusLabel,
  getCategoryLabel,
  isBankTxnPending,
} from '@coh/shared';

// ============================================
// MAIN TAB — Sub-tabs per bank account
// ============================================

export default function BankTransactionsTab({ search }: { search: FinanceSearchParams }) {
  const navigate = useNavigate();

  const updateSearch = useCallback(
    (updates: Partial<FinanceSearchParams>) => {
      navigate({ to: '/finance', search: { ...search, ...updates }, replace: true });
    },
    [navigate, search],
  );

  // Import wizard sub-view
  if (search.bankView === 'import') {
    return (
      <BankImportView
        defaultBank={search.bankTab ?? 'hdfc'}
        onBack={() => updateSearch({ bankView: undefined })}
      />
    );
  }

  const bankTab = search.bankTab ?? 'hdfc';

  return (
    <div className="space-y-4">
      <Tabs
        value={bankTab}
        onValueChange={(v) => updateSearch({ bankTab: v as FinanceSearchParams['bankTab'], page: 1, bankStatus: undefined, direction: undefined, matchStatus: undefined, paymentCategory: undefined, search: undefined, dateFrom: undefined, dateTo: undefined })}
      >
        <div className="flex items-center justify-between">
          <TabsList>
            {BANK_TYPES.map((b) => (
              <TabsTrigger key={b} value={b}>{getBankLabel(b)}</TabsTrigger>
            ))}
          </TabsList>
        </div>

        {BANK_TYPES.map((b) => (
          <TabsContent key={b} value={b} className="mt-4">
            <BankTransactionListView bank={b} search={search} updateSearch={updateSearch} />
          </TabsContent>
        ))}
      </Tabs>
    </div>
  );
}

// ============================================
// PER-BANK LIST VIEW
// ============================================

function BankTransactionListView({ bank, search, updateSearch }: {
  bank: string;
  search: FinanceSearchParams;
  updateSearch: (updates: Partial<FinanceSearchParams>) => void;
}) {
  const { user } = useAuth();
  const isAdmin = isAdminUser(user);
  const listFn = useServerFn(listBankTransactionsUnified);
  const queryClient = useQueryClient();
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [batchLoading, setBatchLoading] = useState(false);
  const [showAutoMatch, setShowAutoMatch] = useState(false);
  const [linkingTxn, setLinkingTxn] = useState<{
    id: string; amount: number; unmatchedAmount: number;
    partyId: string | null; partyName: string;
  } | null>(null);

  // Debounced search input
  const { searchInput, setSearchInput } = useDebouncedSearch({
    urlValue: search.search,
    onSync: (value) => updateSearch({ search: value, page: 1 }),
  });

  const status = search.bankStatus && search.bankStatus !== 'all' ? search.bankStatus : undefined;

  const { data, isLoading } = useQuery({
    queryKey: ['finance', 'bank-txns', bank, status, search.direction, search.matchStatus, search.paymentCategory, search.search, search.dateFrom, search.dateTo, search.page],
    queryFn: () =>
      listFn({
        data: {
          bank,
          ...(status ? { status } : {}),
          ...(search.direction ? { direction: search.direction } : {}),
          ...(search.matchStatus && search.matchStatus !== 'all' ? { matchStatus: search.matchStatus } : {}),
          ...(search.paymentCategory ? { category: search.paymentCategory } : {}),
          ...(search.search ? { search: search.search } : {}),
          ...(search.dateFrom ? { dateFrom: search.dateFrom } : {}),
          ...(search.dateTo ? { dateTo: search.dateTo } : {}),
          page: search.page,
          limit: search.limit,
        },
      }),
  });

  // Clear selection when filters/page change
  const filterKey = `${bank}-${status}-${search.direction}-${search.matchStatus}-${search.search}-${search.page}`;
  const prevFilterKeyRef = useRef(filterKey);
  useEffect(() => {
    if (filterKey !== prevFilterKeyRef.current) {
      prevFilterKeyRef.current = filterKey;
      setSelectedIds(new Set());
    }
  }, [filterKey]);

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ['finance'] });
    setSelectedIds(new Set());
  };

  // ---- Single-row actions ----
  const handleSkip = async (txnId: string) => {
    try {
      const res = await fetch('/api/bank-import/skip', {
        method: 'POST', credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ txnId }),
      });
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || 'Failed to skip');
      invalidate();
      setExpandedId(null);
      showSuccess('Transaction skipped');
    } catch (err) {
      showError('Failed to skip transaction', { description: err instanceof Error ? err.message : undefined });
    }
  };

  const handleUnskip = async (txnId: string) => {
    try {
      const res = await fetch('/api/bank-import/unskip', {
        method: 'POST', credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ txnId }),
      });
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || 'Failed to restore');
      invalidate();
      setExpandedId(null);
      showSuccess('Transaction restored');
    } catch (err) {
      showError('Failed to restore', { description: err instanceof Error ? err.message : undefined });
    }
  };

  const [deleteTxnId, setDeleteTxnId] = useState<string | null>(null);

  const handleDelete = async (txnId: string) => {
    try {
      const res = await fetch(`/api/bank-import/${txnId}`, {
        method: 'DELETE', credentials: 'include',
      });
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || 'Failed to delete');
      invalidate();
      setExpandedId(null);
      showSuccess('Transaction deleted');
    } catch (err) {
      showError('Failed to delete', { description: err instanceof Error ? err.message : undefined });
    }
  };

  const handleConfirm = async (txnId: string) => {
    const res = await fetch('/api/bank-import/confirm', {
      method: 'POST', credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ txnId }),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({ error: 'Failed to confirm' }));
      showError('Failed to confirm', { description: err.error || 'Unknown error' });
      return;
    }
    invalidate();
    setExpandedId(null);
    showSuccess('Transaction confirmed');
  };

  // ---- Batch actions ----
  const handleBatchConfirm = async () => {
    if (selectedIds.size === 0) return;
    const count = selectedIds.size;
    setBatchLoading(true);
    try {
      const res = await fetch('/api/bank-import/confirm-batch', {
        method: 'POST', credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ txnIds: [...selectedIds] }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error((err as { error?: string }).error || 'Failed to confirm batch');
      }
      invalidate();
      showSuccess(`${count} transaction${count !== 1 ? 's' : ''} confirmed`);
    } catch (err) {
      showError('Batch confirm failed', { description: err instanceof Error ? err.message : undefined });
    } finally {
      setBatchLoading(false);
    }
  };

  const handleBatchSkip = async () => {
    if (selectedIds.size === 0) return;
    const count = selectedIds.size;
    setBatchLoading(true);
    try {
      const res = await fetch('/api/bank-import/skip-batch', {
        method: 'POST', credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ txnIds: [...selectedIds] }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error((err as { error?: string }).error || 'Failed to skip batch');
      }
      invalidate();
      showSuccess(`${count} transaction${count !== 1 ? 's' : ''} skipped`);
    } catch (err) {
      showError('Batch skip failed', { description: err instanceof Error ? err.message : undefined });
    } finally {
      setBatchLoading(false);
    }
  };

  // ---- Create party inline ----
  const createPartyFn = useServerFn(createFinanceParty);
  const [creatingPartyFor, setCreatingPartyFor] = useState<string | null>(null);

  const handleCreateParty = async (txnId: string, name: string) => {
    setCreatingPartyFor(txnId);
    try {
      const result = await createPartyFn({ data: { name, category: 'other' } });
      if (!result.success) return;
      const assignRes = await fetch('/api/bank-import/assign-party', {
        method: 'POST', credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ txnId, partyId: result.party.id }),
      });
      if (!assignRes.ok) {
        showError('Party created but failed to link to transaction');
        invalidate();
        return;
      }
      invalidate();
      showSuccess('Party created and linked');
    } finally {
      setCreatingPartyFor(null);
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
        <Select value={search.bankStatus ?? 'all'} onValueChange={(v) => updateSearch({ bankStatus: v as FinanceSearchParams['bankStatus'], page: 1 })}>
          <SelectTrigger className="w-[140px]"><SelectValue placeholder="Status" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Statuses</SelectItem>
            {BANK_TXN_FILTER_OPTIONS.map((s) => (
              <SelectItem key={s} value={s} className="capitalize">{s.charAt(0).toUpperCase() + s.slice(1)}</SelectItem>
            ))}
          </SelectContent>
        </Select>

        <Select value={search.direction ?? 'all'} onValueChange={(v) => updateSearch({ direction: v === 'all' ? undefined : v as 'debit' | 'credit', page: 1 })}>
          <SelectTrigger className="w-[130px]"><SelectValue placeholder="Direction" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All</SelectItem>
            <SelectItem value="debit">Outgoing</SelectItem>
            <SelectItem value="credit">Incoming</SelectItem>
          </SelectContent>
        </Select>

        {/* Match status — only shown when viewing confirmed */}
        {search.bankStatus === 'confirmed' && (
          <Select value={search.matchStatus ?? 'all'} onValueChange={(v) => updateSearch({ matchStatus: v === 'all' ? undefined : v as 'unmatched' | 'matched', page: 1 })}>
            <SelectTrigger className="w-[170px]"><SelectValue placeholder="Match Status" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All</SelectItem>
              <SelectItem value="unmatched">Needs Documentation</SelectItem>
              <SelectItem value="matched">Fully Matched</SelectItem>
            </SelectContent>
          </Select>
        )}

        <Select value={search.paymentCategory ?? 'all'} onValueChange={(v) => updateSearch({ paymentCategory: v === 'all' ? undefined : v, page: 1 })}>
          <SelectTrigger className="w-[170px]"><SelectValue placeholder="Category" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Categories</SelectItem>
            {PAYMENT_CATEGORY_FILTERS.map((c) => (
              <SelectItem key={c.code} value={c.code}>{c.label}</SelectItem>
            ))}
          </SelectContent>
        </Select>

        <div className="flex items-center gap-1">
          <Input
            type="date"
            value={search.dateFrom ?? ''}
            onChange={(e) => updateSearch({ dateFrom: e.target.value || undefined, page: 1 })}
            className="w-[130px] h-9"
          />
          <span className="text-muted-foreground text-xs">&ndash;</span>
          <Input
            type="date"
            value={search.dateTo ?? ''}
            onChange={(e) => updateSearch({ dateTo: e.target.value || undefined, page: 1 })}
            className="w-[130px] h-9"
          />
        </div>

        <Input
          placeholder="Search..."
          value={searchInput}
          onChange={(e) => setSearchInput(e.target.value)}
          className="w-[180px]"
        />

        <div className="ml-auto flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => {
              if (!data?.transactions?.length) return;
              const rows: string[][] = [
                ['Date', 'Narration', 'Amount', 'Direction', 'Party', 'Status', 'Category', 'Reference', 'Period', 'Notes'],
              ];
              for (const txn of data.transactions) {
                rows.push([
                  new Date(txn.txnDate).toLocaleDateString('en-IN'),
                  txn.narration ?? '',
                  String(txn.amount),
                  txn.direction,
                  txn.party?.name ?? txn.counterpartyName ?? '',
                  txn.status,
                  txn.category ?? '',
                  txn.reference ?? '',
                  txn.period ?? '',
                  txn.notes ?? '',
                ]);
              }
              downloadCsv(rows, `bank-txns-${bank}-${new Date().toISOString().split('T')[0]}.csv`);
            }}
            disabled={!data?.transactions?.length}
          >
            <Download className="h-4 w-4 mr-1" /> Export
          </Button>
          <Button variant="outline" onClick={() => setShowAutoMatch(true)}>
            <Link2 className="h-4 w-4 mr-1" /> Find Matches
          </Button>
          <Button onClick={() => updateSearch({ bankView: 'import', bankTab: bank as FinanceSearchParams['bankTab'] })}>
            <Upload className="h-4 w-4 mr-1" /> Import Statement
          </Button>
        </div>
      </div>

      {/* Batch action bar */}
      {selectedIds.size > 0 && (
        <div className="flex items-center gap-3 p-2 px-3 bg-blue-50 dark:bg-blue-950/30 border border-blue-200 dark:border-blue-800 rounded-lg text-sm">
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
                  <th className="text-left p-3 font-medium">Category</th>
                  <th className="text-left p-3 font-medium">Invoice</th>
                  <th className="text-left p-3 font-medium">Status</th>
                  <th className="text-left p-3 font-medium w-28">Actions</th>
                </tr>
              </thead>
              <tbody>
                {data?.transactions?.map((txn) => (
                  <BankTxnRow
                    key={txn.id}
                    txn={txn}
                    isExpanded={expandedId === txn.id}
                    isSelected={selectedIds.has(txn.id)}
                    onToggleExpand={() => setExpandedId(expandedId === txn.id ? null : txn.id)}
                    onToggleSelect={() => toggleSelect(txn.id)}
                    onConfirm={() => handleConfirm(txn.id)}
                    onSkip={() => handleSkip(txn.id)}
                    onUnskip={() => handleUnskip(txn.id)}
                    onDelete={() => setDeleteTxnId(txn.id)}
                    onCreateParty={isAdmin ? (name) => handleCreateParty(txn.id, name) : undefined}
                    creatingParty={creatingPartyFor === txn.id}
                    onLink={(info) => setLinkingTxn(info)}
                    onSaved={() => { invalidate(); setExpandedId(null); }}
                    onCloseEdit={() => setExpandedId(null)}
                    queryClient={queryClient}
                  />
                ))}
                {(!data?.transactions || data.transactions.length === 0) && (
                  <tr><td colSpan={9} className="p-8 text-center">
                    <div className="text-muted-foreground space-y-2">
                      <p>{search.search || status || search.direction || search.dateFrom ? 'No transactions match your filters' : 'No bank transactions yet'}</p>
                      {!(search.search || status || search.direction || search.dateFrom) && (
                        <Button variant="outline" size="sm" onClick={() => updateSearch({ bankView: 'import' })} className="mt-2">
                          <Upload className="h-3.5 w-3.5 mr-1" /> Import Bank Statement
                        </Button>
                      )}
                    </div>
                  </td></tr>
                )}
              </tbody>
            </table>
          </div>

          <Pagination page={search.page} total={data?.total ?? 0} limit={search.limit} onPageChange={(p) => updateSearch({ page: p })} />
        </>
      )}

      <AutoMatchDialog open={showAutoMatch} onClose={() => setShowAutoMatch(false)} />
      {linkingTxn && (
        <ManualLinkDialog payment={linkingTxn} onClose={() => setLinkingTxn(null)} />
      )}

      <ConfirmModal
        isOpen={!!deleteTxnId}
        onClose={() => setDeleteTxnId(null)}
        onConfirm={async () => {
          if (deleteTxnId) await handleDelete(deleteTxnId);
          setDeleteTxnId(null);
        }}
        title="Delete Transaction"
        message="Delete this transaction? This action cannot be undone."
        confirmText="Delete"
        confirmVariant="danger"
      />
    </div>
  );
}

// ============================================
// SINGLE ROW — renders differently by status
// ============================================

type TxnFromQuery = NonNullable<Awaited<ReturnType<typeof listBankTransactionsUnified>>['transactions']>[number];

function BankTxnRow({ txn, isExpanded, isSelected, onToggleExpand, onToggleSelect, onConfirm, onSkip, onUnskip, onDelete, onCreateParty, creatingParty, onLink, onSaved, onCloseEdit, queryClient }: {
  txn: TxnFromQuery;
  isExpanded: boolean;
  isSelected: boolean;
  onToggleExpand: () => void;
  onToggleSelect: () => void;
  onConfirm: () => void;
  onSkip: () => void;
  onUnskip: () => void;
  onDelete: () => void;
  onCreateParty?: (name: string) => void;
  creatingParty: boolean;
  onLink: (info: { id: string; amount: number; unmatchedAmount: number; partyId: string | null; partyName: string }) => void;
  onSaved: () => void;
  onCloseEdit: () => void;
  queryClient: ReturnType<typeof useQueryClient>;
}) {
  const isPending = isBankTxnPending(txn.status);
  const isConfirmed = txn.status === 'posted' || txn.status === 'legacy_posted';
  const isSkipped = txn.status === 'skipped';
  const hasAccounts = !!txn.debitAccountCode && !!txn.creditAccountCode;
  const hasParty = !!txn.party;
  const canConfirm = hasAccounts && hasParty;
  const partyName = txn.party?.name ?? txn.counterpartyName ?? '—';
  const category = txn.party?.category ?? txn.category ?? null;
  const inv = txn.allocations?.[0]?.invoice;

  return (
    <Fragment>
      <tr className={`border-t hover:bg-muted/30 ${isExpanded ? 'bg-muted/20' : ''}`}>
        {/* Checkbox */}
        <td className="p-3" onClick={(e) => e.stopPropagation()}>
          {isPending && (
            <input
              type="checkbox"
              checked={isSelected}
              onChange={onToggleSelect}
              className="rounded border-gray-300"
            />
          )}
        </td>

        {/* Date */}
        <td className="p-3 text-xs whitespace-nowrap">
          {new Date(txn.txnDate).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: '2-digit' })}
        </td>

        {/* Narration */}
        <td className="p-3 max-w-[250px]">
          <div className="flex items-center gap-1.5">
            <span className={txn.direction === 'credit' ? 'text-green-600' : 'text-red-500'}>
              {txn.direction === 'credit' ? <ArrowDownLeft className="h-3.5 w-3.5" /> : <ArrowUpRight className="h-3.5 w-3.5" />}
            </span>
            <span className="text-xs truncate" title={txn.narration ?? ''}>{txn.narration ?? '—'}</span>
          </div>
          {(txn.reference || txn.utr) && (
            <div className="font-mono text-[10px] text-muted-foreground mt-0.5 max-w-[220px] truncate" title={txn.reference ?? txn.utr ?? ''}>{txn.reference ?? txn.utr}</div>
          )}
          {/* Inline notes for confirmed */}
          {isConfirmed && (
            <InlinePaymentNotes
              paymentId={txn.id}
              notes={txn.notes}
              onSaved={() => queryClient.invalidateQueries({ queryKey: ['finance'] })}
            />
          )}
        </td>

        {/* Amount */}
        <td className={`p-3 text-right font-mono text-xs whitespace-nowrap ${txn.direction === 'credit' ? 'text-green-600' : ''}`}>
          {txn.direction === 'credit' ? '+' : ''}{formatCurrency(txn.amount)}
        </td>

        {/* Party */}
        <td className="p-3 text-xs max-w-[180px]" onClick={(e) => e.stopPropagation()}>
          {txn.party?.name ? (
            <span className="truncate block" title={txn.party.name}>{txn.party.name}</span>
          ) : txn.counterpartyName ? (
            <span className="inline-flex items-center gap-1">
              <span className="text-amber-600 italic truncate">{txn.counterpartyName}</span>
              {isPending && onCreateParty && (
                <button
                  type="button"
                  className="text-xs text-blue-600 hover:text-blue-800 whitespace-nowrap"
                  onClick={() => onCreateParty(txn.counterpartyName!)}
                  disabled={creatingParty}
                >
                  {creatingParty ? <Loader2 className="h-3 w-3 animate-spin" /> : <Plus className="h-3 w-3" />}
                </button>
              )}
            </span>
          ) : (
            <span className="text-muted-foreground">—</span>
          )}
        </td>

        {/* Category */}
        <td className="p-3">
          {category ? (
            <span className="inline-block bg-muted px-1.5 py-0.5 rounded text-[11px] capitalize">{getCategoryLabel(category)}</span>
          ) : (
            <span className="text-muted-foreground text-xs">—</span>
          )}
        </td>

        {/* Invoice (for confirmed) / Skip reason (for skipped) / Accounts info (for pending) */}
        <td className="p-3 text-xs">
          {isConfirmed && inv ? (
            <div className="flex items-center gap-1">
              <div>
                <div className="font-medium">{inv.invoiceNumber ?? 'Linked'}</div>
                {inv.invoiceDate && (
                  <div className="text-muted-foreground text-[10px]">{new Date(inv.invoiceDate).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })}</div>
                )}
              </div>
              {inv.driveUrl && (
                <a href={inv.driveUrl} target="_blank" rel="noopener noreferrer" className="text-blue-600 hover:text-blue-800 shrink-0" title="View invoice on Drive">
                  <ExternalLink className="h-3 w-3" />
                </a>
              )}
            </div>
          ) : isConfirmed && txn.unmatchedAmount > 0.01 ? (
            <div className="flex items-center gap-1">
              <span className="text-amber-500">None</span>
              <Button
                size="sm"
                variant="ghost"
                className="h-5 w-5 p-0"
                onClick={() => onLink({
                  id: txn.id,
                  amount: txn.amount,
                  unmatchedAmount: txn.unmatchedAmount,
                  partyId: txn.party?.id ?? null,
                  partyName: partyName as string,
                })}
                title="Link to invoice"
              >
                <Link2 className="h-3 w-3 text-blue-600" />
              </Button>
            </div>
          ) : isSkipped ? (
            <span className="text-amber-600 capitalize text-[11px]">{(txn.skipReason ?? 'unknown').replace(/_/g, ' ')}</span>
          ) : isPending ? (
            <span className="text-muted-foreground">
              {hasAccounts ? `${txn.debitAccountCode?.replace(/_/g, ' ')}` : 'No accounts'}
            </span>
          ) : (
            <span className="text-muted-foreground">—</span>
          )}
        </td>

        {/* Status badge */}
        <td className="p-3"><BankStatusBadge status={txn.status} /></td>

        {/* Actions */}
        <td className="p-3" onClick={(e) => e.stopPropagation()}>
          <div className="flex items-center gap-1">
            {isPending && (
              <>
                <button type="button" className="text-xs text-blue-600 hover:text-blue-800" onClick={onToggleExpand} title="Edit">
                  <Pencil className="h-3.5 w-3.5" />
                </button>
                <button
                  type="button"
                  className="text-xs text-green-600 hover:text-green-800 disabled:opacity-30 disabled:cursor-not-allowed"
                  onClick={onConfirm}
                  disabled={!canConfirm}
                  title={!hasParty ? 'Link a party first' : !hasAccounts ? 'Set accounts first' : 'Confirm'}
                >
                  <Check className="h-3.5 w-3.5" />
                </button>
                <button type="button" className="text-xs text-amber-600 hover:text-amber-800" onClick={onSkip} title="Skip">
                  <X className="h-3.5 w-3.5" />
                </button>
              </>
            )}
            {isConfirmed && txn.unmatchedAmount > 0.01 && (
              <button
                type="button"
                className="text-xs text-blue-600 hover:text-blue-800"
                onClick={() => onLink({
                  id: txn.id,
                  amount: txn.amount,
                  unmatchedAmount: txn.unmatchedAmount,
                  partyId: txn.party?.id ?? null,
                  partyName: partyName as string,
                })}
                title="Link to invoice"
              >
                <Link2 className="h-3.5 w-3.5" />
              </button>
            )}
            {isSkipped && (
              <button type="button" className="text-xs text-blue-600 hover:text-blue-800" onClick={onUnskip} title="Restore">
                <History className="h-3.5 w-3.5" />
              </button>
            )}
            {(isPending || isSkipped) && (
              <button type="button" className="text-xs text-red-500 hover:text-red-700" onClick={onDelete} title="Delete">
                <Trash2 className="h-3.5 w-3.5" />
              </button>
            )}
          </div>
        </td>
      </tr>

      {/* Expanded edit row for pending txns */}
      {isExpanded && isPending && (
        <tr className="border-t bg-muted/10">
          <td colSpan={9} className="p-3">
            <BankTxnEditRow txn={txn} onSaved={onSaved} onClose={onCloseEdit} />
          </td>
        </tr>
      )}
    </Fragment>
  );
}

// ============================================
// STATUS BADGE
// ============================================

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

// ============================================
// INLINE PAYMENT NOTES
// ============================================

function InlinePaymentNotes({ paymentId, notes, onSaved }: { paymentId: string; notes: string | null; onSaved: () => void }) {
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(notes ?? '');
  const [saving, setSaving] = useState(false);
  const updateFn = useServerFn(updatePaymentNotes);

  const save = async () => {
    const trimmed = value.trim();
    if (trimmed === (notes ?? '')) { setEditing(false); return; }
    setSaving(true);
    try {
      const result = await updateFn({ data: { id: paymentId, notes: trimmed || null } });
      if (result?.success) {
        onSaved();
      } else {
        showError('Failed to save note');
        setValue(notes ?? '');
      }
    } catch {
      showError('Failed to save note');
      setValue(notes ?? '');
    } finally {
      setSaving(false);
      setEditing(false);
    }
  };

  if (editing) {
    return (
      <input
        className="w-full text-[11px] border-b border-blue-300 bg-transparent outline-none py-0.5 text-muted-foreground"
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onBlur={save}
        onKeyDown={(e) => { if (e.key === 'Enter') save(); if (e.key === 'Escape') setEditing(false); }}
        placeholder="Add narration..."
        autoFocus
        disabled={saving}
      />
    );
  }

  return (
    <button
      type="button"
      className={`text-[11px] text-left w-full truncate flex items-center gap-1 group ${notes ? 'text-muted-foreground' : 'text-muted-foreground/50 italic'} hover:text-foreground`}
      onClick={() => { setEditing(true); setValue(notes ?? ''); }}
      title={notes || 'Click to add narration'}
    >
      <span className="truncate">{notes || 'Add narration...'}</span>
      <Pencil className="h-2.5 w-2.5 shrink-0 opacity-0 group-hover:opacity-50" />
    </button>
  );
}

// ============================================
// INLINE EDIT ROW (for pending txns)
// ============================================

function BankTxnEditRow({ txn, onSaved, onClose }: {
  txn: { id: string; partyId?: string | null; party?: { id: string; name: string } | null; debitAccountCode: string | null; creditAccountCode: string | null; category: string | null; narration: string | null; reference?: string | null; counterpartyName?: string | null; direction: string; bank: string };
  onSaved: () => void;
  onClose: () => void;
}) {
  const [debitAccount, setDebitAccount] = useState(txn.debitAccountCode ?? '');
  const [creditAccount, setCreditAccount] = useState(txn.creditAccountCode ?? '');
  const [category, setCategory] = useState(txn.category ?? '');
  const [saving, setSaving] = useState(false);
  const [selectedParty, setSelectedParty] = useState<{ id: string; name: string } | null>(txn.party ?? null);

  const handleSave = async () => {
    setSaving(true);
    try {
      const body: Record<string, unknown> = { txnId: txn.id };

      if (selectedParty?.id !== (txn.party?.id ?? txn.partyId)) {
        body.partyId = selectedParty?.id ?? null;
      }
      if (debitAccount !== (txn.debitAccountCode ?? '')) body.debitAccountCode = debitAccount || null;
      if (creditAccount !== (txn.creditAccountCode ?? '')) body.creditAccountCode = creditAccount || null;
      if (category !== (txn.category ?? '')) body.category = category || null;

      if (Object.keys(body).length <= 1) { onClose(); return; }

      const res = await fetch('/api/bank-import/update', {
        method: 'PATCH', credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (res.ok) {
        onSaved();
      } else {
        const err = await res.json().catch(() => ({}));
        showError('Failed to save', { description: (err as { error?: string }).error || 'Unknown error' });
      }
    } catch (err) {
      showError('Failed to save', { description: err instanceof Error ? err.message : undefined });
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 gap-3 text-xs">
        <div className="col-span-2">
          <span className="text-muted-foreground">Narration:</span>
          <p className="mt-0.5">{txn.narration ?? '—'}</p>
          {txn.reference && <p className="text-muted-foreground mt-0.5">Ref: {txn.reference}</p>}
        </div>

        <div>
          <Label className="text-xs">Party</Label>
          <div className="relative mt-1">
            <PartySearch value={selectedParty} onChange={setSelectedParty} compact />
          </div>
        </div>

        <div>
          <Label className="text-xs">Category</Label>
          <Select value={category} onValueChange={setCategory}>
            <SelectTrigger className="h-8 text-xs mt-1"><SelectValue placeholder="Select category" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="">None</SelectItem>
              {INVOICE_CATEGORIES.map((c) => (
                <SelectItem key={c} value={c}>{getCategoryLabel(c)}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

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

// ============================================
// IMPORT WIZARD (ported from BankImportTab)
// ============================================

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

function BankImportView({ defaultBank, onBack }: { defaultBank: string; onBack: () => void }) {
  const [step, setStep] = useState<'upload' | 'preview' | 'done'>('upload');
  const [selectedBank, setSelectedBank] = useState<string>(defaultBank);
  const [file, setFile] = useState<File | null>(null);
  const [uploading, setUploading] = useState(false);
  const [bankPreview, setBankPreview] = useState<BankPreviewState | null>(null);
  const [importing, setImporting] = useState(false);
  const [importResult, setImportResult] = useState<{ newRows: number; skippedRows: number } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const queryClient = useQueryClient();

  const handlePreview = async () => {
    if (!file) return;
    setUploading(true);
    setError(null);
    try {
      const formData = new FormData();
      formData.append('file', file);
      formData.append('bank', selectedBank);

      const res = await fetch('/api/bank-import/preview', {
        method: 'POST', credentials: 'include', body: formData,
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || 'Preview failed');

      setBankPreview(json);
      setStep('preview');
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Preview failed');
    } finally {
      setUploading(false);
    }
  };

  const handleImport = async () => {
    if (!file) return;
    setImporting(true);
    setError(null);
    try {
      const formData = new FormData();
      formData.append('file', file);
      formData.append('bank', selectedBank);

      const res = await fetch('/api/bank-import/upload', {
        method: 'POST', credentials: 'include', body: formData,
      });
      const json = await res.json();
      if (!res.ok || !json.success) throw new Error(json.error || 'Import failed');

      setImportResult({ newRows: json.result.newRows, skippedRows: json.result.skippedRows });
      setStep('done');
      queryClient.invalidateQueries({ queryKey: ['finance'] });
    } catch (err: unknown) {
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
                accept=".csv,.xls,.xlsx"
                className="hidden"
                onChange={(e) => setFile(e.target.files?.[0] ?? null)}
              />
              {file ? (
                <span className="text-sm">{file.name} ({(file.size / 1024).toFixed(0)} KB)</span>
              ) : (
                <span className="text-sm text-muted-foreground">Click to select CSV, XLS, or XLSX file</span>
              )}
            </label>
          </div>

          <Button onClick={handlePreview} disabled={!file || uploading}>
            {uploading ? <Loader2 className="h-4 w-4 animate-spin mr-1" /> : <Eye className="h-4 w-4 mr-1" />}
            {uploading ? 'Parsing...' : 'Preview'}
          </Button>
        </div>
      )}

      {step === 'preview' && bankPreview && (
        <div className="border rounded-lg p-4 space-y-3">
          <p className="text-sm text-muted-foreground">{file?.name} ({selectedBank.toUpperCase()})</p>

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
                      className={`border-t ${row.isDuplicate ? 'opacity-40 line-through' : !row.partyId ? 'bg-amber-50' : ''}`}
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
// AUTO-MATCH DIALOG (ported from PaymentsTab)
// ============================================

function AutoMatchDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const queryClient = useQueryClient();
  const suggestFn = useServerFn(getAutoMatchSuggestions);
  const applyFn = useServerFn(applyAutoMatches);

  const { data, isLoading } = useQuery({
    queryKey: ['finance', 'auto-match-suggestions'],
    queryFn: () => suggestFn(),
    enabled: open,
  });

  const highConfidenceKeys = useMemo(() => {
    if (!data?.suggestions) return new Set<string>();
    const keys = new Set<string>();
    for (const group of data.suggestions) {
      for (const m of group.matches) {
        if (m.confidence === 'high') {
          keys.add(`${m.bankTransaction.id}:${m.invoice.id}`);
        }
      }
    }
    return keys;
  }, [data]);

  // Track user overrides (toggled keys) separately from the high-confidence defaults
  const [overrides, setOverrides] = useState<Set<string>>(new Set());

  // Reset overrides when data changes (new suggestions loaded)
  const selected = useMemo(() => {
    const base = new Set(highConfidenceKeys);
    for (const key of overrides) {
      if (base.has(key)) base.delete(key);
      else base.add(key);
    }
    return base;
  }, [highConfidenceKeys, overrides]);

  const toggle = useCallback((key: string) => {
    setOverrides(prev => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }, []);

  const applyMutation = useMutation({
    mutationFn: async () => {
      if (!data?.suggestions) return { success: false as const, matched: 0 as number, errors: ['No data'] };
      const matches: Array<{ bankTransactionId: string; invoiceId: string; amount: number }> = [];
      for (const group of data.suggestions) {
        for (const m of group.matches) {
          if (selected.has(`${m.bankTransaction.id}:${m.invoice.id}`)) {
            matches.push({ bankTransactionId: m.bankTransaction.id, invoiceId: m.invoice.id, amount: m.matchAmount });
          }
        }
      }
      return applyFn({ data: { matches } });
    },
    onSuccess: (result) => {
      if (result?.success) {
        showSuccess(`Matched ${result.matched} payment${result.matched === 1 ? '' : 's'} to invoices`);
        queryClient.invalidateQueries({ queryKey: ['finance'] });
        onClose();
      } else {
        const errors = (result as { errors?: string[] })?.errors;
        showError('Failed to apply matches', { description: errors?.join(', ') });
      }
    },
    onError: (err) => showError('Failed to apply matches', { description: err.message }),
  });

  const selectedCount = selected.size;

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="max-w-3xl max-h-[80vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Auto-Match Payments to Invoices</DialogTitle>
          <DialogDescription>
            Suggested matches based on amount similarity and date proximity.
          </DialogDescription>
        </DialogHeader>

        {isLoading ? (
          <div className="flex items-center justify-center py-8">
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          </div>
        ) : !data?.suggestions?.length ? (
          <div className="text-center py-8 text-muted-foreground">
            No matching suggestions found. All payments are either matched or no invoices are available.
          </div>
        ) : (
          <div className="space-y-6">
            {data.suggestions.map((group) => (
              <div key={group.party.id} className="border rounded-lg">
                <div className="bg-muted/50 px-4 py-2 flex items-center justify-between rounded-t-lg">
                  <div className="font-medium text-sm">{group.party.name}</div>
                  <div className="text-xs text-muted-foreground">
                    {group.matches.length} suggestion{group.matches.length > 1 ? 's' : ''}
                    {group.unmatchedTxns > 0 && ` · ${group.unmatchedTxns} unmatched txn${group.unmatchedTxns > 1 ? 's' : ''}`}
                    {group.unmatchedInvoices > 0 && ` · ${group.unmatchedInvoices} unmatched invoice${group.unmatchedInvoices > 1 ? 's' : ''}`}
                  </div>
                </div>
                <div className="divide-y">
                  {group.matches.map((m) => {
                    const key = `${m.bankTransaction.id}:${m.invoice.id}`;
                    const isSelected = selected.has(key);
                    return (
                      <div key={key} className="px-4 py-3 flex items-start gap-3">
                        <Checkbox
                          checked={isSelected}
                          onCheckedChange={() => toggle(key)}
                          className="mt-1"
                        />
                        <div className="flex-1 min-w-0 grid grid-cols-2 gap-4">
                          <div>
                            <div className="text-xs text-muted-foreground mb-0.5">Payment</div>
                            <div className="font-mono text-sm">{formatCurrency(m.bankTransaction.unmatchedAmount)}</div>
                            <div className="text-xs text-muted-foreground">
                              {new Date(m.bankTransaction.txnDate).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: '2-digit' })}
                              {m.bankTransaction.reference && ` · ${m.bankTransaction.reference.slice(0, 20)}`}
                            </div>
                          </div>
                          <div>
                            <div className="text-xs text-muted-foreground mb-0.5">Invoice</div>
                            <div className="font-mono text-sm">{formatCurrency(m.invoice.balanceDue)}</div>
                            <div className="text-xs text-muted-foreground">
                              {m.invoice.invoiceNumber ?? 'No #'}
                              {m.invoice.billingPeriod && ` · ${formatPeriod(m.invoice.billingPeriod)}`}
                            </div>
                          </div>
                        </div>
                        <div className="flex flex-col items-end gap-1 shrink-0">
                          <span className={`inline-block px-2 py-0.5 rounded-full text-[11px] font-medium ${
                            m.confidence === 'high'
                              ? 'bg-green-100 text-green-700'
                              : 'bg-yellow-100 text-yellow-700'
                          }`}>
                            {m.confidence === 'high' ? 'High' : 'Medium'}
                          </span>
                          {m.amountDiff > 1 && (
                            <span className="text-[11px] text-muted-foreground">{formatCurrency(m.amountDiff)} off</span>
                          )}
                          {m.daysDiff > 0 && (
                            <span className="text-[11px] text-muted-foreground">{m.daysDiff}d apart</span>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button
            onClick={() => applyMutation.mutate()}
            disabled={selectedCount === 0 || applyMutation.isPending}
          >
            {applyMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin mr-1" /> : null}
            Apply {selectedCount} Match{selectedCount !== 1 ? 'es' : ''}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ============================================
// MANUAL LINK DIALOG (ported from PaymentsTab)
// ============================================

function ManualLinkDialog({ payment, onClose }: {
  payment: { id: string; amount: number; unmatchedAmount: number; partyId: string | null; partyName: string };
  onClose: () => void;
}) {
  const queryClient = useQueryClient();
  const searchInvoicesFn = useServerFn(findUnpaidInvoices);
  const applyFn = useServerFn(applyAutoMatches);

  const [search, setSearch] = useState('');
  const debouncedSearch = useDebounce(search, 300);
  const [selectedInvoice, setSelectedInvoice] = useState<string | null>(null);
  const [matchAmount, setMatchAmount] = useState('');

  const { data, isLoading } = useQuery({
    queryKey: ['finance', 'unpaid-invoices', payment.partyId, debouncedSearch],
    queryFn: () => searchInvoicesFn({
      data: {
        ...(payment.partyId && !debouncedSearch ? { partyId: payment.partyId } : {}),
        ...(debouncedSearch ? { search: debouncedSearch } : {}),
      },
    }),
  });

  const invoices = data?.invoices ?? [];
  const selectedInv = invoices.find(i => i.id === selectedInvoice);

  const handleSelect = (inv: typeof invoices[number]) => {
    setSelectedInvoice(inv.id);
    setMatchAmount(String(Math.min(payment.unmatchedAmount, Number(inv.balanceDue))));
  };

  const applyMutation = useMutation({
    mutationFn: () => {
      if (!selectedInvoice || !matchAmount) throw new Error('Select an invoice');
      return applyFn({
        data: {
          matches: [{ bankTransactionId: payment.id, invoiceId: selectedInvoice, amount: Number(matchAmount) }],
        },
      });
    },
    onSuccess: (result) => {
      if (result?.success) {
        showSuccess('Payment linked to invoice');
        queryClient.invalidateQueries({ queryKey: ['finance'] });
        onClose();
      } else {
        const errors = (result as { errors?: string[] })?.errors;
        showError('Failed to link', { description: errors?.join(', ') });
      }
    },
    onError: (err: unknown) => {
      const message = err instanceof Error ? err.message : 'Unknown error';
      showError('Failed to link', { description: message });
    },
  });

  return (
    <Dialog open onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="max-w-lg max-h-[80vh] flex flex-col">
        <DialogHeader>
          <DialogTitle>Link Payment to Invoice</DialogTitle>
          <DialogDescription>
            Select an invoice to link this payment to.
          </DialogDescription>
        </DialogHeader>

        <div className="bg-muted/50 rounded-md px-3 py-2 text-sm flex items-center justify-between">
          <div>
            <span className="font-medium">{payment.partyName}</span>
            <span className="text-muted-foreground ml-2">Unmatched: {formatCurrency(payment.unmatchedAmount)}</span>
          </div>
          <span className="font-mono">{formatCurrency(payment.amount)} total</span>
        </div>

        <Input
          placeholder="Search invoices by number or party..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />

        <div className="flex-1 overflow-y-auto max-h-[300px] border rounded-md divide-y">
          {isLoading ? (
            <div className="flex items-center justify-center py-8">
              <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
            </div>
          ) : invoices.length === 0 ? (
            <div className="text-center py-8 text-sm text-muted-foreground">
              No unpaid invoices found
            </div>
          ) : (
            invoices.map((inv) => {
              const isSelected = selectedInvoice === inv.id;
              return (
                <button
                  key={inv.id}
                  type="button"
                  className={`w-full text-left px-3 py-2.5 text-sm hover:bg-muted/30 transition-colors ${
                    isSelected ? 'bg-blue-50 ring-1 ring-inset ring-blue-200' : ''
                  }`}
                  onClick={() => handleSelect(inv)}
                >
                  <div className="flex items-center justify-between">
                    <div className="min-w-0">
                      <span className="font-medium">{inv.invoiceNumber ?? 'No #'}</span>
                      <span className="text-muted-foreground ml-2 text-xs">{inv.party?.name}</span>
                    </div>
                    <span className="font-mono text-xs shrink-0 ml-2">{formatCurrency(Number(inv.balanceDue))} due</span>
                  </div>
                  <div className="text-xs text-muted-foreground mt-0.5">
                    {inv.invoiceDate ? new Date(inv.invoiceDate).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: '2-digit' }) : ''}
                    {inv.billingPeriod ? ` · ${formatPeriod(inv.billingPeriod)}` : ''}
                  </div>
                </button>
              );
            })
          )}
        </div>

        {selectedInv && (
          <div className="flex items-center gap-3">
            <Label className="shrink-0">Match Amount</Label>
            <Input
              type="number"
              value={matchAmount}
              onChange={(e) => setMatchAmount(e.target.value)}
              className="w-[160px] font-mono"
              step="0.01"
              min="0.01"
              max={Math.min(payment.unmatchedAmount, Number(selectedInv.balanceDue))}
            />
            <span className="text-xs text-muted-foreground">
              max {formatCurrency(Math.min(payment.unmatchedAmount, Number(selectedInv.balanceDue)))}
            </span>
          </div>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button
            onClick={() => applyMutation.mutate()}
            disabled={!selectedInvoice || !matchAmount || Number(matchAmount) <= 0 || applyMutation.isPending}
          >
            {applyMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin mr-1" /> : null}
            Link Payment
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
