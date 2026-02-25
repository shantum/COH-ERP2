import { Command } from 'commander';
import { api } from '../api.js';
import { heading, field, error, statusColor, json, warn } from '../format.js';

interface TrackingLookupResponse {
  success: boolean;
  awbNumber: string;
  error?: string;
  trackingData?: {
    status: string;
    currentStatus: string;
    estimatedDelivery?: string;
    deliveredAt?: string;
    currentLocation?: string;
    scans?: Array<{
      time: string;
      location: string;
      status: string;
      remarks?: string;
    }>;
    [key: string]: unknown;
  };
  rawApiResponse?: unknown;
}

interface OrderAwbResponse {
  success: boolean;
  orderId?: string;
  orderNumber?: string;
  awbNumber?: string;
  courier?: string;
  trackingStatus?: string;
  error?: string;
}

export function registerTrackingCommands(program: Command): void {
  const track = program
    .command('track')
    .description('Tracking lookups');

  track
    .command('awb <awbNumber>')
    .description('Lookup tracking by AWB number')
    .option('--raw', 'Show raw API response')
    .action(async (awbNumber: string, opts: { raw?: boolean }) => {
      const res = await api<TrackingLookupResponse>(
        `/api/tracking/lookup/${encodeURIComponent(awbNumber)}`
      );

      if (!res.ok || !res.data.success) {
        error(res.data.error || 'Tracking lookup failed');
        if (res.data.rawApiResponse && opts.raw) {
          json(res.data.rawApiResponse);
        }
        process.exit(1);
      }

      const t = res.data.trackingData;
      heading(`AWB: ${awbNumber}`);

      if (t) {
        field('Status', statusColor(t.currentStatus || t.status || 'Unknown'));
        if (t.currentLocation) field('Location', t.currentLocation);
        if (t.estimatedDelivery) field('ETA', t.estimatedDelivery);
        if (t.deliveredAt) field('Delivered', t.deliveredAt);

        if (t.scans && t.scans.length > 0) {
          console.log();
          heading('Timeline');
          for (const scan of t.scans.slice(0, 10)) {
            const time = new Date(scan.time).toLocaleString('en-IN', {
              day: '2-digit',
              month: 'short',
              hour: '2-digit',
              minute: '2-digit',
            });
            console.log(`  ${time}  ${scan.location || ''}  ${scan.status}${scan.remarks ? ` — ${scan.remarks}` : ''}`);
          }
          if (t.scans.length > 10) {
            warn(`  ... and ${t.scans.length - 10} more scans`);
          }
        }
      }

      if (opts.raw) {
        console.log();
        heading('Raw Response');
        json(res.data.rawApiResponse);
      }

      console.log();
    });

  track
    .command('order <orderNumber>')
    .description('Lookup AWB by order number')
    .action(async (orderNumber: string) => {
      const res = await api<OrderAwbResponse>(
        `/api/tracking/order-awb/${encodeURIComponent(orderNumber)}`
      );

      if (!res.ok || !res.data.success) {
        error(res.data.error || 'Order lookup failed');
        process.exit(1);
      }

      heading(`Order: ${res.data.orderNumber}`);
      field('AWB', res.data.awbNumber);
      field('Courier', res.data.courier);
      field('Status', res.data.trackingStatus ? statusColor(res.data.trackingStatus) : null);
      console.log();
    });

  track
    .command('history <awbNumber>')
    .description('Show stored tracking responses (admin)')
    .option('-l, --limit <n>', 'Number of responses', '5')
    .action(async (awbNumber: string, opts: { limit: string }) => {
      const res = await api<{
        success: boolean;
        awbNumber: string;
        count: number;
        responses: Array<{
          id: string;
          source: string;
          statusCode: number;
          response: unknown;
          createdAt: string;
        }>;
        error?: string;
      }>(`/api/tracking/${encodeURIComponent(awbNumber)}/responses?limit=${opts.limit}`);

      if (!res.ok) {
        error(res.data.error || 'Failed to fetch history');
        process.exit(1);
      }

      heading(`Tracking History: ${awbNumber} (${res.data.count} responses)`);
      for (const r of res.data.responses) {
        const time = new Date(r.createdAt).toLocaleString('en-IN');
        console.log(`\n  ${time}  [${r.source}] HTTP ${r.statusCode}`);
        json(r.response);
      }
      console.log();
    });
}
