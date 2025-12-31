import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import { PrismaClient } from '@prisma/client';

// Import routes
import productRoutes from './routes/products.js';
import fabricRoutes from './routes/fabrics.js';
import inventoryRoutes from './routes/inventory.js';
import orderRoutes from './routes/orders.js';
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

dotenv.config();

const app = express();
const prisma = new PrismaClient();

// Middleware
app.use(cors());

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

// Health check
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// Error handling
app.use((err, req, res, next) => {
  console.error(err.stack);
  res.status(500).json({ error: 'Something went wrong!' });
});

const PORT = process.env.PORT || 3001;

app.listen(PORT, () => {
  console.log(`🚀 COH ERP Server running on http://localhost:${PORT}`);
});

// Graceful shutdown
process.on('SIGTERM', async () => {
  await prisma.$disconnect();
  process.exit(0);
});
