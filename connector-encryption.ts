import crypto from 'node:crypto';

// ============================================================
// Connector Token Encryption Module
// AES-256-GCM encryption for connector tokens at rest
// ============================================================

export interface EncryptedToken {
  encrypted: string;  // Base64 ciphertext
  iv: string;         // Base64 initialization vector (12 bytes)
  tag: string;        // Base64 auth tag (16 bytes)
}

// --- Key validation and loading ---

const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 12;   // GCM recommended IV size
const TAG_LENGTH = 16;  // GCM auth tag size

function loadEncryptionKey(): Buffer {
  const keyHex = process.env.CONNECTOR_ENCRYPTION_KEY;

  if (!keyHex) {
    throw new Error(
      'CONNECTOR_ENCRYPTION_KEY is not set. ' +
      'Server cannot start without a valid encryption key for connector tokens. ' +
      'Set a 64-character hex string (32 bytes) in your environment.'
    );
  }

  if (!/^[0-9a-fA-F]{64}$/.test(keyHex)) {
    throw new Error(
      'CONNECTOR_ENCRYPTION_KEY must be exactly 64 hex characters (32 bytes). ' +
      `Got ${keyHex.length} characters. Generate one with: node -e "console.log(require(\'crypto\').randomBytes(32).toString(\'hex\'))"`
    );
  }

  return Buffer.from(keyHex, 'hex');
}

// Fail-fast: validate key on module load
let encryptionKey: Buffer;
try {
  encryptionKey = loadEncryptionKey();
} catch (error) {
  // Re-throw to prevent server startup
  throw error;
}

// --- Public API ---

/**
 * Encrypts a plaintext token using AES-256-GCM.
 * Generates a random 12-byte IV for each encryption.
 */
export function encryptToken(plaintext: string): EncryptedToken {
  const iv = crypto.randomBytes(IV_LENGTH);
  const cipher = crypto.createCipheriv(ALGORITHM, encryptionKey, iv);

  let encrypted = cipher.update(plaintext, 'utf8', 'base64');
  encrypted += cipher.final('base64');

  const tag = cipher.getAuthTag();

  return {
    encrypted,
    iv: iv.toString('base64'),
    tag: tag.toString('base64'),
  };
}

/**
 * Decrypts an encrypted token using AES-256-GCM.
 * Verifies the auth tag for integrity.
 */
export function decryptToken(encryptedToken: EncryptedToken): string {
  const iv = Buffer.from(encryptedToken.iv, 'base64');
  const tag = Buffer.from(encryptedToken.tag, 'base64');

  const decipher = crypto.createDecipheriv(ALGORITHM, encryptionKey, iv);
  decipher.setAuthTag(tag);

  let decrypted = decipher.update(encryptedToken.encrypted, 'base64', 'utf8');
  decrypted += decipher.final('utf8');

  return decrypted;
}

/**
 * Generates a cryptographically secure 64-character hex token.
 * Uses crypto.randomBytes(32) for 256 bits of entropy.
 */
export function generateToken(): string {
  return crypto.randomBytes(32).toString('hex');
}

/**
 * Masks a token for display, showing only the last 4 characters.
 * Returns "****" + last 4 chars.
 */
export function maskToken(token: string): string {
  if (token.length <= 4) {
    return '****' + token;
  }
  return '****' + token.slice(-4);
}
