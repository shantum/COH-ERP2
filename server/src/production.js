/**
 * Production Server — Unified entry point for Hetzner deployment
 *
 * Routes:
 *   /api/*  → Express (auth, webhooks, SSE, workers)
 *   /*      → TanStack Start SSR (frontend + Server Functions)
 */

// Force UTC before any imports — pg driver serializes Date objects using
// process timezone. Without this, timestamps shift by the server's local
// offset (e.g. CET +1h, IST +5.5h) when compared against timestamp columns.
process.env.TZ = 'UTC';

import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import logger from './utils/logger.js';
import shutdownCoordinator from './utils/shutdownCoordinator.js';
import {
  app as expressApp,
  autoArchiveOldOrders,
  backfillLtvsIfNeeded,
  startAllWorkers,
} from './index.js';
import prisma from './lib/prisma.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// --- Web ↔ Node.js conversion helpers ---

async function toWebRequest(req, url) {
  const headers = new Headers();
  for (const [key, value] of Object.entries(req.headers)) {
    if (value) {
      if (Array.isArray(value)) {
        value.forEach(v => headers.append(key, v));
      } else {
        headers.set(key, value);
      }
    }
  }

  let body = null;
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    if (chunks.length > 0) body = Buffer.concat(chunks);
  }

  return new Request(url.href, { method: req.method, headers, body, duplex: 'half' });
}

async function sendWebResponse(webRes, res) {
  res.statusCode = webRes.status;
  res.statusMessage = webRes.statusText || '';
  webRes.headers.forEach((value, key) => {
    if (key.toLowerCase() !== 'transfer-encoding') res.setHeader(key, value);
  });

  if (webRes.body) {
    const reader = webRes.body.getReader();
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        res.write(value);
      }
    } finally {
      reader.releaseLock();
    }
  }
  res.end();
}

// --- Static file serving for client assets ---

const MIME = {
  '.html': 'text/html', '.js': 'application/javascript', '.css': 'text/css',
  '.json': 'application/json', '.png': 'image/png', '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg', '.gif': 'image/gif', '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon', '.woff': 'font/woff', '.woff2': 'font/woff2',
  '.ttf': 'font/ttf', '.eot': 'application/vnd.ms-fontobject',
};

async function serveStatic(req, res, root) {
  if (req.method !== 'GET') return false;
  const url = new URL(req.url || '/', `http://${req.headers.host}`);
  const safePath = path.normalize(url.pathname).replace(/^(\.\.[/\\])+/, '');
  const filePath = path.join(root, safePath);
  if (!filePath.startsWith(root)) return false;

  try {
    const stat = await fs.promises.stat(filePath);
    if (!stat.isFile()) return false;
    const ext = path.extname(filePath).toLowerCase();
    const cacheControl = safePath.startsWith('/assets/')
      ? 'public, max-age=31536000, immutable'
      : 'public, max-age=0, must-revalidate';
    res.statusCode = 200;
    res.setHeader('Content-Type', MIME[ext] || 'application/octet-stream');
    res.setHeader('Content-Length', stat.size);
    res.setHeader('Cache-Control', cacheControl);
    fs.createReadStream(filePath).pipe(res);
    return true;
  } catch {
    return false;
  }
}

// --- Main ---

async function start() {
  const PORT = process.env.PORT || 3001;

  // Load TanStack Start SSR server
  const ssrPath = path.join(__dirname, '../../client/dist/server/server.js');
  const clientDistPath = path.join(__dirname, '../../client/dist/client');

  let tanstack;
  try {
    tanstack = await import(ssrPath);
    logger.info('TanStack Start SSR server loaded');
  } catch (error) {
    logger.fatal({ error: error.message }, 'Failed to load TanStack Start server — did client build?');
    process.exit(1);
  }

  const server = http.createServer(async (req, res) => {
    const host = req.headers.host || 'localhost';
    const protocol = req.headers['x-forwarded-proto'] || 'http';
    const url = new URL(req.url || '/', `${protocol}://${host}`);

    // /api/* and legal pages → Express
    if (url.pathname.startsWith('/api/') || url.pathname === '/privacy' || url.pathname === '/terms') {
      expressApp(req, res);
      return;
    }

    // Static assets (hashed JS/CSS/images from client build)
    if (await serveStatic(req, res, clientDistPath)) return;

    // Everything else → TanStack Start SSR
    try {
      const webReq = await toWebRequest(req, url);
      const webRes = await tanstack.default.fetch(webReq);
      await sendWebResponse(webRes, res);
    } catch (error) {
      logger.error({ error: error.message, stack: error.stack }, 'SSR error');
      if (!res.headersSent) {
        res.statusCode = 500;
        res.setHeader('Content-Type', 'text/plain');
        res.end('Internal Server Error');
      }
    }
  });

  server.listen(PORT, '0.0.0.0', async () => {
    logger.info(`Unified server running on port ${PORT}`);
    await autoArchiveOldOrders(prisma);
    await backfillLtvsIfNeeded(prisma);
    await startAllWorkers();
    logger.info('Background workers started');

    // Signal PM2 that this process is ready to accept traffic.
    // PM2 keeps the old process alive until this fires (zero-downtime reload).
    if (process.send) {
      process.send('ready');
    }
  });

  server.on('error', (error) => {
    logger.fatal({ error: error.message }, 'Server error');
    process.exit(1);
  });

  // Graceful shutdown
  for (const signal of ['SIGTERM', 'SIGINT']) {
    process.on(signal, async () => {
      logger.info(`${signal} received, shutting down...`);
      server.close();
      await shutdownCoordinator.shutdown();
      logger.info('Server shut down complete');
      process.exit(0);
    });
  }
}

// Global error handlers
process.on('uncaughtException', (error) => {
  logger.fatal({ type: 'UncaughtException', message: error.message, stack: error.stack },
    `Uncaught exception: ${error.message}`);
  setTimeout(() => process.exit(1), 1000);
});

process.on('unhandledRejection', (reason) => {
  logger.error({ type: 'UnhandledRejection',
    reason: reason instanceof Error ? { message: reason.message, stack: reason.stack } : reason },
    `Unhandled rejection: ${reason}`);
});

start().catch((error) => {
  console.error('Failed to start production server:', error);
  process.exit(1);
});
