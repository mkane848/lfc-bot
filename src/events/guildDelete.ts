import type { Guild } from 'discord.js';
import { markServerForRemoval } from '../services/listing-expiry.js';
import { removeServerDigest } from '../services/scheduler.js';
import { getServerConfig } from '../services/digest-state.js';
import { getLogger } from '../utils/logger.js';

export function handleGuildDelete(guild: Guild): void {
  getLogger().info(`Left guild ${guild.id} (${guild.name}); marking for removal`);
  removeServerDigest(guild.id);
  if (getServerConfig(guild.id)) {
    markServerForRemoval(guild.id);
  }
}
