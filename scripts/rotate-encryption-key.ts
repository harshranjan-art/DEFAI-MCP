/**
 * Rotate the server-side ENCRYPTION_KEY for every stored private key.
 *
 * Usage:
 *   OLD_ENCRYPTION_KEY=... ENCRYPTION_KEY=<new> npx ts-node scripts/rotate-encryption-key.ts
 *
 * What it does:
 *   1. Reads every user's `encrypted_private_key`.
 *   2. Decrypts with OLD_ENCRYPTION_KEY.
 *   3. Re-encrypts with ENCRYPTION_KEY.
 *   4. Writes back inside a single transaction — either all rows rotate
 *      or none do.
 *
 * Safety:
 *   - Refuses to run if either env var is missing or < 32 chars.
 *   - Refuses to run if OLD === new (no-op + fail-fast on accidental misuse).
 *   - Dry-run mode (--dry-run) decrypts + re-encrypts but does NOT write.
 *   - Logs counts at the end; never logs key material or plaintexts.
 *
 * Deferred from Phase 0 (operational tooling), shipped in Phase 6.5.
 */

import 'dotenv/config';
import { db } from '../src/core/db';
import { encrypt, decrypt } from '../src/wallet/encryption';

function fail(msg: string): never {
  console.error(`rotate-encryption-key: ${msg}`);
  process.exit(1);
}

function main(): void {
  const dryRun = process.argv.includes('--dry-run');

  const oldKey = process.env.OLD_ENCRYPTION_KEY;
  const newKey = process.env.ENCRYPTION_KEY;

  if (!oldKey || oldKey.length < 32) fail('OLD_ENCRYPTION_KEY env var is required and must be >= 32 chars.');
  if (!newKey || newKey.length < 32) fail('ENCRYPTION_KEY env var is required and must be >= 32 chars.');
  if (oldKey === newKey) fail('OLD_ENCRYPTION_KEY and ENCRYPTION_KEY are identical — nothing to rotate.');

  const rows = db
    .prepare(`SELECT id, encrypted_private_key FROM users`)
    .all() as Array<{ id: string; encrypted_private_key: string }>;

  if (rows.length === 0) {
    console.log('No users to rotate. Done.');
    return;
  }

  let succeeded = 0;
  let failed = 0;

  // Two-pass: decrypt+re-encrypt all rows first (so we never partially
  // rotate). Then write them all inside a single transaction.
  const reencrypted: Array<{ id: string; blob: string }> = [];
  for (const r of rows) {
    try {
      const plaintext = decrypt(r.encrypted_private_key, oldKey);
      const blob = encrypt(plaintext, newKey);
      reencrypted.push({ id: r.id, blob });
      succeeded += 1;
    } catch (e: any) {
      failed += 1;
      console.error(`  ✗ user ${r.id}: decrypt failed — ${e?.message ?? e}`);
    }
  }

  if (failed > 0) {
    fail(`${failed}/${rows.length} users could not be decrypted with OLD_ENCRYPTION_KEY. Aborting — no rows written.`);
  }

  if (dryRun) {
    console.log(`[dry-run] would rotate ${succeeded} keys (no writes).`);
    return;
  }

  const writeAll = db.transaction((items: Array<{ id: string; blob: string }>) => {
    const upd = db.prepare(`UPDATE users SET encrypted_private_key = ? WHERE id = ?`);
    for (const it of items) upd.run(it.blob, it.id);
  });

  try {
    writeAll(reencrypted);
    console.log(`Rotated ${succeeded} keys successfully.`);
  } catch (e: any) {
    fail(`write transaction failed mid-flight (no rows committed): ${e?.message ?? e}`);
  }
}

main();
