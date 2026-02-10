/**
 * Shopify Catalog Monitoring Page
 *
 * Shows all Shopify product metadata in one place:
 * titles, descriptions, prices, variants, tags, images, ERP link status.
 */

import { useState, useEffect, useCallback } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useNavigate } from '@tanstack/react-router';
import { Route } from '../routes/_authenticated/shopify-catalog';
import {
    Search, Package, ChevronDown, Link2, Link2Off,
    Eye, EyeOff, FileEdit, RefreshCw, Tag, ImageIcon, Database, Loader2,
    MapPin, Radio, AlertTriangle, CheckCircle2, Layers,
} from 'lucide-react';
import {
    getShopifyCatalog,
    getShopifyMetafields,
    getShopifyFeedData,
    type ShopifyCatalogProduct,
    type ShopifyCatalogVariant,
    type ShopifyMetafieldEntry,
} from '../server/functions/shopify';
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

function stripHtml(html: string): string {
    return html
        .replace(/<[^>]*>/g, ' ')
        .replace(/&nbsp;/g, ' ')
        .replace(/&amp;/g, '&')
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/&quot;/g, '"')
        .replace(/&apos;|&#39;/g, "'")
        .replace(/&#(\d+);/g, (_, code: string) => String.fromCharCode(Number(code)))
        .replace(/\s+/g, ' ')
        .trim();
}

function formatDate(dateStr: string | null): string {
    if (!dateStr) return '\u2014';
    try {
        return new Date(dateStr).toLocaleDateString('en-IN', {
            day: 'numeric',
            month: 'short',
            year: 'numeric',
        });
    } catch {
        return '\u2014';
    }
}

function formatDateTime(dateStr: string | null): string {
    if (!dateStr) return '\u2014';
    try {
        return new Date(dateStr).toLocaleDateString('en-IN', {
            day: 'numeric',
            month: 'short',
            year: 'numeric',
            hour: '2-digit',
            minute: '2-digit',
        });
    } catch {
        return '\u2014';
    }
}

function getPriceRange(variants: ShopifyCatalogVariant[]): string {
    if (variants.length === 0) return '\u2014';
    const prices = variants.map(v => parseFloat(v.price)).filter(p => !isNaN(p));
    if (prices.length === 0) return '\u2014';
    const min = Math.min(...prices);
    const max = Math.max(...prices);
    if (min === max) return `\u20B9${min.toLocaleString('en-IN')}`;
    return `\u20B9${min.toLocaleString('en-IN')} \u2013 \u20B9${max.toLocaleString('en-IN')}`;
}

function getTotalStock(variants: ShopifyCatalogVariant[]): number | null {
    const quantities = variants
        .map(v => v.inventoryQuantity)
        .filter((q): q is number => q !== null);
    if (quantities.length === 0) return null;
    return quantities.reduce((sum, q) => sum + q, 0);
}

// ============================================
// STATUS BADGE
// ============================================

function StatusBadge({ status }: { status: string }) {
    switch (status) {
        case 'active':
            return (
                <Badge className="bg-emerald-50 text-emerald-700 border-emerald-200 hover:bg-emerald-50">
                    <Eye className="w-3 h-3 mr-1" />Active
                </Badge>
            );
        case 'archived':
            return (
                <Badge className="bg-gray-100 text-gray-600 border-gray-200 hover:bg-gray-100">
                    <EyeOff className="w-3 h-3 mr-1" />Archived
                </Badge>
            );
        case 'draft':
            return (
                <Badge className="bg-amber-50 text-amber-700 border-amber-200 hover:bg-amber-50">
                    <FileEdit className="w-3 h-3 mr-1" />Draft
                </Badge>
            );
        default:
            return (
                <Badge variant="outline" className="text-gray-400">
                    {status}
                </Badge>
            );
    }
}

// ============================================
// KNOWN METAFIELD LABELS
// ============================================

const KNOWN_METAFIELDS: Record<string, string> = {
    'mm-google-shopping.custom_product_type': 'Google Product Type',
    'mm-google-shopping.google_product_category': 'Google Product Category',
    'mm-google-shopping.age_group': 'Age Group',
    'mm-google-shopping.gender': 'Gender',
    'mm-google-shopping.condition': 'Condition',
    'mm-google-shopping.material': 'Material',
    'mm-google-shopping.pattern': 'Pattern',
    'mm-google-shopping.color': 'Color',
    'mm-google-shopping.size': 'Size',
    'mm-google-shopping.size_type': 'Size Type',
    'mm-google-shopping.size_system': 'Size System',
    'mm-google-shopping.custom_label_0': 'Custom Label 0',
    'mm-google-shopping.custom_label_1': 'Custom Label 1',
    'mm-google-shopping.custom_label_2': 'Custom Label 2',
    'mm-google-shopping.custom_label_3': 'Custom Label 3',
    'mm-google-shopping.custom_label_4': 'Custom Label 4',
    'seo.title': 'SEO Title',
    'seo.description': 'SEO Description',
    'seo.hidden': 'Hidden from SEO',
    'global.title_tag': 'Meta Title',
    'global.description_tag': 'Meta Description',
    'my_fields.gender': 'Gender (Custom)',
    'custom.product_type_for_feed': 'Feed Product Type',
    'custom.product_highlights': 'Product Highlights',
    'custom.fabric': 'Fabric',
    'custom.care_instructions': 'Care Instructions',
};

function getMetafieldLabel(namespace: string, key: string): string {
    return KNOWN_METAFIELDS[`${namespace}.${key}`] ?? `${key}`;
}

// Namespaces that contain review data — extracted separately, hidden from raw list
const REVIEW_NAMESPACES = new Set(['judgeme', 'reviews']);

interface ReviewData {
    averageRating: number | null;
    reviewCount: number | null;
    scaleMax: number;
}

/** Extract review data from metafields (Judge.me, Shopify reviews, etc.) */
function extractReviewData(metafields: ShopifyMetafieldEntry[]): ReviewData {
    let averageRating: number | null = null;
    let reviewCount: number | null = null;
    let scaleMax = 5;

    for (const mf of metafields) {
        const ns = mf.namespace;
        const key = mf.key;
        const val = mf.value;

        // reviews.rating → JSON {"scale_min":"1.0","scale_max":"5.0","value":"5.0"}
        if (ns === 'reviews' && key === 'rating') {
            try {
                const parsed = JSON.parse(val) as { value?: string; scale_max?: string };
                if (parsed.value) averageRating = parseFloat(parsed.value);
                if (parsed.scale_max) scaleMax = parseFloat(parsed.scale_max);
            } catch { /* skip */ }
        }

        // reviews.rating_count → number string
        if (ns === 'reviews' && key === 'rating_count') {
            const n = parseInt(val, 10);
            if (!isNaN(n)) reviewCount = n;
        }

        // judgeme.badge HTML → data-average-rating='5.00' data-number-of-reviews='4'
        if (ns === 'judgeme' && (key === 'badge' || key === 'widget')) {
            const ratingMatch = val.match(/data-average-rating='([^']+)'/);
            const countMatch = val.match(/data-number-of-reviews='(\d+)'/);
            if (ratingMatch && averageRating === null) {
                averageRating = parseFloat(ratingMatch[1]);
            }
            if (countMatch && reviewCount === null) {
                reviewCount = parseInt(countMatch[1], 10);
            }
        }
    }

    return { averageRating, reviewCount, scaleMax };
}

