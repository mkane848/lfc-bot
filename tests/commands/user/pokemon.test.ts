import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { EmbedBuilder } from 'discord.js';
import { getDb } from '../../../src/db/index.js';
import { listings } from '../../../src/db/schema.js';
import { editCommand, handleEditModal } from '../../../src/commands/user/edit.js';
import { haveCommand } from '../../../src/commands/user/have.js';
import { handleHaveMultiModal, haveMultiCommand } from '../../../src/commands/user/have-multi.js';
import { haveSealedCommand } from '../../../src/commands/user/have-sealed.js';
import { searchCommand } from '../../../src/commands/user/search.js';
import { wantCommand } from '../../../src/commands/user/want.js';
import { wantSealedCommand } from '../../../src/commands/user/want-sealed.js';
import { formatDigest } from '../../../src/services/digest.js';
import * as scryfall from '../../../src/services/scryfall.js';
import * as sealedService from '../../../src/services/sealed.js';
import {
  handleCardAutocomplete,
  handleSealedAutocomplete,
  handleSetAutocomplete,
} from '../../../src/utils/cards.js';
import { encodeEditModalId } from '../../../src/utils/customId.js';
import {
  fakeAutocompleteInteraction,
  fakeChatInputInteraction,
  fakeModalSubmitInteraction,
} from '../../helpers/interaction.js';
import { seedPokemonCatalog } from '../../helpers/catalog.js';
import { enableGames } from '../../helpers/games.js';
import { setupTestDb } from '../../helpers/db.js';

setupTestDb();

vi.mock('../../../src/services/scryfall.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../src/services/scryfall.js')>();
  return { ...actual, resolveCard: vi.fn(), autocompleteCards: vi.fn(), autocompleteSets: vi.fn() };
});

vi.mock('../../../src/services/sealed.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../src/services/sealed.js')>();
  return { ...actual, autocompleteSealedProducts: vi.fn(), autocompleteSealedSets: vi.fn() };
});

const resolveCard = vi.mocked(scryfall.resolveCard);
const autocompleteCards = vi.mocked(scryfall.autocompleteCards);
const autocompleteSealedProducts = vi.mocked(sealedService.autocompleteSealedProducts);
const autocompleteSealedSets = vi.mocked(sealedService.autocompleteSealedSets);

beforeEach(() => {
  seedPokemonCatalog();
  enableGames('guild-1', ['mtg', 'pokemon']);
  resolveCard.mockReset();
  autocompleteCards.mockReset();
  autocompleteCards.mockResolvedValue([]);
  autocompleteSealedProducts.mockReset();
  autocompleteSealedProducts.mockResolvedValue([]);
  autocompleteSealedSets.mockReset();
  autocompleteSealedSets.mockResolvedValue([]);
});

const post = (strings: Record<string, string | null>, command = haveCommand) => {
  const i = fakeChatInputInteraction({
    options: { strings: { accepts: 'cash', condition: 'nm', ...strings } },
  });
  return command.execute(i).then(() => i);
};

const stored = () => getDb().select().from(listings).all();
const errorOf = (i: Awaited<ReturnType<typeof post>>) =>
  (i.editReply.mock.calls.at(-1)?.[0] as { content: string }).content;
const embedOf = (i: Awaited<ReturnType<typeof post>>) =>
  (i.followUp.mock.calls[0]?.[0] as { embeds: EmbedBuilder[] }).embeds[0]!.toJSON();

