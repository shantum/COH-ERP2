/**
 * WATI WhatsApp OTP Service
 *
 * Sends OTP codes via WhatsApp using WATI's template message API.
 * OTPs are stored in-memory with expiry. No DB table needed for 5 users.
 */

import crypto from 'crypto';

const WATI_API_URL = process.env.WATI_API_URL;
const WATI_API_KEY = process.env.WATI_API_KEY;
const TEMPLATE_NAME = 'otp';
const OTP_EXPIRY_MS = 10 * 60 * 1000; // 10 minutes
const OTP_LENGTH = 4;

interface OtpEntry {
  code: string;
  expiresAt: number;
  attempts: number;
}

// In-memory OTP store keyed by phone number (e.g. "919XXXXXXXXX")
const otpStore = new Map<string, OtpEntry>();

function generateOtp(): string {
  // Cryptographically random 4-digit code
  const num = crypto.randomInt(1000, 9999);
  return num.toString();
}

export async function sendOtp(phone: string): Promise<{ success: boolean; error?: string }> {
  if (!WATI_API_URL || !WATI_API_KEY) {
    return { success: false, error: 'WATI not configured' };
  }

  const code = generateOtp();

  // Rate limit: don't allow more than 1 OTP per 30 seconds to same number
  const existing = otpStore.get(phone);
  if (existing && existing.expiresAt - OTP_EXPIRY_MS + 30_000 > Date.now()) {
    return { success: false, error: 'Please wait before requesting another OTP' };
  }

  try {
    const res = await fetch(
      `${WATI_API_URL}/api/v1/sendTemplateMessage?whatsappNumber=${phone}`,
      {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${WATI_API_KEY}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          template_name: TEMPLATE_NAME,
          broadcast_name: 'erp_otp_login',
          parameters: [{ name: '1', value: code }],
        }),
      }
    );

    const data = await res.json() as { result: boolean; info?: string };

    if (!data.result) {
      console.error('[WATI OTP] Send failed:', data);
      return { success: false, error: data.info || 'Failed to send OTP' };
    }

    // Store OTP
    otpStore.set(phone, {
      code,
      expiresAt: Date.now() + OTP_EXPIRY_MS,
      attempts: 0,
    });

    return { success: true };
  } catch (err) {
    console.error('[WATI OTP] Error:', err instanceof Error ? err.message : err);
    return { success: false, error: 'Failed to send OTP' };
  }
}

export function verifyOtp(phone: string, code: string): { valid: boolean; error?: string } {
  const entry = otpStore.get(phone);

  if (!entry) {
    return { valid: false, error: 'No OTP sent to this number. Please request a new one.' };
  }

  if (Date.now() > entry.expiresAt) {
    otpStore.delete(phone);
    return { valid: false, error: 'OTP expired. Please request a new one.' };
  }

  if (entry.attempts >= 5) {
    otpStore.delete(phone);
    return { valid: false, error: 'Too many attempts. Please request a new OTP.' };
  }

  entry.attempts++;

  if (entry.code !== code) {
    return { valid: false, error: 'Incorrect OTP' };
  }

  // Valid — clean up
  otpStore.delete(phone);
  return { valid: true };
}
