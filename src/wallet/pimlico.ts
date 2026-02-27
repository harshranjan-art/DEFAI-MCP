import { createPublicClient, http, type Address } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { bscTestnet } from 'viem/chains';
import { entryPoint07Address } from 'viem/account-abstraction';
import { createSmartAccountClient } from 'permissionless';
import { toSimpleSmartAccount } from 'permissionless/accounts';
import { createPimlicoClient } from 'permissionless/clients/pimlico';
import 'dotenv/config';

const PIMLICO_BSC_TESTNET_URL = `https://api.pimlico.io/v2/97/rpc?apikey=${process.env.PIMLICO_API_KEY}`;

// One-time initialization function.
// Crucially, this is NOT annotated with an explicit return type — TypeScript infers
// the concrete SmartAccountClient<HttpTransport, typeof bscTestnet, SmartAccount<...>>
// type from the createSmartAccountClient() call, so account/chain become optional
// in sendTransaction() calls on the returned client.
async function initializePimlico() {
  if (!process.env.PRIVATE_KEY) {
    throw new Error('PRIVATE_KEY not found in environment variables');
  }
  if (!process.env.PIMLICO_API_KEY) {
    throw new Error('PIMLICO_API_KEY not found in environment variables');
  }

  const privateKey = process.env.PRIVATE_KEY.startsWith('0x')
    ? (process.env.PRIVATE_KEY as `0x${string}`)
    : (`0x${process.env.PRIVATE_KEY}` as `0x${string}`);

  const signer = privateKeyToAccount(privateKey);
  const rpcUrl = process.env.BSC_TESTNET_RPC || bscTestnet.rpcUrls.default.http[0];

  console.log('[Wallet] Initializing smart account with Pimlico...');

  const publicClient = createPublicClient({
    chain: bscTestnet,
    transport: http(rpcUrl),
  });

  const pimlicoClient = createPimlicoClient({
    chain: bscTestnet,
    transport: http(PIMLICO_BSC_TESTNET_URL),
    entryPoint: { address: entryPoint07Address, version: '0.7' },
  });

  const smartAccount = await toSimpleSmartAccount({
    client: publicClient,
    owner: signer,
    entryPoint: { address: entryPoint07Address, version: '0.7' },
    factoryAddress: '0x91E60e0613810449d098b0b5Ec8b51A0FE8c8985', // v0.7 factory (0x9406 is v0.6, incompatible)
  });

  // Pass chain: bscTestnet (not Chain | undefined) so TypeScript infers the
  // concrete chain generic, making sendTransaction chain-aware.
  const client = createSmartAccountClient({
    account: smartAccount,
    chain: bscTestnet,
    bundlerTransport: http(PIMLICO_BSC_TESTNET_URL),
    paymaster: pimlicoClient,
    userOperation: {
      estimateFeesPerGas: async () => (await pimlicoClient.getUserOperationGasPrice()).fast,
    },
  });

  console.log('[Wallet] Smart Account address:', smartAccount.address);
  console.log('[Wallet] Using Pimlico bundler on BSC Testnet (Chain 97)');

  return { client, address: smartAccount.address };
}

// Singleton promise — created once, reused on every subsequent call.
let _initPromise: ReturnType<typeof initializePimlico> | null = null;

export function getPimlicoClient(): ReturnType<typeof initializePimlico> {
  if (!_initPromise) _initPromise = initializePimlico();
  return _initPromise;
}

export async function getSmartAccountAddress(): Promise<Address> {
  const { address } = await getPimlicoClient();
  return address;
}
