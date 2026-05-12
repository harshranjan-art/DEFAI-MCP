import { describe, it, expect } from 'vitest';
import { summarizeMessages } from '../../src/bot/summarizer';
import { stubGroq } from '../../evals/helpers/mocks';

describe('summarizeMessages — happy paths', () => {
  it('returns the canonical summary content from Groq', async () => {
    const groqOverride = stubGroq({ content: '- prefers Venus over Beefy\n- 0.5 BNB deposited on 2026-05-01' });
    const r = await summarizeMessages(
      [
        { role: 'user', content: 'I want low-risk yield' },
        { role: 'assistant', content: 'Picked Venus' },
      ],
      { groqOverride },
    );
    expect(r).toContain('prefers Venus');
  });

  it('trims surrounding whitespace', async () => {
    const groqOverride = stubGroq({ content: '   - bullet one   \n' });
    const r = await summarizeMessages(
      [{ role: 'user', content: 'hello' }],
      { groqOverride },
    );
    expect(r).toBe('- bullet one');
  });

  it('returns empty string for empty input (short-circuit before the call)', async () => {
    // No groqOverride needed since the function exits before any LLM call.
    const r = await summarizeMessages([]);
    expect(r).toBe('');
  });
});

describe('summarizeMessages — fail-soft', () => {
  it('returns null when Groq throws (caller falls back to truncation)', async () => {
    const groqOverride = {
      chat: {
        completions: {
          create: async () => { throw new Error('network unreachable'); },
        },
      },
    } as any;
    const r = await summarizeMessages(
      [{ role: 'user', content: 'hello' }],
      { groqOverride },
    );
    expect(r).toBeNull();
  });

  it('returns null when Groq returns empty content', async () => {
    const groqOverride = stubGroq({ content: '' });
    const r = await summarizeMessages(
      [{ role: 'user', content: 'hello' }],
      { groqOverride },
    );
    expect(r).toBeNull();
  });

  it('returns null when Groq returns only whitespace', async () => {
    const groqOverride = stubGroq({ content: '   \n\t  ' });
    const r = await summarizeMessages(
      [{ role: 'user', content: 'hello' }],
      { groqOverride },
    );
    expect(r).toBeNull();
  });
});
