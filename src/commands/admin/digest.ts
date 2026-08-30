import type { ChatInputCommandInteraction } from 'discord.js';
import { getServerConfig } from '../../services/digest-state.js';
import { runDigest } from '../../services/digest.js';
import { ensureConfig, requireGuild } from './context.js';
import { replyError, replySuccess } from '../../utils/replies.js';

/**
 * Handle `/admin digest`: run the digest immediately, bypassing the cron
 * schedule but still gated on `digest_mode !== 'disabled'`.
 */
export async function execute(interaction: ChatInputCommandInteraction): Promise<void> {
  const serverId = requireGuild(interaction);
  if (!serverId) {
    return;
  }
  ensureConfig(serverId);
  const config = getServerConfig(serverId);
  if (!config) {
    await replyError(interaction, 'Server configuration is missing.');
    return;
  }
  if (config.digestMode === 'disabled') {
    await replyError(
      interaction,
      'Digests are disabled. Set a delivery mode with `/admin mode` first.',
    );
    return;
  }

  const result = await runDigest(interaction.client, config, 'manual');
  if (result.listingCount === 0) {
    await replySuccess(interaction, 'Manual digest ran but there were no new listings.');
    return;
  }
  if (!result.sent) {
    await replyError(
      interaction,
      `Digest delivery failed (${result.listingCount} new listings). Check the channel/DM target and try again.`,
    );
    return;
  }
  await replySuccess(
    interaction,
    `Manual digest sent with ${result.listingCount} new listing${result.listingCount === 1 ? '' : 's'}.`,
  );
}
