/**
 * Audiences Page
 *
 * List of saved audiences + builder modal for creating/editing.
 * AI-powered audience generation from natural language descriptions.
 */
import { useState, useCallback, useMemo } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useServerFn } from '@tanstack/react-start';
import {
  Plus, X, Sparkles, Loader2, Users, Trash2, Pencil, Search, ChevronDown, ChevronUp,
} from 'lucide-react';
import {
  getAudiencesList, getAudienceDetail, createAudience, updateAudience, deleteAudience,
  previewAudience, getDistinctStates, getDistinctTags,
} from '../server/functions/audiences';
import type { AudienceFilters } from '../server/functions/audienceFilters';

// ============================================
// CONSTANTS
// ============================================

const TIERS = ['gold', 'silver', 'bronze', 'platinum', 'new'] as const;

const tierColors: Record<string, { active: string; inactive: string }> = {
  gold:     { active: 'bg-red-700 text-white', inactive: 'bg-white text-stone-400 border border-stone-200' },
  silver:   { active: 'bg-amber-800 text-white', inactive: 'bg-white text-stone-400 border border-stone-200' },
  bronze:   { active: 'bg-stone-600 text-white', inactive: 'bg-white text-stone-400 border border-stone-200' },
  platinum: { active: 'bg-stone-900 text-white', inactive: 'bg-white text-stone-400 border border-stone-200' },
  new:      { active: 'bg-emerald-700 text-white', inactive: 'bg-white text-stone-400 border border-stone-200' },
};

const PURCHASE_OPTIONS = [
  { label: 'Within 30 days', value: 30 },
  { label: 'Within 60 days', value: 60 },
  { label: 'Within 90 days', value: 90 },
  { label: 'Within 180 days', value: 180 },
  { label: 'Within 1 year', value: 365 },
];

const CHURN_OPTIONS = [
  { label: '30+ days ago', value: 30 },
  { label: '60+ days ago', value: 60 },
  { label: '90+ days ago', value: 90 },
  { label: '180+ days ago', value: 180 },
];

// ============================================
// EMPTY FILTERS
// ============================================

function emptyFilters(): AudienceFilters {
  return {};
}

function isFiltersEmpty(f: AudienceFilters): boolean {
  return Object.keys(f).length === 0;
}

// ============================================
// MAIN PAGE
// ============================================

