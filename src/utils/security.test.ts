import { describe, it, expect } from 'vitest';
import {
  timingSafeEqual,
  sanitizeFilename,
  clampPagination,
  isValidJid,
  sanitizeVCardField,
  isInsecureDefaultKey,
  generateSecureKey,
  extractBearerToken,
  hashJid,
  validateUrlForFetch,
} from './security.js';

describe('timingSafeEqual', () => {
  it('returns true for equal strings', () => {
    expect(timingSafeEqual('secret', 'secret')).toBe(true);
  });

  it('returns false for different strings', () => {
    expect(timingSafeEqual('secret', 'wrong')).toBe(false);
  });

  it('returns false for different-length strings', () => {
    expect(timingSafeEqual('short', 'a-longer-string')).toBe(false);
  });

  it('returns true for empty strings', () => {
    expect(timingSafeEqual('', '')).toBe(true);
  });
});

describe('isValidJid', () => {
  it('accepts valid individual JIDs', () => {
    expect(isValidJid('5511999999999@s.whatsapp.net')).toBe(true);
  });

  it('accepts group JIDs', () => {
    expect(isValidJid('120363123456789@g.us')).toBe(true);
  });

  it('accepts group JIDs with hyphen', () => {
    expect(isValidJid('120363123456789-1234567890@g.us')).toBe(true);
  });

  it('accepts lid JIDs', () => {
    expect(isValidJid('53047342428326@lid')).toBe(true);
  });

  it('accepts status@broadcast', () => {
    expect(isValidJid('status@broadcast')).toBe(true);
  });

  it('accepts number@broadcast', () => {
    expect(isValidJid('5511999999999@broadcast')).toBe(true);
  });

  it('rejects empty string', () => {
    expect(isValidJid('')).toBe(false);
  });

  it('rejects non-string input', () => {
    expect(isValidJid(null)).toBe(false);
    expect(isValidJid(undefined)).toBe(false);
    expect(isValidJid(123)).toBe(false);
  });

  it('rejects strings over 128 chars', () => {
    expect(isValidJid('1'.repeat(120) + '@s.whatsapp.net')).toBe(false);
  });

  it('rejects invalid formats', () => {
    expect(isValidJid('not-a-jid')).toBe(false);
    expect(isValidJid('user@example.com')).toBe(false);
    expect(isValidJid('abc@s.whatsapp.net')).toBe(false); // letters not allowed
  });
});

describe('sanitizeFilename', () => {
  it('strips dangerous characters', () => {
    expect(sanitizeFilename('file/name\\bad:chars')).toBe('file_name_bad_chars');
  });

  it('collapses multiple dots', () => {
    expect(sanitizeFilename('file...txt')).toBe('file.txt');
  });

  it('strips control characters', () => {
    expect(sanitizeFilename('file\r\nname\x00.txt')).toBe('file__name_.txt');
  });

  it('limits length to 255', () => {
    const long = 'a'.repeat(300) + '.txt';
    expect(sanitizeFilename(long).length).toBeLessThanOrEqual(255);
  });

  it('handles normal filenames unchanged', () => {
    expect(sanitizeFilename('photo_2024.jpg')).toBe('photo_2024.jpg');
  });
});

describe('clampPagination', () => {
  it('returns default for NaN', () => {
    expect(clampPagination('abc', 50, 500)).toBe(50);
  });

  it('returns default for negative values', () => {
    expect(clampPagination('-10', 50, 500)).toBe(50);
  });

  it('clamps to max', () => {
    expect(clampPagination('1000', 50, 500)).toBe(500);
  });

  it('passes through valid values', () => {
    expect(clampPagination('100', 50, 500)).toBe(100);
  });

  it('handles undefined', () => {
    expect(clampPagination(undefined, 50, 500)).toBe(50);
  });
});

