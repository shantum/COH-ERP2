/**
 * Orders Router
 * Combines all order-related sub-routers
 */

import { Router } from 'express';
import listOrdersRouter from './listOrders.js';
import fulfillmentRouter from './fulfillment.js';
import mutationsRouter from './mutations.js';

const router: Router = Router();

// Mount sub-routers - order matters for route matching
// More specific routes first, then parameterized routes
router.use('/', listOrdersRouter);
router.use('/', fulfillmentRouter);
router.use('/', mutationsRouter);

export default router;