describe('/have a Pokémon card', () => {
  it('posts a picked suggestion with its set, number, TCGplayer link, image and catalog id', async () => {
    const i = await post({ card_name: 'pkm:id:509879' });

    expect(resolveCard).not.toHaveBeenCalled();
    expect(stored()).toMatchObject([
      {
        game: 'pokemon',
        cardName: 'Charizard ex',
        cardNameNormalized: 'charizard ex',
        cardSet: 'OBF',
        collectorNumber: '125',
        marketUrl: 'https://www.tcgplayer.com/product/509879',
        cardImageUrl: 'https://tcgplayer-cdn.tcgplayer.com/product/509879_200w.jpg',
        catalogId: '509879',
        language: 'en',
      },
    ]);
    const embed = embedOf(i);
    expect(embed.url).toBe('https://www.tcgplayer.com/product/509879');
    expect(embed.thumbnail?.url).toBe(
      'https://tcgplayer-cdn.tcgplayer.com/product/509879_200w.jpg',
    );
    expect(embed.footer?.text).toBe('Listing #1 · Pokémon');
  });

  it('works untagged on a server that only has Pokémon', async () => {
    enableGames('guild-1', ['pokemon']);
    await post({ card_name: 'id:509879' });
    expect(stored()[0]).toMatchObject({ game: 'pokemon', catalogId: '509879' });
  });

  it('resolves a typed name with the set and collector number the member gave', async () => {
    await post({
      card_name: 'Charizard ex',
      game: 'pokemon',
      set: 'OBF',
      collector_number: '125',
    });
    expect(stored()[0]).toMatchObject({
      catalogId: '509879',
      cardSet: 'OBF',
      collectorNumber: '125',
    });
  });

  it('resolves a typed name against the newest English printing when nothing narrows it', async () => {
    await post({ card_name: 'Charizard ex', game: 'pokemon' });
    expect(stored()[0]).toMatchObject({ catalogId: '600001', cardSet: 'MEW' });
  });

  it('rejects a name the catalog does not have', async () => {
    const i = await post({ card_name: 'Not A Pokémon Card', game: 'pokemon' });
    expect(errorOf(i)).toMatch(/could not resolve that card name/);
    expect(stored()).toHaveLength(0);
  });

  it('keeps a printing qualifier in the name but lists under the base name', async () => {
    await post({ card_name: 'pkm:id:509880' });
    expect(stored()[0]).toMatchObject({
      cardName: 'Charizard ex (Full Art)',
      cardNameNormalized: 'charizard ex',
    });
  });

  it('posts a Japanese card in Japanese, and rejects a clashing language option', async () => {
    await post({ card_name: 'pkm:id:520002' });
    expect(stored()[0]).toMatchObject({ language: 'ja', cardSet: 'SV3', catalogId: '520002' });

    getDb().delete(listings).run();
    const i = await post({ card_name: 'pkm:id:520002', language: 'en' });
    expect(errorOf(i)).toMatch(/Japanese printing, but you chose English/);
    expect(stored()).toHaveLength(0);
  });

  it('lets an English card be posted in another language, since it is the same card', async () => {
    await post({ card_name: 'pkm:id:509879', language: 'de' });
    expect(stored()[0]?.language).toBe('de');
  });

  it('accepts reverse holo and holo, and rejects etched, which is Magic’s', async () => {
    await post({ card_name: 'pkm:id:509879', finish: 'reverse' });
    expect(stored()[0]?.finish).toBe('reverse');

    getDb().delete(listings).run();
    const etched = await post({ card_name: 'pkm:id:509879', finish: 'etched' });
    expect(errorOf(etched)).toBe(
      "Pokémon cards don't come in Etched. Choose Nonfoil, Foil, Reverse Holo.",
    );
  });

  it('rejects a printing variant, which only Magic has', async () => {
    const i = await post({ card_name: 'pkm:id:509879', variant: 'showcase' });
    expect(errorOf(i)).toMatch(/only apply to Magic/);
  });

  it('posts a graded slab', async () => {
    await post({ card_name: 'pkm:id:509879', condition: 'graded', grade: 'PSA 10' });
    expect(stored()[0]).toMatchObject({ condition: 'graded', gradingCompany: 'PSA', grade: '10' });
  });

  it('refuses a picked card that has since left the catalog', async () => {
    const i = await post({ card_name: 'pkm:id:424242' });
    expect(errorOf(i)).toMatch(/could not resolve/);
  });

  it('refuses Pokémon on a server that has not enabled it', async () => {
    enableGames('guild-1', ['mtg']);
    const i = await post({ card_name: 'pkm:id:509879' });
    expect(errorOf(i)).toMatch(/Pokémon is not enabled.*Enabled: Magic: The Gathering/);
    expect(stored()).toHaveLength(0);
  });

  it('keeps posting Magic cards as before on the same server', async () => {
    resolveCard.mockResolvedValue({
      scryfallId: 'lotus',
      cardName: 'Black Lotus',
      cardNameNormalized: 'black lotus',
      cardSet: 'LEA',
      cardImageUrl: null,
      collectorNumber: '232',
      marketUrl: null,
      resolved: true,
    });
    await post({ card_name: 'mtg:Black Lotus' });
    expect(stored()[0]).toMatchObject({ game: 'mtg', cardName: 'Black Lotus', language: 'en' });
  });
});

