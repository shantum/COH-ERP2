import { useState, useMemo, Fragment } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useServerFn } from '@tanstack/react-start';
import { getMonthlyCashFlow, getCashFlowDetail } from '../../server/functions/finance';
import { formatPeriod, LoadingState } from './shared';

type CashFlowMonth = {
  period: string;
  salesRevenue: number;
  salesCount: number;
  refunds: number;
  refundCount: number;
  netSalesRevenue: number;
  incomeLines: { code: string; name: string; amount: number; count: number }[];
  otherIncome: number;
  totalIncome: number;
  expenses: { code: string; name: string; amount: number; count: number }[];
  totalExpenses: number;
  netCashFlow: number;
};

/** Indian FY quarter: Apr=Q1, Jul=Q2, Oct=Q3, Jan=Q4 */
function getFyQuarter(period: string): { fy: string; q: string } {
  const [yearStr, monthStr] = period.split('-');
  const year = parseInt(yearStr, 10);
  const month = parseInt(monthStr, 10);
  const fyStart = month >= 4 ? year : year - 1;
  const q = month >= 4 && month <= 6 ? 'Q1' : month >= 7 && month <= 9 ? 'Q2' : month >= 10 && month <= 12 ? 'Q3' : 'Q4';
  return { fy: `FY${String(fyStart).slice(2)}-${String(fyStart + 1).slice(2)}`, q };
}

function sumMonths(arr: Pick<CashFlowMonth, 'salesRevenue' | 'refunds' | 'otherIncome' | 'totalIncome' | 'totalExpenses' | 'netCashFlow'>[]): { salesRevenue: number; refunds: number; otherIncome: number; totalIncome: number; totalExpenses: number; netCashFlow: number } {
  return {
    salesRevenue: arr.reduce((s, m) => s + m.salesRevenue, 0),
    refunds: arr.reduce((s, m) => s + m.refunds, 0),
    otherIncome: arr.reduce((s, m) => s + m.otherIncome, 0),
    totalIncome: arr.reduce((s, m) => s + m.totalIncome, 0),
    totalExpenses: arr.reduce((s, m) => s + m.totalExpenses, 0),
    netCashFlow: arr.reduce((s, m) => s + m.netCashFlow, 0),
  };
}

/** Merge lines with the same code, summing amount and count */
function mergeLines(lines: { code: string; name: string; amount: number; count: number }[]): { code: string; name: string; amount: number; count: number }[] {
  const map = new Map<string, { code: string; name: string; amount: number; count: number }>();
  for (const l of lines) {
    const existing = map.get(l.code);
    if (existing) {
      existing.amount += l.amount;
      existing.count += l.count;
    } else {
      map.set(l.code, { ...l });
    }
  }
  return Array.from(map.values()).sort((a, b) => b.amount - a.amount);
}

