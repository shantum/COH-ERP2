# New Utility Files - Quick Reference

> Created during silent cleanup - January 9, 2026

## Overview

Four new utility files have been added to improve code organization and reduce duplication:

## 📁 `constants.js`

**Purpose**: Centralized application constants (magic numbers extracted from codebase)

**Usage**:
```javascript
import { 
    DEFAULT_FABRIC_CONSUMPTION,
    AUTO_ARCHIVE_DAYS,
    SHOPIFY_BATCH_SIZE 
} from './constants.js';

// Use instead of hardcoded values
const consumption = sku.fabricConsumption || DEFAULT_FABRIC_CONSUMPTION;
```

**Categories**:
- Inventory constants (fabric consumption, stock alerts)
- Order constants (auto-archive, RTO thresholds)
- Shopify sync constants (batch sizes, concurrency)
- Tracking constants (sync intervals, batch limits)
- COD remittance constants (tolerance percentages)
- Pagination constants (page sizes, limits)
- File upload constants (size limits, extensions)
- Cache cleanup constants (stale days, batch sizes)

---

## 📁 `dateUtils.js`

**Purpose**: Consolidated date operations with comprehensive JSDoc

**Key Functions**:
```javascript
import { daysSince, parseDate, formatDate, addDays } from './utils/dateUtils.js';

// Calculate days since a date
const age = daysSince(order.createdAt); // 5

// Parse various date formats
const date = parseDate('06-Jan-26'); // Date object

// Format for display
const formatted = formatDate(new Date(), 'relative'); // "2 days ago"

// Date arithmetic
const futureDate = addDays(new Date(), 7); // Date 7 days from now
```

**All Functions**:
- `daysBetween(date1, date2)` - Calculate days between dates
- `daysSince(date)` - Days since a date
- `daysUntil(date)` - Days until a date
- `parseDate(dateStr)` - Parse various date formats
- `formatDate(date, format)` - Format date for display
- `isDateInRange(date, start, end)` - Check if date in range
- `addDays(date, days)` - Add days to a date
- `startOfDay(date)` - Get start of day (00:00:00)
- `endOfDay(date)` - Get end of day (23:59:59)

---

## 📁 `validation.js` (Enhanced)

**Purpose**: Added input sanitization and validation helpers

**New Functions**:
```javascript
import { 
    sanitizeSearchInput,
    isValidEmail,
    isValidPhone,
    isValidSkuCode 
} from './utils/validation.js';

// Sanitize user input
const safe = sanitizeSearchInput(userInput); // Prevents SQL injection

// Validate formats
if (!isValidEmail(email)) {
    throw new ValidationError('Invalid email');
}

if (!isValidPhone(phone)) {
    throw new ValidationError('Invalid phone number');
}
```

**New Helpers**:
- `sanitizeSearchInput(input)` - Prevent SQL injection
- `isValidSkuCode(code)` - Validate SKU format
- `isValidEmail(email)` - Email validation
- `isValidPhone(phone)` - Indian phone format
- `isValidUuid(uuid)` - UUID validation
- `sanitizeOrderNumber(orderNumber)` - Clean order numbers
- `isPositiveInteger(value)` - Positive integer check
- `isNonNegativeNumber(value)` - Non-negative number check

---

## 📁 `errors.js` (New)

**Purpose**: Custom error classes for better error handling

**Usage**:
```javascript
import { 
    NotFoundError, 
    ValidationError, 
    BusinessLogicError 
} from './utils/errors.js';

// Instead of generic Error
const order = await prisma.order.findUnique({ where: { id } });
if (!order) {
    throw new NotFoundError('Order not found', 'Order', id);
}

// Business rule violations
if (order.status === 'shipped') {
    throw new BusinessLogicError('Cannot edit shipped order');
}

// External API failures
try {
    await shopifyClient.createOrder(data);
} catch (error) {
    throw new ExternalServiceError('Shopify API failed', 'shopify', error);
}
```

**Error Classes**:
- `ValidationError` - Input validation failures (400)
- `NotFoundError` - Resource not found (404)
- `UnauthorizedError` - Authentication failures (401)
- `ForbiddenError` - Permission denied (403)
- `ConflictError` - State conflicts (409)
- `BusinessLogicError` - Business rule violations (422)
- `ExternalServiceError` - External API failures (502)
- `DatabaseError` - Database operation failures (500)

All errors include `statusCode` property for HTTP responses.

---

## 📁 `arrayUtils.js` (New)

**Purpose**: Array and object manipulation utilities

**Key Functions**:
```javascript
import { groupBy, keyBy, sumBy, chunk } from './utils/arrayUtils.js';

// Group orders by status
const grouped = groupBy(orders, 'status');
// { open: [...], shipped: [...] }

// Create map for fast lookup
const orderMap = keyBy(orders, 'id');
const order = orderMap.get('order-123');

// Sum totals
const totalRevenue = sumBy(orders, 'totalAmount');

// Process in batches
const batches = chunk(orderIds, 50);
for (const batch of batches) {
    await processBatch(batch);
}
```