describe('/want a Pokémon card', () => {
  it('wants a card without a condition', async () => {
    await post({ card_name: 'pkm:id:509881', condition: null }, wantCommand);
    expect(stored()[0]).toMatchObject({
      intent: 'want',
      game: 'pokemon',
      cardName: 'Pikachu',
      condition: null,
    });
  });
});

describe('Pokémon sealed product', () => {
  const postSealed = (strings: Record<string, string | null>, command = haveSealedCommand) => {
    const i = fakeChatInputInteraction({
      options: { strings: { accepts: 'cash', ...strings } },
    });
    return command.execute(i).then(() => i);
  };

  it('posts a picked suggestion with its category, set, TCGplayer link and catalog id', async () => {
    const i = await postSealed({ product_name: 'pkm:id:501257' });

    expect(stored()).toMatchObject([
      {
        game: 'pokemon',
        kind: 'sealed',
        intent: 'have',
        cardName: 'Obsidian Flames Elite Trainer Box',
        cardNameNormalized: 'obsidian flames elite trainer box',
        cardSet: 'OBF',
        marketUrl: 'https://www.tcgplayer.com/product/501257',
        catalogId: '501257',
        sealedCategory: 'elite_trainer_box',
        sealedSubtype: null,
        language: 'en',
        condition: null,
      },
    ]);
    const embed = embedOf(i);
    expect(embed.url).toBe('https://www.tcgplayer.com/product/501257');
    expect(JSON.stringify(embed)).toContain('Elite Trainer Box');
    expect(embed.footer?.text).toBe('Listing #1 · Pokémon');
  });

  it('wants a typed product, narrowed by the set the member gave', async () => {
    await postSealed(
      { product_name: 'Booster Bundle', set: 'OBF', game: 'pokemon' },
      wantSealedCommand,
    );
    expect(stored()[0]).toMatchObject({
      intent: 'want',
      game: 'pokemon',
      catalogId: '501300',
      cardSet: 'OBF',
      sealedCategory: 'booster_bundle',
    });
  });

  it('takes a picked set the same way', async () => {
    await postSealed({ product_name: 'Booster Bundle', set: 'id:23229', game: 'pokemon' });
    expect(stored()[0]).toMatchObject({ catalogId: '601300', cardSet: 'MEW' });
  });

  it('posts a product the catalog does not have as free text with no link, like Magic’s', async () => {
    await postSealed({ product_name: 'Brand New Mystery Box', game: 'pokemon', set: 'OBF' });
    expect(stored()[0]).toMatchObject({
      game: 'pokemon',
      kind: 'sealed',
      cardName: 'Brand New Mystery Box',
      cardSet: 'OBF',
      marketUrl: null,
      catalogId: null,
      sealedCategory: null,
    });
  });

  it('refuses a picked product that has since left the catalog, rather than posting its id', async () => {
    const i = await postSealed({ product_name: 'pkm:id:424242' });
    expect(errorOf(i)).toMatch(/no longer in the catalog/);
    expect(stored()).toHaveLength(0);
  });

  it('posts a Japanese product in Japanese, and rejects a clashing language option', async () => {
    await postSealed({ product_name: 'pkm:id:520001' });
    expect(stored()[0]).toMatchObject({ language: 'ja', cardSet: 'SV3', catalogId: '520001' });

    getDb().delete(listings).run();
    const i = await postSealed({ product_name: 'pkm:id:520001', language: 'en' });
    expect(errorOf(i)).toMatch(/Japanese printing, but you chose English/);
    expect(stored()).toHaveLength(0);
  });

  it('looks a typed name up in the language the member chose', async () => {
    await postSealed({
      product_name: 'Ruler of the Black Flame Booster Box',
      game: 'pokemon',
      language: 'ja',
    });
    expect(stored()[0]).toMatchObject({ catalogId: '520001', language: 'ja' });

    getDb().delete(listings).run();
    await postSealed({
      product_name: 'Ruler of the Black Flame Booster Box',
      game: 'pokemon',
      language: 'de',
    });
    // No German version exists, and German is the English product, which this name isn't.
    expect(stored()[0]).toMatchObject({ catalogId: null, language: 'de', marketUrl: null });
  });

  it('refuses Pokémon sealed product on a server that has not enabled Pokémon', async () => {
    enableGames('guild-1', ['mtg']);
    const i = await postSealed({ product_name: 'pkm:id:501257' });
    expect(errorOf(i)).toMatch(/Pokémon is not enabled/);
    expect(stored()).toHaveLength(0);
  });

  it('opens a sealed modal for Pokémon, with the game in its id', async () => {
    const i = fakeChatInputInteraction({
      options: { strings: { type: 'sealed', game: 'pokemon' } },
    });
    await haveMultiCommand.execute(i);
    const modal = i.showModal.mock.calls[0]?.[0] as { data: { custom_id: string } };
    expect(modal.data.custom_id).toBe('lfc:havemultimodal:sealed:pokemon');
  });

  it('posts the lines of a sealed modal to Pokémon, each resolved on its own', async () => {
    const i = fakeModalSubmitInteraction({
      customId: 'lfc:havemultimodal:sealed:pokemon',
      fields: {
        card1: 'Obsidian Flames Elite Trainer Box | 54.99 | 2',
        card2: 'Mystery Tin | 20 | 1',
        card3: '',
        accepts: 'cash',
      },
    });
    await handleHaveMultiModal(i);
    expect(stored()).toMatchObject([
      { game: 'pokemon', catalogId: '501257', cardSet: 'OBF', quantity: 2, priceCents: 5499 },
      { game: 'pokemon', catalogId: null, cardName: 'Mystery Tin', marketUrl: null },
    ]);
  });

  it('still opens a card modal for Pokémon', async () => {
    const i = fakeChatInputInteraction({ options: { strings: { game: 'pokemon' } } });
    await haveMultiCommand.execute(i);
    const modal = i.showModal.mock.calls[0]?.[0] as { data: { custom_id: string } };
    expect(modal.data.custom_id).toBe('lfc:havemultimodal:card:pokemon');
  });
});

