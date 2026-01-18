/**
 * Queries Router
 * Combines all query sub-routers
 */

import { Router } from 'express';
import viewsRouter from './views.js';
import searchRouter from './search.js';
import searchUnifiedRouter from './searchUnified.js';
import summariesRouter from './summaries.js';
import analyticsRouter from './analytics.js';

const router: Router = Router();

// Mount sub-routers - order matters for route matching
// More specific routes first, then parameterized routes

// Search (specific paths /search-all, /search-unified)
router.use('/', searchRouter);
router.use('/', searchUnifiedRouter);

// Analytics (specific paths /analytics, /dashboard-stats)
router.use('/', analyticsRouter);

// Summaries (specific paths /rto/summary, /shipped/summary, etc.)
router.use('/', summariesRouter);

// Views last (has /:id which matches anything)
router.use('/', viewsRouter);

export default router;
