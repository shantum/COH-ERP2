/**
 * Header component for active inward mode
 * Shows mode indicator and switch mode button
 */

import { ArrowLeft, Factory, RotateCcw, Truck, RefreshCw, Wrench } from 'lucide-react';
import type { InwardMode } from './ModeSelector';

interface InwardModeHeaderProps {
    mode: InwardMode;
    onExitMode: () => void;
    todayTotal?: number;
}

const MODE_CONFIG: Record<InwardMode, {
    title: string;
    icon: React.ComponentType<{ size?: number; className?: string }>;
    bgColor: string;
    borderColor: string;
    textColor: string;
    iconColor: string;
}> = {
    production: {
        title: 'Production Inward',
        icon: Factory,
        bgColor: 'bg-blue-50',
        borderColor: 'border-blue-200',
        textColor: 'text-blue-900',
        iconColor: 'text-blue-600',
    },
    returns: {
        title: 'Returns Inward',
        icon: RotateCcw,
        bgColor: 'bg-orange-50',
        borderColor: 'border-orange-200',
        textColor: 'text-orange-900',
        iconColor: 'text-orange-600',
    },
    rto: {
        title: 'RTO Inward',
        icon: Truck,
        bgColor: 'bg-purple-50',
        borderColor: 'border-purple-200',
        textColor: 'text-purple-900',
        iconColor: 'text-purple-600',
    },
    repacking: {
        title: 'Repacking / QC',
        icon: RefreshCw,
        bgColor: 'bg-green-50',
        borderColor: 'border-green-200',
        textColor: 'text-green-900',
        iconColor: 'text-green-600',
    },
    adjustments: {
        title: 'Stock Adjustments',
        icon: Wrench,
        bgColor: 'bg-gray-50',
        borderColor: 'border-gray-200',
        textColor: 'text-gray-900',
        iconColor: 'text-gray-600',
    },
};

export default function InwardModeHeader({ mode, onExitMode, todayTotal = 0 }: InwardModeHeaderProps) {
    const config = MODE_CONFIG[mode];
    const Icon = config.icon;

    return (
        <div className={`${config.bgColor} border-b ${config.borderColor} px-4 py-3`}>
            <div className="max-w-7xl mx-auto flex items-center justify-between">
                <div className="flex items-center gap-3">
                    <Icon size={24} className={config.iconColor} />
                    <h1 className={`text-xl font-bold ${config.textColor}`}>
                        {config.title}
                    </h1>
                </div>

                <div className="flex items-center gap-4">
                    <div className="bg-white/60 border border-green-200 rounded-lg px-3 py-1.5">
                        <span className="text-green-600 text-sm">Today:</span>{' '}
                        <span className="text-green-700 font-bold">+{todayTotal}</span>
                        <span className="text-green-600 text-sm ml-1">pcs</span>
                    </div>

                    <button
                        onClick={onExitMode}
                        className="flex items-center gap-2 px-4 py-2 text-gray-600 hover:text-gray-900 hover:bg-white/50 rounded-lg transition-colors"
                    >
                        <ArrowLeft size={18} />
                        <span className="font-medium">Switch Mode</span>
                    </button>
                </div>
            </div>
        </div>
    );
}
