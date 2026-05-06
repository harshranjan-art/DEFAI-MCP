import { describe, it, expect } from 'vitest';
import { formatEngineResult } from '../../src/core/format';
import { ok, err, needsConfirmation } from '../../src/core/result';

describe('formatEngineResult', () => {
  it('renders the success arm via formatSuccess', () => {
    const r = ok({ tx: '0xabc' }, 'trc_x');
    const text = formatEngineResult(r, (d) => `tx=${d.tx}`);
    expect(text).toBe('tx=0xabc');
  });

  it('renders the error arm with code and message', () => {
    const r = err('VALIDATION_ERROR', 'amount required', 'trc_x');
    const text = formatEngineResult(r, () => 'unused');
    expect(text).toContain('Error [VALIDATION_ERROR]');
    expect(text).toContain('amount required');
  });

  it('renders the needsConfirmation arm with token and preview', () => {
    const r = needsConfirmation(
      {
        action: 'swap_tokens',
        preview: { from: 'BNB', amount: '1' },
        confirmation_token: 'cfm_' + '0'.repeat(32),
        expires_at: '2099-01-01T00:00:00.000Z',
      },
      'trc_x',
    );
    const text = formatEngineResult(r, () => 'unused');
    expect(text).toContain('Confirmation required for swap_tokens');
    expect(text).toContain('cfm_' + '0'.repeat(32));
    expect(text).toContain('"from": "BNB"');
    expect(text).toContain('Token expires at 2099-01-01T00:00:00.000Z');
  });
});
