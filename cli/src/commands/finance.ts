import { Command } from 'commander';
import { api } from '../api.js';
import { heading, field, error, success, table, displayObject } from '../format.js';
import chalk from 'chalk';

export function registerFinanceCommands(program: Command): void {
  const fin = program
    .command('finance')
    .alias('fin')
    .description('Finance, settlements & payouts');

  // --- RazorpayX ---
  fin
    .command('rpx-status')
    .description('Check RazorpayX configuration & balance')
    .action(async () => {
      const res = await api<{
        configured: boolean;
        balance: number | null;
        error?: string;
      }>('/api/razorpayx/status');

      if (!res.ok) {
        error('Failed to fetch RazorpayX status');
        process.exit(1);
      }

      heading('RazorpayX');
      field('Configured', res.data.configured ? chalk.green('Yes') : chalk.red('No'));
      if (res.data.balance !== null) {
        field('Balance', `₹${res.data.balance.toLocaleString()}`);
      }
      console.log();
    });

  fin
    .command('payout <invoiceId>')
    .description('Create payout for an invoice via RazorpayX')
    .option('-m, --mode <mode>', 'Payment mode (NEFT, RTGS, IMPS, UPI)')
    .option('--queue', 'Queue if low balance')
    .action(async (invoiceId: string, opts: { mode?: string; queue?: boolean }) => {
      const res = await api<{
        success: boolean;
        payout?: { id: string; status: string; amount: number; mode: string; utr: string | null };
        error?: string;
      }>('/api/razorpayx/payout', {
        method: 'POST',
        body: {
          invoiceId,
          ...(opts.mode ? { mode: opts.mode } : {}),
          ...(opts.queue ? { queueIfLowBalance: true } : {}),
        },
      });

      if (!res.ok || !res.data.success) {
        error(res.data.error || 'Payout failed');
        process.exit(1);
      }

      const p = res.data.payout!;
      heading('Payout Created');
      field('Payout ID', p.id);
      field('Status', p.status);
      field('Amount', `₹${p.amount.toLocaleString()}`);
      field('Mode', p.mode);
      if (p.utr) field('UTR', p.utr);
      console.log();
    });

  fin
    .command('payout-status <payoutId>')
    .description('Check payout status')
    .action(async (payoutId: string) => {
      const res = await api<{
        id: string;
        status: string;
        amount: number;
        mode: string;
        utr: string | null;
        failureReason: string | null;
      }>(`/api/razorpayx/payout/${encodeURIComponent(payoutId)}`);

      if (!res.ok) {
        error('Failed to fetch payout');
        process.exit(1);
      }

      heading(`Payout: ${res.data.id}`);
      field('Status', res.data.status === 'processed' ? chalk.green(res.data.status) : res.data.status);
      field('Amount', `₹${res.data.amount.toLocaleString()}`);
      field('Mode', res.data.mode);
      if (res.data.utr) field('UTR', res.data.utr);
      if (res.data.failureReason) field('Failure', chalk.red(res.data.failureReason));
      console.log();
    });

  // --- Razorpay Settlement ---
  fin
    .command('rp-settlements')
    .description('List Razorpay settlement reports')
    .action(async () => {
      const res = await api<{
        reports?: Array<Record<string, unknown>>;
      }>('/api/razorpay-settlement/reports');

      if (!res.ok) {
        error('Failed to fetch settlement reports');
        process.exit(1);
      }

      heading('Razorpay Settlement Reports');
      const reports = res.data.reports || [];
      if (reports.length === 0) {
        console.log('  No reports found');
      } else {
        for (const r of reports) {
          console.log(`  ${r.id || '—'}  ${r.status || '—'}  ${r.createdAt || '—'}`);
        }
      }
      console.log();
    });

  // --- PayU Settlement ---
  fin
    .command('payu-status')
    .description('Show PayU settlement sync status')
    .action(async () => {
      const res = await api<Record<string, unknown>>('/api/payu-settlement/sync-status');
      if (!res.ok) {
        error('Failed to fetch PayU status');
        process.exit(1);
      }
      heading('PayU Settlement');
      displayObject(res.data as Record<string, unknown>);
      console.log();
    });

  fin
    .command('payu-sync')
    .description('Trigger PayU settlement sync')
    .action(async () => {
      const res = await api<{ success?: boolean; error?: string }>(
        '/api/payu-settlement/trigger-sync',
        { method: 'POST' }
      );
      if (!res.ok) {
        error(res.data.error || 'Sync failed');
        process.exit(1);
      }
      success('PayU settlement sync triggered');
      console.log();
    });

  fin
    .command('payu-history')
    .description('Show PayU settlement history')
    .action(async () => {
      const res = await api<Record<string, unknown>>('/api/payu-settlement/history');
      if (!res.ok) {
        error('Failed to fetch PayU history');
        process.exit(1);
      }
      heading('PayU History');
      console.log(JSON.stringify(res.data, null, 2));
      console.log();
    });

  // --- Marketplace Payout ---
  fin
    .command('mp-reports')
    .description('List marketplace payout reports')
    .action(async () => {
      const res = await api<{
        reports?: Array<Record<string, unknown>>;
      }>('/api/marketplace-payout/reports');

      if (!res.ok) {
        error('Failed to fetch marketplace payout reports');
        process.exit(1);
      }

      heading('Marketplace Payout Reports');
      const reports = res.data.reports || [];
      if (reports.length === 0) {
        console.log('  No reports found');
      } else {
        for (const r of reports) {
          console.log(`  ${r.id || '—'}  ${r.status || '—'}  ${r.createdAt || '—'}`);
        }
      }
      console.log();
    });

  // --- Drive Sync ---
  fin
    .command('drive-status')
    .description('Check Google Drive finance sync status')
    .action(async () => {
      const res = await api<Record<string, unknown>>('/api/finance/drive/status');
      if (!res.ok) {
        error('Failed to fetch drive status');
        process.exit(1);
      }
      heading('Drive Finance Sync');
      displayObject(res.data as Record<string, unknown>);
      console.log();
    });

  fin
    .command('drive-sync')
    .description('Trigger Google Drive finance sync')
    .action(async () => {
      const res = await api<{ success?: boolean; error?: string }>(
        '/api/finance/drive/sync',
        { method: 'POST' }
      );
      if (!res.ok) {
        error(res.data.error || 'Drive sync failed');
        process.exit(1);
      }
      success('Drive finance sync triggered');
      console.log();
    });
}
