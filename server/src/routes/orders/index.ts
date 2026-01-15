/**
 * Orders Router
 * Combines all order-related sub-routers
 */

import { Router } from 'express';
import listOrdersRouter from './listOrders.js';
import fulfillmentRouter from './fulfillment.js';
import mutationsRouter from './mutations.js';
import lineStatusRouter from './lineStatus.js';

const router: Router = Router();

// Mount sub-routers - order matters for route matching
// More specific routes first, then parameterized routes
router.use('/', listOrdersRouter);
router.use('/', lineStatusRouter);  // Unified status endpoint (new)
router.use('/', fulfillmentRouter); // Legacy fulfillment endpoints (to be deprecated)
router.use('/', mutationsRouter);

export default router;
