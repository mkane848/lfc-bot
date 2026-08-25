import cron from 'node-cron';
import type { ChatInputCommandInteraction } from 'discord.js';
import { upsertServerConfig } from '../../services/digest-state.js';
import { refreshServerDigest } from '../../services/scheduler.js';
import { replyError, replySuccess } from '../../utils/replies.js';
import { requireGuild } from './context.js';

export async function execute(interaction: ChatInputCommandInteraction): Promise<void> {
  const serverId = requireGuild(interaction);
  if (!serverId) {
    return;
  }
  const cronExpression = interaction.options.getString('cron', true);
  if (!cron.validate(cronExpression)) {
    await replyError(
      interaction,
      'Invalid cron expression. Use a five-field expression like `0 9 * * *`.',
    );
    return;
  }
  upsertServerConfig({ serverId, digestCron: cronExpression });
  refreshServerDigest(interaction.client, serverId);
  await replySuccess(interaction, `Digest schedule set to \`${cronExpression}\`.`);
}
