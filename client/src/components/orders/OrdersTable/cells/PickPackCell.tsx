/**
 * PickPackCell - Combined Pick, Pack & Ship workflow
 * Compact pill-style buttons matching table aesthetic
 */

import { memo } from 'react';
import { Square, CheckSquare, Loader2 } from 'lucide-react';
import type { FlattenedOrderRow } from '../../../../utils/orderHelpers';
import type { DynamicColumnHandlers } from '../types';
import { cn } from '../../../../lib/utils';

interface PickPackCellProps {
    row: FlattenedOrderRow;
    handlersRef: React.MutableRefObject<DynamicColumnHandlers>;
}

export const PickPackCell = memo(function PickPackCell({ row, handlersRef }: PickPackCellProps) {
    const status = row.lineStatus || 'pending';
    const lineId = row.lineId;

    const { onPick, onUnpick, onPack, onUnpack, onMarkShippedLine, onUnmarkShippedLine, allocatingLines } = handlersRef.current;
    const isLoading = lineId ? allocatingLines?.has(lineId) || false : false;

    const isPending = status === 'pending';
    const isAllocated = status === 'allocated';
    const isPicked = status === 'picked';
    const isPacked = status === 'packed';
    const isShipped = status === 'shipped';
    const isCancelled = status === 'cancelled';

    // Not yet allocated - show all inactive
    if (isPending) {
        return (
            <div className="flex items-center gap-1">
                <Step label="Pick" state="inactive" />
                <Step label="Pack" state="inactive" />
                <Step label="Ship" state="inactive" />
            </div>
        );
    }

    // Allocated - ready to pick
    if (isAllocated) {
        return (
            <div className="flex items-center gap-1">
                <Step
                    label="Pick"
                    state="active"
                    isLoading={isLoading}
                    onClick={() => lineId && onPick?.(lineId)}
                />
                <Step label="Pack" state="inactive" />
                <Step label="Ship" state="inactive" />
            </div>
        );
    }

    // Picked - ready to pack
    if (isPicked) {
        return (
            <div className="flex items-center gap-1">
                <Step
                    label="Pick"
                    state="done"
                    onClick={() => lineId && onUnpick?.(lineId)}
                    isLoading={isLoading}
                />
                <Step
                    label="Pack"
                    state="active"
                    isLoading={isLoading}
                    onClick={() => lineId && onPack?.(lineId)}
                />
                <Step label="Ship" state="inactive" />
            </div>
        );
    }

    // Packed - ready to ship
    if (isPacked) {
        return (
            <div className="flex items-center gap-1">
                <Step label="Pick" state="done" />
                <Step
                    label="Pack"
                    state="done"
                    onClick={() => lineId && onUnpack?.(lineId)}
                    isLoading={isLoading}
                />
                <Step
                    label="Ship"
                    state="active"
                    isLoading={isLoading}
                    onClick={() => lineId && onMarkShippedLine?.(lineId)}
                />
            </div>
        );
    }

    // Shipped - all complete
    if (isShipped) {
        return (
            <div className="flex items-center gap-1">
                <Step label="Pick" state="complete" />
                <Step label="Pack" state="complete" />
                <Step
                    label="Ship"
                    state="done"
                    onClick={() => lineId && onUnmarkShippedLine?.(lineId)}
                    isLoading={isLoading}
                />
            </div>
        );
    }

    // Cancelled
    if (isCancelled) {
        return <span className="text-xs text-gray-300">-</span>;
    }

    return null;
}, (prev, next) => (
    prev.row.lineId === next.row.lineId &&
    prev.row.lineStatus === next.row.lineStatus &&
    prev.handlersRef.current.allocatingLines === next.handlersRef.current.allocatingLines
));

interface StepProps {
    label: string;
    state: 'inactive' | 'active' | 'done' | 'complete';
    onClick?: () => void;
    isLoading?: boolean;
}

function Step({ label, state, onClick, isLoading }: StepProps) {
    const isClickable = state === 'active' || state === 'done';
    const isDone = state === 'done' || state === 'complete';

    return (
        <button
            onClick={(e) => {
                e.stopPropagation();
                if (isClickable && !isLoading && onClick) {
                    onClick();
                }
            }}
            disabled={!isClickable || isLoading}
            className={cn(
                'relative w-[50px] py-1 rounded-md text-[10px] font-medium transition-all border flex items-center justify-center gap-0.5',
                // Inactive - subtle dashed border
                state === 'inactive' && 'text-gray-300 border-dashed border-gray-200 cursor-default',
                // Active - green, ready to click
                state === 'active' && 'bg-emerald-50 text-emerald-700 border-emerald-300 hover:bg-emerald-100 cursor-pointer',
                // Done - green with check
                state === 'done' && 'bg-emerald-50 text-emerald-700 border-emerald-200 hover:bg-emerald-100 cursor-pointer',
                // Complete - muted green, not clickable (shipped)
                state === 'complete' && 'bg-emerald-50/50 text-emerald-400 border-emerald-100 cursor-default',
                // Loading
                isLoading && 'opacity-60'
            )}
            title={
                state === 'inactive' ? `${label} (not ready)`
                : state === 'active' ? `Click to ${label.toLowerCase()}`
                : state === 'done' ? `Click to undo ${label.toLowerCase()}`
                : label
            }
        >
            {isLoading ? (
                <Loader2 size={12} className="animate-spin" />
            ) : (
                <>
                    {isDone ? <CheckSquare size={12} /> : <Square size={12} />}
                    {label}
                </>
            )}
        </button>
    );
}
