import crypto from 'node:crypto';
import { config } from '../../config.js';

/**
 * SHA-256(token), hex. Used to look up bearer/refresh/auth-code values without
 * storing plaintext.
 */
export function sha256(value: string): string {
  return crypto.createHash('sha256').update(value).digest('hex');
}

/** 32 random bytes, base64url-encoded. ~43 chars, URL-safe. */
export function randomToken(bytes = 32): string {
  return crypto.randomBytes(bytes).toString('base64url');
}

/**
 * Timing-safe string compare. Returns false on length mismatch (Buffer.compare
 * throws otherwise) and never short-circuits the byte comparison.
 */
export function timingSafeEqualStr(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ab.length !== bb.length) return false;
  return crypto.timingSafeEqual(ab, bb);
}

/**
 * HMAC key for consent_id signing. Derived once from API_KEY so it survives
 * process restart but isn't the API_KEY itself. (HKDF info string namespaces
 * the derivation away from other places where API_KEY is used as a seed.)
 */
let cachedCidKey: Buffer | null = null;
function cidKey(): Buffer {
  if (cachedCidKey) return cachedCidKey;
  cachedCidKey = Buffer.from(
    crypto.hkdfSync('sha256', config.apiKey, '', 'mcp-oauth-consent-cid', 32) as ArrayBuffer,
  );
  return cachedCidKey;
}

/** Signs a cid as `cid.sig`. sig is base64url HMAC-SHA256(cid). */
export function signCid(cid: string): string {
  const sig = crypto.createHmac('sha256', cidKey()).update(cid).digest('base64url');
  return `${cid}.${sig}`;
}

/**
 * Verifies a signed cid and returns the raw cid if valid, null otherwise.
 * Constant-time compare on the signature.
 */
export function verifyCid(signed: string): string | null {
  const idx = signed.lastIndexOf('.');
  if (idx <= 0 || idx === signed.length - 1) return null;
  const cid = signed.slice(0, idx);
  const sig = signed.slice(idx + 1);
  const expected = crypto.createHmac('sha256', cidKey()).update(cid).digest('base64url');
  if (!timingSafeEqualStr(sig, expected)) return null;
  return cid;
}