/** Star rating display */
function StarRating({ rating, max = 5 }: { rating: number; max?: number }) {
    const fullStars = Math.floor(rating);
    const hasHalf = rating - fullStars >= 0.25 && rating - fullStars < 0.75;
    const emptyStars = max - fullStars - (hasHalf ? 1 : 0);

    return (
        <span className="inline-flex items-center gap-px">
            {Array.from({ length: fullStars }).map((_, i) => (
                <svg key={`f${i}`} className="w-4 h-4 text-amber-400" fill="currentColor" viewBox="0 0 20 20">
                    <path d="M9.049 2.927c.3-.921 1.603-.921 1.902 0l1.07 3.292a1 1 0 00.95.69h3.462c.969 0 1.371 1.24.588 1.81l-2.8 2.034a1 1 0 00-.364 1.118l1.07 3.292c.3.921-.755 1.688-1.54 1.118l-2.8-2.034a1 1 0 00-1.175 0l-2.8 2.034c-.784.57-1.838-.197-1.539-1.118l1.07-3.292a1 1 0 00-.364-1.118L2.98 8.72c-.783-.57-.38-1.81.588-1.81h3.461a1 1 0 00.951-.69l1.07-3.292z" />
                </svg>
            ))}
            {hasHalf && (
                <svg className="w-4 h-4" viewBox="0 0 20 20">
                    <defs>
                        <linearGradient id={`half-${rating}`}>
                            <stop offset="50%" stopColor="#fbbf24" />
                            <stop offset="50%" stopColor="#d1d5db" />
                        </linearGradient>
                    </defs>
                    <path fill={`url(#half-${rating})`} d="M9.049 2.927c.3-.921 1.603-.921 1.902 0l1.07 3.292a1 1 0 00.95.69h3.462c.969 0 1.371 1.24.588 1.81l-2.8 2.034a1 1 0 00-.364 1.118l1.07 3.292c.3.921-.755 1.688-1.54 1.118l-2.8-2.034a1 1 0 00-1.175 0l-2.8 2.034c-.784.57-1.838-.197-1.539-1.118l1.07-3.292a1 1 0 00-.364-1.118L2.98 8.72c-.783-.57-.38-1.81.588-1.81h3.461a1 1 0 00.951-.69l1.07-3.292z" />
                </svg>
            )}
            {Array.from({ length: emptyStars }).map((_, i) => (
                <svg key={`e${i}`} className="w-4 h-4 text-gray-200" fill="currentColor" viewBox="0 0 20 20">
                    <path d="M9.049 2.927c.3-.921 1.603-.921 1.902 0l1.07 3.292a1 1 0 00.95.69h3.462c.969 0 1.371 1.24.588 1.81l-2.8 2.034a1 1 0 00-.364 1.118l1.07 3.292c.3.921-.755 1.688-1.54 1.118l-2.8-2.034a1 1 0 00-1.175 0l-2.8 2.034c-.784.57-1.838-.197-1.539-1.118l1.07-3.292a1 1 0 00-.364-1.118L2.98 8.72c-.783-.57-.38-1.81.588-1.81h3.461a1 1 0 00.951-.69l1.07-3.292z" />
                </svg>
            ))}
        </span>
    );
}

/** Review summary card — shown in the expanded product detail */
function ReviewSummary({ metafields }: { metafields: ShopifyMetafieldEntry[] }) {
    const { averageRating, reviewCount, scaleMax } = extractReviewData(metafields);

    if (averageRating === null && reviewCount === null) return null;

    return (
        <div className="flex items-center gap-4 rounded-lg border bg-white px-4 py-3">
            {averageRating !== null && (
                <div className="flex items-center gap-2">
                    <StarRating rating={averageRating} max={scaleMax} />
                    <span className="text-lg font-semibold text-gray-900">
                        {averageRating.toFixed(1)}
                    </span>
                    <span className="text-sm text-gray-400">/ {scaleMax}</span>
                </div>
            )}
            {reviewCount !== null && (
                <div className="text-sm text-gray-500">
                    <span className="font-medium text-gray-700">{reviewCount}</span>
                    {' '}review{reviewCount !== 1 ? 's' : ''}
                </div>
            )}
        </div>
    );
}

const NS_LABELS: Record<string, string> = {
    'mm-google-shopping': 'Google Shopping',
    'seo': 'SEO',
    'global': 'Global / Meta Tags',
    'my_fields': 'Custom Fields',
    'custom': 'Custom',
    'judgeme': 'Reviews (Judge.me)',
    'reviews': 'Reviews',
    'recommended_products': 'Recommended Products',
    'shopify': 'Shopify',
};

// ============================================
// GOOGLE PRODUCT TAXONOMY LOOKUP
// ============================================

type TaxonomyMap = Record<string, string>;
let taxonomyCache: TaxonomyMap | null = null;
let taxonomyPromise: Promise<TaxonomyMap> | null = null;

function loadTaxonomy(): Promise<TaxonomyMap> {
    if (taxonomyCache) return Promise.resolve(taxonomyCache);
    if (!taxonomyPromise) {
        taxonomyPromise = import('../data/googleProductTaxonomy.json')
            .then(mod => {
                taxonomyCache = mod.default as TaxonomyMap;
                return taxonomyCache;
            })
            .catch(() => {
                taxonomyPromise = null;
                return {} as TaxonomyMap;
            });
    }
    return taxonomyPromise;
}

