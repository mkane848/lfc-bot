import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as scryfall from '../../src/services/scryfall.js';
import {
  handleCardAutocomplete,
  handleSealedAutocomplete,
  handleSetAutocomplete,
} from '../../src/utils/cards.js';
import { fakeAutocompleteInteraction } from '../helpers/interaction.js';
import { setupTestDb } from '../helpers/db.js';
import {
  createFakeGame,
  enableGames,
  FAKE_GAME_ID,
  registerFakeGame,
  unregisterFakeGame,
} from '../helpers/games.js';
import type { GameDefinition } from '../../src/games/index.js';

setupTestDb();

vi.mock('../../src/services/scryfall.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/services/scryfall.js')>();
  return { ...actual, autocompleteCards: vi.fn(), autocompleteSets: vi.fn(), resolveCard: vi.fn() };
});

const autocompleteCards = vi.mocked(scryfall.autocompleteCards);
const autocompleteSets = vi.mocked(scryfall.autocompleteSets);

let fake: GameDefinition;

const choices = (prefix: string, count: number) =>
  Array.from({ length: count }, (_, index) => ({
    name: `${prefix}${index + 1}`,
    value: `${prefix}${index + 1}`,
  }));

beforeEach(() => {
  autocompleteCards.mockReset();
  autocompleteCards.mockResolvedValue([]);
  autocompleteSets.mockReset();
  autocompleteSets.mockResolvedValue([]);
  fake = registerFakeGame();
});

afterEach(() => {
  unregisterFakeGame();
});

function typing(
  value: string,
  strings: Record<string, string | null> = {},
  name = 'card_name',
  createdTimestamp?: number,
) {
  return fakeAutocompleteInteraction({ focused: { name, value }, strings, createdTimestamp });
}

describe('card autocomplete with one game enabled', () => {
  it('answers with exactly the game’s suggestions, untagged', async () => {
    autocompleteCards.mockResolvedValue(['Black Lotus', 'Black Knight']);
    const i = typing('black');
    await handleCardAutocomplete(i);
    expect(i.respond).toHaveBeenCalledWith([
      { name: 'Black Lotus', value: 'Black Lotus' },
      { name: 'Black Knight', value: 'Black Knight' },
    ]);
  });

  it('sends nothing when the game is too slow for Discord’s window', async () => {
    autocompleteCards.mockReturnValue(new Promise(() => undefined));
    const i = typing('black', {}, 'card_name', Date.now() - 2490);
    await handleCardAutocomplete(i);
    expect(i.respond).not.toHaveBeenCalled();
  });

  it('answers an empty list for a game that is not enabled', async () => {
    const i = typing('fake', { game: FAKE_GAME_ID });
    await handleCardAutocomplete(i);
    expect(i.respond).toHaveBeenCalledWith([]);
    expect(fake.autocompleteItems).not.toHaveBeenCalled();
  });
});

