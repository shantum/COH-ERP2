import { Command } from 'commander';
import { api } from '../api.js';
import { heading, error, table } from '../format.js';
import chalk from 'chalk';

interface SkuRecord {
  id: string;
  skuCode: string;
  size: string | null;
  currentBalance: number;
  variation: {
    colorName: string | null;
    product: { name: string; styleCode: string | null } | null;
  } | null;
}

export function registerStockCommands(program: Command): void {
  program
    .command('stock [search]')
    .description('Check stock levels. Search by SKU or leave blank for all.')
    .option('-l, --limit <n>', 'Max results', '50')
    .option('--low', 'Show only low stock (< 3)')
    .option('--zero', 'Show only zero stock')
    .action(async (search: string | undefined, opts: { limit: string; low?: boolean; zero?: boolean }) => {
      const res = await api<{ data: SkuRecord[]; total: number }>(
        `/api/admin/inspect/skus?limit=${opts.limit}`
      );

      if (!res.ok) {
        error('Failed to fetch inventory');
        process.exit(1);
      }

      let items = res.data.data;

      // Client-side search filter
      if (search) {
        const q = search.toLowerCase();
        items = items.filter(
          (i) =>
            i.skuCode.toLowerCase().includes(q) ||
            (i.variation?.product?.name || '').toLowerCase().includes(q) ||
            (i.variation?.product?.styleCode || '').toLowerCase().includes(q) ||
            (i.variation?.colorName || '').toLowerCase().includes(q)
        );
      }

      if (opts.zero) {
        items = items.filter((i) => i.currentBalance === 0);
      } else if (opts.low) {
        items = items.filter((i) => i.currentBalance > 0 && i.currentBalance < 3);
      }

      heading(
        search
          ? `Stock: "${search}" (${items.length} results)`
          : `Stock Levels (${items.length} of ${res.data.total})`
      );

      table(
        items.map((i) => ({
          SKU: i.skuCode,
          Product: i.variation?.product?.name || '—',
          Style: i.variation?.product?.styleCode || '—',
          Colour: i.variation?.colorName || '—',
          Size: i.size || '—',
          Qty:
            i.currentBalance === 0
              ? chalk.red(String(i.currentBalance))
              : i.currentBalance < 3
                ? chalk.yellow(String(i.currentBalance))
                : chalk.green(String(i.currentBalance)),
        }))
      );
      console.log();
    });
}
