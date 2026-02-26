/**
 * SSE Broadcast via Postgres NOTIFY
 *
 * Replaces HTTP fetch calls to /api/internal/sse-broadcast with
 * Postgres pg_notify('coh_erp_events', json) — no HTTP hop needed.
 *
 * DYNAMIC IMPORTS ONLY — static imports of kysely break client bundling.
 */

export interface SSEEvent {
  type: string;
  lineId?: string;
  orderId?: string;
  view?: string;
  affectedViews?: string[];
  changes?: Record<string, unknown>;
  skuId?: string;
  lineIds?: string[];
  rowData?: Record<string, unknown>;
  rowsData?: Array<Record<string, unknown>>;
}

/**
 * Broadcast an SSE event to all connected clients via Postgres NOTIFY.
 * Fire-and-forget: errors are logged as warnings, never thrown.
 *
 * Accepts any object with at least a `type` string — callers can pass
 * domain-specific interfaces without needing an index signature.
 */
export async function notifySSE(
  event: { type: string } & Partial<SSEEvent>,
  excludeUserId?: string | null,
): Promise<void> {
  try {
    const { getKysely } = await import('@coh/shared/services/db');
    const { sql } = await import('kysely');

    const db = await getKysely();
    const payload = JSON.stringify({
      event,
      excludeUserId: excludeUserId ?? null,
    });

    await sql`SELECT pg_notify('coh_erp_events', ${payload})`.execute(db);
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    console.warn(`[sseBroadcast] Failed to notify: ${message}`);
  }
}
