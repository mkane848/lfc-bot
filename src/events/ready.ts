import type { Client } from 'discord.js';
import { scheduleAllDigests, startMaintenance } from '../services/scheduler.js';
import { expireListings } from '../services/listing-expiry.js';
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
}
