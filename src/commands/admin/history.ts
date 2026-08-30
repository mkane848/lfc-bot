import { EmbedBuilder } from 'discord.js';
import type { ChatInputCommandInteraction } from 'discord.js';
import { listRecentAdminActions } from '../../services/audit-log.js';
import { brandColor } from '../../utils/embeds.js';
import { requireGuild } from './context.js';

/** Handle `/admin history`: show the 10 most recent `/admin` actions recorded for this guild. */
export async function execute(interaction: ChatInputCommandInteraction): Promise<void> {
  const serverId = requireGuild(interaction);
  if (!serverId) {
    return;
  }

  const entries = listRecentAdminActions(serverId);
  const embed = new EmbedBuilder().setColor(brandColor()).setTitle('Recent admin activity');

  if (entries.length === 0) {
    embed.setDescription('No admin actions recorded yet.');
  } else {
    embed.setDescription(
      entries
        .map((entry) => {
          const timestamp = `<t:${Math.floor(entry.createdAt / 1000)}:R>`;
          const details = entry.details ? ` \`${entry.details}\`` : '';
          return `${timestamp} — **/admin ${entry.action}** by <@${entry.adminId}> (${entry.adminUsername})${details}`;
        })
        .join('\n'),
    );
  }

  await interaction.reply({ embeds: [embed], ephemeral: true });
}
