/**
 * Campaign Detail Page
 *
 * - Draft/Scheduled → 3-panel builder: Settings | AI Editor | Live Preview
 * - Sent → Analytics view (stats, funnel, recipients)
 */
import { useState, useRef, useCallback, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useServerFn } from '@tanstack/react-start';
import { useNavigate, useParams } from '@tanstack/react-router';
import { ArrowLeft, Send, TestTube, Save, ChevronDown, ChevronUp, Code, Sparkles, Loader2 } from 'lucide-react';
import {
  getCampaignDetail,
  updateCampaign,
  sendTestEmail,
  sendCampaign,
  getAudiencePreview,
  getCampaignRecipients,
} from '../../server/functions/campaigns';
import {
  getAudiencesList,
} from '../../server/functions/audiences';

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
// QUICK PROMPTS
// ============================================

const QUICK_PROMPTS = [
  { label: 'Product Launch', prompt: 'Write a product launch announcement email. Highlight the new product, its features, and why customers will love it.' },
  { label: 'Seasonal Sale', prompt: 'Write a seasonal sale email with a compelling headline, urgency, and a clear discount offer.' },
  { label: 'Re-engagement', prompt: 'Write a re-engagement email for customers who haven\'t purchased in a while. Warm, personal, with a soft incentive to return.' },
  { label: 'Newsletter', prompt: 'Write a brand newsletter email with updates, behind-the-scenes content, and a gentle product highlight.' },
  { label: 'Back in Stock', prompt: 'Write a back-in-stock notification email. Create urgency with limited availability messaging.' },
];

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
  const getAudiencesListFn = useServerFn(getAudiencesList);

  const [utmExpanded, setUtmExpanded] = useState(false);
  const [recipientFilter, setRecipientFilter] = useState<string>('all');
  const [showHtml, setShowHtml] = useState(false);
  const [mobilePreview, setMobilePreview] = useState(false);

  // Audience mode: 'quick' for inline filters, 'saved' for picking a saved audience
  const [audienceMode, setAudienceMode] = useState<'quick' | 'saved'>('quick');
  const [selectedAudienceId, setSelectedAudienceId] = useState<string | null>(null);

  // AI state
  const [aiPrompt, setAiPrompt] = useState('');
  const [aiStreaming, setAiStreaming] = useState(false);
  const [aiStreamedHtml, setAiStreamedHtml] = useState('');
  const abortRef = useRef<AbortController | null>(null);

  // Fetch campaign
  const { data: campaign, isLoading } = useQuery({
    queryKey: ['campaign', 'detail', 'getCampaignDetail', campaignId],
    queryFn: () => getCampaignDetailFn({ data: { id: campaignId } }),
  });

  // Form state
  const [name, setName] = useState('');
  const [subject, setSubject] = useState('');
  const [preheaderText, setPreheaderText] = useState('');
  const [htmlContent, setHtmlContent] = useState('');
  const [selectedTiers, setSelectedTiers] = useState<string[]>([]);
  const [lastPurchaseDays, setLastPurchaseDays] = useState<number | undefined>();
  const [utmSource, setUtmSource] = useState('email');
  const [utmMedium, setUtmMedium] = useState('campaign');
  const [utmCampaign, setUtmCampaign] = useState('');
  const [utmContent, setUtmContent] = useState('');

  // Populate form from campaign data
  const [populatedId, setPopulatedId] = useState<string | null>(null);
  if (campaign && campaign.id !== populatedId) {
    setPopulatedId(campaign.id);
    setName(campaign.name);
    setSubject(campaign.subject);
    setPreheaderText(campaign.preheaderText || '');
    setHtmlContent(campaign.htmlContent || '');
    setUtmSource(campaign.utmSource);
    setUtmMedium(campaign.utmMedium);
    setUtmCampaign(campaign.utmCampaign || '');
    setUtmContent(campaign.utmContent || '');
    const af = campaign.audienceFilter;
    if (af) {
      setSelectedTiers(af.tiers || []);
      setLastPurchaseDays(af.lastPurchaseDays);
    }
    if (campaign.audienceId) {
      setAudienceMode('saved');
      setSelectedAudienceId(campaign.audienceId);
    }
  }

  // Audience preview — use inline filters or saved audience count
  const { data: audiencePreview } = useQuery({
    queryKey: ['campaign', 'audiencePreview', audienceMode, selectedTiers, lastPurchaseDays, selectedAudienceId],
    queryFn: () => {
      if (audienceMode === 'saved' && selectedAudienceId) {
        // For saved audience, look up the count from the list
        const audience = savedAudiences?.audiences.find(a => a.id === selectedAudienceId);
        return { count: audience?.customerCount ?? 0, sample: [] };
      }
      return getAudiencePreviewFn({
        data: {
          audienceFilter: {
            ...(selectedTiers.length > 0 ? { tiers: selectedTiers } : {}),
            ...(lastPurchaseDays ? { lastPurchaseDays } : {}),
          },
        },
      });
    },
    enabled: campaign?.status === 'draft' || campaign?.status === 'scheduled',
    staleTime: 10_000,
  });

  // Saved audiences list (for audience picker)
  const { data: savedAudiences } = useQuery({
    queryKey: ['audience', 'list', 'getAudiencesList'],
    queryFn: () => getAudiencesListFn({}),
    staleTime: 60_000,
    enabled: campaign?.status === 'draft' || campaign?.status === 'scheduled',
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
        htmlContent: htmlContent || undefined,
        audienceFilter: audienceMode === 'quick' ? {
          ...(selectedTiers.length > 0 ? { tiers: selectedTiers } : {}),
          ...(lastPurchaseDays ? { lastPurchaseDays } : {}),
        } : undefined,
        audienceId: audienceMode === 'saved' ? (selectedAudienceId || null) : null,
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

  // ============================================
  // AI GENERATION
  // ============================================

  const generateEmail = useCallback(async (promptText: string) => {
    if (!promptText.trim() || aiStreaming) return;

    // Abort previous stream if any
    if (abortRef.current) abortRef.current.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    setAiStreaming(true);
    setAiStreamedHtml('');

    try {
      const response = await fetch('/api/campaigns/ai/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          prompt: promptText,
          ...(htmlContent ? { currentHtml: htmlContent } : {}),
        }),
        signal: controller.signal,
      });

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }

      const reader = response.body?.getReader();
      if (!reader) throw new Error('No response body');

      const decoder = new TextDecoder();
      let buffer = '';
      let accumulated = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';

        for (const line of lines) {
          if (!line.startsWith('data: ')) continue;
          try {
            const parsed = JSON.parse(line.slice(6));
            if (parsed.type === 'text_delta') {
              accumulated += parsed.text;
              setAiStreamedHtml(accumulated);
            } else if (parsed.type === 'error') {
              console.error('AI error:', parsed.message);
            }
          } catch {
            // Skip malformed JSON
          }
        }
      }
    } catch (err: unknown) {
      if (err instanceof Error && err.name === 'AbortError') return;
      console.error('AI generation failed:', err);
    } finally {
      setAiStreaming(false);
      abortRef.current = null;
    }
  }, [aiStreaming, htmlContent]);

  const handleUseGenerated = useCallback(() => {
    if (aiStreamedHtml) {
      setHtmlContent(aiStreamedHtml);
      setAiStreamedHtml('');
    }
  }, [aiStreamedHtml]);

  // Cleanup abort controller on unmount
  useEffect(() => {
    return () => { abortRef.current?.abort(); };
  }, []);

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
  // DRAFT/SCHEDULED → 3-PANEL BUILDER VIEW
  // ============================================

  // The HTML shown in preview — prefer live streamed content while generating
  const previewHtml = aiStreaming ? aiStreamedHtml : htmlContent;

  return (
    <div className="flex flex-col h-full bg-stone-50">
      {/* Header */}
      <div className="flex items-center justify-between px-6 py-3 bg-white border-b border-stone-200">
        <div className="flex items-center gap-4">
          <button onClick={() => navigate({ to: '/campaigns' })} className="text-stone-400 hover:text-stone-600">
            <ArrowLeft className="w-5 h-5" />
          </button>
          <div className="flex flex-col gap-0.5">
            <input
              value={name}
              onChange={e => setName(e.target.value)}
              className="text-lg font-bold text-stone-900 tracking-tight bg-transparent border-none outline-none"
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
        <div className="flex items-center gap-2">
          <button
            onClick={() => saveMutation.mutate()}
            disabled={saveMutation.isPending}
            className="flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium text-stone-600 border border-stone-200 rounded-lg hover:bg-stone-50"
          >
            <Save className="w-3.5 h-3.5" />
            {saveMutation.isPending ? 'Saving...' : 'Save'}
          </button>
          <button
            onClick={() => {
              const email = prompt('Send test email to:');
              if (email) {
                sendTestEmailFn({ data: { campaignId, toEmail: email } });
              }
            }}
            className="flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium text-stone-600 border border-stone-200 rounded-lg hover:bg-stone-50"
          >
            <TestTube className="w-3.5 h-3.5" />
            Test
          </button>
          <button
            onClick={() => {
              if (confirm(`Send this campaign to ${audiencePreview?.count || 0} recipients?`)) {
                sendMutation.mutate();
              }
            }}
            disabled={sendMutation.isPending || !subject || !htmlContent}
            className="flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium text-white bg-red-700 rounded-lg hover:bg-red-800 disabled:opacity-50"
          >
            <Send className="w-3.5 h-3.5" />
            {sendMutation.isPending ? 'Sending...' : 'Send'}
          </button>
        </div>
      </div>

      {/* 3-Panel Builder body */}
      <div className="flex flex-1 overflow-hidden">
        {/* ===== LEFT PANEL: Settings ===== */}
        <div className="w-[320px] flex-shrink-0 overflow-auto p-4 flex flex-col gap-3 border-r border-stone-200 bg-stone-50">
          {/* Email Details */}
          <div className="bg-white rounded-xl border border-stone-200 p-4 flex flex-col gap-3">
            <h3 className="text-sm font-semibold text-stone-900">Email Details</h3>
            <Field label="Subject Line">
              <input
                value={subject}
                onChange={e => setSubject(e.target.value)}
                className="w-full px-3 py-2 text-sm rounded-lg border border-stone-200 bg-stone-50 outline-none focus:border-stone-400"
                placeholder="Email subject line"
              />
            </Field>
            <Field label="Preview Text">
              <input
                value={preheaderText}
                onChange={e => setPreheaderText(e.target.value)}
                className="w-full px-3 py-2 text-sm rounded-lg border border-stone-200 bg-stone-50 outline-none focus:border-stone-400"
                placeholder="Text shown after subject in inbox"
              />
            </Field>
            <Field label="From">
              <div className="px-3 py-2 text-sm rounded-lg border border-stone-200 bg-stone-50 text-stone-500">
                Creatures of Habit &lt;noreply@creaturesofhabit.in&gt;
              </div>
            </Field>
          </div>

          {/* Audience */}
          <div className="bg-white rounded-xl border border-stone-200 p-4 flex flex-col gap-3">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-semibold text-stone-900">Audience</h3>
              {audiencePreview && (
                <span className="text-xs font-semibold text-amber-800 bg-stone-100 px-2 py-0.5 rounded-md">
                  {audiencePreview.count.toLocaleString()}
                </span>
              )}
            </div>

            {/* Mode toggle */}
            <div className="flex gap-1">
              <button
                onClick={() => { setAudienceMode('quick'); setSelectedAudienceId(null); }}
                className={`px-2.5 py-1 rounded-md text-xs font-medium ${
                  audienceMode === 'quick' ? 'bg-stone-900 text-white' : 'bg-stone-100 text-stone-500'
                }`}
              >
                Quick Filter
              </button>
              <button
                onClick={() => setAudienceMode('saved')}
                className={`px-2.5 py-1 rounded-md text-xs font-medium ${
                  audienceMode === 'saved' ? 'bg-stone-900 text-white' : 'bg-stone-100 text-stone-500'
                }`}
              >
                Saved Audience
              </button>
            </div>

            {audienceMode === 'quick' ? (
              <>
                <Field label="Tier">
                  <div className="flex gap-1.5 flex-wrap">
                    {TIERS.map(tier => (
                      <button
                        key={tier}
                        onClick={() => toggleTier(tier)}
                        className={`px-2.5 py-0.5 rounded-full text-xs font-medium transition-colors ${
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
                    className="w-full px-3 py-2 text-sm rounded-lg border border-stone-200 bg-stone-50 outline-none"
                  >
                    <option value="">All customers</option>
                    <option value="30">Within 30 days</option>
                    <option value="60">Within 60 days</option>
                    <option value="90">Within 90 days</option>
                    <option value="180">Within 180 days</option>
                    <option value="365">Within 1 year</option>
                  </select>
                </Field>
              </>
            ) : (
              <Field label="Select Audience">
                <select
                  value={selectedAudienceId || ''}
                  onChange={e => setSelectedAudienceId(e.target.value || null)}
                  className="w-full px-3 py-2 text-sm rounded-lg border border-stone-200 bg-stone-50 outline-none"
                >
                  <option value="">Choose a saved audience...</option>
                  {savedAudiences?.audiences.map(a => (
                    <option key={a.id} value={a.id}>
                      {a.name} ({a.customerCount.toLocaleString()})
                    </option>
                  ))}
                </select>
              </Field>
            )}
          </div>

          {/* UTM Tracking */}
          <div className="bg-white rounded-xl border border-stone-200 p-4 flex flex-col gap-2">
            <button
              onClick={() => setUtmExpanded(!utmExpanded)}
              className="flex items-center justify-between w-full"
            >
              <h3 className="text-sm font-semibold text-stone-900">UTM Tracking</h3>
              {utmExpanded ? <ChevronUp className="w-4 h-4 text-stone-400" /> : <ChevronDown className="w-4 h-4 text-stone-400" />}
            </button>
            {!utmExpanded && (
              <span className="text-[11px] text-stone-400 truncate">
                {utmSource}/{utmMedium}/{utmCampaign || 'auto'}
              </span>
            )}
            {utmExpanded && (
              <div className="flex flex-col gap-2 pt-1">
                <UtmField label="Source" value={utmSource} onChange={setUtmSource} />
                <UtmField label="Medium" value={utmMedium} onChange={setUtmMedium} />
                <UtmField label="Campaign" value={utmCampaign} onChange={setUtmCampaign} placeholder="Auto from name" />
                <UtmField label="Content" value={utmContent} onChange={setUtmContent} placeholder="Auto per link" />
              </div>
            )}
          </div>
        </div>

        {/* ===== CENTER PANEL: Content Editor ===== */}
        <div className="flex-1 overflow-auto p-5 flex flex-col gap-4 bg-white">
          {/* AI Prompt Section */}
          <div className="flex flex-col gap-3 p-4 bg-stone-50 rounded-xl border border-stone-200">
            <div className="flex items-center gap-2">
              <Sparkles className="w-4 h-4 text-stone-700" />
              <span className="text-sm font-semibold text-stone-900">AI Email Generator</span>
              {htmlContent && (
                <span className="text-[11px] text-stone-400 ml-1">· Will modify current email</span>
              )}
            </div>

            {/* Prompt input */}
            <div className="flex gap-2">
              <textarea
                value={aiPrompt}
                onChange={e => setAiPrompt(e.target.value)}
                onKeyDown={e => {
                  if (e.key === 'Enter' && !e.shiftKey) {
                    e.preventDefault();
                    generateEmail(aiPrompt);
                  }
                }}
                placeholder="Describe the email you want to create..."
                className="flex-1 px-3 py-2.5 text-sm rounded-lg border border-stone-200 bg-white outline-none focus:border-stone-400 resize-none min-h-[40px] max-h-[120px]"
                rows={2}
              />
              <button
                onClick={() => generateEmail(aiPrompt)}
                disabled={aiStreaming || !aiPrompt.trim()}
                className="flex items-center gap-1.5 px-4 py-2 text-sm font-medium text-white bg-stone-900 rounded-lg hover:bg-stone-800 disabled:opacity-50 self-end flex-shrink-0"
              >
                {aiStreaming ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Sparkles className="w-3.5 h-3.5" />}
                {aiStreaming ? 'Generating...' : 'Generate'}
              </button>
            </div>

            {/* Quick prompts */}
            <div className="flex gap-1.5 flex-wrap">
              {QUICK_PROMPTS.map(qp => (
                <button
                  key={qp.label}
                  onClick={() => {
                    setAiPrompt(qp.prompt);
                    generateEmail(qp.prompt);
                  }}
                  disabled={aiStreaming}
                  className="px-2.5 py-1 text-[11px] font-medium text-stone-600 bg-white border border-stone-200 rounded-full hover:bg-stone-100 disabled:opacity-50"
                >
                  {qp.label}
                </button>
              ))}
            </div>
          </div>

          {/* AI Streaming Output */}
          {(aiStreaming || aiStreamedHtml) && (
            <div className="flex flex-col gap-2 p-4 bg-stone-50 rounded-xl border border-stone-200">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  {aiStreaming && <Loader2 className="w-3.5 h-3.5 animate-spin text-stone-500" />}
                  <span className="text-sm font-medium text-stone-700">
                    {aiStreaming ? 'Generating email...' : 'Generated email ready'}
                  </span>
                </div>
                {!aiStreaming && aiStreamedHtml && (
                  <div className="flex gap-2">
                    <button
                      onClick={() => setAiStreamedHtml('')}
                      className="px-3 py-1 text-xs font-medium text-stone-500 border border-stone-200 rounded-lg hover:bg-stone-100"
                    >
                      Discard
                    </button>
                    <button
                      onClick={handleUseGenerated}
                      className="px-3 py-1 text-xs font-medium text-white bg-stone-900 rounded-lg hover:bg-stone-800"
                    >
                      Use this email
                    </button>
                  </div>
                )}
              </div>
              <div className="bg-stone-900 rounded-lg p-3 max-h-[200px] overflow-auto">
                <pre className="text-[11px] text-stone-300 font-mono whitespace-pre-wrap break-all leading-relaxed">
                  {aiStreamedHtml.slice(0, 500)}{aiStreamedHtml.length > 500 ? '...' : ''}
                </pre>
              </div>
            </div>
          )}

          {/* Raw HTML Editor */}
          <div className="flex flex-col gap-2">
            <button
              onClick={() => setShowHtml(!showHtml)}
              className="flex items-center gap-2 self-start"
            >
              <Code className="w-4 h-4 text-stone-500" />
              <span className="text-sm font-semibold text-stone-900">Email HTML</span>
              {showHtml ? <ChevronUp className="w-3.5 h-3.5 text-stone-400" /> : <ChevronDown className="w-3.5 h-3.5 text-stone-400" />}
              {htmlContent && !showHtml && (
                <span className="text-[11px] text-emerald-600 font-medium">{(htmlContent.length / 1024).toFixed(1)}KB</span>
              )}
            </button>

            {showHtml && (
              <textarea
                value={htmlContent}
                onChange={e => setHtmlContent(e.target.value)}
                className="w-full h-[400px] px-4 py-3 text-[12px] font-mono text-stone-300 bg-stone-900 rounded-xl border border-stone-700 outline-none resize-y leading-relaxed"
                placeholder="Paste or generate email HTML here..."
                spellCheck={false}
              />
            )}

            {!showHtml && !htmlContent && (
              <div className="flex items-center justify-center py-12 bg-stone-50 rounded-xl border border-dashed border-stone-300">
                <div className="text-center flex flex-col gap-2">
                  <Sparkles className="w-8 h-8 text-stone-300 mx-auto" />
                  <span className="text-sm text-stone-400">No email content yet</span>
                  <span className="text-xs text-stone-400">Use the AI generator above or paste HTML directly</span>
                </div>
              </div>
            )}
          </div>
        </div>

        {/* ===== RIGHT PANEL: Live Preview ===== */}
        <div className="w-[420px] flex-shrink-0 overflow-auto p-4 flex flex-col gap-3 border-l border-stone-200 bg-stone-50">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-semibold text-stone-900">Preview</h3>
            <div className="flex gap-1">
              <button
                onClick={() => setMobilePreview(false)}
                className={`px-2.5 py-1 rounded-md text-xs font-medium ${!mobilePreview ? 'bg-stone-900 text-white' : 'bg-stone-100 text-stone-500'}`}
              >
                Desktop
              </button>
              <button
                onClick={() => setMobilePreview(true)}
                className={`px-2.5 py-1 rounded-md text-xs font-medium ${mobilePreview ? 'bg-stone-900 text-white' : 'bg-stone-100 text-stone-500'}`}
              >
                Mobile
              </button>
            </div>
          </div>

          {/* Inbox preview strip */}
          <div className="bg-white rounded-xl border border-stone-200 p-3 flex flex-col gap-1">
            <div className="flex items-center gap-2">
              <span className="text-xs font-semibold text-stone-900">Creatures of Habit</span>
              <span className="text-[11px] text-stone-400">noreply@creaturesofhabit.in</span>
            </div>
            <span className="text-sm font-medium text-stone-900">{subject || 'Subject line...'}</span>
            <span className="text-xs text-stone-400">{preheaderText || 'Preview text...'}</span>
          </div>

          {/* Email body preview */}
          {previewHtml ? (
            <div className="flex justify-center">
              <iframe
                srcDoc={previewHtml}
                className="rounded-xl border border-stone-200 bg-white flex-shrink-0"
                style={{ width: mobilePreview ? 375 : '100%', minHeight: 500, height: '100%' }}
                title="Email preview"
                sandbox="allow-same-origin"
              />
            </div>
          ) : (
            <div className="bg-stone-200/50 rounded-xl border border-stone-200 flex-1 flex items-center justify-center min-h-[400px]">
              <div className="text-center flex flex-col gap-2">
                <span className="text-sm text-stone-400">No preview available</span>
                <span className="text-xs text-stone-400">Generate or write email HTML to see preview</span>
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
    <div className="flex flex-col gap-1">
      <span className="text-[10px] font-medium text-amber-800 uppercase tracking-wider">{label}</span>
      {children}
    </div>
  );
}

function UtmField({ label, value, onChange, placeholder }: { label: string; value: string; onChange: (v: string) => void; placeholder?: string }) {
  return (
    <div className="flex items-center gap-2">
      <span className="text-[10px] font-medium text-amber-800 uppercase tracking-wider w-[70px] flex-shrink-0">{label}</span>
      <input
        value={value}
        onChange={e => onChange(e.target.value)}
        placeholder={placeholder}
        className="flex-1 px-2.5 py-1.5 text-sm rounded-lg border border-stone-200 bg-stone-50 outline-none focus:border-stone-400"
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
