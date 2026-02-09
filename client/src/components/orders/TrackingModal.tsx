/**
 * TrackingModal - Shows real-time shipment tracking from logistics provider
 *
 * Uses Server Functions for data fetching (TanStack Start migration)
 */

import { useQuery } from '@tanstack/react-query';
import { X, Package, Truck, MapPin, Clock, CheckCircle, AlertTriangle, RotateCcw, RefreshCw, type LucideIcon } from 'lucide-react';
import { getAwbTracking, type AwbTrackingResponse, type TrackingScan } from '../../server/functions/tracking';

interface TrackingModalProps {
    awbNumber: string;
    orderNumber?: string;
    onClose: () => void;
}

// Status icon mapping
function getStatusIcon(statusCode: string): LucideIcon {
    const icons: Record<string, LucideIcon> = {
        'M': Package,           // Manifested
        'NP': Package,          // Not Picked
        'PP': Truck,            // Picked Up
        'IT': Truck,            // In Transit
        'RAD': MapPin,          // Reached Destination
        'OFD': Truck,           // Out For Delivery
        'UD': AlertTriangle,    // Undelivered
        'DL': CheckCircle,      // Delivered
        'CA': X,                // Cancelled
        'RTP': RotateCcw,       // RTO Pending
        'RTI': RotateCcw,       // RTO In Transit
        'RTD': RotateCcw,       // RTO Delivered
    };
    return icons[statusCode] || Package;
}

// Status color mapping
function getStatusColor(status: string): string {
    const statusLower = status.toLowerCase();
    if (statusLower.includes('delivered') && !statusLower.includes('undelivered')) {
        return 'text-green-600 bg-green-100';
    }
    if (statusLower.includes('transit') || statusLower.includes('picked')) {
        return 'text-blue-600 bg-blue-100';
    }
    if (statusLower.includes('out for delivery') || statusLower.includes('ofd')) {
        return 'text-amber-600 bg-amber-100';
    }
    if (statusLower.includes('undelivered') || statusLower.includes('failed')) {
        return 'text-red-600 bg-red-100';
    }
    if (statusLower.includes('rto') || statusLower.includes('return')) {
        return 'text-purple-600 bg-purple-100';
    }
    return 'text-gray-600 bg-gray-100';
}

