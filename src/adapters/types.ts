import type { Address } from 'viem';

export interface TxResult {
  txHash: string;
  success: boolean;
  gasUsed?: string;
  error?: string;
  explorerUrl?: string;
}

export interface PriceQuote {
  dex: string;
  fromToken: string;
  toToken: string;
  amountIn: string;
  amountOut: string;
  effectivePrice: number;
  priceImpact: number;
}

export interface ProtocolAdapter {
  name: string;
  isSimulated: boolean;

  supply?(token: string, amount: string, client: any, publicClient: any): Promise<TxResult>;
  withdraw?(token: string, amount: string, client: any, publicClient: any): Promise<TxResult>;
  swap?(from: string, to: string, amount: string, client: any, publicClient: any): Promise<TxResult>;
  getQuote?(from: string, to: string, amount: string): Promise<PriceQuote>;
  getApy?(token: string): Promise<number>;
  getBalance?(token: string, address: Address, publicClient: any): Promise<string>;
}