export default function Audiences() {
  const queryClient = useQueryClient();
  const [search, setSearch] = useState('');

  // Modal state
  const [modalOpen, setModalOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);

  // Server functions
  const getAudiencesListFn = useServerFn(getAudiencesList);
  const deleteAudienceFn = useServerFn(deleteAudience);

  // Queries
  const { data: listData, isLoading } = useQuery({
    queryKey: ['audience', 'list', 'getAudiencesList'],
    queryFn: () => getAudiencesListFn({}),
    staleTime: 30_000,
  });

  const allAudiences = listData?.audiences ?? [];
  const audiences = useMemo(() => {
    const allAudiences = listData?.audiences ?? [];
    if (!search) return allAudiences;
    const q = search.toLowerCase();
    return allAudiences.filter(a =>
      a.name.toLowerCase().includes(q) || (a.description?.toLowerCase().includes(q))
    );
  }, [listData?.audiences, search]);

  // Mutations
  const deleteM = useMutation({
    mutationFn: (id: string) => deleteAudienceFn({ data: { id } }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['audience'] }),
  });

  // Handlers
  const handleNew = () => {
    setEditingId(null);
    setModalOpen(true);
  };

  const handleEdit = (id: string) => {
    setEditingId(id);
    setModalOpen(true);
  };

  const handleDelete = (id: string) => {
    if (confirm('Delete this audience? Campaigns using it will be unlinked.')) {
      deleteM.mutate(id);
    }
  };

  const handleSaved = () => {
    setModalOpen(false);
    setEditingId(null);
    queryClient.invalidateQueries({ queryKey: ['audience'] });
  };

  return (
    <div className="flex flex-col h-full bg-stone-50">
      {/* Header */}
      <div className="flex items-center justify-between px-8 py-5 bg-white border-b border-stone-200">
        <div className="flex flex-col gap-0.5">
          <h1 className="text-2xl font-bold text-stone-900 tracking-tight">Audiences</h1>
          <span className="text-sm text-amber-800">
            {allAudiences.length > 0
              ? `${allAudiences.length} saved audience${allAudiences.length === 1 ? '' : 's'}`
              : 'Create audience segments for targeted campaigns'}
          </span>
        </div>
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-2 px-3 py-2 rounded-lg border border-stone-200 bg-white">
            <Search className="w-4 h-4 text-stone-400" />
            <input
              type="text"
              placeholder="Search audiences..."
              value={search}
              onChange={e => setSearch(e.target.value)}
              className="text-sm bg-transparent border-none outline-none placeholder:text-stone-400 w-40"
            />
          </div>
          <button
            onClick={handleNew}
            className="flex items-center gap-2 px-4 py-2 rounded-lg bg-red-700 text-white text-sm font-medium hover:bg-red-800 transition-colors"
          >
            <Plus className="w-4 h-4" />
            New Audience
          </button>
        </div>
      </div>

      <div className="flex-1 overflow-auto px-8 py-6">
        {/* Table */}
        <div className="flex flex-col rounded-xl border border-stone-200 overflow-hidden">
          {/* Header */}
          <div className="flex items-center px-5 py-2.5 bg-stone-100">
            <span className="text-xs font-semibold text-amber-800 uppercase tracking-wider w-[280px]">Audience</span>
            <span className="text-xs font-semibold text-amber-800 uppercase tracking-wider w-[100px]">Customers</span>
            <span className="text-xs font-semibold text-amber-800 uppercase tracking-wider w-[200px]">Description</span>
            <span className="text-xs font-semibold text-amber-800 uppercase tracking-wider w-[150px]">Created</span>
            <span className="text-xs font-semibold text-amber-800 uppercase tracking-wider flex-1 text-right">Actions</span>
          </div>

          {/* Rows */}
          {isLoading ? (
            <div className="flex items-center justify-center py-16 bg-white">
              <span className="text-sm text-stone-400">Loading audiences...</span>
            </div>
          ) : audiences.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-16 bg-white gap-2">
              <Users className="w-8 h-8 text-stone-300" />
              <span className="text-sm text-stone-400">No audiences yet</span>
              <button onClick={handleNew} className="text-sm font-medium text-red-700 hover:text-red-800">
                Create your first audience
              </button>
            </div>
          ) : (
            audiences.map(a => (
              <div
                key={a.id}
                className="flex items-center px-5 py-4 bg-white border-b border-stone-100 hover:bg-stone-50/50 transition-colors cursor-pointer"
                onClick={() => handleEdit(a.id)}
              >
                <div className="flex flex-col gap-0.5 w-[280px]">
                  <span className="text-sm font-medium text-stone-900">{a.name}</span>
                </div>
                <span className="text-sm font-semibold text-stone-900 w-[100px]">
                  {a.customerCount.toLocaleString()}
                </span>
                <span className="text-sm text-stone-500 w-[200px] truncate">
                  {a.description || '—'}
                </span>
                <span className="text-sm text-stone-500 w-[150px]">
                  {new Date(a.createdAt).toLocaleDateString('en-IN', { month: 'short', day: 'numeric', year: 'numeric' })}
                </span>
                <div className="flex gap-3 flex-1 justify-end" onClick={e => e.stopPropagation()}>
                  <button onClick={() => handleEdit(a.id)} className="text-xs font-medium text-amber-800 hover:text-amber-900">
                    <Pencil className="w-3.5 h-3.5" />
                  </button>
                  <button onClick={() => handleDelete(a.id)} className="text-xs font-medium text-stone-400 hover:text-red-600">
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>
            ))
          )}
        </div>
      </div>

      {/* Builder Modal */}
      {modalOpen && (
        <AudienceBuilderModal
          editingId={editingId}
          onClose={() => { setModalOpen(false); setEditingId(null); }}
          onSaved={handleSaved}
        />
      )}
    </div>
  );
}

