/**
 * Campaign Detail Page
 *
 * - Draft/Scheduled → Builder view (edit subject, template, audience, UTM, preview)
 * - Sent → Analytics view (stats, funnel, recipients)
 */
import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useServerFn } from '@tanstack/react-start';
import { useNavigate, useParams } from '@tanstack/react-router';
import { ArrowLeft, Send, TestTube, Save, ChevronDown, ChevronUp } from 'lucide-react';
import {
  getCampaignDetail,
  updateCampaign,
  sendTestEmail,
  sendCampaign,
  getAudiencePreview,
  getCampaignRecipients,
  previewCampaign,
} from '../../server/functions/campaigns';

// ============================================
// STATUS BADGE (reused)
// ============================================

const statusStyles: Record<string, string> = {
  draft:     'bg-stone-100 text-stone-600',
  scheduled: 'bg-amber-50 text-amber-700',
  sending:   'bg-blue-50 text-blue-700',
  sent:      'bg-emerald-50 text-emerald-700',
  cancelled: 'bg-red-50 text-red-700',
};

// ============================================
// TEMPLATE OPTIONS
// ============================================

const TEMPLATES = [
  { key: 'cinematic', label: 'Cinematic', gradient: 'from-stone-900 to-amber-950' },
  { key: 'swiss', label: 'Swiss', gradient: 'from-gray-100 to-gray-200' },
  { key: 'warm', label: 'Warm', gradient: 'from-orange-50 to-amber-100' },
] as const;

// ============================================
// TIER PILLS
// ============================================

const TIERS = ['gold', 'silver', 'bronze', 'platinum', 'new'] as const;

const tierColors: Record<string, { active: string; inactive: string }> = {
  gold:     { active: 'bg-red-700 text-white', inactive: 'bg-white text-stone-400 border border-stone-200' },
  silver:   { active: 'bg-amber-800 text-white', inactive: 'bg-white text-stone-400 border border-stone-200' },
  bronze:   { active: 'bg-stone-600 text-white', inactive: 'bg-white text-stone-400 border border-stone-200' },
  platinum: { active: 'bg-stone-900 text-white', inactive: 'bg-white text-stone-400 border border-stone-200' },
  new:      { active: 'bg-emerald-700 text-white', inactive: 'bg-white text-stone-400 border border-stone-200' },
};

// ============================================
// MAIN COMPONENT
// ============================================

