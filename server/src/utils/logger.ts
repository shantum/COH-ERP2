/**
 * Centralized logger using Pino
 * Replaces scattered console.log statements with structured logging
 */
import pino from 'pino';
import type { Logger, Level, DestinationStream } from 'pino';
import type { Request, Response, NextFunction } from 'express';
import logBuffer from './logBuffer.js';
import type { LogLevel } from './logBuffer.js';

// Determine if we're in development
const isDev = process.env.NODE_ENV !== 'production';

/**
 * Sentry bridge — lazy-loaded to avoid circular imports.
 * instrument.ts sets this after Sentry.init() completes.
 */
let sentryCaptureError: ((error: Error | string, extra?: Record<string, unknown>) => void) | null = null;

export function setSentryCaptureError(fn: (error: Error | string, extra?: Record<string, unknown>) => void): void {
    sentryCaptureError = fn;
}

/** Pino numeric level to string level mapping */
interface PinoLogObject {
    level: number;
    msg?: string;
    time?: number;
    pid?: number;
    hostname?: string;
    err?: {
        stack?: string;
        message?: string;
        [key: string]: unknown;
    };
    stack?: string;
    [key: string]: unknown;
}

/** Level map from pino numeric to string */
const levelMap: Record<number, LogLevel> = {
    10: 'trace',
    20: 'debug',
    30: 'info',
    40: 'warn',
    50: 'error',
    60: 'fatal',
};

// Pino stream that feeds logs to our buffer (and Sentry for error/fatal)
const bufferStream: DestinationStream = {
    write: (line: string): void => {
        try {
            const logObj = JSON.parse(line) as PinoLogObject;

            const levelName: LogLevel = levelMap[logObj.level] || 'info';
            const message = logObj.msg || '';

            // Extract context
            const context: Record<string, unknown> = { ...logObj };
            delete context.msg;
            delete context.time;
            delete context.level;
            delete context.pid;
            delete context.hostname;

            // Preserve stack traces in context for easy viewing
            if (context.err && typeof context.err === 'object' && 'stack' in context.err) {
                context.stackTrace = context.err.stack;
            }
            if (context.stack) {
                context.stackTrace = context.stack;
            }

            // Add to buffer
            logBuffer.addLog(levelName, message, context);

            // Forward error/fatal to Sentry
            if (sentryCaptureError && logObj.level >= 50) {
                if (logObj.err && logObj.err.message) {
                    const err = new Error(logObj.err.message);
                    if (logObj.err.stack) err.stack = logObj.err.stack;
                    sentryCaptureError(err, context);
                } else if (message) {
                    sentryCaptureError(message, context);
                }
            }
        } catch {
            // Ignore parse errors
        }
    }
};

// Stream configuration type
interface StreamConfig {
    level: Level;
    stream: DestinationStream;
}

// Create a multistream logger that outputs to both console and buffer
const streams: StreamConfig[] = isDev
    ? [
        {
            level: 'debug', stream: pino.transport({
                target: 'pino-pretty',
                options: {
                    colorize: true,
                    translateTime: 'SYS:standard',
                    ignore: 'pid,hostname',
                }
            })
        },
        { level: 'debug', stream: bufferStream }
    ]
    : [
        { level: 'info', stream: process.stdout },
        { level: 'info', stream: bufferStream }
    ];

// Create the logger instance
const logger: Logger = pino({
    level: process.env.LOG_LEVEL || (isDev ? 'debug' : 'info'),
    formatters: isDev ? {} : {
        level: (label: string) => ({ level: label }),
    },
}, pino.multistream(streams));

// Create child loggers for different modules
export const webhookLogger: Logger = logger.child({ module: 'webhook' });
export const shopifyLogger: Logger = logger.child({ module: 'shopify' });
export const syncLogger: Logger = logger.child({ module: 'sync' });
export const orderLogger: Logger = logger.child({ module: 'orders' });
export const inventoryLogger: Logger = logger.child({ module: 'inventory' });
export const authLogger: Logger = logger.child({ module: 'auth' });

