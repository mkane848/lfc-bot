import { mtgGame } from './mtg.js';
import { pokemonGame } from './pokemon.js';
import { registerGame } from './registry.js';

// Importing this module is what makes a game available. Registration order is
// the order `/admin games` lists them in.
registerGame(mtgGame);
registerGame(pokemonGame);

export { autocompleteChoices, autocompleteSetChoices } from './autocomplete.js';
export {
  DEFAULT_GAME_ID,
  getGame,
  isGameId,
  listGames,
  registerGame,
  unregisterGame,
} from './registry.js';
export { resolveGameForValue, splitGameTag, tagChoice } from './resolve.js';
export type { GameResolution } from './resolve.js';
export {
  enabledGameIds,
  enabledGameIdsFromConfig,
  enabledGames,
  hasMultipleGames,
  parseEnabledGames,
} from './server.js';
export type {
  AutocompleteChoice,
  CardResolveOptions,
  GameCatalog,
  GameDefinition,
  SearchTarget,
} from './types.js';
