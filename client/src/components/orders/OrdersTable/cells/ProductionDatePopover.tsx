/**
 * ProductionDatePopover
 * Calendar picker for batch production scheduling with quick date selection
 */

import { useState, useRef, useEffect, memo } from 'react';
import { createPortal } from 'react-dom';
import { Calendar, X } from 'lucide-react';
import { getLocalDateStringOffset, getTodayString } from '../utils/dateFormatters';

interface ProductionDatePopoverProps {
    currentDate: string | null;
    isLocked: (date: string) => boolean;
    onSelectDate: (date: string) => void;
    onClear: () => void;
    hasExistingBatch: boolean;
    variant?: 'pending' | 'allocated';
    isFabricOutOfStock?: boolean;
}

export const ProductionDatePopover = memo(function ProductionDatePopover({
    currentDate,
    isLocked,
    onSelectDate,
    onClear,
    hasExistingBatch,
    variant = 'pending',
    isFabricOutOfStock = false,
}: ProductionDatePopoverProps) {
    const [isOpen, setIsOpen] = useState(false);
    const [popoverPosition, setPopoverPosition] = useState({ top: 0, left: 0 });
    const popoverRef = useRef<HTMLDivElement>(null);
    const buttonRef = useRef<HTMLButtonElement>(null);

    // Close on click outside
    useEffect(() => {
        const handleClickOutside = (e: MouseEvent) => {
            if (
                popoverRef.current &&
                !popoverRef.current.contains(e.target as Node) &&
                buttonRef.current &&
                !buttonRef.current.contains(e.target as Node)
            ) {
                setIsOpen(false);
            }
        };

        if (isOpen) {
            document.addEventListener('mousedown', handleClickOutside);
            return () => document.removeEventListener('mousedown', handleClickOutside);
        }
    }, [isOpen]);

    // Calculate position when opening
    const handleOpen = (e: React.MouseEvent) => {
        e.stopPropagation();
        e.preventDefault();
        if (buttonRef.current) {
            const rect = buttonRef.current.getBoundingClientRect();
            setPopoverPosition({
                top: rect.bottom + window.scrollY + 4,
                left: rect.left + window.scrollX,
            });
        }
        setIsOpen(!isOpen);
    };

    // Quick date helpers - use local date to avoid timezone issues
    const getDateString = (daysFromNow: number) => {
        return getLocalDateStringOffset(daysFromNow);
    };

    const formatDisplayDate = (dateStr: string) => {
        const date = new Date(dateStr + 'T00:00:00');
        return date.toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });
    };

    const getRelativeDay = (dateStr: string) => {
        const date = new Date(dateStr + 'T00:00:00');
        const today = new Date();
        today.setHours(0, 0, 0, 0);
        const diffDays = Math.round((date.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));

        if (diffDays === 0) return 'Today';
        if (diffDays === 1) return 'Tomorrow';
        if (diffDays === -1) return 'Yesterday';
        if (diffDays > 1 && diffDays <= 7) return date.toLocaleDateString('en-IN', { weekday: 'short' });
        if (diffDays < -1) return `${Math.abs(diffDays)}d ago`;
        return `In ${diffDays}d`;
    };

    const handleDateSelect = (date: string) => {
        if (isLocked(date)) {
            alert(`Production date ${date} is locked.`);
            return;
        }
        onSelectDate(date);
        setIsOpen(false);
    };

    const quickDates = [
        { label: 'Today', days: 0 },
        { label: '+1', days: 1 },
        { label: '+2', days: 2 },
        { label: '+3', days: 3 },
        { label: '+5', days: 5 },
        { label: '+7', days: 7 },
    ];

    return (
        <div className="flex items-center">
            <button
                ref={buttonRef}
                onClick={handleOpen}
                className={`text-xs w-[82px] py-1 rounded-md flex items-center justify-center gap-1 transition-colors ${
                    currentDate
                        ? isLocked(currentDate)
                            ? 'bg-red-100 text-red-700 border border-red-200 hover:bg-red-200'
                            : variant === 'allocated'
                                ? 'bg-emerald-100 text-emerald-700 border border-emerald-300 hover:bg-emerald-200'
                                : 'bg-amber-100 text-amber-700 border border-amber-300 hover:bg-amber-200'
                        : 'text-amber-600 hover:text-amber-700 hover:bg-amber-50 border border-dashed border-amber-300 hover:border-amber-400'
                } ${isFabricOutOfStock ? 'ring-2 ring-red-300' : ''}`}
                title={currentDate
                    ? `Production: ${formatDisplayDate(currentDate)}${isFabricOutOfStock ? ' (Fabric OOS)' : ''}`
                    : isFabricOutOfStock
                        ? 'Set production date (Fabric is out of stock)'
                        : 'Set production date'}
            >
                {currentDate ? (
                    <span className="flex flex-col items-center leading-tight">
                        <span className="font-medium text-[11px]">{formatDisplayDate(currentDate)}</span>
                        <span className="text-[9px] opacity-75">{getRelativeDay(currentDate)}</span>
                    </span>
                ) : (
                    <>
                        <Calendar size={12} />
                        <span className="text-[11px]">Production</span>
                    </>
                )}
            </button>

            {isOpen && createPortal(
                <div
                    ref={popoverRef}
                    className="fixed z-[9999] bg-white rounded-lg shadow-lg border border-gray-200 p-2 min-w-[180px]"
                    style={{ top: popoverPosition.top, left: popoverPosition.left }}
                    onClick={(e) => e.stopPropagation()}
                >
                    {/* Quick date buttons */}
                    <div className="flex flex-wrap gap-1 mb-2">
                        {quickDates.map(({ label, days }) => {
                            const dateStr = getDateString(days);
                            const locked = isLocked(dateStr);
                            const isSelected = currentDate === dateStr;
                            return (
                                <button
                                    key={days}
                                    onClick={() => handleDateSelect(dateStr)}
                                    disabled={locked}
                                    className={`px-2 py-1 text-xs rounded transition-colors ${
                                        isSelected
                                            ? 'bg-orange-500 text-white'
                                            : locked
                                            ? 'bg-gray-100 text-gray-400 cursor-not-allowed'
                                            : 'bg-gray-100 text-gray-700 hover:bg-orange-100 hover:text-orange-700'
                                    }`}
                                    title={locked ? 'Date is locked' : formatDisplayDate(dateStr)}
                                >
                                    {label}
                                </button>
                            );
                        })}
                    </div>

                    {/* Calendar input for custom date */}
                    <div className="border-t border-gray-100 pt-2">
                        <input
                            type="date"
                            className="w-full text-xs border border-gray-200 rounded px-2 py-1 focus:outline-none focus:ring-1 focus:ring-orange-300 focus:border-orange-300"
                            min={getTodayString()}
                            value={currentDate || ''}
                            onChange={(e) => {
                                if (e.target.value) {
                                    handleDateSelect(e.target.value);
                                }
                            }}
                        />
                    </div>

                    {/* Clear button */}
                    {hasExistingBatch && currentDate && (
                        <div className="border-t border-gray-100 pt-2 mt-2">
                            <button
                                onClick={() => {
                                    onClear();
                                    setIsOpen(false);
                                }}
                                className="w-full text-xs px-2 py-1 rounded text-red-600 hover:bg-red-50 flex items-center justify-center gap-1"
                            >
                                <X size={10} />
                                Remove from production
                            </button>
                        </div>
                    )}
                </div>,
                document.body
            )}
        </div>
    );
});
