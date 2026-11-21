import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { getDb } from '../../../src/db/index.js';
import { servers, type NewServerRow } from '../../../src/db/schema.js';
import { wantMultiCommand, handleWantMultiModal } from '../../../src/commands/user/want-multi.js';
import * as scryfall from '../../../src/services/scryfall.js';
import * as sealed from '../../../src/services/sealed.js';
import { listings } from '../../../src/db/schema.js';
import { encodeMultiModalId, WANT_MULTI_MODAL_ID } from '../../../src/utils/customId.js';
import { fakeChatInputInteraction, fakeModalSubmitInteraction } from '../../helpers/interaction.js';
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
  return { ...actual, resolveCard: vi.fn() };
});

vi.mock('../../../src/services/sealed.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../src/services/sealed.js')>();
  return { ...actual, resolveSealedProduct: vi.fn() };
});

const resolveCard = vi.mocked(scryfall.resolveCard);
const resolveSealedProduct = vi.mocked(sealed.resolveSealedProduct);

const SEALED_MODAL_ID = encodeMultiModalId(WANT_MULTI_MODAL_ID, 'sealed');

function resolvedProduct(name: string, hit = true) {
  return {
    productName: name,
    productNameNormalized: name.toLowerCase(),
    setCode: hit ? 'BLB' : null,
    uuid: hit ? `${name}-uuid` : null,
    category: hit ? 'bundle' : null,
    subtype: hit ? 'default' : null,
    marketUrl: hit ? 'https://manapool.com/sealed/blb/bundle' : null,
    resolved: hit,
  };
}

function followUpContent(i: ReturnType<typeof fakeModalSubmitInteraction>): string {
  const call = i.followUp.mock.calls[0]?.[0] as { content: string };
  return call.content;
}

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

function resolved(name: string, ok = true) {
  return {
    scryfallId: ok ? `${name}-id` : null,
    cardName: name,
    cardNameNormalized: name.toLowerCase(),
    cardSet: ok ? 'LEA' : null,
    cardImageUrl: ok ? 'http://img/x.png' : null,
    collectorNumber: ok ? '1' : null,
    marketUrl: null,
    manapoolPriceCents: null,
    resolved: ok,
  };
}

beforeEach(() => {
  getDb().insert(servers).values(serverRow).run();
  resolveCard.mockReset();
  resolveSealedProduct.mockReset();
});

describe('/want-multi execute', () => {
  it('shows the batch modal inside a guild', async () => {
    const i = fakeChatInputInteraction({});
    await wantMultiCommand.execute(i);

    expect(i.showModal).toHaveBeenCalledTimes(1);
  });

  it('replies instead of showing a modal outside a guild', async () => {
    const i = fakeChatInputInteraction({ guildId: null });
    await wantMultiCommand.execute(i);

    expect(i.showModal).not.toHaveBeenCalled();
    expect(i.reply).toHaveBeenCalledWith(
      expect.objectContaining({ content: expect.stringContaining('inside a server') }),
    );
  });
});

describe('handleWantMultiModal', () => {
  it('posts every valid card in the batch', async () => {
    resolveCard.mockImplementation((name: string) => Promise.resolve(resolved(name)));
    const i = fakeModalSubmitInteraction({
      customId: WANT_MULTI_MODAL_ID,
      fields: {
        card1: 'Solitude | nm | 15.00',
        card2: 'Lightning Bolt | lp | 1.00',
        card3: '',
        accepts: 'cash',
      },
    });

    await handleWantMultiModal(i);

    const message = followUpContent(i);
    expect(message).toContain('Solitude');
    expect(message).toContain('Lightning Bolt');
  });

  it('posts the resolvable cards and reports the unresolvable one', async () => {
    resolveCard.mockImplementation((name: string) =>
      Promise.resolve(resolved(name, name !== 'Not A Card')),
    );
    const i = fakeModalSubmitInteraction({
      customId: WANT_MULTI_MODAL_ID,
      fields: {
        card1: 'Solitude | nm | 15.00',
        card2: 'Not A Card | lp | 1.00',
        card3: '',
        accepts: 'cash',
      },
    });

    await handleWantMultiModal(i);

    const message = followUpContent(i);
    expect(message).toContain('posted');
    expect(message).toContain('could not resolve "Not A Card"');
  });

  it('rejects an invalid accepts value before resolving any cards', async () => {
    const i = fakeModalSubmitInteraction({
      customId: WANT_MULTI_MODAL_ID,
      fields: { card1: 'Solitude | nm | 15.00', card2: '', card3: '', accepts: 'bogus' },
    });

    await handleWantMultiModal(i);

    expect(i.editReply).toHaveBeenCalledWith(
      expect.objectContaining({ content: expect.stringContaining('Invalid accepts') }),
    );
    expect(resolveCard).not.toHaveBeenCalled();
  });

  it('replies with "No cards were entered" for an empty submission', async () => {
    const i = fakeModalSubmitInteraction({
      customId: WANT_MULTI_MODAL_ID,
      fields: { card1: '', card2: '', card3: '', accepts: 'cash' },
    });

    await handleWantMultiModal(i);

    expect(i.editReply).toHaveBeenCalledWith(
      expect.objectContaining({ content: expect.stringContaining('No cards were entered') }),
    );
  });
});

