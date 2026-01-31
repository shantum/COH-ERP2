/**
 * Tracking Page - Shipment/Order Tracking Lookup
 *
 * Features:
 * - Search by AWB number or Order number
 * - Shows formatted tracking status and timeline
 * - Displays complete raw JSON response in collapsible sections
 * - Nice UI for browsing nested JSON data
 *
 * Uses Server Functions for data fetching (TanStack Start architecture)
 */

import { useState, useRef, useEffect } from 'react';
import { useMutation } from '@tanstack/react-query';
import {
    Search,
    Loader2,
    Package,
    MapPin,
    Truck,
    ChevronDown,
    ChevronRight,
    Clock,
    CheckCircle2,
    AlertCircle,
    Copy,
    Check,
} from 'lucide-react';
import { trackShipment, type TrackShipmentResponse, type TrackingScan } from '../server/functions/tracking';
import { cn } from '../lib/utils';

// ============================================================================
// JSON Viewer Component
// ============================================================================

interface JsonViewerProps {
    data: unknown;
    initialExpanded?: boolean;
    depth?: number;
}

function JsonViewer({ data, initialExpanded = true, depth = 0 }: JsonViewerProps) {
    const [expanded, setExpanded] = useState(initialExpanded && depth < 2);

    if (data === null) return <span className="text-gray-500">null</span>;
    if (data === undefined) return <span className="text-gray-500">undefined</span>;

    if (typeof data === 'string') {
        return <span className="text-green-600">"{data}"</span>;
    }
    if (typeof data === 'number') {
        return <span className="text-blue-600">{data}</span>;
    }
    if (typeof data === 'boolean') {
        return <span className="text-purple-600">{data ? 'true' : 'false'}</span>;
    }

    if (Array.isArray(data)) {
        if (data.length === 0) return <span className="text-gray-500">[]</span>;

        return (
            <div className="inline">
                <button
                    onClick={() => setExpanded(!expanded)}
                    className="inline-flex items-center text-gray-600 hover:text-gray-900"
                >
                    {expanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                    <span className="text-gray-500 ml-1">[{data.length}]</span>
                </button>
                {expanded && (
                    <div className="ml-4 border-l-2 border-gray-200 pl-3">
                        {data.map((item, i) => (
                            <div key={i} className="py-0.5">
                                <span className="text-gray-400 mr-2">{i}:</span>
                                <JsonViewer data={item} depth={depth + 1} />
                            </div>
                        ))}
                    </div>
                )}
            </div>
        );
    }

    if (typeof data === 'object') {
        const entries = Object.entries(data);
        if (entries.length === 0) return <span className="text-gray-500">{'{}'}</span>;

        return (
            <div className="inline">
                <button
                    onClick={() => setExpanded(!expanded)}
                    className="inline-flex items-center text-gray-600 hover:text-gray-900"
                >
                    {expanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                    <span className="text-gray-500 ml-1">{'{'}...{'}'}</span>
                </button>
                {expanded && (
                    <div className="ml-4 border-l-2 border-gray-200 pl-3">
                        {entries.map(([key, value]) => (
                            <div key={key} className="py-0.5">
                                <span className="text-amber-700 font-medium">"{key}"</span>
                                <span className="text-gray-500">: </span>
                                <JsonViewer data={value} depth={depth + 1} />
                            </div>
                        ))}
                    </div>
                )}
            </div>
        );
    }

    return <span>{String(data)}</span>;
}

// ============================================================================
// Copy Button Component
// ============================================================================

function CopyButton({ text }: { text: string }) {
    const [copied, setCopied] = useState(false);

    const handleCopy = async () => {
        await navigator.clipboard.writeText(text);
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
    };

    return (
        <button
            onClick={handleCopy}
            className="p-2 text-gray-500 hover:text-gray-700 hover:bg-gray-100 rounded transition-colors"
            title="Copy JSON"
        >
            {copied ? <Check size={16} className="text-green-600" /> : <Copy size={16} />}
        </button>
    );
}

// ============================================================================
// Collapsible Section Component
// ============================================================================

interface CollapsibleSectionProps {
    title: string;
    subtitle?: string;
    icon?: React.ReactNode;
    defaultOpen?: boolean;
    children: React.ReactNode;
    actions?: React.ReactNode;
}

function CollapsibleSection({
    title,
    subtitle,
    icon,
    defaultOpen = false,
    children,
    actions,
}: CollapsibleSectionProps) {
    const [open, setOpen] = useState(defaultOpen);

    return (
        <div className="border border-gray-200 rounded-lg overflow-hidden bg-white">
            <button
                onClick={() => setOpen(!open)}
                className="w-full px-4 py-3 flex items-center justify-between bg-gray-50 hover:bg-gray-100 transition-colors"
            >
                <div className="flex items-center gap-3">
                    {icon}
                    <div className="text-left">
                        <div className="font-medium text-gray-900">{title}</div>
                        {subtitle && <div className="text-sm text-gray-500">{subtitle}</div>}
                    </div>
                </div>
                <div className="flex items-center gap-2">
                    {actions && <div onClick={(e) => e.stopPropagation()}>{actions}</div>}
                    {open ? <ChevronDown size={20} /> : <ChevronRight size={20} />}
                </div>
            </button>
            {open && <div className="p-4 border-t border-gray-200">{children}</div>}
        </div>
    );
}

// ============================================================================
// Tracking Status Badge
// ============================================================================

function getStatusColor(status: string | undefined | null): string {
    if (!status) return 'bg-gray-100 text-gray-600';
    const s = status.toLowerCase();
    if (s.includes('delivered') && !s.includes('undelivered') && !s.includes('rto'))
        return 'bg-green-100 text-green-700';
    if (s.includes('rto') || s.includes('return')) return 'bg-orange-100 text-orange-700';
    if (s.includes('cancelled')) return 'bg-red-100 text-red-700';
    if (s.includes('transit') || s.includes('picked')) return 'bg-blue-100 text-blue-700';
    if (s.includes('out for delivery')) return 'bg-indigo-100 text-indigo-700';
    if (s.includes('undelivered') || s.includes('failed')) return 'bg-amber-100 text-amber-700';
    return 'bg-gray-100 text-gray-600';
}

function StatusBadge({ status }: { status: string | undefined | null }) {
    if (!status) return null;
    return (
        <span className={cn('px-3 py-1 rounded-full text-sm font-medium', getStatusColor(status))}>
            {status}
        </span>
    );
}

// ============================================================================
// Timeline Event Component
// ============================================================================

interface TimelineEventProps {
    status: string;
    datetime: string;
    location: string;
    remark?: string;
    isLast?: boolean;
}

function TimelineEvent({ status, datetime, location, remark, isLast }: TimelineEventProps) {
    return (
        <div className="relative flex gap-4">
            {/* Connector line */}
            {!isLast && (
                <div className="absolute left-[11px] top-6 w-0.5 h-full bg-gray-200" />
            )}
            {/* Dot */}
            <div className="relative z-10 w-6 h-6 rounded-full bg-primary-100 border-2 border-primary-500 flex items-center justify-center flex-shrink-0">
                <div className="w-2 h-2 rounded-full bg-primary-500" />
            </div>
            {/* Content */}
            <div className="flex-1 pb-6">
                <div className="font-medium text-gray-900">{status}</div>
                <div className="text-sm text-gray-500 flex items-center gap-2 mt-1">
                    <Clock size={14} />
                    {datetime}
                </div>
                {location && (
                    <div className="text-sm text-gray-500 flex items-center gap-2">
                        <MapPin size={14} />
                        {location}
                    </div>
                )}
                {remark && <div className="text-sm text-gray-600 mt-1">{remark}</div>}
            </div>
        </div>
    );
}

// ============================================================================
// Main Tracking Page Component
// ============================================================================

export default function TrackingPage() {
    const [searchInput, setSearchInput] = useState('');
    const [searchType, setSearchType] = useState<'awb' | 'order'>('awb');
    const inputRef = useRef<HTMLInputElement>(null);

    // Focus input on mount
    useEffect(() => {
        inputRef.current?.focus();
    }, []);

    // Track shipment mutation
    const trackMutation = useMutation<TrackShipmentResponse, Error, string>({
        mutationFn: (query: string) =>
            trackShipment({ data: { query, type: searchType } }),
    });

    const handleSearch = (e: React.FormEvent) => {
        e.preventDefault();
        if (searchInput.trim()) {
            trackMutation.mutate(searchInput.trim());
        }
    };

    const result: TrackShipmentResponse | undefined = trackMutation.data;
    const isLoading = trackMutation.isPending;

    return (
        <div className="max-w-4xl mx-auto">
            {/* Header */}
            <div className="text-center mb-8">
                <div className="inline-flex items-center justify-center w-16 h-16 bg-primary-100 rounded-2xl mb-4">
                    <Truck size={32} className="text-primary-600" />
                </div>
                <h1 className="text-3xl font-bold text-gray-900 mb-2">Track Shipment</h1>
                <p className="text-gray-600">
                    Track by AWB number or order number to see full tracking details
                </p>
            </div>

            {/* Search Form */}
            <form onSubmit={handleSearch} className="mb-8">
                {/* Search Type Toggle */}
                <div className="flex justify-center mb-4">
                    <div className="inline-flex bg-gray-100 rounded-lg p-1">
                        <button
                            type="button"
                            onClick={() => setSearchType('awb')}
                            className={cn(
                                'px-4 py-2 rounded-md text-sm font-medium transition-colors',
                                searchType === 'awb'
                                    ? 'bg-white text-gray-900 shadow-sm'
                                    : 'text-gray-600 hover:text-gray-900'
                            )}
                        >
                            AWB Number
                        </button>
                        <button
                            type="button"
                            onClick={() => setSearchType('order')}
                            className={cn(
                                'px-4 py-2 rounded-md text-sm font-medium transition-colors',
                                searchType === 'order'
                                    ? 'bg-white text-gray-900 shadow-sm'
                                    : 'text-gray-600 hover:text-gray-900'
                            )}
                        >
                            Order Number
                        </button>
                    </div>
                </div>

                {/* Search Input */}
                <div className="relative">
                    <Search
                        size={24}
                        className="absolute left-4 top-1/2 -translate-y-1/2 text-gray-400 z-10"
                    />
                    <input
                        ref={inputRef}
                        type="text"
                        placeholder={
                            searchType === 'awb'
                                ? 'Enter AWB number...'
                                : 'Enter order number...'
                        }
                        value={searchInput}
                        onChange={(e) => setSearchInput(e.target.value)}
                        className="w-full pl-14 pr-32 py-4 text-lg border-2 border-gray-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-primary-500 shadow-sm"
                        autoComplete="off"
                    />
                    <button
                        type="submit"
                        disabled={isLoading || !searchInput.trim()}
                        className="absolute right-2 top-1/2 -translate-y-1/2 px-6 py-2.5 bg-primary-600 text-white rounded-lg font-medium hover:bg-primary-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors flex items-center gap-2"
                    >
                        {isLoading ? (
                            <>
                                <Loader2 size={18} className="animate-spin" />
                                Tracking...
                            </>
                        ) : (
                            <>
                                <Search size={18} />
                                Track
                            </>
                        )}
                    </button>
                </div>
            </form>

            {/* Error State */}
            {result && !result.success && (
                <div className="bg-red-50 border border-red-200 rounded-xl p-6 mb-6">
                    <div className="flex items-start gap-3">
                        <AlertCircle size={24} className="text-red-500 flex-shrink-0" />
                        <div>
                            <h3 className="font-semibold text-red-800">Tracking Not Found</h3>
                            <p className="text-red-700 mt-1">{result.error}</p>
                            {result.awbNumber && (
                                <p className="text-sm text-red-600 mt-2">
                                    Searched: {result.awbNumber}
                                </p>
                            )}
                        </div>
                    </div>
                </div>
            )}

            {/* Success State */}
            {result && result.success && result.trackingData && (
                <div className="space-y-6">
                    {/* Summary Card */}
                    <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6">
                        <div className="flex flex-wrap items-start justify-between gap-4 mb-6">
                            <div>
                                <div className="text-sm text-gray-500 mb-1">AWB Number</div>
                                <div className="text-2xl font-bold text-gray-900">
                                    {result.awbNumber}
                                </div>
                                {result.orderNumber && (
                                    <div className="text-sm text-gray-500 mt-1">
                                        Order: {result.orderNumber}
                                    </div>
                                )}
                            </div>
                            <StatusBadge status={result.trackingData.currentStatus} />
                        </div>

                        {/* Quick Info Grid */}
                        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                            {result.trackingData.courier && (
                                <div className="bg-gray-50 rounded-lg p-3">
                                    <div className="text-xs text-gray-500 uppercase tracking-wider mb-1">
                                        Courier
                                    </div>
                                    <div className="font-medium text-gray-900">
                                        {result.trackingData.courier}
                                    </div>
                                </div>
                            )}
                            {result.trackingData.expectedDeliveryDate && (
                                <div className="bg-gray-50 rounded-lg p-3">
                                    <div className="text-xs text-gray-500 uppercase tracking-wider mb-1">
                                        Expected Delivery
                                    </div>
                                    <div className="font-medium text-gray-900">
                                        {result.trackingData.expectedDeliveryDate}
                                    </div>
                                </div>
                            )}
                            {result.trackingData.lastScan?.location && (
                                <div className="bg-gray-50 rounded-lg p-3">
                                    <div className="text-xs text-gray-500 uppercase tracking-wider mb-1">
                                        Last Location
                                    </div>
                                    <div className="font-medium text-gray-900">
                                        {result.trackingData.lastScan.location}
                                    </div>
                                </div>
                            )}
                            {result.trackingData.ofdCount > 0 && (
                                <div className="bg-gray-50 rounded-lg p-3">
                                    <div className="text-xs text-gray-500 uppercase tracking-wider mb-1">
                                        Delivery Attempts
                                    </div>
                                    <div className="font-medium text-gray-900">
                                        {result.trackingData.ofdCount}
                                    </div>
                                </div>
                            )}
                        </div>

                        {/* RTO Warning */}
                        {result.trackingData.isRto && (
                            <div className="mt-4 bg-orange-50 border border-orange-200 rounded-lg p-4 flex items-start gap-3">
                                <AlertCircle size={20} className="text-orange-500 flex-shrink-0 mt-0.5" />
                                <div>
                                    <div className="font-medium text-orange-800">Return to Origin (RTO)</div>
                                    <div className="text-sm text-orange-700">
                                        This shipment is being returned to the origin.
                                        {result.trackingData.rtoAwb && (
                                            <span> RTO AWB: {result.trackingData.rtoAwb}</span>
                                        )}
                                    </div>
                                </div>
                            </div>
                        )}
                    </div>

                    {/* Tracking Timeline */}
                    {result.trackingData.scanHistory && result.trackingData.scanHistory.length > 0 && (
                        <CollapsibleSection
                            title="Tracking Timeline"
                            subtitle={`${result.trackingData.scanHistory.length} events`}
                            icon={<Clock size={20} className="text-primary-600" />}
                            defaultOpen={true}
                        >
                            <div className="max-h-96 overflow-y-auto">
                                {result.trackingData.scanHistory.map((scan: TrackingScan, i: number) => (
                                    <TimelineEvent
                                        key={i}
                                        status={scan.status}
                                        datetime={scan.datetime}
                                        location={scan.location}
                                        remark={scan.remark}
                                        isLast={i === result.trackingData!.scanHistory.length - 1}
                                    />
                                ))}
                            </div>
                        </CollapsibleSection>
                    )}

                    {/* Customer Details */}
                    {result.trackingData.customerDetails && (
                        <CollapsibleSection
                            title="Customer Details"
                            icon={<MapPin size={20} className="text-gray-600" />}
                        >
                            <div className="grid gap-3 text-sm">
                                {result.trackingData.customerDetails.name && (
                                    <div>
                                        <span className="text-gray-500">Name:</span>{' '}
                                        <span className="font-medium">{result.trackingData.customerDetails.name}</span>
                                    </div>
                                )}
                                {result.trackingData.customerDetails.phone && (
                                    <div>
                                        <span className="text-gray-500">Phone:</span>{' '}
                                        <span className="font-medium">{result.trackingData.customerDetails.phone}</span>
                                    </div>
                                )}
                                <div>
                                    <span className="text-gray-500">Address:</span>{' '}
                                    <span className="font-medium">
                                        {[
                                            result.trackingData.customerDetails.address1,
                                            result.trackingData.customerDetails.address2,
                                            result.trackingData.customerDetails.city,
                                            result.trackingData.customerDetails.state,
                                            result.trackingData.customerDetails.pincode,
                                        ]
                                            .filter(Boolean)
                                            .join(', ')}
                                    </span>
                                </div>
                            </div>
                        </CollapsibleSection>
                    )}

                    {/* Order Details */}
                    {result.trackingData.orderDetails && (
                        <CollapsibleSection
                            title="Order Details"
                            icon={<Package size={20} className="text-gray-600" />}
                        >
                            <div className="grid grid-cols-2 gap-3 text-sm">
                                {result.trackingData.orderDetails.orderNumber && (
                                    <div>
                                        <span className="text-gray-500">Order Number:</span>{' '}
                                        <span className="font-medium">{result.trackingData.orderDetails.orderNumber}</span>
                                    </div>
                                )}
                                {result.trackingData.orderDetails.orderType && (
                                    <div>
                                        <span className="text-gray-500">Order Type:</span>{' '}
                                        <span className="font-medium">{result.trackingData.orderDetails.orderType}</span>
                                    </div>
                                )}
                                {result.trackingData.orderDetails.weight && (
                                    <div>
                                        <span className="text-gray-500">Weight:</span>{' '}
                                        <span className="font-medium">{result.trackingData.orderDetails.weight} kg</span>
                                    </div>
                                )}
                                {result.trackingData.orderDetails.netPayment && (
                                    <div>
                                        <span className="text-gray-500">Net Payment:</span>{' '}
                                        <span className="font-medium">{result.trackingData.orderDetails.netPayment}</span>
                                    </div>
                                )}
                            </div>
                        </CollapsibleSection>
                    )}

                    {/* Formatted Tracking Data */}
                    <CollapsibleSection
                        title="Formatted Tracking Data"
                        subtitle="Processed response"
                        icon={<CheckCircle2 size={20} className="text-green-600" />}
                        actions={
                            <CopyButton text={JSON.stringify(result.trackingData, null, 2)} />
                        }
                    >
                        <div className="bg-gray-50 rounded-lg p-4 font-mono text-sm overflow-x-auto">
                            <JsonViewer data={result.trackingData} initialExpanded={true} />
                        </div>
                    </CollapsibleSection>

                    {/* Raw API Response */}
                    <CollapsibleSection
                        title="Raw API Response"
                        subtitle="Unprocessed iThink response"
                        icon={<Package size={20} className="text-amber-600" />}
                        actions={
                            <CopyButton text={JSON.stringify(result.rawApiResponse, null, 2)} />
                        }
                    >
                        <div className="bg-gray-900 rounded-lg p-4 font-mono text-sm overflow-x-auto text-gray-100">
                            <pre className="whitespace-pre-wrap">
                                {JSON.stringify(result.rawApiResponse, null, 2)}
                            </pre>
                        </div>
                    </CollapsibleSection>
                </div>
            )}

            {/* Empty State */}
            {!result && !isLoading && (
                <div className="text-center py-16">
                    <div className="inline-flex items-center justify-center w-20 h-20 bg-gray-100 rounded-full mb-4">
                        <Truck size={32} className="text-gray-400" />
                    </div>
                    <p className="text-gray-500 text-lg mb-2">Enter a tracking number to begin</p>
                    <p className="text-gray-400 text-sm">
                        You can search by AWB number or order number
                    </p>

                    {/* Search tips */}
                    <div className="mt-8 max-w-md mx-auto text-left">
                        <p className="text-sm font-medium text-gray-700 mb-3">What you can search:</p>
                        <ul className="text-sm text-gray-600 space-y-2">
                            <li className="flex items-start gap-2">
                                <span className="text-primary-500 mt-0.5">1.</span>
                                <span>
                                    <strong>AWB Number</strong> - The shipment tracking number from the
                                    courier
                                </span>
                            </li>
                            <li className="flex items-start gap-2">
                                <span className="text-primary-500 mt-0.5">2.</span>
                                <span>
                                    <strong>Order Number</strong> - Your internal order reference
                                    (e.g., "1001")
                                </span>
                            </li>
                        </ul>
                    </div>
                </div>
            )}
        </div>
    );
}