export default function CashFlowTab() {
  const cashFlowFn = useServerFn(getMonthlyCashFlow);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [drilldown, setDrilldown] = useState<string | null>(null);

  const { data, isLoading } = useQuery({
    queryKey: ['finance', 'cashflow'],
    queryFn: () => cashFlowFn(),
    staleTime: 5 * 60 * 1000,
  });

  const [view, setView] = useState<'monthly' | 'quarterly' | 'fy'>('monthly');

  if (isLoading) return <LoadingState />;
  if (!data?.success) return <div className="text-muted-foreground text-center py-8">Failed to load cash flow data</div>;

  const months = data.months;

  const fmt = (n: number) => {
    const sign = n < 0 ? '-' : '';
    return `${sign}Rs ${Math.abs(n).toLocaleString('en-IN', { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`;
  };

  const toggle = (period: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(period)) next.delete(period);
      else next.add(period);
      return next;
    });
  };

  const toggleDrilldown = (key: string) => {
    setDrilldown((prev) => (prev === key ? null : key));
  };

  // Aggregate months into quarterly or FY rows
  const displayRows: CashFlowMonth[] = useMemo(() => {
    if (view === 'monthly') return months;

    const buckets = new Map<string, CashFlowMonth[]>();
    for (const m of months) {
      const { fy, q } = getFyQuarter(m.period);
      const key = view === 'quarterly' ? `${fy}::${q}` : fy;
      if (!buckets.has(key)) buckets.set(key, []);
      buckets.get(key)!.push(m);
    }

    return Array.from(buckets.entries())
      .map(([key, group]) => {
        const totals = sumMonths(group);
        const label = view === 'quarterly'
          ? `${key.split('::')[1]} ${key.split('::')[0]}`
          : key;
        return {
          period: label,
          salesRevenue: totals.salesRevenue,
          salesCount: group.reduce((s, m) => s + m.salesCount, 0),
          refunds: totals.refunds,
          refundCount: group.reduce((s, m) => s + m.refundCount, 0),
          netSalesRevenue: totals.salesRevenue - totals.refunds,
          incomeLines: mergeLines(group.flatMap((m) => m.incomeLines)),
          otherIncome: totals.otherIncome,
          totalIncome: totals.totalIncome,
          expenses: mergeLines(group.flatMap((m) => m.expenses)),
          totalExpenses: totals.totalExpenses,
          netCashFlow: totals.netCashFlow,
        } satisfies CashFlowMonth;
      });
  }, [months, view]);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-lg font-semibold">Cash Flow Statement</h3>
          <p className="text-xs text-muted-foreground">Actual money in/out from posted bank transactions. Click a row to expand.</p>
        </div>
        <div className="flex gap-1 bg-muted rounded-md p-0.5">
          {(['monthly', 'quarterly', 'fy'] as const).map((v) => (
            <button
              key={v}
              onClick={() => { setView(v); setExpanded(new Set()); setDrilldown(null); }}
              className={`px-3 py-1 text-xs font-medium rounded transition-colors ${view === v ? 'bg-background shadow-sm' : 'text-muted-foreground hover:text-foreground'}`}
            >
              {v === 'monthly' ? 'Monthly' : v === 'quarterly' ? 'Quarterly' : 'FY'}
            </button>
          ))}
        </div>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-sm border-collapse">
          <thead>
            <tr className="border-b">
              <th className="text-left py-2 px-3 font-medium">Period</th>
              <th className="text-right py-2 px-3 font-medium">Gross Sales</th>
              <th className="text-right py-2 px-3 font-medium">Refunds</th>
              <th className="text-right py-2 px-3 font-medium">Other Income</th>
              <th className="text-right py-2 px-3 font-medium">Total In</th>
              <th className="text-right py-2 px-3 font-medium">Expenses</th>
              <th className="text-right py-2 px-3 font-medium">Net Cash Flow</th>
            </tr>
          </thead>
          <tbody>
            {displayRows.map((m) => {
              const isExpanded = expanded.has(m.period);
              return (
                <Fragment key={m.period}>
                  <tr className="border-b hover:bg-muted/50 cursor-pointer" onClick={() => toggle(m.period)}>
                    <td className="py-2 px-3 font-medium">
                      <span className="inline-block w-4 mr-1 text-muted-foreground">{isExpanded ? '▾' : '▸'}</span>
                      {view === 'monthly' ? formatPeriod(m.period) : m.period}
                    </td>
                    <td className="py-2 px-3 text-right">{fmt(m.salesRevenue)}</td>
                    <td className="py-2 px-3 text-right text-red-600">{m.refunds > 0 ? `-${fmt(m.refunds)}` : '-'}</td>
                    <td className="py-2 px-3 text-right">{m.otherIncome > 0 ? fmt(m.otherIncome) : '-'}</td>
                    <td className="py-2 px-3 text-right font-medium text-green-600">{fmt(m.totalIncome)}</td>
                    <td className="py-2 px-3 text-right">{fmt(m.totalExpenses)}</td>
                    <td className={`py-2 px-3 text-right font-semibold ${m.netCashFlow >= 0 ? 'text-green-600' : 'text-red-600'}`}>{fmt(m.netCashFlow)}</td>
                  </tr>
                  {isExpanded && <CashFlowBreakdown month={m} fmt={fmt} drilldown={drilldown} toggleDrilldown={toggleDrilldown} />}
                </Fragment>
              );
            })}
            {displayRows.length > 1 && (() => {
              const t = sumMonths(displayRows);
              return (
                <tr className="border-t-2 bg-muted/40">
                  <td className="py-2.5 px-3 font-bold">Total</td>
                  <td className="py-2.5 px-3 text-right font-bold">{fmt(t.salesRevenue)}</td>
                  <td className="py-2.5 px-3 text-right font-bold text-red-600">{t.refunds > 0 ? `-${fmt(t.refunds)}` : '-'}</td>
                  <td className="py-2.5 px-3 text-right font-bold">{fmt(t.otherIncome)}</td>
                  <td className="py-2.5 px-3 text-right font-bold text-green-600">{fmt(t.totalIncome)}</td>
                  <td className="py-2.5 px-3 text-right font-bold">{fmt(t.totalExpenses)}</td>
                  <td className={`py-2.5 px-3 text-right font-bold ${t.netCashFlow >= 0 ? 'text-green-600' : 'text-red-600'}`}>{fmt(t.netCashFlow)}</td>
                </tr>
              );
            })()}
          </tbody>
        </table>
      </div>
      {displayRows.length === 0 && (
        <div className="text-muted-foreground text-center py-8">No cash flow data found</div>
      )}
    </div>
  );
}

