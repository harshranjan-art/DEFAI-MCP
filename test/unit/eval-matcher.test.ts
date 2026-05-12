import { describe, it, expect } from 'vitest';
import { matchTrajectory, type CapturedStep, type ExpectedTrajectory } from '../../evals/helpers/matcher';

function expected(over: Partial<ExpectedTrajectory> = {}): ExpectedTrajectory {
  return {
    tool_sequence: [{ name: 'get_portfolio', args_match: {} }],
    must_not_call: ['swap_tokens'],
    max_steps: 2,
    ...over,
  };
}

describe('matchTrajectory — structural matching', () => {
  it('passes when actual matches expected exactly', () => {
    const actual: CapturedStep[] = [{ tool: 'get_portfolio', args: {} }];
    const r = matchTrajectory(actual, expected(), 'Portfolio: empty.', []);
    expect(r.passed).toBe(true);
    expect(r.failures).toEqual([]);
  });

  it('fails on wrong tool at step 0', () => {
    const actual: CapturedStep[] = [{ tool: 'swap_tokens', args: {} }];
    const r = matchTrajectory(actual, expected(), '', []);
    expect(r.passed).toBe(false);
    // Two failures: banned tool + wrong tool name in sequence
    expect(r.failures.some((f) => f.includes('banned tool called'))).toBe(true);
  });

  it('fails when a banned tool is called', () => {
    const actual: CapturedStep[] = [
      { tool: 'get_portfolio', args: {} },
      { tool: 'swap_tokens', args: { from_token: 'BNB', to_token: 'USDT', amount: '1.0' } },
    ];
    const r = matchTrajectory(actual, expected(), '', []);
    expect(r.passed).toBe(false);
    expect(r.failures.some((f) => f.includes('swap_tokens'))).toBe(true);
  });

  it('fails when step count exceeds max_steps', () => {
    const actual: CapturedStep[] = [
      { tool: 'get_portfolio', args: {} },
      { tool: 'get_trade_history', args: {} },
      { tool: 'get_alerts', args: {} },
    ];
    const r = matchTrajectory(actual, expected({ max_steps: 2 }), '', []);
    expect(r.passed).toBe(false);
    expect(r.failures.some((f) => f.includes('exceeds max'))).toBe(true);
  });

  it('matches args_match values exactly', () => {
    const exp = expected({
      tool_sequence: [
        { name: 'scan_markets', args_match: { category: 'yield' } },
      ],
    });
    expect(matchTrajectory([{ tool: 'scan_markets', args: { category: 'yield' } }], exp, '').passed).toBe(true);
    expect(matchTrajectory([{ tool: 'scan_markets', args: { category: 'prices' } }], exp, '').passed).toBe(false);
  });

  it('allows any-of values via an array in args_match', () => {
    const exp = expected({
      tool_sequence: [
        { name: 'scan_markets', args_match: { category: ['yield', 'all'] } },
      ],
    });
    expect(matchTrajectory([{ tool: 'scan_markets', args: { category: 'yield' } }], exp, '').passed).toBe(true);
    expect(matchTrajectory([{ tool: 'scan_markets', args: { category: 'all' } }], exp, '').passed).toBe(true);
    expect(matchTrajectory([{ tool: 'scan_markets', args: { category: 'prices' } }], exp, '').passed).toBe(false);
  });

  it('rejects unexpected args not in args_extra_allowed', () => {
    const exp = expected({
      tool_sequence: [{ name: 'get_portfolio', args_match: {} }],
    });
    const r = matchTrajectory([{ tool: 'get_portfolio', args: { extra: 'whoops' } }], exp, '');
    expect(r.passed).toBe(false);
    expect(r.failures.some((f) => f.includes('unexpected arg'))).toBe(true);
  });

  it('accepts extras when listed in args_extra_allowed', () => {
    const exp = expected({
      tool_sequence: [
        { name: 'get_portfolio', args_match: {}, args_extra_allowed: ['extra'] },
      ],
    });
    const r = matchTrajectory([{ tool: 'get_portfolio', args: { extra: 'fine' } }], exp, '');
    expect(r.passed).toBe(true);
  });

  it('checks expected_response_keywords case-insensitively', () => {
    const actual: CapturedStep[] = [{ tool: 'get_portfolio', args: {} }];
    expect(matchTrajectory(actual, expected(), 'Your PORTFOLIO is empty', ['portfolio']).passed).toBe(true);
    expect(matchTrajectory(actual, expected(), 'Nothing here', ['portfolio']).passed).toBe(false);
  });

  it('fails when too few tool calls in sequence', () => {
    const exp = expected({
      tool_sequence: [
        { name: 'scan_markets', args_match: {} },
        { name: 'yield_deposit', args_match: {} },
      ],
    });
    const r = matchTrajectory([{ tool: 'scan_markets', args: {} }], exp, '');
    expect(r.passed).toBe(false);
    expect(r.failures.some((f) => f.includes('not enough tool calls'))).toBe(true);
  });
});
