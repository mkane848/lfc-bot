import type { ChatInputCommandInteraction } from 'discord.js';
import { upsertServerConfig } from '../../services/digest-state.js';
import { replySuccess } from '../../utils/replies.js';
import { requireGuild } from './context.js';

export async function execute(interaction: ChatInputCommandInteraction): Promise<void> {
  const serverId = requireGuild(interaction);
  if (!serverId) {
    return;
  }
  const channel = interaction.options.getChannel('channel', true);
  upsertServerConfig({ serverId, adminChannelId: channel.id });
  await replySuccess(interaction, `Digest channel set to <#${channel.id}>.`);
}
