import { describe, it, expect, afterEach } from 'vitest';
import { encrypt, decrypt, isLegacyFormat, getServerKey } from '../../src/wallet/encryption';
import crypto from 'crypto';

describe('encryption (new salted format)', () => {
  const passphrase = 'test-passphrase-with-enough-entropy-for-real-use';
  const plaintext = 'a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2';

  it('encrypt then decrypt returns original plaintext', () => {
    const ciphertext = encrypt(plaintext, passphrase);
    const result = decrypt(ciphertext, passphrase);
    expect(result).toBe(plaintext);
  });

  it('ciphertext format is salt:iv:tag:encrypted (4 hex parts)', () => {
    const ciphertext = encrypt(plaintext, passphrase);
    const parts = ciphertext.split(':');
    expect(parts).toHaveLength(4);
    for (const part of parts) {
      expect(part).toMatch(/^[0-9a-f]+$/);
    }
  });

  it('different passphrases produce different ciphertext', () => {
    const ct1 = encrypt(plaintext, 'passphrase-one-with-enough-length-here');
    const ct2 = encrypt(plaintext, 'passphrase-two-with-enough-length-here');
    expect(ct1).not.toBe(ct2);
  });

  it('same passphrase + plaintext produces different ciphertext (random salt + IV)', () => {
    const ct1 = encrypt(plaintext, passphrase);
    const ct2 = encrypt(plaintext, passphrase);
    expect(ct1).not.toBe(ct2);
    // First parts (salt) must differ
    expect(ct1.split(':')[0]).not.toBe(ct2.split(':')[0]);
    // Both still decrypt to the same value
    expect(decrypt(ct1, passphrase)).toBe(plaintext);
    expect(decrypt(ct2, passphrase)).toBe(plaintext);
  });

  it('wrong passphrase throws on decrypt (GCM auth fails)', () => {
    const ciphertext = encrypt(plaintext, passphrase);
    expect(() => decrypt(ciphertext, 'completely-different-wrong-passphrase')).toThrow();
  });

  it('tampered ciphertext throws on decrypt (GCM integrity check)', () => {
    const ciphertext = encrypt(plaintext, passphrase);
    const parts = ciphertext.split(':');
    // Flip a byte in the encrypted payload
    const ctBuf = Buffer.from(parts[3], 'hex');
    ctBuf[0] ^= 0xff;
    const tampered = `${parts[0]}:${parts[1]}:${parts[2]}:${ctBuf.toString('hex')}`;
    expect(() => decrypt(tampered, passphrase)).toThrow();
  });

  it('handles empty string plaintext', () => {
    const ciphertext = encrypt('', passphrase);
    expect(decrypt(ciphertext, passphrase)).toBe('');
  });

  it('handles unicode plaintext', () => {
    const unicode = 'héllo wörld 1234 — π';
    const ciphertext = encrypt(unicode, passphrase);
    expect(decrypt(ciphertext, passphrase)).toBe(unicode);
  });

  it('rejects malformed blob (wrong number of parts)', () => {
    expect(() => decrypt('only:two', passphrase)).toThrow(/Invalid ciphertext format/);
    expect(() => decrypt('a:b:c:d:e', passphrase)).toThrow(/Invalid ciphertext format/);
  });
});

describe('encryption (legacy 3-part format compatibility)', () => {
  const LEGACY_SALT = 'defai-bnb-salt-v1';
  const passphrase = 'legacy-test-passphrase-with-real-len';
  const plaintext = 'legacy-private-key-deadbeef';

  // Construct a legacy 3-part blob the way the old encryption.ts did.
  function legacyEncrypt(pt: string, pass: string): string {
    const N = parseInt(process.env.SCRYPT_N || '131072', 10);
    const key = crypto.scryptSync(pass, LEGACY_SALT, 32, { N, r: 8, p: 1, maxmem: 256 * 1024 * 1024 });
    const iv = crypto.randomBytes(16);
    const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
    const enc = Buffer.concat([cipher.update(pt, 'utf8'), cipher.final()]);
    const tag = cipher.getAuthTag();
    return `${iv.toString('hex')}:${tag.toString('hex')}:${enc.toString('hex')}`;
  }

  it('isLegacyFormat detects 3-part blobs', () => {
    const legacy = legacyEncrypt(plaintext, passphrase);
    expect(isLegacyFormat(legacy)).toBe(true);
    const modern = encrypt(plaintext, passphrase);
    expect(isLegacyFormat(modern)).toBe(false);
  });

  it('decrypt accepts legacy 3-part blob', () => {
    const legacy = legacyEncrypt(plaintext, passphrase);
    expect(decrypt(legacy, passphrase)).toBe(plaintext);
  });

  it('legacy blob fails with wrong passphrase', () => {
    const legacy = legacyEncrypt(plaintext, passphrase);
    expect(() => decrypt(legacy, 'wrong-passphrase-with-enough-length')).toThrow();
  });
});

describe('encryption.getServerKey', () => {
  const original = process.env.ENCRYPTION_KEY;

  afterEach(() => {
    if (original === undefined) delete process.env.ENCRYPTION_KEY;
    else process.env.ENCRYPTION_KEY = original;
  });

  it('throws when ENCRYPTION_KEY is missing', () => {
    delete process.env.ENCRYPTION_KEY;
    expect(() => getServerKey()).toThrow(/ENCRYPTION_KEY env var is required/);
  });

  it('throws when ENCRYPTION_KEY is too short (< 32 chars)', () => {
    process.env.ENCRYPTION_KEY = 'too-short';
    expect(() => getServerKey()).toThrow(/>= 32 chars/);
  });

  it('returns the value when ENCRYPTION_KEY is sufficiently long', () => {
    process.env.ENCRYPTION_KEY = 'a'.repeat(32);
    expect(getServerKey()).toBe('a'.repeat(32));
  });
});
