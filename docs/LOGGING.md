# Comprehensive Logging System

## Overview

The COH-ERP server implements a comprehensive logging system that captures ALL types of logs and errors for debugging through the Settings UI.

## What's Captured

The logging system captures:

1. **Console Methods**
   - `console.log()` → info level
   - `console.info()` → info level
   - `console.warn()` → warn level
   - `console.error()` → error level

2. **Pino Logger Levels**
   - `logger.trace()` → trace level (development only)
   - `logger.debug()` → debug level (development only)
   - `logger.info()` → info level
   - `logger.warn()` → warn level
   - `logger.error()` → error level
   - `logger.fatal()` → fatal level (critical errors)

3. **Global Error Handlers**
   - Uncaught exceptions → fatal level (process exits after logging)
   - Unhandled promise rejections → error level
   - Process warnings → warn level

4. **Express Error Middleware**
   - All Express route errors with:
     - Error type categorization (DatabaseError, ValidationError, AuthError, etc.)
     - HTTP status codes
     - Request context (method, URL, user ID, IP)
     - Stack traces
     - Prisma-specific metadata

5. **Error Context Captured**
   - Stack traces for all Error objects
   - Error names and types
   - Request information (method, URL, user, IP)
   - Database error codes (Prisma P2002, P2025, etc.)
   - Custom context objects

## Architecture

### Core Files

1. **`server/src/utils/logger.js`**
   - Pino logger configuration
   - Console method interception
   - Log buffer stream integration
   - Module-specific child loggers

2. **`server/src/utils/logBuffer.js`**
   - Persistent log storage in `server/logs/server.jsonl`
   - In-memory circular buffer (50,000 entries max)
   - 24-hour retention window
   - Automatic file compaction during cleanup
   - Log filtering by level
   - Search functionality
   - Statistics aggregation

3. **`server/src/index.js`**
   - Global error handlers
   - Express error middleware
   - Logger imported early to capture all logs

### Log Levels

From least to most severe:

- **trace** (10): Detailed debugging (dev only)
- **debug** (20): Debug information (dev only)
- **info** (30): General information
- **warn** (40): Warning messages
- **error** (50): Error conditions
- **fatal** (60): Fatal errors (process crash)

## Usage

### Basic Logging

```javascript
import logger from './utils/logger.js';

// Simple message
logger.info('User logged in');

// With context
logger.info({ userId: '123', action: 'login' }, 'User logged in');

// Error with stack trace
logger.error({ err: error }, 'Failed to process order');
```

### Module-Specific Loggers

```javascript
import { orderLogger, inventoryLogger, shopifyLogger } from './utils/logger.js';

orderLogger.info({ orderId: '123' }, 'Order allocated');
inventoryLogger.warn({ sku: 'ABC123' }, 'Low stock warning');
shopifyLogger.error({ webhookId: '456' }, 'Webhook processing failed');
```

### Console Logging (Auto-captured)

```javascript
// These are automatically captured and sent to the log buffer
console.log('Simple message');
console.warn('Warning:', { code: 'WARN_001' });
console.error('Error:', new Error('Something failed'));
```

### Error Handling

```javascript
// Caught exceptions (automatic via Express middleware)
router.get('/orders', async (req, res) => {
  const orders = await prisma.order.findMany();
  res.json(orders);
  // If this throws, Express error middleware catches and logs it
});

// Manual error logging
try {
  await riskyOperation();
} catch (error) {
  logger.error({ err: error, orderId: '123' }, 'Operation failed');
  throw error; // Re-throw if needed
}
```

## Error Type Categorization

The Express error middleware automatically categorizes errors:

- **DatabaseError**: Prisma errors (P2002, P2025, etc.)
- **ValidationError**: Zod, Prisma validation errors
- **AuthError**: JWT, authorization errors
- **UnknownError**: Other errors

## Viewing Logs

### Settings UI

1. Navigate to Settings
2. Click "Admin" section
3. View "Server Logs" tab
4. Filter by level: all, fatal, error, warn, info, debug, trace
5. Search logs by message or context
6. View stack traces in expandable context

### API Endpoints

```bash
# Get logs (requires authentication)
curl -H "Authorization: Bearer $TOKEN" \
  "http://localhost:3001/api/admin/logs?level=error&limit=100"

# Get log statistics
curl -H "Authorization: Bearer $TOKEN" \
  "http://localhost:3001/api/admin/logs/stats"

# Clear logs (admin only)
curl -X DELETE -H "Authorization: Bearer $TOKEN" \
  "http://localhost:3001/api/admin/logs"
```

## Testing

Run the comprehensive logging test:

```bash
cd server
node test-logging.js
```

Then check the logs in Settings UI to verify all log types are captured.

## Best Practices

1. **Use Pino logger over console methods**
   - Structured logging with context
   - Better performance
   - Consistent formatting

