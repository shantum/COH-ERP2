/**
 * Stub for vinxi in SPA mode
 *
 * FALLBACK ONLY: This is used when running in SPA mode (npm run dev:spa / build:spa).
 * Production uses SSR mode with real Vinxi.
 */

export function getCookie() {
  return undefined;
}

export function setCookie() {}

export function getHeader() {
  return undefined;
}

export function setHeader() {}

export function getHeaders(): Record<string, string | undefined> {
  return {};
}

export function getRequestURL() {
  return typeof window !== 'undefined' ? window.location.href : '';
}

export function getRequestHost() {
  return typeof window !== 'undefined' ? window.location.host : '';
}

export function getRequestProtocol() {
  return typeof window !== 'undefined' ? window.location.protocol.replace(':', '') : 'https';
}

export function getRequestPath() {
  return typeof window !== 'undefined' ? window.location.pathname : '/';
}

export function getQuery() {
  return {};
}

export function readBody() {
  return Promise.resolve(null);
}

export function sendRedirect() {}

export function setResponseStatus() {}

export function createError() {
  return new Error('Not available in SPA mode');
}

export const eventHandler = (fn: unknown) => fn;
export const defineEventHandler = eventHandler;

export default {};
