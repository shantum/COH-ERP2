/**
 * Request Logging Middleware
 * Logs all incoming HTTP requests with timing information
 */

/**
 * Logs HTTP requests with method, path, status, duration, and user info
 * 
 * @param {Object} req - Express request
 * @param {Object} res - Express response
 * @param {Function} next - Express next function
 * 
 * @example
 * // In server/src/index.js
 * import requestLogger from './middleware/requestLogger.js';
 * app.use(requestLogger);
 */
export function requestLogger(req, res, next) {
    const start = Date.now();

    // Log when response finishes
    res.on('finish', () => {
        const duration = Date.now() - start;
        const logData = {
            timestamp: new Date().toISOString(),
            method: req.method,
            path: req.path,
            status: res.statusCode,
            duration: `${duration}ms`,
            userId: req.user?.id,
            ip: req.ip || req.connection.remoteAddress
        };

        // Color code by status
        const statusColor = res.statusCode >= 500 ? '🔴'
            : res.statusCode >= 400 ? '🟡'
                : res.statusCode >= 300 ? '🔵'
                    : '🟢';

        console.log(
            `${statusColor} ${req.method} ${req.path} - ${res.statusCode} (${duration}ms)`,
            req.user?.id ? `[User: ${req.user.id}]` : ''
        );

        // Log slow requests (>1s)
        if (duration > 1000) {
            console.warn('[Slow Request]', logData);
        }

        // Log errors
        if (res.statusCode >= 500) {
            console.error('[Server Error]', logData);
        }
    });

    next();
}

export default requestLogger;
