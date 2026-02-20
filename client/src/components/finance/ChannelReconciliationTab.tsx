import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Loader2, ChevronLeft, ChevronRight, AlertTriangle, Clock, TrendingDown, PieChart } from 'lucide-react';
import {
  getChannelReconciliation,
  getChannelOrderDrilldown,
} from '@/server/functions/finance/channelReconciliation';

// --- Helpers ---

function formatINR(amount: number): string {
  return new Intl.NumberFormat('en-IN', {
    style: 'currency',
    currency: 'INR',
    maximumFractionDigits: 0,
  }).format(amount);
}

function formatDate(date: string | Date): string {
  return new Date(date).toLocaleDateString('en-IN', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  });
}

function getStatusBadge(status: string) {
  switch (status) {
    case 'paid':
      return <Badge className="bg-green-100 text-green-800">Paid</Badge>;
    case 'confirmed':
      return <Badge className="bg-blue-100 text-blue-800">Confirmed</Badge>;
    case 'partially_paid':
      return <Badge className="bg-amber-100 text-amber-800">Partial</Badge>;
    case 'draft':
      return <Badge variant="secondary">Draft</Badge>;
    default:
      return <Badge variant="outline">No Invoice</Badge>;
  }
}

// --- Types ---

interface SelectedChannel {
  channel: string;
  paymentMethod?: string;
  label: string;
}

// --- Component ---

