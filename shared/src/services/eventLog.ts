/**
 * Domain Event Logger
 *
 * Fire-and-forget event logging for business activity stream.
 * Never throws — logging must never break business logic.
 *
 * Uses dynamic getPrisma() import per shared service convention.
 */

import type { Prisma } from '@prisma/client';

export interface DomainEventInput {
  domain: string;
  event: string;
  entityType: string;
  entityId: string;
  summary: string;
  meta?: Prisma.InputJsonValue;
  actorId?: string;
}

/** Row returned by read queries */
export interface DomainEventRow {
  id: string;
  domain: string;
  event: string;
  entityType: string;
  entityId: string;
  summary: string;
  meta: Prisma.JsonValue;
  actorId: string | null;
  createdAt: Date;
}

/**
 * Log a domain event (fire-and-forget).
 * Catches all errors silently — logging must never break callers.
 */
export async function logEvent(input: DomainEventInput): Promise<void> {
  try {
    const { getPrisma } = await import('./db/index.js');
    const prisma = await getPrisma();
    await prisma.domainEvent.create({
      data: {
        domain: input.domain,
        event: input.event,
        entityType: input.entityType,
        entityId: input.entityId,
        summary: input.summary,
        ...(input.meta !== undefined ? { meta: input.meta } : {}),
        ...(input.actorId ? { actorId: input.actorId } : {}),
      },
    });
  } catch (error: unknown) {
    console.error('[EventLog] Failed to log event:', input.event, error instanceof Error ? error.message : error);
  }
}

/**
 * Log a domain event on next tick (non-blocking for hot paths).
 */
export function logEventDeferred(input: DomainEventInput): void {
  setImmediate(() => { logEvent(input); });
}

/**
 * Get recent events for activity feed.
 */
export async function getRecentEvents(
  limit = 50,
  domain?: string
): Promise<DomainEventRow[]> {
  const { getPrisma } = await import('./db/index.js');
  const prisma = await getPrisma();
  return prisma.domainEvent.findMany({
    ...(domain ? { where: { domain } } : {}),
    orderBy: { createdAt: 'desc' },
    take: limit,
  });
}

/**
 * Get all events for a specific entity (audit timeline).
 */
export async function getEntityTimeline(
  entityType: string,
  entityId: string
): Promise<DomainEventRow[]> {
  const { getPrisma } = await import('./db/index.js');
  const prisma = await getPrisma();
  return prisma.domainEvent.findMany({
    where: { entityType, entityId },
    orderBy: { createdAt: 'asc' },
  });
}
