import { beforeEach, describe, expect, it, vi } from 'vitest';
import { getDb } from '../../../src/db/index.js';
import { servers, type NewServerRow } from '../../../src/db/schema.js';
import { haveMultiCommand, handleHaveMultiModal } from '../../../src/commands/user/have-multi.js';
import * as scryfall from '../../../src/services/scryfall.js';
import * as sealed from '../../../src/services/sealed.js';
import { listings } from '../../../src/db/schema.js';
import { encodeMultiModalId, HAVE_MULTI_MODAL_ID } from '../../../src/utils/customId.js';
import { fakeChatInputInteraction, fakeModalSubmitInteraction } from '../../helpers/interaction.js';
import { setupTestDb } from '../../helpers/db.js';

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

const SEALED_MODAL_ID = encodeMultiModalId(HAVE_MULTI_MODAL_ID, 'sealed');

function resolvedProduct(name: string, hit = true) {
  return {
    productName: name,
    productNameNormalized: name.toLowerCase(),
    setCode: hit ? 'BLB' : null,
    uuid: hit ? `${name}-uuid` : null,
    category: hit ? 'bundle' : null,
    subtype: hit ? 'default' : null,
    manapoolUrl: hit ? 'https://manapool.com/sealed/blb/bundle' : null,
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
    manapoolUrl: null,
    manapoolPriceCents: null,
    resolved: ok,
  };
}

beforeEach(() => {
  getDb().insert(servers).values(serverRow).run();
  resolveCard.mockReset();
  resolveSealedProduct.mockReset();
});

describe('/have-multi execute', () => {
  it('shows the batch modal inside a guild', async () => {
    const i = fakeChatInputInteraction({});
    await haveMultiCommand.execute(i);

    expect(i.showModal).toHaveBeenCalledTimes(1);
  });

  it('replies instead of showing a modal outside a guild', async () => {
    const i = fakeChatInputInteraction({ guildId: null });
    await haveMultiCommand.execute(i);

    expect(i.showModal).not.toHaveBeenCalled();
    expect(i.reply).toHaveBeenCalledWith(
      expect.objectContaining({ content: expect.stringContaining('inside a server') }),
    );
  });
});

describe('handleHaveMultiModal', () => {
  it('posts every valid card in the batch', async () => {
    resolveCard.mockImplementation((name: string) => Promise.resolve(resolved(name)));
    const i = fakeModalSubmitInteraction({
      customId: HAVE_MULTI_MODAL_ID,
      fields: {
        card1: 'Black Lotus | nm | 2.50 | 2',
        card2: 'Lightning Bolt | lp | 1.00 | 1',
        card3: '',
        accepts: 'cash',
      },
    });

    await handleHaveMultiModal(i);

    expect(i.followUp).toHaveBeenCalledWith(
      expect.objectContaining({
        content: expect.stringMatching(/Black Lotus/),
      }),
    );
    expect(followUpContent(i)).toContain('Lightning Bolt');
  });

  it('posts the resolvable cards and reports the unresolvable one', async () => {
    resolveCard.mockImplementation((name: string) =>
      Promise.resolve(resolved(name, name !== 'Not A Card')),
    );
    const i = fakeModalSubmitInteraction({
      customId: HAVE_MULTI_MODAL_ID,
      fields: {
        card1: 'Black Lotus | nm | 2.50 | 2',
        card2: 'Not A Card | lp | 1.00 | 1',
        card3: '',
        accepts: 'cash',
      },
    });

    await handleHaveMultiModal(i);

    const message = followUpContent(i);
    expect(message).toContain('posted');
    expect(message).toContain('could not resolve "Not A Card"');
  });

  it('rejects an invalid accepts value before resolving any cards', async () => {
    const i = fakeModalSubmitInteraction({
      customId: HAVE_MULTI_MODAL_ID,
      fields: { card1: 'Black Lotus | nm | 2.50 | 2', card2: '', card3: '', accepts: 'bogus' },
    });

    await handleHaveMultiModal(i);

    expect(i.editReply).toHaveBeenCalledWith(
      expect.objectContaining({ content: expect.stringContaining('Invalid accepts') }),
    );
    expect(resolveCard).not.toHaveBeenCalled();
  });

  it('replies with "No cards were entered" for an empty submission', async () => {
    const i = fakeModalSubmitInteraction({
      customId: HAVE_MULTI_MODAL_ID,
      fields: { card1: '', card2: '', card3: '', accepts: 'cash' },
    });

    await handleHaveMultiModal(i);

    expect(i.editReply).toHaveBeenCalledWith(
      expect.objectContaining({ content: expect.stringContaining('No cards were entered') }),
    );
  });
});

