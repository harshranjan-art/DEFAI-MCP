import { db } from '../db';
import { encrypt, decrypt, getServerKey, isLegacyFormat } from '../../wallet/encryption';
import { logger } from '../../utils/logger';

/**
 * One-shot migration: re-encrypt all user private keys that use the legacy
 * 3-part format (static-salt) with the new 4-part random-salt format.
 *
 * Idempotent — rows already in the new format are skipped. Safe to run on every
 * startup; cost is one SELECT plus zero writes once migrated.
 *
 * Requires ENCRYPTION_KEY to be set (this is what was used to encrypt the
 * legacy rows, since the fallback was a hardcoded constant). If the user is
 * starting fresh and never set ENCRYPTION_KEY before, the legacy rows were
 * encrypted with the literal string 'defai-dev-default' — set
 * ENCRYPTION_KEY=defai-dev-default temporarily to migrate, then rotate to a
 * real key (a key-rotation script is planned for Phase 6).
 */
export function migrateLegacyEncryptedKeys(): void {
  const passphrase = getServerKey();
  const rows = db
    .prepare(`SELECT id, encrypted_private_key FROM users`)
    .all() as Array<{ id: string; encrypted_private_key: string }>;

  let migrated = 0;
  let skipped = 0;
  let failed = 0;

  for (const row of rows) {
    if (!isLegacyFormat(row.encrypted_private_key)) {
      skipped += 1;
      continue;
    }
    try {
      const plaintext = decrypt(row.encrypted_private_key, passphrase);
      const reEncrypted = encrypt(plaintext, passphrase);
      db.prepare(`UPDATE users SET encrypted_private_key = ? WHERE id = ?`).run(reEncrypted, row.id);
      migrated += 1;
    } catch (e: any) {
      failed += 1;
      logger.error(
        { userId: row.id, err: e?.message },
        'migration 001: failed to re-encrypt legacy key — wrong ENCRYPTION_KEY?',
      );
    }
  }

  if (migrated + failed > 0) {
    logger.info(
      { migrated, skipped, failed, total: rows.length },
      'migration 001: legacy encrypted-key re-encryption complete',
    );
  }
}
