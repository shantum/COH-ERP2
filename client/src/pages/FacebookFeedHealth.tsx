/**
 * Facebook Feed Health Monitor Page
 *
 * Compares the Facebook catalog XML feed against ERP + Shopify data.
 * Shows stats, filters, and a grouped list of every discrepancy.
 */

import { useState, useEffect, useCallback, useMemo } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from '@tanstack/react-router';
import { Route } from '../routes/_authenticated/facebook-feed-health';
import {
    Search, RefreshCw, AlertTriangle, AlertCircle, Info,
    CheckCircle2, Package, Loader2, Filter, ExternalLink,
} from 'lucide-react';
import {
    getFacebookFeedHealth,
    refreshFacebookFeedHealth,
    type FeedIssue,
    type FeedHealthResult,
} from '../server/functions/facebookFeed';
import { Input } from '../components/ui/input';
import { Badge } from '../components/ui/badge';
import { Button } from '../components/ui/button';
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from '../components/ui/select';
import { cn } from '../lib/utils';

// ============================================
// HELPERS
// ============================================

const SEVERITY_CONFIG = {
    critical: { label: 'Critical', icon: AlertCircle, color: 'text-red-600', bg: 'bg-red-50 border-red-200', badgeBg: 'bg-red-100 text-red-700' },
    warning: { label: 'Warning', icon: AlertTriangle, color: 'text-amber-600', bg: 'bg-amber-50 border-amber-200', badgeBg: 'bg-amber-100 text-amber-700' },
    info: { label: 'Info', icon: Info, color: 'text-blue-600', bg: 'bg-blue-50 border-blue-200', badgeBg: 'bg-blue-100 text-blue-700' },
} as const;

const ISSUE_TYPE_LABELS: Record<string, string> = {
    price_mismatch: 'Price Mismatch',
    stock_mismatch: 'Stock Mismatch',
    availability_wrong: 'Availability Wrong',
    not_in_erp: 'Not in ERP',
    not_in_shopify_cache: 'Not in Shopify Cache',
    metadata_mismatch: 'Metadata Mismatch',
};

function formatTime(isoStr: string): string {
    try {
        return new Date(isoStr).toLocaleString('en-IN', {
            day: 'numeric',
            month: 'short',
            hour: '2-digit',
            minute: '2-digit',
        });
    } catch {
        return isoStr;
    }
}

// ============================================
// STAT CARD
// ============================================

function StatCard({ label, value, accent, suffix }: {
    label: string;
    value: number;
    accent?: string;
    suffix?: string;
}) {
    return (
        <div className="bg-white border rounded-lg px-4 py-3">
            <div className="text-xs text-gray-500 uppercase tracking-wide">{label}</div>
            <div className={cn('text-2xl font-semibold mt-0.5', accent ?? 'text-gray-900')}>
                {value.toLocaleString('en-IN')}
                {suffix && <span className="text-sm font-normal text-gray-400 ml-1">{suffix}</span>}
            </div>
        </div>
    );
}

// ============================================
// SEVERITY BADGE
// ============================================

function SeverityBadge({ severity }: { severity: FeedIssue['severity'] }) {
    const config = SEVERITY_CONFIG[severity];
    const Icon = config.icon;
    return (
        <Badge className={cn('text-xs font-medium', config.badgeBg)}>
            <Icon className="w-3 h-3 mr-1" />
            {config.label}
        </Badge>
    );
}

// ============================================
// ISSUE ROW
// ============================================

function IssueRow({ issue }: { issue: FeedIssue }) {
    const config = SEVERITY_CONFIG[issue.severity];

    return (
        <div className={cn('border rounded-lg px-4 py-3', config.bg)}>
            <div className="flex items-start gap-3">
                <SeverityBadge severity={issue.severity} />
                <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                        <span className="font-medium text-sm text-gray-900 truncate">{issue.title}</span>
                        {(issue.color || issue.size) && (
                            <span className="text-xs text-gray-500">
                                ({[issue.color, issue.size].filter(Boolean).join(', ')})
                            </span>
                        )}
                        <Badge variant="outline" className="text-[10px] px-1.5 py-0 font-normal">
                            {ISSUE_TYPE_LABELS[issue.type] ?? issue.type}
                        </Badge>
                    </div>
                    <p className="text-sm text-gray-600 mt-1">{issue.message}</p>
                    <div className="flex flex-wrap gap-4 mt-2 text-xs">
                        <span className="text-gray-400">
                            Feed: <span className="text-gray-700 font-medium">{issue.feedValue}</span>
                        </span>
                        <span className="text-gray-400">
                            ERP: <span className="text-gray-700 font-medium">{issue.erpValue}</span>
                        </span>
                        <span className="text-gray-400">
                            Shopify: <span className="text-gray-700 font-medium">{issue.shopifyValue}</span>
                        </span>
                        <span className="text-gray-300">Variant: {issue.variantId}</span>
                    </div>
                </div>
            </div>
        </div>
    );
}

