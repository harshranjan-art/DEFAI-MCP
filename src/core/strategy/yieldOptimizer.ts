import { getYields, getYieldsForToken } from '../scanner/apyAggregator';
import * as walletManager from '../walletManager';
import * as positionTracker from '../positionTracker';
import * as tradeLogger from '../tradeLogger';
import { venusAdapter } from '../../adapters/venus';
import { logger } from '../../utils/logger';
import type { DepositResult, RotationPlan } from './types';

/**
 * Deposit into the best (or forced) yield protocol.
 * Currently only Venus has real testnet execution; others are simulated.
 */
export async function deposit(
  userId: string,
  token: string,
  amount: string,
  forceProtocol?: string,
): Promise<DepositResult> {
  // 1. Get all yields for this token
  const yields = await getYieldsForToken(token);
  if (yields.length === 0) {
    return {
      success: false,
      message: `No yield opportunities found for ${token}`,
      protocol: '',
      apy: 0,
      amount,
      token,
      alternatives: [],
    };
  }

  // 2. Pick target
  const target = forceProtocol
    ? yields.find(y => y.protocol.toLowerCase() === forceProtocol.toLowerCase()) || yields[0]
    : yields[0];

  // 3. Check wallet balance
  const { client, publicClient, address } = walletManager.getClient(userId);
  const balance = await venusAdapter.getBalance!(token, address, publicClient);
  if (parseFloat(balance) < parseFloat(amount)) {
    return {
      success: false,
      message: `Insufficient balance: ${balance} ${token} available, ${amount} ${token} needed. Fund your smart account: ${address}`,
      protocol: target.protocol,
      apy: target.apy,
      amount,
      token,
      alternatives: yields.slice(1, 4).map(y => ({ protocol: y.protocol, apy: y.apy, isSimulated: y.isSimulated })),
    };
  }

  // 4. Execute deposit
  let txHash: string;
  if (target.protocol === 'Venus' && !target.isSimulated) {
    const result = await venusAdapter.supply(token, amount, client, publicClient);
    if (!result.success) {
      return {
        success: false,
        message: `Venus deposit failed: ${result.error}`,
        protocol: target.protocol,
        apy: target.apy,
        amount,
        token,
        alternatives: [],
      };
    }
    txHash = result.txHash;
  } else {
    // Simulated deposit for non-testnet protocols
    txHash = `0xsim_${Date.now().toString(16)}`;
    logger.info('Simulated deposit on %s (no testnet contract)', target.protocol);
  }

  // 5. Track position
  const position = positionTracker.openPosition({
    user_id: userId,
    type: 'yield',
    protocol: target.protocol,
    token,
    amount,
    entry_apy: target.apy,
    tx_hash: txHash,
    metadata: { pool: target.pool, source: target.source, isSimulated: target.isSimulated },
  });

  // 6. Log trade
  tradeLogger.logTrade({
    user_id: userId,
    type: 'deposit',
    protocol: target.protocol,
    to_token: token,
    to_amount: amount,
    tx_hash: txHash,
    position_id: position.id,
  });

  return {
    success: true,
    message: `Deposited ${amount} ${token} into ${target.protocol} at ${target.apy.toFixed(2)}% APY`,
    positionId: position.id,
    txHash,
    protocol: target.protocol,
    apy: target.apy,
    amount,
    token,
    alternatives: yields.slice(1, 4).map(y => ({ protocol: y.protocol, apy: y.apy, isSimulated: y.isSimulated })),
  };
}

/**
 * Check if a position should be rotated to a higher-APY protocol.
 */
export async function shouldRotate(
  positionId: string,
  minImprovementBps: number = 50,
): Promise<RotationPlan | null> {
  const pos = positionTracker.getPosition(positionId);
  if (!pos || pos.status !== 'open') return null;

  const yields = await getYieldsForToken(pos.token);
  const best = yields[0]; // Already sorted by APY desc
  if (!best) return null;

  const currentApy = pos.entry_apy || 0;
  const improvementBps = (best.apy - currentApy) * 100;

  if (improvementBps < minImprovementBps) return null;

  return {
    currentProtocol: pos.protocol,
    currentApy,
    targetProtocol: best.protocol,
    targetApy: best.apy,
    improvementBps: Math.round(improvementBps),
    netBenefit: `+${(improvementBps / 100).toFixed(2)}% APY`,
    estimatedGasCost: '0 (gasless via Pimlico)',
  };
}

/**
 * Execute a yield rotation: withdraw from current protocol, deposit into higher-APY protocol.
 */
export async function rotate(
  userId: string,
  positionId: string,
  minImprovementBps?: number,
): Promise<DepositResult> {
  const plan = await shouldRotate(positionId, minImprovementBps);
  if (!plan) {
    return {
      success: false,
      message: 'No profitable rotation found — current position is optimal or improvement below threshold',
      protocol: '',
      apy: 0,
      amount: '0',
      token: '',
      alternatives: [],
    };
  }

  const pos = positionTracker.getPosition(positionId)!;
  const { client, publicClient } = walletManager.getClient(userId);

  // 1. Withdraw from current
  if (pos.protocol === 'Venus' && !pos.metadata?.isSimulated) {
    const withdrawResult = await venusAdapter.withdraw!(pos.token, pos.amount, client, publicClient);
    if (!withdrawResult.success) {
      return {
        success: false,
        message: `Withdrawal from ${pos.protocol} failed: ${withdrawResult.error}`,
        protocol: pos.protocol,
        apy: pos.entry_apy || 0,
        amount: pos.amount,
        token: pos.token,
        alternatives: [],
      };
    }
    tradeLogger.logTrade({
      user_id: userId,
      type: 'withdraw',
      protocol: pos.protocol,
      from_token: pos.token,
      from_amount: pos.amount,
      tx_hash: withdrawResult.txHash,
      position_id: pos.id,
    });
  }

  // 2. Close old position
  positionTracker.closePosition(positionId);

  // 3. Deposit into new protocol
  return deposit(userId, pos.token, pos.amount, plan.targetProtocol);
}
