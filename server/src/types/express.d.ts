// src/types/express.d.ts
import type { PrismaClient } from '@prisma/client';
import type { AuthenticatedUser } from '../utils/authCore.js';

/**
 * @deprecated Use AuthenticatedUser from utils/authCore.js
 * Kept for backward compatibility
 */
export interface JwtPayload {
    id: string;
    email: string;
    role: string;
    roleId: string;
    tokenVersion?: number;
}

declare global {
    namespace Express {
        interface Request {
            prisma: PrismaClient;
            user?: AuthenticatedUser;
            userPermissions?: string[];
            validatedBody?: Record<string, unknown>;
            rawBody?: string;
        }
    }
}

export {};