describe('card autocomplete with several games enabled', () => {
  beforeEach(() => {
    enableGames('guild-1', ['mtg', FAKE_GAME_ID]);
  });

  it('merges every game’s suggestions, interleaved, each tagged with its game', async () => {
    autocompleteCards.mockResolvedValue(['Alpha 1', 'Alpha 2', 'Alpha 3']);
    vi.mocked(fake.autocompleteItems).mockResolvedValue([
      { name: 'Beta 1', value: 'b1' },
      { name: 'Beta 2', value: 'b2' },
    ]);
    const i = typing('a');
    await handleCardAutocomplete(i);
    expect(i.respond).toHaveBeenCalledWith([
      { name: 'Alpha 1 · MTG', value: 'mtg:Alpha 1' },
      { name: 'Beta 1 · FKG', value: 'fk:b1' },
      { name: 'Alpha 2 · MTG', value: 'mtg:Alpha 2' },
      { name: 'Beta 2 · FKG', value: 'fk:b2' },
      { name: 'Alpha 3 · MTG', value: 'mtg:Alpha 3' },
    ]);
  });

  it('caps the merged list at Discord’s 25 choices without letting one game crowd out the other', async () => {
    autocompleteCards.mockResolvedValue(choices('A', 25).map((choice) => choice.name));
    vi.mocked(fake.autocompleteItems).mockResolvedValue(choices('B', 25));
    const i = typing('x');
    await handleCardAutocomplete(i);
    const sent = (i.respond.mock.calls[0]?.[0] ?? []) as Array<{ value: string }>;
    expect(sent).toHaveLength(25);
    expect(sent.filter((choice) => choice.value.startsWith('mtg:'))).toHaveLength(13);
    expect(sent.filter((choice) => choice.value.startsWith('fk:'))).toHaveLength(12);
  });

  it('leaves out a game that misses the deadline instead of waiting for it', async () => {
    autocompleteCards.mockReturnValue(new Promise(() => undefined));
    vi.mocked(fake.autocompleteItems).mockResolvedValue([{ name: 'Beta 1', value: 'b1' }]);
    const i = typing('b', {}, 'card_name', Date.now() - 2490);
    await handleCardAutocomplete(i);
    expect(i.respond).toHaveBeenCalledWith([{ name: 'Beta 1 · FKG', value: 'fk:b1' }]);
  });

  it('keeps the other game’s suggestions when one game fails', async () => {
    autocompleteCards.mockRejectedValue(new Error('scryfall down'));
    vi.mocked(fake.autocompleteItems).mockResolvedValue([{ name: 'Beta 1', value: 'b1' }]);
    const i = typing('b');
    await handleCardAutocomplete(i);
    expect(i.respond).toHaveBeenCalledWith([{ name: 'Beta 1 · FKG', value: 'fk:b1' }]);
  });

  it('sends nothing when no game was ready in time', async () => {
    autocompleteCards.mockReturnValue(new Promise(() => undefined));
    vi.mocked(fake.autocompleteItems).mockReturnValue(new Promise(() => undefined));
    const i = typing('b', {}, 'card_name', Date.now() - 2490);
    await handleCardAutocomplete(i);
    expect(i.respond).not.toHaveBeenCalled();
  });

  it('narrows to the game chosen in the game option, still tagged', async () => {
    autocompleteCards.mockResolvedValue(['Alpha 1']);
    vi.mocked(fake.autocompleteItems).mockResolvedValue([{ name: 'Beta 1', value: 'b1' }]);
    const i = typing('x', { game: FAKE_GAME_ID });
    await handleCardAutocomplete(i);
    expect(i.respond).toHaveBeenCalledWith([{ name: 'Beta 1 · FKG', value: 'fk:b1' }]);
    expect(autocompleteCards).not.toHaveBeenCalled();
  });

  it('drops a suggestion whose tagged value would not fit in 100 characters', async () => {
    vi.mocked(fake.autocompleteItems).mockResolvedValue([
      { name: 'Too long', value: 'v'.repeat(98) },
      { name: 'Fine', value: 'ok' },
    ]);
    const i = typing('x', { game: FAKE_GAME_ID });
    await handleCardAutocomplete(i);
    expect(i.respond).toHaveBeenCalledWith([{ name: 'Fine · FKG', value: 'fk:ok' }]);
  });

  it('asks each game for sealed product with the set already chosen', async () => {
    const i = typing('box', { set: 'FK1' }, 'product_name');
    await handleSealedAutocomplete(i);
    expect(fake.autocompleteItems).toHaveBeenCalledWith('sealed', 'box', {
      deadline: expect.any(Number),
      setCode: 'FK1',
      language: null,
    });
  });
});

describe('set autocomplete', () => {
  beforeEach(() => {
    enableGames('guild-1', ['mtg', FAKE_GAME_ID]);
  });

  it('uses the game of the card already picked', async () => {
    vi.mocked(fake.autocompleteSets).mockResolvedValue([{ name: 'Fake Set (FK1)', value: 'FK1' }]);
    const i = typing('fk', { card_name: 'fk:b1' }, 'set');
    await handleSetAutocomplete(i);
    expect(fake.autocompleteSets).toHaveBeenCalledWith('card', 'fk');
    expect(autocompleteSets).not.toHaveBeenCalled();
    expect(i.respond).toHaveBeenCalledWith([{ name: 'Fake Set (FK1)', value: 'FK1' }]);
  });

  it('uses the game option when the card was typed, not picked', async () => {
    const i = typing('fk', { card_name: 'Some Card', game: FAKE_GAME_ID }, 'set');
    await handleSetAutocomplete(i);
    expect(fake.autocompleteSets).toHaveBeenCalledWith('card', 'fk');
  });

  it('uses the server’s first game when nothing says otherwise', async () => {
    autocompleteSets.mockResolvedValue([{ name: 'Modern Horizons 3 (MH3)', value: 'MH3' }]);
    const i = typing('mh', {}, 'set');
    await handleSetAutocomplete(i);
    expect(autocompleteSets).toHaveBeenCalledWith('mh');
    expect(i.respond).toHaveBeenCalledWith([{ name: 'Modern Horizons 3 (MH3)', value: 'MH3' }]);
  });

  it('reads the product name for sealed commands and asks for sealed sets', async () => {
    const i = typing('fk', { product_name: 'fk:id:box' }, 'set');
    await handleSetAutocomplete(i, 'sealed');
    expect(fake.autocompleteSets).toHaveBeenCalledWith('sealed', 'fk');
  });

  it('answers an empty list when the game was disabled after the card was picked', async () => {
    enableGames('guild-1', ['mtg']);
    const i = typing('fk', { card_name: 'fk:b1' }, 'set');
    await handleSetAutocomplete(i);
    expect(i.respond).toHaveBeenCalledWith([]);
  });

  it('sends nothing when the sets are not ready in time', async () => {
    autocompleteSets.mockReturnValue(new Promise(() => undefined));
    const i = typing('mh', {}, 'set', Date.now() - 2490);
    await handleSetAutocomplete(i);
    expect(i.respond).not.toHaveBeenCalled();
  });
});

describe('createFakeGame', () => {
  it('can be overridden, so tests can shape a game', () => {
    expect(createFakeGame({ tag: 'zz' }).tag).toBe('zz');
  });
});
