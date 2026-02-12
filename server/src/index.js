// Validate ALL environment variables using Zod schema
// dotenv.config() is called inside env.ts before validation
// This will fail fast with clear error messages if required vars are missing
import './config/env.js';

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
// Products, orders, materials, fabrics, BOM routes migrated to TanStack Start Server Functions
import inventoryReconciliationRoutes from './routes/inventory-reconciliation.js';
import { autoArchiveOldOrders } from './services/autoArchive.js';
import { backfillLtvsIfNeeded } from './utils/tierUtils.js';
// Feedback routes migrated to TanStack Start Server Functions
import authRoutes from './routes/auth.js';
import importExportRoutes from './routes/import-export.js';
import shopifyRoutes from './routes/shopify/index.js';
import adminRoutes from './routes/admin.js';
import webhookRoutes from './routes/webhooks.js';
// Repacking routes migrated to TanStack Start Server Functions
import trackingRoutes from './routes/tracking.js';
import remittanceRoutes from './routes/remittance.js';
import pincodeRoutes from './routes/pincodes.js';
import sseRoutes from './routes/sse.js';
import pulseRoutes from './routes/pulse.js';
import internalRoutes from './routes/internal.js';
import returnsRoutes from './routes/returns.js';
import sheetSyncRoutes from './routes/sheetSync.js';
import channelsRoutes from './routes/channels.js';
import fabricInvoicesRoutes from './routes/fabricInvoices.js';
import financeUploadRoutes from './routes/financeUpload.js';
import chatRoutes from './routes/chat.js';
import returnPrimeWebhooks from './routes/returnPrimeWebhooks.js';
import returnPrimeSync from './routes/returnPrimeSync.js';
import returnPrimeAdminRoutes from './routes/returnPrimeAdminRoutes.js';
import { pulseBroadcaster } from './services/pulseBroadcaster.js';
import scheduledSync from './services/scheduledSync.js';
import trackingSync from './services/trackingSync.js';
import cacheProcessor from './services/cacheProcessor.js';
import cacheDumpWorker from './services/cacheDumpWorker.js';
import sheetOffloadWorker from './services/sheetOffloadWorker.js';
import stockSnapshotWorker from './services/stockSnapshotWorker.js';
import { reconcileSheetOrders, syncSheetOrderStatus } from './services/sheetOrderPush.js';
import { runAllCleanup } from './utils/cacheCleanup.js';
import { errorHandler } from './middleware/errorHandler.js';
import shutdownCoordinator from './utils/shutdownCoordinator.js';
import { cleanupStaleRuns, trackWorkerRun } from './utils/workerRunTracker.js';

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
// Products, orders, materials, fabrics, BOM, inventory, returns routes migrated to TanStack Start Server Functions
app.use('/api/inventory', inventoryReconciliationRoutes);
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
app.use('/api/internal', internalRoutes);
app.use('/api/returns', returnsRoutes);
app.use('/api/tracking', trackingRoutes);
app.use('/api/admin/sheet-sync', sheetSyncRoutes);
app.use('/api/channels', channelsRoutes);
app.use('/api/fabric-invoices', fabricInvoicesRoutes);
app.use('/api/finance', financeUploadRoutes);
app.use('/api/chat', chatRoutes);

// Return Prime integration
app.use('/api/webhooks/returnprime', returnPrimeWebhooks);
app.use('/api/returnprime/admin', returnPrimeAdminRoutes);  // Must be before /api/returnprime
app.use('/api/returnprime', returnPrimeSync);

// Public legal pages (for Google OAuth verification)
app.get('/privacy', (req, res) => {
  res.send(`<!DOCTYPE html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Privacy Policy — COH ERP</title>
<style>*{margin:0;padding:0;box-sizing:border-box}body{font-family:system-ui,-apple-system,sans-serif;max-width:720px;margin:0 auto;padding:40px 20px;color:#1a1a1a;line-height:1.7}h1{font-size:24px;margin-bottom:8px}p.date{color:#888;font-size:14px;margin-bottom:32px}h2{font-size:18px;margin:28px 0 12px}p,li{font-size:15px;margin-bottom:12px}ul{padding-left:24px}</style></head><body>
<h1>Privacy Policy</h1><p class="date">Last updated: February 2026</p>
<p>Canoe One House ("COH", "we", "us") operates the COH ERP system at coh.one. This policy explains how we handle data when you use our internal tools, including Google Apps Script integrations.</p>
<h2>What We Access</h2>
<p>Our Google Apps Script integration accesses Google Sheets data solely to manage order entries within our shared business spreadsheets. We access only the specific sheets required for COH operations.</p>
<h2>How We Use Data</h2>
<ul><li>To insert, read, and manage order rows in COH business spreadsheets</li><li>To run internal business operations through our ERP system</li><li>We do not sell, share, or transfer data to third parties</li></ul>
<h2>Data Storage</h2>
<p>Data remains within Google Sheets and our secure ERP database hosted on Railway. We do not copy your Google account data to external services.</p>
<h2>Who Can Access</h2>
<p>Only authorised COH team members and business partners with explicit access to our shared spreadsheets.</p>
<h2>Data Retention</h2>
<p>Business data is retained as long as needed for operations. You can request removal of your personal data by contacting us.</p>
<h2>Contact</h2>
<p>For privacy questions, reach us at <strong>hello@canoedesign.in</strong></p>
</body></html>`);
});

