/**
 * Database Initialization for TanStack Start Server Functions
 *
 * Initializes the shared Kysely instance on first import.
 * Import this file in any Server Function that needs database access.
 */
'use server';

import { createKysely, getKysely } from '@coh/shared/database';

// Initialize Kysely singleton on server startup
// Uses DATABASE_URL from environment
createKysely(process.env.DATABASE_URL);

// Re-export for convenience
export { getKysely };
