import { EmbedBuilder } from 'discord.js';
import type { ChatInputCommandInteraction } from 'discord.js';
import { getServerConfig } from '../../services/digest-state.js';
import { ensureConfig, requireGuild } from './context.js';
import { brandColor } from '../../utils/embeds.js';
import { DIGEST_MODE_LABELS } from '../../utils/constants.js';

export async function execute(interaction: ChatInputCommandInteraction): Promise<void> {
  const serverId = requireGuild(interaction);
  if (!serverId) {
    return;
  }
  const server = ensureConfig(serverId);
  const latest = getServerConfig(serverId) ?? server;

  const embed = new EmbedBuilder()
    .setColor(brandColor())
    .setTitle('Digest configuration')
    .addFields(
      {
        name: 'Mode',
        value:
          DIGEST_MODE_LABELS[latest.digestMode as keyof typeof DIGEST_MODE_LABELS] ??
          latest.digestMode,
        inline: true,
      },
      { name: 'Schedule', value: `\`${latest.digestCron}\``, inline: true },
      { name: 'Timezone', value: latest.digestTimezone, inline: true },
      {
        name: 'Channel',
        value: latest.adminChannelId ? `<#${latest.adminChannelId}>` : 'Not set',
        inline: true,
      },
      {
        name: 'DM target',
        value: latest.digestDmUserId ? `<@${latest.digestDmUserId}>` : 'Not set',
        inline: true,
      },
      {
        name: 'Enabled games',
        value: (JSON.parse(latest.enabledGames || '[]') as string[]).join(', ') || 'none',
        inline: true,
      },
    );

  const modeLabel =
    DIGEST_MODE_LABELS[latest.digestMode as keyof typeof DIGEST_MODE_LABELS] ?? latest.digestMode;
  const setupHint =
    latest.digestMode === 'disabled'
      ? 'To enable the daily digest: use `/admin channel` (or `/admin dm-target`), then `/admin schedule`, then `/admin mode`.'
      : `Digest is active in ${modeLabel} mode. Use the other /admin subcommands to change it.`;
  embed.setFooter({ text: setupHint });

  await interaction.reply({ embeds: [embed], ephemeral: true });
}
