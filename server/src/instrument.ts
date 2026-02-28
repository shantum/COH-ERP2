/**
 * Sentry Instrumentation — must be imported before all other modules.
 *
 * Import this at the very top of index.js and production.js:
 *   import './instrument.js';
 */

import fs from 'node:fs';
import path from 'node:path';
import * as Sentry from '@sentry/node';
import { env } from './config/env.js';

function getRelease(): string {
  try {
    return fs.readFileSync(path.join(process.cwd(), 'VERSION'), 'utf8').trim();
  } catch {
    return 'dev';
  }
}

if (env.SENTRY_DSN) {
  Sentry.init({
    dsn: env.SENTRY_DSN,
    environment: env.NODE_ENV,
    release: `coh-erp-backend@${getRelease()}`,
    tracesSampleRate: env.NODE_ENV === 'production' ? 0.2 : 1.0,
  });

  // Bridge: route all console.error calls through Sentry
  // Logger intercepts console.error, so this covers every catch block in the app
  import('./utils/logger.js').then(({ setSentryCaptureError }) => {
    setSentryCaptureError((error, extra) => {
      if (error instanceof Error) {
        Sentry.captureException(error, { extra });
      } else {
        Sentry.captureMessage(error, { level: 'error', extra });
      }
    });
  });
}
