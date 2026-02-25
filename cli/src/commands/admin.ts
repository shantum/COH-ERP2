import { Command } from 'commander';
import { api } from '../api.js';
import { heading, field, error, success, warn, table, displayObject } from '../format.js';
import chalk from 'chalk';

export function registerAdminCommands(program: Command): void {
  const admin = program
    .command('admin')
    .description('Admin operations');

  // --- Users ---
  admin
    .command('users')
    .description('List all users')
    .action(async () => {
      const res = await api<Array<{
        id: string;
        name: string;
        email: string;
        role: string;
        isActive: boolean;
        userRole?: { displayName: string } | null;
      }>>('/api/admin/users');

      if (!res.ok) {
        error('Failed to fetch users');
        process.exit(1);
      }

      heading('Users');
      table(
        (Array.isArray(res.data) ? res.data : []).map((u) => ({
          Name: u.name,
          Email: u.email,
          Role: u.userRole?.displayName || u.role,
          Active: u.isActive ? chalk.green('Yes') : chalk.red('No'),
        }))
      );
      console.log();
    });

  // --- Stats ---
  admin
    .command('stats')
    .description('Show system stats')
    .action(async () => {
      const res = await api<Record<string, unknown>>('/api/admin/stats');
      if (!res.ok) {
        error('Failed to fetch stats');
        process.exit(1);
      }
      heading('System Stats');
      displayObject(res.data as Record<string, unknown>);
      console.log();
    });

  // --- Background Jobs ---
  admin
    .command('jobs')
    .description('List background jobs and their status')
    .action(async () => {
      const res = await api<{
        jobs: Array<{
          id: string;
          name: string;
          enabled: boolean;
          isRunning: boolean;
          lastRunAt: string | null;
          lastResult: string | null;
          intervalMinutes?: number;
        }>;
      }>('/api/admin/background-jobs');

      if (!res.ok) {
        error('Failed to fetch jobs');
        process.exit(1);
      }

      heading('Background Jobs');
      table(
        res.data.jobs.map((j) => ({
          ID: j.id,
          Name: j.name,
          Enabled: j.enabled ? chalk.green('On') : chalk.dim('Off'),
          Running: j.isRunning ? chalk.yellow('Running') : '—',
          'Last Run': j.lastRunAt
            ? new Date(j.lastRunAt).toLocaleString('en-IN', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })
            : 'Never',
          Interval: j.intervalMinutes ? `${j.intervalMinutes}m` : '—',
        }))
      );
      console.log();
    });

  admin
    .command('trigger <jobId>')
    .description('Trigger a background job')
    .action(async (jobId: string) => {
      const res = await api<{ success: boolean; error?: string; message?: string }>(
        `/api/admin/background-jobs/${encodeURIComponent(jobId)}/trigger`,
        { method: 'POST' }
      );
      if (!res.ok || !res.data.success) {
        error(res.data.error || 'Trigger failed');
        process.exit(1);
      }
      success(res.data.message || `Job ${jobId} triggered`);
      console.log();
    });

  // --- Worker Runs ---
  admin
    .command('worker-runs')
    .description('Show recent worker run history')
    .action(async () => {
      const res = await api<{
        runs: Array<{
          workerName: string;
          status: string;
          startedAt: string;
          durationMs: number | null;
          result: string | null;
        }>;
      }>('/api/admin/worker-runs');

      if (!res.ok) {
        error('Failed to fetch worker runs');
        process.exit(1);
      }

      heading('Recent Worker Runs');
      table(
        (res.data.runs || []).slice(0, 20).map((r) => ({
          Worker: r.workerName,
          Status: r.status === 'success' ? chalk.green(r.status) : r.status === 'error' ? chalk.red(r.status) : r.status,
          Started: new Date(r.startedAt).toLocaleString('en-IN', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }),
          Duration: r.durationMs ? `${(r.durationMs / 1000).toFixed(1)}s` : '—',
        }))
      );
      console.log();
    });

  // --- Logs ---
  admin
    .command('logs')
    .description('View system logs')
    .action(async () => {
      const res = await api<{
        stats?: Record<string, unknown>;
      }>('/api/admin/logs/stats');

      if (!res.ok) {
        error('Failed to fetch logs');
        process.exit(1);
      }

      heading('Log Stats');
      displayObject((res.data.stats || res.data) as Record<string, unknown>);
      console.log();
    });

  // --- Inspect Tables ---
  admin
    .command('inspect <table>')
    .description('Inspect a database table (orders, customers, products, skus)')
    .option('-l, --limit <n>', 'Limit', '10')
    .option('-o, --offset <n>', 'Offset', '0')
    .action(async (tableName: string, opts: { limit: string; offset: string }) => {
      const validTables = ['orders', 'customers', 'products', 'skus', 'shopify-order-cache', 'shopify-product-cache'];
      if (!validTables.includes(tableName)) {
        error(`Invalid table. Choose from: ${validTables.join(', ')}`);
        process.exit(1);
      }

      const res = await api<{ data: Array<Record<string, unknown>>; total: number }>(
        `/api/admin/inspect/${tableName}?limit=${opts.limit}&offset=${opts.offset}`
      );

      if (!res.ok) {
        error('Failed to inspect table');
        process.exit(1);
      }

      heading(`${tableName} (${res.data.total} total)`);
      if (res.data.data.length === 0) {
        warn('No records found');
      } else {
        // Show first few fields of each record
        for (const record of res.data.data) {
          const keys = Object.keys(record).slice(0, 6);
          const summary = keys.map((k) => {
            const v = record[k];
            if (v === null) return `${k}: —`;
            if (typeof v === 'object') return `${k}: [object]`;
            return `${k}: ${String(v).slice(0, 40)}`;
          }).join('  |  ');
          console.log(`  ${summary}`);
        }
      }
      console.log();
    });

  // --- Channels ---
  admin
    .command('channels')
    .description('List sales channels')
    .action(async () => {
      const res = await api<Record<string, unknown>>('/api/admin/channels');
      if (!res.ok) {
        error('Failed to fetch channels');
        process.exit(1);
      }
      heading('Sales Channels');
      console.log(JSON.stringify(res.data, null, 2));
      console.log();
    });

  // --- Roles ---
  admin
    .command('roles')
    .description('List user roles')
    .action(async () => {
      const res = await api<Array<{
        id: string;
        name: string;
        displayName: string;
        permissions: unknown;
      }>>('/api/admin/roles');

      if (!res.ok) {
        error('Failed to fetch roles');
        process.exit(1);
      }

      heading('User Roles');
      const roles = Array.isArray(res.data) ? res.data : [];
      table(
        roles.map((r) => ({
          Name: r.displayName || r.name,
          ID: r.id.slice(0, 8),
          Permissions: Array.isArray(r.permissions) ? String(r.permissions.length) : '—',
        }))
      );
      console.log();
    });
}
