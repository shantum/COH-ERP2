/**
 * WorkflowCell - Combined Allocate → Pick → Pack → Ship workflow
 *
 * States:
 * - No stock: "Assign production" prompt
 * - Has stock, pending: [A] active, rest inactive
 * - Allocated: [✓A] [P] active, rest inactive
 * - Picked: [✓A] [✓P] [K] active
 * - Packed: [✓A] [✓P] [✓K] [S] active
 * - Shipped: "Shipped ✓" clean state
 *
 * Each step reversible by clicking checked box
 */

import { Check, Loader2 } from 'lucide-react';
import type { FlattenedOrderRow } from '../../../../utils/orderHelpers';
import type { DynamicColumnHandlers } from '../types';
import { cn } from '../../../../lib/utils';

interface WorkflowCellProps {
    row: FlattenedOrderRow;
    handlersRef: React.MutableRefObject<DynamicColumnHandlers>;
}

type Step = 'allocate' | 'pick' | 'pack' | 'ship';

const STEPS: { key: Step; label: string; shade: number }[] = [
    { key: 'allocate', label: 'A', shade: 200 },
    { key: 'pick', label: 'P', shade: 300 },
    { key: 'pack', label: 'K', shade: 400 },
    { key: 'ship', label: 'S', shade: 500 },
];

function getStepIndex(status: string | null): number {
    switch (status) {
        case 'allocated': return 1;
        case 'picked': return 2;
        case 'packed': return 3;
        case 'shipped': return 4;
        default: return 0; // pending
    }
}

