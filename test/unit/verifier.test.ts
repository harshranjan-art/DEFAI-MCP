import { describe, it, expect } from 'vitest';
import { verify, VERIFIER_GATED_TOOLS } from '../../src/bot/verifier';
import { stubProvider } from '../../evals/helpers/mocks';

/**
 * Tests inject a stub LLMProvider via `providerOverride` so we never make
 * real network calls. The stub returns a canned chat response that the
 * verifier parses and validates against its zod schema.
 */

describe('VERIFIER_GATED_TOOLS set', () => {
  it('includes every write-action tool', () => {
    for (const t of [
      'swap_tokens',
      'send_tokens',
      'yield_deposit',
      'yield_rotate',
      'arb_execute',
      'delta_neutral_open',
      'start_arb_session',
    ]) {
      expect(VERIFIER_GATED_TOOLS.has(t)).toBe(true);
    }
  });

  it('excludes read-only tools', () => {
    expect(VERIFIER_GATED_TOOLS.has('scan_markets')).toBe(false);
    expect(VERIFIER_GATED_TOOLS.has('get_portfolio')).toBe(false);
    expect(VERIFIER_GATED_TOOLS.has('get_trade_history')).toBe(false);
  });
});

describe('verify — happy paths', () => {
  it('passes a well-formed approve verdict through', async () => {
    const providerOverride = stubProvider({
      content: JSON.stringify({ approve: true, confidence: 0.92, reason: 'args consistent', flags: [] }),
    });
    const v = await verify({
      toolName: 'swap_tokens',
      args: { fromToken: 'BNB', toToken: 'USDT', amount: '1.0' },
      userMessage: 'swap 1 BNB to USDT',
      marketContext: 'price BNB=$612, USDT=$1',
      providerOverride,
    });
    expect(v.approve).toBe(true);
    expect(v.confidence).toBe(0.92);
    expect(v.flags).toEqual([]);
  });

  it('passes a well-formed reject verdict through with flags', async () => {
    const providerOverride = stubProvider({
      content: JSON.stringify({
        approve: false,
        confidence: 0.9,
        reason: 'User said 1 BNB but args say 100 BNB',
        flags: ['consistency_violation', 'amount_unreasonable'],
      }),
    });
    const v = await verify({
      toolName: 'swap_tokens',
      args: { fromToken: 'BNB', toToken: 'USDT', amount: '100' },
      userMessage: 'swap 1 BNB to USDT',
      marketContext: 'BNB=$612',
      providerOverride,
    });
    expect(v.approve).toBe(false);
    expect(v.flags).toContain('consistency_violation');
    expect(v.reason).toContain('100');
  });
});

describe('verify — adversarial / malformed outputs default to reject', () => {
  it('rejects when verifier output is not valid JSON', async () => {
    const providerOverride = stubProvider({ content: 'not json at all' });
    const v = await verify({
      toolName: 'send_tokens',
      args: { token: 'USDT', amount: '100', toAddress: '0xabc' },
      userMessage: 'send 100 USDT',
      marketContext: '',
      providerOverride,
    });
    expect(v.approve).toBe(false);
    expect(v.flags).toContain('consistency_violation');
  });

  it("rejects when verifier output doesn't match schema (missing approve)", async () => {
    const providerOverride = stubProvider({
      content: JSON.stringify({ confidence: 0.5, reason: 'no approve field' }),
    });
    const v = await verify({
      toolName: 'send_tokens',
      args: {},
      userMessage: 'send',
      marketContext: '',
      providerOverride,
    });
    expect(v.approve).toBe(false);
    expect(v.flags).toContain('consistency_violation');
  });

  it('rejects when an injected flags value is outside the allowed enum', async () => {
    const providerOverride = stubProvider({
      content: JSON.stringify({ approve: true, confidence: 1, reason: 'ok', flags: ['NUKE_LAUNCH'] }),
    });
    const v = await verify({
      toolName: 'swap_tokens',
      args: {},
      userMessage: '',
      marketContext: '',
      providerOverride,
    });
    expect(v.approve).toBe(false);
  });

  it('rejects an over-long reason (schema cap)', async () => {
    const providerOverride = stubProvider({
      content: JSON.stringify({
        approve: true,
        confidence: 1,
        reason: 'x'.repeat(500),
        flags: [],
      }),
    });
    const v = await verify({
      toolName: 'swap_tokens',
      args: {},
      userMessage: '',
      marketContext: '',
      providerOverride,
    });
    expect(v.approve).toBe(false);
  });
});

describe('verify — error handling', () => {
  it('fails open if the LLM call throws (logs warn, returns approve)', async () => {
    const providerOverride = stubProvider({ throwError: 'network unreachable' });
    const v = await verify({
      toolName: 'swap_tokens',
      args: {},
      userMessage: '',
      marketContext: '',
      providerOverride,
    });
    expect(v.approve).toBe(true);
    expect(v.reason).toContain('verifier unavailable');
  });
});
