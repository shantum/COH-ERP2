/**
 * INTEGRATION EXAMPLE - Error Handling Middleware
 * 
 * This file shows how to integrate the new error handling middleware.
 * DO NOT commit this file - it's for reference only.
 * 
 * To integrate:
 * 1. Add imports at top of server/src/index.js
 * 2. Add requestLogger after body parser, before routes
 * 3. Replace existing error handler with new errorHandler
 */

// ============================================
// STEP 1: Add imports (around line 12)
// ============================================

import requestLogger from './middleware/requestLogger.js';
import errorHandler from './middleware/errorHandler.js';

// ============================================
// STEP 2: Add request logger (around line 109, after prisma middleware)
// ============================================

// Make prisma available to routes
app.use((req, res, next) => {
    req.prisma = prisma;
    next();
});

// Add request logging
app.use(requestLogger);

// ============================================
// STEP 3: Replace error handler (around line 152)
// ============================================

// OLD (remove this):
// app.use((err, req, res, next) => {
//   console.error(err.stack);
//   res.status(500).json({ error: 'Something went wrong!' });
// });

// NEW (replace with this):
app.use(errorHandler);

// ============================================
// EXAMPLE: Using asyncHandler in routes
// ============================================

import asyncHandler from '../middleware/asyncHandler.js';
import { NotFoundError } from '../utils/errors.js';

// Before
router.get('/orders/:id', authenticateToken, async (req, res) => {
    try {
        const order = await req.prisma.order.findUnique({
            where: { id: req.params.id }
        });

        if (!order) {
            return res.status(404).json({ error: 'Order not found' });
        }

        res.json(order);
    } catch (error) {
        console.error('Get order error:', error);
        res.status(500).json({ error: 'Failed to fetch order' });
    }
});

// After
router.get('/orders/:id', authenticateToken, asyncHandler(async (req, res) => {
    const order = await req.prisma.order.findUnique({
        where: { id: req.params.id }
    });

    if (!order) {
        throw new NotFoundError('Order not found', 'Order', req.params.id);
    }

    res.json(order);
}));

// ============================================
// Benefits
// ============================================

// ✅ Reduced from 15 lines to 8 lines
// ✅ No try-catch boilerplate
// ✅ Consistent error responses
// ✅ Automatic error logging
// ✅ Type-safe custom errors
