/**
 * ReturnPrimeAnalytics - Analytics charts for Return Prime dashboard
 *
 * Displays:
 * - Requests over time (line chart)
 * - Reasons breakdown (pie/donut chart)
 * - Refund methods distribution (bar chart)
 * - Top returned products table
 */

import { useMemo } from 'react';
import {
  LineChart,
  Line,
  BarChart,
  Bar,
  PieChart,
  Pie,
  Cell,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Legend,
} from 'recharts';
import { TrendingUp, PieChartIcon, BarChart3, Package } from 'lucide-react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../ui/card';
import type { ReturnPrimeRequest } from '@coh/shared/schemas/returnPrime';
import { formatDate, formatShortDate } from '../../utils/dateFormatters';

// ============================================
// DATE HELPERS (analytics-specific)
// ============================================

/** Format a date string as yyyy-MM-dd for use as a map key */
function formatDateForKey(dateString: string): string {
  const date = new Date(dateString);
  return date.toISOString().split('T')[0];
}

// ============================================
// TYPES
// ============================================

interface Props {
  requests: ReturnPrimeRequest[];
  isLoading: boolean;
}

interface TimeSeriesPoint {
  date: string;
  total: number;
  returns: number;
  exchanges: number;
}

interface ReasonData {
  reason: string;
  count: number;
  percentage: number;
}

interface RefundMethodData {
  method: string;
  count: number;
  amount: number;
}

interface TopProduct {
  title: string;
  sku: string;
  count: number;
  totalValue: number;
}

// ============================================
// CONSTANTS
// ============================================

const CHART_COLORS = {
  primary: '#3B82F6',
  secondary: '#8B5CF6',
  success: '#10B981',
  warning: '#F59E0B',
  danger: '#EF4444',
  info: '#06B6D4',
  pink: '#EC4899',
  slate: '#64748B',
};

const PIE_COLORS = [
  CHART_COLORS.primary,
  CHART_COLORS.secondary,
  CHART_COLORS.success,
  CHART_COLORS.warning,
  CHART_COLORS.danger,
  CHART_COLORS.info,
  CHART_COLORS.pink,
  CHART_COLORS.slate,
];

// ============================================
// DATA PROCESSING HOOKS
// ============================================

function useTimeSeriesData(requests: ReturnPrimeRequest[]): TimeSeriesPoint[] {
  return useMemo(() => {
    if (requests.length === 0) return [];

    const dateMap = new Map<string, { total: number; returns: number; exchanges: number }>();

    requests.forEach((req) => {
      const date = formatDateForKey(req.created_at);
      const existing = dateMap.get(date) || { total: 0, returns: 0, exchanges: 0 };

      existing.total += 1;
      if (req.request_type === 'exchange') {
        existing.exchanges += 1;
      } else {
        existing.returns += 1;
      }

      dateMap.set(date, existing);
    });

    return Array.from(dateMap.entries())
      .map(([date, data]) => ({
        date,
        ...data,
      }))
      .sort((a, b) => a.date.localeCompare(b.date));
  }, [requests]);
}

