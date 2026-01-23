/**
 * MobileDateStrip - Horizontal scrollable date picker
 *
 * Touch-optimized date selection with one-tap interaction.
 * Shows next 14 days in a horizontally scrollable strip.
 */

import { memo, useRef, useEffect } from 'react';
import { X, Calendar } from 'lucide-react';

interface MobileDateStripProps {
    currentDate: string | null;
    isLocked: (date: string) => boolean;
    onSelectDate: (date: string) => void;
    onClear: () => void;
    hasExistingBatch: boolean;
}

export const MobileDateStrip = memo(function MobileDateStrip({
    currentDate,
    isLocked,
    onSelectDate,
    onClear,
    hasExistingBatch,
}: MobileDateStripProps) {
    const scrollRef = useRef<HTMLDivElement>(null);

    // Generate next 14 days
    const dates = generateDates(14);

    // Scroll to selected date on mount
    useEffect(() => {
        if (currentDate && scrollRef.current) {
            const selectedIndex = dates.findIndex(d => d.dateStr === currentDate);
            if (selectedIndex > 0) {
                const scrollTo = selectedIndex * 56 - 20; // 56px per item, offset for visibility
                scrollRef.current.scrollTo({ left: scrollTo, behavior: 'smooth' });
            }
        }
    }, [currentDate, dates]);

    return (
        <div className="bg-slate-50 -mx-4 px-4 py-3">
            <div className="flex items-center justify-between mb-2">
                <span className="text-xs font-medium text-slate-600 flex items-center gap-1">
                    <Calendar size={12} />
                    Production Date
                </span>
                {hasExistingBatch && currentDate && (
                    <button
                        onClick={onClear}
                        className="text-xs text-red-500 flex items-center gap-1"
                    >
                        <X size={12} />
                        Clear
                    </button>
                )}
            </div>

            <div
                ref={scrollRef}
                className="flex gap-2 overflow-x-auto scrollbar-hide pb-1 -mx-4 px-4"
                style={{ scrollSnapType: 'x mandatory' }}
            >
                {dates.map(({ dateStr, day, weekday, month, isToday, isTomorrow }) => {
                    const locked = isLocked(dateStr);
                    const isSelected = currentDate === dateStr;

                    return (
                        <button
                            key={dateStr}
                            onClick={() => !locked && onSelectDate(dateStr)}
                            disabled={locked}
                            className={`
                                flex-shrink-0 w-[52px] py-2 rounded-xl transition-all duration-150
                                flex flex-col items-center justify-center
                                ${isSelected
                                    ? 'bg-orange-500 text-white shadow-lg shadow-orange-500/30 scale-105'
                                    : locked
                                        ? 'bg-slate-100 text-slate-300 cursor-not-allowed'
                                        : 'bg-white text-slate-700 border border-slate-200 active:scale-95'
                                }
                            `}
                            style={{ scrollSnapAlign: 'start' }}
                        >
                            <span className={`text-[10px] font-medium ${
                                isSelected ? 'text-orange-100' : 'text-slate-400'
                            }`}>
                                {isToday ? 'Today' : isTomorrow ? 'Tmrw' : weekday}
                            </span>
                            <span className={`text-lg font-bold leading-tight ${
                                isSelected ? 'text-white' : ''
                            }`}>
                                {day}
                            </span>
                            <span className={`text-[10px] ${
                                isSelected ? 'text-orange-100' : 'text-slate-400'
                            }`}>
                                {month}
                            </span>
                        </button>
                    );
                })}
            </div>

            {/* Quick actions */}
            <div className="flex gap-2 mt-2">
                {[
                    { label: 'Today', days: 0 },
                    { label: '+1 Day', days: 1 },
                    { label: '+3 Days', days: 3 },
                    { label: '+1 Week', days: 7 },
                ].map(({ label, days }) => {
                    const dateStr = getDateOffset(days);
                    const locked = isLocked(dateStr);
                    const isSelected = currentDate === dateStr;

                    return (
                        <button
                            key={days}
                            onClick={() => !locked && onSelectDate(dateStr)}
                            disabled={locked}
                            className={`
                                flex-1 py-1.5 text-xs font-medium rounded-lg transition-colors
                                ${isSelected
                                    ? 'bg-orange-100 text-orange-700 border border-orange-300'
                                    : locked
                                        ? 'bg-slate-100 text-slate-300 cursor-not-allowed'
                                        : 'bg-white text-slate-600 border border-slate-200 active:bg-slate-50'
                                }
                            `}
                        >
                            {label}
                        </button>
                    );
                })}
            </div>
        </div>
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

function getDateOffset(days: number): string {
    const date = new Date();
    date.setHours(0, 0, 0, 0);
    date.setDate(date.getDate() + days);
    return formatDateStr(date);
}

function formatDateStr(date: Date): string {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
}