describe('/want-multi sealed', () => {
  it('opens the sealed modal when type=sealed', async () => {
    const i = fakeChatInputInteraction({ options: { strings: { type: 'sealed' } } });
    await wantMultiCommand.execute(i);

    const modal = i.showModal.mock.calls[0]?.[0] as { data: { custom_id: string; title: string } };
    expect(modal.data.custom_id).toBe(SEALED_MODAL_ID);
    expect(modal.data.title).toContain('sealed');
  });

  it('posts a sealed want with max_price in price_cents and no quantity column', async () => {
    resolveSealedProduct.mockImplementation((name: string) =>
      Promise.resolve(resolvedProduct(name)),
    );
    const i = fakeModalSubmitInteraction({
      customId: SEALED_MODAL_ID,
      fields: { card1: 'Bloomburrow Bundle | 100.00', card2: '', card3: '', accepts: 'cash' },
    });

    await handleWantMultiModal(i);

    expect(followUpContent(i)).toContain('Product 1: posted');
    const row = getDb().select().from(listings).all()[0];
    expect(row?.kind).toBe('sealed');
    expect(row?.intent).toBe('want');
    expect(row?.priceCents).toBe(10000);
    expect(row?.quantity).toBe(1);
    expect(row?.condition).toBeNull();
    expect(row?.sealedCategory).toBe('bundle');
  });

  it('still posts a product that is not in the catalog', async () => {
    resolveSealedProduct.mockImplementation((name: string) =>
      Promise.resolve(resolvedProduct(name, false)),
    );
    const i = fakeModalSubmitInteraction({
      customId: SEALED_MODAL_ID,
      fields: { card1: 'Some Brand New Bundle', card2: '', card3: '', accepts: 'cash' },
    });

    await handleWantMultiModal(i);

    const message = followUpContent(i);
    expect(message).toContain('Product 1: posted');
    expect(message).not.toContain('could not resolve');
  });

  it('reports a malformed sealed line via failures and posts the resolvable one', async () => {
    resolveSealedProduct.mockImplementation((name: string) =>
      Promise.resolve(resolvedProduct(name)),
    );
    const i = fakeModalSubmitInteraction({
      customId: SEALED_MODAL_ID,
      fields: { card1: 'NoPipeSegments', card2: 'Bloomburrow Bundle', card3: '', accepts: 'cash' },
    });

    await handleWantMultiModal(i);

    const message = followUpContent(i);
    expect(message).toContain('Product 2');
    expect(message).toContain('Product 1');
  });

  it('says "No products were entered" for an empty sealed submission', async () => {
    const i = fakeModalSubmitInteraction({
      customId: SEALED_MODAL_ID,
      fields: { card1: '', card2: '', card3: '', accepts: 'cash' },
    });

    await handleWantMultiModal(i);

    expect(i.editReply).toHaveBeenCalledWith(
      expect.objectContaining({ content: expect.stringContaining('No products were entered') }),
    );
  });

  it('never calls the card resolver on a sealed submission', async () => {
    resolveSealedProduct.mockImplementation((name: string) =>
      Promise.resolve(resolvedProduct(name)),
    );
    const i = fakeModalSubmitInteraction({
      customId: SEALED_MODAL_ID,
      fields: { card1: 'Bloomburrow Bundle', card2: '', card3: '', accepts: 'cash' },
    });

    await handleWantMultiModal(i);

    expect(resolveCard).not.toHaveBeenCalled();
  });

  it('reports a malformed card line via failures and posts the resolvable one alongside', async () => {
    resolveCard.mockImplementation((name: string) => Promise.resolve(resolved(name)));
    const i = fakeModalSubmitInteraction({
      customId: WANT_MULTI_MODAL_ID,
      fields: {
        card1: 'NoPipeSegments',
        card2: 'Brainstorm | nm | 5.00',
        card3: '',
        accepts: 'cash',
      },
    });

    await handleWantMultiModal(i);

    const message = followUpContent(i);
    expect(message).toContain('Card 1');
    expect(message).toContain('Card 2');
  });

  it('uses sort + replyPublicText when there are no failures and no warnings', async () => {
    resolveCard.mockImplementation((name: string) => Promise.resolve(resolved(name)));
    const i = fakeModalSubmitInteraction({
      customId: WANT_MULTI_MODAL_ID,
      fields: { card1: 'Brainstorm | nm | 5.00', card2: '', card3: '', accepts: 'cash' },
    });

    await handleWantMultiModal(i);

    const message = followUpContent(i);
    expect(message).toContain('Card 1');
  });

  it('uses singular phrasing when exactly one listing is created', async () => {
    resolveCard.mockImplementation((name: string) => Promise.resolve(resolved(name)));
    const i = fakeModalSubmitInteraction({
      customId: WANT_MULTI_MODAL_ID,
      fields: { card1: 'Brainstorm | nm | 5.00', card2: '', card3: '', accepts: 'cash' },
    });

    await handleWantMultiModal(i);

    const message = followUpContent(i);
    expect(message).toMatch(/^Product 1|^Card 1/);
  });
});