2. **Include context in logs**
   ```javascript
   // Good
   logger.error({ orderId, userId, sku }, 'Allocation failed');

   // Less useful
   logger.error('Allocation failed');
   ```

3. **Log errors with stack traces**
   ```javascript
   logger.error({ err: error }, 'Operation failed');
   ```

4. **Use appropriate log levels**
   - **debug**: Detailed debugging info
   - **info**: Normal operations (order created, user logged in)
   - **warn**: Warning conditions (low stock, slow query)
   - **error**: Error conditions (API failure, database error)
   - **fatal**: Fatal errors (should crash process)

5. **Don't log sensitive data**
   - Never log passwords, API keys, tokens
   - Sanitize user data before logging

6. **Use module-specific loggers**
   ```javascript
   import { orderLogger } from './utils/logger.js';
   orderLogger.info({ orderId }, 'Order created');
   ```

## Configuration

### Buffer Size and Retention

Defaults:
- **Max size**: 50,000 entries (circular buffer)
- **Retention**: 24 hours
- **Storage**: `server/logs/server.jsonl` (JSON Lines format)

To change, edit `server/src/utils/logBuffer.js`:
```javascript
// Increase to 100,000 entries and 48-hour retention
const logBuffer = new LogBuffer(100000, 48 * 60 * 60 * 1000);
```

### Log Level

Set via environment variable:
```bash
LOG_LEVEL=debug npm run dev  # Show debug logs
LOG_LEVEL=info npm run dev   # Show info and above (default)
```

Or in code:
```javascript
const logger = pino({
  level: process.env.LOG_LEVEL || 'info',
  // ...
});
```

## Performance

- **Persistent storage**: Logs survive server restarts (crash data preserved)
- **Async file writes**: Non-blocking write queue prevents performance impact
- **Circular buffer**: Old logs automatically removed when buffer is full
- **24-hour retention**: Automatic cleanup of expired logs
- **File compaction**: Periodic rewrite of log file to remove expired entries
- **Async logging**: Pino uses async logging for minimal performance impact
- **Indexed filtering**: Log filtering is optimized for fast searching
- **Memory efficient**: 50,000 log entries ≈ 50-100MB memory

## Troubleshooting

### Logs not appearing in UI

1. Check logger is imported early in `index.js` (before other imports)
2. Verify log level allows the message (debug requires LOG_LEVEL=debug)
3. Check browser console for API errors
4. Verify authentication token is valid

### Stack traces not showing

1. Ensure error is logged with `err` property:
   ```javascript
   logger.error({ err: error }, 'Message');
   ```

2. For console.error, pass Error object:
   ```javascript
   console.error('Message:', error); // error should be Error instance
   ```

### Buffer filling up too fast

1. Increase buffer size in `logBuffer.js`
2. Reduce log level (info instead of debug)
3. Remove excessive logging from hot paths

### Testing Log Persistence

Run the test script to verify logs persist across restarts:

```bash
cd server

# Write test logs
node test-log-persistence.js write

# Read logs (simulates restart)
node test-log-persistence.js read
```

You should see the test logs successfully loaded after the simulated restart.

## Future Enhancements

Potential improvements:

- [x] Persistent log storage (file-based)
- [ ] Log rotation and archiving (multiple files)
- [ ] Real-time log streaming (WebSocket)
- [ ] Log aggregation and analytics
- [ ] Export logs to file (CSV/JSON)
- [ ] Integration with external log services (Sentry, LogRocket)

## Persistent Storage Details

### File Format

Logs are stored in JSON Lines format (`server/logs/server.jsonl`):
- Each line is a complete JSON object
- Easy to append (no need to parse entire file)
- Easy to read line-by-line for filtering

Example log entry:
```json
{"id":"1767966997567-l3b7e3dto","timestamp":"2026-01-09T13:56:37.567Z","timestampMs":1767966997567,"level":"warn","message":"Test warning log","context":{"test":true,"severity":"medium"}}
```

### Startup Behavior

When the server starts:
1. Creates `server/logs/` directory if it doesn't exist
2. Reads existing `server.jsonl` file
3. Filters logs to 24-hour retention window
4. Loads active logs into in-memory buffer
5. If expired logs found, compacts the file

### Write Strategy

- **Async, non-blocking**: Uses write queue to batch writes
- **Immediate append**: Logs written to file as soon as possible
- **No data loss**: Queue preserved if write fails, retried on next write
- **Graceful shutdown**: Pending writes flushed on SIGTERM/SIGINT

### Cleanup Strategy

Every hour (or when triggered):
1. Remove expired logs from memory buffer
2. Rewrite file with only active logs
3. Reduces file size by removing old entries

### File Location

```
server/
├── logs/
│   └── server.jsonl  (auto-created, git-ignored)
├── src/
│   └── utils/
│       └── logBuffer.js
└── test-log-persistence.js
```
