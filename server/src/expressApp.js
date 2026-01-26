/**
 * Express App Factory
 *
 * Creates and configures the Express application without starting the server.
 * Used by both:
 * - index.js (standalone Express server for development)
 * - production.js (unified server with TanStack Start for production)
 */

// Validate ALL environment variables using Zod schema
import './config/env.js';

// Import logger EARLY to capture console.log/warn/error from all subsequent imports
import logger from './utils/logger.js';

import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import cookieParser from 'cookie-parser';
import rateLimit from 'express-rate-limit';
import prisma from './lib/prisma.js';
import initDb from './init-db.js';

// Import routes
import inventoryReconciliationRoutes from './routes/inventory-reconciliation.js';
import { autoArchiveOldOrders } from './services/autoArchive.js';
import { backfillLtvsIfNeeded } from './utils/tierUtils.js';
import authRoutes from './routes/auth.js';
import importExportRoutes from './routes/import-export.js';
import shopifyRoutes from './routes/shopify/index.js';
import adminRoutes from './routes/admin.js';
import webhookRoutes from './routes/webhooks.js';
import remittanceRoutes from './routes/remittance.js';
import pincodeRoutes from './routes/pincodes.js';
import sseRoutes from './routes/sse.js';
import pulseRoutes from './routes/pulse.js';
import internalRoutes from './routes/internal.js';
import returnsRoutes from './routes/returns.js';
import { pulseBroadcaster } from './services/pulseBroadcaster.js';
import scheduledSync from './services/scheduledSync.js';
import trackingSync from './services/trackingSync.js';
import cacheProcessor from './services/cacheProcessor.js';
import cacheDumpWorker from './services/cacheDumpWorker.js';
import { runAllCleanup } from './utils/cacheCleanup.js';
import { errorHandler } from './middleware/errorHandler.js';
import shutdownCoordinator from './utils/shutdownCoordinator.js';

/**
 * Creates the Express application with all middleware and routes configured.
 * Does NOT start listening - caller is responsible for that.
 *
 * @returns {Promise<express.Application>} Configured Express app
 */
export async function createExpressApp() {
  // Initialize database if needed
  await initDb();

  const app = express();

  // Security middleware - relaxed CSP for SSR
  app.use(helmet({
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'", "'unsafe-inline'", "'unsafe-eval'"], // unsafe-eval needed for SSR hydration
        styleSrc: ["'self'", "'unsafe-inline'"],
        imgSrc: ["'self'", "data:", "blob:", "https://cdn.shopify.com"],
        connectSrc: ["'self'"],
        fontSrc: ["'self'", "data:"],
        objectSrc: ["'none'"],
        frameSrc: ["'none'"],
      },
    },
  }));

  // Rate limiting - general API
  const apiLimiter = rateLimit({
    windowMs: 15 * 60 * 1000, // 15 minutes
    max: 1000,
    message: { error: 'Too many requests, please try again later' },
    standardHeaders: true,
    legacyHeaders: false,
  });

  // Stricter rate limiting for auth endpoints
  const authLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 20,
    message: { error: 'Too many login attempts, please try again later' },
    standardHeaders: true,
    legacyHeaders: false,
  });

  // Apply rate limiting
  app.use('/api', apiLimiter);
  app.use('/api/auth/login', authLimiter);
  app.use('/api/auth/register', authLimiter);

  // CORS configuration
  app.use(cors({
    origin: process.env.NODE_ENV === 'production'
      ? process.env.CORS_ORIGIN || true
      : ['http://localhost:5173', 'http://localhost:5174', 'http://localhost:5175', 'http://127.0.0.1:5173', 'http://127.0.0.1:5174', 'http://localhost:3000', 'http://127.0.0.1:3000'],
    credentials: true,
  }));

  // Cookie parser for auth_token cookie
  app.use(cookieParser());

  // Capture raw body for webhook signature verification
  app.use('/api/webhooks', express.json({
    verify: (req, res, buf) => {
      req.rawBody = buf.toString();
    }
  }));

  // Standard JSON parsing for other routes
  app.use(express.json({ limit: '10mb' }));

  // Make prisma available to routes
  app.use((req, res, next) => {
    req.prisma = prisma;
    next();
  });

  // Routes
  app.use('/api/auth', authRoutes);
  app.use('/api/inventory', inventoryReconciliationRoutes);
  app.use('/api', importExportRoutes);
  app.use('/api/shopify', shopifyRoutes);
  app.use('/api/admin', adminRoutes);
  app.use('/api/webhooks', webhookRoutes);
  app.use('/api/remittance', remittanceRoutes);
  app.use('/api/pincodes', pincodeRoutes);
  app.use('/api/events', sseRoutes);
  app.use('/api/pulse', pulseRoutes);
  app.use('/api/internal', internalRoutes);
  app.use('/api/returns', returnsRoutes);

  // Health check
  app.get('/api/health', (req, res) => {
    res.json({ status: 'ok', timestamp: new Date().toISOString() });
  });

  // Production health check with performance metrics
  app.get('/api/health/production', async (req, res) => {
    const startTime = Date.now();
    const metrics = {
      status: 'ok',
      timestamp: new Date().toISOString(),
      checks: {},
      performance: {},
    };

    try {
      const dbStart = Date.now();
      await prisma.$queryRaw`SELECT 1`;
      metrics.checks.database = { status: 'ok', latencyMs: Date.now() - dbStart };

      const ordersStart = Date.now();
      // Count non-archived orders (isCancelled removed - use line-level status)
      const orderCount = await prisma.order.count({
        where: { isArchived: false },
      });
      metrics.checks.ordersQuery = {
        status: 'ok',
        latencyMs: Date.now() - ordersStart,
        openOrderCount: orderCount,
      };

      const freshnessStart = Date.now();
      const latestOrder = await prisma.order.findFirst({
        orderBy: { createdAt: 'desc' },
        select: { createdAt: true },
      });
      const dataAgeMs = latestOrder ? Date.now() - latestOrder.createdAt.getTime() : null;
      metrics.checks.dataFreshness = {
        status: dataAgeMs !== null && dataAgeMs < 3600000 ? 'ok' : 'stale',
        latencyMs: Date.now() - freshnessStart,
        lastUpdateAgeMs: dataAgeMs,
        lastUpdateAt: latestOrder?.createdAt?.toISOString() || null,
      };

      metrics.performance.totalLatencyMs = Date.now() - startTime;
      metrics.status = 'ok';
    } catch (error) {
      metrics.status = 'error';
      metrics.error = error.message;
      metrics.performance.totalLatencyMs = Date.now() - startTime;
    }

    res.json(metrics);
  });

  // Centralized error handling middleware
  app.use(errorHandler);

  return app;
}

