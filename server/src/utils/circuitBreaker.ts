/**
 * Circuit Breaker
 *
 * Implements the circuit breaker pattern to prevent cascading failures
 * when external services (like Shopify API) are unavailable.
 *
 * States:
 * - CLOSED: Normal operation, requests pass through
 * - OPEN: Circuit is tripped, requests fail fast
 * - HALF_OPEN: Testing if service has recovered
 */

import { CIRCUIT_BREAKER_CONFIG } from '../config/index.js';
import { syncLogger } from './logger.js';

// ============================================
// TYPE DEFINITIONS
// ============================================

type CircuitState = 'CLOSED' | 'OPEN' | 'HALF_OPEN';

interface CircuitBreakerOptions {
    failureThreshold?: number;
    resetTimeoutMs?: number;
    halfOpenMaxRequests?: number;
}

interface CircuitStatus {
    name: string;
    state: CircuitState;
    failures: number;
    successes: number;
    lastFailureAt: Date | null;
    nextResetAt: Date | null;
}

// ============================================
// CIRCUIT BREAKER CLASS
// ============================================

class CircuitBreaker {
    private name: string;
    private state: CircuitState;
    private failures: number;
    private successes: number;
    private lastFailureAt: Date | null;
    private nextResetAt: Date | null;
    private halfOpenRequests: number;

    private failureThreshold: number;
    private resetTimeoutMs: number;
    private halfOpenMaxRequests: number;

    constructor(name: string, options: CircuitBreakerOptions = {}) {
        this.name = name;
        this.state = 'CLOSED';
        this.failures = 0;
        this.successes = 0;
        this.lastFailureAt = null;
        this.nextResetAt = null;
        this.halfOpenRequests = 0;

        // Use config defaults, allow override
        this.failureThreshold = options.failureThreshold ?? CIRCUIT_BREAKER_CONFIG.failureThreshold;
        this.resetTimeoutMs = options.resetTimeoutMs ?? CIRCUIT_BREAKER_CONFIG.resetTimeoutMs;
        this.halfOpenMaxRequests = options.halfOpenMaxRequests ?? CIRCUIT_BREAKER_CONFIG.halfOpenMaxRequests;
    }

    /**
     * Check if circuit allows requests
     */
    isAvailable(): boolean {
        if (this.state === 'CLOSED') {
            return true;
        }

        if (this.state === 'OPEN') {
            // Check if reset timeout has passed
            if (this.nextResetAt && Date.now() >= this.nextResetAt.getTime()) {
                this.transitionTo('HALF_OPEN');
                return true;
            }
            return false;
        }

        // HALF_OPEN: Allow limited requests
        return this.halfOpenRequests < this.halfOpenMaxRequests;
    }

    /**
     * Execute a function with circuit breaker protection
     */
    async execute<T>(fn: () => Promise<T>): Promise<T> {
        if (!this.isAvailable()) {
            throw new CircuitBreakerOpenError(this.name, this.nextResetAt);
        }

        if (this.state === 'HALF_OPEN') {
            this.halfOpenRequests++;
        }

        try {
            const result = await fn();
            this.recordSuccess();
            return result;
        } catch (error) {
            this.recordFailure();
            throw error;
        }
    }

    /**
     * Record a successful request
     */
    recordSuccess(): void {
        this.successes++;

        if (this.state === 'HALF_OPEN') {
            // Successful request in half-open state, reset circuit
            syncLogger.info({ name: this.name }, 'Circuit breaker: service recovered, closing circuit');
            this.transitionTo('CLOSED');
        }

        // Reset failure count on success (sliding window could be added later)
        this.failures = 0;
    }

    /**
     * Record a failed request
     */
    recordFailure(): void {
        this.failures++;
        this.lastFailureAt = new Date();

        if (this.state === 'HALF_OPEN') {
            // Failure in half-open state, re-open circuit
            syncLogger.warn({ name: this.name }, 'Circuit breaker: service still failing, reopening circuit');
            this.transitionTo('OPEN');
            return;
        }

        if (this.state === 'CLOSED' && this.failures >= this.failureThreshold) {
            syncLogger.warn({ name: this.name, failures: this.failures }, 'Circuit breaker: threshold reached, opening circuit');
            this.transitionTo('OPEN');
        }
    }

    /**
     * Manually reset the circuit breaker
     */
    reset(): void {
        syncLogger.info({ name: this.name }, 'Circuit breaker: manually reset');
        this.transitionTo('CLOSED');
    }

    /**
     * Get current status
     */
    getStatus(): CircuitStatus {
        return {
            name: this.name,
            state: this.state,
            failures: this.failures,
            successes: this.successes,
            lastFailureAt: this.lastFailureAt,
            nextResetAt: this.nextResetAt,
        };
    }

    /**
     * Transition to a new state
     */
    private transitionTo(newState: CircuitState): void {
        const oldState = this.state;
        this.state = newState;

        if (newState === 'CLOSED') {
            this.failures = 0;
            this.successes = 0;
            this.nextResetAt = null;
            this.halfOpenRequests = 0;
        } else if (newState === 'OPEN') {
            this.nextResetAt = new Date(Date.now() + this.resetTimeoutMs);
        } else if (newState === 'HALF_OPEN') {
            this.halfOpenRequests = 0;
        }

        syncLogger.debug({ name: this.name, from: oldState, to: newState }, 'Circuit breaker state transition');
    }
}

// ============================================
// ERROR CLASS
// ============================================

export class CircuitBreakerOpenError extends Error {
    public circuitName: string;
    public resetAt: Date | null;

    constructor(circuitName: string, resetAt: Date | null) {
        super(`Circuit breaker '${circuitName}' is open`);
        this.name = 'CircuitBreakerOpenError';
        this.circuitName = circuitName;
        this.resetAt = resetAt;
    }
}

// ============================================
// CIRCUIT BREAKER REGISTRY
// ============================================

const circuitBreakers = new Map<string, CircuitBreaker>();

/**
 * Get or create a circuit breaker by name
 */
export function getCircuitBreaker(name: string, options?: CircuitBreakerOptions): CircuitBreaker {
    let breaker = circuitBreakers.get(name);
    if (!breaker) {
        breaker = new CircuitBreaker(name, options);
        circuitBreakers.set(name, breaker);
    }
    return breaker;
}

/**
 * Get status of all circuit breakers
 */
export function getAllCircuitBreakerStatus(): CircuitStatus[] {
    return Array.from(circuitBreakers.values()).map(cb => cb.getStatus());
}

/**
 * Reset all circuit breakers
 */
export function resetAllCircuitBreakers(): void {
    for (const breaker of circuitBreakers.values()) {
        breaker.reset();
    }
}

// ============================================
// PRE-CONFIGURED CIRCUIT BREAKERS
// ============================================

// Shopify API circuit breaker
export const shopifyApiCircuit = getCircuitBreaker('shopify_api');

// ============================================
// EXPORTS
// ============================================

export { CircuitBreaker };
export type { CircuitBreakerOptions, CircuitStatus, CircuitState };
