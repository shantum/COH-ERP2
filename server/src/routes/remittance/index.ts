/**
 * @module routes/remittance
 * @description COD remittance reconciliation with Shopify sync
 *
 * CSV Upload Workflow:
 * 1. Parse CSV (expected columns: Order No., AWB NO., Price, Remittance Date, Remittance UTR)
 * 2. Match orders by orderNumber, validate amount (5% tolerance)
 * 3. Update order: codRemittedAt, codRemittanceUtr, codRemittedAmount, codShopifySyncStatus
 * 4. Auto-sync to Shopify if order has shopifyOrderId (creates transaction via markOrderAsPaid)
 * 5. Track date range in SystemSetting (earliest/latest remittance dates)
 *
 * Sync Statuses: 'pending', 'synced', 'failed', 'manual_review' (>5% amount mismatch)
 * Shopify Sync: markOrderAsPaid() creates transaction, updates financial_status to 'paid'
 *
 * Gotchas:
 * - CSV BOM handling (0xFEFF)
 * - Date parsing supports "DD-Mon-YY" format (e.g., "06-Jan-26")
 * - Amount mismatch >5% flags for manual_review
 * - Already-paid orders skipped (codRemittedAt not null)
 *
 * @see services/shopify.ts - markOrderAsPaid method
 */

import { Router } from 'express';
import { requireAdmin } from '../../middleware/auth.js';
import uploadRoutes from './uploadRoutes.js';
import queryRoutes from './queryRoutes.js';
import shopifySyncRoutes from './shopifySyncRoutes.js';
import adminRoutes from './adminRoutes.js';

const router: Router = Router();

// All remittance routes require admin access
router.use(requireAdmin);

// Mount sub-routers
router.use(uploadRoutes);
router.use(queryRoutes);
router.use(shopifySyncRoutes);
router.use(adminRoutes);

export default router;