/** Hook: lazy-loads the Google taxonomy map */
function useGoogleTaxonomy() {
    const [taxonomy, setTaxonomy] = useState<TaxonomyMap | null>(taxonomyCache);

    useEffect(() => {
        if (!taxonomy) {
            loadTaxonomy().then(setTaxonomy);
        }
    }, [taxonomy]);

    return taxonomy;
}

/** Resolves a Google Product Category code to its full name */
function GoogleCategoryLabel({ code }: { code: string }) {
    const taxonomy = useGoogleTaxonomy();
    const resolved = taxonomy?.[code];

    if (!taxonomy) {
        return <span className="text-gray-500">{code} <span className="text-gray-300 text-xs">(loading...)</span></span>;
    }

    if (!resolved) {
        return <span className="text-gray-700">{code} <span className="text-gray-400 text-xs">(unknown code)</span></span>;
    }

    // Show the full breadcrumb path with the code
    const parts = resolved.split(' > ');
    return (
        <div>
            <span className="font-medium text-gray-700">{parts[parts.length - 1]}</span>
            {parts.length > 1 && (
                <div className="text-xs text-gray-400 mt-0.5">
                    {resolved}
                </div>
            )}
            <div className="text-[10px] text-gray-300 mt-0.5">Code: {code}</div>
        </div>
    );
}

// ============================================
// METAFIELD VALUE FORMATTING
// ============================================

/** Check if a string looks like HTML */
function isHtml(val: string): boolean {
    return /<[a-z][\s\S]*>/i.test(val);
}

/** Check if string looks like a JSON array */
function isJsonArray(val: string): boolean {
    return val.startsWith('[') && val.endsWith(']');
}

/** Check if string looks like a JSON object */
function isJsonObject(val: string): boolean {
    return val.startsWith('{') && val.endsWith('}');
}

/** Extract a readable summary from a Shopify GID */
function formatGid(gid: string): string {
    // gid://shopify/Product/123456 → Product #123456
    const match = gid.match(/gid:\/\/shopify\/(\w+)\/(\d+)/);
    if (match) return `${match[1]} #${match[2]}`;
    return gid;
}

/** Format a metafield value for display */
function MetafieldValue({ value, type, namespace, fieldKey }: {
    value: string; type: string; namespace?: string; fieldKey?: string;
}) {
    // 0. Google Product Category code → resolve to name
    if (namespace === 'mm-google-shopping' && fieldKey === 'google_product_category') {
        return <GoogleCategoryLabel code={value} />;
    }

    // 1. HTML content — strip tags and show as text
    if (isHtml(value)) {
        const text = value
            .replace(/<[^>]*>/g, ' ')
            .replace(/\s+/g, ' ')
            .trim();
        if (!text || text.length < 3) {
            return <span className="text-gray-300 italic">HTML widget (no text content)</span>;
        }
        return (
            <span className="text-gray-700 line-clamp-2" title={text}>
                {text.length > 150 ? `${text.slice(0, 150)}...` : text}
            </span>
        );
    }

    // 2. JSON arrays — parse and show items
    if (isJsonArray(value)) {
        try {
            const arr = JSON.parse(value) as unknown[];
            if (arr.length === 0) return <span className="text-gray-300">Empty list</span>;

            // Array of GIDs
            if (typeof arr[0] === 'string' && (arr[0] as string).startsWith('gid://')) {
                return (
                    <div className="space-y-0.5">
                        {arr.slice(0, 3).map((item, i) => (
                            <div key={i} className="text-gray-500 text-xs font-mono">
                                {formatGid(item as string)}
                            </div>
                        ))}
                        {arr.length > 3 && (
                            <div className="text-gray-400 text-xs">+{arr.length - 3} more</div>
                        )}
                    </div>
                );
            }

            // Array of URLs
            if (typeof arr[0] === 'string' && (arr[0] as string).startsWith('http')) {
                return (
                    <div className="space-y-0.5">
                        {arr.slice(0, 2).map((url, i) => {
                            const urlStr = url as string;
                            const short = urlStr.replace(/https?:\/\/(www\.)?/, '').split('/').slice(0, 3).join('/');
                            return (
                                <div key={i} className="text-xs truncate max-w-[280px]" title={urlStr}>
                                    <a href={urlStr} target="_blank" rel="noopener noreferrer"
                                       className="text-blue-500 hover:underline">{short}</a>
                                </div>
                            );
                        })}
                        {arr.length > 2 && (
                            <div className="text-gray-400 text-xs">+{arr.length - 2} more</div>
                        )}
                    </div>
                );
            }

            // Array of strings
            if (typeof arr[0] === 'string') {
                return (
                    <span className="text-gray-700">
                        {(arr as string[]).slice(0, 5).join(', ')}
                        {arr.length > 5 && ` +${arr.length - 5} more`}
                    </span>
                );
            }

            // Fallback: just show count
            return <span className="text-gray-500">{arr.length} item{arr.length !== 1 ? 's' : ''}</span>;
        } catch {
            // Not valid JSON, fall through
        }
    }

    // 3. JSON objects — show key-value pairs
    if (isJsonObject(value)) {
        try {
            const obj = JSON.parse(value) as Record<string, unknown>;
            const entries = Object.entries(obj);
            return (
                <div className="space-y-0.5">
                    {entries.slice(0, 4).map(([k, v]) => (
                        <div key={k} className="text-xs">
                            <span className="text-gray-400">{k}:</span>{' '}
                            <span className="text-gray-700">{String(v)}</span>
                        </div>
                    ))}
                    {entries.length > 4 && (
                        <div className="text-gray-400 text-xs">+{entries.length - 4} more fields</div>
                    )}
                </div>
            );
        } catch {
            // Not valid JSON, fall through
        }
    }

    // 4. Single GID
    if (value.startsWith('gid://')) {
        return <span className="text-gray-500 font-mono text-xs">{formatGid(value)}</span>;
    }

    // 5. URLs — make clickable and truncate
    if (value.startsWith('http://') || value.startsWith('https://')) {
        const short = value.replace(/https?:\/\/(www\.)?/, '').split('?')[0];
        return (
            <a href={value} target="_blank" rel="noopener noreferrer"
               className="text-blue-500 hover:underline text-xs truncate block max-w-[300px]"
               title={value}>
                {short.length > 50 ? `${short.slice(0, 50)}...` : short}
            </a>
        );
    }

    // 6. Boolean type
    if (type === 'boolean') {
        return (
            <span className={value === 'true' ? 'text-emerald-600' : 'text-gray-400'}>
                {value === 'true' ? 'Yes' : 'No'}
            </span>
        );
    }

    // 7. Number type — format nicely
    if (type === 'number_integer' || type === 'number_decimal') {
        const num = parseFloat(value);
        if (!isNaN(num)) {
            return <span className="text-gray-700 font-medium">{num.toLocaleString('en-IN')}</span>;
        }
    }

    // 8. Plain text — truncate if long
    if (value.length > 200) {
        return (
            <span className="text-gray-700 line-clamp-2" title={value}>
                {value.slice(0, 200)}...
            </span>
        );
    }

    return <span className="text-gray-700">{value}</span>;
}

