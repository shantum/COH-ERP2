/**
 * OrderActionPanel - Slide-out panel for order details and actions
 * Replaces cryptic action icons with a clear, informative interface
 */

import { useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import {
    X, Eye, Pencil, Ban, Archive, Trash2, Truck, Package,
    CheckCircle, Clock, User, MapPin, CreditCard, CheckSquare
} from 'lucide-react';
import { formatDateTime } from '../../utils/orderHelpers';

interface OrderActionPanelProps {
    order: any;
    isOpen: boolean;
    onClose: () => void;
    onView: () => void;
    onEdit: () => void;
    onCancel: (reason?: string) => void;
    onArchive: () => void;
    onDelete: () => void;
    onShip?: () => void;
    onBookShipment?: () => void;
    onCloseOrder?: () => void;  // Close order (move to shipped view)
    canDelete: boolean;
    isCancelling: boolean;
    isArchiving: boolean;
    isDeleting: boolean;
    isClosing?: boolean;
}

// Fulfillment progress indicator
function FulfillmentProgress({ order }: { order: any }) {
    const lines = order.orderLines || [];
    const activeLines = lines.filter((l: any) => l.lineStatus !== 'cancelled');

    if (activeLines.length === 0) {
        return <div className="text-gray-400 text-sm">No items</div>;
    }

    const stages = ['pending', 'allocated', 'picked', 'packed'];
    const counts = {
        pending: activeLines.filter((l: any) => l.lineStatus === 'pending').length,
        allocated: activeLines.filter((l: any) => l.lineStatus === 'allocated').length,
        picked: activeLines.filter((l: any) => l.lineStatus === 'picked').length,
        packed: activeLines.filter((l: any) => l.lineStatus === 'packed').length,
    };

    // Find current stage (rightmost stage with items)
    let currentStage = 'pending';
    if (counts.packed > 0) currentStage = 'packed';
    else if (counts.picked > 0) currentStage = 'picked';
    else if (counts.allocated > 0) currentStage = 'allocated';

    const allPacked = counts.packed === activeLines.length;
    const allAllocated = (counts.allocated + counts.picked + counts.packed) === activeLines.length;

    return (
        <div className="space-y-3">
            {/* Progress bar */}
            <div className="flex items-center gap-1">
                {stages.map((stage, idx) => {
                    const stageIdx = stages.indexOf(currentStage);
                    const isComplete = idx < stageIdx || (idx === stageIdx && stage === 'packed' && allPacked);
                    const isCurrent = idx === stageIdx && !allPacked;

                    return (
                        <div key={stage} className="flex-1 flex items-center">
                            <div
                                className={`h-1.5 w-full rounded-full transition-colors ${
                                    isComplete ? 'bg-emerald-500' :
                                    isCurrent ? 'bg-amber-400' :
                                    'bg-gray-200'
                                }`}
                            />
                        </div>
                    );
                })}
            </div>

            {/* Stage labels with counts */}
            <div className="flex justify-between text-xs">
                <div className={`text-center ${counts.pending > 0 ? 'text-amber-600 font-medium' : 'text-gray-400'}`}>
                    {counts.pending > 0 && <span className="block text-lg font-semibold">{counts.pending}</span>}
                    <span>Pending</span>
                </div>
                <div className={`text-center ${counts.allocated > 0 ? 'text-purple-600 font-medium' : 'text-gray-400'}`}>
                    {counts.allocated > 0 && <span className="block text-lg font-semibold">{counts.allocated}</span>}
                    <span>Allocated</span>
                </div>
                <div className={`text-center ${counts.picked > 0 ? 'text-blue-600 font-medium' : 'text-gray-400'}`}>
                    {counts.picked > 0 && <span className="block text-lg font-semibold">{counts.picked}</span>}
                    <span>Picked</span>
                </div>
                <div className={`text-center ${counts.packed > 0 ? 'text-emerald-600 font-medium' : 'text-gray-400'}`}>
                    {counts.packed > 0 && <span className="block text-lg font-semibold">{counts.packed}</span>}
                    <span>Packed</span>
                </div>
            </div>

            {/* Status message */}
            <div className={`text-sm px-3 py-2 rounded-lg ${
                allPacked ? 'bg-emerald-50 text-emerald-700 border border-emerald-200' :
                allAllocated ? 'bg-blue-50 text-blue-700 border border-blue-200' :
                'bg-amber-50 text-amber-700 border border-amber-200'
            }`}>
                {allPacked ? (
                    <span className="flex items-center gap-2">
                        <CheckCircle size={14} />
                        Ready to ship
                    </span>
                ) : allAllocated ? (
                    <span className="flex items-center gap-2">
                        <Package size={14} />
                        All items allocated - pick & pack to ship
                    </span>
                ) : (
                    <span className="flex items-center gap-2">
                        <Clock size={14} />
                        {counts.pending} item{counts.pending !== 1 ? 's' : ''} awaiting allocation
                    </span>
                )}
            </div>
        </div>
    );
}

export function OrderActionPanel({
    order,
    isOpen,
    onClose,
    onView,
    onEdit,
    onCancel,
    onArchive,
    onDelete,
    onShip,
    onBookShipment,
    onCloseOrder,
    canDelete,
    isCancelling,
    isArchiving,
    isDeleting,
    isClosing,
}: OrderActionPanelProps) {
    const panelRef = useRef<HTMLDivElement>(null);

    // Close on escape key
    useEffect(() => {
        const handleEscape = (e: KeyboardEvent) => {
            if (e.key === 'Escape') onClose();
        };
        if (isOpen) {
            document.addEventListener('keydown', handleEscape);
            return () => document.removeEventListener('keydown', handleEscape);
        }
    }, [isOpen, onClose]);

    // Close on click outside
    useEffect(() => {
        const handleClickOutside = (e: MouseEvent) => {
            if (panelRef.current && !panelRef.current.contains(e.target as Node)) {
                onClose();
            }
        };
        if (isOpen) {
            // Small delay to prevent immediate close from the button click
            const timer = setTimeout(() => {
                document.addEventListener('mousedown', handleClickOutside);
            }, 100);
            return () => {
                clearTimeout(timer);
                document.removeEventListener('mousedown', handleClickOutside);
            };
        }
    }, [isOpen, onClose]);

    if (!isOpen || !order) return null;

    const { date } = formatDateTime(order.orderDate);
    const orderAge = Math.floor((Date.now() - new Date(order.orderDate).getTime()) / (1000 * 60 * 60 * 24));
    const isUrgent = orderAge > 5;
    const isWarning = orderAge >= 3 && orderAge <= 5;

    // Parse shipping address
    let city = '-';
    try {
        const addr = JSON.parse(order.shippingAddress || '{}');
        city = addr.city || '-';
    } catch { }

    // Payment info
    const paymentMethod = order.shopifyCache?.paymentMethod || order.paymentMethod || '-';
    const isCod = paymentMethod.toLowerCase().includes('cod');

    // Items summary
    const lines = order.orderLines || [];
    const itemCount = lines.length;
    const activeCount = lines.filter((l: any) => l.lineStatus !== 'cancelled').length;
    const activeLines = lines.filter((l: any) => l.lineStatus !== 'cancelled');

    // Check if ready to ship: all lines packed + has AWB from Shopify
    const allPacked = activeLines.length > 0 &&
                      activeLines.every((l: any) => l.lineStatus === 'packed');
    const hasShopifyAwb = !!(order.shopifyCache?.trackingNumber || order.awbNumber);
    const isReadyToShip = allPacked && hasShopifyAwb;

    // Check if this is an offline order that needs manual shipment booking
    const isOfflineOrder = order.channel === 'offline' || !order.shopifyOrderId;
    const needsShipmentBooking = isOfflineOrder && allPacked && !order.awbNumber;

    return createPortal(
        <div className="fixed inset-0 z-[9999] flex justify-end">
            {/* Backdrop */}
            <div className="absolute inset-0 bg-black/20 backdrop-blur-sm" />

            {/* Panel */}
            <div
                ref={panelRef}
                className="relative w-[380px] h-full bg-white shadow-2xl flex flex-col animate-in slide-in-from-right duration-200"
                style={{
                    background: 'linear-gradient(180deg, #fafafa 0%, #ffffff 100%)',
                }}
            >
                {/* Header */}
                <div className="px-5 py-4 border-b border-gray-100 flex items-start justify-between">
                    <div>
                        <div className="flex items-center gap-2">
                            <h2 className="text-lg font-semibold text-gray-900 font-mono">
                                #{order.orderNumber}
                            </h2>
                            {order.isExchange && (
                                <span className="px-1.5 py-0.5 text-xs font-medium bg-amber-100 text-amber-700 rounded">
                                    Exchange
                                </span>
                            )}
                        </div>
                        <div className="flex items-center gap-2 mt-1 text-sm text-gray-500">
                            <span>{date}</span>
                            <span className="text-gray-300">|</span>
                            <span className={`font-medium ${
                                isUrgent ? 'text-red-600' : isWarning ? 'text-amber-600' : 'text-gray-500'
                            }`}>
                                {orderAge}d old
                            </span>
                        </div>
                    </div>
                    <button
                        onClick={onClose}
                        className="p-1.5 rounded-lg hover:bg-gray-100 text-gray-400 hover:text-gray-600 transition-colors"
                    >
                        <X size={18} />
                    </button>
                </div>

                {/* Content */}
                <div className="flex-1 overflow-y-auto">
                    {/* Customer & Order Info */}
                    <div className="px-5 py-4 space-y-4 border-b border-gray-100">
                        <div className="grid grid-cols-2 gap-4">
                            <div className="space-y-1">
                                <div className="flex items-center gap-1.5 text-xs text-gray-400 uppercase tracking-wide">
                                    <User size={12} />
                                    Customer
                                </div>
                                <div className="font-medium text-gray-900">{order.customerName}</div>
                            </div>
                            <div className="space-y-1">
                                <div className="flex items-center gap-1.5 text-xs text-gray-400 uppercase tracking-wide">
                                    <MapPin size={12} />
                                    City
                                </div>
                                <div className="font-medium text-gray-900">{city}</div>
                            </div>
                        </div>
                        <div className="grid grid-cols-2 gap-4">
                            <div className="space-y-1">
                                <div className="flex items-center gap-1.5 text-xs text-gray-400 uppercase tracking-wide">
                                    <CreditCard size={12} />
                                    Payment
                                </div>
                                <div className={`font-medium ${isCod ? 'text-amber-600' : 'text-emerald-600'}`}>
                                    {isCod ? 'COD' : 'Prepaid'}
                                </div>
                            </div>
                            <div className="space-y-1">
                                <div className="flex items-center gap-1.5 text-xs text-gray-400 uppercase tracking-wide">
                                    <Package size={12} />
                                    Items
                                </div>
                                <div className="font-medium text-gray-900">
                                    {activeCount} item{activeCount !== 1 ? 's' : ''}
                                    {itemCount !== activeCount && (
                                        <span className="text-gray-400 text-sm ml-1">
                                            ({itemCount - activeCount} cancelled)
                                        </span>
                                    )}
                                </div>
                            </div>
                        </div>
                        {order.totalAmount && (
                            <div className="pt-2 border-t border-gray-100">
                                <div className="flex justify-between items-center">
                                    <span className="text-gray-500">Order Value</span>
                                    <span className="text-xl font-semibold text-gray-900">
                                        ₹{Number(order.totalAmount).toLocaleString('en-IN')}
                                    </span>
                                </div>
                            </div>
                        )}
                    </div>

                    {/* Fulfillment Status */}
                    <div className="px-5 py-4 border-b border-gray-100">
                        <h3 className="text-xs text-gray-400 uppercase tracking-wide mb-3">Fulfillment Progress</h3>
                        <FulfillmentProgress order={order} />
                    </div>

                    {/* Customer Notes */}
                    {order.shopifyCache?.customerNotes && (
                        <div className="px-5 py-4 border-b border-gray-100">
                            <h3 className="text-xs text-gray-400 uppercase tracking-wide mb-2">Customer Notes</h3>
                            <div className="p-3 bg-purple-50 border border-purple-100 rounded-lg text-sm text-purple-800">
                                {order.shopifyCache.customerNotes}
                            </div>
                        </div>
                    )}
                </div>

                {/* Actions Footer */}
                <div className="px-5 py-4 border-t border-gray-200 bg-gray-50 space-y-3">
                    {/* Primary Actions */}
                    <div className="grid grid-cols-2 gap-2">
                        <button
                            onClick={() => { onView(); onClose(); }}
                            className="flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg bg-white border border-gray-200 text-gray-700 hover:bg-gray-50 hover:border-gray-300 transition-all text-sm font-medium shadow-sm"
                        >
                            <Eye size={16} />
                            View Details
                        </button>
                        <button
                            onClick={() => { onEdit(); onClose(); }}
                            className="flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg bg-blue-600 text-white hover:bg-blue-700 transition-all text-sm font-medium shadow-sm"
                        >
                            <Pencil size={16} />
                            Edit Order
                        </button>
                    </div>

                    {/* Ship Button - prominent when ready to ship (has AWB) */}
                    {isReadyToShip && onShip && (
                        <button
                            onClick={() => {
                                onShip();
                                onClose();
                            }}
                            className="w-full flex items-center justify-center gap-2 px-4 py-3 rounded-lg bg-emerald-600 text-white hover:bg-emerald-700 transition-all text-sm font-semibold shadow-lg shadow-emerald-200 animate-pulse"
                        >
                            <Truck size={18} />
                            Ship Order
                        </button>
                    )}

                    {/* Book Shipment Button - for offline orders without AWB */}
                    {needsShipmentBooking && onBookShipment && (
                        <button
                            onClick={() => {
                                onBookShipment();
                                onClose();
                            }}
                            className="w-full flex items-center justify-center gap-2 px-4 py-3 rounded-lg bg-gradient-to-r from-blue-500 to-blue-600 text-white hover:from-blue-600 hover:to-blue-700 transition-all text-sm font-semibold shadow-lg shadow-blue-200"
                        >
                            <Truck size={18} />
                            Book Shipment
                        </button>
                    )}

                    {/* Secondary Actions */}
                    <div className="flex gap-2 pt-2 border-t border-gray-200">
                        {onCloseOrder && (
                            <button
                                onClick={() => {
                                    if (confirm(`Close ${order.orderNumber}?\n\nThis moves the order to the shipped view.`)) {
                                        onCloseOrder();
                                        onClose();
                                    }
                                }}
                                disabled={isClosing}
                                className="flex-1 flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg text-gray-500 hover:text-emerald-600 hover:bg-emerald-50 transition-all text-xs font-medium disabled:opacity-50"
                            >
                                <CheckSquare size={14} />
                                Close
                            </button>
                        )}
                        <button
                            onClick={() => {
                                const reason = prompt(`Cancel ${order.orderNumber}?\n\nReason (optional):`);
                                if (reason !== null) {
                                    onCancel(reason || undefined);
                                    onClose();
                                }
                            }}
                            disabled={isCancelling}
                            className="flex-1 flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg text-gray-500 hover:text-red-600 hover:bg-red-50 transition-all text-xs font-medium disabled:opacity-50"
                        >
                            <Ban size={14} />
                            Cancel
                        </button>
                        <button
                            onClick={() => {
                                if (confirm(`Archive ${order.orderNumber}?`)) {
                                    onArchive();
                                    onClose();
                                }
                            }}
                            disabled={isArchiving}
                            className="flex-1 flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg text-gray-500 hover:text-purple-600 hover:bg-purple-50 transition-all text-xs font-medium disabled:opacity-50"
                        >
                            <Archive size={14} />
                            Archive
                        </button>
                        {canDelete && (
                            <button
                                onClick={() => {
                                    if (confirm(`DELETE ${order.orderNumber}?\n\nThis is permanent.`)) {
                                        onDelete();
                                        onClose();
                                    }
                                }}
                                disabled={isDeleting}
                                className="flex-1 flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg text-gray-500 hover:text-red-600 hover:bg-red-50 transition-all text-xs font-medium disabled:opacity-50"
                            >
                                <Trash2 size={14} />
                                Delete
                            </button>
                        )}
                    </div>
                </div>
            </div>
        </div>,
        document.body
    );
}

export default OrderActionPanel;