describe('autocomplete with Magic and Pokémon both enabled', () => {
  const typing = (value: string, strings: Record<string, string | null> = {}, name = 'card_name') =>
    fakeAutocompleteInteraction({ focused: { name, value }, strings });

  it('merges Magic’s and Pokémon’s suggestions, each tagged and named for its game', async () => {
    autocompleteCards.mockResolvedValue(['Charizard']);
    const i = typing('charizard 125');
    await handleCardAutocomplete(i);
    const sent = i.respond.mock.calls[0]?.[0] as Array<{ name: string; value: string }>;
    expect(sent).toEqual(
      expect.arrayContaining([
        { name: 'Charizard · MTG', value: 'mtg:Charizard' },
        { name: 'Charizard ex · OBF 125 · Pokémon', value: 'pkm:id:509879' },
      ]),
    );
    expect(sent.every((choice) => choice.name.length <= 100 && choice.value.length <= 100)).toBe(
      true,
    );
  });

  it('narrows Pokémon’s suggestions to the language already chosen', async () => {
    const i = typing('charizard', { language: 'ja', game: 'pokemon' });
    await handleCardAutocomplete(i);
    expect(i.respond).toHaveBeenCalledWith([
      { name: 'Charizard ex · SV3 134 · JA · Pokémon', value: 'pkm:id:520002' },
    ]);
  });

  it('merges Magic’s and Pokémon’s sealed product too, Pokémon’s tagged with its id', async () => {
    const onlyPokemon = typing('elite trainer', {}, 'product_name');
    await handleSealedAutocomplete(onlyPokemon);
    expect(onlyPokemon.respond).toHaveBeenCalledWith([
      { name: 'Obsidian Flames Elite Trainer Box · OBF · Pokémon', value: 'pkm:id:501257' },
    ]);

    autocompleteSealedProducts.mockResolvedValue([
      { name: 'Flames Bundle (FLM)', value: 'uuid:abc' },
    ]);
    const both = typing('bundle', {}, 'product_name');
    await handleSealedAutocomplete(both);
    const sent = both.respond.mock.calls[0]?.[0] as Array<{ name: string; value: string }>;
    expect(sent).toEqual(
      expect.arrayContaining([
        { name: 'Flames Bundle (FLM) · MTG', value: 'mtg:uuid:abc' },
        { name: 'Booster Bundle · OBF · Pokémon', value: 'pkm:id:501300' },
        { name: 'Booster Bundle · MEW · Pokémon', value: 'pkm:id:601300' },
      ]),
    );
  });

  it('keeps Pokémon’s sealed suggestions to the set already picked', async () => {
    const i = typing('booster bundle', { set: 'id:23229', game: 'pokemon' }, 'product_name');
    await handleSealedAutocomplete(i);
    expect(i.respond).toHaveBeenCalledWith([
      { name: 'Booster Bundle · MEW · Pokémon', value: 'pkm:id:601300' },
    ]);
  });

  it('asks for the set option’s suggestions among sets that have sealed product', async () => {
    const i = typing('sealed only', { product_name: 'pkm:id:930001' }, 'set');
    await handleSetAutocomplete(i, 'sealed');
    expect(i.respond).toHaveBeenCalledWith([{ name: 'Sealed Only Set (SOS)', value: 'id:23600' }]);
  });

  it('suggests Pokémon sets for the set option once the card or game is Pokémon', async () => {
    const byCard = typing('obf', { card_name: 'pkm:id:509879' }, 'set');
    await handleSetAutocomplete(byCard);
    expect(byCard.respond).toHaveBeenCalledWith([
      { name: 'Obsidian Flames (OBF)', value: 'id:23228' },
    ]);

    const byGame = typing('black', { game: 'pokemon' }, 'set');
    await handleSetAutocomplete(byGame);
    expect(byGame.respond).toHaveBeenCalledWith([
      { name: 'Ruler of the Black Flame (SV3 · JA)', value: 'id:23400' },
    ]);
  });

  it('takes a picked set into the card lookup, so the member lands on that set’s printing', async () => {
    await post({ card_name: 'Charizard ex', game: 'pokemon', set: 'id:23228' });
    expect(stored()[0]).toMatchObject({ catalogId: '509879', cardSet: 'OBF' });
  });
});

