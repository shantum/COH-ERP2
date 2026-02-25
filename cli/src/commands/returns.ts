import { Command } from 'commander';
import { api } from '../api.js';
import { heading, field, error, success, statusColor, displayObject } from '../format.js';

export function registerReturnCommands(program: Command): void {
  const returns = program
    .command('return')
    .description('Returns & reverse logistics');

  returns
    .command('serviceability <pincode>')
    .description('Check if pincode supports reverse pickup')
    .action(async (pincode: string) => {
      const res = await api<{
        success: boolean;
        data?: { serviceable: boolean; message?: string; couriers?: string[] };
        error?: string;
      }>('/api/returns/check-serviceability', {
        method: 'POST',
        body: { pincode },
      });

      if (!res.ok || !res.data.success) {
        error(res.data.error || 'Check failed');
        process.exit(1);
      }

      heading(`Pincode: ${pincode}`);
      const d = res.data.data;
      if (d?.serviceable) {
        success('Serviceable for reverse pickup');
        if (d.couriers?.length) field('Couriers', d.couriers.join(', '));
      } else {
        error(d?.message || 'Not serviceable');
      }
      console.log();
    });

  returns
    .command('schedule-pickup <orderLineId>')
    .description('Schedule reverse pickup for an order line')
    .action(async (orderLineId: string) => {
      const res = await api<{
        success: boolean;
        data?: {
          awbNumber: string;
          courier: string;
          lineCount: number;
          batchNumber: string | null;
          estimatedPickupDate?: string;
        };
        error?: string;
      }>('/api/returns/schedule-pickup', {
        method: 'POST',
        body: { orderLineId },
      });

      if (!res.ok || !res.data.success) {
        error(res.data.error || 'Pickup scheduling failed');
        process.exit(1);
      }

      const d = res.data.data!;
      heading('Pickup Scheduled');
      field('AWB', d.awbNumber);
      field('Courier', d.courier);
      field('Lines Grouped', d.lineCount);
      if (d.batchNumber) field('Batch', d.batchNumber);
      if (d.estimatedPickupDate) field('Estimated Pickup', d.estimatedPickupDate);
      console.log();
    });

  returns
    .command('track <awbNumber>')
    .description('Track a return shipment')
    .action(async (awbNumber: string) => {
      const res = await api<{
        status?: string;
        currentStatus?: string;
        error?: string;
      }>(`/api/returns/tracking/${encodeURIComponent(awbNumber)}`);

      if (!res.ok) {
        error(res.data.error || 'Tracking failed');
        process.exit(1);
      }

      heading(`Return Tracking: ${awbNumber}`);
      field('Status', statusColor(res.data.currentStatus || res.data.status || 'Unknown'));
      console.log();
    });

  // Return Prime sync
  returns
    .command('rp-sync')
    .description('Trigger Return Prime sync')
    .option('--status', 'Just show sync status')
    .action(async (opts: { status?: boolean }) => {
      if (opts.status) {
        const res = await api<Record<string, unknown>>('/api/returnprime/admin/sync-status/simple');
        if (!res.ok) {
          error('Failed to fetch sync status');
          process.exit(1);
        }
        heading('Return Prime Sync Status');
        displayObject(res.data as Record<string, unknown>);
      } else {
        const res = await api<{ success: boolean; error?: string; message?: string }>(
          '/api/returnprime/admin/sync',
          { method: 'POST' }
        );
        if (!res.ok || !res.data.success) {
          error(res.data.error || 'Sync failed');
          process.exit(1);
        }
        success(res.data.message || 'Return Prime sync triggered');
      }
      console.log();
    });
}
