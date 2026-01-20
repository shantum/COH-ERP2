/**
 * SPA Fallback Configuration
 *
 * Emergency fallback to pure SPA mode if TanStack Start has issues.
 * Usage: npm run dev:spa
 */
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tsConfigPaths from 'vite-tsconfig-paths'

export default defineConfig({
  plugins: [
    tsConfigPaths(),
    react(),
  ],
  server: {
    port: 5173,
    proxy: {
      '/api': { target: 'http://127.0.0.1:3001', changeOrigin: true },
      '/trpc': { target: 'http://127.0.0.1:3001', changeOrigin: true },
    },
  },
})
