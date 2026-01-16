/**
 * Mutations Router
 * Combines all mutation sub-routers
 */

import { Router } from 'express';
import crudRouter from './crud.js';
import lifecycleRouter from './lifecycle.js';
import archiveRouter from './archive.js';
import lineOpsRouter from './lineOps.js';
import customizationRouter from './customization.js';

// Re-export autoArchiveOldOrders for use in server startup
export { autoArchiveOldOrders } from './archive.js';

const router: Router = Router();

// Mount sub-routers - order matters for route matching
// More specific routes first, then parameterized routes

// Archive routes first (specific paths like /auto-archive, /release-to-shipped)
router.use('/', archiveRouter);

// Customization routes (specific paths like /lines/:lineId/customize)
router.use('/', customizationRouter);

// Line operations (specific paths like /lines/:lineId/cancel)
router.use('/', lineOpsRouter);

// Lifecycle routes (paths like /:id/cancel, /:id/hold)
router.use('/', lifecycleRouter);

// CRUD routes last (generic /:id routes)
router.use('/', crudRouter);

export default router;