// ============================================
// MAIN PAGE
// ============================================

export default function FacebookFeedHealth() {
    const urlSearch = Route.useSearch();
    const navigate = useNavigate();
    const queryClient = useQueryClient();
    const [searchInput, setSearchInput] = useState(urlSearch.search ?? '');

    // Debounce search → URL
    useEffect(() => {
        const timer = setTimeout(() => {
            const trimmed = searchInput.trim() || undefined;
            if (trimmed !== urlSearch.search) {
                navigate({
                    to: '/facebook-feed-health',
                    search: { ...urlSearch, search: trimmed },
                    replace: true,
                });
            }
        }, 400);
        return () => clearTimeout(timer);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [searchInput]);

    // Query feed health
    const { data, isLoading, isFetching } = useQuery({
        queryKey: ['facebook', 'feed-health'],
        queryFn: () => getFacebookFeedHealth(),
        staleTime: 5 * 60 * 1000,
    });

    // Force refresh mutation
    const refreshMutation = useMutation({
        mutationFn: () => refreshFacebookFeedHealth(),
        onSuccess: (result) => {
            if (result.success) {
                queryClient.setQueryData(['facebook', 'feed-health'], result);
            }
        },
    });

    const handleRefresh = useCallback(() => {
        refreshMutation.mutate();
    }, [refreshMutation]);

    const handleSeverityChange = useCallback((value: string) => {
        navigate({
            to: '/facebook-feed-health',
            search: { ...urlSearch, severity: value as typeof urlSearch.severity },
            replace: true,
        });
    }, [navigate, urlSearch]);

    const handleIssueTypeChange = useCallback((value: string) => {
        navigate({
            to: '/facebook-feed-health',
            search: { ...urlSearch, issueType: value as typeof urlSearch.issueType },
            replace: true,
        });
    }, [navigate, urlSearch]);

    // Extract data
    const result: FeedHealthResult | undefined = data?.success ? data.data : undefined;
    const stats = result?.stats;
    const allIssues = useMemo(() => result?.issues ?? [], [result?.issues]);

    // Client-side filtering
    const filteredIssues = useMemo(() => {
        let issues = allIssues;

        // Severity filter
        if (urlSearch.severity && urlSearch.severity !== 'all') {
            issues = issues.filter(i => i.severity === urlSearch.severity);
        }

        // Issue type filter
        if (urlSearch.issueType && urlSearch.issueType !== 'all') {
            issues = issues.filter(i => i.type === urlSearch.issueType);
        }

        // Search filter
        if (urlSearch.search) {
            const q = urlSearch.search.toLowerCase();
            issues = issues.filter(i =>
                i.title.toLowerCase().includes(q) ||
                i.variantId.includes(q) ||
                i.color.toLowerCase().includes(q) ||
                i.size.toLowerCase().includes(q) ||
                i.message.toLowerCase().includes(q)
            );
        }

        return issues;
    }, [allIssues, urlSearch.severity, urlSearch.issueType, urlSearch.search]);

    const isRefreshing = refreshMutation.isPending || isFetching;
    const matchPercent = stats && stats.totalFeedItems > 0
        ? Math.round((stats.matchedToErp / stats.totalFeedItems) * 100)
        : 0;

    return (
        <div className="space-y-4 max-w-7xl">
            {/* Header */}
            <div className="flex items-center justify-between">
                <div>
                    <h1 className="text-xl font-semibold">Feed Health</h1>
                    <p className="text-sm text-gray-400 mt-0.5">
                        Facebook catalog feed vs ERP &amp; Shopify
                        {result?.lastFetched && (
                            <span className="ml-2">
                                &middot; Last checked: {formatTime(result.lastFetched)}
                            </span>
                        )}
                    </p>
                </div>
                <div className="flex items-center gap-2">
                    {result?.feedUrl && (
                        <a
                            href={result.feedUrl}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-xs text-gray-400 hover:text-gray-600 flex items-center gap-1"
                        >
                            <ExternalLink className="w-3 h-3" />
                            View XML
                        </a>
                    )}
                    <Button
                        variant="outline"
                        size="sm"
                        onClick={handleRefresh}
                        disabled={isRefreshing}
                    >
                        <RefreshCw className={cn('w-3.5 h-3.5 mr-1.5', isRefreshing && 'animate-spin')} />
                        Refresh
                    </Button>
                </div>
            </div>

            {/* Error state */}
            {data && !data.success && (
                <div className="bg-red-50 border border-red-200 rounded-lg p-4 text-sm text-red-700">
                    <AlertCircle className="w-4 h-4 inline mr-2" />
                    Failed to load feed health: {data.error?.message ?? 'Unknown error'}
                </div>
            )}

            {/* Stats */}
            {stats && (
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                    <StatCard label="Feed Items" value={stats.totalFeedItems} />
                    <StatCard
                        label="Matched to ERP"
                        value={stats.matchedToErp}
                        accent="text-blue-600"
                        suffix={`(${matchPercent}%)`}
                    />
                    <StatCard label="Critical Issues" value={stats.criticalIssues} accent={stats.criticalIssues > 0 ? 'text-red-600' : 'text-gray-900'} />
                    <StatCard label="Warnings" value={stats.warnings} accent={stats.warnings > 0 ? 'text-amber-600' : 'text-gray-900'} />
                </div>
            )}

            {/* Filters */}
            <div className="flex flex-wrap gap-3 items-center">
                <div className="relative flex-1 max-w-xs">
                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
                    <Input
                        placeholder="Search title, variant ID, color..."
                        value={searchInput}
                        onChange={e => setSearchInput(e.target.value)}
                        className="pl-9"
                    />
                </div>
                <Select value={urlSearch.severity} onValueChange={handleSeverityChange}>
                    <SelectTrigger className="w-36">
                        <Filter className="w-3.5 h-3.5 mr-1.5 text-gray-400" />
                        <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                        <SelectItem value="all">All Severities</SelectItem>
                        <SelectItem value="critical">Critical</SelectItem>
                        <SelectItem value="warning">Warning</SelectItem>
                        <SelectItem value="info">Info</SelectItem>
                    </SelectContent>
                </Select>
                <Select value={urlSearch.issueType} onValueChange={handleIssueTypeChange}>
                    <SelectTrigger className="w-48">
                        <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                        <SelectItem value="all">All Issue Types</SelectItem>
                        <SelectItem value="price_mismatch">Price Mismatch</SelectItem>
                        <SelectItem value="availability_wrong">Availability Wrong</SelectItem>
                        <SelectItem value="not_in_erp">Not in ERP</SelectItem>
                        <SelectItem value="not_in_shopify_cache">Not in Shopify Cache</SelectItem>
                        <SelectItem value="metadata_mismatch">Metadata Mismatch</SelectItem>
                    </SelectContent>
                </Select>
                {filteredIssues.length !== allIssues.length && (
                    <span className="text-sm text-gray-400">
                        Showing {filteredIssues.length} of {allIssues.length} issues
                    </span>
                )}
            </div>

            {/* Loading state */}
            {isLoading && (
                <div className="flex flex-col items-center justify-center py-20 text-gray-400">
                    <Loader2 className="w-8 h-8 animate-spin mb-3" />
                    <p className="text-sm">Fetching feed and comparing data...</p>
                    <p className="text-xs text-gray-300 mt-1">This may take 15-30 seconds on first load</p>
                </div>
            )}

            {/* Issues list */}
            {!isLoading && result && (
                <>
                    {filteredIssues.length === 0 ? (
                        <div className="text-center py-16 text-gray-400">
                            <CheckCircle2 className="w-10 h-10 mx-auto mb-3 text-emerald-400" />
                            <p className="font-medium text-gray-600">
                                {allIssues.length === 0 ? 'All clear!' : 'No matching issues'}
                            </p>
                            <p className="text-sm mt-1">
                                {allIssues.length === 0
                                    ? 'Feed data matches ERP and Shopify perfectly'
                                    : 'Try adjusting your search or filters'}
                            </p>
                        </div>
                    ) : (
                        <div className="space-y-2">
                            {filteredIssues.map((issue, idx) => (
                                <IssueRow key={`${issue.variantId}-${issue.type}-${idx}`} issue={issue} />
                            ))}
                        </div>
                    )}
                </>
            )}

            {/* Empty state when no data and not loading */}
            {!isLoading && !result && !data?.error && (
                <div className="text-center py-16 text-gray-400">
                    <Package className="w-10 h-10 mx-auto mb-3 text-gray-300" />
                    <p className="font-medium">No feed data loaded</p>
                    <p className="text-sm mt-1">Click Refresh to fetch and analyze the feed</p>
                </div>
            )}
        </div>
    );
}
