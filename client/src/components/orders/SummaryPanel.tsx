/**
 * SummaryPanel component
 * Displays summary statistics for shipped and archived orders
 */

import { AlertCircle } from 'lucide-react';
import type { ShippedSummary, ArchivedAnalytics } from '../../types';

interface ShippedSummaryPanelProps {
  type: 'shipped';
  data: ShippedSummary | null;
  isLoading?: boolean;
  onFilterClick?: (filter: string) => void;
}

interface ArchivedAnalyticsPanelProps {
  type: 'archived';
  data: ArchivedAnalytics | null;
  isLoading?: boolean;
  days: number;
  onDaysChange?: (days: number) => void;
}

type SummaryPanelProps = ShippedSummaryPanelProps | ArchivedAnalyticsPanelProps;

export function SummaryPanel(props: SummaryPanelProps) {
  if (props.type === 'shipped') {
    return <ShippedSummaryPanel {...props} />;
  }
  return <ArchivedAnalyticsPanel {...props} />;
}

function ShippedSummaryPanel({ data, isLoading, onFilterClick }: ShippedSummaryPanelProps) {
  if (isLoading) {
    return (
      <div className="bg-white rounded-lg border p-4 mb-4">
        <div className="flex items-center gap-4 animate-pulse">
          {[1, 2, 3, 4].map((i) => (
            <div key={i} className="flex-1 h-16 bg-gray-100 rounded" />
          ))}
        </div>
      </div>
    );
  }

  if (!data) return null;

  const stats = [
    { label: 'In Transit', value: data.inTransit, color: 'bg-blue-100 text-blue-700', icon: '📦' },
    { label: 'Delivered', value: data.delivered, color: 'bg-green-100 text-green-700', icon: '✅' },
    { label: 'Delayed', value: data.delayed, color: 'bg-amber-100 text-amber-700', icon: '⚠️' },
    { label: 'RTO', value: data.rto, color: 'bg-red-100 text-red-700', icon: '🔙' },
  ];

  return (
    <div className="bg-white rounded-lg border p-4 mb-4">
      <div className="flex items-center gap-4">
        {stats.map((stat) => (
          <button
            key={stat.label}
            onClick={() => onFilterClick?.(stat.label.toLowerCase().replace(' ', '_'))}
            className={`flex-1 p-3 rounded-lg ${stat.color} hover:opacity-80 transition-opacity cursor-pointer`}
          >
            <div className="flex items-center justify-between">
              <span className="text-sm font-medium">{stat.label}</span>
              <span className="text-lg">{stat.icon}</span>
            </div>
            <div className="text-2xl font-bold mt-1">{stat.value}</div>
          </button>
        ))}
      </div>

      {data.needsAttention > 0 && (
        <button
          onClick={() => onFilterClick?.('needs_attention')}
          className="mt-3 w-full flex items-center justify-center gap-2 py-2 px-4 bg-amber-50 border border-amber-200 rounded-lg text-amber-700 hover:bg-amber-100 transition-colors"
        >
          <AlertCircle size={16} />
          <span className="text-sm font-medium">
            {data.needsAttention} order{data.needsAttention !== 1 ? 's' : ''} need attention
          </span>
        </button>
      )}
    </div>
  );
}

function ArchivedAnalyticsPanel({ data, isLoading, days, onDaysChange }: ArchivedAnalyticsPanelProps) {
  if (isLoading) {
    return (
      <div className="bg-white rounded-lg border p-4 mb-4">
        <div className="animate-pulse">
          <div className="h-6 bg-gray-100 rounded w-1/4 mb-4" />
          <div className="flex items-center gap-4">
            {[1, 2, 3, 4].map((i) => (
              <div key={i} className="flex-1 h-16 bg-gray-100 rounded" />
            ))}
          </div>
        </div>
      </div>
    );
  }

  if (!data) return null;

  const formatCurrency = (value: number) => {
    if (value >= 100000) {
      return `₹${(value / 100000).toFixed(1)}L`;
    } else if (value >= 1000) {
      return `₹${(value / 1000).toFixed(0)}k`;
    }
    return `₹${value.toFixed(0)}`;
  };

  return (
    <div className="bg-white rounded-lg border p-4 mb-4">
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <span className="text-lg">📊</span>
          <span className="font-medium text-gray-700">Period:</span>
          <select
            value={days}
            onChange={(e) => onDaysChange?.(Number(e.target.value))}
            className="text-sm border rounded px-2 py-1 bg-white"
          >
            <option value={30}>Last 30 days</option>
            <option value={60}>Last 60 days</option>
            <option value={90}>Last 90 days</option>
            <option value={180}>Last 180 days</option>
            <option value={365}>Last 365 days</option>
          </select>
        </div>
        <button className="text-sm text-blue-600 hover:text-blue-800 flex items-center gap-1">
          Export CSV
        </button>
      </div>

      <div className="grid grid-cols-4 gap-4 mb-4">
        <div className="p-3 bg-gray-50 rounded-lg">
          <div className="text-sm text-gray-500">Total Sales</div>
          <div className="text-xl font-bold text-gray-900">{formatCurrency(data.totalRevenue)}</div>
        </div>
        <div className="p-3 bg-gray-50 rounded-lg">
          <div className="text-sm text-gray-500">Orders</div>
          <div className="text-xl font-bold text-gray-900">{data.orderCount.toLocaleString()}</div>
        </div>
        <div className="p-3 bg-gray-50 rounded-lg">
          <div className="text-sm text-gray-500">Avg Value</div>
          <div className="text-xl font-bold text-gray-900">{formatCurrency(data.avgValue)}</div>
        </div>
        <div className="p-3 bg-gray-50 rounded-lg">
          <div className="text-sm text-gray-500">Top Product</div>
          <div className="text-sm font-bold text-gray-900 truncate" title={data.topProducts[0]?.name}>
            {data.topProducts[0]?.name || '-'} ({data.topProducts[0]?.units || 0})
          </div>
        </div>
      </div>

      {data.channelSplit.length > 0 && (
        <div className="text-sm text-gray-500">
          Channel:{' '}
          {data.channelSplit.map((ch, i) => (
            <span key={ch.channel}>
              {i > 0 && ' • '}
              <span className="capitalize">{ch.channel.replace('_', ' ')}</span> {ch.percentage}%
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

export default SummaryPanel;
