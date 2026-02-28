/**
 * Shared utilities for Server Functions.
 */

/**
 * Returns the base URL for internal API calls (Express server).
 *
 * Always uses loopback (127.0.0.1) to guarantee verifyInternalRequest accepts
 * the call as localhost. Never uses VITE_API_URL which may point to a public host.
 */
export function getInternalApiBaseUrl(): string {
    return `http://127.0.0.1:${process.env.PORT || 3001}`;
}

/**
 * Build standard headers for internal API calls.
 * Attaches X-Internal-Secret when available (for verifyInternalRequest).
 */
export function getInternalHeaders(): Record<string, string> {
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    const secret = process.env.INTERNAL_API_SECRET;
    if (secret) {
        headers['X-Internal-Secret'] = secret;
    }
    return headers;
}

/**
 * Fire-and-forget POST to an internal Express endpoint.
 * Uses loopback + internal secret for verifyInternalRequest.
 */
export function callInternalApi(path: string, body: unknown): void {
    const url = `${getInternalApiBaseUrl()}${path}`;
    fetch(url, {
        method: 'POST',
        headers: getInternalHeaders(),
        body: JSON.stringify(body),
    }).catch((err: unknown) => {
        console.warn(`[callInternalApi] ${path} failed:`, err instanceof Error ? err.message : String(err));
    });
}

/**
 * Fetch an authenticated Express endpoint from a Server Function.
 * Forwards the user's auth_token cookie as Authorization header.
 * Uses loopback base URL.
 */
export async function internalFetch(path: string, init?: RequestInit): Promise<Response> {
    // Dynamic import to avoid breaking client bundling
    const { getCookie } = await import('@tanstack/react-start/server');
    const authToken = getCookie('auth_token');

    const headers: Record<string, string> = {
        'Content-Type': 'application/json',
        ...(authToken ? { Authorization: `Bearer ${authToken}` } : {}),
    };

    const url = `${getInternalApiBaseUrl()}${path}`;
    return fetch(url, {
        ...init,
        headers: { ...headers, ...(init?.headers as Record<string, string> ?? {}) },
    });
}

/**
 * Call an Express API endpoint, parse JSON response, throw on error.
 * Typed wrapper around internalFetch for server functions that need
 * structured responses with error handling.
 */
export async function callExpressApi<T>(
    path: string,
    options: RequestInit = {}
): Promise<T> {
    const response = await internalFetch(path, options);

    if (!response.ok) {
        const errorBody = await response.text();
        let errorMessage: string;
        try {
            const errorJson = JSON.parse(errorBody) as { error?: string; message?: string };
            errorMessage = errorJson.error || errorJson.message || `API call failed: ${response.status}`;
        } catch {
            errorMessage = `API call failed: ${response.status} - ${errorBody}`;
        }
        throw new Error(errorMessage);
    }

    return response.json() as Promise<T>;
}
