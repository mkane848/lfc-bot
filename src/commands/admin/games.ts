import type { ChatInputCommandInteraction } from 'discord.js';
import { upsertServerConfig } from '../../services/digest-state.js';
import { GAME_LABELS, SUPPORTED_GAMES } from '../../utils/constants.js';
import { ensureConfig, requireGuild } from './context.js';
import { replyError, replySuccess } from '../../utils/replies.js';

/** Handle `/admin games`: add or remove a game from the guild's `enabled_games` list. */
export async function execute(interaction: ChatInputCommandInteraction): Promise<void> {
  const serverId = requireGuild(interaction);
  if (!serverId) {
    return;
  }
  const game = interaction.options.getString('game', true);
  if (!(SUPPORTED_GAMES as readonly string[]).includes(game)) {
    await replyError(interaction, `Game not supported. Available: ${SUPPORTED_GAMES.join(', ')}.`);
    return;
  }
  const enabled = interaction.options.getBoolean('enabled', true);
  const current = ensureConfig(serverId);
  const games = JSON.parse(current.enabledGames) as string[];
  if (enabled && !games.includes(game)) {
    games.push(game);
  } else if (!enabled) {
    const idx = games.indexOf(game);
    if (idx >= 0) {
      games.splice(idx, 1);
    }
  }
  upsertServerConfig({ serverId, enabledGames: games });
  const label = GAME_LABELS[game] ?? game;
  await replySuccess(interaction, `${label} ${enabled ? 'enabled' : 'disabled'}.`);
}
