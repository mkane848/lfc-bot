import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { getDb } from '../../../src/db/index.js';
import {
  listings,
  servers,
  type NewListingRow,
  type NewServerRow,
} from '../../../src/db/schema.js';
import {
  buildEditModal,
  editCommand,
  handleEditModal,
  handleEditNextButton,
} from '../../../src/commands/user/edit.js';
import { getListingById } from '../../../src/services/listings.js';
import { encodeEditModalId, encodeEditNextId } from '../../../src/utils/customId.js';
import * as scryfall from '../../../src/services/scryfall.js';
import * as sealed from '../../../src/services/sealed.js';
import {
  fakeButtonInteraction,
  fakeChatInputInteraction,
  fakeModalSubmitInteraction,
  type FakeModalSubmitInteraction,
} from '../../helpers/interaction.js';
import { setupTestDb } from '../../helpers/db.js';
import { FAKE_GAME_ID, registerFakeGame, unregisterFakeGame } from '../../helpers/games.js';
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
    marketUrl: null,
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
  // Module-level `vi.mock` factories are not auto-reset in this suite, so both
  // service doubles must be cleared explicitly between tests.
  resolveCard.mockReset();
  resolveSealedProduct.mockReset();
});

/** Seed a sealed listing: no condition, sealed metadata populated. */
function seedSealedListing(overrides: Partial<NewListingRow> = {}): number {
  return seedListing({
    kind: 'sealed',
    cardName: 'Bloomburrow Bundle',
    cardNameNormalized: 'bloomburrow bundle',
    cardSet: 'BLB',
    condition: null,
    catalogId: 'uuid-blb-bundle',
    sealedCategory: 'bundle',
    sealedSubtype: 'default',
    marketUrl: 'https://manapool.com/sealed/blb/bundle',
    ...overrides,
  });
}

/** The `custom_id`s of a modal's text inputs, in row order. */
function modalFieldIds(modal: ReturnType<typeof buildEditModal>): string[] {
  const json = modal.toJSON() as unknown as {
    components: Array<{ components: Array<{ custom_id: string }> }>;
  };
  return json.components.flatMap((row) => row.components.map((component) => component.custom_id));
}

/**
 * Replace the mock's forgiving `getTextInputValue` (which returns `''` for an
 * absent field) with discord.js's real behavior: it THROWS when the submission
 * has no such field. Without this, a handler that reads `condition` off a
 * sealed modal would pass the test while breaking in production — this is what
 * makes the sealed-submit regression guard below meaningful.
 */
function withStrictFields(
  interaction: FakeModalSubmitInteraction,
  fields: Record<string, string>,
): FakeModalSubmitInteraction {
  interaction.fields.getTextInputValue = vi.fn((name: string) => {
    if (!(name in fields)) {
      throw new TypeError(`Required field with custom id "${name}" not found.`);
    }
    return fields[name]!;
  });
  return interaction;
}

/** The fields a sealed modal actually submits: everything except `condition`. */
const sealedFields = { price: '', quantity: '', set: 'BLB', notes: '' };

const resolvedProduct = {
  productName: 'Murders at Karlov Manor Bundle',
  productNameNormalized: 'murders at karlov manor bundle',
  setCode: 'MKM',
  uuid: 'uuid-mkm-bundle',
  category: 'bundle',
  subtype: 'gift_edition',
  marketUrl: 'https://manapool.com/sealed/mkm/bundle',
  resolved: true,
};

describe('/edit', () => {
  it('shows the edit modal to the owner', async () => {
    const id = seedListing();
    const i = fakeChatInputInteraction({
      userId: 'owner-1',
      options: { integers: { listing_id: id } },
    });

    await editCommand.execute(i);

    expect(i.showModal).toHaveBeenCalledTimes(1);
  });

  it('rejects a non-owner without showing the modal', async () => {
    const id = seedListing();
    const i = fakeChatInputInteraction({
      userId: 'someone-else',
      options: { integers: { listing_id: id } },
    });

    await editCommand.execute(i);

    expect(i.showModal).not.toHaveBeenCalled();
    expect(i.reply).toHaveBeenCalledWith(
      expect.objectContaining({ content: expect.stringContaining('Only the listing owner') }),
    );
  });
});

