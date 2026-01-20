/**
 * Stub for vinxi in SPA mode
 *
 * Vinxi requires Node.js APIs (AsyncLocalStorage, etc.)
 * This stub provides empty implementations for SPA build.
 */

export function getCookie() {
  return undefined;
}

export function setCookie() {}

export function getHeader() {
  return undefined;
}

export function setHeader() {}

export function getHeaders() {
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

export const eventHandler = (fn: any) => fn;
export const defineEventHandler = eventHandler;

export default {};