describe('/want-multi game, language and grade', () => {
  let fake: GameDefinition;

  beforeEach(() => {
    fake = registerFakeGame();
    enableGames('guild-1', ['mtg', FAKE_GAME_ID]);
  });

  afterEach(() => {
    unregisterFakeGame();
  });

  const stored = () => getDb().select().from(listings).all();

  it('carries a chosen game and language in the modal id', async () => {
    const i = fakeChatInputInteraction({
      options: { strings: { type: 'sealed', game: FAKE_GAME_ID, language: 'de' } },
    });
    await wantMultiCommand.execute(i);
    const modal = i.showModal.mock.calls[0]?.[0] as { data: { custom_id: string } };
    expect(modal.data.custom_id).toBe('lfc:wantmultimodal:sealed:fake:de');
  });

  it('wants every line from the game and in the language the modal was opened with', async () => {
    const i = fakeModalSubmitInteraction({
      customId: 'lfc:wantmultimodal:card:fake:ja',
      fields: { card1: 'Fake Card | PSA 9 | 80', card2: '', card3: '', accepts: 'cash' },
    });
    await handleWantMultiModal(i);
    expect(fake.resolveCard).toHaveBeenCalledWith('Fake Card', {});
    expect(stored()).toMatchObject([
      {
        intent: 'want',
        game: FAKE_GAME_ID,
        language: 'ja',
        condition: 'graded',
        gradingCompany: 'PSA',
        grade: '9',
        priceCents: 8000,
      },
    ]);
  });

  it('refuses a submission whose game was disabled after the modal opened', async () => {
    enableGames('guild-1', ['mtg']);
    const i = fakeModalSubmitInteraction({
      customId: 'lfc:wantmultimodal:card:fake',
      fields: { card1: 'Fake Card', card2: '', card3: '', accepts: 'cash' },
    });
    await handleWantMultiModal(i);
    expect(i.editReply).toHaveBeenCalledWith(
      expect.objectContaining({ content: expect.stringContaining('Fake Game is not enabled') }),
    );
    expect(stored()).toHaveLength(0);
  });
});

