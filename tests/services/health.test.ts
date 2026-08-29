import type { AddressInfo } from 'node:net';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Client } from 'discord.js';
import { startHealthServer } from '../../src/services/health.js';
import { setupTestDb } from '../helpers/db.js';

setupTestDb();

afterEach(() => {
  vi.unstubAllEnvs();
});

function fakeClient(ready: boolean): Client {
  return { isReady: () => ready } as unknown as Client;
}

async function withServer(ready: boolean, run: (baseUrl: string) => Promise<void>): Promise<void> {
  vi.stubEnv('HEALTH_PORT', '0');
  const server = startHealthServer(fakeClient(ready));
  await new Promise<void>((resolve) => server.once('listening', resolve));
  const { port } = server.address() as AddressInfo;
  try {
    await run(`http://127.0.0.1:${port}`);
  } finally {
    server.close();
  }
}

describe('health server', () => {
  it('returns 200 and status ok when discord is ready and the database is reachable', async () => {
    await withServer(true, async (baseUrl) => {
      const res = await fetch(`${baseUrl}/health`);
      expect(res.status).toBe(200);
      const body = (await res.json()) as Record<string, unknown>;
      expect(body).toMatchObject({ status: 'ok', discord: true, database: true });
    });
  });

  it('returns 503 and status degraded when discord is not ready', async () => {
    await withServer(false, async (baseUrl) => {
      const res = await fetch(`${baseUrl}/health`);
      expect(res.status).toBe(503);
      const body = (await res.json()) as Record<string, unknown>;
      expect(body).toMatchObject({ status: 'degraded', discord: false });
    });
  });

  it('returns 404 for unknown paths', async () => {
    await withServer(true, async (baseUrl) => {
      const res = await fetch(`${baseUrl}/unknown`);
      expect(res.status).toBe(404);
    });
  });
});