// Additional domain-specific loggers
export const trackingLogger: Logger = logger.child({ module: 'tracking' });
export const shippingLogger: Logger = logger.child({ module: 'shipping' });
export const importExportLogger: Logger = logger.child({ module: 'import-export' });
export const reconciliationLogger: Logger = logger.child({ module: 'reconciliation' });
export const productionLogger: Logger = logger.child({ module: 'production' });
export const fabricLogger: Logger = logger.child({ module: 'fabrics' });
export const customerLogger: Logger = logger.child({ module: 'customers' });
export const remittanceLogger: Logger = logger.child({ module: 'remittance' });
export const settlementLogger: Logger = logger.child({ module: 'settlement' });
export const sheetsLogger: Logger = logger.child({ module: 'sheets' });
export const snapshotLogger: Logger = logger.child({ module: 'snapshot' });
export const driveLogger: Logger = logger.child({ module: 'drive' });

// Export the base logger as default
export default logger;

// Also intercept console.log/warn/error for non-Pino code
const originalConsole = {
    log: console.log.bind(console),
    warn: console.warn.bind(console),
    error: console.error.bind(console),
    info: console.info.bind(console),
};

/** Formatted console arguments result */
interface FormattedConsoleArgs {
    message: string;
    context: Record<string, unknown>;
}

/** Check if an object is a structured log from serverLog utility */
function isStructuredMeta(arg: unknown): arg is Record<string, unknown> & { _structured: true } {
    return typeof arg === 'object' && arg !== null && '_structured' in arg
        && (arg as Record<string, unknown>)._structured === true;
}

// Helper to format arguments and extract context
const formatConsoleArgs = (args: unknown[]): FormattedConsoleArgs => {
    const context: Record<string, unknown> = {};
    const messageParts: string[] = [];

    // Extract message and context from arguments
    for (const arg of args) {
        if (isStructuredMeta(arg)) {
            // Structured log from serverLog — hoist domain/fn/error to top-level context
            const { _structured, domain, fn, errorMessage, errorName, stack, ...rest } = arg;
            if (domain) context.domain = domain;
            if (fn) context.fn = fn;
            if (errorMessage) context.errorMessage = errorMessage;
            if (errorName) context.errorName = errorName;
            if (stack) context.stackTrace = stack;
            // Merge remaining fields
            Object.assign(context, rest);
        } else if (arg instanceof Error) {
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

    const message = messageParts.join(' ');
    return { message, context };
};

console.log = (...args: unknown[]): void => {
    const { message, context } = formatConsoleArgs(args);
    logBuffer.addLog('info', message, context);
    originalConsole.log(...args);
};

console.warn = (...args: unknown[]): void => {
    const { message, context } = formatConsoleArgs(args);
    logBuffer.addLog('warn', message, context);
    originalConsole.warn(...args);
};

console.error = (...args: unknown[]): void => {
    const { message, context } = formatConsoleArgs(args);
    logBuffer.addLog('error', message, context);
    originalConsole.error(...args);

    // Send to Sentry — find the first Error instance in args, or create a message event
    if (sentryCaptureError) {
        const errorArg = args.find((a): a is Error => a instanceof Error);
        if (errorArg) {
            sentryCaptureError(errorArg, context);
        } else if (message) {
            sentryCaptureError(message, context);
        }
    }
};

console.info = (...args: unknown[]): void => {
    const { message, context } = formatConsoleArgs(args);
    logBuffer.addLog('info', message, context);
    originalConsole.info(...args);
};

// Helper to log with context
export function logWithContext<T extends Record<string, unknown>>(childLogger: Logger, context: T): Logger {
    return childLogger.child(context);
}

// Request logging middleware
export function requestLogger(req: Request, res: Response, next: NextFunction): void {
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
