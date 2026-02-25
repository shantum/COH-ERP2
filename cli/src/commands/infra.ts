import { Command } from 'commander';
import { api, getBaseUrl } from '../api.js';
import { heading, field, error, success, displayObject } from '../format.js';
import chalk from 'chalk';

export function registerInfraCommands(program: Command): void {
  const infra = program
    .command('infra')
    .description('Infrastructure & system health');

  infra
    .command('health')
    .description('Check server health')
    .action(async () => {
      const start = Date.now();
      try {
        const res = await fetch(`${getBaseUrl()}/api/pulse/status`);
        const elapsed = Date.now() - start;
        const data = (await res.json()) as Record<string, unknown>;

        heading('Server Health');
        field('Status', res.ok ? chalk.green('Healthy') : chalk.red('Unhealthy'));
        field('Response Time', `${elapsed}ms`);
        for (const [key, value] of Object.entries(data)) {
          if (typeof value !== 'object') {
            field(key, String(value ?? '—'));
          }
        }
      } catch (err) {
        error(`Server unreachable at ${getBaseUrl()}`);
        process.exit(1);
      }
      console.log();
    });

  infra
    .command('pincode <pincode>')
    .description('Lookup pincode info')
    .action(async (pincode: string) => {
      const res = await api<Record<string, unknown>>(
        `/api/pincodes/lookup/${encodeURIComponent(pincode)}`
      );

      if (!res.ok) {
        error('Pincode lookup failed');
        process.exit(1);
      }

      heading(`Pincode: ${pincode}`);
      displayObject(res.data as Record<string, unknown>);
      console.log();
    });

  infra
    .command('pincode-stats')
    .description('Show pincode database stats')
    .action(async () => {
      const res = await api<Record<string, unknown>>('/api/pincodes/stats');
      if (!res.ok) {
        error('Failed to fetch pincode stats');
        process.exit(1);
      }
      heading('Pincode Database');
      displayObject(res.data as Record<string, unknown>);
      console.log();
    });

  // --- Sheet Sync ---
  infra
    .command('sheet-status')
    .description('Show Google Sheet sync status')
    .action(async () => {
      const res = await api<Record<string, unknown>>('/api/admin/sheet-sync/status');
      if (!res.ok) {
        error('Failed to fetch sheet status');
        process.exit(1);
      }
      heading('Sheet Sync Status');
      displayObject(res.data as Record<string, unknown>);
      console.log();
    });

  // --- Sheet Offload ---
  infra
    .command('offload-status')
    .description('Show sheet offload worker status')
    .action(async () => {
      const res = await api<Record<string, unknown>>('/api/admin/sheet-offload/status');
      if (!res.ok) {
        error('Failed to fetch offload status');
        process.exit(1);
      }
      heading('Sheet Offload');
      displayObject(res.data as Record<string, unknown>);
      console.log();
    });

  // --- Webhooks ---
  infra
    .command('webhooks')
    .description('Show webhook status')
    .action(async () => {
      const res = await api<Record<string, unknown>>('/api/webhooks/status');
      if (!res.ok) {
        error('Failed to fetch webhook status');
        process.exit(1);
      }
      heading('Webhook Status');
      displayObject(res.data as Record<string, unknown>);
      console.log();
    });

  // --- Debug ---
  infra
    .command('shopify-debug')
    .description('Show Shopify debug info (locks, sync progress, circuit breaker)')
    .action(async () => {
      const [locks, progress, circuit] = await Promise.all([
        api<Record<string, unknown>>('/api/shopify/debug/locks'),
        api<Record<string, unknown>>('/api/shopify/debug/sync-progress'),
        api<Record<string, unknown>>('/api/shopify/debug/circuit-breaker'),
      ]);

      if (locks.ok) {
        heading('Shopify Locks');
        displayObject(locks.data as Record<string, unknown>);
      }
      if (progress.ok) {
        heading('Sync Progress');
        displayObject(progress.data as Record<string, unknown>);
      }
      if (circuit.ok) {
        heading('Circuit Breaker');
        displayObject(circuit.data as Record<string, unknown>);
      }
      console.log();
    });
}
