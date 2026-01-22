/**
 * SPA Fallback Configuration (EMERGENCY USE ONLY)
 *
 * This config is a fallback if TanStack Start SSR has issues.
 * DO NOT use for production - SSR mode is the primary build.
 *
 * Usage:
 *   Development: npm run dev:spa
 *   Production:  npm run build:spa (fallback only)
 *
 * Note: This config stubs out Server Functions - they won't work in SPA mode.
 * All data fetching falls back to tRPC when using this config.
 */
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tsConfigPaths from 'vite-tsconfig-paths'
import path from 'path'

export default defineConfig({
  plugins: [
    tsConfigPaths(),
    react(),
  ],
  resolve: {
    // Dedupe shared dependencies to avoid multiple instances
    dedupe: ['zod', 'react', 'react-dom'],
    // Use array format for aliases - order matters! More specific paths first
    alias: [
      // Ensure @coh/shared resolves to the built dist folder
      { find: '@coh/shared', replacement: path.resolve(__dirname, '../shared/dist') },
      // Stub out TanStack Start imports for SPA mode (more specific paths FIRST)
      { find: '@tanstack/react-start/server-entry', replacement: path.resolve(__dirname, 'src/stubs/react-start.ts') },
      { find: '@tanstack/react-start/server', replacement: path.resolve(__dirname, 'src/stubs/react-start-server.ts') },
      { find: '@tanstack/react-start/client', replacement: path.resolve(__dirname, 'src/stubs/react-start.ts') },
      { find: '@tanstack/react-start', replacement: path.resolve(__dirname, 'src/stubs/react-start.ts') },
      // Stub out vinxi imports
      { find: 'vinxi/runtime/http', replacement: path.resolve(__dirname, 'src/stubs/vinxi.ts') },
      { find: 'vinxi/http', replacement: path.resolve(__dirname, 'src/stubs/vinxi.ts') },
      { find: 'vinxi', replacement: path.resolve(__dirname, 'src/stubs/vinxi.ts') },
    ],
  },
  optimizeDeps: {
    // Include shared package dependencies for pre-bundling
    include: ['zod'],
    // Exclude SSR packages from optimization
    exclude: ['@tanstack/react-start', '@tanstack/start-storage-context'],
  },
  build: {
    // Ensure proper source maps and chunk splitting
    sourcemap: true,
    rollupOptions: {
      // Externalize server-only Node.js packages that can't be bundled for browser
      external: [
        'bcryptjs',
        'pg',
        'pg-pool',
        'pg-native',
        '@prisma/client',
        'prisma',
        'kysely',
        'dotenv',
        'jsonwebtoken',
        'express',
        'cookie-parser',
        'cors',
        'multer',
        'node-cron',
        // Externalize anything from server directory
        /^\.\.\/server\//,
        /server\/src\//,
      ],
      output: {
        manualChunks: {
          vendor: ['react', 'react-dom'],
          router: ['@tanstack/react-router', '@tanstack/react-query'],
        },
      },
    },
  },
  server: {
    port: 5173,
    proxy: {
      '/api': { target: 'http://127.0.0.1:3001', changeOrigin: true },
      '/trpc': { target: 'http://127.0.0.1:3001', changeOrigin: true },
    },
  },
})
