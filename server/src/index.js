// Load environment variables FIRST before any other imports
import dotenv from 'dotenv';
dotenv.config();

// Validate required environment variables
if (!process.env.JWT_SECRET) {
    console.error('FATAL: JWT_SECRET environment variable is required');
    process.exit(1);
}

// Import logger EARLY to capture console.log/warn/error from all subsequent imports
import logger from './utils/logger.js';

import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import cookieParser from 'cookie-parser';
import rateLimit from 'express-rate-limit';
import path from 'path';
import { fileURLToPath } from 'url';
import prisma from './lib/prisma.js';
import initDb from './init-db.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Initialize database if needed
await initDb();

// Import routes
// Products routes migrated to TanStack Start Server Functions
import fabricRoutes from './routes/fabrics/index.js';
import inventoryRoutes from './routes/inventory/index.js';
import inventoryReconciliationRoutes from './routes/inventory-reconciliation.js';
import orderRoutes from './routes/orders/index.js';
import { autoArchiveOldOrders } from './routes/orders/mutations/index.js';
import { backfillLtvsIfNeeded } from './utils/tierUtils.js';
import returnRoutes from './routes/returns/index.js';
// Feedback routes migrated to TanStack Start Server Functions
import authRoutes from './routes/auth.js';
import importExportRoutes from './routes/import-export.js';
import shopifyRoutes from './routes/shopify/index.js';
import adminRoutes from './routes/admin.js';
import webhookRoutes from './routes/webhooks.js';
// Repacking routes migrated to TanStack Start Server Functions
// Tracking routes migrated to TanStack Start Server Functions
import remittanceRoutes from './routes/remittance.js';
import pincodeRoutes from './routes/pincodes.js';
import sseRoutes from './routes/sse.js';
import pulseRoutes from './routes/pulse.js';
import { pulseBroadcaster } from './services/pulseBroadcaster.js';
import materialsRoutes from './routes/materials.js';
import bomRoutes from './routes/bom.js';
import scheduledSync from './services/scheduledSync.js';
import trackingSync from './services/trackingSync.js';
import cacheProcessor from './services/cacheProcessor.js';
import cacheDumpWorker from './services/cacheDumpWorker.js';
import { runAllCleanup } from './utils/cacheCleanup.js';
import { errorHandler } from './middleware/errorHandler.js';
import shutdownCoordinator from './utils/shutdownCoordinator.js';

const app = express();

