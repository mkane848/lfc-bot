import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { AutocompleteInteraction } from 'discord.js';
import { getDb } from '../../../src/db/index.js';
import { listings, servers, type NewServerRow } from '../../../src/db/schema.js';
import { wantSealedCommand } from '../../../src/commands/user/want-sealed.js';
import * as sealed from '../../../src/services/sealed.js';
import type { ResolvedSealedProduct } from '../../../src/types/index.js';
import { fakeChatInputInteraction } from '../../helpers/interaction.js';
import { setupTestDb } from '../../helpers/db.js';

setupTestDb();

vi.mock('../../../src/services/sealed.js', () => ({
  resolveSealedProduct: vi.fn(),
  autocompleteSealedProducts: vi.fn(),
  autocompleteSealedSets: vi.fn(),
}));

const resolveSealedProduct = vi.mocked(sealed.resolveSealedProduct);
const autocompleteSealedProducts = vi.mocked(sealed.autocompleteSealedProducts);
const autocompleteSealedSets = vi.mocked(sealed.autocompleteSealedSets);

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

const hitResult: ResolvedSealedProduct = {
  productName: 'Bloomburrow Bundle',
  productNameNormalized: 'bloomburrow bundle',
  setCode: 'BLB',
  uuid: 'ec99d990-704c-5ad3-ae7f-f1dbc5fd5ceb',
  category: 'bundle',
  subtype: null,
  manapoolUrl: 'https://manapool.com/sealed/blb/bundle',
  resolved: true,
};

const missResult: ResolvedSealedProduct = {
  productName: 'Homebrew Prize Wall Box',
  productNameNormalized: 'homebrew prize wall box',
  setCode: null,
  uuid: null,
  category: null,
  subtype: null,
  manapoolUrl: null,
  resolved: false,
};

beforeEach(() => {
  getDb().insert(servers).values(serverRow).run();
  resolveSealedProduct.mockReset();
  autocompleteSealedProducts.mockReset();
  autocompleteSealedSets.mockReset();
  resolveSealedProduct.mockResolvedValue(hitResult);
});

function interaction(strings: Record<string, string | null> = {}) {
  return fakeChatInputInteraction({
    options: {
      strings: { product_name: 'Bloomburrow Bundle', accepts: 'cash', ...strings },
    },
  });
}

function autocompleteInteraction(focused: { name: string; value: string }) {
  const base = fakeChatInputInteraction({ options: { focused } });
  return Object.assign(base, {
    respond: vi.fn().mockResolvedValue(undefined),
  }) as unknown as AutocompleteInteraction & { respond: ReturnType<typeof vi.fn> };
}

