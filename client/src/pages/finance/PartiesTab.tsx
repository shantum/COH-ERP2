import { useState, useMemo, useCallback } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useServerFn } from '@tanstack/react-start';
import { useNavigate } from '@tanstack/react-router';
import {
  listFinanceParties, listTransactionTypes,
  updateFinanceParty, createFinanceParty, getPartyBalances,
} from '../../server/functions/finance';
import { formatCurrency, LoadingState, type TxnTypeListItem, type PartyListItem, type PartyBalance } from './shared';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import { Plus, X, Loader2, Check, Pencil, Search } from 'lucide-react';
import { showSuccess, showError } from '../../utils/toast';
import {
  type FinanceSearchParams,
  type UpdatePartyInput,
  type CreatePartyInput,
  PARTY_CATEGORIES,
  getCategoryLabel,
} from '@coh/shared';

export default function PartiesTab({ search }: { search: FinanceSearchParams }) {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const listFn = useServerFn(listFinanceParties);
  const listTTFn = useServerFn(listTransactionTypes);
  const updateFn = useServerFn(updateFinanceParty);
  const createFn = useServerFn(createFinanceParty);

  const balancesFn = useServerFn(getPartyBalances);
  const [editingParty, setEditingParty] = useState<PartyListItem | null>(null);
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
    return new Map(balData.balances.map((b: PartyBalance) => [b.id, b]));
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
    mutationFn: (input: UpdatePartyInput) => updateFn({ data: input }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['finance'] });
      setEditingParty(null);
      showSuccess('Party updated');
    },
    onError: (err) => showError('Failed to update party', { description: err.message }),
  });

  const createMutation = useMutation({
    mutationFn: (input: CreatePartyInput) => createFn({ data: input }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['finance'] });
      setIsCreating(false);
      showSuccess('Party created');
    },
    onError: (err) => showError('Failed to create party', { description: err.message }),
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
            {transactionTypes.map((tt: TxnTypeListItem) => (
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

      <div className="text-sm text-muted-foreground">
        {total} parties{search.partyTxnType ? ' (filtered)' : ''}
      </div>

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
              {parties.map((party: PartyListItem) => (
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

      {editingParty && (
        <PartyEditModal
          party={editingParty}
          transactionTypes={transactionTypes}
          onSave={(data) => { if ('id' in data) updateMutation.mutate(data); }}
          onClose={() => setEditingParty(null)}
          isSaving={updateMutation.isPending}
        />
      )}

      {isCreating && (
        <PartyEditModal
          party={null}
          transactionTypes={transactionTypes}
          onSave={(data) => { if (!('id' in data)) createMutation.mutate(data); }}
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
  party: PartyListItem | null;
  transactionTypes: TxnTypeListItem[];
  onSave: (data: UpdatePartyInput | CreatePartyInput) => void;
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
          <div className="space-y-1">
            <Label>Name</Label>
            <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Vendor name" />
          </div>

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
                  {transactionTypes.map((tt: TxnTypeListItem) => (
                    <SelectItem key={tt.id} value={tt.id}>{tt.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

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

          <div className="flex items-center gap-2">
            <input type="checkbox" checked={invoiceRequired} onChange={(e) => setInvoiceRequired(e.target.checked)} id="inv-check" />
            <Label htmlFor="inv-check">Invoice Required</Label>
          </div>

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
