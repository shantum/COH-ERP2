/**
 * COH Pixel Buffer — Cloudflare Worker
 *
 * Sits between the Shopify pixel script and the COH server.
 * Normal operation: enriches events with geo + network data, forwards to origin.
 * Origin down: buffers in KV, drains on cron every minute.
 *
 * Data from Cloudflare's request.cf object:
 *   Geo: country, region, city, latitude, longitude, postalCode, continent, regionCode
 *   Network: asn, asOrganization
 *   Time: timezone
 *
 * VPN detection: compares browser-reported timezone (from pixel payload)
 * against CF's timezone. A mismatch flags isVpn = true.
 */

interface Env {
	PIXEL_KV: KVNamespace;
	ORIGIN_URL: string;
	KV_TTL_SECONDS: string;
}

interface CfData {
	// Geo
	country?: string;
	region?: string;
	city?: string;
	latitude?: string;
	longitude?: string;
	timezone?: string;
	postalCode?: string;
	continent?: string;
	regionCode?: string;
	// Network
	asOrganization?: string;
	asn?: number;
	// Connection
	httpProtocol?: string;
	tlsVersion?: string;
}

// ---------------------------------------------------------------------------
// Known VPN/proxy ASNs (major commercial VPN providers)
// ---------------------------------------------------------------------------

const VPN_ASNS = new Set([
	9009,   // M247 (NordVPN, Surfshark, etc.)
	20473,  // Choopa/Vultr (many VPN providers)
	60068,  // Datacamp (CDN77 VPN infra)
	212238, // Datacamp
	396982, // Google Cloud (tunneling services)
	14618,  // Amazon AWS (VPN endpoints)
	16509,  // Amazon AWS
	13335,  // Cloudflare WARP
	8100,   // QuadraNet (PIA, etc.)
	46562,  // Performive (VPN hosting)
	174,    // Cogent (hosting, often VPN)
	206264, // Amarutu Technology (VPN hosting)
]);

// ---------------------------------------------------------------------------
// User-Agent parsing (lightweight — no library needed)
// ---------------------------------------------------------------------------

function parseBrowser(ua: string): string | undefined {
	if (!ua) return undefined;
	if (/CriOS/i.test(ua)) return 'Chrome iOS';
	if (/FxiOS/i.test(ua)) return 'Firefox iOS';
	if (/EdgiOS|EdgA|Edg\//i.test(ua)) return 'Edge';
	if (/SamsungBrowser/i.test(ua)) return 'Samsung Internet';
	if (/OPR|Opera/i.test(ua)) return 'Opera';
	if (/Chrome/i.test(ua) && !/Chromium/i.test(ua)) return 'Chrome';
	if (/Safari/i.test(ua) && !/Chrome/i.test(ua)) return 'Safari';
	if (/Firefox/i.test(ua)) return 'Firefox';
	return 'Other';
}

function parseOs(ua: string): string | undefined {
	if (!ua) return undefined;
	if (/iPhone|iPad|iPod/i.test(ua)) return 'iOS';
	if (/Mac OS X/i.test(ua)) return 'macOS';
	if (/Android/i.test(ua)) return 'Android';
	if (/Windows/i.test(ua)) return 'Windows';
	if (/Linux/i.test(ua)) return 'Linux';
	if (/CrOS/i.test(ua)) return 'Chrome OS';
	return 'Other';
}

// ---------------------------------------------------------------------------
// VPN detection
// ---------------------------------------------------------------------------

/** Compare browser timezone vs CF timezone. Mismatch → likely VPN. */
function detectVpn(browserTz: string | undefined, cfTz: string | undefined, asn: number | undefined): boolean {
	// Check known VPN ASNs first
	if (asn && VPN_ASNS.has(asn)) return true;

	// Timezone mismatch check
	if (!browserTz || !cfTz) return false;
	return browserTz !== cfTz;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Extract CF data from request.cf object. */
function extractCfData(request: Request): CfData {
	const cf = (request as any).cf as Record<string, any> | undefined;
	return {
		country: cf?.country as string || undefined,
		region: cf?.region as string || undefined,
		city: cf?.city as string || undefined,
		latitude: cf?.latitude as string || undefined,
		longitude: cf?.longitude as string || undefined,
		timezone: cf?.timezone as string || undefined,
		postalCode: cf?.postalCode as string || undefined,
		asOrganization: cf?.asOrganization as string || undefined,
		asn: typeof cf?.asn === 'number' ? cf.asn : undefined,
		continent: cf?.continent as string || undefined,
		regionCode: cf?.regionCode as string || undefined,
		httpProtocol: cf?.httpProtocol as string || undefined,
		tlsVersion: cf?.tlsVersion as string || undefined,
	};
}

/** Enrich each event in the batch with geo, network, and VPN detection fields. */
function enrichPayload(body: string, cfData: CfData, clientIp: string): string {
	try {
		const parsed = JSON.parse(body);
		if (parsed.events && Array.isArray(parsed.events)) {
			for (const event of parsed.events) {
				// Geo
				if (cfData.country) event.country = cfData.country;
				if (cfData.region) event.region = cfData.region;
				if (cfData.city) event.city = cfData.city;
				if (cfData.latitude) event.latitude = cfData.latitude;
				if (cfData.longitude) event.longitude = cfData.longitude;
				if (cfData.postalCode) event.postalCode = cfData.postalCode;
				if (cfData.continent) event.continent = cfData.continent;
				if (cfData.regionCode) event.regionCode = cfData.regionCode;
				// Network
				if (cfData.timezone) event.cfTimezone = cfData.timezone;
				if (cfData.asOrganization) event.asOrganization = cfData.asOrganization;
				if (cfData.asn) event.asn = cfData.asn;
				if (cfData.httpProtocol) event.httpProtocol = cfData.httpProtocol;
				if (cfData.tlsVersion) event.tlsVersion = cfData.tlsVersion;
				if (clientIp) event.clientIp = clientIp;
				// Browser + OS parsed from userAgent
				if (event.userAgent) {
					event.browser = parseBrowser(event.userAgent);
					event.os = parseOs(event.userAgent);
				}
				// VPN detection
				const browserTz = event.browserTimezone;
				event.isVpn = detectVpn(browserTz, cfData.timezone, cfData.asn);
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

	const cfData = extractCfData(request);
	const clientIp = request.headers.get('CF-Connecting-IP') || '';
	const enrichedBody = enrichPayload(rawBody, cfData, clientIp);

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
