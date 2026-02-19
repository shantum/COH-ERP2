/**
 * Bank Import Tab
 *
 * Transaction list with filters, batch actions, inline edit,
 * and a multi-step import wizard (upload -> preview -> done).
 */

import { useState, useCallback, useRef, useEffect, Fragment } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useServerFn } from '@tanstack/react-start';
import { useNavigate } from '@tanstack/react-router';
import { listBankTransactions, createFinanceParty, searchCounterparties } from '../../server/functions/finance';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Label } from '@/components/ui/label';
import { Plus, Check, X, Loader2, AlertCircle, Upload, ArrowLeft, Pencil, Trash2, History, Eye, Download } from 'lucide-react';
import {
  type FinanceSearchParams,
  CHART_OF_ACCOUNTS,
  BANK_TYPES,
  BANK_TXN_FILTER_OPTIONS,
  INVOICE_CATEGORIES,
  getBankLabel,
  getBankStatusLabel,
  getCategoryLabel,
  isBankTxnPending,
} from '@coh/shared';
import { formatCurrency, LoadingState, Pagination, downloadCsv } from './shared';
import { showSuccess, showError } from '../../utils/toast';
import { useDebounce } from '../../hooks/useDebounce';

// ============================================
// BANK IMPORT TAB
// ============================================

