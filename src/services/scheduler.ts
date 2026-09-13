import cron, { type ScheduledTask } from 'node-cron';
import type { Client } from 'discord.js';
import {
  getServerConfig,
  initializeWatermarkIfNeeded,
  listScheduledServers,
} from './digest-state.js';
import { runDigest } from './digest.js';
import { expireListings, purgeMarkedServers } from './listing-expiry.js';
import { pruneExpiredCardCache } from './card-cache.js';
import { syncSealedCatalog } from './sealed.js';
import { GUILD_RETENTION_MS } from '../utils/constants.js';

const jobs = new Map<string, ScheduledTask>();
let maintenanceTask: ScheduledTask | null = null;
let sealedTask: ScheduledTask | null = null;

/**
 * Schedule digest jobs for every server with an active delivery mode. Called
 * once on startup after the database has migrated.
 */
export function scheduleAllDigests(client: Client): void {
  const servers = listScheduledServers();
  for (const server of servers) {
    initializeWatermarkIfNeeded(server);
    createJob(client, server.id);
  }
}

/**
 * Re-read a server's config and rebuild its cron job. Call this after any
 * admin digest configuration change. Initializes the watermark when the mode
 * transitions from disabled to active.
 */
export function refreshServerDigest(client: Client, serverId: string): void {
  cancelJob(serverId);
  const server = getServerConfig(serverId);
  if (!server || server.digestMode === 'disabled') {
    return;
  }
  initializeWatermarkIfNeeded(server);
  createJob(client, serverId);
}

/** Remove a server's cron job entirely (guild removal or mode disabled). */
export function removeServerDigest(serverId: string): void {
  cancelJob(serverId);
}

/**
 * Start the periodic maintenance job that expires listings, prunes the card
 * cache, and purges servers whose removal retention window elapsed.
 */
export function startMaintenance(): void {
  if (maintenanceTask) {
    return;
  }
  maintenanceTask = cron.schedule(
    '0 * * * *',
    () => {
      expireListings();
      pruneExpiredCardCache();
      purgeMarkedServers(GUILD_RETENTION_MS);
    },
    { timezone: 'UTC' },
  );
}

/**
 * Start the daily sealed-catalog sync job.
 *
 * Runs at 16:00 UTC rather than the more obvious 14:00: MTGJSON's build goes
 * live around 09:00 ET, and 14:00 UTC is 09:00 EST in winter — right on that
 * boundary. 16:00 UTC is 11:00 EST / 12:00 EDT, safely clear of the build
 * year-round regardless of DST.
 */
export function startSealedCatalogSync(): void {
  if (sealedTask) {
    return;
  }
  sealedTask = cron.schedule(
    '0 16 * * *',
    () => {
      // `syncSealedCatalog` catches and logs its own failures, but guard the
      // rejection here too: an unhandled one would reach the process-level
      // handler in `src/index.ts` and fire a critical alert for what is only
      // a skipped catalog refresh.
      void syncSealedCatalog().catch(() => undefined);
    },
    { timezone: 'UTC' },
  );
}

/** Cancel all cron jobs. Called during graceful shutdown. */
export function stopAllJobs(): void {
  for (const id of [...jobs.keys()]) {
    cancelJob(id);
  }
  if (maintenanceTask) {
    void maintenanceTask.stop();
    maintenanceTask = null;
  }
  if (sealedTask) {
    void sealedTask.stop();
    sealedTask = null;
  }
}

function createJob(client: Client, serverId: string): void {
  cancelJob(serverId);
  const server = getServerConfig(serverId);
  if (!server || server.digestMode === 'disabled') {
    return;
  }
  const expression = server.digestCron || '0 9 * * *';
  if (!cron.validate(expression)) {
    return;
  }
  const task = cron.schedule(
    expression,
    () => {
      void runScheduledDigest(client, serverId);
    },
    { timezone: server.digestTimezone || 'UTC' },
  );
  jobs.set(serverId, task);
}

async function runScheduledDigest(client: Client, serverId: string): Promise<void> {
  const latest = getServerConfig(serverId);
  if (!latest || latest.digestMode === 'disabled') {
    return;
  }
  await runDigest(client, latest, 'scheduled');
}

function cancelJob(serverId: string): void {
  const task = jobs.get(serverId);
  if (task) {
    void task.stop();
    jobs.delete(serverId);
  }
}