function CashFlowBreakdown({ month: m, fmt, drilldown, toggleDrilldown }: {
  month: CashFlowMonth;
  fmt: (n: number) => string;
  drilldown: string | null;
  toggleDrilldown: (key: string) => void;
}) {
  return (
    <>
      {/* Income section */}
      <tr className="bg-muted/30">
        <td className="py-1.5 px-3 pl-8 font-medium text-muted-foreground text-xs uppercase tracking-wide" colSpan={6}>Income</td>
        <td className="py-1.5 px-3 text-right font-medium text-xs">{fmt(m.totalIncome)}</td>
      </tr>
      {/* Sales Revenue */}
      {(() => {
        const salesKey = `${m.period}::credit::SALES_REVENUE`;
        const isSalesDrilling = drilldown === salesKey;
        return (
          <>
            <tr
              className="bg-muted/15 hover:bg-muted/25 cursor-pointer"
              onClick={(e) => { e.stopPropagation(); toggleDrilldown(salesKey); }}
            >
              <td className="py-1 px-3 pl-12 text-muted-foreground" colSpan={6}>
                <span className="inline-block w-3 mr-1 text-xs">{isSalesDrilling ? '▾' : '▸'}</span>
                Sales Revenue
                <span className="ml-2 text-xs opacity-60">({m.salesCount} txns)</span>
              </td>
              <td className="py-1 px-3 text-right text-muted-foreground">{fmt(m.salesRevenue)}</td>
            </tr>
            {isSalesDrilling && <CashFlowDrilldown period={m.period} direction="credit" accountCode="SALES_REVENUE" fmt={fmt} />}
          </>
        );
      })()}
      {/* Refunds */}
      {m.refunds > 0 && (() => {
        const refundKey = `${m.period}::debit::SALES_REVENUE`;
        const isRefundDrilling = drilldown === refundKey;
        return (
          <>
            <tr
              className="bg-muted/15 hover:bg-muted/25 cursor-pointer"
              onClick={(e) => { e.stopPropagation(); toggleDrilldown(refundKey); }}
            >
              <td className="py-1 px-3 pl-12 text-red-600" colSpan={6}>
                <span className="inline-block w-3 mr-1 text-xs">{isRefundDrilling ? '▾' : '▸'}</span>
                Less: Refunds
                <span className="ml-2 text-xs opacity-60">({m.refundCount} txns)</span>
              </td>
              <td className="py-1 px-3 text-right text-red-600">-{fmt(m.refunds)}</td>
            </tr>
            {isRefundDrilling && <CashFlowDrilldown period={m.period} direction="debit" accountCode="SALES_REVENUE" fmt={fmt} />}
          </>
        );
      })()}
      {/* Net sales subtotal */}
      <tr className="bg-muted/10">
        <td className="py-1 px-3 pl-12 font-medium text-xs" colSpan={6}>Net Sales Revenue</td>
        <td className="py-1 px-3 text-right font-medium text-xs">{fmt(m.netSalesRevenue)}</td>
      </tr>
      {/* Other income lines */}
      {m.incomeLines.map((l) => {
        const key = `${m.period}::credit::${l.code}`;
        const isDrilling = drilldown === key;
        return (
          <Fragment key={l.code}>
            <tr
              className="bg-muted/15 hover:bg-muted/25 cursor-pointer"
              onClick={(e) => { e.stopPropagation(); toggleDrilldown(key); }}
            >
              <td className="py-1 px-3 pl-12 text-muted-foreground" colSpan={6}>
                <span className="inline-block w-3 mr-1 text-xs">{isDrilling ? '▾' : '▸'}</span>
                {l.name}
                <span className="ml-2 text-xs opacity-60">({l.count} txns)</span>
              </td>
              <td className="py-1 px-3 text-right text-muted-foreground">{fmt(l.amount)}</td>
            </tr>
            {isDrilling && <CashFlowDrilldown period={m.period} direction="credit" accountCode={l.code} fmt={fmt} />}
          </Fragment>
        );
      })}

      {/* Expenses section */}
      <tr className="bg-muted/30">
        <td className="py-1.5 px-3 pl-8 font-medium text-muted-foreground text-xs uppercase tracking-wide" colSpan={6}>Expenses</td>
        <td className="py-1.5 px-3 text-right font-medium text-xs">{fmt(m.totalExpenses)}</td>
      </tr>
      {m.expenses.map((l) => {
        const key = `${m.period}::debit::${l.code}`;
        const isDrilling = drilldown === key;
        return (
          <Fragment key={l.code}>
            <tr
              className="bg-muted/15 hover:bg-muted/25 cursor-pointer"
              onClick={(e) => { e.stopPropagation(); toggleDrilldown(key); }}
            >
              <td className="py-1 px-3 pl-12 text-muted-foreground" colSpan={6}>
                <span className="inline-block w-3 mr-1 text-xs">{isDrilling ? '▾' : '▸'}</span>
                {l.name}
                <span className="ml-2 text-xs opacity-60">({l.count} txns)</span>
              </td>
              <td className="py-1 px-3 text-right text-muted-foreground">{fmt(l.amount)}</td>
            </tr>
            {isDrilling && <CashFlowDrilldown period={m.period} direction="debit" accountCode={l.code} fmt={fmt} />}
          </Fragment>
        );
      })}
    </>
  );
}

