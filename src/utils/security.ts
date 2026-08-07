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

function isPrivateIPv4(ip: string): boolean {
  const ipLong = ipToLong(ip);
  for (const range of BLOCKED_IP_RANGES) {
    if (ipLong >= ipToLong(range.start) && ipLong <= ipToLong(range.end)) {
      return true;
    }
  }
  return false;
}

/**
 * The first two hextets of an IPv6 address. '::' stands for a run of zeros,
 * so whatever it swallows reads as 0 — which is all the checks below need.
 */
function leadingHextets(addr: string): [number, number] {
  const parts = addr.split('::')[0].split(':').filter(Boolean);
  return [
    parts.length > 0 ? parseInt(parts[0], 16) : 0,
    parts.length > 1 ? parseInt(parts[1], 16) : 0,
  ];
}

/**
 * True only for global unicast (2000::/3), minus the ranges that look global
 * but tunnel or embed an arbitrary address. Everything else — loopback,
 * unique-local, link-local, multicast, NAT64 — sits outside 2000::/3 and is
 * rejected by the range test alone.
 */
function isGlobalUnicastIPv6(addr: string): boolean {
  const [h0, h1] = leadingHextets(addr);
  if (Number.isNaN(h0) || Number.isNaN(h1)) return false;

  if (h0 < 0x2000 || h0 > 0x3fff) return false;
  if (h0 === 0x2002) return false;                   // 2002::/16     6to4
  if (h0 === 0x2001 && h1 === 0x0000) return false;  // 2001::/32     Teredo
  if (h0 === 0x2001 && h1 === 0x0db8) return false;  // 2001:db8::/32 documentation
  return true;
}

function isPrivateIP(ip: string): boolean {
  const addr = ip.split('%')[0].toLowerCase(); // drop any IPv6 zone id

  if (net.isIPv4(addr)) return isPrivateIPv4(addr);
  if (!net.isIPv6(addr)) return true; // Block unknown formats

  // IPv4-mapped (::ffff:1.2.3.4): judge the embedded IPv4, since that is the
  // address traffic actually reaches. Node re-serializes these in hex
  // (::ffff:7f00:1), a form that no longer parses as IPv4 — it falls through
  // to the global-unicast test below and is rejected, the safe direction.
  if (addr.startsWith('::ffff:')) {
    const embedded = addr.slice(7);
    if (net.isIPv4(embedded)) return isPrivateIPv4(embedded);
  }

  return !isGlobalUnicastIPv6(addr);
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

  // WHATWG serializes an IPv6 host with its brackets ('[::1]'), which no IP
  // parser accepts — without stripping them a literal address is mistaken for
  // a hostname and sent to DNS.
  const hostname = parsed.hostname.replace(/^\[|\]$/g, '');

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
 * Accepts: number@s.whatsapp.net, number@g.us, number-number@g.us,
 * number@lid, status@broadcast, number@broadcast.
 */
const JID_REGEX = /^(\d+@(s\.whatsapp\.net|lid|broadcast)|\d+(-\d+)?@g\.us|status@broadcast)$/;

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
