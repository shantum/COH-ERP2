import { Command } from 'commander';
import { api } from '../api.js';
import { heading, field, error, success, warn, table, displayObject } from '../format.js';
import chalk from 'chalk';

export function registerShopifyCommands(program: Command): void {
  const shopify = program
    .command('shopify')
    .description('Shopify integration');

  // --- Status ---
  shopify
    .command('status')
    .description('Check Shopify connection status')
    .action(async () => {
      const res = await api<Record<string, unknown>>('/api/shopify/status');
      if (!res.ok) {
        error('Failed to fetch Shopify status');
        process.exit(1);
      }
      heading('Shopify Status');
      displayObject(res.data as Record<string, unknown>);
      console.log();
    });

  // --- Inventory ---
  shopify
    .command('inventory <sku>')
    .description('Check Shopify inventory for a SKU')
    .action(async (sku: string) => {
      const res = await api<{
        item?: { sku: string; title: string; tracked: boolean };
        error?: string;
      }>(`/api/shopify/inventory/item/${encodeURIComponent(sku)}`);

      if (!res.ok || !res.data.item) {
        error(res.data.error || 'SKU not found on Shopify');
        process.exit(1);
      }

      heading(`Shopify: ${res.data.item.sku}`);
      field('Title', res.data.item.title);
      field('Tracked', res.data.item.tracked ? 'Yes' : 'No');
      console.log();
    });

  shopify
    .command('locations')
    .description('List Shopify inventory locations')
    .action(async () => {
      const res = await api<{
        locations: Array<{ id: string; name: string; isActive: boolean }>;
      }>('/api/shopify/inventory/locations');

      if (!res.ok) {
        error('Failed to fetch locations');
        process.exit(1);
      }

      heading('Shopify Locations');
      table(
        res.data.locations.map((l) => ({
          Name: l.name,
          ID: l.id,
          Active: l.isActive ? chalk.green('Yes') : chalk.red('No'),
        }))
      );
      console.log();
    });

  // --- Sync ---
  shopify
    .command('sync <type>')
    .description('Trigger Shopify sync (products, customers, backfill, reprocess-cache)')
    .action(async (type: string) => {
      const endpoints: Record<string, string> = {
        products: '/api/shopify/sync/products',
        customers: '/api/shopify/sync/customers',
        'customers-all': '/api/shopify/sync/customers/all',
        backfill: '/api/shopify/sync/backfill',
        'backfill-fulfillments': '/api/shopify/sync/backfill-fulfillments',
        'reprocess-cache': '/api/shopify/sync/reprocess-cache',
        'process-cache': '/api/shopify/sync/process-cache',
      };

      const endpoint = endpoints[type];
      if (!endpoint) {
        error(`Unknown sync type. Choose: ${Object.keys(endpoints).join(', ')}`);
        process.exit(1);
      }

      const res = await api<{ success?: boolean; error?: string; message?: string }>(
        endpoint,
        { method: 'POST' }
      );

      if (!res.ok) {
        error(res.data.error || 'Sync failed');
        process.exit(1);
      }

      success(res.data.message || `Shopify ${type} sync triggered`);
      console.log();
    });

  // --- Order lookup ---
  shopify
    .command('order <orderNumber>')
    .description('Lookup order in Shopify sync')
    .option('--raw', 'Show full raw Shopify data')
    .action(async (orderNumber: string, opts: { raw?: boolean }) => {
      const res = await api<{
        orderNumber?: string;
        financialStatus?: string;
        fulfillmentStatus?: string;
        processedAt?: string;
        processingError?: string | null;
        rawData?: {
          total_price?: string;
          tags?: string;
          customer?: { email?: string; first_name?: string; last_name?: string };
          shipping_address?: { city?: string; province?: string; zip?: string };
          line_items?: Array<{ title?: string; sku?: string; quantity?: number; price?: string }>;
          fulfillments?: Array<{ tracking_number?: string; tracking_company?: string; status?: string }>;
        };
      }>(`/api/shopify/sync/orders/${encodeURIComponent(orderNumber)}`);

      if (!res.ok) {
        error('Order not found in Shopify');
        process.exit(1);
      }

      const d = res.data;
      const raw = d.rawData;
      heading(`Shopify Order: ${d.orderNumber || orderNumber}`);
      field('Financial', d.financialStatus);
      field('Fulfillment', d.fulfillmentStatus);
      field('Total', raw?.total_price ? `₹${raw.total_price}` : null);
      field('Customer', raw?.customer ? `${raw.customer.first_name || ''} ${raw.customer.last_name || ''}`.trim() : null);
      field('Email', raw?.customer?.email);
      field('City', raw?.shipping_address ? `${raw.shipping_address.city}, ${raw.shipping_address.province} ${raw.shipping_address.zip}` : null);
      field('Tags', raw?.tags);
      field('Processed', d.processedAt);
      if (d.processingError) field('Error', d.processingError);

      if (raw?.line_items?.length) {
        console.log();
        heading('Line Items');
        table(raw.line_items.map((li) => ({
          SKU: li.sku || '—',
          Product: (li.title || '—').slice(0, 40),
          Qty: li.quantity || 0,
          Price: li.price ? `₹${li.price}` : '—',
        })));
      }

      if (raw?.fulfillments?.length) {
        console.log();
        heading('Fulfillments');
        for (const f of raw.fulfillments) {
          field('Tracking', f.tracking_number);
          field('Courier', f.tracking_company);
          field('Status', f.status);
        }
      }

      if (opts.raw) {
        console.log();
        heading('Raw Data');
        displayObject(d as Record<string, unknown>);
      }
      console.log();
    });

  // --- Cache Stats ---
  shopify
    .command('cache')
    .description('Show Shopify cache stats')
    .action(async () => {
      const res = await api<Record<string, unknown>>('/api/shopify/cache/cache-stats');
      if (!res.ok) {
        error('Failed to fetch cache stats');
        process.exit(1);
      }
      heading('Shopify Cache Stats');
      displayObject(res.data as Record<string, unknown>);
      console.log();
    });

  // --- Jobs ---
  shopify
    .command('jobs')
    .description('List Shopify sync jobs')
    .action(async () => {
      const res = await api<{
        jobs?: Array<Record<string, unknown>>;
        data?: Array<Record<string, unknown>>;
      }>('/api/shopify/jobs');

      if (!res.ok) {
        error('Failed to fetch jobs');
        process.exit(1);
      }

      const jobs = res.data.jobs || res.data.data || (Array.isArray(res.data) ? res.data : []);
      heading(`Shopify Jobs (${(jobs as Array<Record<string, unknown>>).length})`);
      for (const j of jobs as Array<Record<string, unknown>>) {
        const id = j.id || j.jobId || '—';
        const status = j.status || '—';
        const type = j.type || j.syncType || '—';
        console.log(`  ${id}  ${type}  ${status}`);
      }
      console.log();
    });

  // --- Scheduler ---
  shopify
    .command('scheduler <action>')
    .description('Control Shopify scheduler (status, trigger, start, stop)')
    .action(async (action: string) => {
      if (action === 'status') {
        const res = await api<Record<string, unknown>>('/api/shopify/jobs/scheduler/status');
        if (!res.ok) { error('Failed'); process.exit(1); }
        heading('Shopify Scheduler');
        displayObject(res.data as Record<string, unknown>);
      } else if (['trigger', 'start', 'stop'].includes(action)) {
        const res = await api<{ success?: boolean; error?: string }>(
          `/api/shopify/jobs/scheduler/${action}`,
          { method: 'POST' }
        );
        if (!res.ok) { error(res.data.error || 'Failed'); process.exit(1); }
        success(`Scheduler ${action} executed`);
      } else {
        error('Unknown action. Choose: status, trigger, start, stop');
        process.exit(1);
      }
      console.log();
    });
}
