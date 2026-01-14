// Shopify routes - modular composition
// Split from 1873-line monolith into focused modules
import { Router } from 'express';
import settingsRouter from './settings.js';
import previewRouter from './preview.js';
import syncRouter from './sync.js';
import jobsRouter from './jobs.js';
import cacheRouter from './cache.js';
import debugRouter from './debug.js';

const router = Router();

// Settings & status: /config, /test-connection, /status
router.use('/', settingsRouter);

// Preview endpoints: /preview/orders, /preview/customers, /preview/products
router.use('/', previewRouter);

// Sync operations: /sync/products, /sync/customers, /sync/backfill, /sync/full-dump, etc.
router.use('/sync', syncRouter);

// Background jobs: /sync/jobs/*, /sync/scheduler/*, /sync/processor/*, /sync/dump/*
router.use('/sync/jobs', jobsRouter);

// Cache status & maintenance: /sync/cache-status, /sync/cache-stats, /cache/*
router.use('/sync', cacheRouter);
router.use('/cache', cacheRouter);
router.use('/webhooks', cacheRouter);

// Debug endpoints: /debug/locks, /debug/sync-progress, /debug/circuit-breaker
router.use('/debug', debugRouter);

export default router;
