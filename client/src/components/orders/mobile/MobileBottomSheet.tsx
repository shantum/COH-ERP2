/**
 * MobileBottomSheet - iOS-style bottom sheet for bulk actions
 *
 * Features:
 * - iPhone safe area support
 * - Drag to dismiss
 * - Calendar wheel picker for date selection
 * - Workload indicators per day
 */

import { memo, useState, useCallback, useRef, type TouchEvent } from 'react';
import { X, Calendar, Trash2 } from 'lucide-react';

interface MobileBottomSheetProps {
    isOpen: boolean;
    onClose: () => void;
    selectedCount: number;
    onAssignDate: (date: string) => void;
    onCancel: () => void;
    isDateLocked: (date: string) => boolean;
    /** Optional: number of items already scheduled per date */
    workloadByDate?: Record<string, number>;
}

export const MobileBottomSheet = memo(function MobileBottomSheet({
    isOpen,
    onClose,
    selectedCount,
    onAssignDate,
    onCancel,
    isDateLocked,
    workloadByDate = {},
}: MobileBottomSheetProps) {
    const [selectedDate, setSelectedDate] = useState<string | null>(null);
    const [dragOffset, setDragOffset] = useState(0);
    const touchStartY = useRef(0);
    const sheetRef = useRef<HTMLDivElement>(null);

    const DISMISS_THRESHOLD = 100;

    const handleTouchStart = useCallback((e: TouchEvent) => {
        touchStartY.current = e.touches[0].clientY;
    }, []);

    const handleTouchMove = useCallback((e: TouchEvent) => {
        const delta = e.touches[0].clientY - touchStartY.current;
        if (delta > 0) {
            setDragOffset(delta);
        }
    }, []);

    const handleTouchEnd = useCallback(() => {
        if (dragOffset > DISMISS_THRESHOLD) {
            onClose();
        }
        setDragOffset(0);
    }, [dragOffset, onClose]);

    const handleAssign = useCallback(() => {
        if (selectedDate) {
            onAssignDate(selectedDate);
            setSelectedDate(null);
        }
    }, [selectedDate, onAssignDate]);

    // Generate next 14 days for selection
    const dates = generateDates(14);

    if (!isOpen) return null;

    return (
        <>
            {/* Backdrop */}
            <div
                className="fixed inset-0 bg-black/40 z-40 transition-opacity"
                onClick={onClose}
                style={{ opacity: Math.max(0, 1 - dragOffset / 200) }}
            />

            {/* Sheet */}
            <div
                ref={sheetRef}
                className="fixed bottom-0 left-0 right-0 bg-white rounded-t-3xl z-50 transition-transform duration-200 ease-out"
                style={{
                    transform: `translateY(${dragOffset}px)`,
                    paddingBottom: 'env(safe-area-inset-bottom, 20px)',
                }}
                onTouchStart={handleTouchStart}
                onTouchMove={handleTouchMove}
                onTouchEnd={handleTouchEnd}
            >
                {/* Drag handle */}
                <div className="flex justify-center py-3">
                    <div className="w-10 h-1 bg-slate-300 rounded-full" />
                </div>

                {/* Header */}
                <div className="px-5 pb-4 border-b border-slate-100">
                    <div className="flex items-center justify-between">
                        <h2 className="text-lg font-semibold text-slate-900">
                            {selectedCount} item{selectedCount !== 1 ? 's' : ''} selected
                        </h2>
                        <button
                            onClick={onClose}
                            className="w-8 h-8 rounded-full bg-slate-100 flex items-center justify-center"
                        >
                            <X size={18} className="text-slate-500" />
                        </button>
                    </div>
                </div>

                {/* Date selection */}
                <div className="px-5 py-4">
                    <div className="flex items-center gap-2 mb-3">
                        <Calendar size={16} className="text-slate-500" />
                        <span className="text-sm font-medium text-slate-700">
                            Select Production Date
                        </span>
                    </div>

                    {/* Date grid - optimized for iPhone touch (44pt minimum) */}
                    <div className="grid grid-cols-4 gap-2">
                        {dates.slice(0, 8).map(({ dateStr, day, weekday, month, isToday, isTomorrow }) => {
                            const locked = isDateLocked(dateStr);
                            const isSelected = selectedDate === dateStr;
                            const workload = workloadByDate[dateStr] || 0;

                            return (
                                <button
                                    key={dateStr}
                                    onClick={() => !locked && setSelectedDate(dateStr)}
                                    disabled={locked}
                                    className={`
                                        min-h-[72px] rounded-2xl flex flex-col items-center justify-center
                                        transition-all duration-150 active:scale-95
                                        ${isSelected
                                            ? 'bg-orange-500 text-white shadow-lg shadow-orange-500/30'
                                            : locked
                                                ? 'bg-slate-100 text-slate-300'
                                                : 'bg-slate-50 text-slate-700 border border-slate-200'
                                        }
                                    `}
                                >
                                    <span className={`text-[10px] font-medium ${
                                        isSelected ? 'text-orange-100' : 'text-slate-400'
                                    }`}>
                                        {isToday ? 'Today' : isTomorrow ? 'Tmrw' : weekday}
                                    </span>
                                    <span className={`text-xl font-bold ${
                                        isSelected ? 'text-white' : ''
                                    }`}>
                                        {day}
                                    </span>
                                    <span className={`text-[10px] ${
                                        isSelected ? 'text-orange-100' : 'text-slate-400'
                                    }`}>
                                        {month}
                                    </span>
                                    {workload > 0 && (
                                        <span className={`text-[9px] mt-0.5 px-1.5 rounded-full ${
                                            isSelected
                                                ? 'bg-orange-400 text-white'
                                                : 'bg-slate-200 text-slate-500'
                                        }`}>
                                            {workload} items
                                        </span>
                                    )}
                                </button>
                            );
                        })}
                    </div>

                    {/* More dates row */}
                    <div className="flex gap-2 mt-2 overflow-x-auto pb-1 -mx-5 px-5">
                        {dates.slice(8).map(({ dateStr, day, month }) => {
                            const locked = isDateLocked(dateStr);
                            const isSelected = selectedDate === dateStr;

                            return (
                                <button
                                    key={dateStr}
                                    onClick={() => !locked && setSelectedDate(dateStr)}
                                    disabled={locked}
                                    className={`
                                        flex-shrink-0 w-14 h-14 rounded-xl flex flex-col items-center justify-center
                                        transition-all active:scale-95
                                        ${isSelected
                                            ? 'bg-orange-500 text-white'
                                            : locked
                                                ? 'bg-slate-100 text-slate-300'
                                                : 'bg-slate-50 text-slate-600 border border-slate-200'
                                        }
                                    `}
                                >
                                    <span className="text-xs font-medium">{day}</span>
                                    <span className="text-[10px] opacity-70">{month}</span>
                                </button>
                            );
                        })}
                    </div>
                </div>

                {/* Actions */}
                <div className="px-5 py-4 border-t border-slate-100">
                    <button
                        onClick={handleAssign}
                        disabled={!selectedDate}
                        className={`
                            w-full py-4 rounded-2xl font-semibold text-base
                            transition-all active:scale-[0.98]
                            ${selectedDate
                                ? 'bg-orange-500 text-white shadow-lg shadow-orange-500/30'
                                : 'bg-slate-100 text-slate-400'
                            }
                        `}
                    >
                        {selectedDate
                            ? `Assign to ${formatDisplayDate(selectedDate)}`
                            : 'Select a date'
                        }
                    </button>

                    <button
                        onClick={onCancel}
                        className="w-full py-3 mt-2 rounded-2xl font-medium text-sm text-red-500 bg-red-50 flex items-center justify-center gap-2 active:bg-red-100 transition-colors"
                    >
                        <Trash2 size={16} />
                        Cancel {selectedCount} order{selectedCount !== 1 ? 's' : ''}
                    </button>
                </div>
            </div>
        </>
    );
});

// Helpers
interface DateInfo {
    dateStr: string;
    day: number;
    weekday: string;
    month: string;
    isToday: boolean;
    isTomorrow: boolean;
}

function generateDates(count: number): DateInfo[] {
    const dates: DateInfo[] = [];
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    for (let i = 0; i < count; i++) {
        const date = new Date(today);
        date.setDate(date.getDate() + i);

        dates.push({
            dateStr: formatDateStr(date),
            day: date.getDate(),
            weekday: date.toLocaleDateString('en-IN', { weekday: 'short' }),
            month: date.toLocaleDateString('en-IN', { month: 'short' }),
            isToday: i === 0,
            isTomorrow: i === 1,
        });
    }

    return dates;
}

function formatDateStr(date: Date): string {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
}

function formatDisplayDate(dateStr: string): string {
    const date = new Date(dateStr + 'T00:00:00');
    return date.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', weekday: 'short' });
}
