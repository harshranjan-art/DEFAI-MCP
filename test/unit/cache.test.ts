import { describe, it, expect, vi, beforeEach } from 'vitest';
import { TTLCache } from '../../src/core/scanner/cache';

describe('TTLCache', () => {
  let cache: TTLCache;

  beforeEach(() => {
    cache = new TTLCache();
  });

  it('get returns null for missing keys', () => {
    expect(cache.get('nonexistent')).toBeNull();
  });

  it('set and get within TTL', () => {
    cache.set('key1', { data: 'hello' }, 60_000);
    expect(cache.get('key1')).toEqual({ data: 'hello' });
  });

  it('expired entries return null', () => {
    vi.useFakeTimers();
    cache.set('key1', 'value', 1000);
    expect(cache.get('key1')).toBe('value');

    vi.advanceTimersByTime(1500);
    expect(cache.get('key1')).toBeNull();
    vi.useRealTimers();
  });

  it('has returns true for valid entries', () => {
    cache.set('key1', 'value', 60_000);
    expect(cache.has('key1')).toBe(true);
    expect(cache.has('missing')).toBe(false);
  });

  it('has returns false for expired entries', () => {
    vi.useFakeTimers();
    cache.set('key1', 'value', 1000);
    vi.advanceTimersByTime(1500);
    expect(cache.has('key1')).toBe(false);
    vi.useRealTimers();
  });

  it('invalidate removes a key', () => {
    cache.set('key1', 'value', 60_000);
    cache.invalidate('key1');
    expect(cache.get('key1')).toBeNull();
  });

  it('clear removes all keys', () => {
    cache.set('a', 1, 60_000);
    cache.set('b', 2, 60_000);
    cache.set('c', 3, 60_000);
    cache.clear();
    expect(cache.get('a')).toBeNull();
    expect(cache.get('b')).toBeNull();
    expect(cache.get('c')).toBeNull();
  });

  it('overwrites existing key', () => {
    cache.set('key1', 'first', 60_000);
    cache.set('key1', 'second', 60_000);
    expect(cache.get('key1')).toBe('second');
  });

  it('preserves type on get<T>', () => {
    cache.set('num', 42, 60_000);
    const result = cache.get<number>('num');
    expect(result).toBe(42);
  });
});
