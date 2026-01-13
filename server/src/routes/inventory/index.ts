/**
 * @fileoverview Inventory Routes - Ledger-based inventory tracking system
 *
 * Balance Formulas:
 * - Balance = SUM(inward) - SUM(outward)
 * - Available = Balance - SUM(reserved)
 *
 * Transaction Types:
 * - inward: Adds to inventory (production, returns, adjustments)
 * - outward: Removes from inventory (shipped, damaged, adjustments)
 * - reserved: Locks inventory for allocated orders (not shipped yet)
 *
 * Transaction Reasons (TXN_REASON):
 * - production: Finished goods from production
 * - rto_received: Good/unopened items from RTO
 * - return_receipt: Returns inspection completion
 * - adjustment: Manual corrections
 * - order_fulfillment: Shipped orders
 * - damage: Write-offs
 *
 * RTO Condition Logic (Critical):
 * - 'good' OR 'unopened' → Create inward transaction (adds to inventory)
 * - 'damaged' OR 'wrong_product' → Create write-off record (NO inventory added)
 * - Processing updates OrderLine.rtoCondition to prevent duplicate handling
 *
 * Key Gotchas:
 * - /rto-inward-line has idempotency check (prevents duplicate transactions on retry)
 * - quick-inward auto-matches production batches (links via referenceId)
 * - Transaction deletion validates dependencies (blocks if order shipped)
 * - Undo window: 24 hours for inward transactions
 * - Custom SKUs excluded from /balance by default (includeCustomSkus=true to include)
 *
 * Router Structure:
 * - pending.ts: Inward hub, scan lookup, pending queues, RTO processing
 * - balance.ts: Balance queries and stock alerts
 * - transactions.ts: Inward/outward operations, transaction management
 */

import { Router } from 'express';
import pendingRouter from './pending.js';
import balanceRouter from './balance.js';
import transactionsRouter from './transactions.js';

const router: Router = Router();

// Mount sub-routers
// Order matters: More specific routes first, then parameterized routes
router.use('/', pendingRouter);
router.use('/', balanceRouter);
router.use('/', transactionsRouter);

export default router;
