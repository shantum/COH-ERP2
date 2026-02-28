import InvoiceDetailModal from './InvoiceDetailModal';
import { useState, useMemo, useCallback, useRef } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useServerFn } from '@tanstack/react-start';
import { useNavigate } from '@tanstack/react-router';
import { useDebouncedSearch } from '../../hooks/useDebouncedSearch';
import {
  listInvoices, confirmInvoice, cancelInvoice, createInvoice, updateInvoice,
  updateInvoiceDueDate, updateInvoiceNotes, findUnmatchedPayments,
} from '../../server/functions/finance';
import { formatCurrency, formatStatus, StatusBadge, Pagination, LoadingState, downloadCsv } from './shared';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import {
  Plus, ArrowUpRight, ArrowDownLeft, Check, X, Loader2, AlertCircle,
  ExternalLink, CloudUpload, Link2, Download, Upload, AlertTriangle, Pencil,
  ArrowUpDown, ArrowUp, ArrowDown, RotateCcw, Send, Banknote,
} from 'lucide-react';
import { PartySearch } from '../../components/finance/PartySearch';
import { showSuccess, showError } from '../../utils/toast';
import {
  type FinanceSearchParams,
  INVOICE_CATEGORIES, INVOICE_STATUSES,
  getCategoryLabel,
} from '@coh/shared';

const CHANNEL_LABELS: Record<string, string> = {
  shopify_online: 'Shopify',
  nykaa: 'Nykaa',
  myntra: 'Myntra',
  ajio: 'Ajio',
  offline: 'Offline',
};

function formatChannelName(channel: string): string {
  return CHANNEL_LABELS[channel] ?? channel.charAt(0).toUpperCase() + channel.slice(1);
}

// ============================================
// INLINE INVOICE NOTES
// ============================================

