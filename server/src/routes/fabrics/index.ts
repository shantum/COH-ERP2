/**
 * @fileoverview Fabric Inventory Routes - Ledger-based fabric tracking and procurement
 *
 * Fabric Hierarchy:
 * - FabricType: Material category (e.g., "Cotton", "Silk") with default costs
 * - Fabric: Specific color (e.g., "Red Cotton") with optional cost overrides
 *
 * Balance Calculation:
 * - Balance = SUM(inward) - SUM(outward)
 * - Inward: Supplier receipts, reconciliation adjustments
 * - Outward: Production consumption, reconciliation adjustments
 *
 * Cost Cascade (Fabric -> FabricType):
 * - Fabric.costPerUnit ?? FabricType.defaultCostPerUnit
 * - Null at Fabric level = inherit from FabricType
 * - Same pattern for leadTimeDays and minOrderQty
 *
 * Key Endpoints:
 * - /flat: AG-Grid optimized endpoint with view='type'|'color'
 * - /reconciliation/*: Physical count workflow with variance tracking
 * - /dashboard/stock-analysis: Reorder point calculations
 *
 * Gotchas:
 * - Default fabric type is protected (cannot rename or add colors)
 * - Deleting fabric reassigns variations to Default fabric
 * - /flat endpoint uses chunkProcess (batch size 5) to prevent connection pool exhaustion
 * - Reconciliation creates adjustment transactions (inward for +ve variance, outward for -ve)
 *
 * Router Structure:
 * - fabricTypes.ts: Fabric type CRUD operations
 * - colors.ts: Fabric color CRUD, listing, analysis, top fabrics
 * - transactions.ts: Transactions, balance queries, suppliers, orders
 * - reconciliation.ts: Reconciliation workflow
 */

import { Router } from 'express';
import fabricTypesRouter from './fabricTypes.js';
import colorsRouter from './colors.js';
import transactionsRouter from './transactions.js';
import reconciliationRouter from './reconciliation.js';

const router: Router = Router();

// Mount sub-routers
// Order matters: More specific routes first, then parameterized routes
router.use('/', fabricTypesRouter);    // /types, /types/:id
router.use('/', colorsRouter);         // /, /:id, /flat, /filters, /top-fabrics
router.use('/', transactionsRouter);   // /transactions/*, /:id/transactions, /dashboard/*, /suppliers/*, /orders/*
router.use('/', reconciliationRouter); // /reconciliation/*

export default router;
