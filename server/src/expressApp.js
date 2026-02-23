/**
 * Express App Factory
 *
 * Creates and configures the Express application without starting the server.
 * Used by both:
 * - index.js (standalone Express server for development)
 * - production.js (unified server with TanStack Start for production)
 */

// Validate ALL environment variables using Zod schema
import fs from 'node:fs';
import path from 'node:path';
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
import adminRoutes from './routes/admin/index.js';
import webhookRoutes from './routes/webhooks.js';
import remittanceRoutes from './routes/remittance.js';
import pincodeRoutes from './routes/pincodes.js';
import sseRoutes from './routes/sse.js';
import pulseRoutes from './routes/pulse.js';
import internalRoutes from './routes/internal.js';
import returnsRoutes from './routes/returns.js';
import trackingRoutes from './routes/tracking.js';
import sheetSyncRoutes from './routes/sheetSync.js';
import channelsRoutes from './routes/channels.js';
import financeUploadRoutes from './routes/financeUpload.js';
import bankImportRoutes from './routes/bankImport.js';
import attendanceImportRoutes from './routes/attendanceImport.js';
import chatRoutes from './routes/chat.js';
import returnPrimeWebhooks from './routes/returnPrimeWebhooks.js';
import returnPrimeSync from './routes/returnPrimeSync.js';
import returnPrimeAdminRoutes from './routes/returnPrimeAdminRoutes.js';
import resendWebhookRoutes from './routes/resendWebhook.js';
import { startAllWorkers } from './services/workerRegistry.js';
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

  // Trust reverse proxy (Caddy) for correct IP, cookies, and rate limiting
  app.set('trust proxy', 1);

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
  // validate: false because Express is used as a sub-handler of http.createServer
  // in production.js, which can cause false positives on X-Forwarded-For validation
  // even though trust proxy is correctly set above.
  const apiLimiter = rateLimit({
    windowMs: 15 * 60 * 1000, // 15 minutes
    max: 1000,
    message: { error: 'Too many requests, please try again later' },
    standardHeaders: true,
    legacyHeaders: false,
    validate: { xForwardedForHeader: false },
  });

  // Stricter rate limiting for auth endpoints
  const authLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 20,
    message: { error: 'Too many login attempts, please try again later' },
    standardHeaders: true,
    legacyHeaders: false,
    validate: { xForwardedForHeader: false },
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

  // Capture raw body for Return Prime webhook signature verification
  app.use('/api/webhooks/returnprime', express.json({
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
  app.use('/api/tracking', trackingRoutes);
  app.use('/api/channels', channelsRoutes);
  app.use('/api/admin/sheet-sync', sheetSyncRoutes);
  app.use('/api/finance', financeUploadRoutes);
  app.use('/api/bank-import', bankImportRoutes);
  app.use('/api/attendance-import', attendanceImportRoutes);
  app.use('/api/chat', chatRoutes);

  // Resend inbound email webhook
  app.use('/api/webhooks/resend', resendWebhookRoutes);

  // Return Prime integration
  app.use('/api/webhooks/returnprime', returnPrimeWebhooks);
  app.use('/api/returnprime/admin', returnPrimeAdminRoutes);  // Must be before /api/returnprime
  app.use('/api/returnprime', returnPrimeSync);

  // Health check
  app.get('/api/health', (req, res) => {
    let commit = 'unknown';
    try { commit = fs.readFileSync(path.join(process.cwd(), 'VERSION'), 'utf8').trim(); } catch {}
    res.json({ status: 'ok', timestamp: new Date().toISOString(), commit });
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
  await autoArchiveOldOrders(prisma);
  await backfillLtvsIfNeeded(prisma);
  await startAllWorkers();
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
