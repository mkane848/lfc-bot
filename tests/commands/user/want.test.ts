import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { getDb } from '../../../src/db/index.js';
import { listings, servers, type NewServerRow } from '../../../src/db/schema.js';
import { wantCommand } from '../../../src/commands/user/want.js';
import * as scryfall from '../../../src/services/scryfall.js';
import {
  fakeAutocompleteInteraction,
  fakeChatInputInteraction,
} from '../../helpers/interaction.js';
import { setupTestDb } from '../../helpers/db.js';
import {
  enableGames,
  FAKE_GAME_ID,
  registerFakeGame,
  unregisterFakeGame,
} from '../../helpers/games.js';
import type { GameDefinition } from '../../../src/games/index.js';

setupTestDb();

vi.mock('../../../src/services/scryfall.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../src/services/scryfall.js')>();
  return {
    ...actual,
    resolveCard: vi.fn(),
    autocompleteCards: vi.fn(),
    autocompleteSets: vi.fn(),
  };
});

const resolveCard = vi.mocked(scryfall.resolveCard);
const autocompleteCards = vi.mocked(scryfall.autocompleteCards);
const autocompleteSets = vi.mocked(scryfall.autocompleteSets);

const serverRow: NewServerRow = {
  id: 'guild-1',
  digestMode: 'disabled',
  digestCron: '0 9 * * *',
  digestTimezone: 'UTC',
  enabledGames: '["mtg"]',
  adminChannelId: null,
  digestDmUserId: null,
  lastDigestAt: null,
  removedAt: null,
  createdAt: 1,
  updatedAt: 1,
};

beforeEach(() => {
  getDb().insert(servers).values(serverRow).run();
  autocompleteCards.mockReset();
  autocompleteCards.mockResolvedValue([]);
  autocompleteSets.mockReset();
  autocompleteSets.mockResolvedValue([]);
  resolveCard.mockReset();
  resolveCard.mockResolvedValue({
    scryfallId: 'lotus-id',
    cardName: 'Black Lotus',
    cardNameNormalized: 'black lotus',
    cardSet: 'LEA',
    cardImageUrl: 'http://img/lotus.png',
    collectorNumber: '232',
    marketUrl: null,
    manapoolPriceCents: null,
    resolved: true,
  });
});

function interaction(strings: Record<string, string | null> = {}) {
  return fakeChatInputInteraction({
    options: {
      strings: { card_name: 'Black Lotus', accepts: 'cash', condition: null, ...strings },
    },
  });
}

describe('/want', () => {
  it('posts a listing and replies with the created embed', async () => {
    const i = interaction();
    await wantCommand.execute(i);

    expect(i.deferReply).toHaveBeenCalledWith({ ephemeral: true });
    expect(i.followUp).toHaveBeenCalledWith(expect.objectContaining({ embeds: expect.any(Array) }));
  });

  it('rejects outside a guild before deferring', async () => {
    const i = fakeChatInputInteraction({
      guildId: null,
      options: { strings: { card_name: 'Black Lotus', accepts: 'cash' } },
    });
    await wantCommand.execute(i);

    expect(i.deferReply).not.toHaveBeenCalled();
    expect(i.reply).toHaveBeenCalledWith(
      expect.objectContaining({ content: expect.stringContaining('inside a server') }),
    );
  });

  it('replies with the specific resolution error instead of throwing when the card is unresolved', async () => {
    resolveCard.mockResolvedValue({
      scryfallId: null,
      cardName: 'Not A Card',
      cardNameNormalized: 'not a card',
      cardSet: null,
      cardImageUrl: null,
      collectorNumber: null,
      marketUrl: null,
      manapoolPriceCents: null,
      resolved: false,
    });
    const i = interaction({ card_name: 'Not A Card' });

    await expect(wantCommand.execute(i)).resolves.toBeUndefined();

    expect(i.editReply).toHaveBeenCalledWith(
      expect.objectContaining({ content: expect.stringContaining('could not resolve') }),
    );
  });

  it('replies with a validation error for an invalid max_price instead of throwing', async () => {
    const i = interaction({ max_price: 'not-a-number' });

    await expect(wantCommand.execute(i)).resolves.toBeUndefined();

    expect(i.editReply).toHaveBeenCalledWith(
      expect.objectContaining({ content: expect.stringContaining('Price must be') }),
    );
    expect(resolveCard).not.toHaveBeenCalled();
  });

  it('replies with a validation error for a too-long card name instead of throwing', async () => {
    const i = interaction({ card_name: 'x'.repeat(101) });

    await expect(wantCommand.execute(i)).resolves.toBeUndefined();

    expect(i.editReply).toHaveBeenCalledWith(
      expect.objectContaining({ content: expect.stringContaining('too long') }),
    );
  });
});