function useReasonsData(requests: ReturnPrimeRequest[]): ReasonData[] {
  return useMemo(() => {
    if (requests.length === 0) return [];

    const reasonMap = new Map<string, number>();

    requests.forEach((req) => {
      req.line_items?.forEach((item) => {
        const reason = item.reason || 'Not specified';
        reasonMap.set(reason, (reasonMap.get(reason) || 0) + 1);
      });
    });

    const total = Array.from(reasonMap.values()).reduce((sum, count) => sum + count, 0);

    return Array.from(reasonMap.entries())
      .map(([reason, count]) => ({
        reason: reason.length > 25 ? reason.substring(0, 25) + '...' : reason,
        count,
        percentage: Math.round((count / total) * 100),
      }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 8);
  }, [requests]);
}

function useRefundMethodsData(requests: ReturnPrimeRequest[]): RefundMethodData[] {
  return useMemo(() => {
    if (requests.length === 0) return [];

    const methodMap = new Map<string, { count: number; amount: number }>();

    requests.forEach((req) => {
      req.line_items?.forEach((item) => {
        const method = item.refund?.actual_mode || item.refund?.requested_mode || 'Unknown';
        if (method && item.refund?.status === 'refunded') {
          const existing = methodMap.get(method) || { count: 0, amount: 0 };
          existing.count += 1;
          existing.amount += item.refund.refunded_amount?.shop_money?.amount || 0;
          methodMap.set(method, existing);
        }
      });
    });

    return Array.from(methodMap.entries())
      .map(([method, data]) => ({
        method: method.charAt(0).toUpperCase() + method.slice(1).replace(/_/g, ' '),
        count: data.count,
        amount: data.amount,
      }))
      .sort((a, b) => b.count - a.count);
  }, [requests]);
}

function useTopProductsData(requests: ReturnPrimeRequest[]): TopProduct[] {
  return useMemo(() => {
    if (requests.length === 0) return [];

    const productMap = new Map<string, { title: string; sku: string; count: number; totalValue: number }>();

    requests.forEach((req) => {
      req.line_items?.forEach((item) => {
        const product = item.original_product;
        if (product) {
          const key = product.sku || product.title || 'Unknown';
          const existing = productMap.get(key) || {
            title: product.title || 'Unknown',
            sku: product.sku || '-',
            count: 0,
            totalValue: 0,
          };
          existing.count += item.quantity;
          existing.totalValue += item.shop_price?.actual_amount || 0;
          productMap.set(key, existing);
        }
      });
    });

    return Array.from(productMap.values())
      .sort((a, b) => b.count - a.count)
      .slice(0, 10);
  }, [requests]);
}

// ============================================
// CHART COMPONENTS
// ============================================

function RequestsOverTimeChart({ data }: { data: TimeSeriesPoint[] }) {
  if (data.length === 0) {
    return (
      <div className="h-64 flex items-center justify-center text-gray-500">
        No data available for the selected period
      </div>
    );
  }

  return (
    <ResponsiveContainer width="100%" height={280}>
      <LineChart data={data} margin={{ top: 5, right: 20, left: 0, bottom: 5 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="#E5E7EB" />
        <XAxis
          dataKey="date"
          tick={{ fontSize: 11 }}
          stroke="#9CA3AF"
          tickFormatter={(value) => formatShortDate(value)}
        />
        <YAxis tick={{ fontSize: 11 }} stroke="#9CA3AF" allowDecimals={false} />
        <Tooltip
          labelFormatter={(value) => formatDate(value as string)}
          contentStyle={{
            backgroundColor: 'white',
            border: '1px solid #E5E7EB',
            borderRadius: '8px',
            fontSize: '12px',
          }}
        />
        <Legend />
        <Line
          type="monotone"
          dataKey="total"
          name="Total"
          stroke={CHART_COLORS.slate}
          strokeWidth={2}
          dot={false}
        />
        <Line
          type="monotone"
          dataKey="returns"
          name="Returns"
          stroke={CHART_COLORS.primary}
          strokeWidth={2}
          dot={false}
        />
        <Line
          type="monotone"
          dataKey="exchanges"
          name="Exchanges"
          stroke={CHART_COLORS.secondary}
          strokeWidth={2}
          dot={false}
        />
      </LineChart>
    </ResponsiveContainer>
  );
}

function ReasonsBreakdownChart({ data }: { data: ReasonData[] }) {
  if (data.length === 0) {
    return (
      <div className="h-64 flex items-center justify-center text-gray-500">
        No reason data available
      </div>
    );
  }

  return (
    <ResponsiveContainer width="100%" height={280}>
      <PieChart>
        <Pie
          data={data.map(d => ({ reason: d.reason, count: d.count, percentage: d.percentage }))}
          dataKey="count"
          nameKey="reason"
          cx="50%"
          cy="50%"
          outerRadius={100}
          innerRadius={50}
          label={({ payload }) => `${(payload as ReasonData).percentage}%`}
          labelLine={false}
        >
          {data.map((_, index) => (
            <Cell key={`cell-${index}`} fill={PIE_COLORS[index % PIE_COLORS.length]} />
          ))}
        </Pie>
        <Tooltip
          formatter={(value, name) => [`${value} items`, name]}
          contentStyle={{
            backgroundColor: 'white',
            border: '1px solid #E5E7EB',
            borderRadius: '8px',
            fontSize: '12px',
          }}
        />
        <Legend
          layout="vertical"
          verticalAlign="middle"
          align="right"
          wrapperStyle={{ fontSize: '11px' }}
        />
      </PieChart>
    </ResponsiveContainer>
  );
}

function RefundMethodsChart({ data }: { data: RefundMethodData[] }) {
  if (data.length === 0) {
    return (
      <div className="h-64 flex items-center justify-center text-gray-500">
        No refund data available
      </div>
    );
  }

  return (
    <ResponsiveContainer width="100%" height={280}>
      <BarChart data={data} layout="vertical" margin={{ top: 5, right: 20, left: 80, bottom: 5 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="#E5E7EB" />
        <XAxis type="number" tick={{ fontSize: 11 }} stroke="#9CA3AF" />
        <YAxis
          type="category"
          dataKey="method"
          tick={{ fontSize: 11 }}
          stroke="#9CA3AF"
          width={75}
        />
        <Tooltip
          formatter={(value, name) => {
            if (name === 'count') return [`${value} refunds`, 'Count'];
            if (name === 'amount') return [`₹${(value as number).toLocaleString()}`, 'Amount'];
            return [value, name];
          }}
          contentStyle={{
            backgroundColor: 'white',
            border: '1px solid #E5E7EB',
            borderRadius: '8px',
            fontSize: '12px',
          }}
        />
        <Legend />
        <Bar dataKey="count" name="Count" fill={CHART_COLORS.primary} radius={[0, 4, 4, 0]} />
      </BarChart>
    </ResponsiveContainer>
  );
}

function TopProductsTable({ data }: { data: TopProduct[] }) {
  if (data.length === 0) {
    return (
      <div className="h-64 flex items-center justify-center text-gray-500">
        No product data available
      </div>
    );
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full">
        <thead>
          <tr className="border-b border-gray-200">
            <th className="text-left py-2 px-3 text-xs font-semibold text-gray-600">#</th>
            <th className="text-left py-2 px-3 text-xs font-semibold text-gray-600">Product</th>
            <th className="text-left py-2 px-3 text-xs font-semibold text-gray-600">SKU</th>
            <th className="text-right py-2 px-3 text-xs font-semibold text-gray-600">Returns</th>
            <th className="text-right py-2 px-3 text-xs font-semibold text-gray-600">Value</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-gray-100">
          {data.map((product, index) => (
            <tr key={product.sku} className="hover:bg-gray-50">
              <td className="py-2 px-3 text-sm text-gray-500">{index + 1}</td>
              <td className="py-2 px-3">
                <p className="text-sm font-medium text-gray-900 truncate max-w-[200px]">
                  {product.title}
                </p>
              </td>
              <td className="py-2 px-3">
                <code className="text-xs text-gray-500 bg-gray-100 px-1.5 py-0.5 rounded">
                  {product.sku}
                </code>
              </td>
              <td className="py-2 px-3 text-right text-sm font-medium">{product.count}</td>
              <td className="py-2 px-3 text-right text-sm text-gray-600">
                ₹{product.totalValue.toLocaleString()}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ============================================
// MAIN COMPONENT
// ============================================

export function ReturnPrimeAnalytics({ requests, isLoading }: Props) {
  const timeSeriesData = useTimeSeriesData(requests);
  const reasonsData = useReasonsData(requests);
  const refundMethodsData = useRefundMethodsData(requests);
  const topProductsData = useTopProductsData(requests);

  if (isLoading) {
    return (
      <div className="space-y-4">
        {[1, 2, 3, 4].map((i) => (
          <div key={i} className="bg-white rounded-lg border border-gray-200 p-4">
            <div className="h-8 w-48 bg-gray-100 rounded animate-pulse mb-4" />
            <div className="h-64 bg-gray-50 rounded animate-pulse" />
          </div>
        ))}
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Requests Over Time */}
      <Card>
        <CardHeader className="pb-2">
          <div className="flex items-center gap-2">
            <TrendingUp className="w-4 h-4 text-gray-500" />
            <CardTitle className="text-base">Requests Over Time</CardTitle>
          </div>
          <CardDescription>Daily return and exchange requests</CardDescription>
        </CardHeader>
        <CardContent>
          <RequestsOverTimeChart data={timeSeriesData} />
        </CardContent>
      </Card>

      {/* Two Column Layout */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* Reasons Breakdown */}
        <Card>
          <CardHeader className="pb-2">
            <div className="flex items-center gap-2">
              <PieChartIcon className="w-4 h-4 text-gray-500" />
              <CardTitle className="text-base">Reasons Breakdown</CardTitle>
            </div>
            <CardDescription>Most common return reasons</CardDescription>
          </CardHeader>
          <CardContent>
            <ReasonsBreakdownChart data={reasonsData} />
          </CardContent>
        </Card>

        {/* Refund Methods */}
        <Card>
          <CardHeader className="pb-2">
            <div className="flex items-center gap-2">
              <BarChart3 className="w-4 h-4 text-gray-500" />
              <CardTitle className="text-base">Refund Methods</CardTitle>
            </div>
            <CardDescription>Distribution by refund method</CardDescription>
          </CardHeader>
          <CardContent>
            <RefundMethodsChart data={refundMethodsData} />
          </CardContent>
        </Card>
      </div>

      {/* Top Returned Products */}
      <Card>
        <CardHeader className="pb-2">
          <div className="flex items-center gap-2">
            <Package className="w-4 h-4 text-gray-500" />
            <CardTitle className="text-base">Top Returned Products</CardTitle>
          </div>
          <CardDescription>Products with highest return counts</CardDescription>
        </CardHeader>
        <CardContent>
          <TopProductsTable data={topProductsData} />
        </CardContent>
      </Card>
    </div>
  );
}
