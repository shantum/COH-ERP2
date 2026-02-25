import { Command } from 'commander';
import { api } from '../api.js';
import { heading, field, error, success, table, displayObject } from '../format.js';

export function registerRemittanceCommands(program: Command): void {
  const rem = program
    .command('remittance')
    .alias('cod')
    .description('COD remittance operations');

  rem
    .command('pending')
    .description('Show COD orders awaiting remittance')
    .option('-l, --limit <n>', 'Max results', '50')
    .action(async (opts: { limit: string }) => {
      const res = await api<{
        orders: Array<{
          id: string;
          orderNumber: string;
          customerName: string;
          totalAmount: number;
          orderLines: Array<{ deliveredAt: string | null; awbNumber: string | null; courier: string | null }>;
        }>;
        total: number;
        pendingAmount: number;
      }>(`/api/remittance/pending?limit=${opts.limit}`);

      if (!res.ok) {
        error('Failed to fetch pending remittances');
        process.exit(1);
      }

      heading(`COD Pending Remittance (${res.data.total} orders, ₹${res.data.pendingAmount?.toLocaleString()})`);
      table(
        res.data.orders.map((o) => ({
          '#': o.orderNumber,
          Customer: o.customerName || '—',
          Amount: `₹${o.totalAmount.toLocaleString()}`,
          Delivered: o.orderLines?.[0]?.deliveredAt
            ? new Date(o.orderLines[0].deliveredAt).toLocaleDateString('en-IN')
            : '—',
          AWB: o.orderLines?.[0]?.awbNumber || '—',
        }))
      );
      console.log();
    });

  rem
    .command('summary')
    .description('Show remittance summary')
    .action(async () => {
      const res = await api<Record<string, unknown>>('/api/remittance/summary');
      if (!res.ok) {
        error('Failed to fetch summary');
        process.exit(1);
      }
      heading('Remittance Summary');
      displayObject(res.data as Record<string, unknown>);
      console.log();
    });

  rem
    .command('failed')
    .description('Show failed remittance syncs')
    .action(async () => {
      const res = await api<{
        orders?: Array<{ orderNumber: string; error: string }>;
        count?: number;
      }>('/api/remittance/failed');

      if (!res.ok) {
        error('Failed to fetch');
        process.exit(1);
      }
      heading(`Failed Remittances (${res.data.count || 0})`);
      if (res.data.orders?.length) {
        table(res.data.orders.map((o) => ({ Order: o.orderNumber, Error: o.error })));
      } else {
        success('No failures');
      }
      console.log();
    });

  rem
    .command('history')
    .description('Show remittance history')
    .action(async () => {
      const res = await api<Record<string, unknown>>('/api/remittance/history');
      if (!res.ok) {
        error('Failed to fetch history');
        process.exit(1);
      }
      heading('Remittance History');
      console.log(JSON.stringify(res.data, null, 2));
      console.log();
    });

  rem
    .command('trigger-sync')
    .description('Trigger COD remittance sync')
    .action(async () => {
      const res = await api<{ success: boolean; error?: string; message?: string }>(
        '/api/remittance/trigger-sync',
        { method: 'POST' }
      );
      if (!res.ok || !res.data.success) {
        error(res.data.error || 'Sync trigger failed');
        process.exit(1);
      }
      success(res.data.message || 'Remittance sync triggered');
      console.log();
    });

  rem
    .command('sync-status')
    .description('Show sync status')
    .action(async () => {
      const res = await api<Record<string, unknown>>('/api/remittance/sync-status');
      if (!res.ok) {
        error('Failed to fetch sync status');
        process.exit(1);
      }
      heading('Remittance Sync Status');
      displayObject(res.data as Record<string, unknown>);
      console.log();
    });

  rem
    .command('match')
    .description('Match unprocessed COD remittances')
    .action(async () => {
      const res = await api<{ success: boolean; error?: string; matched?: number }>(
        '/api/remittance/match-unprocessed',
        { method: 'POST' }
      );
      if (!res.ok || !res.data.success) {
        error(res.data.error || 'Matching failed');
        process.exit(1);
      }
      success(`Matched ${res.data.matched || 0} orders`);
      console.log();
    });
}
