import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { getDb } from '../../../src/db/index.js';
import { listings, servers, type NewServerRow } from '../../../src/db/schema.js';
import type { EmbedBuilder } from 'discord.js';
import { haveCommand } from '../../../src/commands/user/have.js';
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

function interaction(
  strings: Record<string, string | null> = {},
  integers: Record<string, number | null> = {},
) {
  return fakeChatInputInteraction({
    options: {
      strings: { card_name: 'Black Lotus', accepts: 'cash', condition: 'nm', ...strings },
      integers,
    },
  });
}

describe('/have', () => {
  it('posts a listing and replies with the created embed', async () => {
    const i = interaction();
    await haveCommand.execute(i);

    expect(i.deferReply).toHaveBeenCalledWith({ ephemeral: true });
    expect(i.followUp).toHaveBeenCalledWith(expect.objectContaining({ embeds: expect.any(Array) }));
  });

  it('rejects outside a guild before deferring', async () => {
    const i = fakeChatInputInteraction({
      guildId: null,
      options: { strings: { card_name: 'Black Lotus', accepts: 'cash', condition: 'nm' } },
    });
    await haveCommand.execute(i);

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

    await expect(haveCommand.execute(i)).resolves.toBeUndefined();

    expect(i.editReply).toHaveBeenCalledWith(
      expect.objectContaining({ content: expect.stringContaining('could not resolve') }),
    );
  });

  it('replies with a validation error for an invalid price instead of throwing', async () => {
    const i = interaction({ price: 'not-a-number' });

    await expect(haveCommand.execute(i)).resolves.toBeUndefined();

    expect(i.editReply).toHaveBeenCalledWith(
      expect.objectContaining({ content: expect.stringContaining('Price must be') }),
    );
    expect(resolveCard).not.toHaveBeenCalled();
  });

  it('replies with a validation error for a too-long card name instead of throwing', async () => {
    const i = interaction({ card_name: 'x'.repeat(101) });

    await expect(haveCommand.execute(i)).resolves.toBeUndefined();

    expect(i.editReply).toHaveBeenCalledWith(
      expect.objectContaining({ content: expect.stringContaining('too long') }),
    );
  });

  it('rejects an invalid accepts value', async () => {
    const i = interaction({ accepts: 'bogus' });
    await haveCommand.execute(i);

    expect(i.editReply).toHaveBeenCalledWith(
      expect.objectContaining({ content: expect.stringContaining('Invalid accepts') }),
    );
  });
});

describe('/have autocomplete', () => {
  it('suggests set codes when the set option is focused', async () => {
    autocompleteSets.mockResolvedValue([{ name: 'Modern Horizons 3 (MH3)', value: 'MH3' }]);
    const i = fakeAutocompleteInteraction({
      focused: { name: 'set', value: 'mh3' },
      strings: { card_name: 'Black Lotus' },
    });

    await haveCommand.autocomplete?.(i);

    expect(autocompleteSets).toHaveBeenCalledWith('mh3');
    expect(autocompleteCards).not.toHaveBeenCalled();
    expect(i.respond).toHaveBeenCalledWith([{ name: 'Modern Horizons 3 (MH3)', value: 'MH3' }]);
    // Options chosen before the focused one stay readable, which a handler that
    // narrows its suggestions by an already-picked option needs.
    expect(i.options.getString('card_name')).toBe('Black Lotus');
  });

  it('suggests card names when the card_name option is focused', async () => {
    autocompleteCards.mockResolvedValue(['Black Lotus', 'Black Vice']);
    const i = fakeAutocompleteInteraction({ focused: { name: 'card_name', value: 'black' } });

    await haveCommand.autocomplete?.(i);

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

    await haveCommand.autocomplete?.(i);

    expect(i.respond.mock.calls[0][0]).toHaveLength(25);
  });

  describe("within Discord's 3-second window", () => {
    beforeEach(() => {
      vi.useFakeTimers();
    });
    afterEach(() => {
      vi.useRealTimers();
    });

    /** A lookup that settles `delayMs` from now, on the fake clock. */
    function settlesAfter<T>(delayMs: number, value: T): Promise<T> {
      return new Promise((resolve) => setTimeout(() => resolve(value), delayMs));
    }

    it('gives the Scryfall lookup a deadline before the window closes', async () => {
      const createdTimestamp = Date.now();
      const i = fakeAutocompleteInteraction({
        focused: { name: 'card_name', value: 'bolt' },
        createdTimestamp,
      });

      await haveCommand.autocomplete?.(i);

      const deadline = autocompleteCards.mock.calls[0]?.[1];
      expect(deadline).toBeGreaterThan(createdTimestamp);
      expect(deadline).toBeLessThan(createdTimestamp + 3000);
    });

    it('sends no card suggestions when Scryfall answers after the window', async () => {
      autocompleteCards.mockReturnValue(settlesAfter(5000, ['Lightning Bolt']));
      const i = fakeAutocompleteInteraction({ focused: { name: 'card_name', value: 'bolt' } });

      const pending = haveCommand.autocomplete?.(i);
      await vi.advanceTimersByTimeAsync(5000);
      await pending;

      expect(i.respond).not.toHaveBeenCalled();
    });

    it('counts the window from when Discord created the interaction', async () => {
      // Two seconds are already gone on arrival, so a 1-second lookup is too late.
      autocompleteCards.mockReturnValue(settlesAfter(1000, ['Lightning Bolt']));
      const i = fakeAutocompleteInteraction({
        focused: { name: 'card_name', value: 'bolt' },
        createdTimestamp: Date.now() - 2000,
      });

      const pending = haveCommand.autocomplete?.(i);
      await vi.advanceTimersByTimeAsync(1000);
      await pending;

      expect(i.respond).not.toHaveBeenCalled();
    });

    it('sends no set suggestions when loading the set list outlasts the window', async () => {
      autocompleteSets.mockReturnValue(
        settlesAfter(5000, [{ name: 'Modern Horizons 3 (MH3)', value: 'MH3' }]),
      );
      const i = fakeAutocompleteInteraction({ focused: { name: 'set', value: 'mh3' } });

      const pending = haveCommand.autocomplete?.(i);
      await vi.advanceTimersByTimeAsync(5000);
      await pending;

      expect(i.respond).not.toHaveBeenCalled();
    });
  });
});

