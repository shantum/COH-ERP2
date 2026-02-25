/**
 * API client for COH ERP server
 *
 * Handles auth token storage and HTTP requests to the Express server.
 */

import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';

const CONFIG_DIR = join(homedir(), '.coh');
const TOKEN_FILE = join(CONFIG_DIR, 'token');
const BASE_URL = process.env.COH_API_URL || 'http://127.0.0.1:3001';

function ensureConfigDir(): void {
  if (!existsSync(CONFIG_DIR)) {
    mkdirSync(CONFIG_DIR, { recursive: true });
  }
}

export function saveToken(token: string): void {
  ensureConfigDir();
  writeFileSync(TOKEN_FILE, token, 'utf-8');
}

export function loadToken(): string | null {
  try {
    return readFileSync(TOKEN_FILE, 'utf-8').trim();
  } catch {
    return null;
  }
}

export function clearToken(): void {
  try {
    writeFileSync(TOKEN_FILE, '', 'utf-8');
  } catch {
    // ignore
  }
}

export function getBaseUrl(): string {
  return BASE_URL;
}

interface ApiResponse<T = unknown> {
  ok: boolean;
  status: number;
  data: T;
}

export async function api<T = unknown>(
  path: string,
  options: { method?: string; body?: unknown; token?: string } = {}
): Promise<ApiResponse<T>> {
  const token = options.token || loadToken();
  if (!token) {
    console.error('Not logged in. Run: pnpm coh -- login');
    process.exit(1);
  }

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    'Authorization': `Bearer ${token}`,
  };

  let res: Response;
  try {
    res = await fetch(`${BASE_URL}${path}`, {
      method: options.method || 'GET',
      headers,
      ...(options.body ? { body: JSON.stringify(options.body) } : {}),
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`Connection failed: ${msg}`);
    console.error(`Is the server running at ${BASE_URL}?`);
    process.exit(1);
  }

  // Handle non-JSON responses gracefully
  const contentType = res.headers.get('content-type') || '';
  if (!contentType.includes('application/json')) {
    return {
      ok: res.ok,
      status: res.status,
      data: { error: `Non-JSON response (${res.status}): ${contentType}` } as T,
    };
  }

  const data = (await res.json()) as T;
  return { ok: res.ok, status: res.status, data };
}

/**
 * Login and extract the JWT from the Set-Cookie header.
 */
export async function login(
  email: string,
  password: string
): Promise<{ success: boolean; user?: { name: string; role: string }; error?: string }> {
  const res = await fetch(`${BASE_URL}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
    redirect: 'manual',
  });

  // Read body once
  const body = (await res.json()) as { user?: { name: string; role: string }; error?: string };

  if (!res.ok) {
    return { success: false, error: body.error || `HTTP ${res.status}` };
  }

  // Extract JWT from Set-Cookie header
  const setCookie = res.headers.get('set-cookie') || '';
  const tokenMatch = setCookie.match(/auth_token=([^;]+)/);

  if (!tokenMatch) {
    return { success: false, error: 'No auth token in response' };
  }

  saveToken(tokenMatch[1]);
  return { success: true, user: body.user };
}