**All Functions**:
- `groupBy(array, key)` - Group array by key
- `keyBy(array, key)` - Create map from array
- `uniqueBy(array, key)` - Remove duplicates by key
- `sumBy(array, key)` - Sum values by key
- `chunk(array, size)` - Split into chunks
- `pick(obj, keys)` - Pick specific keys
- `omit(obj, keys)` - Omit specific keys
- `deepClone(obj)` - Deep clone object
- `isEmpty(obj)` - Check if empty
- `get(obj, path, default)` - Safe nested access

---

## 📁 `stringUtils.js` (New)

**Purpose**: String manipulation and formatting

**Key Functions**:
```javascript
import { camelCase, slugify, truncate, escapeHtml } from './utils/stringUtils.js';

// Case conversion
camelCase('hello world'); // 'helloWorld'
snakeCase('helloWorld'); // 'hello_world'
kebabCase('Hello World'); // 'hello-world'

// URL slugs
slugify('Product Name #123'); // 'product-name-123'

// Truncate long text
truncate('Very long text...', 20); // 'Very long text...'

// Security
escapeHtml('<script>alert("xss")</script>');
```

**All Functions**:
- `capitalize(str)` - Capitalize first letter
- `titleCase(str)` - Convert to Title Case
- `camelCase(str)` - Convert to camelCase
- `snakeCase(str)` - Convert to snake_case
- `kebabCase(str)` - Convert to kebab-case
- `truncate(str, length)` - Truncate with ellipsis
- `cleanWhitespace(str)` - Remove extra spaces
- `slugify(str)` - Create URL-safe slug
- `escapeHtml(str)` - Escape HTML characters
- `stripHtml(str)` - Remove HTML tags
- `randomString(length)` - Generate random string
- `pad(str, length, char, side)` - Pad string
- `extractNumbers(str)` - Extract numbers only
- `wordCount(str)` - Count words

---

## 📁 `asyncUtils.js` (New)

**Purpose**: Async/promise utilities for common patterns

**Key Functions**:
```javascript
import { retry, batchProcess, timeout, safe } from './utils/asyncUtils.js';

// Retry with exponential backoff
const data = await retry(
    () => fetch('https://api.example.com/data'),
    { maxRetries: 5, initialDelay: 500 }
);

// Process in batches with concurrency limit
const results = await batchProcess(
    userIds,
    id => fetchUser(id),
    5 // Max 5 concurrent requests
);

// Timeout long operations
const result = await timeout(
    slowOperation(),
    5000,
    'Operation timed out'
);

// Safe error handling
const [error, user] = await safe(fetchUser(userId));
if (error) {
    console.error('Failed:', error);
    return;
}
```

**All Functions**:
- `sleep(ms)` - Async sleep
- `retry(fn, options)` - Retry with backoff
- `batchProcess(items, fn, concurrency)` - Concurrent batching
- `chunkProcess(items, fn, chunkSize)` - Sequential chunks
- `timeout(promise, ms)` - Timeout promise
- `debounce(fn, delay)` - Debounce async function
- `throttle(fn, limit)` - Throttle async function
- `memoize(fn)` - Cache async results
- `rateLimit(fn, maxCalls, period)` - Rate limiting
- `safe(promise)` - Error handling pattern

---

## Migration Guide

### Replace Magic Numbers

**Before**:
```javascript
const daysInRto = Math.floor((now - rtoDate) / (1000 * 60 * 60 * 24));
if (daysInRto > 7) {
    status = 'urgent';
}
```

**After**:
```javascript
import { RTO_URGENT_DAYS } from '../constants.js';
import { daysSince } from '../utils/dateUtils.js';

const daysInRto = daysSince(rtoDate);
if (daysInRto > RTO_URGENT_DAYS) {
    status = 'urgent';
}
```

### Use Custom Errors

**Before**:
```javascript
if (!order) {
    return res.status(404).json({ error: 'Order not found' });
}
```

**After**:
```javascript
import { NotFoundError } from '../utils/errors.js';

if (!order) {
    throw new NotFoundError('Order not found', 'Order', orderId);
}
```

### Sanitize User Input

**Before**:
```javascript
const search = req.query.search || '';
const orders = await prisma.order.findMany({
    where: {
        orderNumber: { contains: search }
    }
});
```

**After**:
```javascript
import { sanitizeSearchInput } from '../utils/validation.js';

const search = sanitizeSearchInput(req.query.search);
const orders = await prisma.order.findMany({
    where: {
        orderNumber: { contains: search }
    }
});
```

### Use Array Utilities

**Before**:
```javascript
const ordersByStatus = {};
for (const order of orders) {
    if (!ordersByStatus[order.status]) {
        ordersByStatus[order.status] = [];
    }
    ordersByStatus[order.status].push(order);
}
```

**After**:
```javascript
import { groupBy } from '../utils/arrayUtils.js';

const ordersByStatus = groupBy(orders, 'status');
```

---

## Benefits

✅ **Reduced Duplication**: Date calculations, validation logic centralized  
✅ **Better Documentation**: Comprehensive JSDoc comments  
✅ **Type Safety**: Clear parameter types and return values  
✅ **Consistency**: Same logic used everywhere  
✅ **Maintainability**: Change once, apply everywhere  
✅ **Error Handling**: Structured error types with status codes  

---

## Next Steps

These utilities are ready to use. Gradual migration recommended:
1. Use in new code immediately
2. Refactor existing code opportunistically
3. No breaking changes - existing code continues to work
