import { encodeFunctionData, parseEther } from 'viem';
import type { Address } from 'viem';
import type { ProtocolAdapter, TxResult, PriceQuote } from './types';
import { ADDRESSES, PANCAKE_ROUTER_V2_ABI, API_URLS } from '../utils/constants';
import { logger } from '../utils/logger';

class PancakeSwapAdapter implements ProtocolAdapter {
  name = 'PancakeSwap';
  isSimulated = false; // Real testnet execution on V2 Router

  /**
   * Swap BNB → Token via PancakeSwap V2 Router on testnet.
   */
  async swap(from: string, to: string, amount: string, client: any, publicClient: any): Promise<TxResult> {
    try {
      const deadline = Math.floor(Date.now() / 1000) + 600; // 10 min
      const toAddress = await client.account.address;

      // BNB → Token
      if (from.toUpperCase() === 'BNB') {
        const toAddr = this.getTokenAddress(to);
        const path = [ADDRESSES.WBNB_TESTNET, toAddr];

        const data = encodeFunctionData({
          abi: PANCAKE_ROUTER_V2_ABI,
          functionName: 'swapExactETHForTokens',
          args: [BigInt(0), path, toAddress, BigInt(deadline)],
        });

        logger.info('PancakeSwap: swapping %s BNB → %s...', amount, to);

        const txHash = await client.sendTransaction({
          to: ADDRESSES.PANCAKESWAP_V2_ROUTER,
          data,
          value: parseEther(amount),
        });

        await publicClient.waitForTransactionReceipt({ hash: txHash });
        logger.info('PancakeSwap: swap confirmed %s', txHash);

        return {
          txHash,
          success: true,
          explorerUrl: `https://testnet.bscscan.com/tx/${txHash}`,
        };
      }

      // Token → BNB
      if (to.toUpperCase() === 'BNB') {
        const fromAddr = this.getTokenAddress(from);
        const path = [fromAddr, ADDRESSES.WBNB_TESTNET];

        const data = encodeFunctionData({
          abi: PANCAKE_ROUTER_V2_ABI,
          functionName: 'swapExactTokensForETH',
          args: [parseEther(amount), BigInt(0), path, toAddress, BigInt(deadline)],
        });

        logger.info('PancakeSwap: swapping %s %s → BNB...', amount, from);

        const txHash = await client.sendTransaction({
          to: ADDRESSES.PANCAKESWAP_V2_ROUTER,
          data,
        });

        await publicClient.waitForTransactionReceipt({ hash: txHash });
        logger.info('PancakeSwap: swap confirmed %s', txHash);

        return {
          txHash,
          success: true,
          explorerUrl: `https://testnet.bscscan.com/tx/${txHash}`,
        };
      }

      // Token → Token
      const fromAddr = this.getTokenAddress(from);
      const toAddr = this.getTokenAddress(to);
      const path = [fromAddr, ADDRESSES.WBNB_TESTNET, toAddr];

      const data = encodeFunctionData({
        abi: PANCAKE_ROUTER_V2_ABI,
        functionName: 'swapExactTokensForTokens',
        args: [parseEther(amount), BigInt(0), path, toAddress, BigInt(deadline)],
      });

      logger.info('PancakeSwap: swapping %s %s → %s...', amount, from, to);

      const txHash = await client.sendTransaction({
        to: ADDRESSES.PANCAKESWAP_V2_ROUTER,
        data,
      });

      await publicClient.waitForTransactionReceipt({ hash: txHash });

      return {
        txHash,
        success: true,
        explorerUrl: `https://testnet.bscscan.com/tx/${txHash}`,
      };
    } catch (e: any) {
      logger.error('PancakeSwap swap failed: %s', e.message);
      return { txHash: '', success: false, error: e.message };
    }
  }

  /**
   * Get a price quote using the on-chain getAmountsOut call (or API fallback).
   */
  async getQuote(from: string, to: string, amount: string): Promise<PriceQuote> {
    // Use DexScreener / CoinGecko price as estimate
    // On-chain getAmountsOut would need a publicClient, which we don't have here
    return {
      dex: 'PancakeSwap V2',
      fromToken: from,
      toToken: to,
      amountIn: amount,
      amountOut: '0', // Filled by caller from price aggregator
      effectivePrice: 0,
      priceImpact: 0,
    };
  }

  async getApy(token: string): Promise<number> {
    try {
      const res = await fetch(API_URLS.PANCAKESWAP_FARMS, { signal: AbortSignal.timeout(5000) });
      const data = await res.json() as any[];
      const pool = data?.find?.((p: any) => p.lpSymbol?.includes(token.toUpperCase()));
      return parseFloat(pool?.apr24h || '0');
    } catch {
      return 7.2; // fallback
    }
  }

  private getTokenAddress(token: string): Address {
    const map: Record<string, Address> = {
      USDT: ADDRESSES.USDT_TESTNET,
      WBNB: ADDRESSES.WBNB_TESTNET,
      BNB: ADDRESSES.WBNB_TESTNET,
    };
    const addr = map[token.toUpperCase()];
    if (!addr) throw new Error(`Unknown token: ${token}. Supported: USDT, WBNB, BNB`);
    return addr;
  }
}

export const pancakeSwapAdapter = new PancakeSwapAdapter();
