import { useState, useCallback, useRef, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useServerFn } from '@tanstack/react-start';
import { useNavigate } from '@tanstack/react-router';
import { useDebounce } from '../../hooks/useDebounce';
import {
  listPayments, updatePaymentNotes,
  getAutoMatchSuggestions, applyAutoMatches,
  findUnpaidInvoices,
} from '../../server/functions/finance';
import { formatCurrency, formatPeriod, Pagination, LoadingState, downloadCsv } from './shared';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import { Checkbox } from '@/components/ui/checkbox';
import {
  ArrowUpRight, ArrowDownLeft, Loader2, Download,
  ExternalLink, Link2, Pencil,
} from 'lucide-react';
import { showSuccess, showError } from '../../utils/toast';
import {
  type FinanceSearchParams,
  PAYMENT_CATEGORY_FILTERS,
  getCategoryLabel,
  getBankLabel,
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
      className={`text-[11px] text-left w-full truncate flex items-center gap-1 group ${notes ? 'text-muted-foreground' : 'text-muted-foreground/50 italic'} hover:text-foreground`}
      onClick={() => { setEditing(true); setValue(notes ?? ''); }}
      title={notes || 'Click to add narration'}
    >
      <span className="truncate">{notes || 'Add narration...'}</span>
      <Pencil className="h-2.5 w-2.5 shrink-0 opacity-0 group-hover:opacity-50" />
    </button>
  );
}

