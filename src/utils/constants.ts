import type { Address } from 'viem';

// ─── BSC Testnet (Chain ID 97) Contract Addresses ───

export const ADDRESSES = {
  // Account Abstraction
  ENTRY_POINT_V07: '0x0000000071727De22E5E9d8BAf0edAc6f37da032' as Address,
  SIMPLE_ACCOUNT_FACTORY_V07: '0x91E60e0613810449d098b0b5Ec8b51A0FE8c8985' as Address,
  PIMLICO_PAYMASTER: '0x0000000000000039cd5e8aE05257CE51C473ddd1' as Address,

  // DeFi Protocols
  VENUS_VBNB: '0x2E7222e51c0f6e98610A1543Aa3836E092CDe62c' as Address,
  USDT_TESTNET: '0x337610d27c682E347C9cD60BD4b3b107C9d34dDd' as Address,
  PANCAKESWAP_V2_ROUTER: '0xD99D1c33F9fC3444f8101754aBC46c52416550D1' as Address,
  WBNB_TESTNET: '0xae13d989daC2f0dEbFf460aC112a837C89BAa7cd' as Address,
} as const;

// ─── ABIs ───

export const VENUS_VBNB_ABI = [
  { name: 'mint', type: 'function', inputs: [], outputs: [], stateMutability: 'payable' },
  {
    name: 'redeemUnderlying',
    type: 'function',
    inputs: [{ name: 'redeemAmount', type: 'uint256' }],
    outputs: [{ name: '', type: 'uint256' }],
    stateMutability: 'nonpayable',
  },
  {
    name: 'balanceOfUnderlying',
    type: 'function',
    inputs: [{ name: 'owner', type: 'address' }],
    outputs: [{ name: '', type: 'uint256' }],
    stateMutability: 'nonpayable',
  },
] as const;

export const ERC20_ABI = [
  {
    name: 'transfer',
    type: 'function',
    inputs: [
      { name: 'to', type: 'address' },
      { name: 'amount', type: 'uint256' },
    ],
    outputs: [{ name: '', type: 'bool' }],
    stateMutability: 'nonpayable',
  },
  {
    name: 'approve',
    type: 'function',
    inputs: [
      { name: 'spender', type: 'address' },
      { name: 'amount', type: 'uint256' },
    ],
    outputs: [{ name: '', type: 'bool' }],
    stateMutability: 'nonpayable',
  },
  {
    name: 'balanceOf',
    type: 'function',
    inputs: [{ name: 'account', type: 'address' }],
    outputs: [{ name: '', type: 'uint256' }],
    stateMutability: 'view',
  },
  {
    name: 'decimals',
    type: 'function',
    inputs: [],
    outputs: [{ name: '', type: 'uint8' }],
    stateMutability: 'view',
  },
] as const;

export const PANCAKE_ROUTER_V2_ABI = [
  {
    name: 'swapExactETHForTokens',
    type: 'function',
    inputs: [
      { name: 'amountOutMin', type: 'uint256' },
      { name: 'path', type: 'address[]' },
      { name: 'to', type: 'address' },
      { name: 'deadline', type: 'uint256' },
    ],
    outputs: [{ name: 'amounts', type: 'uint256[]' }],
    stateMutability: 'payable',
  },
  {
    name: 'swapExactTokensForETH',
    type: 'function',
    inputs: [
      { name: 'amountIn', type: 'uint256' },
      { name: 'amountOutMin', type: 'uint256' },
      { name: 'path', type: 'address[]' },
      { name: 'to', type: 'address' },
      { name: 'deadline', type: 'uint256' },
    ],
    outputs: [{ name: 'amounts', type: 'uint256[]' }],
    stateMutability: 'nonpayable',
  },
  {
    name: 'swapExactTokensForTokens',
    type: 'function',
    inputs: [
      { name: 'amountIn', type: 'uint256' },
      { name: 'amountOutMin', type: 'uint256' },
      { name: 'path', type: 'address[]' },
      { name: 'to', type: 'address' },
      { name: 'deadline', type: 'uint256' },
    ],
    outputs: [{ name: 'amounts', type: 'uint256[]' }],
    stateMutability: 'nonpayable',
  },
  {
    name: 'getAmountsOut',
    type: 'function',
    inputs: [
      { name: 'amountIn', type: 'uint256' },
      { name: 'path', type: 'address[]' },
    ],
    outputs: [{ name: 'amounts', type: 'uint256[]' }],
    stateMutability: 'view',
  },
] as const;

// ─── API Endpoints ───

export const API_URLS = {
  VENUS: 'https://api.venus.io/markets?chainId=56',
  PANCAKESWAP_FARMS: 'https://farms.pancakeswap.finance/v3/chains/56/apr',
  BEEFY_APY: 'https://api.beefy.finance/apy',
  BEEFY_VAULTS: 'https://api.beefy.finance/vaults',
  DEFILLAMA_YIELDS: 'https://yields.llama.fi/pools',
  COINGECKO_PRICE: 'https://api.coingecko.com/api/v3/simple/price',
  DEXSCREENER: 'https://api.dexscreener.com/latest/dex/tokens',
  BINANCE_FUNDING: 'https://fapi.binance.com/fapi/v1/fundingRate',
} as const;

// ─── Default Config ───

export const DEFAULT_RISK_CONFIG = {
  maxPositionUsd: 1000,
  maxSlippageBps: 50,
  stopLossPct: 5,
  maxTotalExposureUsd: 5000,
  allowedProtocols: [] as string[],
};

export const DEFAULT_ALERT_CONFIG = {
  apyDropThreshold: 0.5,
  priceMovePct: 5,
  arbMinSpreadBps: 30,
};

// ─── Pimlico ───

export function getPimlicoUrl(apiKey: string): string {
  return `https://api.pimlico.io/v2/97/rpc?apikey=${apiKey}`;
}
