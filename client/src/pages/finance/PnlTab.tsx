import { useState, Fragment } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useServerFn } from '@tanstack/react-start';
import { getMonthlyPnl, getPnlAccountDetail } from '../../server/functions/finance';
import { formatPeriod, LoadingState } from './shared';

export default function PnlTab() {
  const pnlFn = useServerFn(getMonthlyPnl);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  // "2026-01::OPERATING_EXPENSES" format for account drill-down
  const [drilldown, setDrilldown] = useState<string | null>(null);

  const { data, isLoading } = useQuery({
    queryKey: ['finance', 'pnl'],
    queryFn: () => pnlFn(),
    staleTime: 5 * 60 * 1000,
  });

  if (isLoading) return <LoadingState />;
  if (!data?.success) return <div className="text-muted-foreground text-center py-8">Failed to load P&L</div>;

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

  const toggleDrilldown = (period: string, code: string) => {
    const key = `${period}::${code}`;
    setDrilldown((prev) => (prev === key ? null : key));
  };

  const renderBreakdownRows = (
    period: string,
    lines: { code: string; name: string; amount: number }[],
    label: string,
    total: number,
  ) => {
    if (lines.length === 0) return null;
    return (
      <>
        <tr className="bg-muted/30">
          <td className="py-1.5 px-3 pl-8 font-medium text-muted-foreground text-xs uppercase tracking-wide" colSpan={5}>{label}</td>
          <td className="py-1.5 px-3 text-right font-medium text-xs">{fmt(total)}</td>
        </tr>
        {lines.map((l) => {
          const drillKey = `${period}::${l.code}`;
          const isDrilling = drilldown === drillKey;
          return (
            <Fragment key={l.code}>
              <tr
                className="bg-muted/15 hover:bg-muted/25 cursor-pointer"
                onClick={(e) => { e.stopPropagation(); toggleDrilldown(period, l.code); }}
              >
                <td className="py-1 px-3 pl-12 text-muted-foreground" colSpan={5}>
                  <span className="inline-block w-3 mr-1 text-xs">{isDrilling ? '▾' : '▸'}</span>
                  {l.name}
                </td>
                <td className="py-1 px-3 text-right text-muted-foreground">{fmt(l.amount)}</td>
              </tr>
              {isDrilling && <AccountDrilldown period={period} category={l.code} fmt={fmt} />}
            </Fragment>
          );
        })}
      </>
    );
  };

  return (
    <div className="space-y-4">
      <h3 className="text-lg font-semibold">Monthly P&L (Accrual Basis)</h3>
      <p className="text-xs text-muted-foreground">Click a month to expand, then click any account to see what's inside</p>
      <div className="overflow-x-auto">
        <table className="w-full text-sm border-collapse">
          <thead>
            <tr className="border-b">
              <th className="text-left py-2 px-3 font-medium">Period</th>
              <th className="text-right py-2 px-3 font-medium">Revenue</th>
              <th className="text-right py-2 px-3 font-medium">COGS</th>
              <th className="text-right py-2 px-3 font-medium">Gross Profit</th>
              <th className="text-right py-2 px-3 font-medium">Expenses</th>
              <th className="text-right py-2 px-3 font-medium">Net Profit</th>
            </tr>
          </thead>
          <tbody>
            {months.map((m) => {
              const isExpanded = expanded.has(m.period);
              return (
                <Fragment key={m.period}>
                  <tr
                    className="border-b hover:bg-muted/50 cursor-pointer"
                    onClick={() => toggle(m.period)}
                  >
                    <td className="py-2 px-3 font-medium">
                      <span className="inline-block w-4 mr-1 text-muted-foreground">{isExpanded ? '▾' : '▸'}</span>
                      {formatPeriod(m.period)}
                    </td>
                    <td className="py-2 px-3 text-right">{fmt(m.revenue)}</td>
                    <td className="py-2 px-3 text-right">{fmt(m.cogs)}</td>
                    <td className={`py-2 px-3 text-right font-medium ${m.grossProfit >= 0 ? 'text-green-600' : 'text-red-600'}`}>
                      {fmt(m.grossProfit)}
                    </td>
                    <td className="py-2 px-3 text-right">{fmt(m.totalExpenses)}</td>
                    <td className={`py-2 px-3 text-right font-semibold ${m.netProfit >= 0 ? 'text-green-600' : 'text-red-600'}`}>
                      {fmt(m.netProfit)}
                    </td>
                  </tr>
                  {isExpanded && (
                    <>
                      {renderBreakdownRows(m.period, m.revenueLines, 'Revenue', m.revenue)}
                      {renderBreakdownRows(m.period, m.cogsLines, 'Cost of Goods Sold', m.cogs)}
                      {renderBreakdownRows(m.period, m.expenses, 'Operating Expenses', m.totalExpenses)}
                    </>
                  )}
                </Fragment>
              );
            })}
            {months.length > 1 && (() => {
              const totRev = months.reduce((s, m) => s + m.revenue, 0);
              const totCogs = months.reduce((s, m) => s + m.cogs, 0);
              const totGross = totRev - totCogs;
              const totExp = months.reduce((s, m) => s + m.totalExpenses, 0);
              const totNet = totGross - totExp;
              return (
                <tr className="border-t-2 bg-muted/40">
                  <td className="py-2.5 px-3 font-bold">Total</td>
                  <td className="py-2.5 px-3 text-right font-bold">{fmt(totRev)}</td>
                  <td className="py-2.5 px-3 text-right font-bold">{fmt(totCogs)}</td>
                  <td className={`py-2.5 px-3 text-right font-bold ${totGross >= 0 ? 'text-green-600' : 'text-red-600'}`}>{fmt(totGross)}</td>
                  <td className="py-2.5 px-3 text-right font-bold">{fmt(totExp)}</td>
                  <td className={`py-2.5 px-3 text-right font-bold ${totNet >= 0 ? 'text-green-600' : 'text-red-600'}`}>{fmt(totNet)}</td>
                </tr>
              );
            })()}
          </tbody>
        </table>
      </div>
      {months.length === 0 && (
        <div className="text-muted-foreground text-center py-8">No P&L data found</div>
      )}
    </div>
  );
}

