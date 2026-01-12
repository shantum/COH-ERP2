import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/** Log level types */
export type LogLevel = 'trace' | 'debug' | 'info' | 'warn' | 'error' | 'fatal';

/** Structure of a log entry */
export interface LogEntry {
    id: string;
    timestamp: string;
    timestampMs: number;
    level: LogLevel;
    message: string;
    context: Record<string, unknown>;
}

/** Options for getLogs method */
export interface GetLogsOptions {
    level?: LogLevel | 'all' | null;
    limit?: number;
    offset?: number;
    search?: string | null;
}

/** Response from getLogs method */
export interface GetLogsResponse {
    logs: LogEntry[];
    total: number;
    limit: number;
    offset: number;
}

/** Level counts structure */
export interface LevelCounts {
    fatal: number;
    error: number;
    warn: number;
    info: number;
    debug: number;
    trace: number;
}

/** Stats response structure */
export interface LogStats {
    total: number;
    maxSize: number;
    retentionHours: number;
    byLevel: LevelCounts;
    lastHour: {
        total: number;
        byLevel: LevelCounts;
    };
    last24Hours: {
        total: number;
        byLevel: LevelCounts;
    };
    oldestLog: string | undefined;
    newestLog: string | undefined;
    nextCleanup: string;
}

/**
 * Persistent log buffer for server logs viewer
 * Retains logs for 24 hours with automatic cleanup
 * Persists logs to disk to survive server restarts
 */
class LogBuffer {
    private maxSize: number;
    private retentionMs: number;
    private logs: LogEntry[];
    private lastCleanup: number;
    private logsDir: string;
    private logFilePath: string;
    private writeQueue: LogEntry[];
    private isWriting: boolean;
    private cleanupInterval: ReturnType<typeof setInterval> | null;

    constructor(maxSize: number = 50000, retentionMs: number = 24 * 60 * 60 * 1000) {
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
        this.cleanupInterval = null;

        // Initialize: ensure directory exists and load existing logs
        this._initialize();

        // Run cleanup every hour
        this.cleanupInterval = setInterval(() => this.cleanup(), 60 * 60 * 1000);
    }

    /**
     * Initialize log buffer: create directory and load existing logs
     */
    private _initialize(): void {
        try {
            // Create logs directory if it doesn't exist
            if (!fs.existsSync(this.logsDir)) {
                fs.mkdirSync(this.logsDir, { recursive: true });
                console.log('[LogBuffer] Created logs directory:', this.logsDir);
            }

            // Load existing logs from file
            this._loadLogsFromFile();
        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : String(error);
            console.error('[LogBuffer] Failed to initialize:', errorMessage);
        }
    }

    /**
     * Load logs from file on startup, filtering to retention window
     */
    private _loadLogsFromFile(): void {
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
                    const logEntry = JSON.parse(line) as LogEntry;

                    // Only load logs within retention window
                    if (logEntry.timestampMs > cutoffTime) {
                        this.logs.push(logEntry);
                        loaded++;
                    } else {
                        expired++;
                    }
                } catch (parseError) {
                    const errorMessage = parseError instanceof Error ? parseError.message : String(parseError);
                    console.error('[LogBuffer] Failed to parse log line:', errorMessage);
                }
            }

            console.log(`[LogBuffer] Loaded ${loaded} logs from file (${expired} expired logs ignored)`);

            // If we had expired logs, rewrite the file with only active logs
            if (expired > 0) {
                this._compactLogFile();
            }
        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : String(error);
            console.error('[LogBuffer] Failed to load logs from file:', errorMessage);
        }
    }

    /**
     * Append a log entry to the file (async, non-blocking)
     */
    private _appendToFile(logEntry: LogEntry): void {
        this.writeQueue.push(logEntry);
        this._processWriteQueue();
    }

    /**
     * Process the write queue asynchronously
     */
    private async _processWriteQueue(): Promise<void> {
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
            const errorMessage = error instanceof Error ? error.message : String(error);
            console.error('[LogBuffer] Failed to write logs to file:', errorMessage);
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
    private _compactLogFile(): void {
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
            const errorMessage = error instanceof Error ? error.message : String(error);
            console.error('[LogBuffer] Failed to compact log file:', errorMessage);
        }
    }

    addLog(level: LogLevel, message: string, context: Record<string, unknown> = {}): void {
        const timestamp = new Date().toISOString();
        const timestampMs = Date.now();

        const logEntry: LogEntry = {
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
    cleanup(): void {
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

    getLogs({ level = null, limit = 100, offset = 0, search = null }: GetLogsOptions = {}): GetLogsResponse {
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

    clearLogs(): void {
        this.logs = [];
        this.lastCleanup = Date.now();

        // Clear the log file
        try {
            fs.writeFileSync(this.logFilePath, '', 'utf-8');
            console.log('[LogBuffer] Cleared log file');
        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : String(error);
            console.error('[LogBuffer] Failed to clear log file:', errorMessage);
        }
    }

    private _countByLevel(logs: LogEntry[]): LevelCounts {
        return {
            fatal: logs.filter(l => l.level === 'fatal').length,
            error: logs.filter(l => l.level === 'error').length,
            warn: logs.filter(l => l.level === 'warn').length,
            info: logs.filter(l => l.level === 'info').length,
            debug: logs.filter(l => l.level === 'debug').length,
            trace: logs.filter(l => l.level === 'trace').length,
        };
    }

    getStats(): LogStats {
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
            byLevel: this._countByLevel(activeLogs),
            lastHour: {
                total: recentLogs.length,
                byLevel: this._countByLevel(recentLogs),
            },
            last24Hours: {
                total: activeLogs.length,
                byLevel: this._countByLevel(activeLogs),
            },
            oldestLog: activeLogs[0]?.timestamp,
            newestLog: activeLogs[activeLogs.length - 1]?.timestamp,
            nextCleanup: new Date(this.lastCleanup + (60 * 60 * 1000)).toISOString(),
        };
    }

    /**
     * Cleanup interval management for graceful shutdown
     */
    async destroy(): Promise<void> {
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
