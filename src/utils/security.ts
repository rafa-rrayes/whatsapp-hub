import crypto from 'crypto';
import { URL } from 'url';
import dns from 'dns/promises';
import net from 'net';

/**
 * Timing-safe comparison for API keys.
 * Returns true if both strings are equal without leaking timing information.
 */
export function timingSafeEqual(a: string, b: string): boolean {
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  if (bufA.length !== bufB.length) {
    // Compare against self to maintain constant time
    crypto.timingSafeEqual(bufA, bufA);
    return false;
  }
  return crypto.timingSafeEqual(bufA, bufB);
}

// RFC 1918, loopback, link-local, cloud metadata, and other reserved ranges
const BLOCKED_IP_RANGES = [
  { start: '10.0.0.0', end: '10.255.255.255' },       // RFC 1918
  { start: '172.16.0.0', end: '172.31.255.255' },      // RFC 1918
  { start: '192.168.0.0', end: '192.168.255.255' },    // RFC 1918
  { start: '127.0.0.0', end: '127.255.255.255' },      // Loopback
  { start: '169.254.0.0', end: '169.254.255.255' },    // Link-local / cloud metadata
  { start: '0.0.0.0', end: '0.255.255.255' },          // Current network
  { start: '100.64.0.0', end: '100.127.255.255' },     // Shared address space
  { start: '198.18.0.0', end: '198.19.255.255' },      // Benchmark testing
  { start: '224.0.0.0', end: '239.255.255.255' },      // Multicast
  { start: '240.0.0.0', end: '255.255.255.255' },      // Reserved
];

function ipToLong(ip: string): number {
  const parts = ip.split('.').map(Number);
  return ((parts[0] << 24) | (parts[1] << 16) | (parts[2] << 8) | parts[3]) >>> 0;
}

function isPrivateIP(ip: string): boolean {
  // Handle IPv6 loopback
  if (ip === '::1' || ip === '::' || ip.startsWith('fc') || ip.startsWith('fd') || ip.startsWith('fe80')) {
    return true;
  }

  // Handle IPv4-mapped IPv6
  if (ip.startsWith('::ffff:')) {
    ip = ip.slice(7);
  }

  if (!net.isIPv4(ip)) return true; // Block unknown formats

  const ipLong = ipToLong(ip);
  for (const range of BLOCKED_IP_RANGES) {
    if (ipLong >= ipToLong(range.start) && ipLong <= ipToLong(range.end)) {
      return true;
    }
  }
  return false;
}

/**
 * Validate a URL for safe fetching (blocks SSRF).
 * Only allows http/https schemes and blocks private/reserved IPs.
 * Resolves DNS to check the actual IP the hostname points to.
 */
export async function validateUrlForFetch(urlString: string): Promise<void> {
  let parsed: URL;
  try {
    parsed = new URL(urlString);
  } catch {
    throw new Error('Invalid URL');
  }

  // Only allow http(s)
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new Error(`URL scheme '${parsed.protocol}' is not allowed. Use http: or https:`);
  }

  // Block URLs with authentication
  if (parsed.username || parsed.password) {
    throw new Error('URLs with credentials are not allowed');
  }

  const hostname = parsed.hostname;

  // If hostname is already an IP, check it directly
  if (net.isIP(hostname)) {
    if (isPrivateIP(hostname)) {
      throw new Error('URLs pointing to private/reserved IP addresses are not allowed');
    }
    return;
  }

  // Resolve DNS and check all returned IPs
  try {
    const addresses = await dns.resolve4(hostname).catch(() => [] as string[]);
    const addresses6 = await dns.resolve6(hostname).catch(() => [] as string[]);
    const allAddresses = [...addresses, ...addresses6];

    if (allAddresses.length === 0) {
      throw new Error(`Cannot resolve hostname: ${hostname}`);
    }

    for (const addr of allAddresses) {
      if (isPrivateIP(addr)) {
        throw new Error('URLs pointing to private/reserved IP addresses are not allowed');
      }
    }
  } catch (err) {
    if (err instanceof Error && err.message.includes('not allowed')) throw err;
    throw new Error(`Cannot resolve hostname: ${hostname}`);
  }
}

/**
 * Sanitize a filename for use in Content-Disposition headers.
 * Strips dangerous characters that could enable CRLF injection.
 */
export function sanitizeFilename(filename: string): string {
  return filename
    .replace(/[/\\:*?"<>|\r\n\x00-\x1f]/g, '_')  // Replace dangerous chars
    .replace(/\.{2,}/g, '.')                         // Collapse dots
    .slice(0, 255);                                  // Limit length
}

/**
 * Clamp a pagination parameter to safe bounds.
 */
export function clampPagination(value: unknown, defaultVal: number, max: number): number {
  const num = typeof value === 'string' ? parseInt(value, 10) : Number(value);
  if (isNaN(num) || num < 0) return defaultVal;
  return Math.min(num, max);
}

/**
 * Validate a WhatsApp JID format.
 * Accepts: number@s.whatsapp.net, number-number@g.us, number@lid,
 * status@broadcast, number@broadcast.
 */
const JID_REGEX = /^(\d+@(s\.whatsapp\.net|lid|broadcast)|\d+-\d+@g\.us|status@broadcast)$/;

export function isValidJid(jid: unknown): boolean {
  if (typeof jid !== 'string') return false;
  if (jid.length === 0 || jid.length > 128) return false;
  return JID_REGEX.test(jid);
}

/**
 * Sanitize a string for safe interpolation into a vCard field.
 * Strips newlines, carriage returns, and vCard control characters.
 */
export function sanitizeVCardField(value: string): string {
  return value.replace(/[\r\n;\\]/g, ' ').trim().slice(0, 512);
}

const KNOWN_DEFAULT_KEYS = [
  'change-me-to-a-strong-random-key',
];

/**
 * Check if the provided API key is a known insecure default.
 */
export function isInsecureDefaultKey(key: string): boolean {
  return KNOWN_DEFAULT_KEYS.includes(key);
}

/**
 * Generate a cryptographically random API key.
 */
export function generateSecureKey(): string {
  return crypto.randomBytes(32).toString('base64url');
}

/**
 * Extract a Bearer token from an Authorization header value.
 * Handles case-insensitive "Bearer" prefix and extra whitespace.
 * Returns null if the header doesn't match the Bearer scheme.
 */
export function extractBearerToken(header: string | undefined): string | null {
  if (!header) return null;
  const match = header.match(/^Bearer\s+(.+)$/i);
  return match ? match[1] : null;
}

/**
 * Hash a JID for privacy in event logs.
 * Returns a truncated SHA-256 hash with @hashed suffix.
 * When disabled (pass-through mode), returns the JID unchanged.
 */
export function hashJid(jid: string, enabled: boolean): string {
  if (!enabled) return jid;
  return crypto.createHash('sha256').update(jid).digest('hex').slice(0, 16) + '@hashed';
}
