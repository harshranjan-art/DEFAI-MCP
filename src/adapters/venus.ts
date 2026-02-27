import { encodeFunctionData, parseEther } from 'viem';
import type { Address } from 'viem';
import type { ProtocolAdapter, TxResult } from './types';
import { ADDRESSES, VENUS_VBNB_ABI, API_URLS } from '../utils/constants';
import { logger } from '../utils/logger';

class VenusAdapter implements ProtocolAdapter {
  name = 'Venus';
  isSimulated = false; // Real testnet execution

  /**
   * Supply BNB to Venus vBNB (calls mint payable).
   */
  async supply(token: string, amount: string, client: any, publicClient: any): Promise<TxResult> {
    try {
      const data = encodeFunctionData({
        abi: VENUS_VBNB_ABI,
        functionName: 'mint',
      });

      logger.info('Venus: depositing %s BNB to vBNB...', amount);

      const txHash = await client.sendTransaction({
        to: ADDRESSES.VENUS_VBNB,
        data,
        value: parseEther(amount),
      });

      logger.info('Venus: tx submitted %s', txHash);

      await publicClient.waitForTransactionReceipt({ hash: txHash });

      logger.info('Venus: tx confirmed %s', txHash);

      return {
        txHash,
        success: true,
        explorerUrl: `https://testnet.bscscan.com/tx/${txHash}`,
      };
    } catch (e: any) {
      logger.error('Venus supply failed: %s', e.message);
      return { txHash: '', success: false, error: e.message };
    }
  }

  /**
   * Withdraw BNB from Venus vBNB (calls redeemUnderlying).
   */
  async withdraw(token: string, amount: string, client: any, publicClient: any): Promise<TxResult> {
    try {
      const data = encodeFunctionData({
        abi: VENUS_VBNB_ABI,
        functionName: 'redeemUnderlying',
        args: [parseEther(amount)],
      });

      logger.info('Venus: withdrawing %s BNB from vBNB...', amount);

      const txHash = await client.sendTransaction({
        to: ADDRESSES.VENUS_VBNB,
        data,
      });

      await publicClient.waitForTransactionReceipt({ hash: txHash });

      logger.info('Venus: withdrawal confirmed %s', txHash);

      return {
        txHash,
        success: true,
        explorerUrl: `https://testnet.bscscan.com/tx/${txHash}`,
      };
    } catch (e: any) {
      logger.error('Venus withdraw failed: %s', e.message);
      return { txHash: '', success: false, error: e.message };
    }
  }

  /**
   * Get Venus BNB supply APY from API.
   */
  async getApy(token: string): Promise<number> {
    try {
      const res = await fetch(API_URLS.VENUS, { signal: AbortSignal.timeout(5000) });
      const json = await res.json() as any;
      const markets: any[] = json?.data?.markets ?? json?.markets ?? [];
      const market = markets.find((m: any) =>
        m.underlyingSymbol?.toUpperCase() === token.toUpperCase()
      );
      const apy = parseFloat(market?.supplyApy ?? '0');
      return apy > 0 ? apy : 3.8;
    } catch {
      return 3.8; // fallback
    }
  }

  /**
   * Get BNB balance of an address.
   */
  async getBalance(token: string, address: Address, publicClient: any): Promise<string> {
    const balance = await publicClient.getBalance({ address });
    return (Number(balance) / 1e18).toString();
  }
}

export const venusAdapter = new VenusAdapter();
