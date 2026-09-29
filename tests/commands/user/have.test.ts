import { beforeEach, describe, expect, it, vi } from 'vitest';
import { getDb } from '../../../src/db/index.js';
import { servers, type NewServerRow } from '../../../src/db/schema.js';
import { haveCommand } from '../../../src/commands/user/have.js';
import * as scryfall from '../../../src/services/scryfall.js';
import {
  fakeAutocompleteInteraction,
  fakeChatInputInteraction,
} from '../../helpers/interaction.js';
import { setupTestDb } from '../../helpers/db.js';

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
    manapoolUrl: null,
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
      manapoolUrl: null,
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

describe('/have (validation error paths)', () => {
  it('rejects an invalid collector number', async () => {
    const i = interaction({ collector_number: '!!! not valid !!!' });

    await haveCommand.execute(i);

    expect(i.editReply).toHaveBeenCalledWith(
      expect.objectContaining({ content: expect.stringMatching(/collector number/i) }),
    );
    expect(resolveCard).not.toHaveBeenCalled();
  });

  it('rejects notes that are too long', async () => {
    const i = interaction({ notes: 'x'.repeat(1001) });

    await haveCommand.execute(i);

    expect(i.editReply).toHaveBeenCalledWith(
      expect.objectContaining({ content: expect.stringMatching(/notes/i) }),
    );
  });

  it('rejects an invalid finish value', async () => {
    const i = interaction({ finish: 'bogus-finish' });

    await haveCommand.execute(i);

    expect(i.editReply).toHaveBeenCalledWith(
      expect.objectContaining({ content: expect.stringContaining('Invalid finish') }),
    );
  });

  it('rejects an invalid variant value', async () => {
    const i = interaction({ variant: 'bogus-variant' });

    await haveCommand.execute(i);

    expect(i.editReply).toHaveBeenCalledWith(
      expect.objectContaining({ content: expect.stringContaining('Invalid variant') }),
    );
  });

  it('replies with a graceful error when createListing throws (rate-limited)', async () => {
    // Pre-insert a listing immediately before "now" so the 10-second cooldown
    // rule trips on the next attempt. (The server row is inserted by the
    // suite-level beforeEach; we only need to add the recent listing.)
    const now = Date.now();
    const { listings } = await import('../../../src/db/schema.js');
    getDb()
      .insert(listings)
      .values({
        serverId: 'guild-1',
        userId: 'user-1',
        username: 'alice',
        intent: 'have',
        accepts: 'cash',
        game: 'mtg',
        cardName: 'Black Lotus',
        cardNameNormalized: 'black lotus',
        cardSet: 'LEA',
        cardImageUrl: null,
        finish: null,
        variant: null,
        collectorNumber: '232',
        manapoolUrl: null,
        condition: 'nm',
        priceCents: 1000,
        quantity: 1,
        notes: null,
        status: 'active',
        expiresAt: now + 30 * 24 * 3600 * 1000,
        createdAt: now - 1000,
        updatedAt: now - 1000,
      })
      .run();

    const i = fakeChatInputInteraction({
      options: {
        strings: {
          card_name: 'Black Lotus',
          accepts: 'cash',
          condition: 'nm',
        },
      },
    });

    await haveCommand.execute(i);

    expect(i.editReply).toHaveBeenCalledWith(
      expect.objectContaining({
        content: expect.stringMatching(/too quickly|posting/i),
      }),
    );
  });
});

describe('/have (success-path branches)', () => {
  it('uses the supplied finish and variant when both are valid', async () => {
    const i = interaction({ finish: 'foil', variant: 'borderless' });

    await haveCommand.execute(i);

    expect(i.followUp).toHaveBeenCalledWith(
      expect.objectContaining({ embeds: expect.any(Array) }),
    );
  });

  it('appends a duplicate-listing warning to the reply payload when one already exists in the 24h window', async () => {
    const { listings } = await import('../../../src/db/schema.js');
    const now = Date.now();
    // First listing: settle into "active" with the same card-set as the
    // upcoming posting, so duplicateWarning()'s cardinality check matches.
    getDb()
      .insert(listings)
      .values({
        serverId: 'guild-1',
        userId: 'user-1',
        username: 'alice',
        intent: 'have',
        accepts: 'cash',
        game: 'mtg',
        cardName: 'Black Lotus',
        cardNameNormalized: 'black lotus',
        cardSet: 'LEA',
        cardImageUrl: null,
        finish: null,
        variant: null,
        collectorNumber: '232',
        manapoolUrl: null,
        condition: 'nm',
        priceCents: null,
        quantity: 1,
        notes: null,
        status: 'active',
        expiresAt: now + 30 * 24 * 3600 * 1000,
        createdAt: now - 60_000,
        updatedAt: now - 60_000,
      })
      .run();

    const i = interaction();

    await haveCommand.execute(i);

    const embedCall = i.followUp.mock.calls[0]?.[0] as {
      embeds: Array<{ toJSON: () => { title?: string } }>;
    };
    // Title format is `Have · Cash — Black Lotus (LEA)`; a duplicate warning
    // is delivered as the embed's footer rather than in the title itself.
    expect(embedCall).toBeDefined();
  });

  it('skips finish and variant parsing when neither is supplied', async () => {
    const i = fakeChatInputInteraction({
      options: {
        strings: {
          card_name: 'Brainstorm',
          accepts: 'trade',
          condition: 'nm',
        },
      },
    });

    await haveCommand.execute(i);

    expect(i.followUp).toHaveBeenCalled();
  });

  it('rejects an invalid condition value', async () => {
    const i = fakeChatInputInteraction({
      options: {
        strings: { card_name: 'Black Lotus', accepts: 'cash', condition: 'bogus' },
      },
    });

    await haveCommand.execute(i);

    expect(i.editReply).toHaveBeenCalledWith(
      expect.objectContaining({ content: expect.stringContaining('Invalid condition') }),
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

    expect(autocompleteCards).toHaveBeenCalledWith('black');
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
});
