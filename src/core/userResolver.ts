import { v4 as uuid } from 'uuid';
import crypto from 'crypto';
import { createPublicClient, http, type Address } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { bscTestnet } from 'viem/chains';
import { entryPoint07Address } from 'viem/account-abstraction';
import { toSimpleSmartAccount } from 'permissionless/accounts';
import { encrypt } from '../wallet/encryption';
import * as dbOps from './db';
import { ADDRESSES } from '../utils/constants';
import { logger } from '../utils/logger';

export interface User {
  id: string;
  encrypted_private_key: string;
  smart_account_address: string;
  pimlico_api_key?: string;
  telegram_id?: number;
  risk_config: string;
  alert_config: string;
  created_at: string;
}

function generateApiKey(): string {
  return `dfai_k_${crypto.randomBytes(24).toString('base64url')}`;
}

/**
 * Resolve user from DEFAI_USER_ID env variable (for MCP stdio mode).
 */
export function resolveFromEnv(): string | null {
  const envId = process.env.DEFAI_USER_ID;
  if (envId) {
    const user = dbOps.getUser(envId);
    if (user) return user.id;
    logger.warn('DEFAI_USER_ID %s not found in database', envId);
  }
  return null;
}

/**
 * Resolve user from API key (for MCP SSE / dashboard).
 */
export function resolveFromApiKey(apiKey: string): string | null {
  const user = dbOps.getUserByApiKey(apiKey);
  return user?.id ?? null;
}

/**
 * Resolve user from Telegram ID.
 */
export function resolveFromTelegram(telegramId: number): string | null {
  const user = dbOps.getUserByTelegramId(telegramId);
  return user?.id ?? null;
}

/**
 * Create a new user with encrypted private key.
 * Derives the smart account address from the private key.
 */
export async function createUser(opts: {
  privateKey: string;
  passphrase: string;
  telegramId?: number;
  label?: string;
}): Promise<{ id: string; smartAccountAddress: string; apiKey: string }> {
  const pk = opts.privateKey.startsWith('0x')
    ? (opts.privateKey as `0x${string}`)
    : (`0x${opts.privateKey}` as `0x${string}`);

  // Derive smart account address
  const signer = privateKeyToAccount(pk);
  const rpcUrl = process.env.BSC_TESTNET_RPC || bscTestnet.rpcUrls.default.http[0];
  const publicClient = createPublicClient({ chain: bscTestnet, transport: http(rpcUrl) });

  const smartAccount = await toSimpleSmartAccount({
    client: publicClient,
    owner: signer,
    entryPoint: { address: entryPoint07Address, version: '0.7' },
    factoryAddress: ADDRESSES.SIMPLE_ACCOUNT_FACTORY_V07,
  });

  const id = uuid();
  const encryptedKey = encrypt(opts.privateKey, opts.passphrase);
  const apiKey = generateApiKey();

  dbOps.saveUser({
    id,
    encrypted_private_key: encryptedKey,
    smart_account_address: smartAccount.address,
    telegram_id: opts.telegramId,
  });

  dbOps.saveApiKey(apiKey, id, opts.label || 'default');

  logger.info('Created user %s with smart account %s', id, smartAccount.address);

  return {
    id,
    smartAccountAddress: smartAccount.address,
    apiKey,
  };
}

/**
 * Link a Telegram ID to an existing user (via API key lookup).
 */
export function linkTelegram(apiKey: string, telegramId: number): boolean {
  const userId = resolveFromApiKey(apiKey);
  if (!userId) return false;
  dbOps.setTelegramId(userId, telegramId);
  logger.info('Linked Telegram %d to user %s', telegramId, userId);
  return true;
}

/**
 * Auto-create a default user from PRIVATE_KEY env if no users exist in DB.
 * This preserves backward compatibility with the existing Telegram bot.
 */
export async function ensureDefaultUser(): Promise<string | null> {
  if (dbOps.getUserCount() > 0) return null;

  const privateKey = process.env.PRIVATE_KEY;
  if (!privateKey) return null;

  logger.info('No users in DB — creating default user from PRIVATE_KEY env');
  const result = await createUser({
    privateKey,
    passphrase: 'defai-dev-default',
    label: 'default-env',
  });

  logger.info('Default user created: %s (smart account: %s)', result.id, result.smartAccountAddress);
  return result.id;
}