export function TrackingModal({ awbNumber, orderNumber, onClose }: TrackingModalProps) {
    const { data: tracking, isLoading, error, refetch, isFetching } = useQuery<AwbTrackingResponse>({
        queryKey: ['tracking', awbNumber],
        queryFn: () => getAwbTracking({ data: { awbNumber } }),
        staleTime: 60000, // Cache for 1 minute
    });

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
            <div className="bg-white rounded-lg shadow-xl w-full max-w-2xl max-h-[90vh] overflow-hidden">
                {/* Header */}
                <div className="flex items-center justify-between p-4 border-b bg-gray-50">
                    <div>
                        <h2 className="text-lg font-semibold text-gray-900">
                            Shipment Tracking
                        </h2>
                        <p className="text-sm text-gray-500">
                            AWB: <span className="font-mono">{awbNumber}</span>
                            {orderNumber && <span className="ml-2">• Order #{orderNumber}</span>}
                        </p>
                    </div>
                    <div className="flex items-center gap-2">
                        <button
                            onClick={() => refetch()}
                            disabled={isFetching}
                            className="p-2 text-gray-400 hover:text-gray-600 hover:bg-gray-100 rounded"
                            title="Refresh tracking"
                        >
                            <RefreshCw size={18} className={isFetching ? 'animate-spin' : ''} />
                        </button>
                        <button
                            onClick={onClose}
                            className="p-2 text-gray-400 hover:text-gray-600 hover:bg-gray-100 rounded"
                        >
                            <X size={20} />
                        </button>
                    </div>
                </div>

                {/* Content */}
                <div className="p-4 overflow-y-auto max-h-[calc(90vh-120px)]">
                    {isLoading && (
                        <div className="flex items-center justify-center py-12">
                            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-500"></div>
                            <span className="ml-3 text-gray-500">Fetching tracking info...</span>
                        </div>
                    )}

                    {error && (
                        <div className="text-center py-12">
                            <AlertTriangle className="mx-auto h-12 w-12 text-amber-400" />
                            <p className="mt-3 text-gray-600">Unable to fetch tracking information</p>
                            <p className="text-sm text-gray-400 mt-1">
                                {error instanceof Error ? error.message : 'Please try again later'}
                            </p>
                            <button
                                onClick={() => refetch()}
                                className="mt-4 px-4 py-2 text-sm bg-blue-500 text-white rounded hover:bg-blue-600"
                            >
                                Retry
                            </button>
                        </div>
                    )}

                    {tracking && (
                        <div className="space-y-6">
                            {/* Current Status Card */}
                            <div className={`rounded-lg p-4 ${getStatusColor(tracking.currentStatus)}`}>
                                <div className="flex items-center justify-between">
                                    <div className="flex items-center gap-3">
                                        {(() => {
                                            const Icon = getStatusIcon(tracking.statusCode);
                                            return <Icon size={24} />;
                                        })()}
                                        <div>
                                            <p className="font-semibold text-lg">{tracking.currentStatus}</p>
                                            <p className="text-sm opacity-80">via {tracking.courier}</p>
                                        </div>
                                    </div>
                                    <div className="text-right">
                                        {tracking.expectedDeliveryDate && tracking.expectedDeliveryDate !== '0000-00-00' && (
                                            <>
                                                <p className="text-xs opacity-70">Expected Delivery</p>
                                                <p className="font-medium">
                                                    {new Date(tracking.expectedDeliveryDate).toLocaleDateString('en-IN', {
                                                        day: 'numeric',
                                                        month: 'short',
                                                        year: 'numeric',
                                                    })}
                                                </p>
                                            </>
                                        )}
                                        {tracking.promiseDeliveryDate && tracking.promiseDeliveryDate !== '0000-00-00' && (
                                            <p className="text-xs opacity-70 mt-1">
                                                Promise: {new Date(tracking.promiseDeliveryDate).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })}
                                            </p>
                                        )}
                                    </div>
                                </div>
                            </div>

                            {/* Stats Row */}
                            <div className="grid grid-cols-5 gap-3">
                                <div className="bg-gray-50 rounded-lg p-3 text-center">
                                    <p className="text-2xl font-bold text-gray-900">{tracking.ofdCount || 0}</p>
                                    <p className="text-xs text-gray-500">Delivery Attempts</p>
                                </div>
                                <div className="bg-gray-50 rounded-lg p-3 text-center">
                                    <p className="text-2xl font-bold text-gray-900">
                                        {tracking.scanHistory?.length || 0}
                                    </p>
                                    <p className="text-xs text-gray-500">Tracking Events</p>
                                </div>
                                <div className="bg-gray-50 rounded-lg p-3 text-center">
                                    {tracking.isRto ? (
                                        <>
                                            <p className="text-2xl font-bold text-red-600">RTO</p>
                                            <p className="text-xs text-gray-500">Return Initiated</p>
                                        </>
                                    ) : (
                                        <>
                                            <p className="text-2xl font-bold text-green-600">✓</p>
                                            <p className="text-xs text-gray-500">No RTO</p>
                                        </>
                                    )}
                                </div>
                                <div className="bg-gray-50 rounded-lg p-3 text-center">
                                    <p className="text-sm font-mono font-bold text-gray-900">{tracking.statusCode}</p>
                                    <p className="text-xs text-gray-500">Status Code</p>
                                </div>
                                <div className="bg-gray-50 rounded-lg p-3 text-center">
                                    <p className={`text-sm font-bold capitalize ${tracking.orderType === 'reverse' ? 'text-purple-600' : 'text-blue-600'}`}>
                                        {tracking.orderType || 'forward'}
                                    </p>
                                    <p className="text-xs text-gray-500">Order Type</p>
                                </div>
                            </div>

                            {/* RTO Details */}
                            {tracking.isRto && tracking.rtoAwb && (
                                <div className="bg-red-50 border border-red-200 rounded-lg p-4">
                                    <div className="flex items-center gap-2 text-red-600 font-medium">
                                        <RotateCcw size={18} />
                                        <span>Return to Origin (RTO)</span>
                                    </div>
                                    <p className="text-sm text-gray-600 mt-2">
                                        RTO AWB: <span className="font-mono font-medium">{tracking.rtoAwb}</span>
                                    </p>
                                </div>
                            )}

                            {/* Cancel Status Warning */}
                            {tracking.cancelStatus && tracking.cancelStatus !== '0' && (
                                <div className="bg-amber-50 border border-amber-200 rounded-lg p-4">
                                    <div className="flex items-center gap-2 text-amber-600 font-medium">
                                        <AlertTriangle size={18} />
                                        <span>Cancellation Requested</span>
                                    </div>
                                    <p className="text-sm text-gray-600 mt-1">
                                        Cancel status: {tracking.cancelStatus}
                                    </p>
                                </div>
                            )}

                            {/* Order & Customer Details */}
                            {(tracking.orderDetails || tracking.customerDetails) && (
                                <div className="grid grid-cols-2 gap-4">
                                    {tracking.orderDetails && Object.keys(tracking.orderDetails).length > 0 && (
                                        <div className="bg-gray-50 rounded-lg p-4">
                                            <p className="text-xs text-gray-500 font-medium mb-2">SHIPMENT DETAILS</p>
                                            {tracking.orderDetails.orderNumber && (
                                                <p className="text-sm"><span className="text-gray-500">Order #:</span> {tracking.orderDetails.orderNumber}</p>
                                            )}
                                            {tracking.orderDetails.orderType && (
                                                <p className="text-sm"><span className="text-gray-500">Type:</span> <span className="capitalize">{tracking.orderDetails.orderType}</span></p>
                                            )}
                                            {tracking.orderDetails.weight && (
                                                <p className="text-sm"><span className="text-gray-500">Weight:</span> {tracking.orderDetails.weight} kg</p>
                                            )}
                                            {(tracking.orderDetails.length && tracking.orderDetails.breadth && tracking.orderDetails.height) && (
                                                <p className="text-sm">
                                                    <span className="text-gray-500">Dimensions:</span> {tracking.orderDetails.length}×{tracking.orderDetails.breadth}×{tracking.orderDetails.height} cm
                                                </p>
                                            )}
                                            {tracking.orderDetails.netPayment && (
                                                <p className="text-sm"><span className="text-gray-500">Amount:</span> ₹{parseFloat(tracking.orderDetails.netPayment).toLocaleString('en-IN')}</p>
                                            )}
                                        </div>
                                    )}
                                    {tracking.customerDetails && Object.keys(tracking.customerDetails).length > 0 && (
                                        <div className="bg-gray-50 rounded-lg p-4">
                                            <p className="text-xs text-gray-500 font-medium mb-2">DESTINATION</p>
                                            {tracking.customerDetails.name && (
                                                <p className="text-sm font-medium">{tracking.customerDetails.name}</p>
                                            )}
                                            {tracking.customerDetails.phone && (
                                                <p className="text-sm text-gray-600">📞 {tracking.customerDetails.phone}</p>
                                            )}
                                            {(tracking.customerDetails.address1 || tracking.customerDetails.address2) && (
                                                <p className="text-sm text-gray-600 mt-1">
                                                    {[tracking.customerDetails.address1, tracking.customerDetails.address2].filter(Boolean).join(', ')}
                                                </p>
                                            )}
                                            {(tracking.customerDetails.city || tracking.customerDetails.state) && (
                                                <p className="text-sm text-gray-600">
                                                    {[tracking.customerDetails.city, tracking.customerDetails.state].filter(Boolean).join(', ')}
                                                </p>
                                            )}
                                            {tracking.customerDetails.pincode && (
                                                <p className="text-sm text-gray-500">{tracking.customerDetails.pincode}{tracking.customerDetails.country ? `, ${tracking.customerDetails.country}` : ''}</p>
                                            )}
                                        </div>
                                    )}
                                </div>
                            )}

                            {/* Last Scan Info */}
                            {tracking.lastScan && (
                                <div className="bg-blue-50 rounded-lg p-4">
                                    <p className="text-xs text-blue-600 font-medium mb-1">LAST UPDATE</p>
                                    <div className="flex items-start gap-3">
                                        <Clock size={18} className="text-blue-500 mt-0.5" />
                                        <div>
                                            <p className="font-medium text-gray-900">{tracking.lastScan.status}</p>
                                            {tracking.lastScan.location && (
                                                <p className="text-sm text-gray-600">{tracking.lastScan.location}</p>
                                            )}
                                            {tracking.lastScan.datetime && (
                                                <p className="text-xs text-gray-400 mt-1">
                                                    {new Date(tracking.lastScan.datetime).toLocaleString('en-IN')}
                                                </p>
                                            )}
                                            {tracking.lastScan.remark && (
                                                <p className="text-sm text-gray-500 mt-1 italic">
                                                    "{tracking.lastScan.remark}"
                                                </p>
                                            )}
                                            {tracking.lastScan.reason && (
                                                <p className="text-sm text-amber-600 mt-1">
                                                    Reason: {tracking.lastScan.reason}
                                                </p>
                                            )}
                                        </div>
                                    </div>
                                </div>
                            )}

                            {/* Scan History Timeline */}
                            {tracking.scanHistory && tracking.scanHistory.length > 0 && (
                                <div>
                                    <h3 className="font-medium text-gray-900 mb-3">Tracking History</h3>
                                    <div className="relative">
                                        {/* Timeline line */}
                                        <div className="absolute left-4 top-2 bottom-2 w-0.5 bg-gray-200"></div>

                                        <div className="space-y-0">
                                            {tracking.scanHistory.map((scan: TrackingScan, index: number) => (
                                                <div key={index} className="relative flex items-start gap-4 py-3">
                                                    {/* Timeline dot */}
                                                    <div className={`relative z-10 w-8 h-8 rounded-full flex items-center justify-center ${
                                                        index === 0
                                                            ? 'bg-blue-500 text-white'
                                                            : 'bg-gray-100 text-gray-400'
                                                    }`}>
                                                        {index === 0 ? (
                                                            <Truck size={14} />
                                                        ) : (
                                                            <div className="w-2 h-2 rounded-full bg-current"></div>
                                                        )}
                                                    </div>

                                                    {/* Content */}
                                                    <div className="flex-1 min-w-0">
                                                        <p className={`font-medium ${index === 0 ? 'text-gray-900' : 'text-gray-600'}`}>
                                                            {scan.status}
                                                        </p>
                                                        <div className="flex items-center gap-2 text-xs text-gray-400 mt-0.5">
                                                            {scan.location && (
                                                                <span className="flex items-center gap-1">
                                                                    <MapPin size={10} />
                                                                    {scan.location}
                                                                </span>
                                                            )}
                                                            {scan.datetime && (
                                                                <span>
                                                                    {new Date(scan.datetime).toLocaleString('en-IN', {
                                                                        day: 'numeric',
                                                                        month: 'short',
                                                                        hour: '2-digit',
                                                                        minute: '2-digit',
                                                                    })}
                                                                </span>
                                                            )}
                                                        </div>
                                                        {scan.remark && (
                                                            <p className="text-xs text-gray-500 mt-1">{scan.remark}</p>
                                                        )}
                                                        {scan.reason && (
                                                            <p className="text-xs text-amber-600 mt-1">Reason: {scan.reason}</p>
                                                        )}
                                                    </div>
                                                </div>
                                            ))}
                                        </div>
                                    </div>
                                </div>
                            )}
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
}

export default TrackingModal;
