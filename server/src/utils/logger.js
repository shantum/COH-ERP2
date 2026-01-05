/**
 * Centralized logger using Pino
 * Replaces scattered console.log statements with structured logging
 */
import pino from 'pino';

// Determine if we're in development
const isDev = process.env.NODE_ENV !== 'production';

// Create the logger instance
const logger = pino({
    level: process.env.LOG_LEVEL || (isDev ? 'debug' : 'info'),
    transport: isDev ? {
        target: 'pino-pretty',
        options: {
            colorize: true,
            translateTime: 'SYS:standard',
            ignore: 'pid,hostname',
        }
    } : undefined,
    // In production, use JSON format for log aggregation
    ...(isDev ? {} : {
        formatters: {
            level: (label) => ({ level: label }),
        },
    }),
});

// Create child loggers for different modules
export const webhookLogger = logger.child({ module: 'webhook' });
export const shopifyLogger = logger.child({ module: 'shopify' });
export const syncLogger = logger.child({ module: 'sync' });
export const orderLogger = logger.child({ module: 'orders' });
export const inventoryLogger = logger.child({ module: 'inventory' });
export const authLogger = logger.child({ module: 'auth' });

// Export the base logger as default
export default logger;

// Helper to log with context
export function logWithContext(childLogger, context) {
    return childLogger.child(context);
}

// Request logging middleware
export function requestLogger(req, res, next) {
    const start = Date.now();

    res.on('finish', () => {
        const duration = Date.now() - start;
        const logData = {
            method: req.method,
            url: req.url,
            status: res.statusCode,
            duration: `${duration}ms`,
        };

        if (res.statusCode >= 500) {
            logger.error(logData, 'Request error');
        } else if (res.statusCode >= 400) {
            logger.warn(logData, 'Request warning');
        } else if (duration > 1000) {
            logger.warn(logData, 'Slow request');
        } else {
            logger.debug(logData, 'Request completed');
        }
    });

    next();
}
