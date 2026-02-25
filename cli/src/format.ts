/**
 * Output formatting utilities for CLI
 */

import chalk from 'chalk';

export function heading(text: string): void {
  console.log(chalk.bold.cyan(`\n${text}`));
  console.log(chalk.dim('─'.repeat(Math.min(text.length + 4, 60))));
}

export function field(label: string, value: string | number | null | undefined): void {
  const display = value === null || value === undefined ? chalk.dim('—') : String(value);
  console.log(`  ${chalk.gray(label.padEnd(18))} ${display}`);
}

export function success(text: string): void {
  console.log(chalk.green(`✓ ${text}`));
}

export function error(text: string): void {
  console.log(chalk.red(`✗ ${text}`));
}

export function warn(text: string): void {
  console.log(chalk.yellow(`! ${text}`));
}

export function statusColor(status: string): string {
  const s = status.toLowerCase();
  if (s.includes('delivered')) return chalk.green(status);
  if (s.includes('transit') || s.includes('shipped')) return chalk.blue(status);
  if (s.includes('rto') || s.includes('return')) return chalk.yellow(status);
  if (s.includes('cancel') || s.includes('fail')) return chalk.red(status);
  return status;
}

export function json(data: unknown): void {
  console.log(JSON.stringify(data, null, 2));
}

/**
 * Recursively display an object as labeled fields.
 * Handles nested objects, arrays, and primitives.
 */
export function displayObject(obj: Record<string, unknown>, prefix = ''): void {
  for (const [key, value] of Object.entries(obj)) {
    const label = prefix ? `${prefix}.${key}` : key;
    if (value === null || value === undefined) {
      field(label, null);
    } else if (Array.isArray(value)) {
      if (value.length === 0) {
        field(label, '[]');
      } else if (typeof value[0] === 'object') {
        console.log(chalk.gray(`  ${label}: [${value.length} items]`));
      } else {
        field(label, value.join(', '));
      }
    } else if (typeof value === 'object') {
      displayObject(value as Record<string, unknown>, label);
    } else if (typeof value === 'number' && label.toLowerCase().includes('amount')) {
      field(label, `₹${value.toLocaleString()}`);
    } else {
      field(label, String(value));
    }
  }
}

export function table(rows: Record<string, unknown>[], columns?: string[]): void {
  if (rows.length === 0) {
    console.log(chalk.dim('  No results'));
    return;
  }

  const cols = columns || Object.keys(rows[0]);
  const widths = cols.map((c) =>
    Math.max(c.length, ...rows.map((r) => String(r[c] ?? '').length))
  );

  // Header
  const header = cols.map((c, i) => c.padEnd(widths[i])).join('  ');
  console.log(chalk.bold(`  ${header}`));
  console.log(chalk.dim(`  ${widths.map((w) => '─'.repeat(w)).join('──')}`));

  // Rows
  for (const row of rows) {
    const line = cols.map((c, i) => String(row[c] ?? '').padEnd(widths[i])).join('  ');
    console.log(`  ${line}`);
  }
}
