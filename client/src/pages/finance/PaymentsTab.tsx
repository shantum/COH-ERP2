import { useState, useCallback, useRef, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useServerFn } from '@tanstack/react-start';
import { useNavigate } from '@tanstack/react-router';
import { useDebounce } from '../../hooks/useDebounce';
import {
  listPayments, createFinancePayment, updatePaymentNotes,
  getAutoMatchSuggestions, applyAutoMatches, searchCounterparties,
} from '../../server/functions/finance';
import { formatCurrency, formatPeriod, formatStatus, Pagination, LoadingState } from './shared';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Checkbox } from '@/components/ui/checkbox';
import {
  Plus, ArrowUpRight, ArrowDownLeft, X, Loader2,
  ExternalLink, Link2, Building2,
} from 'lucide-react';
import { showSuccess, showError } from '../../utils/toast';
import {
  type FinanceSearchParams,
  PAYMENT_METHODS, PAYMENT_CATEGORY_FILTERS,
  getCategoryLabel,
} from '@coh/shared';

function InlinePaymentNotes({ paymentId, notes, onSaved }: { paymentId: string; notes: string | null; onSaved: () => void }) {
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(notes ?? '');
  const [saving, setSaving] = useState(false);
  const updateFn = useServerFn(updatePaymentNotes);
  const inputRef = useRef<HTMLInputElement>(null);

  const save = async () => {
    const trimmed = value.trim();
    if (trimmed === (notes ?? '')) { setEditing(false); return; }
    setSaving(true);
    try {
      await updateFn({ data: { id: paymentId, notes: trimmed || null } });
      onSaved();
    } finally {
      setSaving(false);
      setEditing(false);
    }
  };

  if (editing) {
    return (
      <input
        ref={inputRef}
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
      className={`text-[11px] text-left w-full truncate ${notes ? 'text-muted-foreground' : 'text-muted-foreground/50 italic'} hover:text-foreground`}
      onClick={() => { setEditing(true); setValue(notes ?? ''); }}
      title={notes || 'Click to add narration'}
    >
      {notes || 'Add narration...'}
    </button>
  );
}

export default function PaymentsTab({ search }: { search: FinanceSearchParams }) {
  const navigate = useNavigate();
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [showAutoMatch, setShowAutoMatch] = useState(false);
  const queryClient = useQueryClient();

  const [searchInput, setSearchInput] = useState(search.search ?? '');
  const debouncedSearch = useDebounce(searchInput, 300);
  useEffect(() => {
    if (debouncedSearch !== (search.search ?? '')) {
      navigate({ to: '/finance', search: { ...search, search: debouncedSearch || undefined, page: 1 }, replace: true });
    }
  }, [debouncedSearch]); // eslint-disable-line react-hooks/exhaustive-deps

  const listFn = useServerFn(listPayments);
  const { data, isLoading } = useQuery({
    queryKey: ['finance', 'payments', search.direction, search.method, search.matchStatus, search.paymentCategory, search.search, search.page],
    queryFn: () =>
      listFn({
        data: {
          ...(search.direction ? { direction: search.direction } : {}),
          ...(search.method ? { method: search.method } : {}),
          ...(search.matchStatus && search.matchStatus !== 'all' ? { matchStatus: search.matchStatus } : {}),
          ...(search.paymentCategory ? { paymentCategory: search.paymentCategory } : {}),
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
              <SelectItem key={m} value={m}>{formatStatus(m)}</SelectItem>
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

        <Select value={search.paymentCategory ?? 'all'} onValueChange={(v) => updateSearch({ paymentCategory: v === 'all' ? undefined : v, page: 1 })}>
          <SelectTrigger className="w-[200px]"><SelectValue placeholder="Category" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Categories</SelectItem>
            {PAYMENT_CATEGORY_FILTERS.map((c) => (
              <SelectItem key={c.code} value={c.code}>{c.label}</SelectItem>
            ))}
          </SelectContent>
        </Select>

        <Input
          placeholder="Search payments..."
          value={searchInput}
          onChange={(e) => setSearchInput(e.target.value)}
          className="w-[200px]"
        />

        <div className="ml-auto flex items-center gap-2">
          <Button variant="outline" onClick={() => setShowAutoMatch(true)}>
            <Link2 className="h-4 w-4 mr-1" /> Find Matches
          </Button>
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
                          <span className="text-xs">{formatStatus(pmt.method)}</span>
                        </div>
                        {pmt.referenceNumber && (
                          <div className="font-mono text-[10px] text-muted-foreground mt-0.5 max-w-[180px] truncate" title={pmt.referenceNumber}>{pmt.referenceNumber}</div>
                        )}
                      </td>
                      <td className="p-3 max-w-[220px]">
                        <div className="truncate font-medium text-xs" title={typeof partyName === 'string' ? partyName : ''}>{partyName}</div>
                        {refundOrderInfo && (
                          <div className="text-[10px] text-muted-foreground mt-0.5">Order {refundOrderInfo}</div>
                        )}
                        <InlinePaymentNotes
                          paymentId={pmt.id}
                          notes={pmt.notes}
                          onSaved={() => queryClient.invalidateQueries({ queryKey: ['finance', 'payments'] })}
                        />
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
                        ) : (
                          <span className={pmt.unmatchedAmount > 0.01 ? 'text-amber-500' : 'text-muted-foreground'}>
                            {pmt.unmatchedAmount > 0.01 ? 'None' : '—'}
                          </span>
                        )}
                      </td>
                      <td className="p-3 text-xs text-muted-foreground">{inv?.billingPeriod ? formatPeriod(inv.billingPeriod) : pmt.period ? formatPeriod(pmt.period) : '—'}</td>
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
      <AutoMatchDialog open={showAutoMatch} onClose={() => setShowAutoMatch(false)} />
    </div>
  );
}

// ============================================
// AUTO-MATCH DIALOG
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

  const [selected, setSelected] = useState<Set<string>>(new Set());

  useEffect(() => {
    if (!data?.suggestions) return;
    const highKeys = new Set<string>();
    for (const group of data.suggestions) {
      for (const m of group.matches) {
        if (m.confidence === 'high') {
          highKeys.add(`${m.payment.id}:${m.invoice.id}`);
        }
      }
    }
    setSelected(highKeys);
  }, [data]);

  const toggle = useCallback((key: string) => {
    setSelected(prev => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }, []);

  const applyMutation = useMutation({
    mutationFn: async () => {
      if (!data?.suggestions) return { success: false as const, matched: 0 as number, errors: ['No data'] };
      const matches: Array<{ paymentId: string; invoiceId: string; amount: number }> = [];
      for (const group of data.suggestions) {
        for (const m of group.matches) {
          if (selected.has(`${m.payment.id}:${m.invoice.id}`)) {
            matches.push({ paymentId: m.payment.id, invoiceId: m.invoice.id, amount: m.matchAmount });
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
                    {group.unmatchedPayments > 0 && ` · ${group.unmatchedPayments} unmatched payment${group.unmatchedPayments > 1 ? 's' : ''}`}
                    {group.unmatchedInvoices > 0 && ` · ${group.unmatchedInvoices} unmatched invoice${group.unmatchedInvoices > 1 ? 's' : ''}`}
                  </div>
                </div>
                <div className="divide-y">
                  {group.matches.map((m) => {
                    const key = `${m.payment.id}:${m.invoice.id}`;
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
                            <div className="font-mono text-sm">{formatCurrency(m.payment.unmatchedAmount)}</div>
                            <div className="text-xs text-muted-foreground">
                              {new Date(m.payment.paymentDate).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: '2-digit' })}
                              {m.payment.referenceNumber && ` · ${m.payment.referenceNumber.slice(0, 20)}`}
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
// CREATE PAYMENT MODAL
// ============================================

function CreatePaymentModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const queryClient = useQueryClient();
  const createFn = useServerFn(createFinancePayment);
  const searchFn = useServerFn(searchCounterparties);

  const [form, setForm] = useState({
    direction: 'outgoing' as 'outgoing' | 'incoming',
    method: 'bank_transfer' as string,
    amount: '',
    referenceNumber: '',
    paymentDate: new Date().toISOString().split('T')[0],
    notes: '',
    partyId: undefined as string | undefined,
  });

  const [partyQuery, setPartyQuery] = useState('');
  const [partyOpen, setPartyOpen] = useState(false);
  const [selectedParty, setSelectedParty] = useState<{ id: string; name: string } | null>(null);

  const { data: partyResults } = useQuery({
    queryKey: ['finance', 'party-search', partyQuery],
    queryFn: () => searchFn({ data: { query: partyQuery, type: 'party' } }),
    enabled: partyQuery.length >= 2,
  });
  const parties = partyResults?.success ? partyResults.results : [];

  const resetForm = () => {
    setForm({
      direction: 'outgoing',
      method: 'bank_transfer',
      amount: '',
      referenceNumber: '',
      paymentDate: new Date().toISOString().split('T')[0],
      notes: '',
      partyId: undefined,
    });
    setSelectedParty(null);
    setPartyQuery('');
  };

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
          ...(form.partyId ? { partyId: form.partyId } : {}),
        },
      }),
    onSuccess: (result) => {
      queryClient.invalidateQueries({ queryKey: ['finance'] });
      if (result?.success) {
        showSuccess('Payment recorded');
        onClose();
        resetForm();
      } else {
        showError('Failed to record payment', { description: (result as { error?: string })?.error });
      }
    },
    onError: (err) => showError('Failed to record payment', { description: err.message }),
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
                    <SelectItem key={m} value={m}>{formatStatus(m)}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          <div className="relative">
            <Label>Party / Vendor</Label>
            {selectedParty ? (
              <div className="flex items-center gap-2 mt-1 p-2 border rounded-md bg-muted/30">
                <Building2 className="h-4 w-4 text-muted-foreground shrink-0" />
                <span className="text-sm font-medium flex-1">{selectedParty.name}</span>
                <button type="button" className="text-muted-foreground hover:text-red-500" onClick={() => { setSelectedParty(null); setForm((f) => ({ ...f, partyId: undefined })); }}>
                  <X className="h-3.5 w-3.5" />
                </button>
              </div>
            ) : (
              <>
                <Input
                  value={partyQuery}
                  onChange={(e) => { setPartyQuery(e.target.value); setPartyOpen(true); }}
                  placeholder="Search vendor..."
                  className="mt-1"
                  onFocus={() => { if (partyQuery.length >= 2) setPartyOpen(true); }}
                  onBlur={() => setTimeout(() => setPartyOpen(false), 200)}
                />
                {partyOpen && partyQuery.length >= 2 && parties.length > 0 && (
                  <div className="absolute z-20 left-0 right-0 mt-1 bg-popover border rounded-md shadow-lg max-h-[180px] overflow-y-auto">
                    {parties.map((p) => (
                      <button key={p.id} type="button" className="block w-full text-left px-3 py-2 text-sm hover:bg-muted/50" onMouseDown={() => { setSelectedParty(p); setForm((f) => ({ ...f, partyId: p.id })); setPartyOpen(false); setPartyQuery(''); }}>
                        {p.name}
                      </button>
                    ))}
                  </div>
                )}
              </>
            )}
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