describe('/want autocomplete', () => {
  it('suggests set codes when the set option is focused', async () => {
    autocompleteSets.mockResolvedValue([{ name: 'Modern Horizons 3 (MH3)', value: 'MH3' }]);
    const i = fakeAutocompleteInteraction({
      focused: { name: 'set', value: 'mh3' },
      strings: { card_name: 'Black Lotus' },
    });

    await wantCommand.autocomplete?.(i);

    expect(autocompleteSets).toHaveBeenCalledWith('mh3');
    expect(autocompleteCards).not.toHaveBeenCalled();
    expect(i.respond).toHaveBeenCalledWith([{ name: 'Modern Horizons 3 (MH3)', value: 'MH3' }]);
  });

  it('suggests card names when the card_name option is focused', async () => {
    autocompleteCards.mockResolvedValue(['Black Lotus', 'Black Vice']);
    const i = fakeAutocompleteInteraction({ focused: { name: 'card_name', value: 'black' } });

    await wantCommand.autocomplete?.(i);

    expect(autocompleteCards).toHaveBeenCalledWith('black', expect.any(Number));
    expect(autocompleteSets).not.toHaveBeenCalled();
    expect(i.respond).toHaveBeenCalledWith([
      { name: 'Black Lotus', value: 'Black Lotus' },
      { name: 'Black Vice', value: 'Black Vice' },
    ]);
  });

  it('caps card suggestions at the 25 choices Discord accepts', async () => {
    autocompleteCards.mockResolvedValue(Array.from({ length: 30 }, (_, n) => `Card ${n}`));
    const i = fakeAutocompleteInteraction({ focused: { name: 'card_name', value: 'card' } });

    await wantCommand.autocomplete?.(i);

    expect(i.respond.mock.calls[0][0]).toHaveLength(25);
  });
});

function wantedListing() {
  return getDb().select().from(listings).get();
}

function wantError(i: ReturnType<typeof interaction>): string {
  return (i.editReply.mock.calls.at(-1)?.[0] as { content: string }).content;
}

describe('/want language, grade and game', () => {
  let fake: GameDefinition;

  beforeEach(() => {
    fake = registerFakeGame();
  });

  afterEach(() => {
    unregisterFakeGame();
  });

  it('stores Magic and English by default, with a condition that stays optional', async () => {
    await wantCommand.execute(interaction());
    expect(wantedListing()).toMatchObject({
      game: 'mtg',
      language: 'en',
      condition: null,
      gradingCompany: null,
      grade: null,
    });
  });

  it('wants a graded slab: the condition is graded and the grade is required', async () => {
    await wantCommand.execute(interaction({ condition: 'graded', grade: 'BGS 9.5' }));
    expect(wantedListing()).toMatchObject({
      condition: 'graded',
      gradingCompany: 'BGS',
      grade: '9.5',
    });

    const missing = interaction({ condition: 'graded' });
    await wantCommand.execute(missing);
    expect(wantError(missing)).toMatch(/graded card needs its grade/);
  });

  it('rejects a grade without the graded condition, even when no condition was given', async () => {
    const i = interaction({ grade: 'PSA 10' });
    await wantCommand.execute(i);
    expect(wantError(i)).toMatch(/only applies when the condition is Graded/);
    expect(wantedListing()).toBeUndefined();
  });

  it('wants a card in another language', async () => {
    await wantCommand.execute(interaction({ language: 'de' }));
    expect(wantedListing()?.language).toBe('de');
  });

  it('posts a picked suggestion to its game, and refuses a disabled one', async () => {
    enableGames('guild-1', ['mtg', FAKE_GAME_ID]);
    await wantCommand.execute(interaction({ card_name: 'fk:fk-7' }));
    expect(fake.resolveCard).toHaveBeenCalledWith('fk-7', expect.any(Object));
    expect(wantedListing()).toMatchObject({ game: FAKE_GAME_ID, intent: 'want' });

    getDb().delete(listings).run();
    enableGames('guild-1', ['mtg']);
    const i = interaction({ card_name: 'fk:fk-7' });
    await wantCommand.execute(i);
    expect(wantError(i)).toMatch(/Fake Game is not enabled/);
    expect(wantedListing()).toBeUndefined();
  });

  it('applies the chosen game’s finish rules', async () => {
    enableGames('guild-1', ['mtg', FAKE_GAME_ID]);
    const i = interaction({ card_name: 'fk:fk-7', finish: 'etched' });
    await wantCommand.execute(i);
    expect(wantError(i)).toMatch(/Fake Game cards don't come in Etched/);
  });
});