// ============================================
// METAFIELDS PANEL (LAZY-LOADED)
// ============================================

function MetafieldsPanel({ shopifyProductId }: { shopifyProductId: string }) {
    const { data, isLoading, error, refetch } = useQuery({
        queryKey: ['shopify', 'metafields', shopifyProductId],
        queryFn: () => getShopifyMetafields({ data: { shopifyProductId } }),
        staleTime: 5 * 60 * 1000,
    });

    if (isLoading) {
        return (
            <div className="flex items-center gap-2 text-sm text-gray-400 py-2">
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
                Loading metafields from Shopify...
            </div>
        );
    }

    if (error || !data?.success) {
        return (
            <div className="text-sm text-gray-400 py-2">
                <span className="text-red-400">Could not load metafields.</span>{' '}
                <button type="button" className="underline" onClick={() => refetch()}>
                    Retry
                </button>
            </div>
        );
    }

    const metafields = data.data?.metafields ?? [];

    if (metafields.length === 0) {
        return (
            <div className="text-sm text-gray-400 py-1">
                No metafields set for this product.
            </div>
        );
    }

    // Separate review metafields from the rest
    const reviewMetafields = metafields.filter(mf => REVIEW_NAMESPACES.has(mf.namespace));
    const otherMetafields = metafields.filter(mf => !REVIEW_NAMESPACES.has(mf.namespace));

    // Group non-review metafields by namespace
    const grouped = new Map<string, ShopifyMetafieldEntry[]>();
    for (const mf of otherMetafields) {
        if (!grouped.has(mf.namespace)) grouped.set(mf.namespace, []);
        grouped.get(mf.namespace)!.push(mf);
    }

    // Sort: known feed namespaces first
    const PRIORITY_NS = ['mm-google-shopping', 'seo', 'global', 'my_fields', 'custom'];
    const sortedNamespaces = [...grouped.keys()].sort((a, b) => {
        const ai = PRIORITY_NS.indexOf(a);
        const bi = PRIORITY_NS.indexOf(b);
        if (ai !== -1 && bi !== -1) return ai - bi;
        if (ai !== -1) return -1;
        if (bi !== -1) return 1;
        return a.localeCompare(b);
    });

    return (
        <div className="space-y-4">
            {/* Review summary — extracted from review metafields */}
            {reviewMetafields.length > 0 && <ReviewSummary metafields={reviewMetafields} />}

            {sortedNamespaces.map(ns => {
                const fields = grouped.get(ns)!;
                return (
                    <div key={ns}>
                        <div className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2 pb-1 border-b border-gray-100">
                            {NS_LABELS[ns] ?? ns}
                        </div>
                        <div className="grid grid-cols-1 lg:grid-cols-2 gap-x-8 gap-y-2">
                            {fields.map(mf => (
                                <div key={mf.id} className="flex gap-3 text-sm min-w-0 overflow-hidden">
                                    <span className="text-gray-400 whitespace-nowrap shrink-0 w-[140px] text-right text-xs pt-0.5">
                                        {getMetafieldLabel(mf.namespace, mf.key)}
                                    </span>
                                    <div className="min-w-0 flex-1 overflow-hidden">
                                        <MetafieldValue value={mf.value} type={mf.type} namespace={mf.namespace} fieldKey={mf.key} />
                                    </div>
                                </div>
                            ))}
                        </div>
                    </div>
                );
            })}
        </div>
    );
}

// ============================================
// FEED ENRICHMENT PANEL (COLLECTIONS, CHANNELS, INVENTORY BY LOCATION)
// ============================================

