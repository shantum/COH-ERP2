/**
 * MobileOrderCard - Option 1: Card-Based Swipe Interface
 *
 * A swipeable card showing order + product info with inline date picker.
 * Swipe left to reveal cancel, swipe right for more actions.
 */

import { memo, useState, useRef, useCallback, type TouchEvent } from 'react';
import {
    Package, MapPin, ChevronDown, ChevronUp,
    X, MoreHorizontal, Phone, Scissors, AlertTriangle,
    Check
} from 'lucide-react';
import type { FlattenedOrderRow } from '../../../utils/orderHelpers';
import { MobileDateStrip } from './MobileDateStrip';

interface MobileOrderCardProps {
    row: FlattenedOrderRow;
    onSelectDate: (lineId: string, date: string) => void;
    onClearDate: (batchId: string) => void;
    onCancel: (lineId: string) => void;
    isDateLocked: (date: string) => boolean;
    isSelected?: boolean;
    onSelect?: (lineId: string) => void;
    showSelection?: boolean;
}

export const MobileOrderCard = memo(function MobileOrderCard({
    row,
    onSelectDate,
    onClearDate,
    onCancel,
    isDateLocked,
    isSelected = false,
    onSelect,
    showSelection = false,
}: MobileOrderCardProps) {
    const [isExpanded, setIsExpanded] = useState(false);
    const [swipeOffset, setSwipeOffset] = useState(0);
    const [isRevealed, setIsRevealed] = useState<'left' | 'right' | null>(null);
    const touchStartX = useRef(0);
    const touchStartY = useRef(0);
    const isHorizontalSwipe = useRef(false);

    const SWIPE_THRESHOLD = 80;
    const MAX_SWIPE = 100;

    const handleTouchStart = useCallback((e: TouchEvent) => {
        touchStartX.current = e.touches[0].clientX;
        touchStartY.current = e.touches[0].clientY;
        isHorizontalSwipe.current = false;
    }, []);

    const handleTouchMove = useCallback((e: TouchEvent) => {
        const deltaX = e.touches[0].clientX - touchStartX.current;
        const deltaY = e.touches[0].clientY - touchStartY.current;

        // Determine if horizontal swipe on first significant movement
        if (!isHorizontalSwipe.current && (Math.abs(deltaX) > 10 || Math.abs(deltaY) > 10)) {
            isHorizontalSwipe.current = Math.abs(deltaX) > Math.abs(deltaY);
        }

        if (isHorizontalSwipe.current) {
            e.preventDefault();
            const bounded = Math.max(-MAX_SWIPE, Math.min(MAX_SWIPE, deltaX));
            setSwipeOffset(bounded);
        }
    }, []);

    const handleTouchEnd = useCallback(() => {
        if (swipeOffset < -SWIPE_THRESHOLD) {
            setIsRevealed('left');
            setSwipeOffset(-MAX_SWIPE);
        } else if (swipeOffset > SWIPE_THRESHOLD) {
            setIsRevealed('right');
            setSwipeOffset(MAX_SWIPE);
        } else {
            setIsRevealed(null);
            setSwipeOffset(0);
        }
    }, [swipeOffset]);

    const resetSwipe = useCallback(() => {
        setIsRevealed(null);
        setSwipeOffset(0);
    }, []);

    const hasStock = row.skuStock >= row.qty;
    const isPending = row.lineStatus === 'pending';
    const isAllocated = row.lineStatus === 'allocated';
    const needsProduction = isPending && (!hasStock || row.isCustomized || row.productionBatchId);

    // Status badge
    const getStatusBadge = () => {
        switch (row.lineStatus) {
            case 'pending':
                return hasStock
                    ? <span className="px-2 py-0.5 text-[10px] font-medium rounded-full bg-emerald-100 text-emerald-700">Ready</span>
                    : <span className="px-2 py-0.5 text-[10px] font-medium rounded-full bg-amber-100 text-amber-700">No Stock</span>;
            case 'allocated':
                return <span className="px-2 py-0.5 text-[10px] font-medium rounded-full bg-blue-100 text-blue-700">Allocated</span>;
            case 'picked':
                return <span className="px-2 py-0.5 text-[10px] font-medium rounded-full bg-purple-100 text-purple-700">Picked</span>;
            case 'packed':
                return <span className="px-2 py-0.5 text-[10px] font-medium rounded-full bg-indigo-100 text-indigo-700">Packed</span>;
            case 'shipped':
                return <span className="px-2 py-0.5 text-[10px] font-medium rounded-full bg-sky-100 text-sky-700">Shipped</span>;
            case 'cancelled':
                return <span className="px-2 py-0.5 text-[10px] font-medium rounded-full bg-red-100 text-red-700">Cancelled</span>;
            default:
                return null;
        }
    };

    return (
        <div className="relative overflow-hidden">
            {/* Left reveal action (Cancel) */}
            <div
                className="absolute inset-y-0 right-0 w-[100px] flex items-center justify-center bg-red-500"
                style={{ opacity: isRevealed === 'left' ? 1 : 0.5 }}
            >
                <button
                    onClick={() => {
                        if (row.lineId) onCancel(row.lineId);
                        resetSwipe();
                    }}
                    className="flex flex-col items-center text-white"
                >
                    <X size={24} />
                    <span className="text-xs mt-1">Cancel</span>
                </button>
            </div>

            {/* Right reveal action (More) */}
            <div
                className="absolute inset-y-0 left-0 w-[100px] flex items-center justify-center bg-slate-600"
                style={{ opacity: isRevealed === 'right' ? 1 : 0.5 }}
            >
                <button
                    onClick={resetSwipe}
                    className="flex flex-col items-center text-white"
                >
                    <MoreHorizontal size={24} />
                    <span className="text-xs mt-1">More</span>
                </button>
            </div>

            {/* Main card content */}
            <div
                className="relative bg-white border-b border-slate-100 transition-transform duration-200 ease-out"
                style={{ transform: `translateX(${swipeOffset}px)` }}
                onTouchStart={handleTouchStart}
                onTouchMove={handleTouchMove}
                onTouchEnd={handleTouchEnd}
            >
                <div className="p-4">
                    {/* Header Row: Order # + Customer + City */}
                    <div className="flex items-start justify-between mb-3">
                        <div className="flex items-center gap-3">
                            {showSelection && (
                                <button
                                    onClick={() => row.lineId && onSelect?.(row.lineId)}
                                    className={`w-5 h-5 rounded-full border-2 flex items-center justify-center transition-colors ${
                                        isSelected
                                            ? 'bg-orange-500 border-orange-500'
                                            : 'border-slate-300'
                                    }`}
                                >
                                    {isSelected && <Check size={12} className="text-white" />}
                                </button>
                            )}
                            <div>
                                <div className="flex items-center gap-2">
                                    <span className="font-semibold text-slate-900 text-sm">
                                        #{row.orderNumber}
                                    </span>
                                    {row.isFirstLine && row.totalLines > 1 && (
                                        <span className="text-[10px] text-slate-400 bg-slate-100 px-1.5 py-0.5 rounded">
                                            +{row.totalLines - 1} item{row.totalLines > 2 ? 's' : ''}
                                        </span>
                                    )}
                                </div>
                                <div className="flex items-center gap-2 mt-0.5">
                                    <span className="text-slate-600 text-xs">{row.customerName}</span>
                                    <span className="text-slate-300">|</span>
                                    <span className="text-slate-500 text-xs flex items-center gap-0.5">
                                        <MapPin size={10} />
                                        {row.city}
                                    </span>
                                </div>
                            </div>
                        </div>
                        {getStatusBadge()}
                    </div>

                    {/* Product Info */}
                    <div className="flex gap-3 mb-3">
                        {/* Product Image */}
                        <div className="w-14 h-14 rounded-lg bg-slate-100 overflow-hidden flex-shrink-0">
                            {row.imageUrl ? (
                                <img
                                    src={row.imageUrl}
                                    alt={row.productName}
                                    className="w-full h-full object-cover"
                                />
                            ) : (
                                <div className="w-full h-full flex items-center justify-center">
                                    <Package size={20} className="text-slate-400" />
                                </div>
                            )}
                        </div>

                        {/* Product Details */}
                        <div className="flex-1 min-w-0">
                            <div className="flex items-start justify-between">
                                <div className="min-w-0 flex-1">
                                    <p className="text-sm font-medium text-slate-900 truncate">
                                        {row.productName}
                                    </p>
                                    <div className="flex items-center gap-2 mt-0.5">
                                        {row.colorHex && (
                                            <span
                                                className="w-3 h-3 rounded-full border border-slate-200"
                                                style={{ backgroundColor: row.colorHex }}
                                            />
                                        )}
                                        <span className="text-xs text-slate-500">
                                            {row.colorName} / {row.size}
                                        </span>
                                    </div>
                                    <p className="text-[10px] text-slate-400 mt-0.5 font-mono">
                                        {row.skuCode}
                                    </p>
                                </div>
                                <div className="text-right ml-2">
                                    <span className="text-lg font-semibold text-slate-900">
                                        x{row.qty}
                                    </span>
                                    {!hasStock && isPending && (
                                        <p className="text-[10px] text-red-500 flex items-center justify-end gap-0.5">
                                            <AlertTriangle size={10} />
                                            {row.skuStock} in stock
                                        </p>
                                    )}
                                </div>
                            </div>
                        </div>
                    </div>

                    {/* Indicators Row */}
                    <div className="flex items-center gap-2 mb-3">
                        {row.isCustomized && (
                            <span className="inline-flex items-center gap-1 px-2 py-0.5 text-[10px] font-medium rounded-full bg-violet-100 text-violet-700">
                                <Scissors size={10} />
                                Custom
                            </span>
                        )}
                        {row.customerRtoCount > 0 && (
                            <span className="inline-flex items-center gap-1 px-2 py-0.5 text-[10px] font-medium rounded-full bg-red-100 text-red-700">
                                <AlertTriangle size={10} />
                                RTO: {row.customerRtoCount}
                            </span>
                        )}
                        {row.paymentMethod === 'COD' && (
                            <span className="px-2 py-0.5 text-[10px] font-medium rounded-full bg-yellow-100 text-yellow-700">
                                COD
                            </span>
                        )}
                        {row.productionDate && isAllocated && (
                            <span className="inline-flex items-center gap-1 px-2 py-0.5 text-[10px] font-medium rounded-full bg-emerald-100 text-emerald-700">
                                <Check size={10} />
                                Prod: {formatDate(row.productionDate)}
                            </span>
                        )}
                    </div>

                    {/* Production Date Strip - Only for pending lines that need production */}
                    {needsProduction && (
                        <MobileDateStrip
                            currentDate={row.productionDate}
                            isLocked={isDateLocked}
                            onSelectDate={(date) => row.lineId && onSelectDate(row.lineId, date)}
                            onClear={() => row.productionBatchId && onClearDate(row.productionBatchId)}
                            hasExistingBatch={!!row.productionBatchId}
                        />
                    )}

                    {/* Expand button */}
                    <button
                        onClick={() => setIsExpanded(!isExpanded)}
                        className="w-full flex items-center justify-center gap-1 text-xs text-slate-400 mt-2 py-1"
                    >
                        {isExpanded ? (
                            <>Less <ChevronUp size={14} /></>
                        ) : (
                            <>More details <ChevronDown size={14} /></>
                        )}
                    </button>

                    {/* Expanded Details */}
                    {isExpanded && (
                        <div className="mt-3 pt-3 border-t border-slate-100 space-y-2 text-xs">
                            <div className="flex justify-between">
                                <span className="text-slate-500">Order Date</span>
                                <span className="text-slate-700">{formatDateTime(row.orderDate)}</span>
                            </div>
                            {row.shipByDate && (
                                <div className="flex justify-between">
                                    <span className="text-slate-500">Ship By</span>
                                    <span className="text-orange-600 font-medium">{formatDate(row.shipByDate)}</span>
                                </div>
                            )}
                            <div className="flex justify-between">
                                <span className="text-slate-500">Order Value</span>
                                <span className="text-slate-700">
                                    {row.totalAmount ? `Rs ${row.totalAmount.toLocaleString('en-IN')}` : '-'}
                                </span>
                            </div>
                            <div className="flex justify-between">
                                <span className="text-slate-500">Payment</span>
                                <span className="text-slate-700">{row.paymentMethod || '-'}</span>
                            </div>
                            <div className="flex justify-between">
                                <span className="text-slate-500">Customer Orders</span>
                                <span className="text-slate-700">{row.customerOrderCount}</span>
                            </div>
                            <div className="flex justify-between">
                                <span className="text-slate-500">LTV</span>
                                <span className="text-slate-700">
                                    {row.customerLtv ? `Rs ${row.customerLtv.toLocaleString('en-IN')}` : '-'}
                                </span>
                            </div>
                            {row.customerPhone && (
                                <a
                                    href={`tel:${row.customerPhone}`}
                                    className="flex items-center justify-center gap-2 mt-3 py-2 bg-slate-100 rounded-lg text-slate-700"
                                >
                                    <Phone size={14} />
                                    Call Customer
                                </a>
                            )}
                            {row.lineNotes && (
                                <div className="mt-2 p-2 bg-amber-50 rounded-lg">
                                    <span className="text-amber-700">{row.lineNotes}</span>
                                </div>
                            )}
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
});

// Helper functions
function formatDate(dateStr: string): string {
    const date = new Date(dateStr + (dateStr.includes('T') ? '' : 'T00:00:00'));
    return date.toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });
}

function formatDateTime(dateStr: string): string {
    const date = new Date(dateStr);
    return date.toLocaleDateString('en-IN', {
        day: 'numeric',
        month: 'short',
        hour: '2-digit',
        minute: '2-digit'
    });
}
