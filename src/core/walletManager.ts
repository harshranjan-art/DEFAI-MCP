import { createPublicClient, http, type Address } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { bscTestnet } from 'viem/chains';
import { entryPoint07Address } from 'viem/account-abstraction';
import { createSmartAccountClient } from 'permissionless';
import { toSimpleSmartAccount } from 'permissionless/accounts';
import { createPimlicoClient } from 'permissionless/clients/pimlico';
import { decrypt, getServerKey } from '../wallet/encryption';
import * as dbOps from './db';
import { ADDRESSES, getPimlicoUrl } from '../utils/constants';
import { logger } from '../utils/logger';

interface WalletSession {
  client: any; // SmartAccountClient — no explicit type to preserve concrete inference
  publicClient: any;
  address: Address;
}

// In-memory cache of active wallet sessions (hot wallets)
const activeSessions = new Map<string, WalletSession>();

/**
 * Activate a user's wallet for transacting.
 * Decrypts private key using server-side ENCRYPTION_KEY, initializes SmartAccountClient, caches in memory.
 */
export async function activate(userId: string): Promise<Address> {
  const existing = activeSessions.get(userId);
  if (existing) return existing.address;

  const user = dbOps.getUser(userId);
  if (!user) throw new Error(`User ${userId} not found`);

  const privateKey = decrypt(user.encrypted_private_key, getServerKey());
  const pk = privateKey.startsWith('0x')
    ? (privateKey as `0x${string}`)
    : (`0x${privateKey}` as `0x${string}`);

  const apiKey = user.pimlico_api_key || process.env.PIMLICO_API_KEY;
  if (!apiKey) throw new Error('No PIMLICO_API_KEY configured');

  const rpcUrl = process.env.BSC_TESTNET_RPC || bscTestnet.rpcUrls.default.http[0];
  const pimlicoUrl = getPimlicoUrl(apiKey);

  const signer = privateKeyToAccount(pk);

  const publicClient = createPublicClient({
    chain: bscTestnet,
    transport: http(rpcUrl),
  });

  const pimlicoClient = createPimlicoClient({
    chain: bscTestnet,
    transport: http(pimlicoUrl),
    entryPoint: { address: entryPoint07Address, version: '0.7' },
  });

  const smartAccount = await toSimpleSmartAccount({
    client: publicClient,
    owner: signer,
    entryPoint: { address: entryPoint07Address, version: '0.7' },
    factoryAddress: ADDRESSES.SIMPLE_ACCOUNT_FACTORY_V07,
  });

  const client = createSmartAccountClient({
    account: smartAccount,
    chain: bscTestnet,
    bundlerTransport: http(pimlicoUrl),
    paymaster: pimlicoClient,
    userOperation: {
      estimateFeesPerGas: async () => (await pimlicoClient.getUserOperationGasPrice()).fast,
    },
  });

  const session: WalletSession = {
    client,
    publicClient,
    address: smartAccount.address,
  };

  activeSessions.set(userId, session);
  logger.info('Wallet activated for user %s (%s)', userId, smartAccount.address);

  return smartAccount.address;
}

/**
 * Get the active wallet session for a user.
 * Throws if wallet is not activated.
 */
export function getClient(userId: string): WalletSession {
  const session = activeSessions.get(userId);
  if (!session) throw new Error(`Wallet not activated for user ${userId}. Call wallet_setup first.`);
  return session;
}

/**
 * Check if a user has an active wallet session.
 */
export function isActive(userId: string): boolean {
  return activeSessions.has(userId);
}

/**
 * Deactivate a user's wallet session, freeing memory.
 */
export function deactivate(userId: string): void {
  activeSessions.delete(userId);
  logger.info('Wallet deactivated for user %s', userId);
}