describe('buildEditModal', () => {
  it('includes the condition row for a card listing', () => {
    const listing = getListingById(seedListing())!;

    expect(modalFieldIds(buildEditModal(listing))).toEqual([
      'condition',
      'price',
      'quantity',
      'set',
      'notes',
    ]);
  });

  it('omits the condition row for a sealed listing', () => {
    const listing = getListingById(seedSealedListing())!;

    const ids = modalFieldIds(buildEditModal(listing));
    expect(ids).not.toContain('condition');
    expect(ids).toEqual(['price', 'quantity', 'set', 'notes']);
  });
});

describe('handleEditModal', () => {
  it('updates the listing and replies with success', async () => {
    const id = seedListing();
    const i = fakeModalSubmitInteraction({
      customId: encodeEditModalId(id),
      userId: 'owner-1',
      fields: { condition: 'lp', price: '5.00', quantity: '2', set: 'LEA', notes: '' },
    });

    await handleEditModal(i);

    expect(i.editReply).toHaveBeenCalledWith(
      expect.objectContaining({ content: expect.stringContaining('updated') }),
    );
  });

  it('replies with the specific error for an invalid condition instead of throwing (regression)', async () => {
    const id = seedListing();
    const i = fakeModalSubmitInteraction({
      customId: encodeEditModalId(id),
      userId: 'owner-1',
      fields: { condition: 'bogus', price: '', quantity: '', set: 'LEA', notes: '' },
    });

    await expect(handleEditModal(i)).resolves.toBeUndefined();

    expect(i.editReply).toHaveBeenCalledWith(
      expect.objectContaining({ content: expect.stringContaining('Invalid condition') }),
    );
  });

  it('rejects a non-owner', async () => {
    const id = seedListing();
    const i = fakeModalSubmitInteraction({
      customId: encodeEditModalId(id),
      userId: 'someone-else',
      fields: { condition: '', price: '', quantity: '', set: 'LEA', notes: '' },
    });

    await handleEditModal(i);

    expect(i.editReply).toHaveBeenCalledWith(
      expect.objectContaining({ content: expect.stringContaining('Only the listing owner') }),
    );
  });

  it('re-resolves the card when the set changes and reports failure to resolve', async () => {
    const id = seedListing();
    resolveCard.mockResolvedValue({
      scryfallId: null,
      cardName: 'Black Lotus',
      cardNameNormalized: 'black lotus',
      cardSet: null,
      cardImageUrl: null,
      collectorNumber: null,
      marketUrl: null,
      manapoolPriceCents: null,
      resolved: false,
    });
    const i = fakeModalSubmitInteraction({
      customId: encodeEditModalId(id),
      userId: 'owner-1',
      fields: { condition: '', price: '', quantity: '', set: 'MH3', notes: '' },
    });

    await handleEditModal(i);

    expect(i.editReply).toHaveBeenCalledWith(
      expect.objectContaining({ content: expect.stringContaining('Could not find') }),
    );
  });

  it('does not throw when a sealed modal is submitted without a condition field (regression)', async () => {
    const id = seedSealedListing();
    const i = withStrictFields(
      fakeModalSubmitInteraction({ customId: encodeEditModalId(id), userId: 'owner-1' }),
      sealedFields,
    );

    await expect(handleEditModal(i)).resolves.toBeUndefined();

    // The generic interactionCreate handler is what a thrown field lookup would
    // reach, so assert the success reply, not merely that nothing propagated.
    expect(i.editReply).toHaveBeenCalledWith(
      expect.objectContaining({ content: expect.stringContaining('updated') }),
    );
    expect(resolveSealedProduct).not.toHaveBeenCalled();
  });

  it('re-resolves a sealed listing when the set changes and writes the sealed columns', async () => {
    const id = seedSealedListing();
    resolveSealedProduct.mockResolvedValue(resolvedProduct);
    const i = withStrictFields(
      fakeModalSubmitInteraction({ customId: encodeEditModalId(id), userId: 'owner-1' }),
      { ...sealedFields, set: 'mkm' },
    );

    await handleEditModal(i);

    expect(resolveSealedProduct).toHaveBeenCalledWith('Bloomburrow Bundle', {
      setCode: 'MKM',
      language: 'en',
    });
    expect(resolveCard).not.toHaveBeenCalled();
    const row = getListingById(id)!;
    expect(row.cardSet).toBe('MKM');
    expect(row.cardName).toBe('Murders at Karlov Manor Bundle');
    expect(row.cardNameNormalized).toBe('murders at karlov manor bundle');
    expect(row.marketUrl).toBe('https://manapool.com/sealed/mkm/bundle');
    expect(row.catalogId).toBe('uuid-mkm-bundle');
    expect(row.sealedCategory).toBe('bundle');
    expect(row.sealedSubtype).toBe('gift_edition');
    expect(i.editReply).toHaveBeenCalledWith(
      expect.objectContaining({ content: expect.stringContaining('updated') }),
    );
  });

  it('keeps a sealed set change when the product does not resolve, unlike the card path', async () => {
    const id = seedSealedListing();
    resolveSealedProduct.mockResolvedValue({
      productName: 'Bloomburrow Bundle',
      productNameNormalized: 'bloomburrow bundle',
      setCode: null,
      uuid: null,
      category: null,
      subtype: null,
      marketUrl: null,
      resolved: false,
    });
    const i = withStrictFields(
      fakeModalSubmitInteraction({ customId: encodeEditModalId(id), userId: 'owner-1' }),
      { ...sealedFields, set: 'ZZZ' },
    );

    await handleEditModal(i);

    expect(i.editReply).not.toHaveBeenCalledWith(
      expect.objectContaining({ content: expect.stringContaining('Could not find') }),
    );
    expect(i.editReply).toHaveBeenCalledWith(
      expect.objectContaining({ content: expect.stringContaining('updated') }),
    );
    const row = getListingById(id)!;
    expect(row.cardSet).toBe('ZZZ');
    // The stale metadata from the previous set is cleared, not carried over.
    expect(row.catalogId).toBeNull();
    expect(row.sealedCategory).toBeNull();
    expect(row.sealedSubtype).toBeNull();
    expect(row.marketUrl).toBeNull();
  });

  it('still aborts a card set change when the card does not resolve (regression)', async () => {
    const id = seedListing();
    resolveCard.mockResolvedValue({
      scryfallId: null,
      cardName: 'Black Lotus',
      cardNameNormalized: 'black lotus',
      cardSet: null,
      cardImageUrl: null,
      collectorNumber: null,
      marketUrl: null,
      manapoolPriceCents: null,
      resolved: false,
    });
    const i = fakeModalSubmitInteraction({
      customId: encodeEditModalId(id),
      userId: 'owner-1',
      fields: { condition: '', price: '9.99', quantity: '', set: 'MH3', notes: '' },
    });

    await handleEditModal(i);

    expect(i.editReply).toHaveBeenCalledWith(
      expect.objectContaining({ content: expect.stringContaining('Could not find') }),
    );
    expect(resolveSealedProduct).not.toHaveBeenCalled();
    // Nothing is written on the abort, not even the fields that did validate.
    const row = getListingById(id)!;
    expect(row.cardSet).toBe('LEA');
    expect(row.priceCents).toBe(100);
  });

  it('takes the cheap path with no re-resolution when the set is unchanged', async () => {
    const cardId = seedListing();
    const sealedId = seedSealedListing();
    const cardInteraction = fakeModalSubmitInteraction({
      customId: encodeEditModalId(cardId),
      userId: 'owner-1',
      fields: { condition: 'lp', price: '', quantity: '', set: 'lea', notes: '' },
    });
    const sealedInteraction = withStrictFields(
      fakeModalSubmitInteraction({ customId: encodeEditModalId(sealedId), userId: 'owner-1' }),
      { ...sealedFields, set: 'blb' },
    );

    await handleEditModal(cardInteraction);
    await handleEditModal(sealedInteraction);

    expect(resolveCard).not.toHaveBeenCalled();
    expect(resolveSealedProduct).not.toHaveBeenCalled();
    expect(getListingById(cardId)!.condition).toBe('lp');
    expect(getListingById(sealedId)!.catalogId).toBe('uuid-blb-bundle');
  });

  it('shows an "Edit next" button when a batch queue remains', async () => {
    const first = seedListing();
    const second = seedListing({ cardName: 'Lightning Bolt' });
    const i = fakeModalSubmitInteraction({
      customId: encodeEditModalId(first, [second]),
      userId: 'owner-1',
      fields: { condition: '', price: '', quantity: '', set: 'LEA', notes: '' },
    });

    await handleEditModal(i);

    expect(i.editReply).toHaveBeenCalledWith(
      expect.objectContaining({ components: expect.any(Array) }),
    );
  });
});

