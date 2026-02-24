// Force UTC for consistent pg driver date serialization across all environments
process.env.TZ = 'UTC';

// Validate ALL environment variables using Zod schema
// dotenv.config() is called inside env.ts before validation
import './config/env.js';

// Import logger EARLY to capture console.log/warn/error from all subsequent imports
import logger from './utils/logger.js';

import fs from 'node:fs';
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
import adminRoutes from './routes/admin/index.js';
import webhookRoutes from './routes/webhooks.js';
// Repacking routes migrated to TanStack Start Server Functions
import trackingRoutes from './routes/tracking.js';
import remittanceRoutes from './routes/remittance.js';
import payuSettlementRoutes from './routes/payuSettlement.js';
import pincodeRoutes from './routes/pincodes.js';
import sseRoutes from './routes/sse.js';
import pulseRoutes from './routes/pulse.js';
import internalRoutes from './routes/internal.js';
import returnsRoutes from './routes/returns.js';
import sheetSyncRoutes from './routes/sheetSync.js';
import channelsRoutes from './routes/channels.js';
import financeUploadRoutes from './routes/financeUpload.js';
import bankImportRoutes from './routes/bankImport.js';
import attendanceImportRoutes from './routes/attendanceImport.js';
import marketplacePayoutRoutes from './routes/marketplacePayout.js';
import razorpaySettlementRoutes from './routes/razorpaySettlement.js';
import chatRoutes from './routes/chat.js';
import imageUploadRoutes from './routes/imageUpload.js';
import resendWebhookRoutes from './routes/resendWebhook.js';
import returnPrimeWebhooks from './routes/returnPrimeWebhooks.js';
import returnPrimeSync from './routes/returnPrimeSync.js';
import returnPrimeAdminRoutes from './routes/returnPrimeAdminRoutes.js';
import { startAllWorkers, stopAllWorkers } from './services/workerRegistry.js';
import { errorHandler } from './middleware/errorHandler.js';
import shutdownCoordinator from './utils/shutdownCoordinator.js';

const app = express();

// Trust reverse proxy (Caddy) for correct IP, cookies, and rate limiting
app.set('trust proxy', 1);

// Security middleware
app.use(helmet({
    contentSecurityPolicy: {
        directives: {
            defaultSrc: ["'self'"],
            scriptSrc: ["'self'", "'unsafe-inline'"],
            styleSrc: ["'self'", "'unsafe-inline'"],
            imgSrc: ["'self'", "data:", "blob:", "https://cdn.shopify.com", "/api/uploads/"],
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
        ? process.env.CORS_ORIGIN || 'https://www.coh.one'
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
app.use('/api/payu-settlement', payuSettlementRoutes);
app.use('/api/pincodes', pincodeRoutes);
app.use('/api/events', sseRoutes);
app.use('/api/pulse', pulseRoutes);
app.use('/api/internal', internalRoutes);
app.use('/api/returns', returnsRoutes);
app.use('/api/tracking', trackingRoutes);
app.use('/api/admin/sheet-sync', sheetSyncRoutes);
app.use('/api/channels', channelsRoutes);
app.use('/api/finance', financeUploadRoutes);
app.use('/api/bank-import', bankImportRoutes);
app.use('/api/attendance-import', attendanceImportRoutes);
app.use('/api/marketplace-payout', marketplacePayoutRoutes);
app.use('/api/razorpay-settlement', razorpaySettlementRoutes);
app.use('/api/chat', chatRoutes);

// Image uploads
app.use('/api/uploads', imageUploadRoutes);
app.use('/api/uploads/products', express.static(path.join(process.cwd(), 'uploads', 'products')));

// Resend inbound email webhook
app.use('/api/webhooks/resend', resendWebhookRoutes);

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
<p>Data remains within Google Sheets and our secure ERP database. We do not copy your Google account data to external services.</p>
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

// Centralized error handling middleware
// Handles custom errors (ValidationError, NotFoundError, etc.), Prisma errors, and Zod errors
app.use(errorHandler);

// Export for production.js (unified server)
export { app, autoArchiveOldOrders, backfillLtvsIfNeeded, startAllWorkers };

const PORT = process.env.PORT || 3001;

// Only auto-listen when run directly (dev mode), not when imported by production.js
const isDirectRun = process.argv[1]?.replace(/\.ts$/, '.js').endsWith('index.js');
if (isDirectRun) {
  app.listen(PORT, '0.0.0.0', async () => {
    console.log(`🚀 COH ERP Server running on port ${PORT}`);
    await autoArchiveOldOrders(prisma);
    await backfillLtvsIfNeeded(prisma);
    await startAllWorkers();
  });
}

// Global error handlers + shutdown — only when run directly (production.js has its own)
if (isDirectRun) {
  process.on('uncaughtException', (error) => {
    logger.fatal({ type: 'UncaughtException', message: error.message, stack: error.stack },
      `Uncaught exception: ${error.message}`);
    setTimeout(() => process.exit(1), 1000);
  });

  process.on('unhandledRejection', (reason) => {
    logger.error({ type: 'UnhandledRejection',
      reason: reason instanceof Error ? { message: reason.message, stack: reason.stack } : reason },
      `Unhandled promise rejection: ${reason}`);
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

