import { EmbedBuilder, SlashCommandBuilder } from 'discord.js';
import type { ChatInputCommandInteraction } from 'discord.js';
import type { GuildCommand } from '../../types/index.js';
import { brandColor } from '../../utils/embeds.js';

async function execute(interaction: ChatInputCommandInteraction): Promise<void> {
  const embed = new EmbedBuilder()
    .setColor(brandColor())
    .setTitle('LFCbot Help')
    .setDescription('Post and search card trading listings for your server.');

  embed.addFields(
    {
      name: 'Post a listing',
      value: '`/sell`, `/buy`, `/trade` create active listings',
      inline: false,
    },
    {
      name: 'Find cards',
      value: '`/search <card>` shows active listings, 10 per page',
      inline: false,
    },
    {
      name: 'Manage your listings',
      value: '`/mylistings`, `/edit`, `/fulfill`, `/delete`',
      inline: false,
    },
    {
      name: 'For admins',
      value: '`/admin ...` configures the daily digest and moderation',
      inline: false,
    },
  );

  await interaction.reply({ embeds: [embed], ephemeral: true });
}

export const helpCommand: GuildCommand = {
  name: 'help',
  data: new SlashCommandBuilder()
    .setName('help')
    .setDescription('Show available commands and usage'),
  execute,
};
