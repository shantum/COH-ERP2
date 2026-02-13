import { useRef } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Check, X, Loader2, SkipForward, Circle } from 'lucide-react';
import {
    Dialog,
    DialogContent,
    DialogHeader,
    DialogTitle,
    DialogDescription,
    DialogFooter,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { getCycleProgress } from '@/server/functions/admin';
import type { CycleStep, CycleProgressState } from './sheetJobTypes';

interface IngestionCycleModalProps {
    open: boolean;
    type: 'inward' | 'outward';
    onClose: () => void;
}

function formatDuration(ms: number): string {
    if (ms < 1000) return `${ms}ms`;
    if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`;
    return `${Math.floor(ms / 60_000)}m ${Math.round((ms % 60_000) / 1000)}s`;
}

function StepIcon({ status }: { status: CycleStep['status'] }) {
    switch (status) {
        case 'done':
            return <Check className="h-4 w-4 text-green-500 shrink-0" />;
        case 'running':
            return <Loader2 className="h-4 w-4 text-blue-500 animate-spin shrink-0" />;
        case 'failed':
            return <X className="h-4 w-4 text-red-500 shrink-0" />;
        case 'skipped':
            return <SkipForward className="h-4 w-4 text-muted-foreground shrink-0" />;
        case 'pending':
        default:
            return <Circle className="h-4 w-4 text-muted-foreground/40 shrink-0" />;
    }
}

function StepRow({ step }: { step: CycleStep }) {
    return (
        <div className="space-y-0.5">
            <div className="flex items-center gap-3 py-1">
                <StepIcon status={step.status} />
                <span className={`text-sm flex-1 ${step.status === 'pending' ? 'text-muted-foreground' : step.status === 'skipped' ? 'text-muted-foreground' : ''}`}>
                    {step.name}
                </span>
                {step.detail && (
                    <span className="text-xs text-muted-foreground font-mono">[{step.detail}]</span>
                )}
                {step.durationMs != null && (
                    <span className="text-xs text-muted-foreground font-mono w-16 text-right">
                        {formatDuration(step.durationMs)}
                    </span>
                )}
            </div>
            {step.status === 'failed' && step.error && (
                <div className="ml-7 text-xs text-red-500 font-mono break-all">{step.error}</div>
            )}
        </div>
    );
}

export function IngestionCycleModal({ open, type, onClose }: IngestionCycleModalProps) {
    const queryClient = useQueryClient();
    // Track whether we've ever seen isRunning=true for this session
    const hasSeenRunning = useRef(false);

    const { data: progressData } = useQuery({
        queryKey: ['cycleProgress'],
        queryFn: async () => {
            const result = await getCycleProgress();
            if (!result.success) return null;
            return result.data as unknown as CycleProgressState;
        },
        enabled: open,
        refetchInterval: (query) => {
            const data = query.state.data;
            // Keep polling until we see the cycle start AND finish
            if (!hasSeenRunning.current) return 2000;
            if (data?.isRunning) return 2000;
            // One final poll after it finishes
            return false;
        },
    });

    // Track if we've seen the running state (to ignore stale data)
    if (progressData?.isRunning) {
        hasSeenRunning.current = true;
    }

    const isRunning = progressData?.isRunning ?? false;
    const hasValidData = hasSeenRunning.current && progressData != null;
    const steps = hasValidData ? (progressData?.steps ?? []) : [];
    const isDone = hasValidData && !isRunning && steps.length > 0;

    // Invalidate job queries when cycle finishes
    const handleClose = () => {
        hasSeenRunning.current = false;
        if (isDone) {
            queryClient.invalidateQueries({ queryKey: ['backgroundJobs'] });
            queryClient.invalidateQueries({ queryKey: ['sheetOffloadStatus'] });
            queryClient.invalidateQueries({ queryKey: ['sheetMonitorStats'] });
        }
        queryClient.removeQueries({ queryKey: ['cycleProgress'] });
        onClose();
    };

    return (
        <Dialog open={open} onOpenChange={(isOpen) => {
            // Only allow closing when not running
            if (!isOpen && !isRunning) handleClose();
        }}>
            <DialogContent
                className="sm:max-w-md"
                onPointerDownOutside={(e) => {
                    if (isRunning) e.preventDefault();
                }}
                onEscapeKeyDown={(e) => {
                    if (isRunning) e.preventDefault();
                }}
            >
                <DialogHeader>
                    <DialogTitle>
                        {type === 'inward' ? 'Inward' : 'Outward'} Ingestion Cycle
                    </DialogTitle>
                    <DialogDescription>
                        {isRunning ? 'Running pipeline...' : isDone ? 'Pipeline complete' : 'Starting...'}
                    </DialogDescription>
                </DialogHeader>

                <div className="space-y-0.5 max-h-[400px] overflow-y-auto py-2">
                    {steps.length === 0 && (
                        <div className="flex items-center gap-2 text-sm text-muted-foreground py-4 justify-center">
                            <Loader2 className="h-4 w-4 animate-spin" />
                            Waiting for pipeline to start...
                        </div>
                    )}
                    {steps.map((step) => (
                        <StepRow key={step.name} step={step} />
                    ))}
                </div>

                {isDone && progressData?.totalDurationMs != null && (
                    <DialogFooter className="flex-row items-center justify-between sm:justify-between">
                        <span className="text-sm text-muted-foreground">
                            Total: {formatDuration(progressData.totalDurationMs)}
                        </span>
                        <Button variant="outline" size="sm" onClick={handleClose}>
                            Close
                        </Button>
                    </DialogFooter>
                )}
            </DialogContent>
        </Dialog>
    );
}
