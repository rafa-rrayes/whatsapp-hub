import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import crypto from 'crypto';

// We need to mock config before importing encryption module
vi.mock('../config.js', () => ({
  config: {
    security: {
      encryptionKey: 'test-encryption-key-at-least-16-chars-long',
      encryptWebhookSecrets: true,
    },
  },
}));

import { encrypt, decrypt, isEncrypted, deriveKey, encryptWebhookSecret, maybeDecrypt } from './encryption.js';

describe('deriveKey', () => {
  it('returns a 32-byte buffer', () => {
    const key = deriveKey('test-purpose');
    expect(key).toBeInstanceOf(Buffer);
    expect(key.length).toBe(32);
  });

  it('derives different keys for different purposes', () => {
    const a = deriveKey('purpose-a');
    const b = deriveKey('purpose-b');
    expect(a.equals(b)).toBe(false);
  });

  it('derives consistent keys for the same purpose', () => {
    const a = deriveKey('same-purpose');
    const b = deriveKey('same-purpose');
    expect(a.equals(b)).toBe(true);
  });
});

describe('encrypt / decrypt round-trip', () => {
  it('round-trips plaintext correctly', () => {
    const key = deriveKey('test');
    const plaintext = 'hello world!';
    const encrypted = encrypt(plaintext, key);
    const decrypted = decrypt(encrypted, key);
    expect(decrypted).toBe(plaintext);
  });

  it('handles empty string', () => {
    const key = deriveKey('test');
    const encrypted = encrypt('', key);
    const decrypted = decrypt(encrypted, key);
    expect(decrypted).toBe('');
  });

  it('handles unicode', () => {
    const key = deriveKey('test');
    const text = 'Hello 🌍 Olá mundo! 你好世界';
    const encrypted = encrypt(text, key);
    expect(decrypt(encrypted, key)).toBe(text);
  });

  it('produces different ciphertexts for the same plaintext (random IV)', () => {
    const key = deriveKey('test');
    const a = encrypt('same', key);
    const b = encrypt('same', key);
    expect(a).not.toBe(b);
  });

  it('encrypted output starts with enc: prefix', () => {
    const key = deriveKey('test');
    const encrypted = encrypt('data', key);
    expect(encrypted.startsWith('enc:')).toBe(true);
  });

  it('throws on wrong key', () => {
    const key1 = deriveKey('key1');
    const key2 = deriveKey('key2');
    const encrypted = encrypt('secret', key1);
    expect(() => decrypt(encrypted, key2)).toThrow();
  });

  it('throws on non-encrypted input', () => {
    const key = deriveKey('test');
    expect(() => decrypt('plaintext', key)).toThrow('not encrypted');
  });

  it('throws on tampered ciphertext', () => {
    const key = deriveKey('test');
    const encrypted = encrypt('data', key);
    // Flip a character in the base64 payload
    const tampered = encrypted.slice(0, 10) + 'X' + encrypted.slice(11);
    expect(() => decrypt(tampered, key)).toThrow();
  });
});

describe('isEncrypted', () => {
  it('returns true for encrypted values', () => {
    expect(isEncrypted('enc:abc123')).toBe(true);
  });

  it('returns false for plaintext', () => {
    expect(isEncrypted('my-secret')).toBe(false);
  });
});

describe('encryptWebhookSecret / maybeDecrypt', () => {
  it('round-trips a webhook secret', () => {
    const secret = 'my-webhook-secret';
    const encrypted = encryptWebhookSecret(secret);
    expect(isEncrypted(encrypted)).toBe(true);
    const decrypted = maybeDecrypt(encrypted);
    expect(decrypted).toBe(secret);
  });

  it('maybeDecrypt passes through plaintext', () => {
    expect(maybeDecrypt('not-encrypted')).toBe('not-encrypted');
  });
});
