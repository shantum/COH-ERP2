# Error Handling Reference

> Error handling patterns and custom error classes. **Last updated: January 11, 2026**

---

## AsyncHandler Pattern

Wrap async route handlers to auto-catch errors and pass to error middleware.

```javascript
import { asyncHandler } from '../middleware/asyncHandler.js';

// Without asyncHandler (verbose)
router.get('/orders', async (req, res) => {
  try {
    const orders = await prisma.order.findMany();
    res.json(orders);
  } catch (error) {
    console.error('Error:', error);
    res.status(500).json({ error: 'Failed to fetch orders' });
  }
});

// With asyncHandler (clean)
router.get('/orders', asyncHandler(async (req, res) => {
  const orders = await prisma.order.findMany();
  res.json(orders);
}));
```

### When NOT to Use AsyncHandler

- **Streaming responses** - res.pipe(), file streams
- **SSE connections** - Server-sent events
- **Manual error handling needed** - Partial failure recovery

---

## Custom Error Classes

Location: `server/src/utils/errors.js`

| Error Class | Status Code | Use Case |
|-------------|-------------|----------|
| `ValidationError` | 400 | Input validation failures |
| `NotFoundError` | 404 | Resource not found |
| `UnauthorizedError` | 401 | Authentication failures |
| `ForbiddenError` | 403 | Insufficient permissions |
| `ConflictError` | 409 | State conflicts, duplicates |
| `BusinessLogicError` | 422 | Domain rule violations |
| `ExternalServiceError` | 502 | API failures (Shopify, iThink) |
| `DatabaseError` | 500 | Transaction/constraint failures |

---

## Usage Examples

### ValidationError
```javascript
import { ValidationError } from '../utils/errors.js';

if (!email.includes('@')) {
  throw new ValidationError('Invalid email format', { email });
}
```

### NotFoundError
```javascript
import { NotFoundError } from '../utils/errors.js';

const order = await prisma.order.findUnique({ where: { id } });
if (!order) {
  throw new NotFoundError('Order not found', 'Order', id);
}
```

### BusinessLogicError
```javascript
import { BusinessLogicError } from '../utils/errors.js';

if (order.status === 'shipped') {
  throw new BusinessLogicError('Cannot cancel shipped order', 'order-cancel-rule');
}
```

### ExternalServiceError
```javascript
import { ExternalServiceError } from '../utils/errors.js';

try {
  const result = await shopifyClient.updateOrder(orderId, data);
} catch (error) {
  throw new ExternalServiceError('Shopify API failed', 'shopify', error);
}
```

---

## Error Handler Middleware

Location: `server/src/middleware/errorHandler.js`

The centralized error handler:
1. Logs error to persistent logs
2. Maps error class to HTTP status code
3. Returns consistent JSON response format

```javascript
// Response format
{
  "error": "Human-readable message",
  "details": { ... },  // Optional, from error.details
  "code": "ERROR_CODE" // Optional, for client handling
}
```

---

## Implementation Checklist

When adding new routes:

1. **Wrap with asyncHandler**
   ```javascript
   router.post('/endpoint', asyncHandler(async (req, res) => { ... }));
   ```

2. **Use appropriate error class**
   - Input issues → `ValidationError`
   - Missing resource → `NotFoundError`
   - Business rules → `BusinessLogicError`

3. **Include context**
   ```javascript
   throw new NotFoundError(`Order ${id} not found`, 'Order', id);
   ```

4. **Don't catch errors you can't handle**
   - Let them bubble to error middleware
   - Only catch if you need partial recovery

---

## Gotchas

1. **Always use asyncHandler** - Unhandled promise rejections crash the server
2. **Don't double-wrap** - `asyncHandler` already handles the catch
3. **Include details** - Error context helps debugging
4. **Log at source** - Error handler logs, no need to console.log before throwing
5. **Prisma errors** - Let them bubble; error handler maps common codes