export default function BankImportTab({ search }: { search: FinanceSearchParams }) {
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

  // Debounced search input
  const [searchInput, setSearchInput] = useState(search.search ?? '');
  const debouncedSearch = useDebounce(searchInput, 300);
  useEffect(() => {
    if (debouncedSearch !== (search.search ?? '')) {
      updateSearch({ search: debouncedSearch || undefined, page: 1 });
    }
  }, [debouncedSearch]); // eslint-disable-line react-hooks/exhaustive-deps

  const bank = search.bankFilter && search.bankFilter !== 'all' ? search.bankFilter : undefined;
  const status = search.bankStatus && search.bankStatus !== 'all' ? search.bankStatus : undefined;

  const { data, isLoading } = useQuery({
    queryKey: ['finance', 'bank-transactions', bank, status, search.search, search.dateFrom, search.dateTo, search.page],
    queryFn: () =>
      listFn({
        data: {
          ...(bank ? { bank } : {}),
          ...(status ? { status } : {}),
          ...(search.search ? { search: search.search } : {}),
          ...(search.dateFrom ? { dateFrom: search.dateFrom } : {}),
          ...(search.dateTo ? { dateTo: search.dateTo } : {}),
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
    queryClient.invalidateQueries({ queryKey: ['finance', 'summary'] });
    queryClient.invalidateQueries({ queryKey: ['finance', 'alerts'] });
    setSelectedIds(new Set());
  };

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
      showError('Failed to restore transaction', { description: err instanceof Error ? err.message : undefined });
    }
  };

  const handleDelete = async (txnId: string) => {
    if (!confirm('Delete this transaction?')) return;
    try {
      const res = await fetch(`/api/bank-import/${txnId}`, {
        method: 'DELETE', credentials: 'include',
      });
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || 'Failed to delete');
      invalidate();
      setExpandedId(null);
      showSuccess('Transaction deleted');
    } catch (err) {
      showError('Failed to delete transaction', { description: err instanceof Error ? err.message : undefined });
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

  const createPartyFn = useServerFn(createFinanceParty);
  const [creatingPartyFor, setCreatingPartyFor] = useState<string | null>(null);

  const handleCreateParty = async (txnId: string, name: string) => {
    setCreatingPartyFor(txnId);
    try {
      const result = await createPartyFn({ data: { name, category: 'other' } });
      if (!result.success) return;
      // Link the new party to the bank transaction
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
        <Select value={search.bankFilter ?? 'all'} onValueChange={(v) => updateSearch({ bankFilter: v as FinanceSearchParams['bankFilter'], page: 1 })}>
          <SelectTrigger className="w-[150px]"><SelectValue placeholder="Bank" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Banks</SelectItem>
            {BANK_TYPES.map((b) => (
              <SelectItem key={b} value={b}>{getBankLabel(b)}</SelectItem>
            ))}
          </SelectContent>
        </Select>

        <Select value={search.bankStatus ?? 'all'} onValueChange={(v) => updateSearch({ bankStatus: v as FinanceSearchParams['bankStatus'], page: 1 })}>
          <SelectTrigger className="w-[160px]"><SelectValue placeholder="Status" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All</SelectItem>
            {BANK_TXN_FILTER_OPTIONS.map((s) => (
              <SelectItem key={s} value={s} className="capitalize">{s.charAt(0).toUpperCase() + s.slice(1)}</SelectItem>
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
          placeholder="Search narration..."
          value={searchInput}
          onChange={(e) => setSearchInput(e.target.value)}
          className="w-[200px]"
        />

        <div className="ml-auto flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => {
              if (!data?.transactions?.length) return;
              const rows: string[][] = [
                ['Date', 'Narration', 'Amount', 'Direction', 'Party', 'Bank', 'Status', 'Category', 'Reference'],
              ];
              for (const txn of data.transactions) {
                rows.push([
                  new Date(txn.txnDate).toLocaleDateString('en-IN'),
                  txn.narration ?? '',
                  String(txn.amount),
                  txn.direction,
                  txn.party?.name ?? txn.counterpartyName ?? '',
                  txn.bank,
                  txn.status,
                  txn.category ?? '',
                  txn.reference ?? '',
                ]);
              }
              downloadCsv(rows, `bank-transactions-${new Date().toISOString().split('T')[0]}.csv`);
            }}
            disabled={!data?.transactions?.length}
          >
            <Download className="h-4 w-4 mr-1" /> Export
          </Button>
          <Button onClick={() => updateSearch({ bankView: 'import' })}>
            <Upload className="h-4 w-4 mr-1" /> Import New
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
                  const hasParty = !!txn.party;
                  const canConfirm = hasAccounts && hasParty;
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
                          {txn.narration ?? '\u2014'}
                        </td>
                        <td className={`p-3 text-right font-mono text-xs ${txn.direction === 'credit' ? 'text-green-600' : ''}`}>
                          {txn.direction === 'credit' ? '+' : ''}{formatCurrency(txn.amount)}
                        </td>
                        <td className="p-3 text-xs" onClick={(e) => e.stopPropagation()}>
                          {txn.party?.name ? (
                            <span>{txn.party.name}</span>
                          ) : txn.counterpartyName ? (
                            <span className="inline-flex items-center gap-1">
                              <span className="text-amber-600 italic">{txn.counterpartyName}</span>
                              {isPending && (
                                <button
                                  type="button"
                                  className="text-xs text-blue-600 hover:text-blue-800 whitespace-nowrap"
                                  onClick={() => handleCreateParty(txn.id, txn.counterpartyName!)}
                                  disabled={creatingPartyFor === txn.id}
                                >
                                  {creatingPartyFor === txn.id ? <Loader2 className="h-3 w-3 animate-spin" /> : <Plus className="h-3 w-3" />}
                                </button>
                              )}
                            </span>
                          ) : (
                            <span className="text-muted-foreground">\u2014</span>
                          )}
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
                                  disabled={!canConfirm}
                                  title={!hasParty ? 'Link a party first' : !hasAccounts ? 'Set accounts first' : 'Confirm'}
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
                  <tr><td colSpan={8} className="p-8 text-center">
                    <div className="text-muted-foreground space-y-2">
                      <p>{search.search || bank || status || search.dateFrom ? 'No transactions match your filters' : 'No bank transactions yet'}</p>
                      {!(search.search || bank || status || search.dateFrom) && (
                        <Button variant="outline" size="sm" onClick={() => updateSearch({ bankView: 'import' })} className="mt-2">
                          <Upload className="h-3.5 w-3.5 mr-1" /> Import Bank CSV
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
        {/* Full narration */}
        <div className="col-span-2">
          <span className="text-muted-foreground">Narration:</span>
          <p className="mt-0.5">{txn.narration ?? '\u2014'}</p>
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
                  <div className="absolute z-20 top-9 left-0 w-full bg-popover border rounded-md shadow-lg max-h-[150px] overflow-y-auto">
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
          <Select value={category} onValueChange={setCategory}>
            <SelectTrigger className="h-8 text-xs mt-1">
              <SelectValue placeholder="Select category" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="">None</SelectItem>
              {INVOICE_CATEGORIES.map((c) => (
                <SelectItem key={c} value={c}>{getCategoryLabel(c)}</SelectItem>
              ))}
            </SelectContent>
          </Select>
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

// ---- Import View (2-step: upload -> preview -> import -> done) ----

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

  // Step 1: Upload CSV -> preview (no DB write)
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
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Preview failed');
    } finally {
      setUploading(false);
    }
  };

  // Step 2: Confirm -> import to DB
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
      queryClient.invalidateQueries({ queryKey: ['finance', 'summary'] });
      queryClient.invalidateQueries({ queryKey: ['finance', 'alerts'] });
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
                      <td className="p-2 max-w-[250px] truncate" title={row.narration ?? ''}>{row.narration ?? '\u2014'}</td>
                      <td className={`p-2 text-right font-mono whitespace-nowrap ${row.direction === 'credit' ? 'text-green-600' : ''}`}>
                        {row.direction === 'credit' ? '+' : ''}{formatCurrency(row.amount)}
                      </td>
                      <td className="p-2">{row.partyName ?? <span className="text-amber-600">\u2014</span>}</td>
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
