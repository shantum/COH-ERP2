/**
 * Kysely Factory
 *
 * Creates and manages a singleton Kysely instance for database access.
 * Shared between Express server and TanStack Start Server Functions.
 */
import { Kysely, PostgresDialect } from 'kysely';
import pg from 'pg';
let kyselyInstance = null;
/**
 * Create or return the singleton Kysely instance
 *
 * @param connectionString - Optional database connection string (defaults to DATABASE_URL env var)
 * @returns Kysely instance configured for PostgreSQL
 */
export function createKysely(connectionString) {
    if (kyselyInstance)
        return kyselyInstance;
    const pool = new pg.Pool({
        connectionString: connectionString || process.env.DATABASE_URL,
        max: 10,
    });
    kyselyInstance = new Kysely({
        dialect: new PostgresDialect({ pool }),
    });
    return kyselyInstance;
}
/**
 * Get the existing Kysely instance
 *
 * @throws Error if createKysely() hasn't been called yet
 * @returns The singleton Kysely instance
 */
export function getKysely() {
    if (!kyselyInstance) {
        throw new Error('Kysely not initialized. Call createKysely() first.');
    }
    return kyselyInstance;
}
//# sourceMappingURL=createKysely.js.map