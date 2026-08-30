import type { ChatInputCommandInteraction } from 'discord.js';
import { upsertServerConfig } from '../../services/digest-state.js';
import { replySuccess } from '../../utils/replies.js';
import { requireGuild } from './context.js';

/** Handle `/admin dm-target`: set the user who receives digest DMs in `dm`/`both` mode. */
export async function execute(interaction: ChatInputCommandInteraction): Promise<void> {
  const serverId = requireGuild(interaction);
  if (!serverId) {
    return;
  }
  const user = interaction.options.getUser('user', true);
  upsertServerConfig({ serverId, digestDmUserId: user.id });
  await replySuccess(interaction, `Digest DMs will go to <@${user.id}>.`);
}