export default function CampaignDetail() {
  const { campaignId } = useParams({ from: '/_authenticated/campaigns_/$campaignId' });
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  // Server function hooks
  const getCampaignDetailFn = useServerFn(getCampaignDetail);
  const updateCampaignFn = useServerFn(updateCampaign);
  const sendTestEmailFn = useServerFn(sendTestEmail);
  const sendCampaignFn = useServerFn(sendCampaign);
  const getAudiencePreviewFn = useServerFn(getAudiencePreview);
  const getCampaignRecipientsFn = useServerFn(getCampaignRecipients);
  const previewCampaignFn = useServerFn(previewCampaign);

  const [utmExpanded, setUtmExpanded] = useState(false);
  const [recipientFilter, setRecipientFilter] = useState<string>('all');

  // Fetch campaign
  const { data: campaign, isLoading } = useQuery({
    queryKey: ['campaign', 'detail', 'getCampaignDetail', campaignId],
    queryFn: () => getCampaignDetailFn({ data: { id: campaignId } }),
  });

  // Form state — initialized empty, populated when campaign loads
  const [name, setName] = useState('');
  const [subject, setSubject] = useState('');
  const [preheaderText, setPreheaderText] = useState('');
  const [templateKey, setTemplateKey] = useState('cinematic');
  const [selectedTiers, setSelectedTiers] = useState<string[]>([]);
  const [lastPurchaseDays, setLastPurchaseDays] = useState<number | undefined>();
  const [utmSource, setUtmSource] = useState('email');
  const [utmMedium, setUtmMedium] = useState('campaign');
  const [utmCampaign, setUtmCampaign] = useState('');
  const [utmContent, setUtmContent] = useState('');

  // Track which campaign we've populated the form from
  const [populatedId, setPopulatedId] = useState<string | null>(null);
  if (campaign && campaign.id !== populatedId) {
    setPopulatedId(campaign.id);
    setName(campaign.name);
    setSubject(campaign.subject);
    setPreheaderText(campaign.preheaderText || '');
    setTemplateKey(campaign.templateKey);
    setUtmSource(campaign.utmSource);
    setUtmMedium(campaign.utmMedium);
    setUtmCampaign(campaign.utmCampaign || '');
    setUtmContent(campaign.utmContent || '');
    const af = campaign.audienceFilter;
    if (af) {
      setSelectedTiers(af.tiers || []);
      setLastPurchaseDays(af.lastPurchaseDays);
    }
  }

  // Audience preview
  const { data: audiencePreview } = useQuery({
    queryKey: ['campaign', 'audiencePreview', selectedTiers, lastPurchaseDays],
    queryFn: () => getAudiencePreviewFn({
      data: {
        audienceFilter: {
          ...(selectedTiers.length > 0 ? { tiers: selectedTiers } : {}),
          ...(lastPurchaseDays ? { lastPurchaseDays } : {}),
        },
      },
    }),
    enabled: campaign?.status === 'draft' || campaign?.status === 'scheduled',
    staleTime: 10_000,
  });

  // Email preview — re-renders when template or campaign changes
  const { data: previewData } = useQuery({
    queryKey: ['campaign', 'preview', campaignId, templateKey],
    queryFn: () => previewCampaignFn({ data: { campaignId } }),
    enabled: !!campaign && (campaign.status === 'draft' || campaign.status === 'scheduled'),
    staleTime: 30_000,
  });

  // Recipients (for sent campaigns)
  const { data: recipientsData } = useQuery({
    queryKey: ['campaign', 'recipients', campaignId, recipientFilter],
    queryFn: () => getCampaignRecipientsFn({
      data: { campaignId, status: recipientFilter as 'all', limit: 50, offset: 0 },
    }),
    enabled: campaign?.status === 'sent',
  });

  // Save draft
  const saveMutation = useMutation({
    mutationFn: () => updateCampaignFn({
      data: {
        id: campaignId,
        name,
        subject,
        preheaderText: preheaderText || undefined,
        templateKey,
        audienceFilter: {
          ...(selectedTiers.length > 0 ? { tiers: selectedTiers } : {}),
          ...(lastPurchaseDays ? { lastPurchaseDays } : {}),
        },
        utmSource,
        utmMedium,
        utmCampaign: utmCampaign || undefined,
        utmContent: utmContent || undefined,
      },
    }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['campaign'] });
    },
  });

  // Send campaign
  const sendMutation = useMutation({
    mutationFn: () => sendCampaignFn({ data: { id: campaignId } }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['campaign'] });
    },
  });

  // Toggle tier
  const toggleTier = (tier: string) => {
    setSelectedTiers(prev =>
      prev.includes(tier) ? prev.filter(t => t !== tier) : [...prev, tier]
    );
  };

  if (isLoading || !campaign) {
    return (
      <div className="flex items-center justify-center h-full">
        <span className="text-sm text-stone-400">Loading campaign...</span>
      </div>
    );
  }

  const isSent = campaign.status === 'sent';

  // ============================================
  // SENT CAMPAIGN → ANALYTICS VIEW
  // ============================================
  if (isSent) {
    const openRate = campaign.sentCount > 0 ? ((campaign.openCount / campaign.sentCount) * 100).toFixed(1) : '0';
    const clickRate = campaign.sentCount > 0 ? ((campaign.clickCount / campaign.sentCount) * 100).toFixed(1) : '0';
    const bounceRate = campaign.sentCount > 0 ? ((campaign.bounceCount / campaign.sentCount) * 100).toFixed(1) : '0';
    const deliveryRate = campaign.sentCount > 0 ? ((campaign.deliveredCount / campaign.sentCount) * 100).toFixed(1) : '0';
    const unsubRate = campaign.sentCount > 0 ? ((campaign.unsubscribeCount / campaign.sentCount) * 100).toFixed(1) : '0';

    return (
      <div className="flex flex-col h-full bg-stone-50">
        {/* Header */}
        <div className="flex items-center justify-between px-8 py-5 bg-white border-b border-stone-200">
          <div className="flex items-center gap-4">
            <button onClick={() => navigate({ to: '/campaigns' })} className="text-stone-400 hover:text-stone-600">
              <ArrowLeft className="w-5 h-5" />
            </button>
            <div className="flex flex-col gap-0.5">
              <h1 className="text-xl font-bold text-stone-900 tracking-tight">{campaign.name}</h1>
              <span className="text-xs text-stone-400">
                Sent {campaign.sentAt ? new Date(campaign.sentAt).toLocaleDateString('en-IN', { month: 'short', day: 'numeric', year: 'numeric' }) : ''}
                {' · '}{campaign.recipientCount.toLocaleString()} recipients
              </span>
            </div>
          </div>
          <div className="flex items-center gap-3">
            <button className="px-4 py-2 text-sm font-medium text-stone-600 border border-stone-200 rounded-lg hover:bg-stone-50">
              Duplicate
            </button>
            <button className="px-4 py-2 text-sm font-medium text-stone-600 border border-stone-200 rounded-lg hover:bg-stone-50">
              Export CSV
            </button>
          </div>
        </div>

        <div className="flex-1 overflow-auto px-8 py-6 flex flex-col gap-6">
          {/* Stat cards */}
          <div className="flex gap-4">
            <StatCard label="Delivered" value={campaign.deliveredCount.toLocaleString()} subtitle={`${deliveryRate}% delivery rate`} subtitleColor="text-emerald-700" />
            <StatCard label="Opened" value={campaign.openCount.toLocaleString()} subtitle={`${openRate}% open rate`} subtitleColor="text-emerald-700" color="text-emerald-700" />
            <StatCard label="Clicked" value={campaign.clickCount.toLocaleString()} subtitle={`${clickRate}% click rate`} subtitleColor="text-amber-700" color="text-amber-700" />
            <StatCard label="Bounced" value={campaign.bounceCount.toLocaleString()} subtitle={`${bounceRate}% bounce rate`} subtitleColor="text-red-700" />
            <StatCard label="Unsubscribed" value={campaign.unsubscribeCount.toLocaleString()} subtitle={`${unsubRate}%`} subtitleColor="text-stone-400" />
          </div>

          {/* Engagement Funnel */}
          <div className="bg-white rounded-xl border border-stone-200 p-6">
            <h3 className="text-base font-semibold text-stone-900 mb-4">Engagement Funnel</h3>
            <div className="flex flex-col gap-3">
              <FunnelBar label="Sent" value={campaign.sentCount} max={campaign.sentCount} color="bg-amber-800" />
              <FunnelBar label="Delivered" value={campaign.deliveredCount} max={campaign.sentCount} color="bg-amber-800" />
              <FunnelBar label="Opened" value={campaign.openCount} max={campaign.sentCount} color="bg-emerald-700" />
              <FunnelBar label="Clicked" value={campaign.clickCount} max={campaign.sentCount} color="bg-red-700" />
            </div>
          </div>

          {/* Recipients table */}
          <div>
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-base font-semibold text-stone-900">Recipients</h3>
              <div className="flex gap-1">
                {(['all', 'opened', 'clicked', 'bounced'] as const).map(s => (
                  <button
                    key={s}
                    onClick={() => setRecipientFilter(s)}
                    className={`px-3 py-1 rounded-md text-xs font-medium ${
                      recipientFilter === s ? 'bg-stone-900 text-white' : 'bg-stone-100 text-stone-500 hover:bg-stone-200'
                    }`}
                  >
                    {s.charAt(0).toUpperCase() + s.slice(1)}
                  </button>
                ))}
              </div>
            </div>
            <div className="rounded-xl border border-stone-200 overflow-hidden">
              <div className="flex items-center px-5 py-2.5 bg-stone-100">
                <span className="text-xs font-semibold text-amber-800 uppercase tracking-wider w-[200px]">Customer</span>
                <span className="text-xs font-semibold text-amber-800 uppercase tracking-wider w-[240px]">Email</span>
                <span className="text-xs font-semibold text-amber-800 uppercase tracking-wider w-[80px]">Tier</span>
                <span className="text-xs font-semibold text-amber-800 uppercase tracking-wider w-[100px]">Status</span>
                <span className="text-xs font-semibold text-amber-800 uppercase tracking-wider w-[150px]">Opened At</span>
                <span className="text-xs font-semibold text-amber-800 uppercase tracking-wider flex-1">Clicked At</span>
              </div>
              {recipientsData?.recipients.map(r => (
                <div key={r.id} className="flex items-center px-5 py-3 bg-white border-b border-stone-100">
                  <span className="text-sm font-medium text-stone-900 w-[200px]">
                    {r.customer.firstName || ''} {r.customer.lastName || ''}
                  </span>
                  <span className="text-sm text-stone-500 w-[240px]">{r.email}</span>
                  <div className="w-[80px]">
                    <span className={`inline-flex px-2 py-0.5 rounded-full text-[11px] font-medium ${
                      r.customer.tier === 'gold' ? 'bg-orange-50 text-red-700' :
                      r.customer.tier === 'silver' ? 'bg-stone-100 text-amber-800' :
                      'bg-stone-50 text-stone-500'
                    }`}>
                      {r.customer.tier ? r.customer.tier.charAt(0).toUpperCase() + r.customer.tier.slice(1) : '—'}
                    </span>
                  </div>
                  <div className="w-[100px]">
                    <span className={`inline-flex px-2 py-0.5 rounded-full text-[11px] font-medium ${
                      statusStyles[r.status] || 'bg-stone-100 text-stone-600'
                    }`}>
                      {r.status.charAt(0).toUpperCase() + r.status.slice(1)}
                    </span>
                  </div>
                  <span className="text-xs text-stone-500 w-[150px]">
                    {r.openedAt ? new Date(r.openedAt).toLocaleString('en-IN', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : '—'}
                  </span>
                  <span className="text-xs text-stone-500 flex-1">
                    {r.clickedAt ? new Date(r.clickedAt).toLocaleString('en-IN', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : '—'}
                  </span>
                </div>
              ))}
              {(!recipientsData || recipientsData.recipients.length === 0) && (
                <div className="flex items-center justify-center py-12 bg-white">
                  <span className="text-sm text-stone-400">No recipients found</span>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    );
  }

  // ============================================
  // DRAFT/SCHEDULED → BUILDER VIEW
  // ============================================
  return (
    <div className="flex flex-col h-full bg-stone-50">
      {/* Header */}
      <div className="flex items-center justify-between px-8 py-4 bg-white border-b border-stone-200">
        <div className="flex items-center gap-4">
          <button onClick={() => navigate({ to: '/campaigns' })} className="text-stone-400 hover:text-stone-600">
            <ArrowLeft className="w-5 h-5" />
          </button>
          <div className="flex flex-col gap-0.5">
            <input
              value={name}
              onChange={e => setName(e.target.value)}
              className="text-xl font-bold text-stone-900 tracking-tight bg-transparent border-none outline-none"
              placeholder="Campaign name"
            />
            <span className="text-xs text-stone-400">
              <span className={`inline-flex px-1.5 py-0.5 rounded text-[10px] font-medium ${statusStyles[campaign.status]}`}>
                {campaign.status.charAt(0).toUpperCase() + campaign.status.slice(1)}
              </span>
              {' · '}Last edited {new Date(campaign.updatedAt).toLocaleString('en-IN', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}
            </span>
          </div>
        </div>
        <div className="flex items-center gap-3">
          <button
            onClick={() => saveMutation.mutate()}
            disabled={saveMutation.isPending}
            className="flex items-center gap-2 px-4 py-2 text-sm font-medium text-stone-600 border border-stone-200 rounded-lg hover:bg-stone-50"
          >
            <Save className="w-4 h-4" />
            {saveMutation.isPending ? 'Saving...' : 'Save Draft'}
          </button>
          <button
            onClick={() => {
              const email = prompt('Send test email to:');
              if (email) {
                sendTestEmailFn({ data: { campaignId, toEmail: email } });
              }
            }}
            className="flex items-center gap-2 px-4 py-2 text-sm font-medium text-stone-600 border border-stone-200 rounded-lg hover:bg-stone-50"
          >
            <TestTube className="w-4 h-4" />
            Send Test
          </button>
          <button
            onClick={() => {
              if (confirm(`Send this campaign to ${audiencePreview?.count || 0} recipients?`)) {
                sendMutation.mutate();
              }
            }}
            disabled={sendMutation.isPending || !subject}
            className="flex items-center gap-2 px-4 py-2 text-sm font-medium text-white bg-red-700 rounded-lg hover:bg-red-800 disabled:opacity-50"
          >
            <Send className="w-4 h-4" />
            {sendMutation.isPending ? 'Sending...' : 'Send Campaign'}
          </button>
        </div>
      </div>

      {/* Builder body */}
      <div className="flex flex-1 overflow-hidden">
        {/* Left panel — settings */}
        <div className="w-[440px] flex-shrink-0 overflow-auto p-6 flex flex-col gap-5 border-r border-stone-200 bg-stone-50">
          {/* Email Details */}
          <div className="bg-white rounded-xl border border-stone-200 p-5 flex flex-col gap-4">
            <h3 className="text-base font-semibold text-stone-900">Email Details</h3>
            <Field label="Subject Line">
              <input
                value={subject}
                onChange={e => setSubject(e.target.value)}
                className="w-full px-3 py-2.5 text-sm rounded-lg border border-stone-200 bg-stone-50 outline-none focus:border-stone-400"
                placeholder="Email subject line"
              />
            </Field>
            <Field label="Preview Text">
              <input
                value={preheaderText}
                onChange={e => setPreheaderText(e.target.value)}
                className="w-full px-3 py-2.5 text-sm rounded-lg border border-stone-200 bg-stone-50 outline-none focus:border-stone-400"
                placeholder="Text shown after subject in inbox"
              />
            </Field>
            <Field label="From">
              <div className="px-3 py-2.5 text-sm rounded-lg border border-stone-200 bg-stone-50 text-stone-500">
                Creatures of Habit &lt;noreply@creaturesofhabit.in&gt;
              </div>
            </Field>
          </div>

          {/* Template picker */}
          <div className="bg-white rounded-xl border border-stone-200 p-5 flex flex-col gap-3">
            <h3 className="text-base font-semibold text-stone-900">Template</h3>
            <div className="flex gap-3">
              {TEMPLATES.map(t => (
                <button
                  key={t.key}
                  onClick={() => setTemplateKey(t.key)}
                  className={`flex flex-col items-center gap-2 p-3 rounded-lg flex-1 transition-all ${
                    templateKey === t.key
                      ? 'border-2 border-red-700 bg-red-50/30'
                      : 'border border-stone-200 bg-white hover:border-stone-300'
                  }`}
                >
                  <div className={`w-full h-16 rounded bg-gradient-to-br ${t.gradient}`} />
                  <span className="text-xs font-medium text-stone-700">{t.label}</span>
                </button>
              ))}
            </div>
          </div>

          {/* Audience */}
          <div className="bg-white rounded-xl border border-stone-200 p-5 flex flex-col gap-4">
            <div className="flex items-center justify-between">
              <h3 className="text-base font-semibold text-stone-900">Audience</h3>
              {audiencePreview && (
                <span className="text-xs font-semibold text-amber-800 bg-stone-100 px-2.5 py-1 rounded-md">
                  {audiencePreview.count.toLocaleString()} recipients
                </span>
              )}
            </div>
            <Field label="Tier">
              <div className="flex gap-2 flex-wrap">
                {TIERS.map(tier => (
                  <button
                    key={tier}
                    onClick={() => toggleTier(tier)}
                    className={`px-3 py-1 rounded-full text-xs font-medium transition-colors ${
                      selectedTiers.includes(tier) ? tierColors[tier].active : tierColors[tier].inactive
                    }`}
                  >
                    {tier.charAt(0).toUpperCase() + tier.slice(1)}
                  </button>
                ))}
              </div>
            </Field>
            <Field label="Last Purchase">
              <select
                value={lastPurchaseDays || ''}
                onChange={e => setLastPurchaseDays(e.target.value ? Number(e.target.value) : undefined)}
                className="w-full px-3 py-2.5 text-sm rounded-lg border border-stone-200 bg-stone-50 outline-none"
              >
                <option value="">All customers</option>
                <option value="30">Within 30 days</option>
                <option value="60">Within 60 days</option>
                <option value="90">Within 90 days</option>
                <option value="180">Within 180 days</option>
                <option value="365">Within 1 year</option>
              </select>
            </Field>
          </div>

          {/* UTM Tracking */}
          <div className="bg-white rounded-xl border border-stone-200 p-5 flex flex-col gap-3">
            <button
              onClick={() => setUtmExpanded(!utmExpanded)}
              className="flex items-center justify-between w-full"
            >
              <h3 className="text-base font-semibold text-stone-900">UTM Tracking</h3>
              {utmExpanded ? <ChevronUp className="w-4 h-4 text-stone-400" /> : <ChevronDown className="w-4 h-4 text-stone-400" />}
            </button>
            {utmExpanded && (
              <div className="flex flex-col gap-3 pt-1">
                <UtmField label="Source" value={utmSource} onChange={setUtmSource} />
                <UtmField label="Medium" value={utmMedium} onChange={setUtmMedium} />
                <UtmField label="Campaign" value={utmCampaign} onChange={setUtmCampaign} placeholder="Auto-generated from name" />
                <UtmField label="Content" value={utmContent} onChange={setUtmContent} placeholder="Auto-tagged per link" />
                <div className="px-3 py-2 bg-stone-50 rounded-lg">
                  <span className="text-[11px] text-amber-800 break-all">
                    Links → creaturesofhabit.in/...?utm_source={utmSource}&utm_medium={utmMedium}&utm_campaign={utmCampaign || 'auto-slug'}
                  </span>
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Right panel — preview */}
        <div className="flex-1 overflow-auto p-6 flex flex-col gap-4">
          <div className="flex items-center justify-between">
            <h3 className="text-base font-semibold text-stone-900">Preview</h3>
            <div className="flex gap-1">
              <button className="px-3 py-1 rounded-md text-xs font-medium bg-stone-900 text-white">Desktop</button>
              <button className="px-3 py-1 rounded-md text-xs font-medium bg-stone-100 text-stone-500">Mobile</button>
            </div>
          </div>

          {/* Inbox preview strip */}
          <div className="bg-white rounded-xl border border-stone-200 p-4 flex flex-col gap-1">
            <div className="flex items-center gap-2">
              <span className="text-sm font-semibold text-stone-900">Creatures of Habit</span>
              <span className="text-xs text-stone-400">noreply@creaturesofhabit.in</span>
            </div>
            <span className="text-sm font-medium text-stone-900">{subject || 'Subject line...'}</span>
            <span className="text-xs text-stone-400">{preheaderText || 'Preview text...'}</span>
          </div>

          {/* Email body preview */}
          {previewData?.html ? (
            <iframe
              srcDoc={previewData.html}
              className="rounded-xl border border-stone-200 flex-1 min-h-[500px] w-full bg-white"
              title="Email preview"
              sandbox="allow-same-origin"
            />
          ) : (
            <div className="bg-stone-200/50 rounded-xl border border-stone-200 flex-1 flex items-center justify-center min-h-[400px]">
              <div className="text-center flex flex-col gap-2">
                <span className="text-sm text-stone-400">Loading email preview...</span>
                <span className="text-xs text-stone-400">Template: {templateKey} · {audiencePreview?.count || 0} recipients</span>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ============================================
// SMALL COMPONENTS
// ============================================

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-1.5">
      <span className="text-[11px] font-medium text-amber-800 uppercase tracking-wider">{label}</span>
      {children}
    </div>
  );
}

function UtmField({ label, value, onChange, placeholder }: { label: string; value: string; onChange: (v: string) => void; placeholder?: string }) {
  return (
    <div className="flex items-center gap-3">
      <span className="text-[11px] font-medium text-amber-800 uppercase tracking-wider w-[80px] flex-shrink-0">{label}</span>
      <input
        value={value}
        onChange={e => onChange(e.target.value)}
        placeholder={placeholder}
        className="flex-1 px-3 py-2 text-sm rounded-lg border border-stone-200 bg-stone-50 outline-none focus:border-stone-400"
      />
    </div>
  );
}

function StatCard({ label, value, subtitle, subtitleColor = 'text-stone-400', color = 'text-stone-900' }: {
  label: string; value: string; color?: string; subtitle?: string; subtitleColor?: string;
}) {
  return (
    <div className="flex flex-col gap-1.5 p-5 bg-white rounded-xl border border-stone-200 flex-1">
      <span className="text-xs font-medium text-stone-400 uppercase tracking-wider">{label}</span>
      <span className={`text-3xl font-bold tracking-tight ${color}`}>{value}</span>
      {subtitle && <span className={`text-xs ${subtitleColor}`}>{subtitle}</span>}
    </div>
  );
}

function FunnelBar({ label, value, max, color }: { label: string; value: number; max: number; color: string }) {
  const pct = max > 0 ? (value / max) * 100 : 0;
  return (
    <div className="flex items-center gap-4">
      <span className="text-sm font-medium text-stone-500 w-[80px]">{label}</span>
      <div className="flex-1 h-7 bg-stone-100 rounded overflow-hidden">
        <div className={`h-full ${color} rounded`} style={{ width: `${pct}%` }} />
      </div>
      <span className="text-sm font-semibold text-stone-900 w-[60px] text-right">{value.toLocaleString()}</span>
    </div>
  );
}
