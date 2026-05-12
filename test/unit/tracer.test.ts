import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { startTrace, newTraceId, _resetForTest, shutdownTracer } from '../../src/observability/tracer';

describe('tracer no-op mode (default)', () => {
  beforeEach(() => {
    delete process.env.LANGFUSE_ENABLED;
    delete process.env.LANGFUSE_PUBLIC_KEY;
    delete process.env.LANGFUSE_SECRET_KEY;
    _resetForTest();
  });

  it('newTraceId returns a syntactically valid id', () => {
    const id = newTraceId();
    expect(id).toMatch(/^trc_[a-f0-9]+$/);
    expect(id.length).toBeGreaterThan(8);
    expect(newTraceId()).not.toBe(id);
  });

  it('startTrace returns a no-op span when disabled', () => {
    const span = startTrace({ trace_id: 'trc_x', surface: 'bot' });
    expect(span).toBeDefined();
    // No-op methods exist and don't throw
    span.end({ ok: true });
    const child = span.child('child');
    child.end();
    const gen = span.generation('planner.llm', { model: 'm' });
    gen.endWithUsage({ usage: { input_tokens: 100, output_tokens: 20 } });
  });

  it('durationMs reports a non-negative number', () => {
    const span = startTrace({ trace_id: 'trc_x', surface: 'bot' });
    expect(span.durationMs()).toBeGreaterThanOrEqual(0);
  });

  it('end is idempotent (calling twice does not throw)', () => {
    const span = startTrace({ trace_id: 'trc_x', surface: 'bot' });
    span.end({ ok: true });
    span.end({ ok: true }); // second call should be a no-op, not crash
  });

  it('shutdownTracer is safe to call even when disabled', async () => {
    await expect(shutdownTracer()).resolves.toBeUndefined();
  });
});

describe('tracer with LANGFUSE_ENABLED but missing keys', () => {
  beforeEach(() => {
    process.env.LANGFUSE_ENABLED = '1';
    delete process.env.LANGFUSE_PUBLIC_KEY;
    delete process.env.LANGFUSE_SECRET_KEY;
    _resetForTest();
  });

  afterEach(() => {
    delete process.env.LANGFUSE_ENABLED;
    _resetForTest();
  });

  it('still falls back to no-op (keys missing)', () => {
    const span = startTrace({ trace_id: 'trc_y', surface: 'bot' });
    span.end({ ok: true }); // must not throw
  });
});
