import { createPublicClient, encodeFunctionData, http, parseEther, type Hex } from 'viem';
import { bscTestnet } from 'viem/chains';
import { getPimlicoClient } from './pimlico';
import 'dotenv/config';

// Venus Protocol vBNB contract address on BSC Testnet
const VENUS_VBNB = '0x2E7222e51c0f6e98610A1543Aa3836E092CDe62c' as `0x${string}`;

// USDT on BSC Testnet
const USDT_TESTNET = '0x337610d27c682E347C9cD60BD4b3b107C9d34dDd' as `0x${string}`;

// Public client for waiting for transaction receipts.
// SmartAccountClient is a bundler client and does not expose waitForTransactionReceipt.
const publicClient = createPublicClient({
  chain: bscTestnet,
  transport: http(process.env.BSC_TESTNET_RPC || bscTestnet.rpcUrls.default.http[0]),
});

export interface TxResult {
  success: boolean;
  txHash?: Hex;
  explorerUrl?: string;
  error?: string;
}

/**
 * Returns the smart account's BNB balance in ether (as a number).
 */
export async function getSmartAccountBalance(): Promise<{ address: string; balanceBNB: number }> {
  const { address } = await getPimlicoClient();
  const balance = await publicClient.getBalance({ address });
  return { address, balanceBNB: Number(balance) / 1e18 };
}

/**
 * Execute a yield deposit to Venus Protocol vBNB.
 * Encodes mint() and sends as a gasless UserOperation via Pimlico.
 */
export async function executeYieldDeposit(amountBNB: number): Promise<TxResult> {
  try {
    const { client } = await getPimlicoClient();

    const data = encodeFunctionData({
      abi: [{ name: 'mint', type: 'function', inputs: [], stateMutability: 'payable' }],
      functionName: 'mint',
    });

    console.log(`[Execute] Depositing ${amountBNB} BNB to Venus vBNB...`);

    // account and chain are omitted: they are hoisted from the concrete client type
    // (SmartAccountClient<HttpTransport, typeof bscTestnet, SmartAccount<...>>)
    const txHash = await client.sendTransaction({
      to: VENUS_VBNB,
      data,
      value: parseEther(amountBNB.toString()),
    });

    console.log('[Execute] Yield deposit submitted:', txHash);

    await publicClient.waitForTransactionReceipt({ hash: txHash });

    console.log('[Execute] Yield deposit confirmed:', txHash);

    return {
      success: true,
      txHash,
      explorerUrl: `https://testnet.bscscan.com/tx/${txHash}`,
    };
  } catch (e: any) {
    console.error('[Execute] Yield deposit failed:', e.message);
    return { success: false, error: e.message || 'Unknown error occurred' };
  }
}

/**
 * Execute a testnet USDT transfer.
 * Encodes ERC-20 transfer() and sends as a gasless UserOperation via Pimlico.
 */
export async function executeTestnetTransfer(to: string, amount: bigint): Promise<TxResult> {
  try {
    const { client } = await getPimlicoClient();

    const data = encodeFunctionData({
      abi: [{
        name: 'transfer',
        type: 'function',
        inputs: [
          { name: 'to', type: 'address' },
          { name: 'amount', type: 'uint256' },
        ],
        stateMutability: 'nonpayable',
      }],
      functionName: 'transfer',
      args: [to as `0x${string}`, amount],
    });

    console.log(`[Execute] Transferring ${amount} USDT to ${to}...`);

    const txHash = await client.sendTransaction({
      to: USDT_TESTNET,
      data,
    });

    console.log('[Execute] USDT transfer submitted:', txHash);

    await publicClient.waitForTransactionReceipt({ hash: txHash });

    console.log('[Execute] USDT transfer confirmed:', txHash);

    return {
      success: true,
      txHash,
      explorerUrl: `https://testnet.bscscan.com/tx/${txHash}`,
    };
  } catch (e: any) {
    console.error('[Execute] USDT transfer failed:', e.message);
    return { success: false, error: e.message || 'Unknown error occurred' };
  }
}