function FeedEnrichmentPanel({ shopifyProductId }: { shopifyProductId: string }) {
    const { data, isLoading, error, refetch } = useQuery({
        queryKey: ['shopify', 'feed-data', shopifyProductId],
        queryFn: () => getShopifyFeedData({ data: { shopifyProductId } }),
        staleTime: 5 * 60 * 1000,
    });

    if (isLoading) {
        return (
            <div className="flex items-center gap-2 text-sm text-gray-400 py-2">
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
                Loading collections, channels & inventory...
            </div>
        );
    }

    if (error || !data?.success || !data.data) {
        return (
            <div className="text-sm text-gray-400 py-2">
                <span className="text-red-400">Could not load feed data.</span>{' '}
                <button type="button" className="underline" onClick={() => refetch()}>Retry</button>
            </div>
        );
    }

    const { collections, salesChannels, variantEnrichments } = data.data;

    return (
        <div className="space-y-4">
            {/* Collections */}
            <div>
                <div className="text-xs font-medium text-gray-500 mb-1.5">
                    <Layers className="w-3 h-3 inline mr-1" />Collections ({collections.length})
                </div>
                {collections.length > 0 ? (
                    <div className="flex flex-wrap gap-1.5">
                        {collections.map(c => (
                            <Badge key={c.handle} variant="secondary" className="text-xs font-normal">
                                {c.title}
                            </Badge>
                        ))}
                    </div>
                ) : (
                    <span className="text-sm text-gray-400">Not in any collections</span>
                )}
            </div>

            {/* Sales Channels */}
            <div>
                <div className="text-xs font-medium text-gray-500 mb-1.5">
                    <Radio className="w-3 h-3 inline mr-1" />Sales Channels
                </div>
                {salesChannels.length > 0 ? (
                    <div className="flex flex-wrap gap-2">
                        {salesChannels.map(ch => (
                            <span key={ch.name} className="flex items-center gap-1 text-sm">
                                <span className={cn(
                                    'w-2 h-2 rounded-full',
                                    ch.isPublished ? 'bg-emerald-400' : 'bg-gray-300'
                                )} />
                                <span className={ch.isPublished ? 'text-gray-700' : 'text-gray-400'}>
                                    {ch.name}
                                </span>
                            </span>
                        ))}
                    </div>
                ) : (
                    <span className="text-sm text-gray-400">No channel data</span>
                )}
            </div>

            {/* Inventory by Location */}
            {variantEnrichments.some(v => v.inventoryLevels.length > 0) && (
                <div>
                    <div className="text-xs font-medium text-gray-500 mb-1.5">
                        <MapPin className="w-3 h-3 inline mr-1" />Inventory by Location
                    </div>
                    <div className="overflow-x-auto rounded-md border bg-white">
                        <table className="w-full text-sm">
                            <thead>
                                <tr className="border-b bg-gray-50 text-gray-500 text-xs">
                                    <th className="text-left px-3 py-2 font-medium">Variant</th>
                                    <th className="text-left px-3 py-2 font-medium">Location</th>
                                    <th className="text-right px-3 py-2 font-medium">Available</th>
                                    <th className="text-right px-3 py-2 font-medium">Committed</th>
                                    <th className="text-right px-3 py-2 font-medium">On Hand</th>
                                </tr>
                            </thead>
                            <tbody>
                                {variantEnrichments.flatMap(v =>
                                    v.inventoryLevels.map((il, idx) => (
                                        <tr key={`${v.variantId}-${il.locationName}`} className="border-b last:border-0">
                                            {idx === 0 && (
                                                <td className="px-3 py-1.5 text-xs" rowSpan={v.inventoryLevels.length}>
                                                    {v.sku || v.title}
                                                </td>
                                            )}
                                            <td className="px-3 py-1.5">{il.locationName}</td>
                                            <td className={cn(
                                                'px-3 py-1.5 text-right',
                                                (il.quantities.available ?? 0) === 0 && 'text-red-500 font-medium',
                                            )}>
                                                {il.quantities.available ?? 0}
                                            </td>
                                            <td className="px-3 py-1.5 text-right text-gray-500">
                                                {il.quantities.committed ?? 0}
                                            </td>
                                            <td className="px-3 py-1.5 text-right">
                                                {il.quantities.on_hand ?? 0}
                                            </td>
                                        </tr>
                                    ))
                                )}
                            </tbody>
                        </table>
                    </div>
                </div>
            )}

            {/* Variant Metafields */}
            {variantEnrichments.some(v => v.metafields.length > 0) && (
                <div>
                    <div className="text-xs font-medium text-gray-500 mb-1.5">
                        Variant-Level Metafields
                    </div>
                    <div className="space-y-2">
                        {variantEnrichments.filter(v => v.metafields.length > 0).map(v => (
                            <div key={v.variantId} className="text-sm">
                                <span className="text-gray-500 font-medium">{v.sku || v.title}:</span>
                                <div className="ml-4 grid grid-cols-1 md:grid-cols-2 gap-x-8 gap-y-1 mt-1">
                                    {v.metafields.map(mf => (
                                        <div key={`${mf.namespace}.${mf.key}`} className="flex gap-3 min-w-0 overflow-hidden">
                                            <span className="text-gray-400 whitespace-nowrap shrink-0 text-xs pt-0.5">
                                                {getMetafieldLabel(mf.namespace, mf.key)}
                                            </span>
                                            <div className="min-w-0 flex-1 overflow-hidden">
                                                <MetafieldValue value={mf.value} type={mf.type} namespace={mf.namespace} fieldKey={mf.key} />
                                            </div>
                                        </div>
                                    ))}
                                </div>
                            </div>
                        ))}
                    </div>
                </div>
            )}
        </div>
    );
}

// ============================================
// FEED READINESS AUDIT
// ============================================

interface AuditCheck {
    label: string;
    pass: boolean;
    detail?: string;
}

function FeedReadinessAudit({ product }: { product: ShopifyCatalogProduct }) {
    const checks: AuditCheck[] = [
        {
            label: 'Title',
            pass: !!product.title && product.title !== 'Untitled',
        },
        {
            label: 'Description',
            pass: !!product.bodyHtml && product.bodyHtml.length > 20,
            detail: product.bodyHtml ? `${product.bodyHtml.replace(/<[^>]*>/g, '').length} chars` : 'Missing',
        },
        {
            label: 'Product Type',
            pass: !!product.productType,
        },
        {
            label: 'Images',
            pass: product.images.length >= 1,
            detail: `${product.images.length} image${product.images.length !== 1 ? 's' : ''}`,
        },
        {
            label: 'Vendor / Brand',
            pass: !!product.vendor,
        },
        {
            label: 'All variants have SKU',
            pass: product.variants.every(v => !!v.sku),
            detail: product.variants.filter(v => !v.sku).length > 0
                ? `${product.variants.filter(v => !v.sku).length} missing`
                : undefined,
        },
        {
            label: 'All variants have barcode/GTIN',
            pass: product.variants.every(v => !!v.barcode),
            detail: product.variants.filter(v => !v.barcode).length > 0
                ? `${product.variants.filter(v => !v.barcode).length} missing`
                : undefined,
        },
        {
            label: 'All variants have price > 0',
            pass: product.variants.every(v => parseFloat(v.price) > 0),
        },
        {
            label: 'Tags',
            pass: product.tags.length > 0,
            detail: `${product.tags.length} tag${product.tags.length !== 1 ? 's' : ''}`,
        },
        {
            label: 'Status active',
            pass: product.status === 'active',
            detail: product.status,
        },
    ];

    const passCount = checks.filter(c => c.pass).length;
    const score = Math.round((passCount / checks.length) * 100);

    return (
        <div>
            <div className="flex items-center gap-2 mb-2">
                <div className="text-xs font-medium text-gray-400 uppercase tracking-wide">
                    Feed Readiness
                </div>
                <Badge
                    className={cn(
                        'text-xs',
                        score === 100 ? 'bg-emerald-50 text-emerald-700 border-emerald-200' :
                        score >= 70 ? 'bg-amber-50 text-amber-700 border-amber-200' :
                        'bg-red-50 text-red-600 border-red-200',
                    )}
                >
                    {score}% ({passCount}/{checks.length})
                </Badge>
            </div>
            <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-x-4 gap-y-1">
                {checks.map(check => (
                    <div key={check.label} className="flex items-center gap-1.5 text-xs">
                        {check.pass ? (
                            <CheckCircle2 className="w-3.5 h-3.5 text-emerald-500 flex-shrink-0" />
                        ) : (
                            <AlertTriangle className="w-3.5 h-3.5 text-amber-500 flex-shrink-0" />
                        )}
                        <span className={check.pass ? 'text-gray-600' : 'text-amber-700 font-medium'}>
                            {check.label}
                        </span>
                        {check.detail && !check.pass && (
                            <span className="text-gray-400">({check.detail})</span>
                        )}
                    </div>
                ))}
            </div>
        </div>
    );
}

