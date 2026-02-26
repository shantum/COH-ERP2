/**
 * Auth Core — Re-exports from @coh/shared/services/auth
 *
 * The single source of truth for auth logic is now in the shared package.
 * This file re-exports everything for backward compatibility with Express routes.
 */

export {
    // Types
    type AuthenticatedUser,
    type AuthUser,
    type AuthContext,
    type OptionalAuthContext,
    type AuthResult,
    type JwtPayload,

    // Schemas
    JwtPayloadSchema,

    // Core validation
    verifyToken,
    validateTokenVersion,
    getUserPermissionsAndAccess,
    validateAuth,

    // Permission helpers
    hasPermission,
    hasAdminAccess,
} from '@coh/shared/services/auth';
