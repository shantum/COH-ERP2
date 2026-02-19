import { useQuery } from '@tanstack/react-query';
import { useServerFn } from '@tanstack/react-start';
import { useNavigate } from '@tanstack/react-router';
import { FileText, CreditCard, AlertCircle, TrendingUp, TrendingDown } from 'lucide-react';
import { getFinanceSummary, getFinanceAlerts, getMonthlyPnl } from '../../server/functions/finance';
import { formatCurrency, formatPeriod, LoadingState } from './shared';
import { Button } from '@/components/ui/button';

export default function DashboardTab() {
  const navigate = useNavigate();
  const summaryFn = useServerFn(getFinanceSummary);
  const alertsFn = useServerFn(getFinanceAlerts);

  const { data, isLoading, refetch } = useQuery({
    queryKey: ['finance', 'summary'],
    queryFn: () => summaryFn(),
    staleTime: 5 * 60 * 1000,
  });

  const { data: alertsData } = useQuery({
    queryKey: ['finance', 'alerts'],
    queryFn: () => alertsFn(),
  });

  const pnlFn = useServerFn(getMonthlyPnl);
  const { data: pnlData } = useQuery({
    queryKey: ['finance', 'pnl'],
    queryFn: () => pnlFn(),
    staleTime: 5 * 60 * 1000,
  });

  const summary = data?.success ? data.summary : null;

  if (isLoading) return <LoadingState />;
  if (!data?.success || !summary) return (
    <div className="flex flex-col items-center justify-center py-12 text-muted-foreground gap-3">
      <AlertCircle className="h-8 w-8" />
      <p>Failed to load finance summary</p>
      <Button variant="outline" size="sm" onClick={() => refetch()}>Try Again</Button>
    </div>
  );

  const alerts = alertsData?.success ? alertsData.alerts : [];
  const errorCount = alertsData?.success ? alertsData.counts.errors : 0;
  const warningCount = alertsData?.success ? alertsData.counts.warnings : 0;

  const fmtDate = (d: string | Date | null) => {
    if (!d) return '';
    return `as of ${new Date(d).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })}`;
  };

  const getAlertAction = (alert: { category: string; message: string }) => {
    if (alert.category.toLowerCase().includes('invoice')) {
      return () => navigate({ to: '/finance', search: { tab: 'invoices', page: 1, limit: 25 }, replace: true });
    }
    if (alert.category.toLowerCase().includes('payment') || alert.category.toLowerCase().includes('match')) {
      return () => navigate({ to: '/finance', search: { tab: 'payments', page: 1, limit: 25 }, replace: true });
    }
    if (alert.category.toLowerCase().includes('bank')) {
      return () => navigate({ to: '/finance', search: { tab: 'bank-import', page: 1, limit: 25 }, replace: true });
    }
    if (alert.category.toLowerCase().includes('party')) {
      return () => navigate({ to: '/finance', search: { tab: 'parties', page: 1, limit: 25 }, replace: true });
    }
    return null;
  };

  const attentionItems = [
    ...(summary.draftInvoices > 0 ? [{
      icon: FileText,
      label: `${summary.draftInvoices} draft invoice${summary.draftInvoices !== 1 ? 's' : ''}`,
      description: 'Need review & confirmation',
      onClick: () => navigate({ to: '/finance', search: { tab: 'invoices', status: 'draft', page: 1, limit: 25 }, replace: true }),
      color: 'text-amber-600',
    }] : []),
    ...(summary.pendingBankTxns > 0 ? [{
      icon: CreditCard,
      label: `${summary.pendingBankTxns} pending bank txn${summary.pendingBankTxns !== 1 ? 's' : ''}`,
      description: 'Imported, awaiting confirmation',
      onClick: () => navigate({ to: '/finance', search: { tab: 'bank-import', bankStatus: 'pending', page: 1, limit: 25 }, replace: true }),
      color: 'text-blue-600',
    }] : []),
    ...(summary.unmatchedPayments > 0 ? [{
      icon: AlertCircle,
      label: `${summary.unmatchedPayments} unmatched payment${summary.unmatchedPayments !== 1 ? 's' : ''}`,
      description: 'Need invoices or documentation',
      onClick: () => navigate({ to: '/finance', search: { tab: 'payments', matchStatus: 'unmatched', page: 1, limit: 25 }, replace: true }),
      color: 'text-red-500',
    }] : []),
  ];

  return (
    <div className="space-y-6">
      {/* Integrity Alerts */}
      {alerts.length > 0 && (
        <div className="border border-amber-300 bg-amber-50 dark:bg-amber-950/20 dark:border-amber-800 rounded-lg p-4">
          <h3 className="font-semibold text-sm mb-3">
            Integrity Issues
            {errorCount > 0 && <span className="ml-2 text-xs bg-red-100 text-red-700 dark:bg-red-900 dark:text-red-300 px-2 py-0.5 rounded-full">{errorCount} errors</span>}
            {warningCount > 0 && <span className="ml-2 text-xs bg-amber-100 text-amber-700 dark:bg-amber-900 dark:text-amber-300 px-2 py-0.5 rounded-full">{warningCount} warnings</span>}
          </h3>
          <div className="space-y-2 max-h-[300px] overflow-y-auto">
            {alerts.map((alert: { severity: string; category: string; message: string; details?: string }, i: number) => {
              const action = getAlertAction(alert);
              return (
                <div
                  key={i}
                  className={`text-sm flex gap-2 ${alert.severity === 'error' ? 'text-red-700 dark:text-red-400' : 'text-amber-700 dark:text-amber-400'} ${action ? 'cursor-pointer hover:underline' : ''}`}
                  onClick={action ?? undefined}
                  role={action ? 'button' : undefined}
                >
                  <span className="shrink-0">{alert.severity === 'error' ? '!!' : '!'}</span>
                  <div>
                    <span className="font-medium">{alert.category}:</span>{' '}
                    <span>{alert.message}</span>
                    {alert.details && <div className="text-xs text-muted-foreground mt-0.5">{alert.details}</div>}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Summary Cards */}
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-4">
        <SummaryCard
          label="Accounts Payable"
          value={summary.totalPayable}
          subtitle={`${summary.openPayableInvoices} open invoices`}
          color="text-red-700"
          onClick={() => navigate({ to: '/finance', search: { tab: 'invoices', type: 'payable', status: 'confirmed', page: 1, limit: 25 }, replace: true })}
        />
        <SummaryCard
          label="Accounts Receivable"
          value={summary.totalReceivable}
          subtitle={`${summary.openReceivableInvoices} open invoices`}
          color="text-green-700"
          onClick={() => navigate({ to: '/finance', search: { tab: 'invoices', type: 'receivable', status: 'confirmed', page: 1, limit: 25 }, replace: true })}
        />
        <SummaryCard
          label="HDFC Bank"
          value={summary.hdfcBalance}
          subtitle={fmtDate(summary.hdfcBalanceDate)}
          color="text-blue-700"
          onClick={() => navigate({ to: '/finance', search: { tab: 'bank-import', bankFilter: 'hdfc', page: 1, limit: 25 }, replace: true })}
        />
        <SummaryCard
          label="RazorpayX"
          value={summary.rpxBalance}
          subtitle={fmtDate(summary.rpxBalanceDate)}
          color="text-blue-600"
          onClick={() => navigate({ to: '/finance', search: { tab: 'bank-import', bankFilter: 'razorpayx', page: 1, limit: 25 }, replace: true })}
        />
        {summary.suspenseBalance > 0 && (
          <SummaryCard
            label="Suspense"
            value={summary.suspenseBalance}
            subtitle="needs reclassifying"
            color="text-amber-700"
            onClick={() => navigate({ to: '/finance', search: { tab: 'payments', matchStatus: 'unmatched', page: 1, limit: 25 }, replace: true })}
          />
        )}
      </div>

      {/* P&L Snapshot */}
      {pnlData?.success && <PnlSnapshotCard months={pnlData.months} onNavigate={() => navigate({ to: '/finance', search: { tab: 'pnl', page: 1, limit: 25 }, replace: true })} />}

      {/* Needs Attention */}
      {attentionItems.length > 0 && (
        <div>
          <h3 className="text-sm font-semibold mb-3 text-muted-foreground uppercase tracking-wide">Needs Attention</h3>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
            {attentionItems.map((item) => (
              <button
                key={item.label}
                type="button"
                onClick={item.onClick}
                className="flex items-start gap-3 p-4 border rounded-lg text-left hover:bg-muted/50 transition-colors group"
              >
                <item.icon className={`h-5 w-5 mt-0.5 shrink-0 ${item.color}`} />
                <div>
                  <div className="font-medium text-sm group-hover:underline">{item.label}</div>
                  <div className="text-xs text-muted-foreground mt-0.5">{item.description}</div>
                </div>
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function SummaryCard({ label, value, subtitle, color = 'text-foreground', onClick }: {
  label: string;
  value: number;
  subtitle?: string;
  color?: string;
  onClick?: () => void;
}) {
  const Comp = onClick ? 'button' : 'div';
  return (
    <Comp
      type={onClick ? 'button' : undefined}
      onClick={onClick}
      className={`border rounded-lg p-4 text-left ${onClick ? 'hover:bg-muted/50 transition-colors cursor-pointer' : ''}`}
    >
      <p className="text-sm text-muted-foreground">{label}</p>
      <p className={`text-2xl font-bold font-mono ${color}`}>{formatCurrency(value)}</p>
      {subtitle && <p className="text-xs text-muted-foreground mt-1">{subtitle}</p>}
    </Comp>
  );
}

/** Compact P&L snapshot showing current month vs previous */
function PnlSnapshotCard({ months, onNavigate }: {
  months: Array<{ period: string; revenue: number; cogs: number; grossProfit: number; totalExpenses: number; netProfit: number }>;
  onNavigate: () => void;
}) {
  // Current month in IST
  const now = new Date();
  const ist = new Date(now.getTime() + (5.5 * 60 * 60 * 1000));
  const currentPeriod = `${ist.getUTCFullYear()}-${String(ist.getUTCMonth() + 1).padStart(2, '0')}`;

  // Previous month
  const prevMonth = ist.getUTCMonth() === 0
    ? `${ist.getUTCFullYear() - 1}-12`
    : `${ist.getUTCFullYear()}-${String(ist.getUTCMonth()).padStart(2, '0')}`;

  const current = months.find(m => m.period === currentPeriod);
  const prev = months.find(m => m.period === prevMonth);

  if (!current && !prev) return null;

  const display = current ?? { period: currentPeriod, revenue: 0, cogs: 0, grossProfit: 0, totalExpenses: 0, netProfit: 0 };

  const pctChange = (curr: number, previous: number) => {
    if (previous === 0) return curr > 0 ? 100 : 0;
    return Math.round(((curr - previous) / Math.abs(previous)) * 100);
  };

  const ChangeIndicator = ({ current: c, previous: p, invertColor = false }: { current: number; previous: number; invertColor?: boolean }) => {
    const change = pctChange(c, p);
    if (change === 0 || !prev) return null;
    const isUp = change > 0;
    // For expenses/COGS, going up is bad (red), down is good (green) — hence invertColor
    const isPositive = invertColor ? !isUp : isUp;
    const Icon = isUp ? TrendingUp : TrendingDown;
    return (
      <span className={`inline-flex items-center gap-0.5 text-xs ${isPositive ? 'text-green-600' : 'text-red-500'}`}>
        <Icon className="h-3 w-3" />
        {Math.abs(change)}%
      </span>
    );
  };

  const rows = [
    { label: 'Revenue', value: display.revenue, prev: prev?.revenue ?? 0, color: 'text-green-700 dark:text-green-400' },
    { label: 'COGS', value: display.cogs, prev: prev?.cogs ?? 0, color: 'text-muted-foreground', invertColor: true },
    { label: 'Expenses', value: display.totalExpenses, prev: prev?.totalExpenses ?? 0, color: 'text-muted-foreground', invertColor: true },
    { label: 'Net Profit', value: display.netProfit, prev: prev?.netProfit ?? 0, color: display.netProfit >= 0 ? 'text-green-700 dark:text-green-400' : 'text-red-600 dark:text-red-400' },
  ];

  return (
    <div className="border rounded-lg p-4">
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide">
          {formatPeriod(display.period)} at a Glance
        </h3>
        <button type="button" onClick={onNavigate} className="text-xs text-blue-600 hover:underline">
          View Full P&L
        </button>
      </div>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {rows.map(row => (
          <div key={row.label}>
            <p className="text-xs text-muted-foreground">{row.label}</p>
            <p className={`text-lg font-bold font-mono ${row.color}`}>
              {formatCurrency(row.value)}
            </p>
            <ChangeIndicator current={row.value} previous={row.prev} invertColor={row.invertColor} />
          </div>
        ))}
      </div>
      {prev && (
        <p className="text-xs text-muted-foreground mt-2">
          vs {formatPeriod(prev.period)}: Net {formatCurrency(prev.netProfit)}
        </p>
      )}
    </div>
  );
}
