import type { ChatInputCommandInteraction } from 'discord.js';
import { upsertServerConfig } from '../../services/digest-state.js';
import { refreshServerDigest } from '../../services/scheduler.js';
import { replyError, replySuccess } from '../../utils/replies.js';
import { requireGuild } from './context.js';

function isValidTimezone(value: string): boolean {
  try {
    Intl.DateTimeFormat(undefined, { timeZone: value });
    return true;
  } catch {
    return false;
  }
}

export async function execute(interaction: ChatInputCommandInteraction): Promise<void> {
  const serverId = requireGuild(interaction);
  if (!serverId) {
    return;
  }
  const timezone = interaction.options.getString('timezone', true);
  if (!isValidTimezone(timezone)) {
    await replyError(interaction, 'Invalid IANA timezone. Use a value like `America/New_York`.');
    return;
  }
  upsertServerConfig({ serverId, digestTimezone: timezone });
  refreshServerDigest(interaction.client, serverId);
  await replySuccess(interaction, `Digest timezone set to \`${timezone}\`.`);
}
