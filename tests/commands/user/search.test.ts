import { beforeEach, describe, expect, it, vi } from 'vitest';
import { getDb } from '../../../src/db/index.js';
import {
  listings,
  servers,
  type NewListingRow,
  type NewServerRow,
} from '../../../src/db/schema.js';
import { searchCommand } from '../../../src/commands/user/search.js';
import * as scryfall from '../../../src/services/scryfall.js';
import {
  fakeAutocompleteInteraction,
  fakeChatInputInteraction,
} from '../../helpers/interaction.js';
import { setupTestDb } from '../../helpers/db.js';

setupTestDb();

vi.mock('../../../src/services/scryfall.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../src/services/scryfall.js')>();
  return { ...actual, autocompleteCards: vi.fn() };
});

const autocompleteCards = vi.mocked(scryfall.autocompleteCards);

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

function seedListing(overrides: Partial<NewListingRow> = {}): number {
  const row: NewListingRow = {
    serverId: 'guild-1',
    userId: 'owner-1',
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
    collectorNumber: null,
    manapoolUrl: null,
    condition: 'nm',
    priceCents: 100,
    quantity: 1,
    notes: null,
    status: 'active',
    expiresAt: Date.now() + 1000,
    createdAt: Date.now(),
    updatedAt: Date.now(),
    ...overrides,
  };
  const result = getDb().insert(listings).values(row).returning({ id: listings.id }).get();
  return result.id;
}

beforeEach(() => {
  getDb().insert(servers).values(serverRow).run();
});

function interaction(strings: Record<string, string | null> = {}) {
  return fakeChatInputInteraction({
    options: { strings: { card_name: 'Black Lotus', ...strings } },
  });
}

describe('/search', () => {
  it('replies with an embed when results are found', async () => {
    seedListing();
    const i = interaction();

    await searchCommand.execute(i);

    expect(i.reply).toHaveBeenCalledWith(expect.objectContaining({ embeds: expect.any(Array) }));
  });

  it('replies ephemerally with "No active listings found" when nothing matches', async () => {
    const i = interaction();

    await searchCommand.execute(i);

    expect(i.reply).toHaveBeenCalledWith(
      expect.objectContaining({
        content: expect.stringContaining('No active listings found'),
        ephemeral: true,
      }),
    );
  });

  it('rejects outside a guild', async () => {
    const i = fakeChatInputInteraction({
      guildId: null,
      options: { strings: { card_name: 'Black Lotus' } },
    });

    await searchCommand.execute(i);

    expect(i.reply).toHaveBeenCalledWith(
      expect.objectContaining({ content: expect.stringContaining('inside a server') }),
    );
  });

  it('rejects an invalid intent filter', async () => {
    const i = interaction({ intent: 'bogus' });

    await searchCommand.execute(i);

    expect(i.reply).toHaveBeenCalledWith(
      expect.objectContaining({ content: expect.stringContaining('Invalid intent') }),
    );
  });

  it('rejects an invalid accepts filter', async () => {
    const i = interaction({ accepts: 'bogus' });

    await searchCommand.execute(i);

    expect(i.reply).toHaveBeenCalledWith(
      expect.objectContaining({ content: expect.stringContaining('Invalid accepts') }),
    );
  });

  it('matches a "both" listing when filtering by "cash" (accepts-both semantics)', async () => {
    seedListing({ accepts: 'both' });
    const i = interaction({ accepts: 'cash' });

    await searchCommand.execute(i);

    expect(i.reply).toHaveBeenCalledWith(expect.objectContaining({ embeds: expect.any(Array) }));
  });

  // Sealed listings are ordinary rows in `listings` keyed on the same
  // normalized-name column, so search needs no sealed-specific query path.
  // This asserts that property rather than any new code.
  it('finds a sealed listing by its normalized product name', async () => {
    seedListing({
      kind: 'sealed',
      cardName: 'Bloomburrow Bundle',
      cardNameNormalized: 'bloomburrow bundle',
      cardSet: 'BLB',
      condition: null,
      sealedUuid: 'ec99d990-704c-5ad3-ae7f-f1dbc5fd5ceb',
      sealedCategory: 'bundle',
      sealedSubtype: 'default',
    });
    const i = interaction({ card_name: 'Bloomburrow Bundle' });

    await searchCommand.execute(i);

    expect(i.reply).toHaveBeenCalledWith(expect.objectContaining({ embeds: expect.any(Array) }));
  });

  it('renders a sealed listing without a dangling separator when condition is null', async () => {
    seedListing({
      kind: 'sealed',
      cardName: 'Bloomburrow Bundle',
      cardNameNormalized: 'bloomburrow bundle',
      condition: null,
      priceCents: null,
      sealedCategory: 'bundle',
      sealedSubtype: 'default',
    });
    const i = interaction({ card_name: 'Bloomburrow Bundle' });

    await searchCommand.execute(i);

    const payload = i.reply.mock.calls[0]?.[0] as { embeds: Array<{ data: unknown }> };
    const embed = payload.embeds[0]?.data as { fields?: Array<{ value: string }> };
    const line = embed.fields?.[0]?.value ?? '';
    expect(line).toContain('Bundle');
    expect(line).not.toMatch(/^\s*·/);
    expect(line).not.toMatch(/·\s*·/);
  });
});

describe('/search autocomplete', () => {
  beforeEach(() => {
    autocompleteCards.mockReset();
    autocompleteCards.mockResolvedValue([]);
  });

  it('suggests card names for the focused card_name option', async () => {
    autocompleteCards.mockResolvedValue(['Black Lotus']);
    const i = fakeAutocompleteInteraction({ focused: { name: 'card_name', value: 'black' } });

    await searchCommand.autocomplete?.(i);

    expect(autocompleteCards).toHaveBeenCalledWith('black');
    expect(i.respond).toHaveBeenCalledWith([{ name: 'Black Lotus', value: 'Black Lotus' }]);
  });
});
