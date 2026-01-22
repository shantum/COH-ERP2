/**
 * TrackingInfoCell - Combined AWB + Courier with popover editing
 *
 * Display: Compact pill showing AWB/courier
 * Edit: Click opens popover with form
 *
 * IMPORTANT: Uses same Zod schema as auto-save cells for consistent validation.
 * Backend remains agnostic to whether data came from button-save or auto-save.
 */

import { useState, useRef, useEffect, memo } from 'react';
import { createPortal } from 'react-dom';
import { Check, X, Trash2, AlertCircle } from 'lucide-react';
import cohLogo from '../../../../assets/COH-Square-Monkey-Logo.png';
import type { CellProps } from '../types';
import { COURIER_OPTIONS } from '../constants';
import { cn } from '../../../../lib/utils';
import { UpdateLineTrackingSchema } from '@coh/shared';

export const TrackingInfoCell = memo(function TrackingInfoCell({ row, handlersRef }: CellProps) {
    if (!row?.lineId) return null;

    const { onUpdateLineTracking, onSettled } = handlersRef.current;
    const [isOpen, setIsOpen] = useState(false);
    const [awbValue, setAwbValue] = useState(row.lineAwbNumber || '');
    const [courierValue, setCourierValue] = useState(row.lineCourier || '');
    const [popoverPosition, setPopoverPosition] = useState({ top: 0, left: 0 });
    const [validationError, setValidationError] = useState<string | null>(null);
    const buttonRef = useRef<HTMLButtonElement>(null);
    const popoverRef = useRef<HTMLDivElement>(null);
    const awbInputRef = useRef<HTMLInputElement>(null);

    // Use local state for display (instant feedback after save)
    const hasData = awbValue || courierValue;

    // Update local values when row changes
    useEffect(() => {
        setAwbValue(row.lineAwbNumber || '');
        setCourierValue(row.lineCourier || '');
    }, [row.lineAwbNumber, row.lineCourier]);

    // Focus AWB input when popover opens
    useEffect(() => {
        if (isOpen && awbInputRef.current) {
            setTimeout(() => {
                awbInputRef.current?.focus();
                awbInputRef.current?.select();
            }, 0);
        }
    }, [isOpen]);

    // Close on click outside
    useEffect(() => {
        const handleClickOutside = (e: MouseEvent) => {
            if (
                popoverRef.current &&
                !popoverRef.current.contains(e.target as Node) &&
                buttonRef.current &&
                !buttonRef.current.contains(e.target as Node)
            ) {
                handleCancel();
            }
        };

        if (isOpen) {
            document.addEventListener('mousedown', handleClickOutside);
            return () => document.removeEventListener('mousedown', handleClickOutside);
        }
    }, [isOpen]);

    const handleOpen = (e: React.MouseEvent) => {
        e.stopPropagation();
        if (buttonRef.current) {
            const rect = buttonRef.current.getBoundingClientRect();
            setPopoverPosition({
                top: rect.bottom + window.scrollY + 4,
                left: rect.left + window.scrollX,
            });
        }
        setIsOpen(true);
    };

    const handleSave = async () => {
        // Validate using same Zod schema as auto-save cells
        // This ensures backend remains agnostic to save method
        const payload = {
            lineId: row.lineId!,
            awbNumber: awbValue.trim() || null,
            courier: courierValue || null,
        };

        const validation = UpdateLineTrackingSchema.safeParse(payload);
        if (!validation.success) {
            setValidationError(validation.error.issues[0]?.message || 'Validation failed');
            return;
        }

        setValidationError(null);

        // Call handler with validated data
        try {
            await onUpdateLineTracking(row.lineId!, {
                awbNumber: awbValue.trim() || undefined,
                courier: courierValue || undefined,
            });
            setIsOpen(false);
            // Call onSettled for UI/DB sync
            onSettled?.();
        } catch (error) {
            setValidationError(error instanceof Error ? error.message : 'Save failed');
        }
    };

    const handleCancel = () => {
        setAwbValue(row.lineAwbNumber || '');
        setCourierValue(row.lineCourier || '');
        setIsOpen(false);
    };

    const handleClear = () => {
        setAwbValue('');
        setCourierValue('');
        // Send empty string to clear - server converts '' to null
        // (undefined gets stripped from JSON and won't update)
        onUpdateLineTracking(row.lineId!, {
            awbNumber: '',
            courier: '',
        });
        setIsOpen(false);
    };

    const handleKeyDown = (e: React.KeyboardEvent) => {
        if (e.key === 'Enter') {
            handleSave();
        } else if (e.key === 'Escape') {
            handleCancel();
        }
    };

    return (
        <>
            <button
                ref={buttonRef}
                onClick={handleOpen}
                className={cn(
                    'text-xs rounded-md flex items-center gap-1.5 transition-colors px-2 py-1 border',
                    hasData
                        ? 'bg-slate-50 text-slate-700 border-slate-200 hover:bg-slate-100'
                        : 'text-slate-400 border-dashed border-slate-200 hover:border-slate-300 hover:text-slate-500'
                )}
                title={hasData ? 'Click to edit tracking' : 'Add tracking info'}
            >
                <img src={cohLogo} alt="COH" className={cn('w-3 h-3', hasData ? 'opacity-100' : 'opacity-40')} />
                {hasData ? (
                    <span className="flex flex-col items-start leading-tight">
                        <span className="font-medium text-[11px] truncate max-w-[80px]">{awbValue}</span>
                        <span className="text-[9px] text-slate-500">{courierValue || 'No courier'}</span>
                    </span>
                ) : (
                    <span className="text-[11px]">Add AWB</span>
                )}
            </button>

            {isOpen && createPortal(
                <div
                    ref={popoverRef}
                    className="fixed z-[9999] bg-white rounded-lg shadow-lg border border-gray-200 p-3 w-[200px]"
                    style={{ top: popoverPosition.top, left: popoverPosition.left }}
                    onClick={(e) => e.stopPropagation()}
                >
                    <div className="space-y-2">
                        <div>
                            <label className="text-[10px] font-medium text-slate-500 uppercase tracking-wide">
                                AWB Number
                            </label>
                            <input
                                ref={awbInputRef}
                                type="text"
                                value={awbValue}
                                onChange={(e) => setAwbValue(e.target.value)}
                                onKeyDown={handleKeyDown}
                                className="w-full text-xs px-2 py-1.5 border border-slate-200 rounded-md focus:outline-none focus:ring-1 focus:ring-emerald-400 focus:border-emerald-400 bg-white mt-1"
                                placeholder="Enter AWB"
                            />
                        </div>
                        <div>
                            <label className="text-[10px] font-medium text-slate-500 uppercase tracking-wide">
                                Courier
                            </label>
                            <select
                                value={courierValue}
                                onChange={(e) => setCourierValue(e.target.value)}
                                onKeyDown={handleKeyDown}
                                className="w-full text-xs px-2 py-1.5 border border-slate-200 rounded-md focus:outline-none focus:ring-1 focus:ring-emerald-400 focus:border-emerald-400 bg-white mt-1"
                            >
                                <option value="">Select courier</option>
                                {COURIER_OPTIONS.map((courier) => (
                                    <option key={courier} value={courier}>
                                        {courier}
                                    </option>
                                ))}
                            </select>
                        </div>
                        <div className="flex gap-2 pt-1">
                            <button
                                onClick={handleSave}
                                className="flex-1 text-xs px-2 py-1.5 rounded-md bg-emerald-500 text-white hover:bg-emerald-600 flex items-center justify-center gap-1"
                            >
                                <Check size={12} />
                                Save
                            </button>
                            <button
                                onClick={handleCancel}
                                className="flex-1 text-xs px-2 py-1.5 rounded-md border border-slate-200 text-slate-600 hover:bg-slate-50 flex items-center justify-center gap-1"
                            >
                                <X size={12} />
                                Cancel
                            </button>
                        </div>
                        {validationError && (
                            <div className="flex items-center gap-1 text-[10px] text-red-500 pt-1">
                                <AlertCircle size={10} />
                                <span>{validationError}</span>
                            </div>
                        )}
                        {(row.lineAwbNumber || row.lineCourier) && (
                            <button
                                onClick={handleClear}
                                className="w-full text-[10px] pt-2 text-slate-400 hover:text-red-500 flex items-center justify-center gap-1 transition-colors"
                            >
                                <Trash2 size={10} />
                                Clear tracking data
                            </button>
                        )}
                    </div>
                </div>,
                document.body
            )}
        </>
    );
});
