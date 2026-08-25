import { SlashCommandBuilder } from 'discord.js';
import type { ChatInputCommandInteraction } from 'discord.js';
import { DIGEST_MODES } from '../../types/index.js';
import type { AdminSubcommand, GuildCommand } from '../../types/index.js';
import { requireManageServer } from '../../utils/permissions.js';
import { execute as executeConfig } from './config.js';
import { execute as executeDigest } from './digest.js';
import { execute as executeSchedule } from './schedule.js';
import { execute as executeTimezone } from './timezone.js';
import { execute as executeChannel } from './channel.js';
import { execute as executeDmTarget } from './dm-target.js';
import { execute as executeMode } from './mode.js';
import { execute as executeGames } from './games.js';
import { execute as executeRemove } from './remove.js';

const subcommands: Record<string, AdminSubcommand> = {
  config: { name: 'config', execute: executeConfig },
  digest: { name: 'digest', execute: executeDigest },
  schedule: { name: 'schedule', execute: executeSchedule },
  timezone: { name: 'timezone', execute: executeTimezone },
  channel: { name: 'channel', execute: executeChannel },
  'dm-target': { name: 'dm-target', execute: executeDmTarget },
  mode: { name: 'mode', execute: executeMode },
  games: { name: 'games', execute: executeGames },
  remove: { name: 'remove', execute: executeRemove },
};

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
      .setDescription('Set the five-field digest cron expression')
      .addStringOption((option) =>
        option.setName('cron').setDescription('Five-field cron, e.g. 0 9 * * *').setRequired(true),
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
      .setName('games')
      .setDescription('Enable or disable a supported game')
      .addStringOption((option) =>
        option.setName('game').setDescription('Game identifier').setRequired(true),
      )
      .addBooleanOption((option) =>
        option.setName('enabled').setDescription('Enable or disable').setRequired(true),
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
  return builder;
}

export const adminCommand: GuildCommand = {
  name: 'admin',
  data: build(),
  execute,
};
