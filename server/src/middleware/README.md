# Error Handling Middleware - Usage Guide

> Created: January 9, 2026  
> Part of Phase 2 silent cleanup

---

## Overview

Three new middleware files eliminate the need for repetitive try-catch blocks and provide consistent error handling across the application.

---

## Files Created

### 1. `asyncHandler.js`
Wraps async route handlers to automatically catch errors.

### 2. `errorHandler.js`
Centralized error handling with support for custom error types.

### 3. Request Logging
Request logging is now handled by `utils/logger.js` which exports a `requestLogger` middleware function.

---

## Integration

### Step 1: Update `server/src/index.js`

Add these imports at the top:
```javascript
import { requestLogger } from './utils/logger.js';
import { errorHandler } from './middleware/errorHandler.js';
```

Add request logger BEFORE routes (optional - currently not used):
```javascript
// After body parser, before routes
app.use(requestLogger);
```

Add error handler AFTER all routes:
```javascript
// After all route definitions
app.use(errorHandler);
```

**Note**: Request logging is currently handled by the Pino logger's automatic console interception. The `requestLogger` middleware is available in `utils/logger.js` if explicit request logging is needed.

---

## Usage Examples

### Before (Old Pattern)
```javascript
router.get('/orders', authenticateToken, async (req, res) => {
    try {
        const orders = await req.prisma.order.findMany();
        res.json(orders);
    } catch (error) {
        console.error('Get orders error:', error);
        res.status(500).json({ error: 'Failed to fetch orders' });
    }
});
```

### After (New Pattern)
```javascript
import asyncHandler from '../middleware/asyncHandler.js';
import { NotFoundError } from '../utils/errors.js';

router.get('/orders', authenticateToken, asyncHandler(async (req, res) => {
    const orders = await req.prisma.order.findMany();
    res.json(orders);
}));

router.get('/orders/:id', authenticateToken, asyncHandler(async (req, res) => {
    const order = await req.prisma.order.findUnique({
        where: { id: req.params.id }
    });
    
    if (!order) {
        throw new NotFoundError('Order not found', 'Order', req.params.id);
    }
    
    res.json(order);
}));
```

---

## Custom Error Types

Use custom errors for better error handling:

```javascript
import { 
    ValidationError, 
    NotFoundError, 
    BusinessLogicError 
} from '../utils/errors.js';

// Validation error
if (!email) {
    throw new ValidationError('Email is required');
}

// Not found error
if (!order) {
    throw new NotFoundError('Order not found', 'Order', orderId);
}

// Business logic error
if (order.status === 'shipped') {
    throw new BusinessLogicError('Cannot edit shipped order');
}
```

---

## Migration Strategy

### Phase 1: New Code (Immediate)
Use `asyncHandler` in all new routes.

### Phase 2: Opportunistic (Gradual)
When editing existing routes, wrap with `asyncHandler`.

### Phase 3: Systematic (Future)
Migrate entire route files one at a time.

---

## Benefits

✅ **Reduced Code**: Eliminate 238+ duplicate try-catch blocks  
✅ **Consistent Errors**: Standardized error responses  
✅ **Better Logging**: Automatic request/error logging  
✅ **Type Safety**: Custom error classes with metadata  
✅ **Debugging**: Stack traces in development mode  

---

## Error Response Format

All errors now return consistent JSON:

```json
{
    "error": "Order not found",
    "type": "NotFoundError",
    "resourceType": "Order",
    "resourceId": "abc-123"
}
```

---

## Request Logging Output

```
🟢 GET /api/orders - 200 (45ms) [User: user-123]
🟡 GET /api/orders/invalid - 404 (12ms)
🔴 POST /api/orders - 500 (1234ms)
⚠️  [Slow Request] GET /api/reports - 200 (2500ms)
```

---

## Next Steps

1. Integrate middleware into `index.js`
2. Test with existing routes
3. Start using in new code
4. Gradually migrate existing routes