function postedListing() {
  return getDb().select().from(listings).get();
}

function postedEmbed(i: ReturnType<typeof interaction>) {
  const call = i.followUp.mock.calls[0]?.[0] as { embeds: EmbedBuilder[] };
  return call.embeds[0]!.toJSON();
}

function errorText(i: ReturnType<typeof interaction>): string {
  return (i.editReply.mock.calls.at(-1)?.[0] as { content: string }).content;
}

describe('/have language and grade', () => {
  it('stores Magic, English and no grade by default', async () => {
    await haveCommand.execute(interaction());
    expect(postedListing()).toMatchObject({
      game: 'mtg',
      language: 'en',
      condition: 'nm',
      gradingCompany: null,
      grade: null,
    });
  });

  it('stores the language the member chose and shows it on the embed', async () => {
    const i = interaction({ language: 'ja' });
    await haveCommand.execute(i);
    expect(postedListing()?.language).toBe('ja');
    expect(postedEmbed(i).fields?.find((f) => f.name === 'Language')?.value).toBe('Japanese');
  });

  it('rejects a language it does not support', async () => {
    const i = interaction({ language: 'klingon' });
    await haveCommand.execute(i);
    expect(errorText(i)).toBe('Invalid language.');
    expect(postedListing()).toBeUndefined();
  });

  it('posts a graded slab with its company and grade, shown as a Grade rather than a Condition', async () => {
    const i = interaction({ condition: 'graded', grade: 'psa 10' });
    await haveCommand.execute(i);
    expect(postedListing()).toMatchObject({
      condition: 'graded',
      gradingCompany: 'PSA',
      grade: '10',
    });
    const fields = postedEmbed(i).fields ?? [];
    expect(fields.find((f) => f.name === 'Grade')?.value).toBe('PSA 10');
    expect(fields.find((f) => f.name === 'Condition')).toBeUndefined();
  });

  it('requires a grade when the condition is graded', async () => {
    const i = interaction({ condition: 'graded' });
    await haveCommand.execute(i);
    expect(errorText(i)).toMatch(/graded card needs its grade/);
    expect(resolveCard).not.toHaveBeenCalled();
    expect(postedListing()).toBeUndefined();
  });

  it('rejects a grade on a raw card', async () => {
    const i = interaction({ condition: 'nm', grade: 'PSA 10' });
    await haveCommand.execute(i);
    expect(errorText(i)).toMatch(/only applies when the condition is Graded/);
    expect(postedListing()).toBeUndefined();
  });

  it('rejects a malformed grade, naming the companies it knows', async () => {
    const i = interaction({ condition: 'graded', grade: 'XYZ 10' });
    await haveCommand.execute(i);
    expect(errorText(i)).toMatch(/Companies: PSA, BGS, CGC, SGC, TAG, ACE/);
  });
});

describe('/have finish and variant per game', () => {
  it('accepts etched for Magic and rejects reverse holo, naming the finishes Magic has', async () => {
    await haveCommand.execute(interaction({ finish: 'etched' }));
    expect(postedListing()?.finish).toBe('etched');

    const i = interaction({ finish: 'reverse' });
    await haveCommand.execute(i);
    expect(errorText(i)).toBe(
      "Magic: The Gathering cards don't come in Reverse Holo. Choose Nonfoil, Foil, Etched.",
    );
    expect(resolveCard).toHaveBeenCalledTimes(1);
  });
});