// Security middleware
app.use(helmet({
    contentSecurityPolicy: {
        directives: {
            defaultSrc: ["'self'"],
            scriptSrc: ["'self'", "'unsafe-inline'"],
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
    max: 1000, // Limit each IP to 1000 requests per windowMs
    message: { error: 'Too many requests, please try again later' },
    standardHeaders: true,
    legacyHeaders: false,
});

// Stricter rate limiting for auth endpoints
const authLimiter = rateLimit({
    windowMs: 15 * 60 * 1000, // 15 minutes
    max: 20, // Limit each IP to 20 login attempts per windowMs
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
        ? process.env.CORS_ORIGIN || true  // Allow same origin in production
        : ['http://localhost:5173', 'http://localhost:5174', 'http://localhost:5175', 'http://127.0.0.1:5173', 'http://127.0.0.1:5174', 'http://localhost:3000', 'http://127.0.0.1:3000'], // Explicit origins for cookie auth in dev
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

// Standard JSON parsing for other routes (increased limit for large reconciliations)
app.use(express.json({ limit: '10mb' }));

// Make prisma available to routes
app.use((req, res, next) => {
  req.prisma = prisma;
  next();
});

// Routes
app.use('/api/auth', authRoutes);
// Products routes migrated to TanStack Start Server Functions
app.use('/api/fabrics', fabricRoutes);
app.use('/api/inventory', inventoryRoutes);
app.use('/api/inventory', inventoryReconciliationRoutes);
app.use('/api/orders', orderRoutes);
app.use('/api/returns', returnRoutes);
// Feedback routes migrated to TanStack Start Server Functions
app.use('/api', importExportRoutes);
app.use('/api/shopify', shopifyRoutes);
app.use('/api/admin', adminRoutes);
app.use('/api/webhooks', webhookRoutes);
// Repacking routes migrated to TanStack Start Server Functions
// Tracking routes migrated to TanStack Start Server Functions
app.use('/api/remittance', remittanceRoutes);
app.use('/api/pincodes', pincodeRoutes);
app.use('/api/events', sseRoutes);
app.use('/api/pulse', pulseRoutes);
app.use('/api/materials', materialsRoutes);
app.use('/api/bom', bomRoutes);

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
    // Database connectivity check
    const dbStart = Date.now();
    await prisma.$queryRaw`SELECT 1`;
    metrics.checks.database = { status: 'ok', latencyMs: Date.now() - dbStart };

    // Orders query performance (count only for speed)
    const ordersStart = Date.now();
    const orderCount = await prisma.order.count({
      where: { isCancelled: false, isArchived: false },
    });
    metrics.checks.ordersQuery = {
      status: 'ok',
      latencyMs: Date.now() - ordersStart,
      openOrderCount: orderCount,
    };

    // Check most recent order update (data freshness)
    const freshnessStart = Date.now();
    const latestOrder = await prisma.order.findFirst({
      orderBy: { updatedAt: 'desc' },
      select: { updatedAt: true },
    });
    const dataAgeMs = latestOrder ? Date.now() - latestOrder.updatedAt.getTime() : null;
    metrics.checks.dataFreshness = {
      status: dataAgeMs !== null && dataAgeMs < 3600000 ? 'ok' : 'stale',
      latencyMs: Date.now() - freshnessStart,
      lastUpdateAgeMs: dataAgeMs,
      lastUpdateAt: latestOrder?.updatedAt?.toISOString() || null,
    };

    // Total response time
    metrics.performance.totalLatencyMs = Date.now() - startTime;
    metrics.status = 'ok';
  } catch (error) {
    metrics.status = 'error';
    metrics.error = error.message;
    metrics.performance.totalLatencyMs = Date.now() - startTime;
  }

  res.json(metrics);
});

// Serve static files from client build in production
if (process.env.NODE_ENV === 'production') {
  const clientBuildPath = path.join(__dirname, '../../client/dist');
  app.use(express.static(clientBuildPath));

  // Handle client-side routing - serve index.html for non-API routes
  app.get('*', (req, res) => {
    if (!req.path.startsWith('/api')) {
      res.sendFile(path.join(clientBuildPath, 'index.html'));
    }
  });
}

// Centralized error handling middleware
// Handles custom errors (ValidationError, NotFoundError, etc.), Prisma errors, and Zod errors
app.use(errorHandler);

const PORT = process.env.PORT || 3001;

// Bind to 0.0.0.0 for Railway/Docker compatibility
app.listen(PORT, '0.0.0.0', async () => {
  console.log(`🚀 COH ERP Server running on port ${PORT}`);

  // Auto-archive shipped orders older than 90 days on startup
  await autoArchiveOldOrders(prisma);

  // Backfill customer LTVs if needed (runs in background)
  await backfillLtvsIfNeeded(prisma);

  // Background workers can be disabled via environment variable
  // Useful when running locally while production is also running
  const disableWorkers = process.env.DISABLE_BACKGROUND_WORKERS === 'true';

  if (disableWorkers) {
    console.log('⚠️  Background workers disabled (DISABLE_BACKGROUND_WORKERS=true)');
  } else {
    // Start hourly Shopify sync scheduler
    scheduledSync.start();

    // Start tracking sync scheduler (every 4 hours)
    trackingSync.start();

    // Start background cache processor (processes pending orders every 30s)
    cacheProcessor.start();

    // Start cache dump worker (auto-resumes incomplete Shopify full dumps)
    cacheDumpWorker.start();

    // Register shutdown handlers for graceful shutdown
    shutdownCoordinator.register('scheduledSync', () => {
      scheduledSync.stop();
    }, 5000);

    shutdownCoordinator.register('trackingSync', () => {
      trackingSync.stop();
    }, 5000);

    shutdownCoordinator.register('cacheProcessor', () => {
      cacheProcessor.stop();
    }, 5000);

    shutdownCoordinator.register('cacheDumpWorker', () => {
      cacheDumpWorker.stop();
    }, 5000);
  }

  // Start Pulse broadcaster (Postgres NOTIFY → SSE)
  // Always enabled - required for real-time UI updates
  pulseBroadcaster.start();
  shutdownCoordinator.register('pulseBroadcaster', async () => {
    await pulseBroadcaster.shutdown();
  }, 5000);

  shutdownCoordinator.register('prisma', async () => {
    await prisma.$disconnect();
  }, 10000);

  // Start daily cache cleanup scheduler (runs at 2 AM)
  const cacheCleanupInterval = setInterval(async () => {
    const hour = new Date().getHours();
    if (hour === 2) {
      console.log('[CacheCleanup] Running scheduled daily cleanup...');
      await runAllCleanup();
    }
  }, 60 * 60 * 1000); // Check every hour

  // Run initial cleanup on startup (in background, don't block)
  setTimeout(() => {
    console.log('[CacheCleanup] Running startup cleanup...');
    runAllCleanup().catch(err => console.error('[CacheCleanup] Startup cleanup error:', err));
  }, 30000); // 30 seconds after startup

  // Register cache cleanup shutdown handler
  shutdownCoordinator.register('cacheCleanup', () => {
    clearInterval(cacheCleanupInterval);
  }, 1000);
});

// ============================================
// GLOBAL ERROR HANDLERS
// ============================================

// Handle uncaught exceptions
process.on('uncaughtException', (error) => {
  logger.fatal({
    type: 'UncaughtException',
    name: error.name,
    message: error.message,
    stack: error.stack,
  }, `Uncaught exception: ${error.message}`);

  // Give logger time to flush, then exit
  setTimeout(() => {
    process.exit(1);
  }, 1000);
});

// Handle unhandled promise rejections
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

// Handle process warnings
process.on('warning', (warning) => {
  logger.warn({
    type: 'ProcessWarning',
    name: warning.name,
    message: warning.message,
    stack: warning.stack,
  }, `Process warning: ${warning.message}`);
});

// Graceful shutdown using coordinator
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
