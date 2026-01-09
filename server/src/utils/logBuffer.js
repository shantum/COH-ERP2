import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/**
 * Persistent log buffer for server logs viewer
 * Retains logs for 24 hours with automatic cleanup
 * Persists logs to disk to survive server restarts
 */
class LogBuffer {
    constructor(maxSize = 50000, retentionMs = 24 * 60 * 60 * 1000) {
        this.maxSize = maxSize;
        this.retentionMs = retentionMs; // 24 hours default
        this.logs = [];
        this.lastCleanup = Date.now();

        // Configure log file path
        this.logsDir = path.resolve(__dirname, '../../logs');
        this.logFilePath = path.join(this.logsDir, 'server.jsonl');

        // Queue for async file writes to prevent blocking
        this.writeQueue = [];
        this.isWriting = false;

        // Initialize: ensure directory exists and load existing logs
        this._initialize();

        // Run cleanup every hour
        this.cleanupInterval = setInterval(() => this.cleanup(), 60 * 60 * 1000);
    }

    /**
     * Initialize log buffer: create directory and load existing logs
     */
    _initialize() {
        try {
            // Create logs directory if it doesn't exist
            if (!fs.existsSync(this.logsDir)) {
                fs.mkdirSync(this.logsDir, { recursive: true });
                console.log('[LogBuffer] Created logs directory:', this.logsDir);
            }

            // Load existing logs from file
            this._loadLogsFromFile();
        } catch (error) {
            console.error('[LogBuffer] Failed to initialize:', error.message);
        }
    }

    /**
     * Load logs from file on startup, filtering to retention window
     */
    _loadLogsFromFile() {
        try {
            if (!fs.existsSync(this.logFilePath)) {
                console.log('[LogBuffer] No existing log file found, starting fresh');
                return;
            }

            const fileContent = fs.readFileSync(this.logFilePath, 'utf-8');
            const lines = fileContent.trim().split('\n').filter(line => line.trim());

            const cutoffTime = Date.now() - this.retentionMs;
            let loaded = 0;
            let expired = 0;

            for (const line of lines) {
                try {
                    const logEntry = JSON.parse(line);

                    // Only load logs within retention window
                    if (logEntry.timestampMs > cutoffTime) {
                        this.logs.push(logEntry);
                        loaded++;
                    } else {
                        expired++;
                    }
                } catch (parseError) {
                    console.error('[LogBuffer] Failed to parse log line:', parseError.message);
                }
            }

            console.log(`[LogBuffer] Loaded ${loaded} logs from file (${expired} expired logs ignored)`);

            // If we had expired logs, rewrite the file with only active logs
            if (expired > 0) {
                this._compactLogFile();
            }
        } catch (error) {
            console.error('[LogBuffer] Failed to load logs from file:', error.message);
        }
    }

    /**
     * Append a log entry to the file (async, non-blocking)
     */
    _appendToFile(logEntry) {
        this.writeQueue.push(logEntry);
        this._processWriteQueue();
    }

    /**
     * Process the write queue asynchronously
     */
    async _processWriteQueue() {
        if (this.isWriting || this.writeQueue.length === 0) {
            return;
        }

        this.isWriting = true;

        try {
            const entries = [...this.writeQueue];
            this.writeQueue = [];

            const lines = entries.map(entry => JSON.stringify(entry)).join('\n') + '\n';

            await fs.promises.appendFile(this.logFilePath, lines, 'utf-8');
        } catch (error) {
            console.error('[LogBuffer] Failed to write logs to file:', error.message);
            // Put failed entries back in the queue
            this.writeQueue.unshift(...this.writeQueue);
        } finally {
            this.isWriting = false;

            // Process remaining queue items
            if (this.writeQueue.length > 0) {
                setImmediate(() => this._processWriteQueue());
            }
        }
    }

    /**
     * Rewrite the log file with only active logs (removes expired entries)
     */
    _compactLogFile() {
        try {
            const cutoffTime = Date.now() - this.retentionMs;
            const activeLogsContent = this.logs
                .filter(log => log.timestampMs > cutoffTime)
                .map(log => JSON.stringify(log))
                .join('\n');

            if (activeLogsContent) {
                fs.writeFileSync(this.logFilePath, activeLogsContent + '\n', 'utf-8');
            } else {
                // No active logs, write empty file
                fs.writeFileSync(this.logFilePath, '', 'utf-8');
            }

            console.log('[LogBuffer] Compacted log file, removed expired entries');
        } catch (error) {
            console.error('[LogBuffer] Failed to compact log file:', error.message);
        }
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

        // Persist to file asynchronously
        this._appendToFile(logEntry);

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

            // Compact the log file to remove expired entries
            this._compactLogFile();
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

        // Clear the log file
        try {
            fs.writeFileSync(this.logFilePath, '', 'utf-8');
            console.log('[LogBuffer] Cleared log file');
        } catch (error) {
            console.error('[LogBuffer] Failed to clear log file:', error.message);
        }
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
    async destroy() {
        if (this.cleanupInterval) {
            clearInterval(this.cleanupInterval);
            this.cleanupInterval = null;
        }

        // Flush any pending writes before shutdown
        if (this.writeQueue.length > 0) {
            console.log('[LogBuffer] Flushing pending writes before shutdown...');
            await this._processWriteQueue();
        }
    }
}

// Singleton instance with 24-hour retention and 50k max size
const logBuffer = new LogBuffer(50000, 24 * 60 * 60 * 1000);

// Graceful shutdown cleanup
process.on('SIGTERM', () => logBuffer.destroy());
process.on('SIGINT', () => logBuffer.destroy());

export default logBuffer;
