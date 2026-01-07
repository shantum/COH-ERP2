// Load environment variables FIRST before any other imports
import dotenv from 'dotenv';
dotenv.config();

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
import orderRoutes, { autoArchiveOldOrders } from './routes/orders.js';
import customerRoutes from './routes/customers.js';
import returnRoutes from './routes/returns.js';
import feedbackRoutes from './routes/feedback.js';
import productionRoutes from './routes/production.js';
import reportRoutes from './routes/reports.js';
import authRoutes from './routes/auth.js';
import importExportRoutes from './routes/import-export.js';
import shopifyRoutes from './routes/shopify.js';
import adminRoutes from './routes/admin.js';
import webhookRoutes from './routes/webhooks.js';
import repackingRoutes from './routes/repacking.js';
import trackingRoutes from './routes/tracking.js';
import remittanceRoutes from './routes/remittance.js';
import scheduledSync from './services/scheduledSync.js';
import trackingSync from './services/trackingSync.js';

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

// Standard JSON parsing for other routes
app.use(express.json());

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
app.use('/api/orders', orderRoutes);
app.use('/api/customers', customerRoutes);
app.use('/api/returns', returnRoutes);
app.use('/api/feedback', feedbackRoutes);
app.use('/api/production', productionRoutes);
app.use('/api/reports', reportRoutes);
app.use('/api', importExportRoutes);
app.use('/api/shopify', shopifyRoutes);
app.use('/api/admin', adminRoutes);
app.use('/api/webhooks', webhookRoutes);
app.use('/api/repacking', repackingRoutes);
app.use('/api/tracking', trackingRoutes);
app.use('/api/remittance', remittanceRoutes);

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

// Error handling
app.use((err, req, res, next) => {
  console.error(err.stack);
  res.status(500).json({ error: 'Something went wrong!' });
});

const PORT = process.env.PORT || 3001;

app.listen(PORT, async () => {
  console.log(`🚀 COH ERP Server running on http://localhost:${PORT}`);

  // Auto-archive shipped orders older than 90 days on startup
  await autoArchiveOldOrders(prisma);

  // Start hourly Shopify sync scheduler
  scheduledSync.start();

  // Start tracking sync scheduler (every 4 hours)
  trackingSync.start();
});

// Graceful shutdown
process.on('SIGTERM', async () => {
  scheduledSync.stop();
  trackingSync.stop();
  await prisma.$disconnect();
  process.exit(0);
});
