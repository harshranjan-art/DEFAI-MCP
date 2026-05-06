import { describe, it, expect, afterEach } from 'vitest';
import { generateToken } from '../../src/api/middleware/auth';

describe('auth.generateToken — JWT_SECRET fail-fast', () => {
  const original = process.env.JWT_SECRET;

  afterEach(() => {
    if (original === undefined) delete process.env.JWT_SECRET;
    else process.env.JWT_SECRET = original;
  });

  it('throws when JWT_SECRET is missing', () => {
    delete process.env.JWT_SECRET;
    expect(() => generateToken('user-1')).toThrow(/JWT_SECRET env var is required/);
  });

  it('throws when JWT_SECRET is too short', () => {
    process.env.JWT_SECRET = 'short';
    expect(() => generateToken('user-1')).toThrow(/>= 32 chars/);
  });

  it('produces a token when JWT_SECRET is sufficiently long', () => {
    process.env.JWT_SECRET = 'x'.repeat(32);
    const token = generateToken('user-1');
    expect(typeof token).toBe('string');
    expect(token.split('.')).toHaveLength(3); // JWT has 3 dot-separated parts
  });
});
