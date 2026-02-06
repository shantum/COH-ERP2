/**
 * ReturnPrimeStatsCards - Summary statistics for Return Prime dashboard
 *
 * Displays key metrics: total requests, returns, exchanges, pending, approved, received, refunded
 */

import { Package, RotateCcw, ArrowLeftRight, Clock, CheckCircle, PackageCheck, Wallet } from 'lucide-react';
import type { ReturnPrimeStats } from '@coh/shared/schemas/returnPrime';

/** Numeric stat keys from ReturnPrimeStats (excludes totalValue which needs currency formatting) */
type NumericStatKey = 'total' | 'returns' | 'exchanges' | 'pending' | 'approved' | 'received' | 'refunded';

interface StatCardConfig {
  key: NumericStatKey;
  label: string;
  icon: React.ElementType;
  bgColor: string;
  iconColor: string;
}

interface Props {
  stats?: ReturnPrimeStats;
  isLoading: boolean;
}

const STAT_CARDS: readonly StatCardConfig[] = [
  { key: 'total', label: 'Total Requests', icon: Package, bgColor: 'bg-slate-50', iconColor: 'text-slate-600' },
  { key: 'returns', label: 'Returns', icon: RotateCcw, bgColor: 'bg-blue-50', iconColor: 'text-blue-600' },
  { key: 'exchanges', label: 'Exchanges', icon: ArrowLeftRight, bgColor: 'bg-purple-50', iconColor: 'text-purple-600' },
  { key: 'pending', label: 'Pending', icon: Clock, bgColor: 'bg-amber-50', iconColor: 'text-amber-600' },
  { key: 'approved', label: 'Approved', icon: CheckCircle, bgColor: 'bg-green-50', iconColor: 'text-green-600' },
  { key: 'received', label: 'Received', icon: PackageCheck, bgColor: 'bg-emerald-50', iconColor: 'text-emerald-600' },
  { key: 'refunded', label: 'Refunded', icon: Wallet, bgColor: 'bg-teal-50', iconColor: 'text-teal-600' },
];

export function ReturnPrimeStatsCards({ stats, isLoading }: Props) {
  return (
    <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-7 gap-3">
      {STAT_CARDS.map(({ key, label, icon: Icon, bgColor, iconColor }) => (
        <div
          key={key}
          className="bg-white rounded-lg border border-gray-200 p-3 sm:p-4"
        >
          <div className="flex items-center gap-2 mb-2">
            <div className={`p-1.5 rounded-md ${bgColor}`}>
              <Icon className={`w-4 h-4 ${iconColor}`} />
            </div>
            <span className="text-xs text-gray-500 font-medium">{label}</span>
          </div>
          {isLoading ? (
            <div className="h-7 bg-gray-100 rounded animate-pulse" />
          ) : (
            <p className="text-xl sm:text-2xl font-bold text-gray-900">
              {stats?.[key]?.toLocaleString() ?? 0}
            </p>
          )}
        </div>
      ))}
    </div>
  );
}
