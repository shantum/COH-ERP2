#!/usr/bin/env node

import { Command } from 'commander';
import { registerAuthCommands } from './commands/auth.js';
import { registerTrackingCommands } from './commands/tracking.js';
import { registerOrderCommands } from './commands/orders.js';
import { registerStockCommands } from './commands/stock.js';
import { registerReturnCommands } from './commands/returns.js';
import { registerRemittanceCommands } from './commands/remittance.js';
import { registerFinanceCommands } from './commands/finance.js';
import { registerShopifyCommands } from './commands/shopify.js';
import { registerAdminCommands } from './commands/admin.js';
import { registerInfraCommands } from './commands/infra.js';

const program = new Command();

program
  .name('coh')
  .description('COH ERP CLI — quick lookups and operations')
  .version('1.0.0');

// Auth (top-level)
registerAuthCommands(program);

// Domain commands
registerTrackingCommands(program);
registerOrderCommands(program);
registerStockCommands(program);
registerReturnCommands(program);
registerRemittanceCommands(program);
registerFinanceCommands(program);
registerShopifyCommands(program);

// System commands
registerAdminCommands(program);
registerInfraCommands(program);

// Filter out bare '--' that pnpm injects when forwarding args
const args = process.argv.filter((a) => a !== '--');
program.parse(args);
