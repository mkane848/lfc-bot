import type { Client } from 'discord.js';
import {
  scheduleAllDigests,
  startMaintenance,
  startSealedCatalogSync,
} from '../services/scheduler.js';
import { expireListings } from '../services/listing-expiry.js';
import { isSealedCatalogStale, syncSealedCatalog } from '../services/sealed.js';
import { upsertServerConfig } from '../services/digest-state.js';
import { getLogger } from '../utils/logger.js';

export function handleReady(client: Client): void {
  const logger = getLogger();
  logger.info(`Logged in as ${client.user?.tag ?? 'unknown'}`);

  // Seed a config row for every guild the bot currently belongs to, then run
  // an initial expiry pass and schedule per-server digest jobs.
  for (const guild of client.guilds.cache.values()) {
    upsertServerConfig({ serverId: guild.id });
  }
  expireListings();
  scheduleAllDigests(client);
  startMaintenance();
  startSealedCatalogSync();

  // Fire-and-forget warm-up: only sync if the catalog is missing or stale, so
  // a restart doesn't re-download an already-fresh catalog. Boot must not
  // block on this, and a rejection here must never become an unhandled
  // rejection — `syncSealedCatalog` already catches and logs its own
  // failures, but the `catch` below guards against any future change to that
  // contract.
  if (isSealedCatalogStale()) {
    void syncSealedCatalog().catch((err: unknown) => {
      logger.error({ err }, 'Sealed catalog warm-up sync failed');
    });
  }
}
