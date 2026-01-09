/**
 * Centralized logger using Pino
 * Replaces scattered console.log statements with structured logging
 */
import pino from 'pino';
import logBuffer from './logBuffer.js';

// Determine if we're in development
const isDev = process.env.NODE_ENV !== 'production';

// Pino stream that feeds logs to our buffer
const bufferStream = {
    write: (line) => {
        try {
            const logObj = JSON.parse(line);

            // Map pino numeric levels to string levels
            const levelMap = {
                10: 'trace',
                20: 'debug',
                30: 'info',
                40: 'warn',
                50: 'error',
                60: 'fatal',
            };

            const levelName = levelMap[logObj.level] || 'info';
            const message = logObj.msg || '';

            // Extract context
            const context = { ...logObj };
            delete context.msg;
            delete context.time;
            delete context.level;
            delete context.pid;
            delete context.hostname;

            // Preserve stack traces in context for easy viewing
            if (context.err && context.err.stack) {
                context.stackTrace = context.err.stack;
            }
            if (context.stack) {
                context.stackTrace = context.stack;
            }

            // Add to buffer
            logBuffer.addLog(levelName, message, context);
        } catch (e) {
            // Ignore parse errors
        }
    }
};

// Create a multistream logger that outputs to both console and buffer
const streams = isDev
    ? [
        { level: 'debug', stream: pino.transport({
            target: 'pino-pretty',
            options: {
                colorize: true,
                translateTime: 'SYS:standard',
                ignore: 'pid,hostname',
            }
        })},
        { level: 'debug', stream: bufferStream }
    ]
    : [
        { level: 'info', stream: process.stdout },
        { level: 'info', stream: bufferStream }
    ];

// Create the logger instance
const logger = pino({
    level: process.env.LOG_LEVEL || (isDev ? 'debug' : 'info'),
    formatters: isDev ? {} : {
        level: (label) => ({ level: label }),
    },
}, pino.multistream(streams));

// Create child loggers for different modules
export const webhookLogger = logger.child({ module: 'webhook' });
export const shopifyLogger = logger.child({ module: 'shopify' });
export const syncLogger = logger.child({ module: 'sync' });
export const orderLogger = logger.child({ module: 'orders' });
export const inventoryLogger = logger.child({ module: 'inventory' });
export const authLogger = logger.child({ module: 'auth' });

// Export the base logger as default
export default logger;

// Also intercept console.log/warn/error for non-Pino code
const originalConsole = {
    log: console.log.bind(console),
    warn: console.warn.bind(console),
    error: console.error.bind(console),
    info: console.info.bind(console),
};

// Helper to format arguments and extract context
const formatConsoleArgs = (args) => {
    const context = {};
    let message = '';

    // Extract message and context from arguments
    const messageParts = [];
    for (const arg of args) {
        if (arg instanceof Error) {
            messageParts.push(arg.message);
            context.errorName = arg.name;
            context.stackTrace = arg.stack;
        } else if (typeof arg === 'object' && arg !== null) {
            messageParts.push(JSON.stringify(arg));
            // Store object data in context for searching
            context.data = arg;
        } else {
            messageParts.push(String(arg));
        }
    }

    message = messageParts.join(' ');
    return { message, context };
};

console.log = (...args) => {
    const { message, context } = formatConsoleArgs(args);
    logBuffer.addLog('info', message, context);
    originalConsole.log(...args);
};

console.warn = (...args) => {
    const { message, context } = formatConsoleArgs(args);
    logBuffer.addLog('warn', message, context);
    originalConsole.warn(...args);
};

console.error = (...args) => {
    const { message, context } = formatConsoleArgs(args);
    logBuffer.addLog('error', message, context);
    originalConsole.error(...args);
};

console.info = (...args) => {
    const { message, context } = formatConsoleArgs(args);
    logBuffer.addLog('info', message, context);
    originalConsole.info(...args);
};

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
