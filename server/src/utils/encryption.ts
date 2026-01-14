import crypto from 'crypto';

const ALGORITHM = 'aes-256-gcm' as const;
const IV_LENGTH = 16;
const TAG_LENGTH = 16;

/**
 * Get encryption key from JWT_SECRET
 * Uses SHA-256 to derive a consistent 32-byte key
 */
function getEncryptionKey(): Buffer {
    const secret = process.env.JWT_SECRET;
    if (!secret) {
        throw new Error('JWT_SECRET is required for encryption');
    }
    return crypto.createHash('sha256').update(secret).digest();
}

/**
 * Encrypt a string value
 * @param plaintext - The value to encrypt
 * @returns Base64 encoded encrypted value (IV + ciphertext + auth tag), or null if no input
 */
export function encrypt(plaintext: string | null | undefined): string | null {
    if (!plaintext) return null;

    const key = getEncryptionKey();
    const iv = crypto.randomBytes(IV_LENGTH);
    const cipher = crypto.createCipheriv(ALGORITHM, key, iv);

    let encrypted = cipher.update(plaintext, 'utf8', 'hex');
    encrypted += cipher.final('hex');
    const authTag = cipher.getAuthTag();

    // Combine IV + encrypted data + auth tag
    const combined = Buffer.concat([
        iv,
        Buffer.from(encrypted, 'hex'),
        authTag
    ]);

    return combined.toString('base64');
}

/**
 * Decrypt a string value
 * @param encryptedValue - Base64 encoded encrypted value
 * @returns Decrypted plaintext, or null if no input
 */
export function decrypt(encryptedValue: string | null | undefined): string | null {
    if (!encryptedValue) return null;

    try {
        const key = getEncryptionKey();
        const combined = Buffer.from(encryptedValue, 'base64');

        // Extract IV, encrypted data, and auth tag
        const iv = combined.subarray(0, IV_LENGTH);
        const authTag = combined.subarray(combined.length - TAG_LENGTH);
        const encrypted = combined.subarray(IV_LENGTH, combined.length - TAG_LENGTH);

        const decipher = crypto.createDecipheriv(ALGORITHM, key, iv);
        decipher.setAuthTag(authTag);

        let decrypted = decipher.update(encrypted);
        decrypted = Buffer.concat([decrypted, decipher.final()]);

        return decrypted.toString('utf8');
    } catch (error) {
        // Check if this looks like encrypted data that failed to decrypt
        // vs plaintext legacy data that was never encrypted
        if (isEncrypted(encryptedValue)) {
            // This appears to be encrypted data that failed to decrypt
            // Could be corrupted or wrong key - don't return potentially corrupted data
            console.error('[Encryption] Decryption FAILED - this usually means JWT_SECRET has changed since the value was encrypted.');
            console.error('[Encryption] Stored value preview:', encryptedValue.substring(0, 20) + '...');
            console.error('[Encryption] To fix: re-enter and save the Shopify access token in Settings.');
            throw new Error('Failed to decrypt stored value - JWT_SECRET may have changed');
        }
        // Not encrypted format - return as plaintext (legacy compatibility)
        console.warn('[Encryption] Value stored in plaintext format (legacy) - will work but consider re-saving');
        return encryptedValue;
    }
}

/**
 * Check if a value appears to be encrypted (base64 encoded with correct length)
 * @param value - The value to check
 * @returns true if the value appears to be encrypted
 */
export function isEncrypted(value: string | null | undefined): boolean {
    if (!value) return false;
    try {
        const decoded = Buffer.from(value, 'base64');
        // Encrypted values should be at least IV + auth tag length
        return decoded.length >= IV_LENGTH + TAG_LENGTH;
    } catch {
        return false;
    }
}
