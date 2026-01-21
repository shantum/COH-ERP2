/**
 * Mode Selector for Inward Hub
 * Displays cards for each inward type with pending counts
 */

import { useQuery } from '@tanstack/react-query';
import { useServerFn } from '@tanstack/react-start';
import { getPendingSources } from '../../server/functions/returns';
import { Package, Factory, RotateCcw, Truck, RefreshCw, Wrench } from 'lucide-react';
import type { PendingSourcesResponse } from '../../server/functions/returns';

export type InwardMode = 'production' | 'returns' | 'rto' | 'repacking' | 'adjustments';

interface ModeSelectorProps {
    onSelectMode: (mode: InwardMode) => void;
}

interface ModeConfig {
    id: InwardMode;
    title: string;
    icon: React.ComponentType<{ size?: number; className?: string }>;
    color: string;
    bgColor: string;
    borderColor: string;
    hoverBorder: string;
    description: string;
}

const MODES: ModeConfig[] = [
    {
        id: 'production',
        title: 'Production',
        icon: Factory,
        color: 'text-blue-600',
        bgColor: 'bg-blue-50',
        borderColor: 'border-blue-200',
        hoverBorder: 'hover:border-blue-400',
        description: 'Receive finished goods from production batches',
    },
    {
        id: 'returns',
        title: 'Returns',
        icon: RotateCcw,
        color: 'text-orange-600',
        bgColor: 'bg-orange-50',
        borderColor: 'border-orange-200',
        hoverBorder: 'hover:border-orange-400',
        description: 'Process customer return shipments',
    },
    {
        id: 'rto',
        title: 'RTO',
        icon: Truck,
        color: 'text-purple-600',
        bgColor: 'bg-purple-50',
        borderColor: 'border-purple-200',
        hoverBorder: 'hover:border-purple-400',
        description: 'Receive Return-to-Origin packages',
    },
    {
        id: 'repacking',
        title: 'Repacking / QC',
        icon: RefreshCw,
        color: 'text-green-600',
        bgColor: 'bg-green-50',
        borderColor: 'border-green-200',
        hoverBorder: 'hover:border-green-400',
        description: 'QC and restock returned items',
    },
    {
        id: 'adjustments',
        title: 'Adjustments',
        icon: Wrench,
        color: 'text-gray-600',
        bgColor: 'bg-gray-50',
        borderColor: 'border-gray-200',
        hoverBorder: 'hover:border-gray-400',
        description: 'Manual stock adjustments and corrections',
    },
];

export default function ModeSelector({ onSelectMode }: ModeSelectorProps) {
    const getPendingSourcesFn = useServerFn(getPendingSources);

    const { data: pendingSources } = useQuery<PendingSourcesResponse>({
        queryKey: ['pending-sources'],
        queryFn: () => getPendingSourcesFn(),
        refetchInterval: 30000,
    });

    const getCount = (mode: InwardMode): number => {
        if (!pendingSources?.counts) return 0;
        switch (mode) {
            case 'production': return pendingSources.counts.repacking; // Production count from repacking
            case 'returns': return pendingSources.counts.returns;
            case 'rto': return pendingSources.counts.rto;
            case 'repacking': return pendingSources.counts.repacking;
            case 'adjustments': return 0; // Adjustments don't have pending items
            default: return 0;
        }
    };

    const getUrgentCount = (mode: InwardMode): number | undefined => {
        if (mode === 'rto' && pendingSources?.counts?.rtoUrgent) {
            return pendingSources.counts.rtoUrgent;
        }
        return undefined;
    };

    return (
        <div className="max-w-4xl mx-auto py-8 px-4">
            <div className="text-center mb-8">
                <Package className="mx-auto text-blue-600" size={48} />
                <h1 className="text-2xl font-bold mt-4">Inward Hub</h1>
                <p className="text-gray-600 mt-2">Select an inward type to begin scanning</p>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                {MODES.map((mode) => {
                    const Icon = mode.icon;
                    const count = getCount(mode.id);
                    const urgentCount = getUrgentCount(mode.id);

                    return (
                        <button
                            key={mode.id}
                            onClick={() => onSelectMode(mode.id)}
                            className={`relative p-6 rounded-xl border-2 ${mode.borderColor} ${mode.bgColor} ${mode.hoverBorder} transition-all hover:shadow-md text-left`}
                        >
                            <div className="flex items-start justify-between mb-3">
                                <Icon size={28} className={mode.color} />
                                {count > 0 && (
                                    <span className={`px-2.5 py-1 rounded-full text-sm font-semibold ${mode.bgColor} ${mode.color} border ${mode.borderColor}`}>
                                        {count}
                                    </span>
                                )}
                            </div>

                            <h3 className="text-lg font-semibold text-gray-900 mb-1">
                                {mode.title}
                            </h3>
                            <p className="text-sm text-gray-600">
                                {mode.description}
                            </p>

                            {urgentCount !== undefined && urgentCount > 0 && (
                                <span className="absolute -top-2 -right-2 w-6 h-6 bg-red-500 text-white text-xs font-bold rounded-full flex items-center justify-center">
                                    {urgentCount}
                                </span>
                            )}
                        </button>
                    );
                })}
            </div>
        </div>
    );
}