function InlineInvoiceNotes({ invoiceId, notes, onSaved }: { invoiceId: string; notes: string | null; onSaved: () => void }) {
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(notes ?? '');
  const [saving, setSaving] = useState(false);
  const updateFn = useServerFn(updateInvoiceNotes);
  const inputRef = useRef<HTMLInputElement>(null);

  const save = async () => {
    const trimmed = value.trim();
    if (trimmed === (notes ?? '')) { setEditing(false); return; }
    setSaving(true);
    try {
      const result = await updateFn({ data: { id: invoiceId, notes: trimmed || null } });
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
        placeholder="Add note..."
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
      title={notes || 'Click to add note'}
    >
      <span className="truncate">{notes || 'Add note...'}</span>
      <Pencil className="h-2.5 w-2.5 shrink-0 opacity-0 group-hover:opacity-50" />
    </button>
  );
}

export default function InvoicesTab({ search: rawSearch }: { search: FinanceSearchParams }) {
  // Default to payable if no type selected
  const search = useMemo(
    () => ({ ...rawSearch, type: rawSearch.type ?? 'payable' as const }),
    [rawSearch],
  );
  const isFabricView = search.category === 'fabric';
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [showUploadDialog, setShowUploadDialog] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [cancellingInvoice, setCancellingInvoice] = useState<{ id: string; invoiceNumber: string | null } | null>(null);
  const [confirmingInvoice, setConfirmingInvoice] = useState<{
    id: string; type: string; totalAmount: number;
    party?: { id: string; name: string } | null;
  } | null>(null);
  const [editingInvoice, setEditingInvoice] = useState<NonNullable<typeof data>['invoices'][number] | null>(null);

  const { searchInput, setSearchInput } = useDebouncedSearch({
    urlValue: search.search,
    onSync: (value) => {
      setSelectedIds(new Set());
      navigate({ to: '/finance', search: { ...search, search: value, page: 1 }, replace: true });
    },
  });

  const driveSyncMutation = useMutation({
    mutationFn: async () => {
      const res = await fetch('/api/finance/drive/sync', { method: 'POST', credentials: 'include' });
      if (!res.ok) throw new Error('Drive sync failed');
      return res.json();
    },
    onSuccess: (result) => {
      queryClient.invalidateQueries({ queryKey: ['finance'] });
      showSuccess('Drive sync started', { description: `${result?.synced ?? 0} file(s) queued` });
    },
    onError: (err) => showError('Drive sync failed', { description: err.message }),
  });

  const listFn = useServerFn(listInvoices);
  const { data, isLoading } = useQuery({
    queryKey: ['finance', 'invoices', search.type, search.status, search.category, search.search, search.dateFrom, search.dateTo, search.sortBy, search.sortDir, search.page],
    queryFn: () =>
      listFn({
        data: {
          ...(search.type ? { type: search.type } : {}),
          ...(search.status ? { status: search.status } : {}),
          ...(search.category ? { category: search.category } : {}),
          ...(search.search ? { search: search.search } : {}),
          ...(search.dateFrom ? { dateFrom: search.dateFrom } : {}),
          ...(search.dateTo ? { dateTo: search.dateTo } : {}),
          ...(search.sortBy ? { sortBy: search.sortBy } : {}),
          ...(search.sortDir ? { sortDir: search.sortDir } : {}),
          page: search.page,
          limit: search.limit,
        },
      }),
  });

  const confirmFn = useServerFn(confirmInvoice);
  const cancelFn = useServerFn(cancelInvoice);

  const confirmMutation = useMutation({
    mutationFn: (params: { id: string; linkedBankTransactionId?: string }) => confirmFn({ data: params }),
    onSuccess: (result) => {
      queryClient.invalidateQueries({ queryKey: ['finance'] });
      if (result?.success) {
        setConfirmingInvoice(null);
        showSuccess('Invoice confirmed');
      } else {
        showError('Confirm failed', { description: (result as { error?: string })?.error });
      }
    },
    onError: (err) => showError('Confirm failed', { description: err.message }),
  });

  const cancelMutation = useMutation({
    mutationFn: (id: string) => cancelFn({ data: { id } }),
    onSuccess: (result) => {
      queryClient.invalidateQueries({ queryKey: ['finance'] });
      if (result?.success) showSuccess('Invoice cancelled');
      else showError('Cancel failed', { description: (result as { error?: string })?.error });
    },
    onError: (err) => showError('Cancel failed', { description: err.message }),
  });

  const dueDateFn = useServerFn(updateInvoiceDueDate);
  const dueDateMutation = useMutation({
    mutationFn: (params: { id: string; dueDate: string | null }) => dueDateFn({ data: params }),
    onSuccess: (result) => {
      queryClient.invalidateQueries({ queryKey: ['finance'] });
      if (result?.success) showSuccess('Due date updated');
      else showError('Failed', { description: (result as { error?: string })?.error });
    },
    onError: (err) => showError('Failed to update due date', { description: err.message }),
  });

  const updateSearch = useCallback(
    (updates: Partial<FinanceSearchParams>) => {
      setSelectedIds(new Set());
      navigate({ to: '/finance', search: { ...search, ...updates }, replace: true });
    },
    [navigate, search]
  );

  const toggleSort = useCallback(
    (col: 'createdAt' | 'invoiceDate' | 'billingPeriod' | 'dueDate') => {
      if (search.sortBy === col) {
        if (search.sortDir === 'desc') updateSearch({ sortBy: col, sortDir: 'asc', page: 1 });
        else updateSearch({ sortBy: undefined, sortDir: undefined, page: 1 }); // reset
      } else {
        updateSearch({ sortBy: col, sortDir: 'desc', page: 1 });
      }
    },
    [search.sortBy, search.sortDir, updateSearch]
  );

  const SortIcon = ({ col }: { col: string }) => {
    if (search.sortBy !== col) return <ArrowUpDown className="h-3 w-3 ml-1 opacity-30" />;
    return search.sortDir === 'asc'
      ? <ArrowUp className="h-3 w-3 ml-1 text-blue-600" />
      : <ArrowDown className="h-3 w-3 ml-1 text-blue-600" />;
  };

  const [bulkConfirming, setBulkConfirming] = useState(false);

  const handleBulkConfirm = useCallback(async () => {
    if (selectedIds.size === 0 || !data?.invoices) return;
    const drafts = data.invoices.filter((inv) => selectedIds.has(inv.id) && inv.status === 'draft');
    if (drafts.length === 0) {
      showError('No draft invoices selected');
      return;
    }
    setBulkConfirming(true);
    let successCount = 0;
    for (const inv of drafts) {
      try {
        const result = await confirmFn({ data: { id: inv.id } });
        if (result?.success) successCount++;
      } catch {
        // continue with remaining
      }
    }
    queryClient.invalidateQueries({ queryKey: ['finance'] });
    setBulkConfirming(false);
    setSelectedIds(new Set());
    if (successCount > 0) showSuccess(`${successCount} invoice${successCount !== 1 ? 's' : ''} confirmed`);
    if (successCount < drafts.length) showError(`${drafts.length - successCount} failed to confirm`);
  }, [selectedIds, data?.invoices, confirmFn, queryClient]);

  const selectableInvoices = useMemo(
    () =>
      (data?.invoices ?? []).filter(
        (inv) =>
          inv.type === 'payable' &&
          (inv.status === 'draft' || inv.status === 'confirmed' || inv.status === 'partially_paid') &&
          (inv.status === 'draft' || inv.balanceDue > 0)
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

    const missingBank = selected.filter(
      (inv) => !inv.party?.bankAccountNumber || !inv.party?.bankIfsc
    );
    const valid = selected.filter(
      (inv) => inv.party?.bankAccountNumber && inv.party?.bankIfsc
    );

    if (missingBank.length > 0) {
      const names = missingBank.map((inv) => inv.party?.name ?? 'Unknown').join(', ');
      if (valid.length === 0) {
        showError(`All selected invoices are missing bank details: ${names}`);
        return;
      }
      if (!window.confirm(`${missingBank.length} invoice(s) missing bank details will be skipped: ${names}.\n\nContinue with the remaining ${valid.length}?`)) {
        return;
      }
    }

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

  // ============================================
  // PAY VIA RAZORPAYX
  // ============================================

  const [showPayoutDialog, setShowPayoutDialog] = useState(false);
  const [payoutMode, setPayoutMode] = useState<'IMPS' | 'NEFT' | 'RTGS' | 'UPI'>('IMPS');
  const [payoutProcessing, setPayoutProcessing] = useState(false);

  const handlePayViaRazorpayX = useCallback(async () => {
    if (selectedIds.size === 0 || !data?.invoices) return;

    const selected = data.invoices.filter((inv) =>
      selectedIds.has(inv.id) &&
      inv.type === 'payable' &&
      (inv.status === 'confirmed' || inv.status === 'partially_paid') &&
      inv.balanceDue > 0,
    );

    if (selected.length === 0) {
      showError('No confirmed payable invoices with balance due selected');
      return;
    }

    // Check for missing bank details
    const missingBank = selected.filter(
      (inv) => !inv.party?.bankAccountNumber || !inv.party?.bankIfsc,
    );
    if (missingBank.length > 0 && missingBank.length === selected.length) {
      showError('All selected invoices are missing bank details');
      return;
    }

    setShowPayoutDialog(true);
  }, [selectedIds, data?.invoices]);

  const confirmPayViaRazorpayX = useCallback(async () => {
    if (selectedIds.size === 0 || !data?.invoices) return;

    const selected = data.invoices.filter((inv) =>
      selectedIds.has(inv.id) &&
      inv.type === 'payable' &&
      (inv.status === 'confirmed' || inv.status === 'partially_paid') &&
      inv.balanceDue > 0 &&
      inv.party?.bankAccountNumber &&
      inv.party?.bankIfsc,
    );

    if (selected.length === 0) return;

    setPayoutProcessing(true);

    try {
      const res = await fetch('/api/razorpayx/payout/bulk', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          invoiceIds: selected.map((inv) => inv.id),
          mode: payoutMode,
          queueIfLowBalance: true,
        }),
      });

      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: 'Request failed' }));
        throw new Error(err.error || `HTTP ${res.status}`);
      }

      const result = await res.json() as {
        succeeded: number;
        failed: number;
        results: Array<{ invoiceNumber: string | null; partyName: string | null; success: boolean; error?: string; status?: string }>;
      };

      setShowPayoutDialog(false);
      setSelectedIds(new Set());
      queryClient.invalidateQueries({ queryKey: ['finance'] });

      if (result.succeeded > 0) {
        showSuccess(`${result.succeeded} payout${result.succeeded !== 1 ? 's' : ''} initiated via RazorpayX`);
      }
      if (result.failed > 0) {
        const failedNames = result.results
          .filter((r) => !r.success)
          .map((r) => `${r.partyName || r.invoiceNumber}: ${r.error}`)
          .join('\n');
        showError(`${result.failed} payout${result.failed !== 1 ? 's' : ''} failed`, { description: failedNames });
      }
    } catch (err) {
      showError('Payout failed', { description: err instanceof Error ? err.message : String(err) });
    } finally {
      setPayoutProcessing(false);
    }
  }, [selectedIds, data?.invoices, payoutMode, queryClient]);

  // Pre-compute payout summary for the dialog
  const payoutSummary = useMemo(() => {
    if (!data?.invoices || selectedIds.size === 0) return null;
    const selected = data.invoices.filter((inv) =>
      selectedIds.has(inv.id) &&
      inv.type === 'payable' &&
      (inv.status === 'confirmed' || inv.status === 'partially_paid') &&
      inv.balanceDue > 0,
    );
    const withBank = selected.filter((inv) => inv.party?.bankAccountNumber && inv.party?.bankIfsc);
    const withoutBank = selected.filter((inv) => !inv.party?.bankAccountNumber || !inv.party?.bankIfsc);
    const totalAmount = withBank.reduce((sum, inv) => sum + inv.balanceDue, 0);
    return { total: selected.length, withBank, withoutBank, totalAmount };
  }, [selectedIds, data?.invoices]);

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
      {/* Payable / Receivable sub-tabs */}
      <div className="flex items-center gap-1 border-b">
        <button
          className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${
            search.type === 'payable'
              ? 'border-red-500 text-red-600'
              : 'border-transparent text-muted-foreground hover:text-foreground'
          }`}
          onClick={() => updateSearch({ type: 'payable', page: 1 })}
        >
          <span className="inline-flex items-center gap-1.5">
            <ArrowUpRight className="h-3.5 w-3.5" />
            Payable
          </span>
        </button>
        <button
          className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${
            search.type === 'receivable'
              ? 'border-green-500 text-green-600'
              : 'border-transparent text-muted-foreground hover:text-foreground'
          }`}
          onClick={() => updateSearch({ type: 'receivable', page: 1 })}
        >
          <span className="inline-flex items-center gap-1.5">
            <ArrowDownLeft className="h-3.5 w-3.5" />
            Receivable
          </span>
        </button>
      </div>

      {/* Filters */}
      <div className="flex flex-wrap items-center gap-2">
        <Select value={search.status ?? 'all'} onValueChange={(v) => updateSearch({ status: v === 'all' ? undefined : v, page: 1 })}>
          <SelectTrigger className="w-[160px]"><SelectValue placeholder="Status" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Statuses</SelectItem>
            {INVOICE_STATUSES.map((s) => (
              <SelectItem key={s} value={s}>{formatStatus(s)}</SelectItem>
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
          placeholder="Search invoices..."
          value={searchInput}
          onChange={(e) => setSearchInput(e.target.value)}
          className="w-[200px]"
        />

        {search.sortBy && (
          <Button
            variant="ghost"
            size="sm"
            className="text-xs text-muted-foreground"
            onClick={() => updateSearch({ sortBy: undefined, sortDir: undefined, page: 1 })}
          >
            <RotateCcw className="h-3 w-3 mr-1" /> Reset Sort
          </Button>
        )}

        <div className="ml-auto flex items-center gap-2">
          {selectedIds.size > 0 && (
            <>
              <Button
                variant="outline"
                onClick={handleBulkConfirm}
                disabled={bulkConfirming || !data?.invoices?.some((inv) => selectedIds.has(inv.id) && inv.status === 'draft')}
              >
                {bulkConfirming ? <Loader2 className="h-4 w-4 animate-spin mr-1" /> : <Check className="h-4 w-4 mr-1" />}
                Confirm Selected
              </Button>
              <Button variant="outline" onClick={handleDownloadPayoutCsv}>
                <Download className="h-4 w-4 mr-1" /> Payout CSV ({selectedIds.size})
              </Button>
              <Button
                variant="default"
                onClick={handlePayViaRazorpayX}
                disabled={!data?.invoices?.some(
                  (inv) =>
                    selectedIds.has(inv.id) &&
                    inv.type === 'payable' &&
                    (inv.status === 'confirmed' || inv.status === 'partially_paid') &&
                    inv.balanceDue > 0,
                )}
              >
                <Send className="h-4 w-4 mr-1" /> Pay via RazorpayX ({selectedIds.size})
              </Button>
            </>
          )}
          <Button
            variant="outline"
            size="sm"
            onClick={() => {
              if (!data?.invoices?.length) return;
              const rows: string[][] = [
                ['Date Added', 'Invoice #', 'Type', 'Category', 'Party', 'Notes', 'Total', 'Balance Due', 'TDS', 'Status', 'Invoice Date', 'Billing Period', 'Due Date'],
              ];
              for (const inv of data.invoices) {
                rows.push([
                  new Date(inv.createdAt).toLocaleDateString('en-IN'),
                  inv.invoiceNumber ?? '',
                  inv.type,
                  inv.category,
                  inv.party?.name ?? (inv.customer ? [inv.customer.firstName, inv.customer.lastName].filter(Boolean).join(' ') || inv.customer.email : null) ?? (inv.order?.channel ? formatChannelName(inv.order.channel) : '') ?? '',
                  inv.notes ?? '',
                  String(inv.totalAmount),
                  String(inv.balanceDue),
                  String(inv.tdsAmount ?? 0),
                  inv.status,
                  inv.invoiceDate ? new Date(inv.invoiceDate).toLocaleDateString('en-IN') : '',
                  inv.billingPeriod ?? '',
                  inv.dueDate ? new Date(inv.dueDate).toLocaleDateString('en-IN') : '',
                ]);
              }
              downloadCsv(rows, `invoices-${new Date().toISOString().split('T')[0]}.csv`);
            }}
            disabled={!data?.invoices?.length}
          >
            <Download className="h-4 w-4 mr-1" /> Export
          </Button>
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
                  <th className="text-left p-3 font-medium cursor-pointer select-none hover:text-blue-600" onClick={() => toggleSort('createdAt')}>
                    <span className="inline-flex items-center">Date Added<SortIcon col="createdAt" /></span>
                  </th>
                  <th className="text-left p-3 font-medium">Party</th>
                  <th className="text-left p-3 font-medium max-w-[180px]">Notes</th>
                  {!isFabricView && <th className="text-left p-3 font-medium">Category</th>}
                  {isFabricView && <th className="text-left p-3 font-medium">Fabrics</th>}
                  <th className="text-left p-3 font-medium">Invoice #</th>
                  <th className="text-left p-3 font-medium cursor-pointer select-none hover:text-blue-600" onClick={() => toggleSort('invoiceDate')}>
                    <span className="inline-flex items-center">Invoice Date<SortIcon col="invoiceDate" /></span>
                  </th>
                  <th className="text-left p-3 font-medium cursor-pointer select-none hover:text-blue-600" onClick={() => toggleSort('billingPeriod')}>
                    <span className="inline-flex items-center">Period<SortIcon col="billingPeriod" /></span>
                  </th>
                  <th className="text-left p-3 font-medium cursor-pointer select-none hover:text-blue-600" onClick={() => toggleSort('dueDate')}>
                    <span className="inline-flex items-center">Due Date<SortIcon col="dueDate" /></span>
                  </th>
                  <th className="text-right p-3 font-medium">Amount</th>
                  <th className="text-left p-3 font-medium">Status</th>
                  <th className="text-right p-3 font-medium">Balance Due</th>
                  <th className="text-right p-3 font-medium">Actions</th>
                </tr>
              </thead>
              <tbody>
                {data?.invoices?.map((inv) => {
                  const isSelectable =
                    inv.type === 'payable' &&
                    (inv.status === 'draft' || inv.status === 'confirmed' || inv.status === 'partially_paid') &&
                    (inv.status === 'draft' || inv.balanceDue > 0);
                  return (
                  <tr
                    key={inv.id}
                    className="border-t hover:bg-muted/30 cursor-pointer"
                    onClick={() => navigate({ to: '/finance', search: { ...search, modal: 'view-invoice', modalId: inv.id }, replace: true })}
                  >
                    <td className="p-3" onClick={(e) => e.stopPropagation()}>
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
                    <td className="p-3 text-xs text-muted-foreground">{new Date(inv.createdAt).toLocaleDateString('en-IN')}</td>
                    <td className="p-3">
                      {inv.party?.name ??
                        (inv.customer ? [inv.customer.firstName, inv.customer.lastName].filter(Boolean).join(' ') || inv.customer.email : null) ??
                        (inv.order?.channel ? formatChannelName(inv.order.channel) : null) ??
                        '—'}
                    </td>
                    <td className="p-3 max-w-[180px]" onClick={(e) => e.stopPropagation()}>
                      {inv.status !== 'cancelled' ? (
                        <InlineInvoiceNotes
                          invoiceId={inv.id}
                          notes={inv.notes}
                          onSaved={() => queryClient.invalidateQueries({ queryKey: ['finance'] })}
                        />
                      ) : (
                        <span className="text-[11px] text-muted-foreground truncate block">{inv.notes || '—'}</span>
                      )}
                    </td>
                    {!isFabricView && <td className="p-3 text-xs">{getCategoryLabel(inv.category)}</td>}
                    {isFabricView && (
                      <td className="p-3 max-w-[220px]">
                        {(() => {
                          const lines = (inv as Record<string, unknown>).lines as Array<{
                            id: string; description: string | null; qty: number | null; unit: string | null;
                            fabricColourId: string | null;
                            fabricColour: { colourName: string; code: string | null; fabric: { name: string } } | null;
                          }> | undefined;
                          if (!lines?.length) return <span className="text-xs text-muted-foreground">No lines</span>;
                          const matched = lines.filter(l => l.fabricColour);
                          const unmatched = lines.length - matched.length;
                          return (
                            <div className="space-y-0.5">
                              {matched.map(l => (
                                <div key={l.id} className="flex items-center gap-1 text-[11px] leading-tight">
                                  <span className="truncate font-medium">{l.fabricColour!.fabric.name}</span>
                                  <span className="text-muted-foreground">·</span>
                                  <span className="truncate text-muted-foreground">{l.fabricColour!.colourName}</span>
                                  {l.qty != null && (
                                    <span className="shrink-0 text-muted-foreground ml-auto tabular-nums">{l.qty}{l.unit === 'meter' ? 'm' : l.unit ?? ''}</span>
                                  )}
                                </div>
                              ))}
                              {unmatched > 0 && (
                                <div className="text-[10px] text-amber-600">{unmatched} unmatched</div>
                              )}
                            </div>
                          );
                        })()}
                      </td>
                    )}
                    <td className="p-3 font-mono text-xs">{inv.invoiceNumber ?? '—'}</td>
                    <td className="p-3 text-xs text-muted-foreground">{inv.invoiceDate ? new Date(inv.invoiceDate).toLocaleDateString('en-IN') : '—'}</td>
                    <td className="p-3 text-xs text-muted-foreground">{inv.billingPeriod ?? '—'}</td>
                    <td className="p-3" onClick={(e) => e.stopPropagation()}>
                      {inv.status !== 'cancelled' ? (
                        <div className="flex flex-col gap-0.5">
                          <input
                            type="date"
                            className="text-xs text-muted-foreground bg-transparent border-0 border-b border-transparent hover:border-muted-foreground/30 focus:border-blue-500 focus:outline-none cursor-pointer px-0 py-0.5 w-[110px]"
                            value={inv.dueDate ? new Date(inv.dueDate).toISOString().split('T')[0] : ''}
                            onChange={(e) => {
                              dueDateMutation.mutate({ id: inv.id, dueDate: e.target.value || null });
                            }}
                          />
                          {inv.dueDate && inv.status !== 'paid' && (() => {
                            const today = new Date(); today.setHours(0, 0, 0, 0);
                            const due = new Date(inv.dueDate); due.setHours(0, 0, 0, 0);
                            const diffDays = Math.round((due.getTime() - today.getTime()) / 86400000);
                            if (diffDays < 0) return <span className="text-[10px] text-red-500 font-medium">overdue by {Math.abs(diffDays)}d</span>;
                            if (diffDays === 0) return <span className="text-[10px] text-amber-500 font-medium">due today</span>;
                            if (diffDays <= 7) return <span className="text-[10px] text-amber-500">in {diffDays}d</span>;
                            return <span className="text-[10px] text-muted-foreground">in {diffDays}d</span>;
                          })()}
                        </div>
                      ) : (
                        <span className="text-xs text-muted-foreground">{inv.dueDate ? new Date(inv.dueDate).toLocaleDateString('en-IN') : '—'}</span>
                      )}
                    </td>
                    <td className="p-3 text-right font-mono">{formatCurrency(inv.totalAmount)}</td>
                    <td className="p-3"><StatusBadge status={inv.status} /></td>
                    <td className="p-3 text-right">
                      <span className="font-mono">{formatCurrency(inv.balanceDue)}</span>
                      {inv.tdsAmount != null && inv.tdsAmount > 0 && (
                        <span className="block text-[10px] text-muted-foreground">TDS: {formatCurrency(inv.tdsAmount)}</span>
                      )}
                    </td>
                    <td className="p-3 text-right" onClick={(e) => e.stopPropagation()}>
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
                              onClick={() => setEditingInvoice(inv)}
                              title="Edit"
                            >
                              <Pencil className="h-3.5 w-3.5 text-blue-600" />
                            </Button>
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
                              onClick={() => setCancellingInvoice({ id: inv.id, invoiceNumber: inv.invoiceNumber })}
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
                  <tr><td colSpan={13} className="p-8 text-center">
                    <div className="text-muted-foreground space-y-2">
                      <p>{search.search || search.status || search.category || search.dateFrom ? 'No invoices match your filters' : `No ${search.type} invoices yet`}</p>
                      {!(search.search || search.status || search.category || search.dateFrom) && (
                        <div className="flex items-center justify-center gap-2 mt-2">
                          <Button variant="outline" size="sm" onClick={() => setShowUploadDialog(true)}>
                            <Upload className="h-3.5 w-3.5 mr-1" /> Upload Invoice
                          </Button>
                          <Button variant="outline" size="sm" onClick={() => setShowCreateModal(true)}>
                            <Plus className="h-3.5 w-3.5 mr-1" /> Create Invoice
                          </Button>
                        </div>
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

      <CreateInvoiceModal open={showCreateModal} onClose={() => setShowCreateModal(false)} />
      {editingInvoice && (
        <CreateInvoiceModal
          open={!!editingInvoice}
          onClose={() => setEditingInvoice(null)}
          editInvoice={editingInvoice}
        />
      )}
      <UploadInvoiceDialog
        open={showUploadDialog}
        onClose={() => setShowUploadDialog(false)}
        onSuccess={() => queryClient.invalidateQueries({ queryKey: ['finance'] })}
      />
      {confirmingInvoice && (
        <ConfirmPayableDialog
          invoice={confirmingInvoice}
          isPending={confirmMutation.isPending}
          onConfirm={(linkedBankTransactionId) => confirmMutation.mutate({ id: confirmingInvoice.id, linkedBankTransactionId })}
          onClose={() => setConfirmingInvoice(null)}
        />
      )}
      {cancellingInvoice && (
        <Dialog open={!!cancellingInvoice} onOpenChange={(o) => { if (!o) setCancellingInvoice(null); }}>
          <DialogContent className="max-w-sm">
            <DialogHeader>
              <DialogTitle>Cancel Invoice</DialogTitle>
              <DialogDescription>
                Cancel invoice {cancellingInvoice.invoiceNumber || cancellingInvoice.id.slice(0, 8)}? This will unmatch any linked payments.
              </DialogDescription>
            </DialogHeader>
            <DialogFooter>
              <Button variant="outline" onClick={() => setCancellingInvoice(null)}>Keep Invoice</Button>
              <Button
                variant="destructive"
                onClick={() => { cancelMutation.mutate(cancellingInvoice.id); setCancellingInvoice(null); }}
                disabled={cancelMutation.isPending}
              >
                {cancelMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin mr-1" /> : null}
                Cancel Invoice
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}
      {search.modal === 'view-invoice' && search.modalId && (
        <InvoiceDetailModal
          invoiceId={search.modalId}
          open
          onClose={() => navigate({ to: '/finance', search: { ...search, modal: undefined, modalId: undefined }, replace: true })}
        />
      )}

      {/* Pay via RazorpayX confirmation dialog */}
      <Dialog open={showPayoutDialog} onOpenChange={(o) => { if (!o && !payoutProcessing) setShowPayoutDialog(false); }}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Banknote className="h-5 w-5" />
              Pay via RazorpayX
            </DialogTitle>
            <DialogDescription>
              Initiate payouts for the selected invoices. Funds will be debited from your RazorpayX account.
            </DialogDescription>
          </DialogHeader>

          {payoutSummary && (
            <div className="space-y-3 text-sm">
              <div className="rounded-md bg-muted p-3 space-y-1.5">
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Invoices to pay</span>
                  <span className="font-medium">{payoutSummary.withBank.length}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Total amount</span>
                  <span className="font-semibold text-base">{formatCurrency(payoutSummary.totalAmount)}</span>
                </div>
              </div>

              {payoutSummary.withoutBank.length > 0 && (
                <div className="flex items-start gap-2 text-amber-600 bg-amber-50 p-2 rounded text-xs">
                  <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5" />
                  <span>
                    {payoutSummary.withoutBank.length} invoice{payoutSummary.withoutBank.length !== 1 ? 's' : ''} skipped (missing bank details):
                    {' '}{payoutSummary.withoutBank.map((inv) => inv.party?.name ?? 'Unknown').join(', ')}
                  </span>
                </div>
              )}

              <div className="space-y-1.5">
                <Label className="text-xs text-muted-foreground">Transfer mode</Label>
                <Select value={payoutMode} onValueChange={(v) => setPayoutMode(v as typeof payoutMode)}>
                  <SelectTrigger className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="IMPS">IMPS (Instant)</SelectItem>
                    <SelectItem value="NEFT">NEFT (30 min batches)</SelectItem>
                    <SelectItem value="RTGS">RTGS (Real-time, min 2L)</SelectItem>
                    <SelectItem value="UPI">UPI</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              {payoutSummary.withBank.length > 0 && (
                <div className="text-xs text-muted-foreground border rounded p-2 max-h-32 overflow-y-auto space-y-1">
                  {payoutSummary.withBank.map((inv) => (
                    <div key={inv.id} className="flex justify-between">
                      <span className="truncate mr-2">{inv.party?.name ?? 'Unknown'} — {inv.invoiceNumber || inv.id.slice(0, 8)}</span>
                      <span className="shrink-0 font-mono">{formatCurrency(inv.balanceDue)}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          <DialogFooter>
            <Button variant="outline" onClick={() => setShowPayoutDialog(false)} disabled={payoutProcessing}>
              Cancel
            </Button>
            <Button
              onClick={confirmPayViaRazorpayX}
              disabled={payoutProcessing || !payoutSummary || payoutSummary.withBank.length === 0}
            >
              {payoutProcessing ? <Loader2 className="h-4 w-4 animate-spin mr-1" /> : <Send className="h-4 w-4 mr-1" />}
              {payoutProcessing
                ? 'Processing...'
                : `Pay ${payoutSummary ? formatCurrency(payoutSummary.totalAmount) : ''}`}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

// ============================================
// CONFIRM PAYABLE DIALOG
// ============================================

function ConfirmPayableDialog({ invoice, isPending, onConfirm, onClose }: {
  invoice: { id: string; totalAmount: number; party?: { id: string; name: string } | null };
  isPending: boolean;
  onConfirm: (linkedBankTransactionId?: string) => void;
  onClose: () => void;
}) {
  const [selectedTxnId, setSelectedTxnId] = useState<string | null>(null);
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
                        selectedTxnId === pmt.id
                          ? 'border-blue-500 bg-blue-50 dark:bg-blue-950'
                          : 'hover:bg-muted/50'
                      }`}
                      onClick={() => setSelectedTxnId(selectedTxnId === pmt.id ? null : pmt.id)}
                    >
                      <div className="flex items-center justify-between">
                        <span className="font-medium">{formatCurrency(pmt.amount)}</span>
                        <span className="text-xs text-muted-foreground">
                          {new Date(pmt.txnDate).toLocaleDateString('en-IN')}
                        </span>
                      </div>
                      <div className="flex items-center justify-between mt-1 text-xs text-muted-foreground">
                        <span>{pmt.party?.name ?? '—'}</span>
                        <span>{pmt.reference ?? pmt.utr ?? pmt.bank}</span>
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
            {isPending && !selectedTxnId ? <Loader2 className="h-4 w-4 animate-spin mr-1" /> : null}
            Confirm (no link)
          </Button>
          {selectedTxnId && (
            <Button
              onClick={() => onConfirm(selectedTxnId)}
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

interface DuplicateInfo {
  reason: 'file_hash' | 'invoice_number';
  existingInvoiceId: string;
  existingInvoiceNumber: string | null;
  partyName: string | null;
  fileName: string | null;
}

interface NearDuplicate {
  invoiceId: string;
  invoiceNumber: string | null;
  totalAmount: number;
  invoiceDate: string | null;
  partyName: string | null;
}

interface InvoiceValidationWarning {
  type: 'company_name' | 'gst_number' | 'gst_calculation';
  severity: 'error' | 'warning';
  message: string;
  details?: string;
}

interface InvoicePreview {
  previewId: string;
  nearDuplicates?: NearDuplicate[];
  validationWarnings?: InvoiceValidationWarning[];
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
    gstType?: 'igst' | 'cgst_sgst' | null;
    subtotal?: number | null;
    gstAmount?: number | null;
    cgstAmount?: number | null;
    sgstAmount?: number | null;
    igstAmount?: number | null;
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
  fabricMatches?: Array<{
    lineIndex: number;
    fabricColourId: string | null;
    matchedTxnId: string | null;
    matchType: 'auto_matched' | null;
    fabricMatchScore: number;
  }>;
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
  const [dragOver, setDragOver] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [duplicate, setDuplicate] = useState<DuplicateInfo | null>(null);
  const [preview, setPreview] = useState<InvoicePreview | null>(null);
  const [result, setResult] = useState<InvoiceConfirmResult | null>(null);
  const [edits, setEdits] = useState<{
    invoiceNumber: string;
    invoiceDate: string;
    totalAmount: string;
    gstAmount: string;
    subtotal: string;
    billingPeriod: string;
    category: string;
  }>({ invoiceNumber: '', invoiceDate: '', totalAmount: '', gstAmount: '', subtotal: '', billingPeriod: '', category: '' });

  const handleUpload = async () => {
    if (!file) return;
    setUploading(true);
    setError(null);
    setPreview(null);
    setDuplicate(null);
    try {
      const formData = new FormData();
      formData.append('file', file);
      const res = await fetch('/api/finance/upload-preview', { method: 'POST', credentials: 'include', body: formData });
      const json = await res.json();
      if (res.status === 409 && json.duplicate) {
        setDuplicate(json);
        return;
      }
      if (!res.ok) throw new Error(json.error || 'Upload failed');
      setPreview(json);
      setEdits({
        invoiceNumber: json.parsed?.invoiceNumber ?? '',
        invoiceDate: json.parsed?.invoiceDate ?? '',
        totalAmount: json.parsed?.totalAmount != null ? String(json.parsed.totalAmount) : '',
        gstAmount: json.parsed?.gstAmount != null ? String(json.parsed.gstAmount) : '',
        subtotal: json.parsed?.subtotal != null ? String(json.parsed.subtotal) : '',
        billingPeriod: json.parsed?.billingPeriod ?? '',
        category: json.partyMatch?.category ?? 'other',
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Upload failed');
    } finally {
      setUploading(false);
    }
  };

  const handleConfirm = async () => {
    if (!preview) return;
    setConfirming(true);
    setError(null);
    try {
      const res = await fetch(`/api/finance/confirm-preview/${preview.previewId}`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...(edits.invoiceNumber ? { invoiceNumber: edits.invoiceNumber } : {}),
          ...(edits.invoiceDate ? { invoiceDate: edits.invoiceDate } : {}),
          ...(edits.totalAmount ? { totalAmount: Number(edits.totalAmount) } : {}),
          ...(edits.gstAmount ? { gstAmount: Number(edits.gstAmount) } : {}),
          ...(edits.subtotal ? { subtotal: Number(edits.subtotal) } : {}),
          ...(edits.billingPeriod ? { billingPeriod: edits.billingPeriod } : {}),
          ...(edits.category ? { category: edits.category } : {}),
        }),
      });
      const json = await res.json();
      if (res.status === 410) { setError('Preview expired, please re-upload'); setPreview(null); return; }
      if (res.status === 409 && json.duplicate) { setPreview(null); setDuplicate(json); return; }
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

  const handleClose = () => { setFile(null); setError(null); setDuplicate(null); setPreview(null); setResult(null); setEdits({ invoiceNumber: '', invoiceDate: '', totalAmount: '', gstAmount: '', subtotal: '', billingPeriod: '', category: '' }); onClose(); };

  const p = preview?.parsed;
  const lines = p?.lines ?? [];

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) handleClose(); }}>
      <DialogContent className={preview && !result ? 'max-w-2xl' : 'max-w-md'}>
        <DialogHeader>
          <DialogTitle>{duplicate ? 'Duplicate Detected' : result ? 'Invoice Created' : preview ? 'Review Invoice' : 'Upload Invoice'}</DialogTitle>
          <DialogDescription>
            {duplicate ? 'This invoice already exists in the system.' : result ? 'Draft saved successfully.' : preview ? 'Check the extracted details before saving.' : 'Upload a PDF or image and we will extract the details automatically.'}
          </DialogDescription>
        </DialogHeader>

        {error && (
          <div className="border border-red-300 bg-red-50 text-red-700 rounded-lg p-3 text-sm flex items-center gap-2">
            <AlertCircle className="h-4 w-4 shrink-0" /> {error}
          </div>
        )}

        {/* Duplicate block */}
        {duplicate && (
          <div className="space-y-3">
            <div className="border border-red-300 bg-red-50 rounded-lg p-4 space-y-2">
              <div className="flex items-start gap-2 text-red-700">
                <AlertCircle className="h-5 w-5 shrink-0 mt-0.5" />
                <div>
                  <p className="font-medium">Duplicate invoice detected</p>
                  <p className="text-sm mt-1">
                    {duplicate.reason === 'file_hash'
                      ? 'This exact file has already been uploaded.'
                      : `Invoice #${duplicate.existingInvoiceNumber} from ${duplicate.partyName ?? 'this vendor'} already exists.`}
                  </p>
                  {duplicate.existingInvoiceNumber && (
                    <p className="text-xs mt-2 text-red-600">
                      Existing: Invoice #{duplicate.existingInvoiceNumber}
                      {duplicate.partyName ? ` — ${duplicate.partyName}` : ''}
                      {duplicate.fileName ? ` (${duplicate.fileName})` : ''}
                    </p>
                  )}
                </div>
              </div>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={handleClose}>Close</Button>
            </DialogFooter>
          </div>
        )}

        {/* Step 3: Result */}
        {duplicate ? null : result ? (
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
            {preview.aiConfidence < 0.5 && (
              <div className="border border-amber-300 bg-amber-50 text-amber-700 rounded-lg p-2.5 text-xs flex items-center gap-2">
                <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
                Low AI confidence — please verify all fields before saving.
              </div>
            )}
            {preview.validationWarnings && preview.validationWarnings.length > 0 && (
              <div className="space-y-1.5">
                {preview.validationWarnings.map((w, i) => (
                  <div
                    key={i}
                    className={`rounded-lg p-2.5 text-xs flex items-start gap-2 ${
                      w.severity === 'error'
                        ? 'border border-red-300 bg-red-50 text-red-700'
                        : 'border border-amber-300 bg-amber-50 text-amber-700'
                    }`}
                  >
                    {w.severity === 'error' ? (
                      <AlertCircle className="h-3.5 w-3.5 shrink-0 mt-0.5" />
                    ) : (
                      <AlertTriangle className="h-3.5 w-3.5 shrink-0 mt-0.5" />
                    )}
                    <div>
                      <p className="font-medium">{w.message}</p>
                      {w.details && <p className="mt-0.5 opacity-80">{w.details}</p>}
                    </div>
                  </div>
                ))}
              </div>
            )}
            <div className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
              <div>
                <label className="text-xs text-muted-foreground">Invoice #</label>
                <Input
                  value={edits.invoiceNumber}
                  onChange={(e) => setEdits(prev => ({ ...prev, invoiceNumber: e.target.value }))}
                  className={`h-7 text-sm ${edits.invoiceNumber !== (p?.invoiceNumber ?? '') ? 'border-blue-300 bg-blue-50/50' : ''}`}
                  placeholder="—"
                />
              </div>
              <div>
                <label className="text-xs text-muted-foreground">Date</label>
                <Input
                  value={edits.invoiceDate}
                  onChange={(e) => setEdits(prev => ({ ...prev, invoiceDate: e.target.value }))}
                  className={`h-7 text-sm ${edits.invoiceDate !== (p?.invoiceDate ?? '') ? 'border-blue-300 bg-blue-50/50' : ''}`}
                  placeholder="DD/MM/YYYY"
                />
              </div>
              {p?.dueDate && <div><span className="text-xs text-muted-foreground">Due:</span> <span className="text-sm">{p.dueDate}</span></div>}
              <div>
                <label className="text-xs text-muted-foreground">Billing Period</label>
                <Input
                  type="month"
                  value={edits.billingPeriod}
                  onChange={(e) => setEdits(prev => ({ ...prev, billingPeriod: e.target.value }))}
                  className={`h-7 text-sm ${edits.billingPeriod !== (p?.billingPeriod ?? '') ? 'border-blue-300 bg-blue-50/50' : ''}`}
                />
              </div>
              <div className="col-span-2">
                <label className="text-xs text-muted-foreground">Category</label>
                <Select value={edits.category} onValueChange={(v) => setEdits(prev => ({ ...prev, category: v }))}>
                  <SelectTrigger className={`h-7 text-sm ${edits.category !== (preview.partyMatch?.category ?? 'other') ? 'border-blue-300 bg-blue-50/50' : ''}`}>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {INVOICE_CATEGORIES.map((c) => (
                      <SelectItem key={c} value={c}>{getCategoryLabel(c)}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>

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

            {lines.length > 0 && (() => {
              const isFabricPreview = edits.category === 'fabric' && (preview.fabricMatches?.length ?? 0) > 0;
              const matchedCount = preview.fabricMatches?.filter(m => m.fabricColourId).length ?? 0;
              return (
                <div>
                  <div className="flex items-center justify-between mb-1.5">
                    <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Line Items</p>
                    {isFabricPreview && (
                      <span className="text-[10px] text-muted-foreground">
                        {matchedCount}/{lines.length} fabric matched
                      </span>
                    )}
                  </div>
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
                          {isFabricPreview && <th className="text-center p-1.5 font-medium w-10">Match</th>}
                        </tr>
                      </thead>
                      <tbody>
                        {lines.map((line, i) => {
                          const fm = preview.fabricMatches?.[i];
                          return (
                            <tr key={i} className="border-t">
                              <td className="p-1.5 max-w-[200px] truncate" title={line.description ?? ''}>{line.description ?? '—'}</td>
                              <td className="p-1.5">{line.hsnCode ?? '—'}</td>
                              <td className="p-1.5 text-right">{line.qty != null ? `${line.qty}${line.unit ? ` ${line.unit}` : ''}` : '—'}</td>
                              <td className="p-1.5 text-right font-mono">{line.rate != null ? formatCurrency(line.rate) : '—'}</td>
                              <td className="p-1.5 text-right font-mono">{line.amount != null ? formatCurrency(line.amount) : '—'}</td>
                              <td className="p-1.5 text-right">{line.gstPercent != null ? `${line.gstPercent}%` : '—'}</td>
                              {isFabricPreview && (
                                <td className="p-1.5 text-center">
                                  {fm?.fabricColourId ? (
                                    <span className="inline-block w-2 h-2 rounded-full bg-green-500" title={`Match score: ${Math.round((fm.fabricMatchScore ?? 0) * 100)}%`} />
                                  ) : (
                                    <span className="inline-block w-2 h-2 rounded-full bg-gray-300" title="No match" />
                                  )}
                                </td>
                              )}
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                </div>
              );
            })()}

            <div className="flex justify-end">
              <div className="text-sm space-y-1.5 w-48">
                <div className="flex items-center gap-2">
                  <span className="text-muted-foreground text-xs w-14 text-right shrink-0">Subtotal</span>
                  <Input
                    type="number"
                    step="0.01"
                    value={edits.subtotal}
                    onChange={(e) => setEdits(prev => ({ ...prev, subtotal: e.target.value }))}
                    className={`h-7 text-sm font-mono text-right ${edits.subtotal !== (p?.subtotal != null ? String(p.subtotal) : '') ? 'border-blue-300 bg-blue-50/50' : ''}`}
                    placeholder="—"
                  />
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-muted-foreground text-xs w-14 text-right shrink-0">GST</span>
                  <Input
                    type="number"
                    step="0.01"
                    value={edits.gstAmount}
                    onChange={(e) => setEdits(prev => ({ ...prev, gstAmount: e.target.value }))}
                    className={`h-7 text-sm font-mono text-right ${edits.gstAmount !== (p?.gstAmount != null ? String(p.gstAmount) : '') ? 'border-blue-300 bg-blue-50/50' : ''}`}
                    placeholder="—"
                  />
                </div>
                {/* GST split display (read-only from AI) */}
                {p?.gstType === 'cgst_sgst' && p.cgstAmount != null && p.sgstAmount != null && (
                  <div className="flex items-center gap-2 pl-16">
                    <span className="text-muted-foreground text-[10px] font-mono">
                      CGST: {formatCurrency(p.cgstAmount)} | SGST: {formatCurrency(p.sgstAmount)}
                    </span>
                  </div>
                )}
                {p?.gstType === 'igst' && p.igstAmount != null && (
                  <div className="flex items-center gap-2 pl-16">
                    <span className="text-muted-foreground text-[10px] font-mono">
                      IGST: {formatCurrency(p.igstAmount)}
                    </span>
                  </div>
                )}
                <div className="flex items-center gap-2">
                  <span className="text-muted-foreground text-xs w-14 text-right shrink-0 font-medium">Total</span>
                  <Input
                    type="number"
                    step="0.01"
                    value={edits.totalAmount}
                    onChange={(e) => setEdits(prev => ({ ...prev, totalAmount: e.target.value }))}
                    className={`h-7 text-sm font-mono text-right font-medium ${edits.totalAmount !== (p?.totalAmount != null ? String(p.totalAmount) : '') ? 'border-blue-300 bg-blue-50/50' : ''}`}
                    placeholder="—"
                  />
                </div>
              </div>
            </div>

            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <div className={`w-2 h-2 rounded-full ${preview.aiConfidence >= 0.8 ? 'bg-green-500' : preview.aiConfidence >= 0.5 ? 'bg-amber-500' : 'bg-red-500'}`} />
              AI confidence: {Math.round(preview.aiConfidence * 100)}%
            </div>

            {preview.nearDuplicates && preview.nearDuplicates.length > 0 && (
              <div className="border border-amber-300 bg-amber-50 rounded-lg p-3 space-y-2">
                <div className="flex items-start gap-2 text-amber-700">
                  <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5" />
                  <div>
                    <p className="text-sm font-medium">Similar invoice{preview.nearDuplicates.length > 1 ? 's' : ''} found</p>
                    {preview.nearDuplicates.map((nd) => (
                      <p key={nd.invoiceId} className="text-xs mt-1">
                        {nd.invoiceNumber ? `#${nd.invoiceNumber}` : 'No number'}
                        {nd.partyName ? ` — ${nd.partyName}` : ''}
                        {' — '}{formatCurrency(nd.totalAmount)}
                        {nd.invoiceDate ? ` (${nd.invoiceDate})` : ''}
                      </p>
                    ))}
                    <p className="text-xs mt-1.5 text-amber-600">You can still proceed if this is a different invoice.</p>
                  </div>
                </div>
              </div>
            )}

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
            <label
              className={`block border-2 border-dashed rounded-lg p-6 text-center cursor-pointer transition-colors ${dragOver ? 'border-blue-400 bg-blue-50/50' : 'hover:bg-muted/30'}`}
              onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
              onDragLeave={() => setDragOver(false)}
              onDrop={(e) => {
                e.preventDefault();
                setDragOver(false);
                const droppedFile = e.dataTransfer.files?.[0];
                if (droppedFile) setFile(droppedFile);
              }}
            >
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
                  <p className="text-sm text-muted-foreground">Drop a file here or click to select</p>
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

function CreateInvoiceModal({ open, onClose, prefill, editInvoice }: {
  open: boolean;
  onClose: () => void;
  prefill?: { type: 'payable' | 'receivable'; totalAmount: number; partyId?: string };
  editInvoice?: {
    id: string; type: string; category: string; invoiceNumber: string | null;
    totalAmount: number; gstAmount?: number | null; subtotal?: number | null;
    invoiceDate: Date | string | null; billingPeriod?: string | null;
    notes: string | null; party?: { id: string; name: string } | null;
  };
}) {
  const isEdit = !!editInvoice;
  const queryClient = useQueryClient();
  const createFn = useServerFn(createInvoice);
  const updateFn = useServerFn(updateInvoice);
  const [form, setForm] = useState(() => {
    if (editInvoice) {
      return {
        type: editInvoice.type as 'payable' | 'receivable',
        category: editInvoice.category,
        invoiceNumber: editInvoice.invoiceNumber ?? '',
        totalAmount: String(editInvoice.totalAmount),
        gstRate: '' as string,
        gstAmount: editInvoice.gstAmount != null ? String(editInvoice.gstAmount) : '',
        invoiceDate: editInvoice.invoiceDate ? (editInvoice.invoiceDate instanceof Date ? editInvoice.invoiceDate.toISOString() : editInvoice.invoiceDate).split('T')[0] : '',
        billingPeriod: editInvoice.billingPeriod ?? '',
        notes: editInvoice.notes ?? '',
        partyId: editInvoice.party?.id,
      };
    }
    if (prefill) {
      return {
        type: prefill.type,
        category: 'other' as string,
        invoiceNumber: '',
        totalAmount: String(prefill.totalAmount),
        gstRate: '' as string,
        gstAmount: '',
        invoiceDate: new Date().toISOString().split('T')[0],
        billingPeriod: '',
        notes: '',
        partyId: prefill.partyId,
      };
    }
    return {
      type: 'payable' as 'payable' | 'receivable',
      category: 'other' as string,
      invoiceNumber: '',
      totalAmount: '',
      gstRate: '' as string,
      gstAmount: '',
      invoiceDate: new Date().toISOString().split('T')[0],
      billingPeriod: '',
      notes: '',
      partyId: undefined as string | undefined,
    };
  });

  const [selectedParty, setSelectedParty] = useState<{ id: string; name: string } | null>(
    editInvoice?.party ? { id: editInvoice.party.id, name: editInvoice.party.name } : null
  );

  const mutation = useMutation({
    mutationFn: async () => {
      if (isEdit) {
        const res = await updateFn({
          data: {
            id: editInvoice.id,
            ...(form.invoiceNumber !== (editInvoice.invoiceNumber ?? '') ? { invoiceNumber: form.invoiceNumber } : {}),
            ...(form.category !== editInvoice.category ? { category: form.category } : {}),
            ...(Number(form.totalAmount) !== editInvoice.totalAmount ? { totalAmount: Number(form.totalAmount) } : {}),
            ...(form.gstAmount && Number(form.gstAmount) !== (editInvoice.gstAmount ?? 0) ? { gstAmount: Number(form.gstAmount) } : {}),
            ...(!form.gstAmount && editInvoice.gstAmount ? { gstAmount: null } : {}),
            ...(form.invoiceDate !== (editInvoice.invoiceDate ? (editInvoice.invoiceDate instanceof Date ? editInvoice.invoiceDate.toISOString() : editInvoice.invoiceDate).split('T')[0] : '') ? { invoiceDate: form.invoiceDate || undefined } : {}),
            ...(form.billingPeriod !== (editInvoice.billingPeriod ?? '') ? { billingPeriod: form.billingPeriod || null } : {}),
            ...(form.notes !== (editInvoice.notes ?? '') ? { notes: form.notes || null } : {}),
            ...(form.partyId !== editInvoice.party?.id ? { partyId: form.partyId ?? null } : {}),
          },
        });
        return { success: res.success } as { success: boolean; error?: string };
      }
      return createFn({
        data: {
          type: form.type,
          category: form.category,
          ...(form.invoiceNumber ? { invoiceNumber: form.invoiceNumber } : {}),
          totalAmount: Number(form.totalAmount),
          ...(form.gstRate ? { gstRate: Number(form.gstRate) } : {}),
          ...(form.gstAmount ? { gstAmount: Number(form.gstAmount) } : {}),
          ...(form.invoiceDate ? { invoiceDate: form.invoiceDate } : {}),
          ...(form.billingPeriod ? { billingPeriod: form.billingPeriod } : {}),
          ...(form.notes ? { notes: form.notes } : {}),
          ...(form.partyId ? { partyId: form.partyId } : {}),
        },
      });
    },
    onSuccess: (result) => {
      queryClient.invalidateQueries({ queryKey: ['finance'] });
      if (result?.success) {
        showSuccess(isEdit ? 'Invoice updated' : 'Invoice created');
        onClose();
        resetForm();
      } else {
        showError(isEdit ? 'Failed to update invoice' : 'Failed to create invoice', { description: (result as { error?: string })?.error });
      }
    },
    onError: (err) => showError(isEdit ? 'Failed to update invoice' : 'Failed to create invoice', { description: err.message }),
  });

  const resetForm = () => {
    setForm({
      type: 'payable',
      category: 'other',
      invoiceNumber: '',
      totalAmount: '',
      gstRate: '',
      gstAmount: '',
      invoiceDate: new Date().toISOString().split('T')[0],
      billingPeriod: '',
      notes: '',
      partyId: undefined,
    });
    setSelectedParty(null);
  };

  const handlePartySelect = (party: { id: string; name: string } | null) => {
    setSelectedParty(party);
    setForm((prev) => ({
      ...prev,
      partyId: party?.id,
    }));
  };

  const isFormDirty = () => {
    if (isEdit) {
      return form.invoiceNumber !== (editInvoice?.invoiceNumber ?? '') ||
        form.category !== (editInvoice?.category ?? 'other') ||
        form.totalAmount !== String(editInvoice?.totalAmount ?? '') ||
        form.gstAmount !== (editInvoice?.gstAmount != null ? String(editInvoice.gstAmount) : '') ||
        form.notes !== (editInvoice?.notes ?? '');
    }
    return form.invoiceNumber !== '' || form.totalAmount !== '' || form.gstAmount !== '' || form.notes !== '' || form.partyId !== undefined;
  };

  return (
    <Dialog open={open} onOpenChange={(o) => {
      if (!o && isFormDirty()) {
        if (!window.confirm('You have unsaved changes. Discard?')) return;
      }
      if (!o) onClose();
    }}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{isEdit ? 'Edit Invoice' : 'New Invoice'}</DialogTitle>
          <DialogDescription>{isEdit ? 'Edit this draft invoice.' : 'Create a draft invoice. Confirm it later to book the expense.'}</DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label>Type</Label>
              <Select value={form.type} onValueChange={(v) => setForm({ ...form, type: v as 'payable' | 'receivable' })} disabled={isEdit}>
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
          <div className="relative">
            <Label>Party / Vendor</Label>
            <PartySearch
              value={selectedParty}
              onChange={handlePartySelect}
              placeholder="Search vendor..."
            />
          </div>
          <div>
            <Label>Invoice Number</Label>
            <Input value={form.invoiceNumber} onChange={(e) => setForm({ ...form, invoiceNumber: e.target.value })} placeholder="Optional" />
          </div>
          <div>
            <Label>Total Amount (incl. GST)</Label>
            <Input type="number" value={form.totalAmount} onChange={(e) => setForm({ ...form, totalAmount: e.target.value })} placeholder="0.00" />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label>GST %</Label>
              <Select value={form.gstRate} onValueChange={(v) => {
                const rate = Number(v);
                const total = Number(form.totalAmount);
                if (rate > 0 && total > 0) {
                  const gst = Math.round((total * rate / (100 + rate)) * 100) / 100;
                  setForm({ ...form, gstRate: v, gstAmount: String(gst) });
                } else {
                  setForm({ ...form, gstRate: v, gstAmount: '' });
                }
              }}>
                <SelectTrigger><SelectValue placeholder="Select" /></SelectTrigger>
                <SelectContent>
                  {[0, 5, 12, 18, 28].map((r) => (
                    <SelectItem key={r} value={String(r)}>{r}%</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>GST Amount</Label>
              <Input type="number" value={form.gstAmount} onChange={(e) => setForm({ ...form, gstAmount: e.target.value, gstRate: '' })} placeholder="0.00" />
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
            {isEdit ? 'Save Changes' : 'Create Draft'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