export function WorkflowCell({ row, handlersRef }: WorkflowCellProps) {
    const status = row.lineStatus || 'pending';
    const lineId = row.lineId;
    const stock = row.skuStock ?? 0;
    const hasStock = stock > 0;
    const hasProductionDate = !!row.productionDate;

    const currentStep = getStepIndex(status);
    const isShipped = status === 'shipped';
    const isPending = status === 'pending';

    const {
        onAllocate,
        onUnallocate,
        onPick,
        onUnpick,
        onPack,
        onUnpack,
        onMarkShippedLine,
        onUnmarkShippedLine,
        allocatingLines,
    } = handlersRef.current;

    // Use allocatingLines for all loading states (it's the general loading indicator)
    const isLoading = lineId ? allocatingLines?.has(lineId) || false : false;

    // Handle ship action with AWB logic
    const handleShip = () => {
        if (!lineId) return;

        const existingAwb = row.lineAwbNumber || row.shopifyAwb;
        if (existingAwb) {
            // Has AWB - ship directly
            onMarkShippedLine?.(lineId, {
                awbNumber: existingAwb,
                courier: row.lineCourier || row.shopifyCourier || 'Unknown',
            });
        } else {
            // No AWB - prompt for it
            const awb = prompt('AWB Number (required):');
            if (!awb?.trim()) return;
            const courier = prompt('Courier:') || 'Unknown';
            onMarkShippedLine?.(lineId, { awbNumber: awb.trim(), courier });
        }
    };

    // Handle step click - advance or reverse
    const handleStepClick = (stepIndex: number, step: Step) => {
        if (!lineId) return;

        const isCompleted = stepIndex < currentStep;
        const isNext = stepIndex === currentStep;

        if (isCompleted) {
            // Reverse action
            switch (step) {
                case 'allocate':
                    onUnallocate?.(lineId);
                    break;
                case 'pick':
                    onUnpick?.(lineId);
                    break;
                case 'pack':
                    onUnpack?.(lineId);
                    break;
                case 'ship':
                    onUnmarkShippedLine?.(lineId);
                    break;
            }
        } else if (isNext) {
            // Advance action
            switch (step) {
                case 'allocate':
                    if (hasStock) onAllocate?.(lineId);
                    break;
                case 'pick':
                    onPick?.(lineId);
                    break;
                case 'pack':
                    onPack?.(lineId);
                    break;
                case 'ship':
                    handleShip();
                    break;
            }
        }
    };

    // Shipped state - clean display
    if (isShipped) {
        return (
            <button
                onClick={(e) => {
                    e.stopPropagation();
                    if (lineId) onUnmarkShippedLine?.(lineId);
                }}
                disabled={isLoading}
                className={cn(
                    'flex items-center gap-1.5 px-2 py-1 rounded transition-colors',
                    isLoading
                        ? 'bg-emerald-50 text-emerald-400'
                        : 'bg-emerald-50 text-emerald-600 hover:bg-emerald-100'
                )}
                title="Click to unship"
            >
                {isLoading ? (
                    <Loader2 size={12} className="animate-spin" />
                ) : (
                    <Check size={12} className="text-emerald-500" />
                )}
                <span className="text-xs font-medium">Shipped</span>
            </button>
        );
    }

    // No stock and pending - show nudge to set production
    if (isPending && !hasStock) {
        return (
            <span className={hasProductionDate
                ? 'text-[10px] text-amber-500/80 italic'
                : 'text-[10px] text-amber-600/80 font-medium'
            }>
                {hasProductionDate ? 'In production' : 'Set production →'}
            </span>
        );
    }

    // Show workflow checkboxes
    return (
        <div className="flex items-center gap-1">
            {STEPS.map((step, idx) => {
                const isCompleted = idx < currentStep;
                const isNext = idx === currentStep;

                // Can only click if completed (to undo) or next (to advance)
                // For allocate, also need stock
                const canClick = isCompleted || (isNext && (step.key !== 'allocate' || hasStock));

                return (
                    <button
                        key={step.key}
                        onClick={(e) => {
                            e.stopPropagation();
                            if (canClick && !isLoading) {
                                handleStepClick(idx, step.key);
                            }
                        }}
                        disabled={!canClick || isLoading}
                        className={cn(
                            'w-5 h-5 rounded border-2 flex items-center justify-center transition-all text-[10px] font-medium',
                            // Completed state - muted emerald gradient
                            isCompleted && step.shade === 200 && 'bg-emerald-300 border-emerald-300 text-white',
                            isCompleted && step.shade === 300 && 'bg-emerald-400 border-emerald-400 text-white',
                            isCompleted && step.shade === 400 && 'bg-emerald-500 border-emerald-500 text-white',
                            isCompleted && step.shade === 500 && 'bg-emerald-600 border-emerald-600 text-white',
                            // Next/active state - muted emerald
                            isNext && canClick && step.shade === 200 && 'border-emerald-300 text-emerald-500 hover:bg-emerald-50',
                            isNext && canClick && step.shade === 300 && 'border-emerald-400 text-emerald-500 hover:bg-emerald-50',
                            isNext && canClick && step.shade === 400 && 'border-emerald-500 text-emerald-600 hover:bg-emerald-50',
                            isNext && canClick && step.shade === 500 && 'border-emerald-600 text-emerald-600 hover:bg-emerald-50',
                            // Inactive/future state
                            !isCompleted && !isNext && 'border-slate-200 text-slate-300',
                            // Can't click allocate without stock
                            isNext && !canClick && 'border-slate-200 text-slate-300 cursor-not-allowed',
                            // Loading
                            isLoading && 'opacity-50'
                        )}
                        title={
                            isCompleted
                                ? `Undo ${step.key}`
                                : isNext && canClick
                                ? `${step.key.charAt(0).toUpperCase() + step.key.slice(1)}`
                                : isNext && !canClick
                                ? 'No stock available'
                                : step.key
                        }
                    >
                        {isLoading && (isCompleted || isNext) ? (
                            <Loader2 size={10} className="animate-spin" />
                        ) : isCompleted ? (
                            <Check size={10} />
                        ) : (
                            step.label
                        )}
                    </button>
                );
            })}
        </div>
    );
}
