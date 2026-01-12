// src/types/express.d.ts
import type { PrismaClient } from '@prisma/client';

/**
 * JWT payload structure for authenticated users
 */
export interface JwtPayload {
    id: string;
    email: string;
    role: string;
    roleId: string;
    tokenVersion: number;
}

declare global {
    namespace Express {
        interface Request {
            prisma: PrismaClient;
            user?: JwtPayload;
            userPermissions?: string[];
            validatedBody?: Record<string, unknown>;
            rawBody?: string;
        }
    }
}

export {};
