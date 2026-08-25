import type { Guild } from 'discord.js';
import { upsertServerConfig } from '../services/digest-state.js';
import { clearRemovalMarker } from '../services/listing-expiry.js';
import { getLogger } from '../utils/logger.js';

export function handleGuildCreate(guild: Guild): void {
  getLogger().info(`Joined guild ${guild.id} (${guild.name})`);
  clearRemovalMarker(guild.id);
  upsertServerConfig({ serverId: guild.id });
}
