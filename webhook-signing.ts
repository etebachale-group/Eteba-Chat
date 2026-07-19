import crypto from 'crypto';

/**
 * Generates a secure, random 32-byte hex string signing secret.
 */
export function generateSigningSecret(): string {
  return crypto.randomBytes(32).toString('hex');
}

/**
 * Signs a payload string with HMAC-SHA256 using the signing secret and timestamp.
 * Returns the signature in the format: sha256=<hex_digest>
 */
export function signPayload(payloadJson: string, secret: string, timestamp: number): string {
  const dataToSign = `${timestamp}.${payloadJson}`;
  const hmac = crypto.createHmac('sha256', secret);
  hmac.update(dataToSign);
  const digest = hmac.digest('hex');
  return `sha256=${digest}`;
}
