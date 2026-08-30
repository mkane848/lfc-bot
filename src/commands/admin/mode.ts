import type { ChatInputCommandInteraction } from 'discord.js';
import { upsertServerConfig } from '../../services/digest-state.js';
import { refreshServerDigest, removeServerDigest } from '../../services/scheduler.js';
import { DIGEST_MODES } from '../../types/index.js';
import { isDigestMode } from '../../utils/validation.js';
import { replyError, replySuccess } from '../../utils/replies.js';
import { requireGuild } from './context.js';

/**
 * Handle `/admin mode`: set the digest delivery mode and start/stop the
 * server's cron job accordingly (`disabled` cancels it, any other value
 * re-creates it).
 */
export async function execute(interaction: ChatInputCommandInteraction): Promise<void> {
  const serverId = requireGuild(interaction);
  if (!serverId) {
    return;
  }
  const modeInput = interaction.options.getString('mode', true);
  if (!isDigestMode(modeInput)) {
    await replyError(interaction, `Invalid mode. Choose one of: ${DIGEST_MODES.join(', ')}.`);
    return;
  }
  upsertServerConfig({ serverId, digestMode: modeInput });
  if (modeInput === 'disabled') {
    removeServerDigest(serverId);
  } else {
    refreshServerDigest(interaction.client, serverId);
  }
  await replySuccess(interaction, `Digest mode set to ${modeInput}.`);
}
