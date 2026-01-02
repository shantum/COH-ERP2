import crypto from 'crypto';

const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 16;
const TAG_LENGTH = 16;

/**
 * Get encryption key from JWT_SECRET
 * Uses SHA-256 to derive a consistent 32-byte key
 */
function getEncryptionKey() {
    const secret = process.env.JWT_SECRET;
    if (!secret) {
        throw new Error('JWT_SECRET is required for encryption');
    }
    return crypto.createHash('sha256').update(secret).digest();
}

/**
 * Encrypt a string value
 * @param {string} plaintext - The value to encrypt
 * @returns {string} - Base64 encoded encrypted value (IV + ciphertext + auth tag)
 */
export function encrypt(plaintext) {
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
 * @param {string} encryptedValue - Base64 encoded encrypted value
 * @returns {string} - Decrypted plaintext
 */
export function decrypt(encryptedValue) {
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
        // If decryption fails, the value might be stored in plaintext (legacy)
        // Return as-is for backward compatibility
        console.warn('Decryption failed, value may be stored in plaintext');
        return encryptedValue;
    }
}

/**
 * Check if a value appears to be encrypted (base64 encoded with correct length)
 * @param {string} value - The value to check
 * @returns {boolean}
 */
export function isEncrypted(value) {
    if (!value) return false;
    try {
        const decoded = Buffer.from(value, 'base64');
        // Encrypted values should be at least IV + auth tag length
        return decoded.length >= IV_LENGTH + TAG_LENGTH;
    } catch {
        return false;
    }
}
