/**
 * COH Pixel Buffer — Cloudflare Worker
 *
 * Sits between the Shopify pixel script and the COH server.
 * Normal operation: enriches events with geo data, forwards to origin.
 * Origin down: buffers in KV, drains on cron every minute.
 *
 * Geo data (country, region, city, lat, lon) comes from Cloudflare's
 * request.cf object — no MaxMind or external DB needed.
 */

interface Env {
	PIXEL_KV: KVNamespace;
	ORIGIN_URL: string;
	KV_TTL_SECONDS: string;
}

interface GeoData {
	country?: string;
	region?: string;
	city?: string;
	latitude?: string;
	longitude?: string;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Enrich each event in the batch with geo + client IP fields. */
function enrichPayload(body: string, geo: GeoData, clientIp: string): string {
	try {
		const parsed = JSON.parse(body);
		if (parsed.events && Array.isArray(parsed.events)) {
			for (const event of parsed.events) {
				if (geo.country) event.country = geo.country;
				if (geo.region) event.region = geo.region;
				if (geo.city) event.city = geo.city;
				if (geo.latitude) event.latitude = geo.latitude;
				if (geo.longitude) event.longitude = geo.longitude;
				if (clientIp) event.clientIp = clientIp;
			}
		}
		return JSON.stringify(parsed);
	} catch {
		return body;
	}
}

/** Forward enriched JSON to origin. Returns true if origin accepted it. */
async function forwardToOrigin(originUrl: string, body: string): Promise<boolean> {
	try {
		const resp = await fetch(originUrl, {
			method: 'POST',
			headers: {
				'Content-Type': 'application/json',
				'Origin': 'null',
			},
			body,
			signal: AbortSignal.timeout(5000),
		});
		return resp.status >= 200 && resp.status < 500;
	} catch {
		return false;
	}
}

function kvKey(): string {
	return `evt:${Date.now()}:${crypto.randomUUID()}`;
}

/** Extract geo from Cloudflare's request.cf object. */
function extractGeo(request: Request): GeoData {
	const cf = (request as any).cf as Record<string, any> | undefined;
	return {
		country: cf?.country as string || undefined,
		region: cf?.region as string || undefined,
		city: cf?.city as string || undefined,
		latitude: cf?.latitude as string || undefined,
		longitude: cf?.longitude as string || undefined,
	};
}

// ---------------------------------------------------------------------------
// Fetch handler
// ---------------------------------------------------------------------------

async function handleRequest(request: Request, env: Env): Promise<Response> {
	if (request.method === 'OPTIONS') {
		return new Response(null, { status: 204, headers: corsHeaders() });
	}

	if (request.method !== 'POST') {
		return new Response('Method not allowed', { status: 405, headers: corsHeaders() });
	}

	const rawBody = await request.text();
	if (!rawBody || rawBody.length > 100_000) {
		return new Response('Bad request', { status: 400, headers: corsHeaders() });
	}

	const geo = extractGeo(request);
	const clientIp = request.headers.get('CF-Connecting-IP') || '';
	const enrichedBody = enrichPayload(rawBody, geo, clientIp);

	// Try forwarding to origin
	const ok = await forwardToOrigin(env.ORIGIN_URL, enrichedBody);

	if (ok) {
		return new Response(null, { status: 204, headers: corsHeaders() });
	}

	// Origin down — buffer the enriched payload in KV
	const ttl = parseInt(env.KV_TTL_SECONDS || '86400', 10);
	await env.PIXEL_KV.put(kvKey(), enrichedBody, { expirationTtl: ttl });

	return new Response(null, { status: 202, headers: corsHeaders() });
}

// ---------------------------------------------------------------------------
// Cron handler — drain buffered events
// ---------------------------------------------------------------------------

async function handleScheduled(env: Env): Promise<void> {
	const batchSize = 50;
	let cursor: string | undefined;
	let forwarded = 0;
	let failed = 0;

	do {
		const list = await env.PIXEL_KV.list({ prefix: 'evt:', limit: batchSize, cursor });

		for (const key of list.keys) {
			const body = await env.PIXEL_KV.get(key.name);
			if (!body) {
				await env.PIXEL_KV.delete(key.name);
				continue;
			}

			// Payload already has geo baked in from when it was buffered
			const ok = await forwardToOrigin(env.ORIGIN_URL, body);
			if (ok) {
				await env.PIXEL_KV.delete(key.name);
				forwarded++;
			} else {
				failed++;
				break;
			}
		}

		cursor = list.list_complete ? undefined : list.cursor;
	} while (cursor && failed === 0);

	if (forwarded > 0 || failed > 0) {
		console.log(`[pixel-buffer] Drain: forwarded=${forwarded} failed=${failed}`);
	}
}

// ---------------------------------------------------------------------------
// CORS
// ---------------------------------------------------------------------------

function corsHeaders(): HeadersInit {
	return {
		'Access-Control-Allow-Origin': '*',
		'Access-Control-Allow-Methods': 'POST, OPTIONS',
		'Access-Control-Allow-Headers': 'Content-Type',
		'Access-Control-Max-Age': '86400',
	};
}

// ---------------------------------------------------------------------------
// Export
// ---------------------------------------------------------------------------

export default {
	async fetch(request: Request, env: Env): Promise<Response> {
		return handleRequest(request, env);
	},
	async scheduled(_event: ScheduledEvent, env: Env, _ctx: ExecutionContext): Promise<void> {
		await handleScheduled(env);
	},
};
