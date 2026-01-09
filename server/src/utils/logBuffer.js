/**
 * In-memory log buffer for server logs viewer
 * Retains logs for 24 hours with automatic cleanup
 */

class LogBuffer {
    constructor(maxSize = 50000, retentionMs = 24 * 60 * 60 * 1000) {
        this.maxSize = maxSize;
        this.retentionMs = retentionMs; // 24 hours default
        this.logs = [];
        this.lastCleanup = Date.now();

        // Run cleanup every hour
        this.cleanupInterval = setInterval(() => this.cleanup(), 60 * 60 * 1000);
    }

    addLog(level, message, context = {}) {
        const timestamp = new Date().toISOString();
        const timestampMs = Date.now();

        const logEntry = {
            id: `${timestampMs}-${Math.random().toString(36).substr(2, 9)}`,
            timestamp,
            timestampMs, // Store numeric timestamp for efficient filtering
            level,
            message,
            context,
        };

        this.logs.push(logEntry);

        // Keep only the last maxSize entries (circular buffer)
        if (this.logs.length > this.maxSize) {
            this.logs.shift();
        }

        // Run cleanup if it's been over an hour since last cleanup
        const now = Date.now();
        if (now - this.lastCleanup > 60 * 60 * 1000) {
            this.cleanup();
        }
    }

    /**
     * Remove logs older than retention period
     */
    cleanup() {
        const cutoffTime = Date.now() - this.retentionMs;
        const originalLength = this.logs.length;

        // Remove expired logs (keep only logs newer than cutoff)
        this.logs = this.logs.filter(log => log.timestampMs > cutoffTime);

        this.lastCleanup = Date.now();

        const removed = originalLength - this.logs.length;
        if (removed > 0) {
            console.log(`[LogBuffer] Cleaned up ${removed} expired logs (older than 24 hours)`);
        }
    }

    getLogs({ level = null, limit = 100, offset = 0, search = null } = {}) {
        // Filter out expired logs on read (in case cleanup hasn't run yet)
        const cutoffTime = Date.now() - this.retentionMs;
        let filtered = this.logs.filter(log => log.timestampMs > cutoffTime);

        // Filter by level
        if (level && level !== 'all') {
            filtered = filtered.filter(log => log.level === level);
        }

        // Filter by search term
        if (search) {
            const searchLower = search.toLowerCase();
            filtered = filtered.filter(log => {
                const messageMatch = log.message.toLowerCase().includes(searchLower);
                const contextMatch = JSON.stringify(log.context).toLowerCase().includes(searchLower);
                return messageMatch || contextMatch;
            });
        }

        // Reverse to show newest first
        filtered.reverse();

        // Apply pagination
        const total = filtered.length;
        const paginated = filtered.slice(offset, offset + limit);

        return {
            logs: paginated,
            total,
            limit,
            offset,
        };
    }

    clearLogs() {
        this.logs = [];
        this.lastCleanup = Date.now();
    }

    getStats() {
        const now = Date.now();
        const oneHourAgo = now - (60 * 60 * 1000);
        const oneDayAgo = now - (24 * 60 * 60 * 1000);

        // Filter out expired logs first
        const activeLogs = this.logs.filter(log => log.timestampMs > oneDayAgo);

        const recentLogs = activeLogs.filter(log => log.timestampMs > oneHourAgo);

        return {
            total: activeLogs.length,
            maxSize: this.maxSize,
            retentionHours: this.retentionMs / (60 * 60 * 1000),
            byLevel: {
                fatal: activeLogs.filter(l => l.level === 'fatal').length,
                error: activeLogs.filter(l => l.level === 'error').length,
                warn: activeLogs.filter(l => l.level === 'warn').length,
                info: activeLogs.filter(l => l.level === 'info').length,
                debug: activeLogs.filter(l => l.level === 'debug').length,
                trace: activeLogs.filter(l => l.level === 'trace').length,
            },
            lastHour: {
                total: recentLogs.length,
                byLevel: {
                    fatal: recentLogs.filter(l => l.level === 'fatal').length,
                    error: recentLogs.filter(l => l.level === 'error').length,
                    warn: recentLogs.filter(l => l.level === 'warn').length,
                    info: recentLogs.filter(l => l.level === 'info').length,
                    debug: recentLogs.filter(l => l.level === 'debug').length,
                    trace: recentLogs.filter(l => l.level === 'trace').length,
                },
            },
            last24Hours: {
                total: activeLogs.length,
                byLevel: {
                    fatal: activeLogs.filter(l => l.level === 'fatal').length,
                    error: activeLogs.filter(l => l.level === 'error').length,
                    warn: activeLogs.filter(l => l.level === 'warn').length,
                    info: activeLogs.filter(l => l.level === 'info').length,
                    debug: activeLogs.filter(l => l.level === 'debug').length,
                    trace: activeLogs.filter(l => l.level === 'trace').length,
                },
            },
            oldestLog: activeLogs[0]?.timestamp,
            newestLog: activeLogs[activeLogs.length - 1]?.timestamp,
            nextCleanup: new Date(this.lastCleanup + (60 * 60 * 1000)).toISOString(),
        };
    }

    /**
     * Cleanup interval management for graceful shutdown
     */
    destroy() {
        if (this.cleanupInterval) {
            clearInterval(this.cleanupInterval);
            this.cleanupInterval = null;
        }
    }
}

// Singleton instance with 24-hour retention and 50k max size
const logBuffer = new LogBuffer(50000, 24 * 60 * 60 * 1000);

// Graceful shutdown cleanup
process.on('SIGTERM', () => logBuffer.destroy());
process.on('SIGINT', () => logBuffer.destroy());

export default logBuffer;
