/**
 * ProductionDatePopover
 * Calendar picker for batch production scheduling with quick date selection
 */

import { useState, useRef, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { Calendar, X } from 'lucide-react';

interface ProductionDatePopoverProps {
    currentDate: string | null;
    isLocked: (date: string) => boolean;
    onSelectDate: (date: string) => void;
    onClear: () => void;
    hasExistingBatch: boolean;
}

export function ProductionDatePopover({
    currentDate,
    isLocked,
    onSelectDate,
    onClear,
    hasExistingBatch,
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

    // Quick date helpers
    const getDateString = (daysFromNow: number) => {
        const date = new Date();
        date.setDate(date.getDate() + daysFromNow);
        return date.toISOString().split('T')[0];
    };

    const formatDisplayDate = (dateStr: string) => {
        const date = new Date(dateStr + 'T00:00:00');
        return date.toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });
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
        <div className="inline-block">
            <button
                ref={buttonRef}
                onClick={handleOpen}
                className={`text-xs px-1.5 py-0.5 rounded flex items-center gap-1 transition-colors ${
                    currentDate
                        ? isLocked(currentDate)
                            ? 'bg-red-100 text-red-700 border border-red-200 hover:bg-red-200'
                            : 'bg-orange-100 text-orange-700 border border-orange-200 hover:bg-orange-200'
                        : 'text-gray-400 hover:text-orange-600 hover:bg-orange-50 border border-transparent hover:border-orange-200'
                }`}
                title={currentDate ? `Production: ${formatDisplayDate(currentDate)}` : 'Set production date'}
            >
                <Calendar size={10} />
                {currentDate ? formatDisplayDate(currentDate) : 'Set'}
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
                            min={new Date().toISOString().split('T')[0]}
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
}
