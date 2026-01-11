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
import productRoutes from './routes/products.js';
import fabricRoutes from './routes/fabrics.js';
import inventoryRoutes from './routes/inventory.js';
import inventoryReconciliationRoutes from './routes/inventory-reconciliation.js';
import orderRoutes from './routes/orders/index.js';
import { autoArchiveOldOrders } from './routes/orders/mutations.js';
import customerRoutes from './routes/customers.js';
import returnRoutes from './routes/returns.js';
import feedbackRoutes from './routes/feedback.js';
import productionRoutes from './routes/production.js';
import reportRoutes from './routes/reports.js';
import salesAnalyticsRoutes from './routes/sales-analytics.js';
import authRoutes from './routes/auth.js';
import importExportRoutes from './routes/import-export.js';
import shopifyRoutes from './routes/shopify.js';
import adminRoutes from './routes/admin.js';
import webhookRoutes from './routes/webhooks.js';
import repackingRoutes from './routes/repacking.js';
import trackingRoutes from './routes/tracking.js';
import remittanceRoutes from './routes/remittance.js';
import catalogRoutes from './routes/catalog.js';
import scheduledSync from './services/scheduledSync.js';
import trackingSync from './services/trackingSync.js';
import { runAllCleanup } from './utils/cacheCleanup.js';
import { errorHandler } from './middleware/errorHandler.js';

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
        : true, // Allow all origins in development
    credentials: true,
}));

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
app.use('/api/products', productRoutes);
app.use('/api/fabrics', fabricRoutes);
app.use('/api/inventory', inventoryRoutes);
app.use('/api/inventory', inventoryReconciliationRoutes);
app.use('/api/orders', orderRoutes);
app.use('/api/customers', customerRoutes);
app.use('/api/returns', returnRoutes);
app.use('/api/feedback', feedbackRoutes);
app.use('/api/production', productionRoutes);
app.use('/api/reports', reportRoutes);
app.use('/api/reports/sales-analytics', salesAnalyticsRoutes);
app.use('/api', importExportRoutes);
app.use('/api/shopify', shopifyRoutes);
app.use('/api/admin', adminRoutes);
app.use('/api/webhooks', webhookRoutes);
app.use('/api/repacking', repackingRoutes);
app.use('/api/tracking', trackingRoutes);
app.use('/api/remittance', remittanceRoutes);
app.use('/api/catalog', catalogRoutes);

// Health check
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
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

app.listen(PORT, async () => {
  console.log(`🚀 COH ERP Server running on http://localhost:${PORT}`);

  // Auto-archive shipped orders older than 90 days on startup
  await autoArchiveOldOrders(prisma);

  // Start hourly Shopify sync scheduler
  scheduledSync.start();

  // Start tracking sync scheduler (every 4 hours)
  trackingSync.start();

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

  // Store reference for graceful shutdown
  global.cacheCleanupInterval = cacheCleanupInterval;
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

// Graceful shutdown
process.on('SIGTERM', async () => {
  logger.info('SIGTERM received, shutting down gracefully...');
  scheduledSync.stop();
  trackingSync.stop();
  if (global.cacheCleanupInterval) clearInterval(global.cacheCleanupInterval);
  await prisma.$disconnect();
  logger.info('Server shut down complete');
  process.exit(0);
});

process.on('SIGINT', async () => {
  logger.info('SIGINT received, shutting down gracefully...');
  scheduledSync.stop();
  trackingSync.stop();
  if (global.cacheCleanupInterval) clearInterval(global.cacheCleanupInterval);
  await prisma.$disconnect();
  logger.info('Server shut down complete');
  process.exit(0);
});
