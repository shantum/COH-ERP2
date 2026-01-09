/**
 * Test script to verify comprehensive logging
 * Run with: node server/test-logging.js
 * Then check logs at: http://localhost:3001/settings (Admin > Server Logs)
 */

// Simulate the same environment as index.js
import dotenv from 'dotenv';
dotenv.config();

// Import logger early (same as index.js)
import logger from './src/utils/logger.js';

console.log('=== Starting Comprehensive Logging Test ===');

// Test 1: console.log
console.log('Test 1: This is a console.log message');
console.log('Test 1: Object:', { test: 'data', nested: { value: 123 } });

// Test 2: console.warn
console.warn('Test 2: This is a console.warn message');
console.warn('Test 2: Warning with data:', { status: 'warning', code: 'WARN_001' });

// Test 3: console.error
console.error('Test 3: This is a console.error message');
console.error('Test 3: Error with details:', { error: 'Something failed', details: 'test' });

// Test 4: console.info
console.info('Test 4: This is a console.info message');

// Test 5: Error object with stack trace
const testError = new Error('Test error with stack trace');
console.error('Test 5: Error object:', testError);

// Test 6: Pino logger levels
logger.debug('Test 6: Debug level message');
logger.info('Test 6: Info level message');
logger.warn('Test 6: Warn level message');
logger.error('Test 6: Error level message');

// Test 7: Pino with context
logger.info({ userId: '123', action: 'test' }, 'Test 7: Log with context');
logger.error({
    type: 'DatabaseError',
    code: 'P2002',
    table: 'users'
}, 'Test 7: Error with rich context');

// Test 8: Pino with error object
logger.error({
    err: new Error('Test Pino error'),
    requestId: 'req-123'
}, 'Test 8: Pino error with stack trace');

// Test 9: Simulate caught exception
try {
    throw new Error('Test caught exception');
} catch (error) {
    console.error('Test 9: Caught exception:', error);
    logger.error({ err: error }, 'Test 9: Caught exception logged via Pino');
}

// Test 10: Simulate unhandled rejection (will be caught by global handler)
console.log('Test 10: Triggering unhandled rejection in 1 second...');
setTimeout(() => {
    Promise.reject(new Error('Test unhandled rejection'));
}, 1000);

// Test 11: Module-specific loggers
import { orderLogger, inventoryLogger, shopifyLogger } from './src/utils/logger.js';
orderLogger.info('Test 11: Order module log');
inventoryLogger.warn('Test 11: Inventory module warning');
shopifyLogger.error('Test 11: Shopify module error');

console.log('\n=== Logging Test Complete ===');
console.log('Wait 2 seconds for unhandled rejection test, then check logs at:');
console.log('http://localhost:3001/settings > Admin > Server Logs');
console.log('\nExpected logs:');
console.log('- console.log, warn, error, info messages');
console.log('- Error objects with stack traces');
console.log('- Pino debug, info, warn, error messages');
console.log('- Logs with context (userId, action, etc.)');
console.log('- Caught exceptions with stack traces');
console.log('- Unhandled rejection (should appear as error)');
console.log('- Module-specific logs (order, inventory, shopify)');

// Keep process alive for 3 seconds to capture unhandled rejection
setTimeout(() => {
    console.log('\nTest completed. Exiting...');
    process.exit(0);
}, 3000);
