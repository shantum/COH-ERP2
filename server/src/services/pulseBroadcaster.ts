/**
 * PulseBroadcaster - Postgres LISTEN to SSE bridge
 *
 * Listens on 'coh_erp_pulse' channel and broadcasts signals to SSE clients.
 * Uses dedicated pg.Client (not Pool) for LISTEN reliability.
 *
 * Signal format from triggers:
 * { table: "Order", op: "UPDATE", id: "uuid-here" }
 */

import { Client } from 'pg';
import type { Response } from 'express';
import logger from '../utils/logger.js';

const log = logger.child({ module: 'pulse' });

export interface PulseSignal {
    table: string;
    op: 'INSERT' | 'UPDATE' | 'DELETE';
    id: string;
}

interface PulseMessage {
    type: 'connected' | 'disconnected' | 'signal';
    table?: string;
    op?: string;
    id?: string;
}

class PulseBroadcaster {
    private client: Client | null = null;
    private clients: Set<Response> = new Set();
    private reconnectTimeout: ReturnType<typeof setTimeout> | null = null;
    private reconnectAttempts = 0;
    private isConnected = false;
    private isShuttingDown = false;

    /**
     * Start the broadcaster - connect to Postgres and begin listening
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
                    this.isConnected = false;
                    this.broadcast({ type: 'disconnected' });
                    this.scheduleReconnect();
                }
            });

            await this.client.connect();
            await this.client.query('LISTEN coh_erp_pulse');

            this.isConnected = true;
            this.reconnectAttempts = 0;
            log.info('Connected to Postgres, listening on coh_erp_pulse');

            // Broadcast connection status to all clients
            this.broadcast({ type: 'connected' });
        } catch (err) {
            log.error({ err: err instanceof Error ? err.message : err }, 'Connection error');
            this.scheduleReconnect();
        }
    }

    private handleError(err: Error): void {
        log.error({ err: err.message }, 'Client error');
        this.isConnected = false;
        this.broadcast({ type: 'disconnected' });
        this.scheduleReconnect();
    }

    private handleNotification(msg: { channel: string; payload?: string }): void {
        if (msg.channel !== 'coh_erp_pulse' || !msg.payload) return;

        try {
            const signal: PulseSignal = JSON.parse(msg.payload);
            log.info({ table: signal.table, op: signal.op, id: signal.id.substring(0, 8) }, 'Signal received');
            this.broadcast({ type: 'signal', ...signal });
        } catch (err) {
            log.error({ err }, 'Failed to parse notification');
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

    private broadcast(data: PulseMessage): void {
        const message = `data: ${JSON.stringify(data)}\n\n`;

        const deadClients: Response[] = [];
        this.clients.forEach((client) => {
            try {
                client.write(message);
            } catch {
                deadClients.push(client);
            }
        });

        // Clean up dead clients
        deadClients.forEach((client) => this.clients.delete(client));
    }

    /**
     * Add an SSE client connection
     */
    addClient(res: Response): void {
        this.clients.add(res);

        // Send initial status
        const status: PulseMessage = {
            type: this.isConnected ? 'connected' : 'disconnected',
        };
        res.write(`data: ${JSON.stringify(status)}\n\n`);
    }

    /**
     * Remove an SSE client connection
     */
    removeClient(res: Response): void {
        this.clients.delete(res);
    }

    /**
     * Get current status for health checks
     */
    getStatus(): { connected: boolean; clients: number } {
        return {
            connected: this.isConnected,
            clients: this.clients.size,
        };
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

        // Close all SSE connections
        this.clients.forEach((client) => {
            try {
                client.end();
            } catch {
                // Ignore
            }
        });
        this.clients.clear();

        log.info('Shutdown complete');
    }
}

// Singleton instance
export const pulseBroadcaster = new PulseBroadcaster();
