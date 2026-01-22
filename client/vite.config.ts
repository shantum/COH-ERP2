import { defineConfig, type Plugin } from 'vite'
import tsConfigPaths from 'vite-tsconfig-paths'
import { tanstackStart } from '@tanstack/react-start/plugin/vite'
import viteReact from '@vitejs/plugin-react'
import path from 'path'
import { fileURLToPath } from 'url'

// ES Module equivalent of __dirname
const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

// Server-ONLY packages that should never be bundled (Node.js runtime only)
const SERVER_PACKAGES = [
  'bcryptjs', 'pg', 'pg-pool', 'pg-native', 'kysely',
  '@prisma/client', 'prisma', 'jsonwebtoken',
  'express', 'cookie-parser', 'cors', 'multer',
  // Note: axios is NOT here - it's used in client-side api.ts
  'node-fetch',
  'dotenv', 'node-cron', 'pino', 'pino-pretty', 'uuid',
  '@shopify/shopify-api',
];

// Node.js built-in modules
const NODE_BUILTINS = [
  'crypto', 'fs', 'path', 'stream', 'zlib', 'http', 'https',
  'net', 'tls', 'os', 'child_process', 'url', 'util', 'events',
  'buffer', 'querystring', 'string_decoder', 'assert',
];

// Resolve @server to absolute path for runtime resolution
const SERVER_SRC_PATH = path.resolve(__dirname, '../server/src');

/**
 * Custom plugin to externalize @server imports BEFORE alias resolution.
 * This prevents Vite from trying to bundle server-side code during SSR build.
 *
 * The plugin resolves @server/foo to an absolute path (for runtime) but marks
 * it as external (so Rollup doesn't try to bundle it).
 */
function externalizeServerImports(): Plugin {
  return {
    name: 'externalize-server-imports',
    enforce: 'pre', // Run before other plugins
    resolveId(source, importer, options) {
      // Only apply during SSR build
      if (!options?.ssr) return null;

      // Handle @server/* imports
      if (source.startsWith('@server/')) {
        // Resolve to absolute path for Node.js runtime
        const relativePath = source.replace('@server/', '');
        const absolutePath = path.join(SERVER_SRC_PATH, relativePath);
        // Mark as external - Node.js will resolve at runtime
        return { id: absolutePath, external: true };
      }
      if (source === '@server') {
        return { id: SERVER_SRC_PATH, external: true };
      }
      return null;
    },
  };
}

export default defineConfig({
  server: {
    port: 5173,
    proxy: {
      '/api': {
        target: 'http://127.0.0.1:3001',
        changeOrigin: true,
      },
      '/trpc': {
        target: 'http://127.0.0.1:3001',
        changeOrigin: true,
      },
    },
  },
  plugins: [
    externalizeServerImports(), // Must be first to intercept @server imports
    tsConfigPaths(),
    tanstackStart(),
    viteReact(),
  ],
  // Note: @server alias NOT defined here - we handle it in the plugin above
  // SSR configuration: externalize Node.js-only packages
  ssr: {
    external: [
      ...SERVER_PACKAGES,
      ...NODE_BUILTINS,
      // Node built-ins with node: prefix
      ...NODE_BUILTINS.map(m => `node:${m}`),
    ],
    noExternal: [
      '@tanstack/react-start',
      '@tanstack/react-router',
      '@coh/shared',
    ],
  },
  optimizeDeps: {
    exclude: ['pg', 'pg-pool'],
  },
  build: {
    rollupOptions: {
      external: (id, parentId, isResolved) => {
        // Server packages
        if (SERVER_PACKAGES.includes(id)) return true;
        // Node.js built-ins (including node: prefix)
        if (NODE_BUILTINS.includes(id) || NODE_BUILTINS.includes(id.replace('node:', ''))) return true;
        // @server/* imports (backup - plugin should catch these first)
        if (id.startsWith('@server')) return true;
        // Resolved server paths (absolute or relative)
        if (id.includes('server/src') || id.includes('server\\src')) return true;
        // Already resolved absolute path to server directory
        if (isResolved && id.includes(SERVER_SRC_PATH.replace(/\\/g, '/'))) return true;
        return false;
      },
    },
  },
})
