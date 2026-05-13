import { describe, it, expect } from 'vitest';
import { summarizeMessages } from '../../src/bot/summarizer';
import { stubProvider } from '../../evals/helpers/mocks';

describe('summarizeMessages — happy paths', () => {
  it('returns the canonical summary content from the provider', async () => {
    const providerOverride = stubProvider({
      content: '- prefers Venus over Beefy\n- 0.5 BNB deposited on 2026-05-01',
    });
    const r = await summarizeMessages(
      [
        { role: 'user', content: 'I want low-risk yield' },
        { role: 'assistant', content: 'Picked Venus' },
      ],
      { providerOverride },
    );
    expect(r).toContain('prefers Venus');
  });

  it('trims surrounding whitespace', async () => {
    const providerOverride = stubProvider({ content: '   - bullet one   \n' });
    const r = await summarizeMessages(
      [{ role: 'user', content: 'hello' }],
      { providerOverride },
    );
    expect(r).toBe('- bullet one');
  });

  it('returns empty string for empty input (short-circuit before the call)', async () => {
    // No providerOverride needed since the function exits before any LLM call.
    const r = await summarizeMessages([]);
    expect(r).toBe('');
  });
});

describe('summarizeMessages — fail-soft', () => {
  it('returns null when the provider throws (caller falls back to truncation)', async () => {
    const providerOverride = stubProvider({ throwError: 'network unreachable' });
    const r = await summarizeMessages(
      [{ role: 'user', content: 'hello' }],
      { providerOverride },
    );
    expect(r).toBeNull();
  });

  it('returns null when the provider returns empty content', async () => {
    const providerOverride = stubProvider({ content: '' });
    const r = await summarizeMessages(
      [{ role: 'user', content: 'hello' }],
      { providerOverride },
    );
    expect(r).toBeNull();
  });

  it('returns null when the provider returns only whitespace', async () => {
    const providerOverride = stubProvider({ content: '   \n\t  ' });
    const r = await summarizeMessages(
      [{ role: 'user', content: 'hello' }],
      { providerOverride },
    );
    expect(r).toBeNull();
  });
});
