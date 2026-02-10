// @ts-nocheck
/**
 * ShipByDateCell - Editable ship-by date cell with popover date picker
 *
 * IMPORTANT: Uses same Zod schema as auto-save cells for consistent validation.
 * Backend remains agnostic to whether data came from button-save or auto-save.
 */

import { useState, useRef, useEffect, memo } from 'react';
import { createPortal } from 'react-dom';
import { Calendar, X, AlertCircle } from 'lucide-react';
import type { CellProps } from '../types';
import { cn } from '../../../../lib/utils';
import { UpdateShipByDateSchema } from '@coh/shared';

export const ShipByDateCell = memo(function ShipByDateCell({ row, handlersRef }: ShipByDateCellProps) {
    if (!row.isFirstLine) return null;

    const { onUpdateShipByDate, onSettled } = handlersRef.current;
    const [isOpen, setIsOpen] = useState(false);
    const [popoverPosition, setPopoverPosition] = useState({ top: 0, left: 0 });
    const [validationError, setValidationError] = useState<string | null>(null);
    const popoverRef = useRef<HTMLDivElement>(null);
    const buttonRef = useRef<HTMLButtonElement>(null);

    // Normalize date to string (handles both Date objects and strings from server)
    const normalizeDate = (date: string | Date | null | undefined): string | null => {
        if (!date) return null;
        if (date instanceof Date) {
            return date.toISOString().split('T')[0];
        }
        if (typeof date === 'string') {
            return date.split('T')[0];
        }
        return null;
    };

    // Local state for instant feedback
    const [localDate, setLocalDate] = useState<string | null>(() => normalizeDate(row.shipByDate));

    // Sync with server data when it changes
    useEffect(() => {
        setLocalDate(normalizeDate(row.shipByDate));
    }, [row.shipByDate]);

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
        if (!onUpdateShipByDate) return;

        if (buttonRef.current) {
            const rect = buttonRef.current.getBoundingClientRect();
            const popoverWidth = 200;
            const popoverHeight = 180;

            // Check if popover would overflow right edge
            let left = rect.left + window.scrollX;
            if (left + popoverWidth > window.innerWidth - 16) {
                left = window.innerWidth - popoverWidth - 16;
            }

            // Check if popover would overflow bottom edge
            let top = rect.bottom + window.scrollY + 4;
            if (rect.bottom + popoverHeight > window.innerHeight - 16) {
                top = rect.top + window.scrollY - popoverHeight - 4;
            }

            setPopoverPosition({ top, left });
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

    const getRelativeDay = (dateStr: string) => {
        const date = new Date(dateStr + 'T00:00:00');
        const today = new Date();
        today.setHours(0, 0, 0, 0);
        const diffDays = Math.round((date.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));

        if (diffDays === 0) return 'Today';
        if (diffDays === 1) return 'Tomorrow';
        if (diffDays === -1) return 'Yesterday';
        if (diffDays > 1 && diffDays <= 7) return date.toLocaleDateString('en-IN', { weekday: 'short' });
        if (diffDays < -1) return `${Math.abs(diffDays)}d overdue`;
        return `In ${diffDays}d`;
    };

    const handleDateSelect = async (date: string) => {
        // Validate using same Zod schema as auto-save cells
        // This ensures backend remains agnostic to save method
        const payload = {
            orderId: row.orderId,
            shipByDate: date,
        };

        const validation = UpdateShipByDateSchema.safeParse(payload);
        if (!validation.success) {
            setValidationError(validation.error.issues[0]?.message || 'Validation failed');
            return;
        }

        setValidationError(null);
        // Update local state immediately for instant feedback
        setLocalDate(date);

        try {
            if (onUpdateShipByDate) {
                await onUpdateShipByDate(row.orderId, date);
                // Call onSettled for UI/DB sync
                onSettled?.();
            }
            setIsOpen(false);
        } catch (error) {
            setValidationError(error instanceof Error ? error.message : 'Save failed');
            // Revert local state on error
            setLocalDate(normalizeDate(row.shipByDate));
        }
    };

    const handleClear = async () => {
        // Validate using same Zod schema as auto-save cells
        const payload = {
            orderId: row.orderId,
            shipByDate: null,
        };

        const validation = UpdateShipByDateSchema.safeParse(payload);
        if (!validation.success) {
            setValidationError(validation.error.issues[0]?.message || 'Validation failed');
            return;
        }

        setValidationError(null);
        setLocalDate(null);

        try {
            if (onUpdateShipByDate) {
                await onUpdateShipByDate(row.orderId, null);
                // Call onSettled for UI/DB sync
                onSettled?.();
            }
            setIsOpen(false);
        } catch (error) {
            setValidationError(error instanceof Error ? error.message : 'Save failed');
            // Revert local state on error
            setLocalDate(normalizeDate(row.shipByDate));
        }
    };

    // Check if past due (localDate is already normalized to YYYY-MM-DD string)
    const isPastDue = localDate && new Date(localDate + 'T00:00:00') < new Date(new Date().toDateString());

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
                className={cn(
                    'text-xs w-[78px] py-1 rounded-md flex items-center justify-center gap-1 transition-colors',
                    localDate
                        ? isPastDue
                            ? 'bg-red-100 text-red-700 border border-red-300 hover:bg-red-200'
                            : 'bg-blue-50 text-blue-700 border border-blue-200 hover:bg-blue-100'
                        : 'text-gray-400 hover:text-blue-600 hover:bg-blue-50 border border-dashed border-gray-300 hover:border-blue-300'
                )}
                title={localDate ? `Ship by: ${formatDisplayDate(localDate)}` : 'Set ship by date'}
            >
                {localDate ? (
                    <span className="flex flex-col items-center leading-tight">
                        <span className="font-medium text-[11px]">{formatDisplayDate(localDate)}</span>
                        <span className={cn(
                            'text-[9px]',
                            isPastDue ? 'text-red-600' : 'opacity-75'
                        )}>
                            {getRelativeDay(localDate)}
                        </span>
                    </span>
                ) : (
                    <>
                        <Calendar size={11} />
                        <span className="text-[10px]">Ship by</span>
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
                            const isSelected = localDate === dateStr;
                            return (
                                <button
                                    key={days}
                                    onClick={() => handleDateSelect(dateStr)}
                                    className={cn(
                                        'px-2 py-1 text-xs rounded transition-colors',
                                        isSelected
                                            ? 'bg-blue-500 text-white'
                                            : 'bg-gray-100 text-gray-700 hover:bg-blue-100 hover:text-blue-700'
                                    )}
                                    title={formatDisplayDate(dateStr)}
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
                            className="w-full text-xs border border-gray-200 rounded px-2 py-1 focus:outline-none focus:ring-1 focus:ring-blue-300 focus:border-blue-300"
                            value={localDate || ''}
                            onChange={(e) => {
                                if (e.target.value) {
                                    handleDateSelect(e.target.value);
                                }
                            }}
                        />
                    </div>

                    {/* Validation error display */}
                    {validationError && (
                        <div className="flex items-center gap-1 text-[10px] text-red-500 pt-2 mt-2 border-t border-gray-100">
                            <AlertCircle size={10} />
                            <span>{validationError}</span>
                        </div>
                    )}

                    {/* Clear button */}
                    {localDate && (
                        <div className="border-t border-gray-100 pt-2 mt-2">
                            <button
                                onClick={handleClear}
                                className="w-full text-xs px-2 py-1 rounded text-red-600 hover:bg-red-50 flex items-center justify-center gap-1"
                            >
                                <X size={10} />
                                Clear ship by date
                            </button>
                        </div>
                    )}
                </div>,
                document.body
            )}
        </div>
    );
});

interface ShipByDateCellProps extends CellProps {}