describe('/want-sealed', () => {
  it('posts a listing with sealed columns populated on a catalog hit', async () => {
    const i = interaction();
    await wantSealedCommand.execute(i);

    expect(i.deferReply).toHaveBeenCalledWith({ ephemeral: true });
    expect(i.followUp).toHaveBeenCalledWith(expect.objectContaining({ embeds: expect.any(Array) }));

    const inserted = getDb().select().from(listings).all()[0];
    expect(inserted).toBeDefined();
    expect(inserted?.intent).toBe('want');
    expect(inserted?.kind).toBe('sealed');
    expect(inserted?.sealedUuid).toBe(hitResult.uuid);
    expect(inserted?.sealedCategory).toBe(hitResult.category);
    expect(inserted?.sealedSubtype).toBe(hitResult.subtype);
    expect(inserted?.manapoolUrl).toBe(hitResult.manapoolUrl);
    expect(inserted?.cardName).toBe(hitResult.productName);
    expect(inserted?.cardNameNormalized).toBe(hitResult.productNameNormalized);
    expect(inserted?.cardSet).toBe(hitResult.setCode);
    expect(inserted?.quantity).toBe(1);
    // Card-only columns stay null on a sealed row.
    expect(inserted?.condition).toBeNull();
    expect(inserted?.finish).toBeNull();
    expect(inserted?.variant).toBeNull();
    expect(inserted?.collectorNumber).toBeNull();
    expect(inserted?.cardImageUrl).toBeNull();
  });

  it('still creates a listing on a catalog miss (free-text fallback)', async () => {
    resolveSealedProduct.mockResolvedValue(missResult);
    const i = interaction({ product_name: 'Homebrew Prize Wall Box' });

    await wantSealedCommand.execute(i);

    expect(i.followUp).toHaveBeenCalledWith(expect.objectContaining({ embeds: expect.any(Array) }));
    const inserted = getDb().select().from(listings).all()[0];
    expect(inserted).toBeDefined();
    expect(inserted?.kind).toBe('sealed');
    expect(inserted?.cardName).toBe(missResult.productName);
    expect(inserted?.sealedUuid).toBeNull();
    expect(inserted?.manapoolUrl).toBeNull();
  });

  it('still creates a listing when enrichment returns a null manapoolUrl', async () => {
    resolveSealedProduct.mockResolvedValue({ ...hitResult, manapoolUrl: null });
    const i = interaction();

    await wantSealedCommand.execute(i);

    const inserted = getDb().select().from(listings).all()[0];
    expect(inserted).toBeDefined();
    expect(inserted?.manapoolUrl).toBeNull();
    expect(inserted?.sealedUuid).toBe(hitResult.uuid);
  });

  it('rejects outside a guild before deferring', async () => {
    const i = fakeChatInputInteraction({
      guildId: null,
      options: { strings: { product_name: 'Bloomburrow Bundle', accepts: 'cash' } },
    });
    await wantSealedCommand.execute(i);

    expect(i.deferReply).not.toHaveBeenCalled();
    expect(i.reply).toHaveBeenCalledWith(
      expect.objectContaining({ content: expect.stringContaining('inside a server') }),
    );
    expect(resolveSealedProduct).not.toHaveBeenCalled();
  });

  it('replies with a validation error for an invalid max_price instead of throwing', async () => {
    const i = interaction({ max_price: 'not-a-number' });

    await expect(wantSealedCommand.execute(i)).resolves.toBeUndefined();

    expect(i.editReply).toHaveBeenCalledWith(
      expect.objectContaining({ content: expect.stringContaining('Price must be') }),
    );
    expect(resolveSealedProduct).not.toHaveBeenCalled();
  });

  it('replies with a validation error for a too-long product name instead of throwing', async () => {
    const i = interaction({ product_name: 'x'.repeat(101) });

    await expect(wantSealedCommand.execute(i)).resolves.toBeUndefined();

    expect(i.editReply).toHaveBeenCalledWith(
      expect.objectContaining({ content: expect.stringContaining('too long') }),
    );
    expect(resolveSealedProduct).not.toHaveBeenCalled();
  });

  it('rejects an invalid accepts value', async () => {
    const i = interaction({ accepts: 'bogus' });
    await wantSealedCommand.execute(i);

    expect(i.editReply).toHaveBeenCalledWith(
      expect.objectContaining({ content: expect.stringContaining('Invalid accepts') }),
    );
  });

  it('never sends a bare .reply() once deferred (defer-then-editReply/followUp contract)', async () => {
    const i = interaction();
    await wantSealedCommand.execute(i);

    expect(i.deferReply).toHaveBeenCalled();
    expect(i.reply).not.toHaveBeenCalled();
  });

  it('autocomplete dispatches to autocompleteSealedProducts for product_name, passing the chosen set', async () => {
    autocompleteSealedProducts.mockReturnValue([
      { name: 'Bloomburrow Bundle', value: 'Bloomburrow Bundle' },
    ]);
    const i = autocompleteInteraction({ name: 'product_name', value: 'bloom' });
    (i.options.getString as ReturnType<typeof vi.fn>).mockImplementation((name: string) =>
      name === 'set' ? 'BLB' : null,
    );

    await wantSealedCommand.autocomplete?.(i);

    expect(autocompleteSealedProducts).toHaveBeenCalledWith('bloom', 'BLB');
    expect(autocompleteSealedSets).not.toHaveBeenCalled();
    expect(i.respond).toHaveBeenCalledWith([
      { name: 'Bloomburrow Bundle', value: 'Bloomburrow Bundle' },
    ]);
  });

  it('autocomplete dispatches to autocompleteSealedSets for the set option', async () => {
    autocompleteSealedSets.mockReturnValue([{ name: 'BLB', value: 'BLB' }]);
    const i = autocompleteInteraction({ name: 'set', value: 'bl' });

    await wantSealedCommand.autocomplete?.(i);

    expect(autocompleteSealedSets).toHaveBeenCalledWith('bl');
    expect(autocompleteSealedProducts).not.toHaveBeenCalled();
    expect(i.respond).toHaveBeenCalledWith([{ name: 'BLB', value: 'BLB' }]);
  });
});
