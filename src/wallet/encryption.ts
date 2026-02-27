import crypto from 'crypto';

const ALGO = 'aes-256-gcm';
const SALT = 'defai-bnb-salt-v1';

/**
 * Server-side encryption key for encrypting/decrypting private keys.
 * Defaults to 'defai-dev-default' for backward compat with existing DB entries.
 */
export function getServerKey(): string {
  return process.env.ENCRYPTION_KEY || 'defai-dev-default';
}

/**
 * Encrypt a plaintext string with AES-256-GCM.
 * Returns "iv:authTag:ciphertext" (all hex-encoded).
 */
export function encrypt(plaintext: string, passphrase: string): string {
  const key = crypto.scryptSync(passphrase, SALT, 32);
  const iv = crypto.randomBytes(16);
  const cipher = crypto.createCipheriv(ALGO, key, iv);
  let encrypted = cipher.update(plaintext, 'utf8', 'hex');
  encrypted += cipher.final('hex');
  const tag = cipher.getAuthTag().toString('hex');
  return `${iv.toString('hex')}:${tag}:${encrypted}`;
}

/**
 * Decrypt an "iv:authTag:ciphertext" string with AES-256-GCM.
 * Returns the original plaintext.
 */
export function decrypt(ciphertext: string, passphrase: string): string {
  const [ivHex, tagHex, encrypted] = ciphertext.split(':');
  const key = crypto.scryptSync(passphrase, SALT, 32);
  const decipher = crypto.createDecipheriv(ALGO, key, Buffer.from(ivHex, 'hex'));
  decipher.setAuthTag(Buffer.from(tagHex, 'hex'));
  let decrypted = decipher.update(encrypted, 'hex', 'utf8');
  decrypted += decipher.final('utf8');
  return decrypted;
}
