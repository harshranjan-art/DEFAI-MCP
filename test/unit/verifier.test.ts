import { describe, it, expect, vi } from 'vitest';
import { verify, VERIFIER_GATED_TOOLS } from '../../src/bot/verifier';

/**
 * Tests inject a Groq stub via the `groqOverride` param so we never make
 * real network calls. The stub mimics the `chat.completions.create` shape
 * the real SDK returns.
 */
function stubGroq(responseContent: string) {
  return {
    chat: {
      completions: {
        create: vi.fn(async () => ({
          choices: [{ message: { content: responseContent } }],
        })),
      },
    },
  } as any;
}

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
    const groqOverride = stubGroq(
      JSON.stringify({ approve: true, confidence: 0.92, reason: 'args consistent', flags: [] }),
    );
    const v = await verify({
      toolName: 'swap_tokens',
      args: { fromToken: 'BNB', toToken: 'USDT', amount: '1.0' },
      userMessage: 'swap 1 BNB to USDT',
      marketContext: 'price BNB=$612, USDT=$1',
      groqOverride,
    });
    expect(v.approve).toBe(true);
    expect(v.confidence).toBe(0.92);
    expect(v.flags).toEqual([]);
  });

  it('passes a well-formed reject verdict through with flags', async () => {
    const groqOverride = stubGroq(
      JSON.stringify({
        approve: false,
        confidence: 0.9,
        reason: 'User said 1 BNB but args say 100 BNB',
        flags: ['consistency_violation', 'amount_unreasonable'],
      }),
    );
    const v = await verify({
      toolName: 'swap_tokens',
      args: { fromToken: 'BNB', toToken: 'USDT', amount: '100' },
      userMessage: 'swap 1 BNB to USDT',
      marketContext: 'BNB=$612',
      groqOverride,
    });
    expect(v.approve).toBe(false);
    expect(v.flags).toContain('consistency_violation');
    expect(v.reason).toContain('100');
  });
});

describe('verify — adversarial / malformed outputs default to reject', () => {
  it('rejects when verifier output is not valid JSON', async () => {
    const groqOverride = stubGroq('not json at all');
    const v = await verify({
      toolName: 'send_tokens',
      args: { token: 'USDT', amount: '100', toAddress: '0xabc' },
      userMessage: 'send 100 USDT',
      marketContext: '',
      groqOverride,
    });
    expect(v.approve).toBe(false);
    expect(v.flags).toContain('consistency_violation');
  });

  it("rejects when verifier output doesn't match schema (missing approve)", async () => {
    const groqOverride = stubGroq(JSON.stringify({ confidence: 0.5, reason: 'no approve field' }));
    const v = await verify({
      toolName: 'send_tokens',
      args: {},
      userMessage: 'send',
      marketContext: '',
      groqOverride,
    });
    expect(v.approve).toBe(false);
    expect(v.flags).toContain('consistency_violation');
  });

  it('rejects when an injected flags value is outside the allowed enum', async () => {
    const groqOverride = stubGroq(
      JSON.stringify({ approve: true, confidence: 1, reason: 'ok', flags: ['NUKE_LAUNCH'] }),
    );
    const v = await verify({
      toolName: 'swap_tokens',
      args: {},
      userMessage: '',
      marketContext: '',
      groqOverride,
    });
    expect(v.approve).toBe(false);
  });

  it('rejects an over-long reason (schema cap)', async () => {
    const groqOverride = stubGroq(
      JSON.stringify({
        approve: true,
        confidence: 1,
        reason: 'x'.repeat(500),
        flags: [],
      }),
    );
    const v = await verify({
      toolName: 'swap_tokens',
      args: {},
      userMessage: '',
      marketContext: '',
      groqOverride,
    });
    expect(v.approve).toBe(false);
  });
});

describe('verify — error handling', () => {
  it('fails open if the Groq call throws (logs warn, returns approve)', async () => {
    const groqOverride = {
      chat: {
        completions: {
          create: vi.fn(async () => { throw new Error('network unreachable'); }),
        },
      },
    } as any;
    const v = await verify({
      toolName: 'swap_tokens',
      args: {},
      userMessage: '',
      marketContext: '',
      groqOverride,
    });
    expect(v.approve).toBe(true);
    expect(v.reason).toContain('verifier unavailable');
  });
});