describe('/search for a Pokémon card', () => {
  const search = async (strings: Record<string, string | null>) => {
    const i = fakeChatInputInteraction({ options: { strings } });
    await searchCommand.execute(i);
    return i;
  };
  const resultFields = (i: Awaited<ReturnType<typeof search>>) =>
    (
      (i.reply.mock.calls[0]?.[0] as { embeds: EmbedBuilder[] }).embeds[0]!.toJSON().fields ?? []
    ).map((field) => field.name);

  it('finds every printing of a card by its base name, whichever printing was picked', async () => {
    await post({ card_name: 'pkm:id:509879' });
    getDb().update(listings).set({ createdAt: 1 }).run();
    await post({ card_name: 'pkm:id:509880' });

    const viaFullArt = await search({ card_name: 'pkm:id:509880' });
    expect(resultFields(viaFullArt)).toHaveLength(2);

    const typed = await search({ card_name: 'charizard ex' });
    expect(resultFields(typed)).toHaveLength(2);
  });

  it('titles the results with the card’s name, not the suggestion’s id', async () => {
    await post({ card_name: 'pkm:id:509879' });
    const i = await search({ card_name: 'pkm:id:509879' });
    expect(
      (i.reply.mock.calls[0]?.[0] as { embeds: EmbedBuilder[] }).embeds[0]!.toJSON().title,
    ).toBe('Search results: Charizard ex');
  });

  it('finds Nidoran by the sign a member types', async () => {
    await post({ card_name: 'pkm:id:600003' });
    expect(resultFields(await search({ card_name: 'Nidoran♀' }))).toHaveLength(1);
    const male = await search({ card_name: 'Nidoran♂' });
    expect(male.reply).toHaveBeenCalledWith(
      expect.objectContaining({ content: expect.stringContaining('No active listings') }),
    );
  });
});

