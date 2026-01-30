/**
 * Shared Services
 *
 * Barrel export for all shared services that can be used
 * by both Server Functions and Express routes.
 *
 * ⚠️  SERVER-ONLY CODE - BUNDLING CONSTRAINTS ⚠️
 *
 * This directory contains server-only code (kysely, pg, prisma).
 * It works because:
 * 1. @coh/shared is bundled (noExternal in vite.config.ts)
 * 2. kysely/pg/@prisma/client are externalized (ssr.external)
 * 3. All imports use dynamic import() so they resolve at runtime
 *
 * RULES:
 * - NEVER use static imports for kysely, pg, or @prisma/client
 * - ALWAYS use: const { X } = await import('package')
 * - Static imports WILL break client bundling
 *
 * If you need to refactor, see CLAUDE.md for architecture notes.
 */

export * from './bom/index.js';
export * from './dashboard/index.js';
export * from './db/index.js';
export * from './inventory/index.js';
export * from './orders/index.js';
