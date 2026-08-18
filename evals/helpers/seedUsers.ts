/**
 * Eval-only user seeding.
 *
 * Write-path tool handlers in agentRouter.executeTool() call
 * walletManager.activate(userId) UNCONDITIONALLY before dispatching —
 * including on the confirmation-preview branch, which never touches the
 * chain. That means every trajectory exercising yield_deposit, swap_tokens,
 * send_tokens, rotate_position, or delta_neutral_open/close needs a real,
 * registered user row to even reach the safe preview path.
 *
 * src/core/userResolver.ts's createUser() is the canonical registration
 * flow, but it always mints its own uuid() for the user id — it has no way
 * to pin a caller-chosen id. Trajectory JSON files hardcode specific
 * user_id values (e.g. "eval-adv-01") for traceability across runs, so this
 * mirrors createUser()'s body with a caller-supplied id instead of
 * reinventing the registration logic.
 *
 * Uses a fresh, unfunded, randomly generated key per user — activation only
 * needs a valid EOA to derive a counterfactual smart-account address and
 * build a client object; it never signs or sends anything on the
 * confirmation-preview branch these trajectories exercise.
 */

import { createPublicClient, http } from 'viem';
import { privateKeyToAccount, generatePrivateKey } from 'viem/accounts';
import { entryPoint07Address } from 'viem/account-abstraction';
import { bscTestnet } from 'viem/chains';
import { toSimpleSmartAccount } from 'permissionless/accounts';
import { encrypt, getServerKey } from '../../src/wallet/encryption';
import * as dbOps from '../../src/core/db';
import { ADDRESSES } from '../../src/utils/constants';
import { logger } from '../../src/utils/logger';

/** Registers `userId` as a fresh eval user if it doesn't already exist. No-op otherwise. */
export async function ensureEvalUser(userId: string): Promise<void> {
  if (dbOps.getUser(userId)) return;

  const privateKey = generatePrivateKey();
  const signer = privateKeyToAccount(privateKey);
  const rpcUrl = process.env.BSC_TESTNET_RPC || bscTestnet.rpcUrls.default.http[0];
  const publicClient = createPublicClient({ chain: bscTestnet, transport: http(rpcUrl) });

  const smartAccount = await toSimpleSmartAccount({
    client: publicClient,
    owner: signer,
    entryPoint: { address: entryPoint07Address, version: '0.7' },
    factoryAddress: ADDRESSES.SIMPLE_ACCOUNT_FACTORY_V07,
  });

  dbOps.saveUser({
    id: userId,
    encrypted_private_key: encrypt(privateKey, getServerKey()),
    smart_account_address: smartAccount.address,
  });
}

/** Seeds every unique user_id referenced by a case set. Idempotent — safe to call every run. */
export async function ensureEvalUsers(userIds: string[]): Promise<void> {
  const unique = [...new Set(userIds)];
  logger.info({ count: unique.length }, 'eval: ensuring seed users exist');
  for (const id of unique) {
    await ensureEvalUser(id);
  }
}