describe('/have across games', () => {
  let fake: GameDefinition;

  beforeEach(() => {
    fake = registerFakeGame();
    enableGames('guild-1', ['mtg', FAKE_GAME_ID]);
  });

  afterEach(() => {
    unregisterFakeGame();
  });

  it('posts a picked suggestion to the game in its tag, with that game’s link and catalog id', async () => {
    const i = interaction({ card_name: 'fk:fk-7' });
    await haveCommand.execute(i);

    expect(fake.resolveCard).toHaveBeenCalledWith('fk-7', expect.any(Object));
    expect(resolveCard).not.toHaveBeenCalled();
    expect(postedListing()).toMatchObject({
      game: FAKE_GAME_ID,
      cardName: 'Fake Card',
      marketUrl: 'https://fake.example/product/7',
      catalogId: 'fk-7',
    });
  });

  it('shows the game on the embed only because the server has more than one', async () => {
    const i = interaction({ card_name: 'fk:fk-7' });
    await haveCommand.execute(i);
    expect(postedEmbed(i).footer?.text).toMatch(/ · FKG$/);

    enableGames('guild-1', [FAKE_GAME_ID]);
    getDb().update(listings).set({ createdAt: 1, updatedAt: 1 }).run();
    const single = interaction({ card_name: 'fk:fk-7' });
    await haveCommand.execute(single);
    expect(postedEmbed(single).footer?.text).not.toContain('FKG');
  });

  it('uses the game option for a name that was typed rather than picked', async () => {
    await haveCommand.execute(interaction({ card_name: 'Some Card', game: FAKE_GAME_ID }));
    expect(fake.resolveCard).toHaveBeenCalledWith('Some Card', expect.any(Object));
    expect(postedListing()?.game).toBe(FAKE_GAME_ID);
  });

  it('prefers the tag over the game option', async () => {
    await haveCommand.execute(interaction({ card_name: 'fk:fk-7', game: 'mtg' }));
    expect(postedListing()?.game).toBe(FAKE_GAME_ID);
  });

  it('defaults a typed name to the first game the server enabled', async () => {
    await haveCommand.execute(interaction({ card_name: 'Black Lotus' }));
    expect(resolveCard).toHaveBeenCalled();
    expect(postedListing()?.game).toBe('mtg');

    enableGames('guild-1', [FAKE_GAME_ID, 'mtg']);
    getDb().update(listings).set({ createdAt: 1, updatedAt: 1 }).run();
    await haveCommand.execute(interaction({ card_name: 'Anything' }));
    expect(fake.resolveCard).toHaveBeenCalledWith('Anything', expect.any(Object));
  });

  it('rejects a game the server has disabled, before looking the card up', async () => {
    enableGames('guild-1', ['mtg']);
    const i = interaction({ card_name: 'fk:fk-7' });
    await haveCommand.execute(i);
    expect(errorText(i)).toMatch(/Fake Game is not enabled.*\/admin games/);
    expect(fake.resolveCard).not.toHaveBeenCalled();
    expect(postedListing()).toBeUndefined();
  });

  it('applies the chosen game’s finishes: no etched here, reverse holo fine', async () => {
    const etched = interaction({ card_name: 'fk:fk-7', finish: 'etched' });
    await haveCommand.execute(etched);
    expect(errorText(etched)).toMatch(
      /Fake Game cards don't come in Etched. Choose Nonfoil, Reverse Holo/,
    );

    await haveCommand.execute(interaction({ card_name: 'fk:fk-7', finish: 'reverse' }));
    expect(postedListing()).toMatchObject({ game: FAKE_GAME_ID, finish: 'reverse' });
  });

  it('rejects a printing variant for a game that has none', async () => {
    const i = interaction({ card_name: 'fk:fk-7', variant: 'showcase' });
    await haveCommand.execute(i);
    expect(errorText(i)).toMatch(/variants only apply to Magic/i);
    expect(fake.resolveCard).not.toHaveBeenCalled();
  });

  it('takes the language from a catalog entry that fixes it', async () => {
    vi.mocked(fake.resolveCard).mockResolvedValue({
      cardName: 'Fake Card JP',
      cardNameNormalized: 'fake card jp',
      cardSet: 'FK1',
      language: 'ja',
      resolved: true,
    });
    await haveCommand.execute(interaction({ card_name: 'fk:fk-9' }));
    expect(postedListing()?.language).toBe('ja');
  });

  it('rejects a language option that contradicts the catalog entry', async () => {
    vi.mocked(fake.resolveCard).mockResolvedValue({
      cardName: 'Fake Card JP',
      cardNameNormalized: 'fake card jp',
      cardSet: 'FK1',
      language: 'ja',
      resolved: true,
    });
    const i = interaction({ card_name: 'fk:fk-9', language: 'de' });
    await haveCommand.execute(i);
    expect(errorText(i)).toMatch(/Japanese printing, but you chose German/);
    expect(postedListing()).toBeUndefined();
  });
});

describe('/have finish choices', () => {
  const finishValues = (command: typeof haveCommand) =>
    (command.data.toJSON().options as Array<{ name: string; choices?: Array<{ value: string }> }>)
      .find((option) => option.name === 'finish')
      ?.choices?.map((choice) => choice.value);

  it('offers only the finishes some registered game has: no reverse holo while only Magic exists', () => {
    expect(finishValues(haveCommand)).toEqual(['nonfoil', 'foil', 'etched']);
  });
});
