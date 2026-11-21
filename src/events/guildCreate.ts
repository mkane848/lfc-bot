import type { Guild } from 'discord.js';
import { upsertServerConfig } from '../services/digest-state.js';
import { clearRemovalMarker } from '../services/listing-expiry.js';
import { refreshServerDigest } from '../services/scheduler.js';
import { getLogger } from '../utils/logger.js';

export function handleGuildCreate(guild: Guild): void {
  getLogger().info(`Joined guild ${guild.id} (${guild.name})`);
  clearRemovalMarker(guild.id);
  upsertServerConfig({ serverId: guild.id });
  // Leaving cancelled the digest job. A guild that re-adds the bot keeps its
  // settings, so its digest starts again (a new guild's is off, so no job).
  refreshServerDigest(guild.client, guild.id);
}