// ============================================
// AUDIENCE BUILDER MODAL
// ============================================

function AudienceBuilderModal({
  editingId,
  onClose,
  onSaved,
}: {
  editingId: string | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const queryClient = useQueryClient();

  // Server functions
  const getAudienceDetailFn = useServerFn(getAudienceDetail);
  const createAudienceFn = useServerFn(createAudience);
  const updateAudienceFn = useServerFn(updateAudience);
  const previewAudienceFn = useServerFn(previewAudience);
  const getDistinctStatesFn = useServerFn(getDistinctStates);
  const getDistinctTagsFn = useServerFn(getDistinctTags);

  // Form state
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [filters, setFilters] = useState<AudienceFilters>(emptyFilters());
  const [populatedId, setPopulatedId] = useState<string | null>(null);

  // AI state
  const [aiPrompt, setAiPrompt] = useState('');
  const [aiLoading, setAiLoading] = useState(false);
  const [aiExplanation, setAiExplanation] = useState('');

  // Advanced filters toggle
  const [showAdvanced, setShowAdvanced] = useState(false);

  // Fetch existing audience for editing
  const { data: existingAudience } = useQuery({
    queryKey: ['audience', 'detail', editingId],
    queryFn: () => getAudienceDetailFn({ data: { id: editingId! } }),
    enabled: !!editingId,
  });

  // Populate form from existing audience
  if (existingAudience && existingAudience.id !== populatedId) {
    setPopulatedId(existingAudience.id);
    setName(existingAudience.name);
    setDescription(existingAudience.description || '');
    setFilters(existingAudience.filters);
    // Show advanced if any advanced filters are set
    const f = existingAudience.filters;
    if (f.orderCountMin !== undefined || f.orderCountMax !== undefined ||
        f.ltvMin !== undefined || f.ltvMax !== undefined ||
        f.returnCountMin !== undefined || f.returnCountMax !== undefined ||
        f.firstPurchaseWithin !== undefined || f.tagsExclude?.length ||
        f.hasStoreCredit !== undefined || f.customerSince !== undefined) {
      setShowAdvanced(true);
    }
  }

  // Fetch distinct states and tags for dropdowns
  const { data: statesData } = useQuery({
    queryKey: ['audience', 'distinctStates'],
    queryFn: () => getDistinctStatesFn({}),
    staleTime: 5 * 60_000,
  });

  const { data: tagsData } = useQuery({
    queryKey: ['audience', 'distinctTags'],
    queryFn: () => getDistinctTagsFn({}),
    staleTime: 5 * 60_000,
  });

  // Preview query
  const { data: preview, isFetching: previewLoading } = useQuery({
    queryKey: ['audience', 'preview', JSON.stringify(filters)],
    queryFn: () => previewAudienceFn({ data: { filters } }),
    staleTime: 10_000,
  });

  // Save mutation
  const saveMutation = useMutation({
    mutationFn: async () => {
      if (editingId) {
        return updateAudienceFn({ data: { id: editingId, name, description: description || undefined, filters } });
      } else {
        return createAudienceFn({ data: { name, description: description || undefined, filters } });
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['audience'] });
      onSaved();
    },
  });

  // AI generation
  const generateFromAi = useCallback(async () => {
    if (!aiPrompt.trim() || aiLoading) return;
    setAiLoading(true);
    setAiExplanation('');

    try {
      const response = await fetch('/api/campaigns/ai/audience', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prompt: aiPrompt }),
      });

      if (!response.ok) {
        const err = await response.json();
        throw new Error(err.error || 'AI generation failed');
      }

      const data = await response.json();
      if (data.filters) {
        setFilters(data.filters);
        setAiExplanation(data.explanation || '');
        // Auto-expand advanced if AI set advanced filters
        const f = data.filters as AudienceFilters;
        if (f.orderCountMin !== undefined || f.ltvMin !== undefined || f.returnCountMin !== undefined) {
          setShowAdvanced(true);
        }
      }
    } catch (err: unknown) {
      console.error('AI audience generation failed:', err);
    } finally {
      setAiLoading(false);
    }
  }, [aiPrompt, aiLoading]);

  // Filter update helpers
  const updateFilter = <K extends keyof AudienceFilters>(key: K, value: AudienceFilters[K] | undefined) => {
    setFilters(prev => {
      const next = { ...prev };
      if (value === undefined || value === null || (Array.isArray(value) && value.length === 0)) {
        delete next[key];
      } else {
        next[key] = value;
      }
      return next;
    });
  };

  const toggleTier = (tier: string) => {
    const current = filters.tiers || [];
    const next = current.includes(tier) ? current.filter(t => t !== tier) : [...current, tier];
    updateFilter('tiers', next.length > 0 ? next : undefined);
  };

  const toggleState = (state: string) => {
    const current = filters.states || [];
    const next = current.includes(state) ? current.filter(s => s !== state) : [...current, state];
    updateFilter('states', next.length > 0 ? next : undefined);
  };

  const toggleTagInclude = (tag: string) => {
    const current = filters.tagsInclude || [];
    const next = current.includes(tag) ? current.filter(t => t !== tag) : [...current, tag];
    updateFilter('tagsInclude', next.length > 0 ? next : undefined);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
      <div className="bg-white rounded-2xl shadow-xl w-[960px] max-h-[85vh] flex flex-col">
        {/* Modal header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-stone-200">
          <div className="flex flex-col gap-0.5">
            <h2 className="text-lg font-bold text-stone-900">
              {editingId ? 'Edit Audience' : 'New Audience'}
            </h2>
            <span className="text-xs text-stone-400">Define filters to segment your customers</span>
          </div>
          <button onClick={onClose} className="p-1.5 text-stone-400 hover:text-stone-600 rounded-lg hover:bg-stone-100">
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Body — 2 columns */}
        <div className="flex flex-1 overflow-hidden">
          {/* Left: Filters */}
          <div className="w-[560px] flex-shrink-0 overflow-auto p-5 flex flex-col gap-4 border-r border-stone-100">
            {/* Name + Description */}
            <div className="flex flex-col gap-3">
              <FilterField label="Name">
                <input
                  value={name}
                  onChange={e => setName(e.target.value)}
                  className="w-full px-3 py-2 text-sm rounded-lg border border-stone-200 bg-stone-50 outline-none focus:border-stone-400"
                  placeholder="e.g., High-value Goa customers"
                />
              </FilterField>
              <FilterField label="Description">
                <input
                  value={description}
                  onChange={e => setDescription(e.target.value)}
                  className="w-full px-3 py-2 text-sm rounded-lg border border-stone-200 bg-stone-50 outline-none focus:border-stone-400"
                  placeholder="Optional description"
                />
              </FilterField>
            </div>

            {/* AI Prompt */}
            <div className="flex flex-col gap-2 p-3 bg-stone-50 rounded-xl border border-stone-200">
              <div className="flex items-center gap-2">
                <Sparkles className="w-3.5 h-3.5 text-stone-600" />
                <span className="text-xs font-semibold text-stone-700">AI Audience Builder</span>
              </div>
              <div className="flex gap-2">
                <input
                  value={aiPrompt}
                  onChange={e => setAiPrompt(e.target.value)}
                  onKeyDown={e => { if (e.key === 'Enter') generateFromAi(); }}
                  placeholder="Describe your audience in plain English..."
                  className="flex-1 px-3 py-2 text-sm rounded-lg border border-stone-200 bg-white outline-none focus:border-stone-400"
                />
                <button
                  onClick={generateFromAi}
                  disabled={aiLoading || !aiPrompt.trim()}
                  className="flex items-center gap-1.5 px-3 py-2 text-xs font-medium text-white bg-stone-900 rounded-lg hover:bg-stone-800 disabled:opacity-50 flex-shrink-0"
                >
                  {aiLoading ? <Loader2 className="w-3 h-3 animate-spin" /> : <Sparkles className="w-3 h-3" />}
                  Generate
                </button>
              </div>
              {aiExplanation && (
                <p className="text-xs text-stone-500 italic">{aiExplanation}</p>
              )}
            </div>

            {/* Core filters */}
            <div className="flex flex-col gap-3">
              {/* Tiers */}
              <FilterField label="Customer Tier">
                <div className="flex gap-1.5 flex-wrap">
                  {TIERS.map(tier => (
                    <button
                      key={tier}
                      onClick={() => toggleTier(tier)}
                      className={`px-2.5 py-0.5 rounded-full text-xs font-medium transition-colors ${
                        (filters.tiers || []).includes(tier) ? tierColors[tier].active : tierColors[tier].inactive
                      }`}
                    >
                      {tier.charAt(0).toUpperCase() + tier.slice(1)}
                    </button>
                  ))}
                </div>
              </FilterField>

              {/* Last Purchase */}
              <div className="flex gap-3">
                <div className="flex-1">
                  <FilterField label="Active (purchased within)">
                    <select
                      value={filters.lastPurchaseWithin || ''}
                      onChange={e => updateFilter('lastPurchaseWithin', e.target.value ? Number(e.target.value) : undefined)}
                      className="w-full px-3 py-2 text-sm rounded-lg border border-stone-200 bg-stone-50 outline-none"
                    >
                      <option value="">Any time</option>
                      {PURCHASE_OPTIONS.map(o => (
                        <option key={o.value} value={o.value}>{o.label}</option>
                      ))}
                    </select>
                  </FilterField>
                </div>
                <div className="flex-1">
                  <FilterField label="Churned (no purchase in)">
                    <select
                      value={filters.lastPurchaseBefore || ''}
                      onChange={e => updateFilter('lastPurchaseBefore', e.target.value ? Number(e.target.value) : undefined)}
                      className="w-full px-3 py-2 text-sm rounded-lg border border-stone-200 bg-stone-50 outline-none"
                    >
                      <option value="">Not filtered</option>
                      {CHURN_OPTIONS.map(o => (
                        <option key={o.value} value={o.value}>{o.label}</option>
                      ))}
                    </select>
                  </FilterField>
                </div>
              </div>

              {/* Tags */}
              {tagsData && tagsData.tags.length > 0 && (
                <FilterField label="Tags (include any)">
                  <div className="flex gap-1.5 flex-wrap max-h-[80px] overflow-y-auto">
                    {tagsData.tags.slice(0, 30).map(tag => (
                      <button
                        key={tag}
                        onClick={() => toggleTagInclude(tag)}
                        className={`px-2 py-0.5 rounded-full text-[11px] font-medium transition-colors ${
                          (filters.tagsInclude || []).includes(tag)
                            ? 'bg-amber-800 text-white'
                            : 'bg-white text-stone-400 border border-stone-200 hover:border-stone-300'
                        }`}
                      >
                        {tag}
                      </button>
                    ))}
                  </div>
                </FilterField>
              )}

              {/* Location */}
              {statesData && statesData.states.length > 0 && (
                <FilterField label="Location (states)">
                  <div className="flex gap-1.5 flex-wrap max-h-[80px] overflow-y-auto">
                    {statesData.states.map(state => (
                      <button
                        key={state}
                        onClick={() => toggleState(state)}
                        className={`px-2 py-0.5 rounded-full text-[11px] font-medium transition-colors ${
                          (filters.states || []).includes(state)
                            ? 'bg-stone-900 text-white'
                            : 'bg-white text-stone-400 border border-stone-200 hover:border-stone-300'
                        }`}
                      >
                        {state}
                      </button>
                    ))}
                  </div>
                </FilterField>
              )}

              {/* Marketing opt-in */}
              <FilterField label="Marketing">
                <label className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={filters.acceptsMarketing === true}
                    onChange={e => updateFilter('acceptsMarketing', e.target.checked ? true : undefined)}
                    className="rounded border-stone-300"
                  />
                  <span className="text-sm text-stone-700">Only customers who accept marketing</span>
                </label>
              </FilterField>
            </div>

            {/* Advanced filters */}
            <div className="flex flex-col gap-3">
              <button
                onClick={() => setShowAdvanced(!showAdvanced)}
                className="flex items-center gap-1.5 text-xs font-medium text-stone-500 hover:text-stone-700 self-start"
              >
                {showAdvanced ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
                Advanced Filters
              </button>

              {showAdvanced && (
                <div className="flex flex-col gap-3 pl-1">
                  {/* Order count */}
                  <div className="flex gap-3">
                    <div className="flex-1">
                      <FilterField label="Min Orders">
                        <input
                          type="number"
                          min={0}
                          value={filters.orderCountMin ?? ''}
                          onChange={e => updateFilter('orderCountMin', e.target.value ? Number(e.target.value) : undefined)}
                          className="w-full px-3 py-2 text-sm rounded-lg border border-stone-200 bg-stone-50 outline-none"
                          placeholder="0"
                        />
                      </FilterField>
                    </div>
                    <div className="flex-1">
                      <FilterField label="Max Orders">
                        <input
                          type="number"
                          min={0}
                          value={filters.orderCountMax ?? ''}
                          onChange={e => updateFilter('orderCountMax', e.target.value ? Number(e.target.value) : undefined)}
                          className="w-full px-3 py-2 text-sm rounded-lg border border-stone-200 bg-stone-50 outline-none"
                          placeholder="Any"
                        />
                      </FilterField>
                    </div>
                  </div>

                  {/* LTV */}
                  <div className="flex gap-3">
                    <div className="flex-1">
                      <FilterField label="Min LTV (INR)">
                        <input
                          type="number"
                          min={0}
                          value={filters.ltvMin ?? ''}
                          onChange={e => updateFilter('ltvMin', e.target.value ? Number(e.target.value) : undefined)}
                          className="w-full px-3 py-2 text-sm rounded-lg border border-stone-200 bg-stone-50 outline-none"
                          placeholder="0"
                        />
                      </FilterField>
                    </div>
                    <div className="flex-1">
                      <FilterField label="Max LTV (INR)">
                        <input
                          type="number"
                          min={0}
                          value={filters.ltvMax ?? ''}
                          onChange={e => updateFilter('ltvMax', e.target.value ? Number(e.target.value) : undefined)}
                          className="w-full px-3 py-2 text-sm rounded-lg border border-stone-200 bg-stone-50 outline-none"
                          placeholder="Any"
                        />
                      </FilterField>
                    </div>
                  </div>

                  {/* Returns */}
                  <div className="flex gap-3">
                    <div className="flex-1">
                      <FilterField label="Min Returns">
                        <input
                          type="number"
                          min={0}
                          value={filters.returnCountMin ?? ''}
                          onChange={e => updateFilter('returnCountMin', e.target.value ? Number(e.target.value) : undefined)}
                          className="w-full px-3 py-2 text-sm rounded-lg border border-stone-200 bg-stone-50 outline-none"
                          placeholder="0"
                        />
                      </FilterField>
                    </div>
                    <div className="flex-1">
                      <FilterField label="Max Returns">
                        <input
                          type="number"
                          min={0}
                          value={filters.returnCountMax ?? ''}
                          onChange={e => updateFilter('returnCountMax', e.target.value ? Number(e.target.value) : undefined)}
                          className="w-full px-3 py-2 text-sm rounded-lg border border-stone-200 bg-stone-50 outline-none"
                          placeholder="Any"
                        />
                      </FilterField>
                    </div>
                  </div>

                  {/* First purchase within / Customer since / Store credit */}
                  <div className="flex gap-3">
                    <div className="flex-1">
                      <FilterField label="New Customer (first order within)">
                        <select
                          value={filters.firstPurchaseWithin || ''}
                          onChange={e => updateFilter('firstPurchaseWithin', e.target.value ? Number(e.target.value) : undefined)}
                          className="w-full px-3 py-2 text-sm rounded-lg border border-stone-200 bg-stone-50 outline-none"
                        >
                          <option value="">Not filtered</option>
                          {PURCHASE_OPTIONS.map(o => (
                            <option key={o.value} value={o.value}>{o.label}</option>
                          ))}
                        </select>
                      </FilterField>
                    </div>
                    <div className="flex-1">
                      <FilterField label="Has Store Credit">
                        <select
                          value={filters.hasStoreCredit === true ? 'yes' : filters.hasStoreCredit === false ? 'no' : ''}
                          onChange={e => {
                            const v = e.target.value;
                            updateFilter('hasStoreCredit', v === 'yes' ? true : v === 'no' ? false : undefined);
                          }}
                          className="w-full px-3 py-2 text-sm rounded-lg border border-stone-200 bg-stone-50 outline-none"
                        >
                          <option value="">Any</option>
                          <option value="yes">Has credit</option>
                          <option value="no">No credit</option>
                        </select>
                      </FilterField>
                    </div>
                  </div>
                </div>
              )}
            </div>
          </div>

          {/* Right: Preview */}
          <div className="flex-1 overflow-auto p-5 flex flex-col gap-4 bg-stone-50">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-semibold text-stone-900">Preview</h3>
              <div className="flex items-center gap-2">
                {previewLoading && <Loader2 className="w-3.5 h-3.5 animate-spin text-stone-400" />}
                <span className="text-lg font-bold text-stone-900">
                  {preview?.count !== undefined ? preview.count.toLocaleString() : '—'}
                </span>
                <span className="text-xs text-stone-500">customers</span>
              </div>
            </div>

            {/* Active filters summary */}
            {!isFiltersEmpty(filters) && (
              <div className="flex gap-1.5 flex-wrap">
                {filters.tiers?.map(t => (
                  <FilterPill key={`tier-${t}`} label={`Tier: ${t}`} onRemove={() => toggleTier(t)} />
                ))}
                {filters.lastPurchaseWithin && (
                  <FilterPill label={`Active: ${filters.lastPurchaseWithin}d`} onRemove={() => updateFilter('lastPurchaseWithin', undefined)} />
                )}
                {filters.lastPurchaseBefore && (
                  <FilterPill label={`Churned: ${filters.lastPurchaseBefore}d+`} onRemove={() => updateFilter('lastPurchaseBefore', undefined)} />
                )}
                {filters.states?.map(s => (
                  <FilterPill key={`state-${s}`} label={s} onRemove={() => toggleState(s)} />
                ))}
                {filters.tagsInclude?.map(t => (
                  <FilterPill key={`tag-${t}`} label={`Tag: ${t}`} onRemove={() => toggleTagInclude(t)} />
                ))}
                {filters.acceptsMarketing && (
                  <FilterPill label="Accepts marketing" onRemove={() => updateFilter('acceptsMarketing', undefined)} />
                )}
                {filters.orderCountMin !== undefined && (
                  <FilterPill label={`Orders >= ${filters.orderCountMin}`} onRemove={() => updateFilter('orderCountMin', undefined)} />
                )}
                {filters.ltvMin !== undefined && (
                  <FilterPill label={`LTV >= ${filters.ltvMin}`} onRemove={() => updateFilter('ltvMin', undefined)} />
                )}
                {filters.returnCountMin !== undefined && (
                  <FilterPill label={`Returns >= ${filters.returnCountMin}`} onRemove={() => updateFilter('returnCountMin', undefined)} />
                )}
                {filters.hasStoreCredit === true && (
                  <FilterPill label="Has store credit" onRemove={() => updateFilter('hasStoreCredit', undefined)} />
                )}
              </div>
            )}

            {/* Customer sample table */}
            {preview && preview.sample.length > 0 && (
              <div className="flex flex-col rounded-xl border border-stone-200 overflow-hidden">
                <div className="flex items-center px-4 py-2 bg-stone-100">
                  <span className="text-[10px] font-semibold text-amber-800 uppercase tracking-wider w-[160px]">Customer</span>
                  <span className="text-[10px] font-semibold text-amber-800 uppercase tracking-wider w-[60px]">Tier</span>
                  <span className="text-[10px] font-semibold text-amber-800 uppercase tracking-wider w-[70px]">LTV</span>
                  <span className="text-[10px] font-semibold text-amber-800 uppercase tracking-wider flex-1">Orders</span>
                </div>
                {preview.sample.map(c => (
                  <div key={c.id} className="flex items-center px-4 py-2.5 bg-white border-b border-stone-100">
                    <div className="w-[160px] flex flex-col">
                      <span className="text-xs font-medium text-stone-900 truncate">
                        {c.firstName || ''} {c.lastName || ''}
                      </span>
                      <span className="text-[11px] text-stone-400 truncate">{c.email}</span>
                    </div>
                    <div className="w-[60px]">
                      <span className={`inline-flex px-1.5 py-0.5 rounded-full text-[10px] font-medium ${
                        c.tier === 'gold' ? 'bg-orange-50 text-red-700' :
                        c.tier === 'silver' ? 'bg-stone-100 text-amber-800' :
                        c.tier === 'platinum' ? 'bg-stone-200 text-stone-800' :
                        c.tier === 'new' ? 'bg-emerald-50 text-emerald-700' :
                        'bg-stone-50 text-stone-500'
                      }`}>
                        {c.tier}
                      </span>
                    </div>
                    <span className="text-xs font-medium text-stone-900 w-[70px]">
                      {c.ltv.toLocaleString('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 })}
                    </span>
                    <span className="text-xs text-stone-500 flex-1">{c.orderCount}</span>
                  </div>
                ))}
              </div>
            )}

            {preview && preview.sample.length === 0 && (
              <div className="flex flex-col items-center justify-center py-12 bg-white rounded-xl border border-stone-200 gap-2">
                <Users className="w-6 h-6 text-stone-300" />
                <span className="text-sm text-stone-400">No customers match these filters</span>
              </div>
            )}

            {!preview && !previewLoading && (
              <div className="flex flex-col items-center justify-center py-12 bg-white rounded-xl border border-stone-200 gap-2">
                <Users className="w-6 h-6 text-stone-300" />
                <span className="text-sm text-stone-400">Add filters to see matching customers</span>
              </div>
            )}
          </div>
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between px-6 py-4 border-t border-stone-200">
          <button
            onClick={onClose}
            className="px-4 py-2 text-sm font-medium text-stone-600 border border-stone-200 rounded-lg hover:bg-stone-50"
          >
            Cancel
          </button>
          <div className="flex items-center gap-3">
            {preview && (
              <span className="text-xs text-stone-500">
                {preview.count.toLocaleString()} customers will be targeted
              </span>
            )}
            <button
              onClick={() => saveMutation.mutate()}
              disabled={saveMutation.isPending || !name.trim()}
              className="flex items-center gap-1.5 px-4 py-2 text-sm font-medium text-white bg-red-700 rounded-lg hover:bg-red-800 disabled:opacity-50"
            >
              {saveMutation.isPending ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : null}
              {editingId ? 'Update Audience' : 'Save Audience'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ============================================
// SMALL COMPONENTS
// ============================================

function FilterField({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-1">
      <span className="text-[10px] font-medium text-amber-800 uppercase tracking-wider">{label}</span>
      {children}
    </div>
  );
}

function FilterPill({ label, onRemove }: { label: string; onRemove: () => void }) {
  return (
    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-medium bg-stone-200 text-stone-700">
      {label}
      <button onClick={onRemove} className="hover:text-stone-900">
        <X className="w-3 h-3" />
      </button>
    </span>
  );
}
