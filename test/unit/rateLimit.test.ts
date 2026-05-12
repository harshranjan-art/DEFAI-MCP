import { describe, it, expect, beforeEach, vi } from 'vitest';
import express from 'express';
import request from 'supertest';
import { rateLimit, _resetRateLimitBuckets } from '../../src/api/middleware/rateLimit';

let supertestAvailable = true;
try {
  // Some environments don't have supertest installed; we skip these tests
  // rather than fail the whole suite.
  require.resolve('supertest');
} catch {
  supertestAvailable = false;
}

beforeEach(() => {
  _resetRateLimitBuckets();
  vi.useRealTimers();
});

function makeApp(opts: { windowMs: number; max: number }) {
  const app = express();
  app.use(express.json());
  app.post('/x', rateLimit(opts), (_req, res) => {
    res.json({ ok: true });
  });
  return app;
}

describe.skipIf(!supertestAvailable)('rateLimit middleware', () => {
  it('lets traffic through under the cap', async () => {
    const app = makeApp({ windowMs: 60_000, max: 3 });
    for (let i = 0; i < 3; i++) {
      const r = await request(app).post('/x').send({});
      expect(r.status).toBe(200);
    }
  });

  it('returns 429 + Retry-After once the cap is hit', async () => {
    const app = makeApp({ windowMs: 60_000, max: 2 });
    await request(app).post('/x').send({});
    await request(app).post('/x').send({});
    const blocked = await request(app).post('/x').send({});
    expect(blocked.status).toBe(429);
    expect(blocked.headers['retry-after']).toBeDefined();
    expect(blocked.body.error).toBe('rate_limited');
    expect(typeof blocked.body.retry_after_ms).toBe('number');
  });

  it('keys on (ip, path) so different paths get separate buckets', async () => {
    const app = express();
    app.use(express.json());
    app.post('/a', rateLimit({ windowMs: 60_000, max: 1 }), (_req, res) => res.json({ ok: 'a' }));
    app.post('/b', rateLimit({ windowMs: 60_000, max: 1 }), (_req, res) => res.json({ ok: 'b' }));
    expect((await request(app).post('/a').send({})).status).toBe(200);
    expect((await request(app).post('/b').send({})).status).toBe(200);
    expect((await request(app).post('/a').send({})).status).toBe(429);
  });

  it('resets after windowMs elapses', async () => {
    const app = makeApp({ windowMs: 1000, max: 1 });
    expect((await request(app).post('/x').send({})).status).toBe(200);
    expect((await request(app).post('/x').send({})).status).toBe(429);
    // Wait > windowMs and verify reset
    await new Promise((r) => setTimeout(r, 1100));
    expect((await request(app).post('/x').send({})).status).toBe(200);
  });

  it('honors a custom keyFn (rate-limit per-user instead of per-IP)', async () => {
    const app = express();
    app.use(express.json());
    app.post(
      '/x',
      rateLimit({
        windowMs: 60_000,
        max: 1,
        keyFn: (req) => `user:${req.body.user}`,
      }),
      (_req, res) => res.json({ ok: true }),
    );
    expect((await request(app).post('/x').send({ user: 'alice' })).status).toBe(200);
    expect((await request(app).post('/x').send({ user: 'bob' })).status).toBe(200);
    expect((await request(app).post('/x').send({ user: 'alice' })).status).toBe(429);
  });
});