/**
 * Starts background workers and services.
 * Call this after the server is listening.
 */
export async function startBackgroundWorkers() {
  // Auto-archive shipped orders older than 90 days
  await autoArchiveOldOrders(prisma);

  // Backfill customer LTVs if needed
  await backfillLtvsIfNeeded(prisma);

  const disableWorkers = process.env.DISABLE_BACKGROUND_WORKERS === 'true';

  if (disableWorkers) {
    console.log('⚠️  Background workers disabled (DISABLE_BACKGROUND_WORKERS=true)');
  } else {
    scheduledSync.start();
    trackingSync.start();
    cacheProcessor.start();
    cacheDumpWorker.start();

    shutdownCoordinator.register('scheduledSync', () => scheduledSync.stop(), 5000);
    shutdownCoordinator.register('trackingSync', () => trackingSync.stop(), 5000);
    shutdownCoordinator.register('cacheProcessor', () => cacheProcessor.stop(), 5000);
    shutdownCoordinator.register('cacheDumpWorker', () => cacheDumpWorker.stop(), 5000);
  }

  // Start Pulse broadcaster
  pulseBroadcaster.start();
  shutdownCoordinator.register('pulseBroadcaster', async () => {
    await pulseBroadcaster.shutdown();
  }, 5000);

  shutdownCoordinator.register('prisma', async () => {
    await prisma.$disconnect();
  }, 10000);

  // Cache cleanup scheduler
  const cacheCleanupInterval = setInterval(async () => {
    const hour = new Date().getHours();
    if (hour === 2) {
      console.log('[CacheCleanup] Running scheduled daily cleanup...');
      await runAllCleanup();
    }
  }, 60 * 60 * 1000);

  setTimeout(() => {
    console.log('[CacheCleanup] Running startup cleanup...');
    runAllCleanup().catch(err => console.error('[CacheCleanup] Startup cleanup error:', err));
  }, 30000);

  shutdownCoordinator.register('cacheCleanup', () => {
    clearInterval(cacheCleanupInterval);
  }, 1000);
}

/**
 * Sets up global error handlers and shutdown hooks.
 */
export function setupGlobalHandlers() {
  process.on('uncaughtException', (error) => {
    logger.fatal({
      type: 'UncaughtException',
      name: error.name,
      message: error.message,
      stack: error.stack,
    }, `Uncaught exception: ${error.message}`);

    setTimeout(() => {
      process.exit(1);
    }, 1000);
  });

  process.on('unhandledRejection', (reason, promise) => {
    logger.error({
      type: 'UnhandledRejection',
      reason: reason instanceof Error ? {
        name: reason.name,
        message: reason.message,
        stack: reason.stack,
      } : reason,
      promise: promise.toString(),
    }, `Unhandled promise rejection: ${reason}`);
  });

  process.on('warning', (warning) => {
    logger.warn({
      type: 'ProcessWarning',
      name: warning.name,
      message: warning.message,
      stack: warning.stack,
    }, `Process warning: ${warning.message}`);
  });

  process.on('SIGTERM', async () => {
    logger.info('SIGTERM received, shutting down gracefully...');
    await shutdownCoordinator.shutdown();
    logger.info('Server shut down complete');
    process.exit(0);
  });

  process.on('SIGINT', async () => {
    logger.info('SIGINT received, shutting down gracefully...');
    await shutdownCoordinator.shutdown();
    logger.info('Server shut down complete');
    process.exit(0);
  });
}

// Re-export for convenience
export { prisma, logger, shutdownCoordinator };
