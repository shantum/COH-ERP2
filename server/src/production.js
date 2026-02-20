/**
 * Production Server - Unified entry point for deployment
 *
 * This server integrates:
 * 1. TanStack Start SSR server (for frontend + Server Functions)
 * 2. Express API server (for auth, webhooks, SSE, file uploads)
 *
 * Architecture:
 * - Main HTTP server listens on PORT (default: 3000)
 * - /api/* requests → Express
 * - All other requests → TanStack Start SSR
 */

import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  createExpressApp,
  startBackgroundWorkers,
  setupGlobalHandlers,
  logger,
} from './expressApp.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/**
 * Convert Node.js IncomingMessage to Web Request
 */
async function nodeRequestToWebRequest(req, url) {
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

  // Read body for non-GET/HEAD requests
  let body = null;
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    const chunks = [];
    for await (const chunk of req) {
      chunks.push(chunk);
    }
    if (chunks.length > 0) {
      body = Buffer.concat(chunks);
    }
  }

  return new Request(url.href, {
    method: req.method,
    headers,
    body,
    duplex: 'half',
  });
}

/**
 * Send Web Response to Node.js ServerResponse
 */
async function sendWebResponse(webResponse, res) {
  res.statusCode = webResponse.status;
  res.statusMessage = webResponse.statusText || '';

  // Copy headers
  webResponse.headers.forEach((value, key) => {
    // Skip headers that Node.js handles
    if (key.toLowerCase() !== 'transfer-encoding') {
      res.setHeader(key, value);
    }
  });

  // Stream body
  if (webResponse.body) {
    const reader = webResponse.body.getReader();
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

/**
 * MIME types for static file serving
 */
const MIME_TYPES = {
  '.html': 'text/html',
  '.js': 'application/javascript',
  '.css': 'text/css',
  '.json': 'application/json',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.eot': 'application/vnd.ms-fontobject',
};

/**
 * Serve static files from client/dist
 * Returns true if file was served, false otherwise
 */
async function serveStaticFile(req, res, clientDistPath) {
  // Only handle GET requests for static files
  if (req.method !== 'GET') return false;

  const url = new URL(req.url || '/', `http://${req.headers.host}`);

  // Security: prevent directory traversal
  const safePath = path.normalize(url.pathname).replace(/^(\.\.[\/\\])+/, '');
  const filePath = path.join(clientDistPath, safePath);

  // Debug logging for static file requests
  if (safePath.startsWith('/assets/')) {
    console.log(`[Static] Request: ${safePath}`);
    console.log(`[Static] clientDistPath: ${clientDistPath}`);
    console.log(`[Static] filePath: ${filePath}`);
  }

  // Ensure file is within client dist directory
  if (!filePath.startsWith(clientDistPath)) {
    console.log(`[Static] REJECTED - path traversal attempt: ${filePath}`);
    return false;
  }

  try {
    const stat = await fs.promises.stat(filePath);
    if (!stat.isFile()) {
      if (safePath.startsWith('/assets/')) {
        console.log(`[Static] NOT A FILE: ${filePath}`);
      }
      return false;
    }

    const ext = path.extname(filePath).toLowerCase();
    const contentType = MIME_TYPES[ext] || 'application/octet-stream';

    // Set caching headers for assets (hashed filenames = immutable)
    const cacheControl = safePath.startsWith('/assets/')
      ? 'public, max-age=31536000, immutable'
      : 'public, max-age=0, must-revalidate';

    res.statusCode = 200;
    res.setHeader('Content-Type', contentType);
    res.setHeader('Content-Length', stat.size);
    res.setHeader('Cache-Control', cacheControl);

    if (safePath.startsWith('/assets/')) {
      console.log(`[Static] SERVING: ${filePath}`);
    }
    const stream = fs.createReadStream(filePath);
    stream.pipe(res);
    return true;
  } catch (error) {
    if (safePath.startsWith('/assets/')) {
      console.log(`[Static] ERROR: ${filePath} - ${error.code || error.message}`);
    }
    return false;
  }
}

async function startProductionServer() {
  const PORT = process.env.PORT || 3000;

  // Setup global error handlers
  setupGlobalHandlers();

  console.log('[Production] Starting unified server...');

  // Create Express app for API routes
  const expressApp = await createExpressApp();
  console.log('[Production] Express API initialized');

  // Load TanStack Start server
  const tanstackServerPath = path.join(__dirname, '../../client/dist/server/server.js');
  // TanStack Start puts client assets in client/dist/client/, not client/dist/
  const clientDistPath = path.join(__dirname, '../../client/dist/client');

  // Debug: Log paths and directory contents
  console.log(`[Production] __dirname: ${__dirname}`);
  console.log(`[Production] clientDistPath: ${clientDistPath}`);
  try {
    const distContents = await fs.promises.readdir(clientDistPath);
    console.log(`[Production] client/dist contents: ${distContents.join(', ')}`);
    if (distContents.includes('assets')) {
      const assetsContents = await fs.promises.readdir(path.join(clientDistPath, 'assets'));
      console.log(`[Production] assets/ contains ${assetsContents.length} files`);
      console.log(`[Production] First 5 assets: ${assetsContents.slice(0, 5).join(', ')}`);
    }
  } catch (error) {
    console.error(`[Production] ERROR reading client/dist: ${error.message}`);
  }

  let tanstackServer;
  try {
    tanstackServer = await import(tanstackServerPath);
    console.log('[Production] TanStack Start SSR server loaded');
  } catch (error) {
    console.error('[Production] Failed to load TanStack Start server:', error);
    console.error('[Production] Make sure client build completed: npm run build in client/');
    process.exit(1);
  }

  // Create unified HTTP server
  const server = http.createServer(async (req, res) => {
    const host = req.headers.host || 'localhost';
    const protocol = req.headers['x-forwarded-proto'] || 'http';
    const url = new URL(req.url || '/', `${protocol}://${host}`);

    // Route /api/* to Express
    if (url.pathname.startsWith('/api/')) {
      expressApp(req, res);
      return;
    }

    // Serve static files from client/dist (assets, favicon, etc.)
    if (await serveStaticFile(req, res, clientDistPath)) {
      return;
    }

    // Route everything else to TanStack Start SSR
    try {
      const webRequest = await nodeRequestToWebRequest(req, url);
      const webResponse = await tanstackServer.default.fetch(webRequest);
      await sendWebResponse(webResponse, res);
    } catch (error) {
      logger.error({ error: error.message, stack: error.stack }, '[Production] SSR error');
      if (!res.headersSent) {
        res.statusCode = 500;
        res.setHeader('Content-Type', 'text/html');
        res.end(`
          <!DOCTYPE html>
          <html>
            <head><title>Error</title></head>
            <body>
              <h1>Server Error</h1>
              <p>An error occurred while rendering the page.</p>
              ${process.env.NODE_ENV !== 'production' ? `<pre>${error.stack}</pre>` : ''}
            </body>
          </html>
        `);
      }
    }
  });

  // Start listening
  server.listen(PORT, '0.0.0.0', async () => {
    console.log(`[Production] ✅ Unified server running on port ${PORT}`);
    console.log(`[Production]    API routes: /api/*`);
    console.log(`[Production]    Frontend SSR: /*`);

    // Start background workers after server is up
    await startBackgroundWorkers();
    console.log('[Production] Background workers started');
  });

  // Handle server errors
  server.on('error', (error) => {
    logger.fatal({ error: error.message }, '[Production] Server error');
    process.exit(1);
  });
}

// Start the server
startProductionServer().catch((error) => {
  console.error('[Production] Failed to start:', error);
  process.exit(1);
});
