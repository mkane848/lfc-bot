import { beforeEach, describe, expect, it, vi } from 'vitest';
import { listingEmbed } from '../../src/utils/embeds.js';
import {
  replyError,
  replyPublicText,
  replySuccess,
  replyWithListing,
} from '../../src/utils/replies.js';
import {
  fakeChatInputInteraction,
  type FakeChatInputInteraction,
} from '../helpers/interaction.js';
import type { ListingRow } from '../../src/db/schema.js';

vi.mock('../../src/utils/embeds.js', () => ({
  listingEmbed: vi.fn(() => ({ mocked: true })),
}));
const mockListingEmbed = vi.mocked(listingEmbed);

beforeEach(() => {
  mockListingEmbed.mockClear();
});

const baseListing: ListingRow = {
  id: 1,
  userId: 'user-1',
  username: 'alice',
  guildId: 'guild-1',
  intent: 'have',
  accepts: 'cash',
  kind: 'card',
  cardName: 'Black Lotus',
  cardSet: 'LEP',
  finish: null,
  variant: null,
  collectorNumber: '1',
  condition: 'nm',
  priceCents: 100000,
  quantity: 1,
  sealedCategory: null,
  sealedSubtype: null,
  notes: null,
  manapoolUrl: null,
  cardImageUrl: null,
  status: 'active',
  expiresAt: Date.now() + 1000,
  createdAt: Date.now(),
  channelId: 'channel-1',
  messageId: 'message-1',
};

function deferredInteraction(): FakeChatInputInteraction {
  const i = fakeChatInputInteraction({});
  i.deferReply();
  return i;
}

describe('replyWithListing', () => {
  it('replies directly when the interaction was never deferred', async () => {
    const i = fakeChatInputInteraction({});

    await replyWithListing(i, baseListing);

    expect(i.reply).toHaveBeenCalledTimes(1);
    expect(i.editReply).not.toHaveBeenCalled();
    expect(i.followUp).not.toHaveBeenCalled();
    const payload = i.reply.mock.calls[0]![0] as { embeds: unknown[]; content?: string };
    expect(payload.embeds).toHaveLength(1);
    expect(payload.content).toBeUndefined();
    expect(mockListingEmbed).toHaveBeenCalledWith(baseListing, { showUser: true });
  });

  it('appends a warning to the public payload when provided', async () => {
    const i = fakeChatInputInteraction({});

    await replyWithListing(i, baseListing, 'BTW Foil Only');

    const payload = i.reply.mock.calls[0]![0] as { content?: string };
    expect(payload.content).toBe('BTW Foil Only');
  });

  it('uses editReply + followUp when the interaction was already deferred', async () => {
    const i = deferredInteraction();

    await replyWithListing(i, baseListing);

    expect(i.editReply).toHaveBeenCalledWith({ content: 'Posted below.' });
    expect(i.followUp).toHaveBeenCalledTimes(1);
    expect(i.reply).not.toHaveBeenCalled();
    const followUpPayload = i.followUp.mock.calls[0]![0] as { embeds: unknown[] };
    expect(followUpPayload.embeds).toHaveLength(1);
  });
});

describe('replyError', () => {
  it('sends an ephemeral reply when the interaction was never deferred', async () => {
    const i = fakeChatInputInteraction({});

    await replyError(i, 'something went wrong');

    expect(i.reply).toHaveBeenCalledWith({ content: 'something went wrong', ephemeral: true });
    expect(i.editReply).not.toHaveBeenCalled();
  });

  it('uses editReply when the interaction was already deferred', async () => {
    const i = deferredInteraction();

    await replyError(i, 'something went wrong after defer');

    expect(i.editReply).toHaveBeenCalledWith({ content: 'something went wrong after defer' });
    expect(i.reply).not.toHaveBeenCalled();
  });
});

describe('replySuccess', () => {
  it('sends an ephemeral reply when the interaction was never deferred', async () => {
    const i = fakeChatInputInteraction({});

    await replySuccess(i, 'saved');

    expect(i.reply).toHaveBeenCalledWith({ content: 'saved', ephemeral: true });
    expect(i.editReply).not.toHaveBeenCalled();
  });

  it('uses editReply when the interaction was already deferred', async () => {
    const i = deferredInteraction();

    await replySuccess(i, 'saved after defer');

    expect(i.editReply).toHaveBeenCalledWith({ content: 'saved after defer' });
    expect(i.reply).not.toHaveBeenCalled();
  });
});

describe('replyPublicText', () => {
  it('replies directly when the interaction was never deferred', async () => {
    const i = fakeChatInputInteraction({});

    await replyPublicText(i, 'two listings posted');

    expect(i.reply).toHaveBeenCalledWith({ content: 'two listings posted' });
    expect(i.editReply).not.toHaveBeenCalled();
    expect(i.followUp).not.toHaveBeenCalled();
  });

  it('uses editReply + followUp when the interaction was already deferred', async () => {
    const i = deferredInteraction();

    await replyPublicText(i, 'two listings posted after defer');

    expect(i.editReply).toHaveBeenCalledWith({ content: 'Posted below.' });
    expect(i.followUp).toHaveBeenCalledWith({ content: 'two listings posted after defer' });
    expect(i.reply).not.toHaveBeenCalled();
  });
});

vi.mock('../../src/utils/embeds.js', () => ({
  listingEmbed: vi.fn(() => ({})),
}));
