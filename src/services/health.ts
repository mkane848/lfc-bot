import * as http from 'node:http';
import type { Client } from 'discord.js';
import { getSqliteClient } from '../db/index.js';
import { getLogger } from '../utils/logger.js';

interface HealthStatus {
  status: 'ok' | 'degraded';
  discord: boolean;
  database: boolean;
  uptimeSeconds: number;
}

function checkDatabase(): boolean {
  try {
    getSqliteClient().prepare('SELECT 1').get();
    return true;
  } catch {
    return false;
  }
}

function buildStatus(client: Client): HealthStatus {
  const discord = client.isReady();
  const database = checkDatabase();
  return {
    status: discord && database ? 'ok' : 'degraded',
    discord,
    database,
    uptimeSeconds: Math.floor(process.uptime()),
  };
}

/**
 * Start a minimal HTTP server exposing GET /health for container healthchecks.
 * Returns 200 when Discord is connected and the database is reachable, 503
 * otherwise (e.g. during startup, before login resolves).
 */
export function startHealthServer(client: Client): http.Server {
  const port = Number(process.env.HEALTH_PORT ?? 3000);

  const server = http.createServer((req, res) => {
    if (req.method === 'GET' && req.url === '/health') {
      const body = buildStatus(client);
      res.writeHead(body.status === 'ok' ? 200 : 503, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(body));
      return;
    }
    res.writeHead(404, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'not found' }));
  });

  server.listen(port, () => {
    getLogger().info({ port }, 'Health check server listening');
  });

  return server;
}