describe('/want-multi edge branches', () => {
  it('rejects an invalid universal option before opening the modal', async () => {
    const i = fakeChatInputInteraction({ options: { strings: { language: 'xx' } } });

    await wantMultiCommand.execute(i);

    expect(i.showModal).not.toHaveBeenCalled();
    expect(i.reply).toHaveBeenCalledWith(
      expect.objectContaining({ content: expect.stringContaining('Invalid language') }),
    );
  });

  it('refuses to open the modal for a game the server has not enabled', async () => {
    registerFakeGame();
    const i = fakeChatInputInteraction({ options: { strings: { game: FAKE_GAME_ID } } });

    await wantMultiCommand.execute(i);

    expect(i.showModal).not.toHaveBeenCalled();
    expect(i.reply).toHaveBeenCalledWith(
      expect.objectContaining({ content: expect.stringContaining('not enabled') }),
    );
    unregisterFakeGame();
  });

  it('replies when the modal is submitted outside a guild', async () => {
    const i = fakeModalSubmitInteraction({
      customId: WANT_MULTI_MODAL_ID,
      guildId: null,
      fields: { accepts: 'cash' },
    });

    await handleWantMultiModal(i);

    expect(i.reply).toHaveBeenCalledWith(
      expect.objectContaining({ content: expect.stringContaining('inside a server') }),
    );
  });

  it('reports a malformed line and still posts the good ones', async () => {
    resolveCard.mockResolvedValue(resolved('Brainstorm'));
    const i = fakeModalSubmitInteraction({
      customId: WANT_MULTI_MODAL_ID,
      fields: {
        card1: 'Too | many | parts | here',
        card2: 'Brainstorm | nm | 5.00',
        card3: '',
        accepts: 'cash',
      },
    });

    await handleWantMultiModal(i);

    const content = followUpContent(i);
    expect(content).toContain('Card 1:');
    expect(content).toContain('posted');
  });

  it('replies with every failure when no line is usable', async () => {
    const i = fakeModalSubmitInteraction({
      customId: WANT_MULTI_MODAL_ID,
      fields: {
        card1: 'a | b | c | d',
        card2: 'e | f | g | h',
        card3: '',
        accepts: 'cash',
      },
    });

    await handleWantMultiModal(i);

    const reply = i.editReply.mock.calls[0]?.[0] as { content: string };
    expect(reply.content).toContain('Use the format');
  });

  it('reports the cooldown error when the batch cannot be posted', async () => {
    getDb()
      .insert(listings)
      .values({
        serverId: 'guild-1',
        userId: 'user-1',
        username: 'alice',
        intent: 'want',
        accepts: 'cash',
        game: 'mtg',
        language: 'en',
        cardName: 'Brainstorm',
        cardNameNormalized: 'brainstorm',
        status: 'active',
        expiresAt: Date.now() + 1000,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      })
      .run();
    resolveCard.mockResolvedValue(resolved('Brainstorm'));
    const i = fakeModalSubmitInteraction({
      customId: WANT_MULTI_MODAL_ID,
      fields: { card1: 'Brainstorm | nm | 5.00', card2: '', card3: '', accepts: 'cash' },
    });

    await handleWantMultiModal(i);

    const reply = i.editReply.mock.calls[0]?.[0] as { content: string };
    expect(reply.content).toMatch(/too quickly/);
  });

  it('notes a duplicate listing on the posted line', async () => {
    getDb()
      .insert(listings)
      .values({
        serverId: 'guild-1',
        userId: 'user-1',
        username: 'alice',
        intent: 'want',
        accepts: 'cash',
        game: 'mtg',
        language: 'en',
        cardName: 'Brainstorm',
        cardNameNormalized: 'brainstorm',
        collectorNumber: '1',
        condition: 'nm',
        priceCents: 500,
        status: 'active',
        expiresAt: Date.now() + 1000,
        createdAt: Date.now() - 60_000,
        updatedAt: Date.now() - 60_000,
      })
      .run();
    resolveCard.mockResolvedValue(resolved('Brainstorm'));
    const i = fakeModalSubmitInteraction({
      customId: WANT_MULTI_MODAL_ID,
      fields: { card1: 'Brainstorm | nm | 5.00', card2: '', card3: '', accepts: 'cash' },
    });

    await handleWantMultiModal(i);

    expect(followUpContent(i)).toMatch(/already have an active matching listing/);
  });
});

it('reports a malformed line alongside a batch that could not be posted', async () => {
  getDb()
    .insert(listings)
    .values({
      serverId: 'guild-1',
      userId: 'user-1',
      username: 'alice',
      intent: 'want',
      accepts: 'cash',
      game: 'mtg',
      language: 'en',
      cardName: 'Brainstorm',
      cardNameNormalized: 'brainstorm',
      status: 'active',
      expiresAt: Date.now() + 1000,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    })
    .run();
  resolveCard.mockResolvedValue(resolved('Brainstorm'));
  const i = fakeModalSubmitInteraction({
    customId: WANT_MULTI_MODAL_ID,
    fields: {
      card1: 'Too | many | parts | here',
      card2: 'Brainstorm | nm | 5.00',
      card3: '',
      accepts: 'cash',
    },
  });

  await handleWantMultiModal(i);

  const reply = i.editReply.mock.calls[0]?.[0] as { content: string };
  expect(reply.content).toContain('Use the format');
  expect(reply.content).toMatch(/too quickly/);
});
