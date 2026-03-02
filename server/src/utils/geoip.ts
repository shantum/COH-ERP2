/**
 * GeoIP lookup using MaxMind GeoLite2-City database.
 *
 * Loads the .mmdb file once, then does in-memory lookups per IP.
 * Falls back gracefully if the database file is missing.
 */

import { resolve } from 'path';
import maxmind, { type CityResponse, type Reader } from 'maxmind';

let reader: Reader<CityResponse> | null = null;
let loadAttempted = false;

const DB_PATH = resolve(import.meta.dirname, '../../data/GeoLite2-City.mmdb');

async function getReader(): Promise<Reader<CityResponse> | null> {
    if (reader) return reader;
    if (loadAttempted) return null;
    loadAttempted = true;

    try {
        reader = await maxmind.open<CityResponse>(DB_PATH);
        console.log('[GeoIP] GeoLite2-City database loaded');
        return reader;
    } catch (err: unknown) {
        console.warn('[GeoIP] Failed to load GeoLite2-City database:', err instanceof Error ? err.message : err);
        return null;
    }
}

export interface GeoResult {
    country: string | undefined;
    region: string | undefined;
    city: string | undefined;
}

export async function lookupIp(ip: string | undefined): Promise<GeoResult> {
    if (!ip) return { country: undefined, region: undefined, city: undefined };

    // Strip IPv6-mapped IPv4 prefix
    const cleanIp = ip.startsWith('::ffff:') ? ip.slice(7) : ip;

    // Skip private/loopback IPs
    if (cleanIp === '127.0.0.1' || cleanIp === '::1' || cleanIp.startsWith('10.') || cleanIp.startsWith('192.168.')) {
        return { country: undefined, region: undefined, city: undefined };
    }

    const r = await getReader();
    if (!r) return { country: undefined, region: undefined, city: undefined };

    try {
        const result = r.get(cleanIp);
        if (!result) return { country: undefined, region: undefined, city: undefined };

        return {
            country: result.country?.names?.en ?? result.country?.iso_code ?? undefined,
            region: result.subdivisions?.[0]?.names?.en ?? undefined,
            city: result.city?.names?.en ?? undefined,
        };
    } catch {
        return { country: undefined, region: undefined, city: undefined };
    }
}