// Lazy-loaded drill-down: shows invoices for one category+period
function AccountDrilldown({ period, category, fmt }: {
  period: string;
  category: string;
  fmt: (n: number) => string;
}) {
  const detailFn = useServerFn(getPnlAccountDetail);
  const [expandedCat, setExpandedCat] = useState<Set<string>>(new Set());

  const { data, isLoading } = useQuery({
    queryKey: ['finance', 'pnl-detail', period, category],
    queryFn: () => detailFn({ data: { period, category } }),
  });

  if (isLoading) {
    return (
      <tr className="bg-muted/5">
        <td colSpan={6} className="py-2 px-3 pl-16 text-muted-foreground text-xs">Loading...</td>
      </tr>
    );
  }

  if (!data?.success || data.categories.length === 0) {
    return (
      <tr className="bg-muted/5">
        <td colSpan={6} className="py-2 px-3 pl-16 text-muted-foreground text-xs">No entries</td>
      </tr>
    );
  }

  const toggleCat = (label: string) => {
    setExpandedCat((prev) => {
      const next = new Set(prev);
      if (next.has(label)) next.delete(label);
      else next.add(label);
      return next;
    });
  };

  return (
    <>
      {data.categories.map((cat: { label: string; total: number; lines: { description: string; amount: number; date: string; counterparty: string | null }[] }) => {
        const isCatExpanded = expandedCat.has(cat.label);
        return (
          <Fragment key={cat.label}>
            <tr
              className="bg-blue-50/50 dark:bg-blue-950/20 hover:bg-blue-50 dark:hover:bg-blue-950/30 cursor-pointer"
              onClick={(e) => { e.stopPropagation(); toggleCat(cat.label); }}
            >
              <td className="py-1 px-3 pl-16 text-xs font-medium" colSpan={5}>
                <span className="inline-block w-3 mr-1 text-muted-foreground">{isCatExpanded ? '▾' : '▸'}</span>
                {cat.label}
                <span className="ml-2 text-muted-foreground">({cat.lines.length})</span>
              </td>
              <td className="py-1 px-3 text-right text-xs font-medium">{fmt(cat.total)}</td>
            </tr>
            {isCatExpanded && cat.lines.map((line: { description: string; amount: number; date: string; counterparty: string | null }, i: number) => (
              <tr key={i} className="bg-blue-50/25 dark:bg-blue-950/10">
                <td className="py-0.5 px-3 pl-20 text-xs text-muted-foreground truncate max-w-[400px]" colSpan={4} title={line.description}>
                  {line.counterparty || line.description.slice(0, 60)}
                </td>
                <td className="py-0.5 px-3 text-xs text-muted-foreground">{line.date}</td>
                <td className="py-0.5 px-3 text-right text-xs text-muted-foreground">{fmt(line.amount)}</td>
              </tr>
            ))}
          </Fragment>
        );
      })}
    </>
  );
}
