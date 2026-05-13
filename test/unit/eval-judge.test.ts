import { describe, it, expect } from 'vitest';
import { judgeTrajectory } from '../../evals/helpers/judge';
import { stubProvider } from '../../evals/helpers/mocks';

describe('judgeTrajectory — happy paths', () => {
  it('parses a well-formed judge response', async () => {
    const providerOverride = stubProvider({
      content: JSON.stringify({
        tool_correctness: 3,
        argument_correctness: 3,
        step_efficiency: 2,
        rationale: 'optimal trajectory',
      }),
    });

    const s = await judgeTrajectory({
      user_input: 'show portfolio',
      captured_trajectory: [{ tool: 'get_portfolio', args: {} }],
      expected_trajectory: { tool_sequence: [{ name: 'get_portfolio', args_match: {} }] },
      response: 'Portfolio: empty.',
      providerOverride,
    });
    expect(s.tool_correctness).toBe(3);
    expect(s.argument_correctness).toBe(3);
    expect(s.step_efficiency).toBe(2);
    expect(s.rationale).toBe('optimal trajectory');
  });

  it('records a low-score judge verdict faithfully', async () => {
    const providerOverride = stubProvider({
      content: JSON.stringify({
        tool_correctness: 1,
        argument_correctness: 0,
        step_efficiency: 1,
        rationale: 'wrong tool',
      }),
    });
    const s = await judgeTrajectory({
      user_input: 'swap',
      captured_trajectory: [{ tool: 'get_portfolio', args: {} }],
      expected_trajectory: { tool_sequence: [{ name: 'swap_tokens', args_match: {} }] },
      response: '',
      providerOverride,
    });
    expect(s.tool_correctness).toBe(1);
    expect(s.argument_correctness).toBe(0);
  });
});

describe('judgeTrajectory — adversarial / malformed', () => {
  it('returns zero-score when judge returns non-JSON', async () => {
    const providerOverride = stubProvider({ content: 'not json' });
    const s = await judgeTrajectory({
      user_input: '',
      captured_trajectory: [],
      expected_trajectory: { tool_sequence: [] },
      response: '',
      providerOverride,
    });
    expect(s.tool_correctness).toBe(0);
    expect(s.rationale).toContain('judge unavailable');
  });

  it('returns zero-score when judge JSON misses required fields', async () => {
    const providerOverride = stubProvider({ content: JSON.stringify({ tool_correctness: 2 }) });
    const s = await judgeTrajectory({
      user_input: '',
      captured_trajectory: [],
      expected_trajectory: { tool_sequence: [] },
      response: '',
      providerOverride,
    });
    expect(s.tool_correctness).toBe(0);
  });

  it('returns zero-score when judge JSON values are out of range', async () => {
    const providerOverride = stubProvider({
      content: JSON.stringify({
        tool_correctness: 9,
        argument_correctness: 3,
        step_efficiency: 3,
        rationale: 'broken',
      }),
    });
    const s = await judgeTrajectory({
      user_input: '',
      captured_trajectory: [],
      expected_trajectory: { tool_sequence: [] },
      response: '',
      providerOverride,
    });
    expect(s.tool_correctness).toBe(0);
  });

  it('returns zero-score when the provider throws', async () => {
    const providerOverride = stubProvider({ throwError: 'network unreachable' });
    const s = await judgeTrajectory({
      user_input: '',
      captured_trajectory: [],
      expected_trajectory: { tool_sequence: [] },
      response: '',
      providerOverride,
    });
    expect(s.tool_correctness).toBe(0);
  });
});