describe('handleEditNextButton', () => {
  it('opens the next listing modal for the owner', async () => {
    const first = seedListing();
    const second = seedListing({ cardName: 'Lightning Bolt' });
    const i = fakeButtonInteraction({
      customId: encodeEditNextId(second, []),
      userId: 'owner-1',
    });
    void first;

    await handleEditNextButton(i);

    expect(i.showModal).toHaveBeenCalledTimes(1);
  });

  it('rejects a non-owner', async () => {
    const id = seedListing();
    const i = fakeButtonInteraction({
      customId: encodeEditNextId(id, []),
      userId: 'someone-else',
    });

    await handleEditNextButton(i);

    expect(i.showModal).not.toHaveBeenCalled();
  });
});

/** The `value` and `label` of one input in a modal. */
function modalField(modal: ReturnType<typeof buildEditModal>, id: string) {
  const json = modal.toJSON() as unknown as {
    components: Array<{
      components: Array<{ custom_id: string; value?: string; label: string; max_length?: number }>;
    }>;
  };
  return json.components.flatMap((row) => row.components).find((c) => c.custom_id === id);
}

describe('/edit condition or grade', () => {
  it('shows a graded listing’s grade in the condition row, and a raw condition as before', () => {
    const graded = getListingById(
      seedListing({ condition: 'graded', gradingCompany: 'PSA', grade: '10' }),
    )!;
    expect(modalField(buildEditModal(graded), 'condition')).toMatchObject({
      value: 'PSA 10',
      label: 'Condition or grade (e.g. nm, PSA 10)',
    });

    const raw = getListingById(seedListing())!;
    expect(modalField(buildEditModal(raw), 'condition')?.value).toBe('nm');
  });

  it('keeps the condition label inside Discord’s 45 characters and the field wide enough for a grade', () => {
    const modal = buildEditModal(getListingById(seedListing())!);
    const field = modalField(modal, 'condition');
    expect(field?.label.length).toBeLessThanOrEqual(45);
    expect(field?.max_length).toBeGreaterThanOrEqual('BGS 9.5'.length);
  });

  async function submit(id: number, condition: string) {
    const i = fakeModalSubmitInteraction({
      customId: encodeEditModalId(id),
      userId: 'owner-1',
      fields: { condition, price: '', quantity: '', set: 'LEA', notes: '' },
    });
    await handleEditModal(i);
    return i;
  }

  it('turns a grade into a graded condition with its company and grade', async () => {
    const id = seedListing();
    await submit(id, 'bgs 9.5');
    expect(getListingById(id)).toMatchObject({
      condition: 'graded',
      gradingCompany: 'BGS',
      grade: '9.5',
    });
  });

  it('clears the grade when a graded listing goes back to a raw condition', async () => {
    const id = seedListing({ condition: 'graded', gradingCompany: 'PSA', grade: '10' });
    await submit(id, 'lp');
    expect(getListingById(id)).toMatchObject({
      condition: 'lp',
      gradingCompany: null,
      grade: null,
    });
  });

  it('keeps a graded listing graded when its grade is resubmitted unchanged', async () => {
    const id = seedListing({ condition: 'graded', gradingCompany: 'PSA', grade: '10' });
    await submit(id, 'PSA 10');
    expect(getListingById(id)).toMatchObject({
      condition: 'graded',
      gradingCompany: 'PSA',
      grade: '10',
    });
  });

  it('clears condition and grade together when the field is emptied', async () => {
    const id = seedListing({ condition: 'graded', gradingCompany: 'PSA', grade: '10' });
    await submit(id, '');
    expect(getListingById(id)).toMatchObject({
      condition: null,
      gradingCompany: null,
      grade: null,
    });
  });

  it('rejects a bare "graded" and an unknown grade without changing the listing', async () => {
    const id = seedListing();
    const bare = await submit(id, 'graded');
    expect(bare.editReply).toHaveBeenCalledWith(
      expect.objectContaining({ content: expect.stringContaining('Say which grade') }),
    );
    const unknown = await submit(id, 'XYZ 10');
    expect(unknown.editReply).toHaveBeenCalledWith(
      expect.objectContaining({ content: expect.stringContaining('Invalid condition') }),
    );
    expect(getListingById(id)).toMatchObject({ condition: 'nm', grade: null });
  });
});

