/**
 * Stub for @tanstack/react-start/server in SPA mode
 *
 * FALLBACK ONLY: This is used when running in SPA mode (npm run dev:spa / build:spa).
 * Production uses SSR mode with real TanStack Start.
 */

export function getCookie(_name: string): string | undefined {
    return undefined;
}

export function setCookie(_name: string, _value: string, _options?: Record<string, unknown>): void {
    // No-op in SPA mode
}

export function deleteCookie(_name: string, _options?: Record<string, unknown>): void {
    // No-op in SPA mode
}

export function getRequestHeader(_name: string): string | undefined {
    return undefined;
}

export function getRequest(): Request | undefined {
    return undefined;
}

export function getWebRequest(): Request | undefined {
    return undefined;
}

export function setResponseHeader(_name: string, _value: string): void {
    // No-op in SPA mode
}

export function setResponseStatus(_status: number): void {
    // No-op in SPA mode
}

export function getEvent(): unknown {
    return undefined;
}

export function getContext(): unknown {
    return undefined;
}

export function getHeaders(): Record<string, string> {
    return {};
}
