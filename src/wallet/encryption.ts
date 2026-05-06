import crypto from 'crypto';

const ALGO = 'aes-256-gcm';
const KEY_LEN = 32;
const IV_LEN = 16;
const SALT_LEN = 16;
const SCRYPT_R = 8;
const SCRYPT_P = 1;
const SCRYPT_MAXMEM = 256 * 1024 * 1024;

// Legacy static salt — only used when decoding pre-Phase-0 ciphertexts (3-part format).
const LEGACY_SALT = 'defai-bnb-salt-v1';

/**
 * Server-side master passphrase. Required at runtime — no fallback.
 * Generate with: node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
 */
export function getServerKey(): string {
  const key = process.env.ENCRYPTION_KEY;
  if (!key || key.length < 32) {
    throw new Error(
      'ENCRYPTION_KEY env var is required and must be >= 32 chars. ' +
        'Generate with: node -e "console.log(require(\'crypto\').randomBytes(32).toString(\'hex\'))"',
    );
  }
  return key;
}

function scryptN(): number {
  // Lazy-read so tests can override via env without re-importing.
  return parseInt(process.env.SCRYPT_N || '131072', 10);
}

function deriveKey(passphrase: string, salt: Buffer): Buffer {
  return crypto.scryptSync(passphrase, salt, KEY_LEN, {
    N: scryptN(),
    r: SCRYPT_R,
    p: SCRYPT_P,
    maxmem: SCRYPT_MAXMEM,
  });
}

/**
 * Encrypt a plaintext string with AES-256-GCM.
 * Layout: salt:iv:tag:ciphertext (all hex). Each call generates a fresh random salt
 * and IV, so the same plaintext + passphrase yields a different blob every time —
 * blocks rainbow-table attacks against a leaked DB.
 */
export function encrypt(plaintext: string, passphrase: string): string {
  const salt = crypto.randomBytes(SALT_LEN);
  const iv = crypto.randomBytes(IV_LEN);
  const key = deriveKey(passphrase, salt);
  const cipher = crypto.createCipheriv(ALGO, key, iv);
  const enc = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [salt.toString('hex'), iv.toString('hex'), tag.toString('hex'), enc.toString('hex')].join(':');
}

/**
 * Decrypt an encrypted blob.
 * Accepts both the new 4-part format (salt:iv:tag:ciphertext) and the legacy
 * 3-part format (iv:tag:ciphertext, with the historical static salt).
 * Legacy rows are silently re-decoded; the migration script re-encrypts them lazily.
 */
export function decrypt(blob: string, passphrase: string): string {
  const parts = blob.split(':');
  let salt: Buffer;
  let iv: Buffer;
  let tag: Buffer;
  let ct: Buffer;

  if (parts.length === 3) {
    salt = Buffer.from(LEGACY_SALT, 'utf8');
    iv = Buffer.from(parts[0], 'hex');
    tag = Buffer.from(parts[1], 'hex');
    ct = Buffer.from(parts[2], 'hex');
  } else if (parts.length === 4) {
    salt = Buffer.from(parts[0], 'hex');
    iv = Buffer.from(parts[1], 'hex');
    tag = Buffer.from(parts[2], 'hex');
    ct = Buffer.from(parts[3], 'hex');
  } else {
    throw new Error(`Invalid ciphertext format: expected 3 or 4 hex parts, got ${parts.length}`);
  }

  const key = deriveKey(passphrase, salt);
  const decipher = crypto.createDecipheriv(ALGO, key, iv);
  decipher.setAuthTag(tag);
  const dec = Buffer.concat([decipher.update(ct), decipher.final()]);
  return dec.toString('utf8');
}

/**
 * Returns true if the blob uses the legacy 3-part format (and should be migrated).
 */
export function isLegacyFormat(blob: string): boolean {
  return blob.split(':').length === 3;
}
