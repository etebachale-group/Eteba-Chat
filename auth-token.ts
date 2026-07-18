import crypto from 'node:crypto';

/**
 * Signed session token module.
 *
 * Format: base64url(payload) + "." + base64url(HMAC-SHA256(base64url(payload), AUTH_SECRET))
 *
 * Replaces the previous unsigned base64url(JSON) tokens.
 * The signature prevents clients from forging or tampering with any field,
 * including tenantId and role.
 */

export interface SessionPayload {
  id: string;
  email: string;
  name: string;
  avatar_url: string | null;
  role: string;
  tenantId: string;
}

function getSecret(): string {
  const secret = process.env.AUTH_SECRET;
  if (!secret || secret.length < 32) {
    throw new Error(
      'AUTH_SECRET is missing or too short. Set a 64-char hex string in your environment.'
    );
  }
  return secret;
}

/** Create a signed token from a payload object. */
export function signToken(payload: SessionPayload): string {
  const secret = getSecret();
  const data = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const sig = crypto
    .createHmac('sha256', secret)
    .update(data)
    .digest('base64url');
  return `${data}.${sig}`;
}

/**
 * Verify and decode a signed token.
 * Returns the payload, or null if the signature is invalid or the token is malformed.
 */
export function verifyToken(token: string): SessionPayload | null {
  try {
    const secret = getSecret();
    const dotIdx = token.lastIndexOf('.');
    if (dotIdx === -1) return null;

    const data = token.slice(0, dotIdx);
    const sig = token.slice(dotIdx + 1);

    const expectedSig = crypto
      .createHmac('sha256', secret)
      .update(data)
      .digest('base64url');

    // Constant-time comparison to prevent timing attacks
    const sigBuf = Buffer.from(sig);
    const expectedBuf = Buffer.from(expectedSig);
    if (sigBuf.length !== expectedBuf.length) return null;
    if (!crypto.timingSafeEqual(sigBuf, expectedBuf)) return null;

    const payload = JSON.parse(Buffer.from(data, 'base64url').toString('utf8'));
    return payload as SessionPayload;
  } catch {
    return null;
  }
}

/**
 * Decode a legacy unsigned token (base64url JSON, no dot separator with signature).
 * Used for backward compatibility during the migration period.
 */
export function decodeLegacyToken(token: string): SessionPayload | null {
  // Legacy tokens have no dot with a signature — they are just base64url(JSON)
  // New signed tokens have exactly one dot separating data from signature
  try {
    // If it looks like a signed token (has a dot and sig portion), reject it here
    const parts = token.split('.');
    if (parts.length === 2 && parts[1].length === 43) {
      // Looks like a signed token — don't decode as legacy
      return null;
    }
    const payload = JSON.parse(Buffer.from(token, 'base64url').toString('utf8'));
    if (!payload?.id || !payload?.tenantId) return null;
    return payload as SessionPayload;
  } catch {
    return null;
  }
}
