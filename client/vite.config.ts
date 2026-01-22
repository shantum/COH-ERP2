import { defineConfig } from 'vite'
import tsConfigPaths from 'vite-tsconfig-paths'
import { tanstackStart } from '@tanstack/react-start/plugin/vite'
import viteReact from '@vitejs/plugin-react'
import path from 'path'

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
    tsConfigPaths(),
    tanstackStart(),
    viteReact(),
  ],
  resolve: {
    alias: {
      // Map server imports for SSR build
      '@server': path.resolve(__dirname, '../server/src'),
    },
  },
  // SSR configuration: externalize Node.js-only packages
  // These packages should only run on the server, not be bundled for client
  ssr: {
    // Packages that should remain as external imports in SSR bundle
    // (not bundled, loaded from node_modules at runtime)
    external: [
      // Database
      'pg',
      'pg-pool',
      'pg-native',
      'kysely',
      '@prisma/client',
      'prisma',
      // Auth & crypto
      'bcryptjs',
      'jsonwebtoken',
      // Server frameworks
      'express',
      'cookie-parser',
      'cors',
      'multer',
      // HTTP clients
      'axios',
      'node-fetch',
      // Utilities
      'dotenv',
      'node-cron',
      'pino',
      'pino-pretty',
      'uuid',
      // Shopify
      '@shopify/shopify-api',
    ],
    // Don't externalize these - they need to be bundled for consistent module resolution
    noExternal: [
      '@tanstack/react-start',
      '@tanstack/react-router',
      '@coh/shared',
    ],
  },
  // Optimize deps - exclude Node.js packages from client pre-bundling
  optimizeDeps: {
    exclude: ['pg', 'pg-pool'],
  },
  // Build options for SSR
  build: {
    rollupOptions: {
      // Externalize server-only packages for SSR build
      // Use function to handle @server imports and server paths
      external: (id) => {
        // Server-only Node.js packages
        const serverPackages = [
          'bcryptjs', 'pg', 'pg-pool', 'pg-native', 'kysely',
          '@prisma/client', 'prisma', 'jsonwebtoken',
          'express', 'cookie-parser', 'cors', 'multer',
          'axios', 'node-fetch',
          'dotenv', 'node-cron', 'pino', 'pino-pretty', 'uuid',
          '@shopify/shopify-api',
        ];
        if (serverPackages.includes(id)) return true;
        // Node.js built-ins
        const builtins = ['crypto', 'fs', 'path', 'stream', 'zlib', 'http', 'https', 'net', 'tls', 'os', 'child_process'];
        if (builtins.includes(id)) return true;
        // Externalize @server/* imports (our server alias)
        if (id.startsWith('@server')) return true;
        // Externalize any server/src path imports
        if (id.includes('server/src')) return true;
        return false;
      },
    },
  },
})
