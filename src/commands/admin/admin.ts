import { SlashCommandBuilder } from 'discord.js';
import type { ChatInputCommandInteraction } from 'discord.js';
import { DIGEST_MODES } from '../../types/index.js';
import type { AdminSubcommand, GuildCommand } from '../../types/index.js';
import { requireManageServer } from '../../utils/permissions.js';
import { recordAdminAction } from '../../services/audit-log.js';
import { execute as executeConfig } from './config.js';
import { execute as executeDigest } from './digest.js';
import { execute as executeSchedule } from './schedule.js';
import { execute as executeTimezone } from './timezone.js';
import { execute as executeChannel } from './channel.js';
import { execute as executeDmTarget } from './dm-target.js';
import { execute as executeMode } from './mode.js';
import { execute as executeRemove } from './remove.js';
import { execute as executeHistory } from './history.js';

const subcommands: Record<string, AdminSubcommand> = {
  config: { name: 'config', execute: executeConfig },
  digest: { name: 'digest', execute: executeDigest },
  schedule: { name: 'schedule', execute: executeSchedule },
  timezone: { name: 'timezone', execute: executeTimezone },
  channel: { name: 'channel', execute: executeChannel },
  'dm-target': { name: 'dm-target', execute: executeDmTarget },
  mode: { name: 'mode', execute: executeMode },
  remove: { name: 'remove', execute: executeRemove },
  history: { name: 'history', execute: executeHistory },
};

/** Flatten a subcommand's options into a plain { name: value } record for the audit log. */
function summarizeOptions(interaction: ChatInputCommandInteraction): Record<string, unknown> {
  const options = interaction.options.data[0]?.options ?? [];
  return Object.fromEntries(options.map((option) => [option.name, option.value]));
}

/**
 * Handle `/admin`: gate on Manage Server permission, dispatch to the
 * matching subcommand handler, and record the invocation to the audit log
 * before dispatch (independent of whether the handler succeeds).
 */
async function execute(interaction: ChatInputCommandInteraction): Promise<void> {
  if (!(await requireManageServer(interaction))) {
    return;
  }
  const subcommand = interaction.options.getSubcommand();
  const handler = subcommands[subcommand];
  if (!handler) {
    await interaction.reply({ content: 'Unknown admin subcommand.', ephemeral: true });
    return;
  }
  if (interaction.guildId) {
    recordAdminAction({
      serverId: interaction.guildId,
      adminId: interaction.user.id,
      adminUsername: interaction.user.username,
      action: subcommand,
      details: summarizeOptions(interaction),
    });
  }
  await handler.execute(interaction);
}

function build(): SlashCommandBuilder {
  const builder = new SlashCommandBuilder()
    .setName('admin')
    .setDescription('Admin configuration for the card trading bot')
    .setDefaultMemberPermissions(0x8); // Manage Server (1 << 3)

  builder.addSubcommand((sub) =>
    sub.setName('config').setDescription('Show and configure digest settings'),
  );
  builder.addSubcommand((sub) =>
    sub.setName('digest').setDescription('Manually trigger a digest now'),
  );
  builder.addSubcommand((sub) =>
    sub
      .setName('schedule')
      .setDescription('Set when the digest fires (use time or cron, not both)')
      .addStringOption((option) =>
        option
          .setName('time')
          .setDescription('Natural language schedule, e.g. "every day at 9am"')
          .setRequired(false),
      )
      .addStringOption((option) =>
        option
          .setName('cron')
          .setDescription('Five-field cron, e.g. 0 9 * * * (advanced)')
          .setRequired(false),
      ),
  );
  builder.addSubcommand((sub) =>
    sub
      .setName('timezone')
      .setDescription('Set the server IANA timezone')
      .addStringOption((option) =>
        option
          .setName('timezone')
          .setDescription('IANA timezone, e.g. America/New_York')
          .setRequired(true),
      ),
  );
  builder.addSubcommand((sub) =>
    sub
      .setName('channel')
      .setDescription('Set the digest channel')
      .addChannelOption((option) =>
        option.setName('channel').setDescription('Channel for digest posts').setRequired(true),
      ),
  );
  builder.addSubcommand((sub) =>
    sub
      .setName('dm-target')
      .setDescription('Set the user to receive digest DMs')
      .addUserOption((option) =>
        option.setName('user').setDescription('User for digest DMs').setRequired(true),
      ),
  );
  builder.addSubcommand((sub) =>
    sub
      .setName('mode')
      .setDescription('Set digest delivery mode')
      .addStringOption((option) =>
        option
          .setName('mode')
          .setDescription('Delivery mode')
          .setRequired(true)
          .addChoices(...DIGEST_MODES.map((m) => ({ name: m, value: m }))),
      ),
  );
  builder.addSubcommand((sub) =>
    sub
      .setName('remove')
      .setDescription('Remove any listing for moderation')
      .addIntegerOption((option) =>
        option
          .setName('listing_id')
          .setDescription('Listing ID to remove')
          .setRequired(true)
          .setMinValue(1),
      ),
  );
  builder.addSubcommand((sub) =>
    sub.setName('history').setDescription('Show recent admin command activity'),
  );
  return builder;
}

export const adminCommand: GuildCommand = {
  name: 'admin',
  data: build(),
  execute,
};
