export interface StrategyResult {
  success: boolean;
  message: string;
  positionId?: string;
  txHash?: string;
  data?: Record<string, any>;
}

export interface DepositResult extends StrategyResult {
  protocol: string;
  apy: number;
  amount: string;
  token: string;
  alternatives: { protocol: string; apy: number; isSimulated: boolean }[];
}

export interface RotationPlan {
  currentProtocol: string;
  currentApy: number;
  targetProtocol: string;
  targetApy: number;
  improvementBps: number;
  netBenefit: string;
  estimatedGasCost: string;
}

export interface DeltaPosition {
  spotEntry: number;
  spotAmount: number;
  shortEntry: number;
  shortSize: string;
  fundingRate: number;
  isSimulated: boolean;
}

export interface ArbOpportunity {
  id: string;
  token: string;
  buyDex: string;
  buyPrice: number;
  sellDex: string;
  sellPrice: number;
  spreadBps: number;
  estimatedProfitUsd: number;
  viable: boolean;
}