function CashFlowDrilldown({ period, direction, accountCode, fmt }: {
  period: string;
  direction: 'credit' | 'debit';
  accountCode: string;
  fmt: (n: number) => string;
}) {
  const detailFn = useServerFn(getCashFlowDetail);
  const [expandedGroup, setExpandedGroup] = useState<Set<string>>(new Set());

  const { data, isLoading } = useQuery({
    queryKey: ['finance', 'cashflow-detail', period, direction, accountCode],
    queryFn: () => detailFn({ data: { period, direction, accountCode } }),
  });

  if (isLoading) {
    return (
      <tr className="bg-muted/5">
        <td colSpan={7} className="py-2 px-3 pl-16 text-muted-foreground text-xs">Loading...</td>
      </tr>
    );
  }

  if (!data?.success || !data.groups || data.groups.length === 0) {
    return (
      <tr className="bg-muted/5">
        <td colSpan={7} className="py-2 px-3 pl-16 text-muted-foreground text-xs">No transactions</td>
      </tr>
    );
  }

  const toggleGroup = (label: string) => {
    setExpandedGroup((prev) => {
      const next = new Set(prev);
      if (next.has(label)) next.delete(label);
      else next.add(label);
      return next;
    });
  };

  // If only one group, auto-expand it
  const groups = data.groups;
  const singleGroup = groups.length === 1;

  return (
    <>
      {groups.map((g) => {
        const isOpen = singleGroup || expandedGroup.has(g.label);
        return (
          <Fragment key={g.label}>
            <tr
              className="bg-blue-50/50 dark:bg-blue-950/20 hover:bg-blue-50 dark:hover:bg-blue-950/30 cursor-pointer"
              onClick={(e) => { e.stopPropagation(); toggleGroup(g.label); }}
            >
              <td className="py-1 px-3 pl-16 text-xs font-medium" colSpan={6}>
                <span className="inline-block w-3 mr-1 text-muted-foreground">{isOpen ? '▾' : '▸'}</span>
                {g.label}
                <span className="ml-2 text-muted-foreground">({g.count} txns)</span>
              </td>
              <td className="py-1 px-3 text-right text-xs font-medium">{fmt(g.total)}</td>
            </tr>
            {isOpen && g.transactions.map((t) => (
              <tr key={t.id} className="bg-blue-50/25 dark:bg-blue-950/10 hover:bg-blue-50/50 dark:hover:bg-blue-950/20">
                <td className="py-0.5 px-3 pl-20 text-xs text-muted-foreground">
                  {new Date(t.txnDate).toLocaleDateString('en-IN', { day: '2-digit', month: 'short' })}
                </td>
                <td className="py-0.5 px-3 text-xs text-muted-foreground truncate max-w-[200px]" colSpan={2} title={t.counterpartyName ?? ''}>
                  {t.counterpartyName || '-'}
                </td>
                <td className="py-0.5 px-3 text-xs text-muted-foreground truncate max-w-[300px]" colSpan={3} title={t.narration ?? ''}>
                  {t.narration ? (t.narration.length > 60 ? t.narration.slice(0, 60) + '...' : t.narration) : '-'}
                </td>
                <td className="py-0.5 px-3 text-right text-xs text-muted-foreground">{fmt(t.amount)}</td>
              </tr>
            ))}
          </Fragment>
        );
      })}
      {data.totalCount >= 500 && (
        <tr className="bg-blue-50/25 dark:bg-blue-950/10">
          <td colSpan={7} className="py-1 px-3 pl-16 text-xs text-muted-foreground italic">Showing first 500 transactions</td>
        </tr>
      )}
    </>
  );
}
