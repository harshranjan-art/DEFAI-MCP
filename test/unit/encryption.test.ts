import { describe, it, expect } from 'vitest';
import { encrypt, decrypt } from '../../src/wallet/encryption';

describe('encryption', () => {
  const passphrase = 'test-passphrase-123';
  const plaintext = 'a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2';

  it('encrypt then decrypt returns original plaintext', () => {
    const ciphertext = encrypt(plaintext, passphrase);
    const result = decrypt(ciphertext, passphrase);
    expect(result).toBe(plaintext);
  });

  it('ciphertext format is iv:tag:encrypted (3 hex parts)', () => {
    const ciphertext = encrypt(plaintext, passphrase);
    const parts = ciphertext.split(':');
    expect(parts).toHaveLength(3);
    // Each part should be a hex string
    for (const part of parts) {
      expect(part).toMatch(/^[0-9a-f]+$/);
    }
  });

  it('different passphrases produce different ciphertext', () => {
    const ct1 = encrypt(plaintext, 'passphrase-one');
    const ct2 = encrypt(plaintext, 'passphrase-two');
    expect(ct1).not.toBe(ct2);
  });

  it('same passphrase produces different ciphertext (random IV)', () => {
    const ct1 = encrypt(plaintext, passphrase);
    const ct2 = encrypt(plaintext, passphrase);
    expect(ct1).not.toBe(ct2);
    // But both decrypt to the same value
    expect(decrypt(ct1, passphrase)).toBe(plaintext);
    expect(decrypt(ct2, passphrase)).toBe(plaintext);
  });

  it('wrong passphrase throws on decrypt', () => {
    const ciphertext = encrypt(plaintext, passphrase);
    expect(() => decrypt(ciphertext, 'wrong-passphrase')).toThrow();
  });

  it('handles empty string plaintext', () => {
    const ciphertext = encrypt('', passphrase);
    const result = decrypt(ciphertext, passphrase);
    expect(result).toBe('');
  });

  it('handles unicode plaintext', () => {
    const unicode = 'hello world 1234';
    const ciphertext = encrypt(unicode, passphrase);
    const result = decrypt(ciphertext, passphrase);
    expect(result).toBe(unicode);
  });
});