export default function PaymentsTab({ search }: { search: FinanceSearchParams }) {
  const navigate = useNavigate();
  const [showAutoMatch, setShowAutoMatch] = useState(false);
  const [linkingPayment, setLinkingPayment] = useState<{
    id: string; amount: number; unmatchedAmount: number;
    partyId: string | null; partyName: string;
  } | null>(null);
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
    queryKey: ['finance', 'payments', search.direction, search.bank, search.matchStatus, search.paymentCategory, search.search, search.dateFrom, search.dateTo, search.page],
    queryFn: () =>
      listFn({
        data: {
          ...(search.direction ? { direction: search.direction } : {}),
          ...(search.bank ? { bank: search.bank } : {}),
          ...(search.matchStatus && search.matchStatus !== 'all' ? { matchStatus: search.matchStatus } : {}),
          ...(search.paymentCategory ? { paymentCategory: search.paymentCategory } : {}),
          ...(search.search ? { search: search.search } : {}),
          ...(search.dateFrom ? { dateFrom: search.dateFrom } : {}),
          ...(search.dateTo ? { dateTo: search.dateTo } : {}),
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
        <Select value={search.direction ?? 'all'} onValueChange={(v) => updateSearch({ direction: v === 'all' ? undefined : v as 'debit' | 'credit', page: 1 })}>
          <SelectTrigger className="w-[140px]"><SelectValue placeholder="Direction" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All</SelectItem>
            <SelectItem value="debit">Outgoing</SelectItem>
            <SelectItem value="credit">Incoming</SelectItem>
          </SelectContent>
        </Select>

        <Select value={search.bank ?? 'all'} onValueChange={(v) => updateSearch({ bank: v === 'all' ? undefined : v, page: 1 })}>
          <SelectTrigger className="w-[160px]"><SelectValue placeholder="Bank" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Banks</SelectItem>
            <SelectItem value="hdfc">HDFC Bank</SelectItem>
            <SelectItem value="razorpayx">RazorpayX</SelectItem>
            <SelectItem value="hdfc_cc">HDFC CC</SelectItem>
            <SelectItem value="icici_cc">ICICI CC</SelectItem>
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
          placeholder="Search payments..."
          value={searchInput}
          onChange={(e) => setSearchInput(e.target.value)}
          className="w-[200px]"
        />

        <div className="ml-auto flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => {
              if (!data?.payments?.length) return;
              const rows: string[][] = [
                ['Date', 'Direction', 'Bank', 'Party', 'Amount', 'Reference', 'Match Status', 'Period', 'Notes'],
              ];
              for (const pmt of data.payments) {
                rows.push([
                  new Date(pmt.txnDate).toLocaleDateString('en-IN'),
                  pmt.direction,
                  pmt.bank,
                  pmt.party?.name ?? pmt.counterpartyName ?? '',
                  String(pmt.amount),
                  pmt.reference ?? pmt.utr ?? '',
                  pmt.unmatchedAmount > 0.01 ? 'Unmatched' : 'Matched',
                  pmt.period ?? '',
                  pmt.notes ?? '',
                ]);
              }
              downloadCsv(rows, `payments-${new Date().toISOString().split('T')[0]}.csv`);
            }}
            disabled={!data?.payments?.length}
          >
            <Download className="h-4 w-4 mr-1" /> Export
          </Button>
          <Button variant="outline" onClick={() => setShowAutoMatch(true)}>
            <Link2 className="h-4 w-4 mr-1" /> Find Matches
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
                  const partyName = pmt.party?.name ?? pmt.counterpartyName ?? '—';
                  const category = pmt.party?.category ?? pmt.category ?? null;
                  const inv = pmt.allocations?.[0]?.invoice;
                  const gstRate = pmt.party?.transactionType?.defaultGstRate;
                  const gstAmt = gstRate ? Math.round(pmt.amount * gstRate / (100 + gstRate)) : null;
                  const hasTds = !!pmt.party?.tdsApplicable;
                  const tdsRate = pmt.party?.tdsRate;
                  const tdsAmt = hasTds && tdsRate ? Math.round(pmt.amount * tdsRate / 100) : null;

                  return (
                    <tr key={pmt.id} className="border-t hover:bg-muted/30">
                      <td className="p-3 text-xs whitespace-nowrap">{new Date(pmt.txnDate).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: '2-digit' })}</td>
                      <td className="p-3">
                        <div className="flex items-center gap-1.5">
                          <span className={pmt.direction === 'credit' ? 'text-green-600' : 'text-red-500'}>
                            {pmt.direction === 'credit' ? <ArrowDownLeft className="h-3.5 w-3.5" /> : <ArrowUpRight className="h-3.5 w-3.5" />}
                          </span>
                          <span className="text-xs">{getBankLabel(pmt.bank)}</span>
                        </div>
                        {(pmt.reference || pmt.utr) && (
                          <div className="font-mono text-[10px] text-muted-foreground mt-0.5 max-w-[180px] truncate" title={pmt.reference ?? pmt.utr ?? ''}>{pmt.reference ?? pmt.utr}</div>
                        )}
                      </td>
                      <td className="p-3 max-w-[220px]">
                        <div className="truncate font-medium text-xs" title={typeof partyName === 'string' ? partyName : ''}>{partyName}</div>
                        <InlinePaymentNotes
                          paymentId={pmt.id}
                          notes={pmt.notes}
                          onSaved={() => queryClient.invalidateQueries({ queryKey: ['finance', 'payments'] })}
                        />
                        {(() => {
                          if (pmt.notes) return null;
                          const invoiceNotes = pmt.allocations
                            ?.map((a: { invoice: { notes?: string | null } }) => a.invoice?.notes)
                            .filter(Boolean)
                            .join('; ');
                          if (!invoiceNotes) return null;
                          return (
                            <div className="text-[10px] text-blue-500/70 italic truncate mt-0.5" title={invoiceNotes}>
                              via invoice: {invoiceNotes}
                            </div>
                          );
                        })()}
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
                        ) : pmt.unmatchedAmount > 0.01 ? (
                          <div className="flex items-center gap-1">
                            <span className="text-amber-500">None</span>
                            <Button
                              size="sm"
                              variant="ghost"
                              className="h-5 w-5 p-0"
                              onClick={() => setLinkingPayment({
                                id: pmt.id,
                                amount: pmt.amount,
                                unmatchedAmount: pmt.unmatchedAmount,
                                partyId: pmt.party?.id ?? null,
                                partyName: partyName as string,
                              })}
                              title="Link to invoice"
                            >
                              <Link2 className="h-3 w-3 text-blue-600" />
                            </Button>
                          </div>
                        ) : (
                          <span className="text-muted-foreground">—</span>
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
                  <tr><td colSpan={9} className="p-8 text-center">
                    <div className="text-muted-foreground space-y-2">
                      <p>{search.search || search.direction || search.bank || search.matchStatus || search.paymentCategory || search.dateFrom ? 'No payments match your filters' : 'No payments yet'}</p>
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
      {linkingPayment && (
        <ManualLinkDialog payment={linkingPayment} onClose={() => setLinkingPayment(null)} />
      )}
    </div>
  );
}

// ============================================
// MANUAL LINK DIALOG
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

        {/* Payment summary */}
        <div className="bg-muted/50 rounded-md px-3 py-2 text-sm flex items-center justify-between">
          <div>
            <span className="font-medium">{payment.partyName}</span>
            <span className="text-muted-foreground ml-2">Unmatched: {formatCurrency(payment.unmatchedAmount)}</span>
          </div>
          <span className="font-mono">{formatCurrency(payment.amount)} total</span>
        </div>

        {/* Search */}
        <Input
          placeholder="Search invoices by number or party..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />

        {/* Invoice list */}
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

        {/* Match amount */}
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
          highKeys.add(`${m.bankTransaction.id}:${m.invoice.id}`);
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