describe('sanitizeVCardField', () => {
  it('strips newlines and vCard control chars', () => {
    expect(sanitizeVCardField('John\r\nDoe;Jr\\')).toBe('John  Doe Jr');
  });

  it('trims whitespace', () => {
    expect(sanitizeVCardField('  Alice  ')).toBe('Alice');
  });

  it('limits length to 512', () => {
    const long = 'x'.repeat(600);
    expect(sanitizeVCardField(long).length).toBeLessThanOrEqual(512);
  });
});

describe('extractBearerToken', () => {
  it('extracts token from valid header', () => {
    expect(extractBearerToken('Bearer my-token-123')).toBe('my-token-123');
  });

  it('is case-insensitive', () => {
    expect(extractBearerToken('bearer my-token')).toBe('my-token');
    expect(extractBearerToken('BEARER my-token')).toBe('my-token');
  });

  it('returns null for non-Bearer schemes', () => {
    expect(extractBearerToken('Basic abc123')).toBeNull();
  });

  it('returns null for undefined', () => {
    expect(extractBearerToken(undefined)).toBeNull();
  });

  it('returns null for empty string', () => {
    expect(extractBearerToken('')).toBeNull();
  });
});

describe('hashJid', () => {
  it('returns original JID when disabled', () => {
    expect(hashJid('5511999999999@s.whatsapp.net', false)).toBe('5511999999999@s.whatsapp.net');
  });

  it('returns hashed value when enabled', () => {
    const result = hashJid('5511999999999@s.whatsapp.net', true);
    expect(result).toMatch(/^[0-9a-f]{16}@hashed$/);
  });

  it('produces consistent hashes', () => {
    const a = hashJid('5511999999999@s.whatsapp.net', true);
    const b = hashJid('5511999999999@s.whatsapp.net', true);
    expect(a).toBe(b);
  });

  it('produces different hashes for different JIDs', () => {
    const a = hashJid('5511999999999@s.whatsapp.net', true);
    const b = hashJid('5511888888888@s.whatsapp.net', true);
    expect(a).not.toBe(b);
  });
});

describe('isInsecureDefaultKey', () => {
  it('detects the known default key', () => {
    expect(isInsecureDefaultKey('change-me-to-a-strong-random-key')).toBe(true);
  });

  it('does not flag custom keys', () => {
    expect(isInsecureDefaultKey('my-custom-secure-key-abc123')).toBe(false);
  });
});

describe('generateSecureKey', () => {
  it('generates a base64url string', () => {
    const key = generateSecureKey();
    expect(key).toMatch(/^[A-Za-z0-9_-]+$/);
  });

  it('generates different keys each time', () => {
    const a = generateSecureKey();
    const b = generateSecureKey();
    expect(a).not.toBe(b);
  });

  it('generates keys of sufficient length', () => {
    const key = generateSecureKey();
    expect(key.length).toBeGreaterThanOrEqual(32);
  });
});

describe('validateUrlForFetch', () => {
  it('rejects non-http schemes', async () => {
    await expect(validateUrlForFetch('ftp://example.com')).rejects.toThrow('not allowed');
    await expect(validateUrlForFetch('file:///etc/passwd')).rejects.toThrow('not allowed');
  });

  it('rejects URLs with credentials', async () => {
    await expect(validateUrlForFetch('https://user:pass@example.com')).rejects.toThrow('credentials');
  });

  it('rejects invalid URLs', async () => {
    await expect(validateUrlForFetch('not-a-url')).rejects.toThrow('Invalid URL');
  });

  it('rejects private IPv4 addresses', async () => {
    await expect(validateUrlForFetch('http://127.0.0.1/hook')).rejects.toThrow('private');
    await expect(validateUrlForFetch('http://10.0.0.1/hook')).rejects.toThrow('private');
    await expect(validateUrlForFetch('http://192.168.1.1/hook')).rejects.toThrow('private');
    await expect(validateUrlForFetch('http://172.16.0.1/hook')).rejects.toThrow('private');
  });

  it('rejects link-local/metadata addresses', async () => {
    await expect(validateUrlForFetch('http://169.254.169.254/latest/meta-data')).rejects.toThrow('private');
  });
});
