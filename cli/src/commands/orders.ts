import { Command } from 'commander';
import { api } from '../api.js';
import { heading, field, error, statusColor, table } from '../format.js';

export function registerOrderCommands(program: Command): void {
  const orders = program
    .command('order')
    .description('Order lookups');

  orders
    .command('list')
    .description('List recent orders')
    .option('-l, --limit <n>', 'Max results', '20')
    .option('-o, --offset <n>', 'Offset', '0')
    .action(async (opts: { limit: string; offset: string }) => {
      const res = await api<{
        data: Array<{
          id: string;
          orderNumber: string;
          orderDate: string;
          customerName: string | null;
          channel: string | null;
          totalAmount: number;
          paymentMethod: string | null;
          orderLines: Array<{
            trackingStatus: string | null;
            awbNumber: string | null;
            sku: { skuCode: string } | null;
          }>;
          customer: { email: string; firstName: string | null; lastName: string | null } | null;
        }>;
        total: number;
      }>(`/api/admin/inspect/orders?limit=${opts.limit}&offset=${opts.offset}`);

      if (!res.ok) {
        error('Failed to fetch orders');
        process.exit(1);
      }

      heading(`Orders (${res.data.total} total, showing ${res.data.data.length})`);
      table(
        res.data.data.map((o) => ({
          '#': o.orderNumber,
          Customer: o.customerName || '—',
          Date: new Date(o.orderDate).toLocaleDateString('en-IN'),
          Channel: o.channel || '—',
          Amount: `₹${o.totalAmount?.toLocaleString() || 0}`,
          Payment: o.paymentMethod || '—',
          Status: o.orderLines[0]?.trackingStatus
            ? statusColor(o.orderLines[0].trackingStatus)
            : '—',
        }))
      );
      console.log();
    });

  orders
    .command('find <query>')
    .description('Find order by order number (uses tracking endpoint)')
    .action(async (query: string) => {
      const res = await api<{
        success: boolean;
        orderId?: string;
        orderNumber?: string;
        awbNumber?: string;
        courier?: string;
        trackingStatus?: string;
        error?: string;
      }>(`/api/tracking/order-awb/${encodeURIComponent(query)}`);

      if (!res.ok || !res.data.success) {
        error(res.data.error || 'Order not found');
        process.exit(1);
      }

      heading(`Order: ${res.data.orderNumber}`);
      field('AWB', res.data.awbNumber);
      field('Courier', res.data.courier);
      field('Status', res.data.trackingStatus ? statusColor(res.data.trackingStatus) : null);
      console.log();
    });

  orders
    .command('counts')
    .description('Show order view counts from inspect/orders')
    .action(async () => {
      const res = await api<{ total: number }>('/api/admin/inspect/orders?limit=1');
      if (!res.ok) {
        error('Failed to fetch');
        process.exit(1);
      }
      heading('Orders');
      field('Total', res.data.total);
      console.log();
    });
}