describe('/have-multi sealed', () => {
  it('opens the sealed modal when type=sealed, and the card modal otherwise', async () => {
    const sealedInteraction = fakeChatInputInteraction({
      options: { strings: { type: 'sealed' } },
    });
    await haveMultiCommand.execute(sealedInteraction);
    const sealedModal = sealedInteraction.showModal.mock.calls[0]?.[0] as {
      data: { custom_id: string; title: string };
    };
    expect(sealedModal.data.custom_id).toBe(SEALED_MODAL_ID);
    expect(sealedModal.data.title).toContain('sealed');

    const cardInteraction = fakeChatInputInteraction({});
    await haveMultiCommand.execute(cardInteraction);
    const cardModal = cardInteraction.showModal.mock.calls[0]?.[0] as {
      data: { custom_id: string };
    };
    expect(cardModal.data.custom_id).toBe(encodeMultiModalId(HAVE_MULTI_MODAL_ID, 'card'));
  });

  it('posts sealed listings with the sealed columns and no condition', async () => {
    resolveSealedProduct.mockImplementation((name: string) =>
      Promise.resolve(resolvedProduct(name)),
    );
    const i = fakeModalSubmitInteraction({
      customId: SEALED_MODAL_ID,
      fields: {
        card1: 'Bloomburrow Bundle | 89.99 | 2',
        card2: '',
        card3: '',
        accepts: 'both',
      },
    });

    await handleHaveMultiModal(i);

    expect(followUpContent(i)).toContain('Product 1: posted');
    const row = getDb().select().from(listings).all()[0];
    expect(row?.kind).toBe('sealed');
    expect(row?.sealedUuid).toBe('Bloomburrow Bundle-uuid');
    expect(row?.sealedCategory).toBe('bundle');
    expect(row?.cardSet).toBe('BLB');
    expect(row?.priceCents).toBe(8999);
    expect(row?.quantity).toBe(2);
    expect(row?.condition).toBeNull();
    expect(row?.collectorNumber).toBeNull();
  });

  // The card path rejects an unresolved name; the sealed path must not.
  it('still posts a product that is not in the catalog', async () => {
    resolveSealedProduct.mockImplementation((name: string) =>
      Promise.resolve(resolvedProduct(name, false)),
    );
    const i = fakeModalSubmitInteraction({
      customId: SEALED_MODAL_ID,
      fields: { card1: 'Some Brand New Bundle | 50.00', card2: '', card3: '', accepts: 'cash' },
    });

    await handleHaveMultiModal(i);

    const message = followUpContent(i);
    expect(message).toContain('Product 1: posted');
    expect(message).not.toContain('could not resolve');
    const row = getDb().select().from(listings).all()[0];
    expect(row?.kind).toBe('sealed');
    expect(row?.manapoolUrl).toBeNull();
  });

  it('never calls the card resolver on a sealed submission', async () => {
    resolveSealedProduct.mockImplementation((name: string) =>
      Promise.resolve(resolvedProduct(name)),
    );
    const i = fakeModalSubmitInteraction({
      customId: SEALED_MODAL_ID,
      fields: { card1: 'Bloomburrow Bundle', card2: '', card3: '', accepts: 'cash' },
    });

    await handleHaveMultiModal(i);

    expect(resolveCard).not.toHaveBeenCalled();
  });

  it('reports a malformed sealed line with product wording', async () => {
    const i = fakeModalSubmitInteraction({
      customId: SEALED_MODAL_ID,
      fields: { card1: 'A | 1 | 2 | 3 | 4', card2: '', card3: '', accepts: 'cash' },
    });

    await handleHaveMultiModal(i);

    expect(i.editReply).toHaveBeenCalledWith(
      expect.objectContaining({ content: expect.stringContaining('Product 1:') }),
    );
  });

  it('says "No products were entered" for an empty sealed submission', async () => {
    const i = fakeModalSubmitInteraction({
      customId: SEALED_MODAL_ID,
      fields: { card1: '', card2: '', card3: '', accepts: 'cash' },
    });

    await handleHaveMultiModal(i);

    expect(i.editReply).toHaveBeenCalledWith(
      expect.objectContaining({ content: expect.stringContaining('No products were entered') }),
    );
  });
});
