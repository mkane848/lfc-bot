import type { ChatInputCommandInteraction } from 'discord.js';
import { getServerConfig, upsertServerConfig } from '../../services/digest-state.js';
import type { ServerRow } from '../../db/schema.js';
import { replyError } from '../../utils/replies.js';

/** Resolve the guild id for an admin interaction or reply and bail. */
export function requireGuild(interaction: ChatInputCommandInteraction): string | null {
  const guild = interaction.guild;
  if (!guild || !interaction.inGuild()) {
    void replyError(interaction, 'This command can only be used inside a server.');
    return null;
  }
  return guild.id;
}

/** Return the server config row, creating a default row when absent. */
export function ensureConfig(serverId: string): ServerRow {
  const existing = getServerConfig(serverId);
  if (existing) {
    return existing;
  }
  return upsertServerConfig({ serverId });
}
