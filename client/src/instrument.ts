/**
 * Sentry Browser Instrumentation — must be imported before all other modules.
 *
 * Import this as the very first line of main.tsx:
 *   import './instrument';
 */

import * as Sentry from '@sentry/react';

const dsn = import.meta.env.VITE_SENTRY_DSN;

if (dsn) {
  Sentry.init({
    dsn,
    environment: import.meta.env.MODE,
    release: import.meta.env.VITE_SENTRY_RELEASE || `coh-erp-frontend@${import.meta.env.MODE}`,
    tracesSampleRate: import.meta.env.MODE === 'production' ? 0.2 : 1.0,
    replaysSessionSampleRate: 0,
    replaysOnErrorSampleRate: 1.0,
    integrations: [
      Sentry.browserTracingIntegration(),
      Sentry.replayIntegration(),
    ],
  });
}
