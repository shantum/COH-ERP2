/**
 * Stub for @tanstack/react-start/server in SPA mode
 *
 * Server utilities like getCookie, setCookie are not available in SPA mode.
 * These stubs provide no-op implementations so the SPA build doesn't fail.
 *
 * Real implementations are used in SSR mode (npm run dev / npm run build:ssr)
 */

// Cookie utilities - return undefined/no-op in SPA mode
export function getCookie(_name: string): string | undefined {
    return undefined;
}

export function setCookie(_name: string, _value: string, _options?: Record<string, unknown>): void {
    // No-op in SPA mode
}

export function deleteCookie(_name: string, _options?: Record<string, unknown>): void {
    // No-op in SPA mode
}

// Request utilities
export function getRequestHeader(_name: string): string | undefined {
    return undefined;
}

export function getRequest(): Request | undefined {
    return undefined;
}

export function getWebRequest(): Request | undefined {
    return undefined;
}

// Response utilities
export function setResponseHeader(_name: string, _value: string): void {
    // No-op in SPA mode
}

export function setResponseStatus(_status: number): void {
    // No-op in SPA mode
}

// Event/context utilities
export function getEvent(): unknown {
    return undefined;
}

export function getContext(): unknown {
    return undefined;
}