app.get('/terms', (req, res) => {
  res.send(`<!DOCTYPE html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Terms of Service — COH ERP</title>
<style>*{margin:0;padding:0;box-sizing:border-box}body{font-family:system-ui,-apple-system,sans-serif;max-width:720px;margin:0 auto;padding:40px 20px;color:#1a1a1a;line-height:1.7}h1{font-size:24px;margin-bottom:8px}p.date{color:#888;font-size:14px;margin-bottom:32px}h2{font-size:18px;margin:28px 0 12px}p,li{font-size:15px;margin-bottom:12px}ul{padding-left:24px}</style></head><body>
<h1>Terms of Service</h1><p class="date">Last updated: February 2026</p>
<p>These terms govern your use of the COH ERP system and related Google Apps Script tools operated by Canoe One House ("COH").</p>
<h2>Use of Service</h2>
<p>The COH ERP tools are provided for authorised business use by COH team members and partners. By using these tools, you agree to use them only for legitimate COH business operations.</p>
<h2>Google Integration</h2>
<p>Our tools integrate with Google Sheets to manage business data. By authorising the integration, you grant our application access to read and write data in the specific COH business spreadsheets you have access to.</p>
<h2>Your Responsibilities</h2>
<ul><li>Use the tools only for authorised COH business purposes</li><li>Do not share access credentials with unauthorised persons</li><li>Report any security concerns to the COH team promptly</li></ul>
<h2>Limitations</h2>
<p>The tools are provided "as is" for internal business use. We do our best to keep them running smoothly but do not guarantee uninterrupted availability.</p>
<h2>Changes</h2>
<p>We may update these terms as needed. Continued use of the tools constitutes acceptance of any changes.</p>
<h2>Contact</h2>
<p>Questions? Reach us at <strong>hello@canoedesign.in</strong></p>
</body></html>`);
});

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
    // Note: isCancelled removed from schema - use line-level status instead
    const ordersStart = Date.now();
    const orderCount = await prisma.order.count({
      where: { isArchived: false },
    });
    metrics.checks.ordersQuery = {
      status: 'ok',
      latencyMs: Date.now() - ordersStart,
      openOrderCount: orderCount,
    };

    // Check most recent order creation (data freshness)
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

  // Mark any worker runs left in "running" state from before this boot as failed
  await cleanupStaleRuns();

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

    // Start sheet offload worker (feature-flagged — only runs if ENABLE_SHEET_OFFLOAD=true)
    sheetOffloadWorker.start();

    // Start stock snapshot worker (manual trigger only)
    stockSnapshotWorker.start();

    // Sheet order reconciler — catches orders missed due to crashes/downtime
    // Runs every 15 min, looks back 3 days for unpushed orders
    const RECONCILE_INTERVAL_MS = 15 * 60 * 1000;
    const reconcileInterval = setInterval(() => {
      reconcileSheetOrders().catch(() => {}); // errors logged internally
    }, RECONCILE_INTERVAL_MS);

    // Sheet order status sync — updates status/courier/AWB in sheet from ERP
    // Runs every 5 min
    const STATUS_SYNC_INTERVAL_MS = 5 * 60 * 1000;
    const statusSyncInterval = setInterval(() => {
      syncSheetOrderStatus().catch(() => {});
    }, STATUS_SYNC_INTERVAL_MS);

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

    shutdownCoordinator.register('sheetOffloadWorker', () => {
      sheetOffloadWorker.stop();
    }, 5000);

    shutdownCoordinator.register('stockSnapshotWorker', () => {
      stockSnapshotWorker.stop();
    }, 5000);

    shutdownCoordinator.register('sheetReconciler', () => {
      clearInterval(reconcileInterval);
    }, 1000);

    shutdownCoordinator.register('sheetStatusSync', () => {
      clearInterval(statusSyncInterval);
    }, 1000);
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
      await trackWorkerRun('cache_cleanup', runAllCleanup, 'scheduled');
    }
  }, 60 * 60 * 1000); // Check every hour

  // Run initial cleanup on startup (in background, don't block)
  setTimeout(() => {
    console.log('[CacheCleanup] Running startup cleanup...');
    trackWorkerRun('cache_cleanup', runAllCleanup, 'startup').catch(err => console.error('[CacheCleanup] Startup cleanup error:', err));
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

