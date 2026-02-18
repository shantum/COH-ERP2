import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useServerFn } from '@tanstack/react-start';
import {
  listTransactionTypes, createTransactionType, updateTransactionType,
  deleteTransactionType, getTransactionType,
} from '../../server/functions/finance';
import { LoadingState, type TxnTypeListItem, type TxnTypeDetail } from './shared';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import { Plus, Loader2, Trash2, History } from 'lucide-react';
import { showSuccess, showError } from '../../utils/toast';
import {
  type CreateTransactionTypeInput,
  type UpdateTransactionTypeInput,
  INVOICE_CATEGORIES, CHART_OF_ACCOUNTS,
  getCategoryLabel,
} from '@coh/shared';

const ACCOUNT_LABELS: Record<string, string> = Object.fromEntries(
  CHART_OF_ACCOUNTS.map((a) => [a.code, a.name])
);

export default function TransactionTypesTab() {
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
    mutationFn: (input: CreateTransactionTypeInput) => createTTFn({ data: input }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['finance', 'transactionTypes'] });
      setIsCreating(false);
      showSuccess('Transaction type created');
    },
    onError: (err) => showError('Failed to create type', { description: err.message }),
  });

  const updateMutation = useMutation({
    mutationFn: (input: UpdateTransactionTypeInput) => updateTTFn({ data: input }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['finance', 'transactionTypes'] });
      queryClient.invalidateQueries({ queryKey: ['finance', 'transactionType'] });
      setEditingId(null);
      showSuccess('Transaction type updated');
    },
    onError: (err) => showError('Failed to update type', { description: err.message }),
  });

  const deleteMutation = useMutation({
    mutationFn: (input: { id: string }) => deleteTTFn({ data: input }),
    onSuccess: (result) => {
      if (result.success) {
        queryClient.invalidateQueries({ queryKey: ['finance', 'transactionTypes'] });
        setEditingId(null);
        showSuccess('Transaction type deleted');
      }
    },
    onError: (err) => showError('Failed to delete type', { description: err.message }),
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
          {types.map((tt: TxnTypeListItem) => (
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

      {isCreating && (
        <TransactionTypeFormModal
          onClose={() => setIsCreating(false)}
          onSave={(values) => { if (!('id' in values)) createMutation.mutate(values); }}
          saving={createMutation.isPending}
        />
      )}

      {editingId && (
        <EditTransactionTypeModal
          id={editingId}
          onClose={() => setEditingId(null)}
          onSave={(values) => { if ('id' in values) updateMutation.mutate(values); }}
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
  initial?: TxnTypeDetail;
  onClose: () => void;
  onSave: (values: CreateTransactionTypeInput | UpdateTransactionTypeInput) => void;
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
    const fields = {
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
    };
    if (initial) {
      onSave({ ...fields, id: initial.id });
    } else {
      onSave(fields);
    }
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
  onSave: (values: UpdateTransactionTypeInput) => void;
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
    <TransactionTypeFormModal initial={tt} onClose={onClose} onSave={(values) => { if ('id' in values) onSave(values); }} saving={saving}>
      {tt.changeLogs && tt.changeLogs.length > 0 && (
        <div className="border-t pt-3 mt-3">
          <h4 className="text-sm font-medium flex items-center gap-1 mb-2">
            <History className="h-4 w-4" /> Change History
          </h4>
          <div className="max-h-48 overflow-y-auto space-y-1.5">
            {tt.changeLogs.map((log: TxnTypeDetail['changeLogs'][number]) => (
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
