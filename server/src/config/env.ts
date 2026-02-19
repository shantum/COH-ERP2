/**
 * Centralized Environment Variable Validation
 *
 * This module validates ALL environment variables at startup using Zod.
 * If validation fails, the application will fail fast with clear error messages.
 *
 * USAGE:
 * - Import `env` for type-safe access: `import { env } from './config/env.js'`
 * - New code should use `env.JWT_SECRET` instead of `process.env.JWT_SECRET`
 * - Existing code can continue using `process.env` (backwards compatible)
 *
 * TO ADD A NEW ENV VAR:
 * 1. Add it to the schema below with appropriate validation
 * 2. Add JSDoc comment explaining the variable
 * 3. Run TypeScript to ensure no type errors
 */

// Load dotenv FIRST - must happen before we access process.env
// This is necessary because ES module imports are hoisted
import dotenv from 'dotenv';
dotenv.config();

import { z } from 'zod';

// ============================================
// SCHEMA DEFINITION
// ============================================

const envSchema = z.object({
    // ----------------------------------------
    // REQUIRED - App will not start without these
    // ----------------------------------------

    /** Secret key for signing JWTs - must be a secure random string */
    JWT_SECRET: z.string().min(1, 'JWT_SECRET is required'),

    /** PostgreSQL connection string */
    DATABASE_URL: z.string().min(1, 'DATABASE_URL is required'),

    // ----------------------------------------
    // OPTIONAL - With sensible defaults
    // ----------------------------------------

    /** Environment mode */
    NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),

    /** Server port */
    PORT: z.coerce.number().default(3001),

    /** JWT token expiry duration */
    JWT_EXPIRY: z.string().default('7d'),

    /** CORS allowed origin (production only) */
    CORS_ORIGIN: z.string().optional(),

    // ----------------------------------------
    // FEATURE FLAGS
    // ----------------------------------------

    /** Enable admin force-ship functionality */
    ENABLE_ADMIN_SHIP: z.enum(['true', 'false']).default('true'),

    /** Disable background workers (useful when running locally with production) */
    DISABLE_BACKGROUND_WORKERS: z.enum(['true', 'false']).default('false'),

    // ----------------------------------------
    // SHOPIFY INTEGRATION
    // ----------------------------------------

    /** Shopify Admin API access token */
    SHOPIFY_ACCESS_TOKEN: z.string().optional(),

    /** Shopify shop domain (e.g., mystore.myshopify.com) */
    SHOPIFY_SHOP_DOMAIN: z.string().optional(),

    /** Shopify webhook secret for HMAC verification */
    SHOPIFY_WEBHOOK_SECRET: z.string().optional(),

    // ----------------------------------------
    // ITHINK LOGISTICS INTEGRATION
    // ----------------------------------------

    /** iThink API access token */
    ITHINK_ACCESS_TOKEN: z.string().optional(),

    /** iThink API secret key */
    ITHINK_SECRET_KEY: z.string().optional(),

    /** iThink pickup address ID */
    ITHINK_PICKUP_ADDRESS_ID: z.string().optional(),

    /** iThink return address ID */
    ITHINK_RETURN_ADDRESS_ID: z.string().optional(),

    /** Default logistics provider for iThink */
    ITHINK_DEFAULT_LOGISTICS: z.string().default('delhivery'),

    // ----------------------------------------
    // RETURN PRIME INTEGRATION
    // ----------------------------------------

    /** Return Prime API token for authentication */
    RETURNPRIME_API_TOKEN: z.string().optional(),

    /** Return Prime store ID */
    RETURNPRIME_STORE_ID: z.string().optional(),

    /** Return Prime webhook secret for HMAC verification */
    RETURNPRIME_WEBHOOK_SECRET: z.string().optional(),

    // ----------------------------------------
    // RESEND
    // ----------------------------------------

    /** Resend API key for sending emails */
    RESEND_API_KEY: z.string().optional(),

    /** Resend webhook signing secret for inbound email verification (from Resend dashboard, starts with whsec_) */
    RESEND_WEBHOOK_SECRET: z.string().optional(),

    // ----------------------------------------
    // AI / ANTHROPIC
    // ----------------------------------------

    /** Anthropic API key for invoice AI parsing (Claude Vision) */
    ANTHROPIC_API_KEY: z.string().optional(),

    // ----------------------------------------
    // VITE (passed through to client build)
    // ----------------------------------------

    /** API URL for client-side requests */
    VITE_API_URL: z.string().optional(),
});

// ============================================
// TYPE EXPORT
// ============================================

export type Env = z.infer<typeof envSchema>;

// ============================================
// PARSE AND VALIDATE
// ============================================

/**
 * Parsed and validated environment variables.
 *
 * This will throw a ZodError at startup if any required variables are missing
 * or if any variables fail validation. The error message will clearly indicate
 * which variables failed and why.
 */
function parseEnv(): Env {
    try {
        return envSchema.parse(process.env);
    } catch (error) {
        if (error instanceof z.ZodError) {
            const issues = error.issues.map(issue => {
                const path = issue.path.join('.');
                return `  - ${path}: ${issue.message}`;
            }).join('\n');

            console.error('Environment validation failed:\n' + issues);
            process.exit(1);
        }
        throw error;
    }
}

export const env = parseEnv();
