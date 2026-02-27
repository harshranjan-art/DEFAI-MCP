import { describe, it, expect } from 'vitest';
import { app } from '../../src/api/server';
import http from 'http';

// Simple test helper to make requests to the Express app without supertest
function request(
  app: any,
  method: string,
  path: string,
  headers: Record<string, string> = {},
): Promise<{ status: number; body: any }> {
  return new Promise((resolve, reject) => {
    const server = app.listen(0, () => {
      const port = (server.address() as any).port;
      const req = http.request(
        { hostname: '127.0.0.1', port, path, method, headers },
        (res) => {
          let data = '';
          res.on('data', (chunk: string) => (data += chunk));
          res.on('end', () => {
            server.close();
            try {
              resolve({ status: res.statusCode!, body: JSON.parse(data) });
            } catch {
              resolve({ status: res.statusCode!, body: data });
            }
          });
        },
      );
      req.on('error', (err) => {
        server.close();
        reject(err);
      });
      req.end();
    });
  });
}

describe('API server', () => {
  it('GET /api/health returns 200 with status ok', async () => {
    const res = await request(app, 'GET', '/api/health');
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('ok');
    expect(res.body.service).toBe('defai-api');
    expect(res.body.chain).toBe('BSC Testnet (97)');
    expect(res.body.version).toBe('1.0.0');
    expect(typeof res.body.uptime).toBe('number');
  });

  it('GET /api/portfolio returns 401 without auth', async () => {
    const res = await request(app, 'GET', '/api/portfolio');
    expect(res.status).toBe(401);
  });

  it('GET /api/trades returns 401 without auth', async () => {
    const res = await request(app, 'GET', '/api/trades');
    expect(res.status).toBe(401);
  });
});
