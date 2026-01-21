/**
 * SPA Fallback Configuration
 *
 * Emergency fallback to pure SPA mode if TanStack Start has issues.
 * Usage: npm run dev:spa
 * Production: npm run build (uses this config)
 *
 * Note: This config excludes SSR-specific code (@tanstack/react-start)
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
      // Don't mark SSR modules as external - let aliases stub them
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
