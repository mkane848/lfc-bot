import {
  autocompleteSealedProducts,
  autocompleteSealedSets,
  resolveSealedProduct,
} from '../services/sealed.js';
import { autocompleteCards, autocompleteSets, resolveCard } from '../services/scryfall.js';
import { sealedProductChoiceUuid } from '../utils/constants.js';
import { buildManapoolUrl } from '../utils/manapool.js';
import { normalizeCardName } from '../utils/validation.js';
import type { GameDefinition } from './types.js';

/**
 * Magic: The Gathering. A thin adapter over the Scryfall, MTGJSON and Mana Pool
 * services, so the commands reach them through the same interface as any other
 * game. It adds no behaviour of its own.
 */
export const mtgGame: GameDefinition = {
  id: 'mtg',
  tag: 'mtg',
  label: 'Magic: The Gathering',
  shortLabel: 'MTG',
  marketLabel: 'Manapool',
  finishes: ['nonfoil', 'foil', 'etched'],
  supportsVariant: true,

  async autocompleteItems(kind, query, context) {
    if (kind === 'sealed') {
      return autocompleteSealedProducts(query, context.setCode);
    }
    const names = await autocompleteCards(query, context.deadline);
    return names.map((name) => ({ name, value: name }));
  },

  async autocompleteSets(kind, query) {
    return kind === 'sealed' ? autocompleteSealedSets(query) : autocompleteSets(query);
  },

  resolveCard: (name, options) => resolveCard(name, options),

  resolveSealed: (name, options) => resolveSealedProduct(name, options),

  isCatalogPick: (kind, value) => kind === 'sealed' && sealedProductChoiceUuid(value) !== null,

  searchTarget(value) {
    const displayName = value.trim();
    return { displayName, searchKey: normalizeCardName(displayName) };
  },

  fallbackMarketUrl: (listing) =>
    buildManapoolUrl({
      cardName: listing.cardName,
      cardSet: listing.cardSet,
      collectorNumber: listing.collectorNumber,
    }),
};
