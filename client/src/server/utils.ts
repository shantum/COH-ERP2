/**
 * Shared utilities for Server Functions.
 */

/**
 * Returns the base URL for internal API calls (Express server).
 *
 * In production, the unified server listens on PORT (not 3001).
 * Server Functions run in the same process and need to reach Express via HTTP.
 * Uses 127.0.0.1 (not "localhost") to avoid DNS resolution issues.
 */
export function getInternalApiBaseUrl(): string {
    return process.env.VITE_API_URL || `http://127.0.0.1:${process.env.PORT || 3001}`;
}