describe('/edit on a listing from another game', () => {
  let fake: GameDefinition;

  beforeEach(() => {
    fake = registerFakeGame();
  });

  afterEach(() => {
    unregisterFakeGame();
  });

  function submitSet(id: number, set: string, withCondition = true) {
    const fields = { price: '', quantity: '', set, notes: '' };
    const i = withStrictFields(
      fakeModalSubmitInteraction({ customId: encodeEditModalId(id), userId: 'owner-1' }),
      withCondition ? { condition: 'nm', ...fields } : fields,
    );
    return handleEditModal(i).then(() => i);
  }

  it('re-resolves a card through its own game, in its own language, and keeps the catalog id', async () => {
    const id = seedListing({
      game: FAKE_GAME_ID,
      language: 'ja',
      catalogId: 'fk-old',
      cardSet: 'FK1',
    });
    vi.mocked(fake.resolveCard).mockResolvedValue({
      cardName: 'Fake Card',
      cardNameNormalized: 'fake card',
      cardSet: 'FK2',
      collectorNumber: '9',
      marketUrl: 'https://fake.example/product/9',
      catalogId: 'fk-9',
      resolved: true,
    });

    await submitSet(id, 'fk2');

    expect(fake.resolveCard).toHaveBeenCalledWith('Black Lotus', {
      cardSet: 'FK2',
      finish: null,
      variant: null,
      language: 'ja',
    });
    expect(resolveCard).not.toHaveBeenCalled();
    expect(getListingById(id)).toMatchObject({
      cardSet: 'FK2',
      collectorNumber: '9',
      marketUrl: 'https://fake.example/product/9',
      catalogId: 'fk-9',
      language: 'ja',
    });
  });

  it('aborts a card set change its game cannot resolve', async () => {
    const id = seedListing({ game: FAKE_GAME_ID, catalogId: 'fk-old', cardSet: 'FK1' });
    vi.mocked(fake.resolveCard).mockResolvedValue({
      cardName: 'Black Lotus',
      cardNameNormalized: 'black lotus',
      resolved: false,
    });

    const i = await submitSet(id, 'NOPE');

    expect(i.editReply).toHaveBeenCalledWith(
      expect.objectContaining({ content: expect.stringContaining('Could not find') }),
    );
    expect(getListingById(id)).toMatchObject({ cardSet: 'FK1', catalogId: 'fk-old' });
  });

  it('re-resolves a sealed listing through its own game', async () => {
    const id = seedSealedListing({ game: FAKE_GAME_ID, catalogId: 'fk-old', cardSet: 'FK1' });

    await submitSet(id, 'FK2', false);

    expect(fake.resolveSealed).toHaveBeenCalledWith('Bloomburrow Bundle', {
      setCode: 'FK2',
      language: 'en',
    });
    expect(resolveSealedProduct).not.toHaveBeenCalled();
    expect(getListingById(id)).toMatchObject({ catalogId: 'fk-box', cardName: 'Fake Box' });
  });

  it('leaves the set alone and says why when the listing’s game is gone', async () => {
    const id = seedListing({ game: FAKE_GAME_ID, cardSet: 'FK1' });
    unregisterFakeGame();

    const i = await submitSet(id, 'FK2');

    expect(i.editReply).toHaveBeenCalledWith(
      expect.objectContaining({ content: expect.stringContaining('no longer supports') }),
    );
    expect(getListingById(id)?.cardSet).toBe('FK1');
  });

  it('still edits price and notes of a listing whose game is gone, since the set is unchanged', async () => {
    const id = seedListing({ game: FAKE_GAME_ID, cardSet: 'FK1' });
    unregisterFakeGame();
    const i = withStrictFields(
      fakeModalSubmitInteraction({ customId: encodeEditModalId(id), userId: 'owner-1' }),
      { condition: 'nm', price: '9.99', quantity: '', set: 'FK1', notes: 'still here' },
    );
    await handleEditModal(i);
    expect(getListingById(id)).toMatchObject({ priceCents: 999, notes: 'still here' });
  });
});
