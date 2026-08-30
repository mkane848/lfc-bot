import cron from 'node-cron';
import type { ChatInputCommandInteraction } from 'discord.js';
import { upsertServerConfig } from '../../services/digest-state.js';
import { refreshServerDigest } from '../../services/scheduler.js';
import { parseScheduleTime } from '../../utils/schedule-parser.js';
import { replyError, replySuccess } from '../../utils/replies.js';
import { requireGuild } from './context.js';

export async function execute(interaction: ChatInputCommandInteraction): Promise<void> {
  const serverId = requireGuild(interaction);
  if (!serverId) {
    return;
  }
  const time = interaction.options.getString('time', false);
  const cronOption = interaction.options.getString('cron', false);

  if (time && cronOption) {
    await replyError(interaction, 'Use either `time` or `cron`, not both.');
    return;
  }
  if (!time && !cronOption) {
    await replyError(
      interaction,
      'Provide a schedule, e.g. `time: every day at 9am` or `cron: 0 9 * * *`.',
    );
    return;
  }

  let cronExpression: string;
  if (time) {
    const parsed = parseScheduleTime(time);
    if ('error' in parsed) {
      await replyError(interaction, parsed.error);
      return;
    }
    cronExpression = parsed.cron;
  } else {
    cronExpression = cronOption as string;
    if (!cron.validate(cronExpression)) {
      await replyError(
        interaction,
        'Invalid cron expression. Use a five-field expression like `0 9 * * *`.',
      );
      return;
    }
  }

  upsertServerConfig({ serverId, digestCron: cronExpression });
  refreshServerDigest(interaction.client, serverId);
  await replySuccess(interaction, `Digest schedule set to \`${cronExpression}\`.`);
}