// ============================================
// STAT CARD
// ============================================

function StatCard({ label, value, accent }: { label: string; value: number; accent?: string }) {
    return (
        <div className="bg-white border rounded-lg px-4 py-3">
            <div className="text-xs text-gray-500 uppercase tracking-wide">{label}</div>
            <div className={cn('text-2xl font-semibold mt-0.5', accent ?? 'text-gray-900')}>
                {value}
            </div>
        </div>
    );
}

// ============================================
// PRODUCT CARD
// ============================================

function ProductCard({
    product,
    isExpanded,
    onToggle,
}: {
    product: ShopifyCatalogProduct;
    isExpanded: boolean;
    onToggle: () => void;
}) {
    const priceRange = getPriceRange(product.variants);
    const totalStock = getTotalStock(product.variants);
    const description = product.bodyHtml ? stripHtml(product.bodyHtml) : null;
    const hasComparePrice = product.variants.some(v => v.compareAtPrice);

    return (
        <div className="border rounded-lg bg-white overflow-hidden">
            {/* Summary row */}
            <button
                type="button"
                className="w-full flex items-center gap-4 p-4 text-left hover:bg-gray-50/50 transition-colors"
                onClick={onToggle}
            >
                {/* Image */}
                {product.imageUrl ? (
                    <img
                        src={product.imageUrl}
                        alt={product.title}
                        className="w-14 h-14 object-cover rounded-md flex-shrink-0 bg-gray-100"
                    />
                ) : (
                    <div className="w-14 h-14 bg-gray-100 rounded-md flex items-center justify-center flex-shrink-0">
                        <Package className="w-5 h-5 text-gray-300" />
                    </div>
                )}

                {/* Title + handle + tags */}
                <div className="flex-1 min-w-0">
                    <div className="font-medium text-sm leading-tight truncate">{product.title}</div>
                    <div className="text-xs text-gray-400 mt-0.5">/{product.handle}</div>
                    {product.tags.length > 0 && (
                        <div className="flex gap-1 mt-1.5 flex-wrap">
                            {product.tags.slice(0, 4).map(tag => (
                                <span
                                    key={tag}
                                    className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] bg-gray-100 text-gray-500"
                                >
                                    {tag}
                                </span>
                            ))}
                            {product.tags.length > 4 && (
                                <span className="text-[10px] text-gray-400">
                                    +{product.tags.length - 4}
                                </span>
                            )}
                        </div>
                    )}
                </div>

                {/* Status */}
                <div className="flex-shrink-0 hidden sm:block">
                    <StatusBadge status={product.status} />
                </div>

                {/* Price + variants */}
                <div className="text-right flex-shrink-0 hidden md:block">
                    <div className="text-sm font-medium">{priceRange}</div>
                    <div className="text-xs text-gray-400">
                        {product.variants.length} variant{product.variants.length !== 1 ? 's' : ''}
                    </div>
                    {totalStock !== null && (
                        <div className={cn(
                            'text-xs',
                            totalStock === 0 ? 'text-red-500' : totalStock < 10 ? 'text-amber-500' : 'text-gray-400',
                        )}>
                            {totalStock} in stock
                        </div>
                    )}
                </div>

                {/* ERP link */}
                <div className="flex-shrink-0 hidden lg:block">
                    {product.erpProductId ? (
                        <Badge variant="outline" className="text-emerald-600 border-emerald-200 text-xs">
                            <Link2 className="w-3 h-3 mr-1" />ERP
                        </Badge>
                    ) : (
                        <Badge variant="outline" className="text-gray-300 border-gray-200 text-xs">
                            <Link2Off className="w-3 h-3 mr-1" />No ERP
                        </Badge>
                    )}
                </div>

                {/* Expand arrow */}
                <ChevronDown
                    className={cn(
                        'w-4 h-4 text-gray-400 flex-shrink-0 transition-transform',
                        isExpanded && 'rotate-180',
                    )}
                />
            </button>

            {/* Expanded details */}
            {isExpanded && (
                <div className="border-t bg-gray-50/30">
                    <div className="p-4 space-y-5">
                        {/* Mobile-only status + price */}
                        <div className="flex gap-3 sm:hidden">
                            <StatusBadge status={product.status} />
                            <span className="text-sm font-medium">{priceRange}</span>
                        </div>

                        {/* Metadata grid */}
                        <div className="grid grid-cols-2 md:grid-cols-4 gap-x-6 gap-y-2 text-sm">
                            <div>
                                <span className="text-gray-400">Vendor</span>
                                <div className="font-medium">{product.vendor || '\u2014'}</div>
                            </div>
                            <div>
                                <span className="text-gray-400">Product Type</span>
                                <div className="font-medium">{product.productType || '\u2014'}</div>
                            </div>
                            <div>
                                <span className="text-gray-400">Published</span>
                                <div className="font-medium">{formatDate(product.publishedAt)}</div>
                            </div>
                            <div>
                                <span className="text-gray-400">Last Updated</span>
                                <div className="font-medium">{formatDate(product.updatedAt)}</div>
                            </div>
                        </div>

                        {/* Description */}
                        {description && (
                            <div>
                                <div className="text-xs font-medium text-gray-400 uppercase tracking-wide mb-1">Description</div>
                                <p className="text-sm text-gray-600 leading-relaxed line-clamp-3">
                                    {description}
                                </p>
                            </div>
                        )}

                        {/* Options */}
                        {product.options.length > 0 && product.options[0].name !== 'Title' && (
                            <div>
                                <div className="text-xs font-medium text-gray-400 uppercase tracking-wide mb-1">Options</div>
                                <div className="flex flex-wrap gap-4 text-sm">
                                    {product.options.map(opt => (
                                        <div key={opt.name}>
                                            <span className="text-gray-500">{opt.name}:</span>{' '}
                                            <span className="font-medium">{opt.values.join(', ')}</span>
                                        </div>
                                    ))}
                                </div>
                            </div>
                        )}

                        {/* Tags */}
                        {product.tags.length > 0 && (
                            <div>
                                <div className="text-xs font-medium text-gray-400 uppercase tracking-wide mb-1.5">
                                    <Tag className="w-3 h-3 inline mr-1" />Tags
                                </div>
                                <div className="flex flex-wrap gap-1.5">
                                    {product.tags.map(tag => (
                                        <Badge key={tag} variant="secondary" className="text-xs font-normal">
                                            {tag}
                                        </Badge>
                                    ))}
                                </div>
                            </div>
                        )}

                        {/* Feed Readiness Audit */}
                        <FeedReadinessAudit product={product} />

                        {/* Variants table */}
                        <div>
                            <div className="text-xs font-medium text-gray-400 uppercase tracking-wide mb-2">
                                Variants ({product.variants.length})
                            </div>
                            <div className="overflow-x-auto rounded-md border bg-white">
                                <table className="w-full text-sm">
                                    <thead>
                                        <tr className="border-b bg-gray-50 text-gray-500 text-xs">
                                            <th className="text-left px-3 py-2 font-medium">SKU</th>
                                            <th className="text-left px-3 py-2 font-medium">Color</th>
                                            <th className="text-left px-3 py-2 font-medium">Size</th>
                                            <th className="text-right px-3 py-2 font-medium">Price</th>
                                            {hasComparePrice && (
                                                <th className="text-right px-3 py-2 font-medium">Compare</th>
                                            )}
                                            <th className="text-right px-3 py-2 font-medium">Stock</th>
                                            <th className="text-left px-3 py-2 font-medium">Barcode</th>
                                            <th className="text-left px-3 py-2 font-medium">Weight</th>
                                            <th className="text-center px-3 py-2 font-medium">Tax</th>
                                            <th className="text-center px-3 py-2 font-medium">Ship</th>
                                            <th className="text-left px-3 py-2 font-medium">Inv Policy</th>
                                        </tr>
                                    </thead>
                                    <tbody>
                                        {product.variants.map(v => (
                                            <tr key={v.id} className="border-b last:border-0 hover:bg-gray-50/50">
                                                <td className="px-3 py-1.5 font-mono text-xs">
                                                    {v.sku || <span className="text-gray-300">none</span>}
                                                </td>
                                                <td className="px-3 py-1.5">{v.option1 || '\u2014'}</td>
                                                <td className="px-3 py-1.5">{v.option2 || v.option3 || '\u2014'}</td>
                                                <td className="px-3 py-1.5 text-right font-medium">
                                                    {'\u20B9'}{parseFloat(v.price).toLocaleString('en-IN')}
                                                </td>
                                                {hasComparePrice && (
                                                    <td className="px-3 py-1.5 text-right text-gray-400">
                                                        {v.compareAtPrice
                                                            ? `\u20B9${parseFloat(v.compareAtPrice).toLocaleString('en-IN')}`
                                                            : '\u2014'}
                                                    </td>
                                                )}
                                                <td className={cn(
                                                    'px-3 py-1.5 text-right',
                                                    v.inventoryQuantity === 0 && 'text-red-500 font-medium',
                                                    v.inventoryQuantity !== null && v.inventoryQuantity > 0 && v.inventoryQuantity < 5 && 'text-amber-500',
                                                )}>
                                                    {v.inventoryQuantity ?? '\u2014'}
                                                </td>
                                                <td className="px-3 py-1.5 text-xs text-gray-400">
                                                    {v.barcode || '\u2014'}
                                                </td>
                                                <td className="px-3 py-1.5 text-xs text-gray-400">
                                                    {v.weight ? `${v.weight} ${v.weightUnit ?? ''}`.trim() : '\u2014'}
                                                </td>
                                                <td className="px-3 py-1.5 text-center text-xs">
                                                    <span className={v.taxable ? 'text-emerald-500' : 'text-gray-300'}>
                                                        {v.taxable ? 'Yes' : 'No'}
                                                    </span>
                                                </td>
                                                <td className="px-3 py-1.5 text-center text-xs">
                                                    <span className={v.requiresShipping ? 'text-emerald-500' : 'text-gray-300'}>
                                                        {v.requiresShipping ? 'Yes' : 'No'}
                                                    </span>
                                                </td>
                                                <td className="px-3 py-1.5 text-xs text-gray-400">
                                                    {v.inventoryPolicy === 'continue' ? (
                                                        <span className="text-amber-500">Continue</span>
                                                    ) : (
                                                        <span>{v.inventoryPolicy || '\u2014'}</span>
                                                    )}
                                                </td>
                                            </tr>
                                        ))}
                                    </tbody>
                                </table>
                            </div>
                        </div>

                        {/* Images */}
                        {product.images.length > 1 && (
                            <div>
                                <div className="text-xs font-medium text-gray-400 uppercase tracking-wide mb-2">
                                    <ImageIcon className="w-3 h-3 inline mr-1" />Images ({product.images.length})
                                </div>
                                <div className="flex gap-2 overflow-x-auto pb-1">
                                    {product.images.map((img) => (
                                        <img
                                            key={img.src}
                                            src={img.src}
                                            alt={img.alt ?? product.title}
                                            className="w-20 h-20 object-cover rounded-md border bg-gray-50 flex-shrink-0"
                                        />
                                    ))}
                                </div>
                            </div>
                        )}

                        {/* Metafields / Feed Data */}
                        <div>
                            <div className="text-xs font-medium text-gray-400 uppercase tracking-wide mb-2">
                                <Database className="w-3 h-3 inline mr-1" />Product Metafields
                            </div>
                            <div className="rounded-md border bg-white p-3">
                                <MetafieldsPanel shopifyProductId={product.shopifyId} />
                            </div>
                        </div>

                        {/* Collections, Sales Channels, Inventory by Location, Variant Metafields */}
                        <div>
                            <div className="text-xs font-medium text-gray-400 uppercase tracking-wide mb-2">
                                <Layers className="w-3 h-3 inline mr-1" />Collections, Channels & Inventory
                            </div>
                            <div className="rounded-md border bg-white p-3">
                                <FeedEnrichmentPanel shopifyProductId={product.shopifyId} />
                            </div>
                        </div>

                        {/* ERP link + cache metadata */}
                        <div className="flex flex-wrap items-center gap-4 text-xs text-gray-400 pt-2 border-t">
                            {product.erpProductName && (
                                <span>
                                    <Link2 className="w-3 h-3 inline mr-1" />
                                    ERP: <span className="text-gray-600">{product.erpProductName}</span>
                                </span>
                            )}
                            <span>
                                <RefreshCw className="w-3 h-3 inline mr-1" />
                                Last sync: {formatDateTime(product.lastWebhookAt)}
                                {product.webhookTopic && ` (${product.webhookTopic})`}
                            </span>
                            <span>Shopify ID: {product.shopifyId}</span>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}

// ============================================
// MAIN PAGE
// ============================================

export default function ShopifyCatalog() {
    const urlSearch = Route.useSearch();
    const navigate = useNavigate();
    const [expandedId, setExpandedId] = useState<string | null>(null);
    const [searchInput, setSearchInput] = useState(urlSearch.search ?? '');

    // Debounce search → URL
    useEffect(() => {
        const timer = setTimeout(() => {
            const trimmed = searchInput.trim() || undefined;
            if (trimmed !== urlSearch.search) {
                navigate({
                    to: '/shopify-catalog',
                    search: { ...urlSearch, search: trimmed },
                    replace: true,
                });
            }
        }, 400);
        return () => clearTimeout(timer);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [searchInput, navigate, urlSearch.search, urlSearch.status]);

    const { data, isLoading, refetch, isFetching } = useQuery({
        queryKey: ['shopify', 'catalog', urlSearch.search, urlSearch.status],
        queryFn: () =>
            getShopifyCatalog({
                data: {
                    ...(urlSearch.search ? { search: urlSearch.search } : {}),
                    ...(urlSearch.status !== 'all' ? { status: urlSearch.status } : {}),
                },
            }),
    });

    const handleStatusChange = useCallback((value: string) => {
        navigate({
            to: '/shopify-catalog',
            search: { ...urlSearch, status: value as 'all' | 'active' | 'archived' | 'draft' },
            replace: true,
        });
    }, [navigate, urlSearch]);

    const products = data?.products ?? [];
    const stats = data?.stats ?? { total: 0, active: 0, archived: 0, draft: 0, linkedToErp: 0 };

    return (
        <div className="p-4 md:p-6 space-y-4 max-w-7xl">
            {/* Header */}
            <div className="flex items-center justify-between">
                <div>
                    <h1 className="text-xl font-semibold">Shopify Catalog</h1>
                    <p className="text-sm text-gray-400 mt-0.5">
                        All product metadata from your Shopify store
                    </p>
                </div>
                <Button
                    variant="outline"
                    size="sm"
                    onClick={() => refetch()}
                    disabled={isFetching}
                >
                    <RefreshCw className={cn('w-3.5 h-3.5 mr-1.5', isFetching && 'animate-spin')} />
                    Refresh
                </Button>
            </div>

            {/* Stats */}
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
                <StatCard label="Total Products" value={stats.total} />
                <StatCard label="Active" value={stats.active} accent="text-emerald-600" />
                <StatCard label="Archived" value={stats.archived} accent="text-gray-400" />
                <StatCard label="Draft" value={stats.draft} accent="text-amber-600" />
                <StatCard label="Linked to ERP" value={stats.linkedToErp} accent="text-blue-600" />
            </div>

            {/* Filters */}
            <div className="flex flex-wrap gap-3 items-center">
                <div className="relative flex-1 max-w-xs">
                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
                    <Input
                        placeholder="Search title, handle, SKU..."
                        value={searchInput}
                        onChange={e => setSearchInput(e.target.value)}
                        className="pl-9"
                    />
                </div>
                <Select value={urlSearch.status} onValueChange={handleStatusChange}>
                    <SelectTrigger className="w-36">
                        <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                        <SelectItem value="all">All Statuses</SelectItem>
                        <SelectItem value="active">Active</SelectItem>
                        <SelectItem value="archived">Archived</SelectItem>
                        <SelectItem value="draft">Draft</SelectItem>
                    </SelectContent>
                </Select>
                <span className="text-sm text-gray-400">
                    {data?.total ?? 0} product{(data?.total ?? 0) !== 1 ? 's' : ''}
                </span>
            </div>

            {/* Product list */}
            {isLoading ? (
                <div className="space-y-3">
                    {Array.from({ length: 6 }).map((_, i) => (
                        <div key={i} className="border rounded-lg bg-white p-4 animate-pulse">
                            <div className="flex items-center gap-4">
                                <div className="w-14 h-14 bg-gray-200 rounded-md" />
                                <div className="flex-1 space-y-2">
                                    <div className="h-4 bg-gray-200 rounded w-48" />
                                    <div className="h-3 bg-gray-100 rounded w-32" />
                                </div>
                                <div className="h-6 bg-gray-200 rounded w-16" />
                            </div>
                        </div>
                    ))}
                </div>
            ) : products.length === 0 ? (
                <div className="text-center py-16 text-gray-400">
                    <Package className="w-10 h-10 mx-auto mb-3 text-gray-300" />
                    <p className="font-medium">No products found</p>
                    <p className="text-sm mt-1">
                        {urlSearch.search || urlSearch.status !== 'all'
                            ? 'Try adjusting your search or filters'
                            : 'Run a product sync from Settings to populate the cache'}
                    </p>
                </div>
            ) : (
                <div className="space-y-2">
                    {products.map(product => (
                        <ProductCard
                            key={product.shopifyId}
                            product={product}
                            isExpanded={expandedId === product.shopifyId}
                            onToggle={() =>
                                setExpandedId(
                                    expandedId === product.shopifyId ? null : product.shopifyId,
                                )
                            }
                        />
                    ))}
                </div>
            )}
        </div>
    );
}
