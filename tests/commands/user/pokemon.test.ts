import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { EmbedBuilder } from 'discord.js';
import { getDb } from '../../../src/db/index.js';
import { listings } from '../../../src/db/schema.js';
import { editCommand, handleEditModal } from '../../../src/commands/user/edit.js';
import { haveCommand } from '../../../src/commands/user/have.js';
import { haveMultiCommand } from '../../../src/commands/user/have-multi.js';
import { haveSealedCommand } from '../../../src/commands/user/have-sealed.js';
import { searchCommand } from '../../../src/commands/user/search.js';
import { wantCommand } from '../../../src/commands/user/want.js';
import { wantSealedCommand } from '../../../src/commands/user/want-sealed.js';
import { formatDigest } from '../../../src/services/digest.js';
import * as scryfall from '../../../src/services/scryfall.js';
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

const resolveCard = vi.mocked(scryfall.resolveCard);
const autocompleteCards = vi.mocked(scryfall.autocompleteCards);

beforeEach(() => {
  seedPokemonCatalog();
  enableGames('guild-1', ['mtg', 'pokemon']);
  resolveCard.mockReset();
  autocompleteCards.mockReset();
  autocompleteCards.mockResolvedValue([]);
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

describe('Pokémon sealed product is not offered yet', () => {
  it('turns /have-sealed and /want-sealed away with a message, posting nothing', async () => {
    for (const command of [haveSealedCommand, wantSealedCommand]) {
      const i = fakeChatInputInteraction({
        options: { strings: { product_name: 'pkm:id:501256', accepts: 'cash' } },
      });
      await command.execute(i);
      expect(errorOf(i)).toBe("Pokémon doesn't have sealed product here yet.");
    }
    expect(stored()).toHaveLength(0);
  });

  it('turns /have-multi away before opening a sealed modal for Pokémon', async () => {
    const i = fakeChatInputInteraction({
      options: { strings: { type: 'sealed', game: 'pokemon' } },
    });
    await haveMultiCommand.execute(i);
    expect(i.showModal).not.toHaveBeenCalled();
    expect(i.reply).toHaveBeenCalledWith(
      expect.objectContaining({ content: "Pokémon doesn't have sealed product here yet." }),
    );
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

  it('suggests only Magic’s sealed product, since Pokémon has none yet', async () => {
    const i = typing('flames', {}, 'product_name');
    await handleSealedAutocomplete(i);
    const sent = i.respond.mock.calls[0]?.[0] as Array<{ value: string }>;
    expect(sent.some((choice) => choice.value.startsWith('pkm:'))).toBe(false);
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
