/**
 * BomCostSummary - Compact cost breakdown card
 *
 * Displays fabric/trim/service costs with visual indicators.
 */

import { Scissors, Package, Wrench } from 'lucide-react';
import type { BomCostSummaryProps } from './types';

function formatCurrency(value: number): string {
    return value.toLocaleString('en-IN', {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
    });
}

export function BomCostSummary({ costs, compact = false }: BomCostSummaryProps) {
    if (compact) {
        return (
            <div className="flex items-center gap-4 text-sm">
                <CostPill
                    icon={<Scissors size={12} />}
                    label="Fabric"
                    value={costs.fabricCost}
                    color="purple"
                />
                <CostPill
                    icon={<Package size={12} />}
                    label="Trims"
                    value={costs.trimCost}
                    color="amber"
                />
                <CostPill
                    icon={<Wrench size={12} />}
                    label="Services"
                    value={costs.serviceCost}
                    color="teal"
                />
                <div className="h-4 w-px bg-gray-300" />
                <span className="font-semibold text-gray-900">
                    Total: ₹{formatCurrency(costs.total)}
                </span>
            </div>
        );
    }

    return (
        <div className="bg-gradient-to-r from-slate-50 to-slate-100 rounded-lg p-4 border border-slate-200">
            <div className="flex items-center justify-between mb-3">
                <h4 className="text-sm font-medium text-gray-700">Cost Summary</h4>
                <span className="text-lg font-bold text-gray-900">
                    ₹{formatCurrency(costs.total)}
                </span>
            </div>
            <div className="grid grid-cols-3 gap-4">
                <CostCard
                    icon={<Scissors size={14} className="text-purple-600" />}
                    label="Fabric"
                    value={costs.fabricCost}
                    bgColor="bg-purple-50"
                    borderColor="border-purple-200"
                />
                <CostCard
                    icon={<Package size={14} className="text-amber-600" />}
                    label="Trims"
                    value={costs.trimCost}
                    bgColor="bg-amber-50"
                    borderColor="border-amber-200"
                />
                <CostCard
                    icon={<Wrench size={14} className="text-teal-600" />}
                    label="Services"
                    value={costs.serviceCost}
                    bgColor="bg-teal-50"
                    borderColor="border-teal-200"
                />
            </div>
        </div>
    );
}

interface CostCardProps {
    icon: React.ReactNode;
    label: string;
    value: number;
    bgColor: string;
    borderColor: string;
}

function CostCard({ icon, label, value, bgColor, borderColor }: CostCardProps) {
    return (
        <div className={`${bgColor} ${borderColor} border rounded-md p-2`}>
            <div className="flex items-center gap-1.5 mb-1">
                {icon}
                <span className="text-xs text-gray-500">{label}</span>
            </div>
            <p className="text-sm font-semibold text-gray-900 tabular-nums">
                ₹{formatCurrency(value)}
            </p>
        </div>
    );
}

interface CostPillProps {
    icon: React.ReactNode;
    label: string;
    value: number;
    color: 'purple' | 'amber' | 'teal';
}

function CostPill({ icon, label, value, color }: CostPillProps) {
    const colorClasses = {
        purple: 'bg-purple-50 text-purple-700',
        amber: 'bg-amber-50 text-amber-700',
        teal: 'bg-teal-50 text-teal-700',
    };

    return (
        <div className={`flex items-center gap-1.5 px-2 py-1 rounded-md ${colorClasses[color]}`}>
            {icon}
            <span className="text-xs">{label}:</span>
            <span className="font-medium tabular-nums">₹{formatCurrency(value)}</span>
        </div>
    );
}
