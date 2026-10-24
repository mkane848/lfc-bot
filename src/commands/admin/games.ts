import type { ChatInputCommandInteraction } from 'discord.js';
import { enabledGameIds, getGame, listGames } from '../../games/index.js';
import { upsertServerConfig } from '../../services/digest-state.js';
import { refreshCatalogIfStale } from '../../services/game-catalogs.js';
import { ensureConfig, requireGuild } from './context.js';
import { replyError, replySuccess } from '../../utils/replies.js';

/**
 * Handle `/admin games`: enable or disable a game for this server. A disabled
 * game's listings are kept but hidden from search and digests until it is
 * enabled again, and the last enabled game can't be disabled.
 */
export async function execute(interaction: ChatInputCommandInteraction): Promise<void> {
  const serverId = requireGuild(interaction);
  if (!serverId) {
    return;
  }
  const gameId = interaction.options.getString('game', true);
  const game = getGame(gameId);
  if (!game) {
    const available = listGames()
      .map((candidate) => candidate.id)
      .join(', ');
    await replyError(interaction, `Game not supported. Available: ${available}.`);
    return;
  }
  const enabled = interaction.options.getBoolean('enabled', true);
  ensureConfig(serverId);
  const games = enabledGameIds(serverId);
  const isEnabled = games.includes(game.id);

  if (enabled && isEnabled) {
    await replySuccess(interaction, `${game.label} is already enabled.`);
    return;
  }
  if (!enabled && !isEnabled) {
    await replySuccess(interaction, `${game.label} is already disabled.`);
    return;
  }
  if (!enabled && games.length === 1) {
    await replyError(
      interaction,
      `${game.label} is the only game enabled here, and at least one has to stay enabled. Enable another game first.`,
    );
    return;
  }

  upsertServerConfig({
    serverId,
    enabledGames: enabled ? [...games, game.id] : games.filter((id) => id !== game.id),
  });
  if (!enabled) {
    await replySuccess(
      interaction,
      `${game.label} disabled. Its listings are kept, but hidden from search and digests until you enable it again.`,
    );
    return;
  }
  // A game backed by a catalog has nothing to suggest until the catalog is
  // downloaded, so start that now rather than at the next daily run.
  const downloading = refreshCatalogIfStale(game);
  await replySuccess(
    interaction,
    downloading
      ? `${game.label} enabled. Its card data is downloading in the background; suggestions will appear in a few minutes.`
      : `${game.label} enabled.`,
  );
}
