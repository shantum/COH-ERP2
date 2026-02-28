/**
 * Sentry Instrumentation — must be imported before all other modules.
 *
 * Import this at the very top of index.js and production.js:
 *   import './instrument.js';
 */

import * as Sentry from '@sentry/node';
import { env } from './config/env.js';

if (env.SENTRY_DSN) {
  Sentry.init({
    dsn: env.SENTRY_DSN,
    environment: env.NODE_ENV,
    tracesSampleRate: env.NODE_ENV === 'production' ? 0.2 : 1.0,
  });
}