export function ChannelReconciliationTab() {
  const [selectedChannel, setSelectedChannel] = useState<SelectedChannel | null>(null);
  const [unsettledOnly, setUnsettledOnly] = useState(false);
  const [page, setPage] = useState(1);

  // Summary query
  const summaryQuery = useQuery({
    queryKey: ['finance', 'channels', 'reconciliation'],
    queryFn: () => getChannelReconciliation(),
  });

  // Drilldown query
  const drilldownQuery = useQuery({
    queryKey: ['finance', 'channels', 'drilldown', selectedChannel?.channel, selectedChannel?.paymentMethod, unsettledOnly, page],
    queryFn: () =>
      getChannelOrderDrilldown({
        data: {
          channel: selectedChannel!.channel,
          ...(selectedChannel!.paymentMethod ? { paymentMethod: selectedChannel!.paymentMethod } : {}),
          unsettledOnly,
          page,
          limit: 50,
        },
      }),
    enabled: !!selectedChannel,
  });

  function handleCardClick(channel: { key: string; label: string; channel: string; paymentMethod?: string }) {
    if (selectedChannel?.channel === channel.channel && selectedChannel?.paymentMethod === channel.paymentMethod) {
      setSelectedChannel(null);
    } else {
      setSelectedChannel({
        channel: channel.channel,
        ...(channel.paymentMethod ? { paymentMethod: channel.paymentMethod } : {}),
        label: channel.label,
      });
      setPage(1);
    }
  }

  function handleUnsettledToggle(checked: boolean) {
    setUnsettledOnly(checked);
    setPage(1);
  }

  // Loading state
  if (summaryQuery.isLoading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  const channels = summaryQuery.data?.channels ?? [];

  return (
    <div className="space-y-6">
      {/* Summary Cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {channels.map((ch) => {
          const isSelected =
            selectedChannel?.channel === ch.channel &&
            selectedChannel?.paymentMethod === (('paymentMethod' in ch ? ch.paymentMethod : undefined) as string | undefined);

          return (
            <Card
              key={ch.key}
              className={`cursor-pointer transition-shadow hover:shadow-md ${isSelected ? 'ring-2 ring-primary' : ''}`}
              onClick={() =>
                handleCardClick({
                  key: ch.key,
                  label: ch.label,
                  channel: ch.channel,
                  ...('paymentMethod' in ch && ch.paymentMethod ? { paymentMethod: ch.paymentMethod as string } : {}),
                })
              }
            >
              <CardHeader className="pb-2">
                <CardTitle className="text-base">{ch.label}</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="grid grid-cols-2 gap-y-2 text-sm">
                  <div className="text-muted-foreground">Orders</div>
                  <div className="text-right font-medium">{ch.totalOrders.toLocaleString('en-IN')}</div>

                  <div className="text-muted-foreground">Gross Receivable</div>
                  <div className="text-right font-medium">{formatINR(ch.grossReceivable)}</div>

                  <div className="text-muted-foreground">Settled</div>
                  <div className="text-right font-medium">{formatINR(ch.settled)}</div>

                  {ch.commissions > 0 && (
                    <>
                      <div className="text-muted-foreground">Commissions</div>
                      <div className="text-right font-medium">{formatINR(ch.commissions)}</div>
                    </>
                  )}

                  <div className="text-muted-foreground font-medium">Outstanding</div>
                  <div
                    className={`text-right font-semibold ${ch.outstanding <= 0 ? 'text-green-600' : 'text-red-600'}`}
                  >
                    {formatINR(ch.outstanding)}
                  </div>
                </div>
              </CardContent>
            </Card>
          );
        })}
      </div>

      {/* COD Metrics */}
      {summaryQuery.data?.codMetrics && (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
          <Card>
            <CardContent className="pt-4 pb-3">
              <div className="flex items-center gap-2 mb-2">
                <AlertTriangle className="h-4 w-4 text-amber-500" />
                <span className="text-sm font-medium text-muted-foreground">Pending Remittance</span>
              </div>
              <div className="text-2xl font-bold">{summaryQuery.data.codMetrics.pendingRemittance.count}</div>
              <div className="text-sm text-muted-foreground">
                {formatINR(summaryQuery.data.codMetrics.pendingRemittance.amount)}
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardContent className="pt-4 pb-3">
              <div className="flex items-center gap-2 mb-2">
                <TrendingDown className="h-4 w-4 text-red-500" />
                <span className="text-sm font-medium text-muted-foreground">RTO Revenue Loss</span>
              </div>
              <div className="text-2xl font-bold">{summaryQuery.data.codMetrics.rto.count}</div>
              <div className="text-sm text-muted-foreground">
                {formatINR(summaryQuery.data.codMetrics.rto.amount)}
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardContent className="pt-4 pb-3">
              <div className="flex items-center gap-2 mb-2">
                <Clock className="h-4 w-4 text-orange-500" />
                <span className="text-sm font-medium text-muted-foreground">Remittance Aging</span>
              </div>
              <div className="space-y-1 text-sm">
                <div className="flex justify-between">
                  <span className="text-muted-foreground">&gt; 7 days</span>
                  <span className="font-medium">{summaryQuery.data.codMetrics.remittanceAging.over7Days}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">&gt; 14 days</span>
                  <span className="font-medium text-amber-600">{summaryQuery.data.codMetrics.remittanceAging.over14Days}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">&gt; 21 days</span>
                  <span className="font-medium text-red-600">{summaryQuery.data.codMetrics.remittanceAging.over21Days}</span>
                </div>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardContent className="pt-4 pb-3">
              <div className="flex items-center gap-2 mb-2">
                <PieChart className="h-4 w-4 text-blue-500" />
                <span className="text-sm font-medium text-muted-foreground">COD vs Prepaid</span>
              </div>
              <div className="space-y-1 text-sm">
                <div className="flex justify-between">
                  <span className="text-muted-foreground">COD</span>
                  <span className="font-medium">
                    {summaryQuery.data.codMetrics.split.cod.toLocaleString('en-IN')} ({summaryQuery.data.codMetrics.split.codPercent}%)
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Prepaid</span>
                  <span className="font-medium">
                    {summaryQuery.data.codMetrics.split.prepaid.toLocaleString('en-IN')} ({100 - summaryQuery.data.codMetrics.split.codPercent}%)
                  </span>
                </div>
              </div>
            </CardContent>
          </Card>
        </div>
      )}

      {/* Drilldown Table */}
      {selectedChannel && (
        <Card>
          <CardHeader>
            <div className="flex items-center justify-between">
              <CardTitle className="text-base">{selectedChannel.label} - Order Details</CardTitle>
              <div className="flex items-center gap-2">
                <Checkbox
                  id="unsettled-only"
                  checked={unsettledOnly}
                  onCheckedChange={(checked) => handleUnsettledToggle(checked === true)}
                />
                <label htmlFor="unsettled-only" className="text-sm cursor-pointer select-none">
                  Show unsettled only
                </label>
              </div>
            </div>
          </CardHeader>
          <CardContent>
            {drilldownQuery.isLoading ? (
              <div className="flex items-center justify-center py-8">
                <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
              </div>
            ) : (
              <>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Order #</TableHead>
                      <TableHead>Date</TableHead>
                      <TableHead>Customer</TableHead>
                      <TableHead className="text-right">Amount</TableHead>
                      <TableHead>Invoice #</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead className="text-right">Paid</TableHead>
                      <TableHead className="text-right">Balance Due</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {(drilldownQuery.data?.orders ?? []).length === 0 ? (
                      <TableRow>
                        <TableCell colSpan={8} className="text-center text-muted-foreground py-8">
                          No orders found
                        </TableCell>
                      </TableRow>
                    ) : (
                      (drilldownQuery.data?.orders ?? []).map((order) => (
                        <TableRow key={order.id}>
                          <TableCell className="font-mono text-sm">{order.orderNumber}</TableCell>
                          <TableCell className="text-sm">{formatDate(order.orderDate)}</TableCell>
                          <TableCell className="text-sm">{order.customerName ?? '\u2014'}</TableCell>
                          <TableCell className="text-right text-sm">{formatINR(order.totalAmount)}</TableCell>
                          <TableCell className="text-sm font-mono">
                            {order.invoiceNumber ?? '\u2014'}
                          </TableCell>
                          <TableCell>{getStatusBadge(order.invoiceStatus)}</TableCell>
                          <TableCell className="text-right text-sm">{formatINR(order.invoicePaidAmount)}</TableCell>
                          <TableCell
                            className={`text-right text-sm font-medium ${order.invoiceBalanceDue > 0 ? 'text-red-600' : ''}`}
                          >
                            {formatINR(order.invoiceBalanceDue)}
                          </TableCell>
                        </TableRow>
                      ))
                    )}
                  </TableBody>
                </Table>

                {/* Pagination */}
                {(drilldownQuery.data?.total ?? 0) > 0 && (
                  <div className="flex items-center justify-between pt-4">
                    <p className="text-sm text-muted-foreground">
                      Showing {((page - 1) * 50) + 1}
                      {'\u2013'}
                      {Math.min(page * 50, drilldownQuery.data?.total ?? 0)} of{' '}
                      {drilldownQuery.data?.total?.toLocaleString('en-IN')} orders
                    </p>
                    <div className="flex items-center gap-2">
                      <Button
                        variant="outline"
                        size="sm"
                        disabled={page === 1}
                        onClick={() => setPage((p) => p - 1)}
                      >
                        <ChevronLeft className="h-4 w-4 mr-1" />
                        Previous
                      </Button>
                      <Button
                        variant="outline"
                        size="sm"
                        disabled={page * 50 >= (drilldownQuery.data?.total ?? 0)}
                        onClick={() => setPage((p) => p + 1)}
                      >
                        Next
                        <ChevronRight className="h-4 w-4 ml-1" />
                      </Button>
                    </div>
                  </div>
                )}
              </>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
