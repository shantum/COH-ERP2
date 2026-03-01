/**
 * Campaigns List Page
 *
 * Shows campaign stats overview and a table of all campaigns
 * with status, recipient count, open/click rates, and actions.
 */
import { useState, useMemo, memo } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useServerFn } from '@tanstack/react-start';
import { useNavigate } from '@tanstack/react-router';
import { Plus, Search } from 'lucide-react';
import {
  getCampaignsList,
  getCampaignStats,
  createCampaign,
  deleteCampaign,
  cancelCampaign,
  type CampaignListItem,
} from '../server/functions/campaigns';

// ============================================
// STATUS BADGE
// ============================================

const statusConfig: Record<string, { bg: string; text: string; label: string }> = {
  draft:     { bg: 'bg-stone-100', text: 'text-stone-600', label: 'Draft' },
  scheduled: { bg: 'bg-amber-50',  text: 'text-amber-700', label: 'Scheduled' },
  sending:   { bg: 'bg-blue-50',   text: 'text-blue-700',  label: 'Sending' },
  sent:      { bg: 'bg-emerald-50', text: 'text-emerald-700', label: 'Sent' },
  cancelled: { bg: 'bg-red-50',    text: 'text-red-700',   label: 'Cancelled' },
};

function StatusBadge({ status }: { status: string }) {
  const cfg = statusConfig[status] || statusConfig.draft;
  return (
    <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${cfg.bg} ${cfg.text}`}>
      {cfg.label}
    </span>
  );
}

// ============================================
// STAT CARD
// ============================================

function StatCard({ label, value, color = 'text-stone-900' }: { label: string; value: string; color?: string }) {
  return (
    <div className="flex flex-col gap-1 p-5 bg-white rounded-xl border border-stone-200 flex-1">
      <span className="text-xs font-medium text-stone-400 uppercase tracking-wider">{label}</span>
      <span className={`text-3xl font-bold tracking-tight ${color}`}>{value}</span>
    </div>
  );
}

// ============================================
// CAMPAIGN ROW
// ============================================

const CampaignRow = memo(function CampaignRow({
  campaign,
  onView,
  onEdit,
  onDuplicate,
  onDelete,
  onCancel,
}: {
  campaign: CampaignListItem;
  onView: (id: string) => void;
  onEdit: (id: string) => void;
  onDuplicate: (c: CampaignListItem) => void;
  onDelete: (id: string) => void;
  onCancel: (id: string) => void;
}) {
  const openRate = campaign.sentCount > 0
    ? `${((campaign.openCount / campaign.sentCount) * 100).toFixed(1)}%`
    : '—';
  const clickRate = campaign.sentCount > 0
    ? `${((campaign.clickCount / campaign.sentCount) * 100).toFixed(1)}%`
    : '—';

  const isSent = campaign.status === 'sent';
  const isDraft = campaign.status === 'draft';
  const isScheduled = campaign.status === 'scheduled';

  return (
    <div className="flex items-center px-5 py-4 bg-white border-b border-stone-100 hover:bg-stone-50/50 transition-colors">
      {/* Campaign name */}
      <div className="flex flex-col gap-0.5 w-[280px]">
        <span className="text-sm font-medium text-stone-900">{campaign.name}</span>
        <span className="text-xs text-stone-400 truncate">{campaign.subject}</span>
      </div>

      {/* Status */}
      <div className="w-[100px]">
        <StatusBadge status={campaign.status} />
      </div>

      {/* Sent date */}
      <span className="text-sm text-stone-500 w-[120px]">
        {campaign.sentAt
          ? new Date(campaign.sentAt).toLocaleDateString('en-IN', { month: 'short', day: 'numeric', year: 'numeric' })
          : campaign.scheduledAt
            ? new Date(campaign.scheduledAt).toLocaleDateString('en-IN', { month: 'short', day: 'numeric', year: 'numeric' })
            : '—'}
      </span>

      {/* Recipients */}
      <span className="text-sm font-medium text-stone-900 w-[120px]">
        {campaign.recipientCount > 0 ? campaign.recipientCount.toLocaleString() : '—'}
      </span>

      {/* Open Rate */}
      <span className={`text-sm font-medium w-[100px] ${campaign.sentCount > 0 ? 'text-emerald-700' : 'text-stone-400'}`}>
        {openRate}
      </span>

      {/* Click Rate */}
      <span className={`text-sm font-medium w-[100px] ${campaign.sentCount > 0 ? 'text-amber-700' : 'text-stone-400'}`}>
        {clickRate}
      </span>

      {/* Actions */}
      <div className="flex gap-3 flex-1 justify-end">
        {isSent && (
          <>
            <button onClick={() => onView(campaign.id)} className="text-xs font-medium text-amber-800 hover:text-amber-900">View</button>
            <button onClick={() => onDuplicate(campaign)} className="text-xs font-medium text-stone-400 hover:text-stone-600">Duplicate</button>
          </>
        )}
        {isDraft && (
          <>
            <button onClick={() => onEdit(campaign.id)} className="text-xs font-medium text-red-700 hover:text-red-800">Edit</button>
            <button onClick={() => onDelete(campaign.id)} className="text-xs font-medium text-stone-400 hover:text-stone-600">Delete</button>
          </>
        )}
        {isScheduled && (
          <>
            <button onClick={() => onEdit(campaign.id)} className="text-xs font-medium text-red-700 hover:text-red-800">Edit</button>
            <button onClick={() => onCancel(campaign.id)} className="text-xs font-medium text-stone-400 hover:text-stone-600">Cancel</button>
          </>
        )}
      </div>
    </div>
  );
});

// ============================================
// MAIN PAGE
// ============================================

export default function Campaigns() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<string>('all');

  // Server function hooks
  const getCampaignsListFn = useServerFn(getCampaignsList);
  const getCampaignStatsFn = useServerFn(getCampaignStats);
  const createCampaignFn = useServerFn(createCampaign);
  const deleteCampaignFn = useServerFn(deleteCampaign);
  const cancelCampaignFn = useServerFn(cancelCampaign);

  // Queries
  const { data: statsData } = useQuery({
    queryKey: ['campaign', 'stats', 'getCampaignStats'],
    queryFn: () => getCampaignStatsFn({}),
    staleTime: 60_000,
  });

  const { data: listData, isLoading } = useQuery({
    queryKey: ['campaign', 'list', 'getCampaignsList', statusFilter],
    queryFn: () => getCampaignsListFn({ data: { status: statusFilter as 'all', limit: 50, offset: 0 } }),
    staleTime: 30_000,
  });

  // Mutations
  const deleteM = useMutation({
    mutationFn: (id: string) => deleteCampaignFn({ data: { id } }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['campaign'] });
    },
  });

  const cancelM = useMutation({
    mutationFn: (id: string) => cancelCampaignFn({ data: { id } }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['campaign'] });
    },
  });

  // Filter campaigns by search
  const allCampaigns = listData?.campaigns ?? [];
  const campaigns = useMemo(() => {
    if (!search) return allCampaigns;
    const q = search.toLowerCase();
    return allCampaigns.filter(
      c => c.name.toLowerCase().includes(q) || c.subject.toLowerCase().includes(q)
    );
  }, [allCampaigns, search]);

  // Handlers
  const handleNewCampaign = async () => {
    const result = await createCampaignFn({
      data: {
        name: 'Untitled Campaign',
        subject: '',
        templateKey: 'cinematic',
      },
    });
    navigate({ to: '/campaigns/$campaignId', params: { campaignId: result.id } });
  };

  const handleView = (id: string) => navigate({ to: '/campaigns/$campaignId', params: { campaignId: id } });
  const handleEdit = (id: string) => navigate({ to: '/campaigns/$campaignId', params: { campaignId: id } });

  const handleDuplicate = async (c: CampaignListItem) => {
    const result = await createCampaignFn({
      data: {
        name: `${c.name} (copy)`,
        subject: c.subject,
        templateKey: c.templateKey,
      },
    });
    queryClient.invalidateQueries({ queryKey: ['campaign'] });
    navigate({ to: '/campaigns/$campaignId', params: { campaignId: result.id } });
  };

  const stats = statsData || { totalSent: 0, avgOpenRate: 0, avgClickRate: 0, avgBounceRate: 0 };

  return (
    <div className="flex flex-col h-full bg-stone-50">
      {/* Header */}
      <div className="flex items-center justify-between px-8 py-5 bg-white border-b border-stone-200">
        <div className="flex flex-col gap-0.5">
          <h1 className="text-2xl font-bold text-stone-900 tracking-tight">Campaigns</h1>
          <span className="text-sm text-amber-800">
            {stats.totalSent > 0 ? `${stats.totalSent.toLocaleString()} emails sent` : 'No campaigns sent yet'}
          </span>
        </div>
        <div className="flex items-center gap-3">
          {/* Search */}
          <div className="flex items-center gap-2 px-3 py-2 rounded-lg border border-stone-200 bg-white">
            <Search className="w-4 h-4 text-stone-400" />
            <input
              type="text"
              placeholder="Search campaigns..."
              value={search}
              onChange={e => setSearch(e.target.value)}
              className="text-sm bg-transparent border-none outline-none placeholder:text-stone-400 w-40"
            />
          </div>
          {/* New Campaign */}
          <button
            onClick={handleNewCampaign}
            className="flex items-center gap-2 px-4 py-2 rounded-lg bg-red-700 text-white text-sm font-medium hover:bg-red-800 transition-colors"
          >
            <Plus className="w-4 h-4" />
            New Campaign
          </button>
        </div>
      </div>

      <div className="flex-1 overflow-auto px-8 py-6 flex flex-col gap-6">
        {/* Stats */}
        <div className="flex gap-4">
          <StatCard label="Total Sent" value={stats.totalSent.toLocaleString()} />
          <StatCard label="Avg Open Rate" value={`${stats.avgOpenRate}%`} color="text-emerald-700" />
          <StatCard label="Avg Click Rate" value={`${stats.avgClickRate}%`} color="text-amber-700" />
          <StatCard label="Bounce Rate" value={`${stats.avgBounceRate}%`} />
        </div>

        {/* Status filter tabs */}
        <div className="flex gap-1">
          {(['all', 'draft', 'scheduled', 'sent', 'cancelled'] as const).map(s => (
            <button
              key={s}
              onClick={() => setStatusFilter(s)}
              className={`px-3 py-1.5 rounded-md text-xs font-medium transition-colors ${
                statusFilter === s
                  ? 'bg-stone-900 text-white'
                  : 'bg-stone-100 text-stone-500 hover:bg-stone-200'
              }`}
            >
              {s === 'all' ? 'All' : s.charAt(0).toUpperCase() + s.slice(1)}
            </button>
          ))}
        </div>

        {/* Table */}
        <div className="flex flex-col rounded-xl border border-stone-200 overflow-hidden">
          {/* Header */}
          <div className="flex items-center px-5 py-2.5 bg-stone-100">
            <span className="text-xs font-semibold text-amber-800 uppercase tracking-wider w-[280px]">Campaign</span>
            <span className="text-xs font-semibold text-amber-800 uppercase tracking-wider w-[100px]">Status</span>
            <span className="text-xs font-semibold text-amber-800 uppercase tracking-wider w-[120px]">Sent</span>
            <span className="text-xs font-semibold text-amber-800 uppercase tracking-wider w-[120px]">Recipients</span>
            <span className="text-xs font-semibold text-amber-800 uppercase tracking-wider w-[100px]">Open Rate</span>
            <span className="text-xs font-semibold text-amber-800 uppercase tracking-wider w-[100px]">Click Rate</span>
            <span className="text-xs font-semibold text-amber-800 uppercase tracking-wider flex-1 text-right">Actions</span>
          </div>

          {/* Rows */}
          {isLoading ? (
            <div className="flex items-center justify-center py-16 bg-white">
              <span className="text-sm text-stone-400">Loading campaigns...</span>
            </div>
          ) : campaigns.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-16 bg-white gap-2">
              <span className="text-sm text-stone-400">No campaigns yet</span>
              <button
                onClick={handleNewCampaign}
                className="text-sm font-medium text-red-700 hover:text-red-800"
              >
                Create your first campaign
              </button>
            </div>
          ) : (
            campaigns.map(c => (
              <CampaignRow
                key={c.id}
                campaign={c}
                onView={handleView}
                onEdit={handleEdit}
                onDuplicate={handleDuplicate}
                onDelete={(id) => deleteM.mutate(id)}
                onCancel={(id) => cancelM.mutate(id)}
              />
            ))
          )}
        </div>
      </div>
    </div>
  );
}