describe('/edit a Pokémon listing', () => {
  const fields = (set: string) => ({ condition: 'nm', price: '', quantity: '', set, notes: '' });
  const edit = async (id: number, set: string) => {
    const i = fakeModalSubmitInteraction({
      customId: encodeEditModalId(id),
      userId: 'user-1',
      fields: fields(set),
    });
    await handleEditModal(i);
    return i;
  };

  it('re-resolves the card in the new set and updates its number, link and catalog id', async () => {
    await post({ card_name: 'pkm:id:509879' });
    const id = stored()[0]!.id;

    const i = await edit(id, 'mew');

    expect(i.editReply).toHaveBeenCalledWith(
      expect.objectContaining({ content: expect.stringContaining('updated') }),
    );
    expect(stored()[0]).toMatchObject({
      cardSet: 'MEW',
      collectorNumber: '006',
      catalogId: '600001',
      marketUrl: 'https://www.tcgplayer.com/product/600001',
    });
  });

  it('keeps a Japanese listing in Japanese when its set changes', async () => {
    await post({ card_name: 'pkm:id:520002' });
    const id = stored()[0]!.id;

    // The only Charizard ex of Japanese sets is in SV3, so a move to an English
    // set has nothing in Japanese to land on.
    const i = await edit(id, 'obf');

    expect(i.editReply).toHaveBeenCalledWith(
      expect.objectContaining({ content: expect.stringContaining('Could not find') }),
    );
    expect(stored()[0]).toMatchObject({ cardSet: 'SV3', language: 'ja', catalogId: '520002' });
  });

  it('leaves the listing alone when the card is not in the new set', async () => {
    await post({ card_name: 'pkm:id:509879' });
    const i = await edit(stored()[0]!.id, 'sv3');
    expect(i.editReply).toHaveBeenCalledWith(
      expect.objectContaining({ content: expect.stringContaining('Could not find') }),
    );
    expect(stored()[0]?.cardSet).toBe('OBF');
  });

  it('opens the same edit modal, with the set that round-trips', async () => {
    await post({ card_name: 'pkm:id:509879' });
    const i = fakeChatInputInteraction({
      userId: 'user-1',
      options: { integers: { listing_id: stored()[0]!.id } },
    });
    await editCommand.execute(i);
    const modal = i.showModal.mock.calls[0]?.[0] as {
      toJSON: () => {
        components: Array<{ components: Array<{ custom_id: string; value?: string }> }>;
      };
    };
    const set = modal
      .toJSON()
      .components.flatMap((row) => row.components)
      .find((component) => component.custom_id === 'set');
    expect(set?.value).toBe('OBF');
  });
});

describe('a Pokémon listing in a digest', () => {
  it('links to TCGplayer, labelled as such, and names the game on a multi-game server', async () => {
    await post({ card_name: 'pkm:id:509879' });
    const text = formatDigest(stored(), { showGame: true });
    expect(text).toContain('Charizard ex (OBF) — NM — Pokémon — ');
    expect(text).toContain('[View on TCGplayer](https://www.tcgplayer.com/product/509879)');
    expect(text).not.toContain('Manapool');
  });
});

describe('/edit a Pokémon sealed listing', () => {
  const edit = async (id: number, set: string) => {
    const i = fakeModalSubmitInteraction({
      customId: encodeEditModalId(id),
      userId: 'user-1',
      // A sealed modal has no condition row.
      fields: { price: '', quantity: '', set, notes: '' },
    });
    await handleEditModal(i);
    return i;
  };
  const postSealed = async (productName: string) => {
    const i = fakeChatInputInteraction({
      options: { strings: { product_name: productName, accepts: 'cash' } },
    });
    await haveSealedCommand.execute(i);
  };

  it('re-resolves the product in the new set and updates its link, category and catalog id', async () => {
    await postSealed('pkm:id:501300');
    const id = stored()[0]!.id;

    const i = await edit(id, 'mew');

    expect(i.editReply).toHaveBeenCalledWith(
      expect.objectContaining({ content: expect.stringContaining('updated') }),
    );
    expect(stored()[0]).toMatchObject({
      cardSet: 'MEW',
      catalogId: '601300',
      marketUrl: 'https://www.tcgplayer.com/product/601300',
      sealedCategory: 'booster_bundle',
    });
  });

  it('writes the free-text result when the product is not in the new set, as Magic’s does', async () => {
    await postSealed('pkm:id:501257');
    const id = stored()[0]!.id;

    await edit(id, 'mew');

    expect(stored()[0]).toMatchObject({
      cardSet: 'MEW',
      cardName: 'Obsidian Flames Elite Trainer Box',
      catalogId: null,
      marketUrl: null,
      sealedCategory: null,
    });
  });

  it('keeps a Japanese product in Japanese when its set changes', async () => {
    await postSealed('pkm:id:520010');
    const id = stored()[0]!.id;

    await edit(id, 'obf');

    // OBF has an English "Booster Bundle" but no Japanese one, so the edit must not
    // move the listing onto the English product.
    expect(stored()[0]).toMatchObject({ catalogId: null, language: 'ja', marketUrl: null });
  });
});

describe('a Pokémon sealed listing in a digest', () => {
  it('links to TCGplayer and names the game on a multi-game server', async () => {
    const i = fakeChatInputInteraction({
      options: { strings: { product_name: 'pkm:id:501257', accepts: 'cash' } },
    });
    await haveSealedCommand.execute(i);
    const text = formatDigest(stored(), { showGame: true });
    expect(text).toContain('Obsidian Flames Elite Trainer Box');
    expect(text).toContain('[View on TCGplayer](https://www.tcgplayer.com/product/501257)');
    expect(text).not.toContain('Manapool');
  });
});
