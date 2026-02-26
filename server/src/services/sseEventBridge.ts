/**
 * SSE Event Bridge — Postgres LISTEN to SSE broadcast bridge
 *
 * Listens on 'coh_erp_events' channel and dispatches notifications
 * to broadcastOrderUpdate, enabling cross-process SSE fan-out.
 *
 * Uses dedicated pg.Client (not Pool) for LISTEN reliability.
 *
 * Payload format from NOTIFY:
 * { event: OrderUpdateEvent, excludeUserId: string | null }
 */

import { Client } from 'pg';
import logger from '../utils/logger.js';
import { broadcastOrderUpdate } from '../routes/sse.js';
import type { OrderUpdateEvent } from '../routes/sse.js';

const log = logger.child({ module: 'sseEventBridge' });

interface SSENotifyPayload {
    event: OrderUpdateEvent;
    excludeUserId: string | null;
}

class SseEventBridge {
    private client: Client | null = null;
    private reconnectTimeout: ReturnType<typeof setTimeout> | null = null;
    private reconnectAttempts = 0;
    private isShuttingDown = false;

    /**
     * Start the bridge — connect to Postgres and begin listening
     */
    async start(): Promise<void> {
        await this.connect();
    }

    private async connect(): Promise<void> {
        if (this.isShuttingDown) return;

        try {
            this.client = new Client({
                connectionString: process.env.DATABASE_URL,
            });

            this.client.on('error', (err) => this.handleError(err));
            this.client.on('notification', (msg) => this.handleNotification(msg));
            this.client.on('end', () => {
                if (!this.isShuttingDown) {
                    log.info('Connection ended unexpectedly');
                    this.scheduleReconnect();
                }
            });

            await this.client.connect();
            await this.client.query('LISTEN coh_erp_events');

            this.reconnectAttempts = 0;
            log.info('Connected to Postgres, listening on coh_erp_events');
        } catch (err) {
            log.error({ err: err instanceof Error ? err.message : err }, 'Connection error');
            this.scheduleReconnect();
        }
    }

    private handleError(err: Error): void {
        log.error({ err: err.message }, 'Client error');
        this.scheduleReconnect();
    }

    private handleNotification(msg: { channel: string; payload?: string }): void {
        if (msg.channel !== 'coh_erp_events' || !msg.payload) return;

        try {
            const { event, excludeUserId } = JSON.parse(msg.payload) as SSENotifyPayload;
            log.info({ type: event.type }, 'Dispatching SSE event from pg NOTIFY');
            broadcastOrderUpdate(event, excludeUserId);
        } catch (err) {
            log.error({ err }, 'Failed to parse notification payload');
        }
    }

    private scheduleReconnect(): void {
        if (this.reconnectTimeout || this.isShuttingDown) return;

        // Exponential backoff: 1s, 2s, 4s, 8s, ... max 30s
        const delay = Math.min(1000 * Math.pow(2, this.reconnectAttempts), 30000);
        this.reconnectAttempts++;

        log.info({ delayMs: delay, attempt: this.reconnectAttempts }, 'Reconnecting');

        this.reconnectTimeout = setTimeout(async () => {
            this.reconnectTimeout = null;
            if (this.client) {
                try {
                    await this.client.end();
                } catch {
                    // Ignore cleanup errors
                }
                this.client = null;
            }
            await this.connect();
        }, delay);
    }

    /**
     * Graceful shutdown
     */
    async shutdown(): Promise<void> {
        this.isShuttingDown = true;

        if (this.reconnectTimeout) {
            clearTimeout(this.reconnectTimeout);
            this.reconnectTimeout = null;
        }

        if (this.client) {
            try {
                await this.client.query('UNLISTEN *');
                await this.client.end();
            } catch (err) {
                log.error({ err }, 'Error during shutdown');
            }
            this.client = null;
        }

        log.info('Shutdown complete');
    }
}

// Singleton instance
export const sseEventBridge = new SseEventBridge();
