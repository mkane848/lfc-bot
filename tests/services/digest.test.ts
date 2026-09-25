import type { Client } from 'discord.js';
import { describe, expect, it, vi } from 'vitest';
import { getDb } from '../../src/db/index.js';
import {
  listings,
  servers,
  type ListingRow,
  type NewListingRow,
  type NewServerRow,
} from '../../src/db/schema.js';
import { formatDigest, runDigest, splitDigestMessage } from '../../src/services/digest.js';
import { getServerConfig } from '../../src/services/digest-state.js';
import { DIGEST_SECTION_CAP, DISCORD_MESSAGE_MAX_LENGTH } from '../../src/utils/constants.js';
import { setupTestDb } from '../helpers/db.js';

setupTestDb();

function listing(overrides: Partial<ListingRow> = {}): ListingRow {
  return {
    id: 1,
    serverId: '200',
    userId: 'u1',
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
    priceCents: 4500000,
    quantity: 1,
    notes: null,
    status: 'active',
    expiresAt: 2,
    createdAt: 1,
    updatedAt: 1,
    ...overrides,
  };
}

describe('formatDigest', () => {
  it('groups listings by intent with headings', () => {
    const text = formatDigest([
      listing({ id: 1, intent: 'have', cardName: 'Black Lotus', username: 'alice' }),
      listing({ id: 2, intent: 'want', cardName: 'Force of Will', priceCents: null }),
      listing({ id: 3, intent: 'have', accepts: 'trade', cardName: 'Tarmogoyf', condition: 'lp' }),
    ]);
    expect(text).toContain('NEW HAVES (2)');
    expect(text).toContain('NEW WANTS (1)');
    expect(text).toContain('- Black Lotus (LEA) — NM — $45,000.00 — @alice');
  });

  it('omits empty sections', () => {
    const text = formatDigest([listing({ id: 1, intent: 'have' })]);
    expect(text).not.toContain('NEW WANTS');
  });

  it('appends a Manapool link when available', () => {
    const text = formatDigest([
      listing({
        id: 1,
        intent: 'have',
        manapoolUrl: 'https://manapool.com/card/lea/232/black-lotus',
      }),
    ]);
    expect(text).toContain('[View on Manapool](https://manapool.com/card/lea/232/black-lotus)');
  });

  it('caps each section and notes overflow', () => {
    const rows = Array.from({ length: DIGEST_SECTION_CAP + 5 }, (_, i) =>
      listing({ id: i + 1, intent: 'have', cardName: `Card ${i + 1}` }),
    );
    const text = formatDigest(rows);
    expect(text).toContain('NEW HAVES (30)');
    expect(text).toContain('+5 more');
    expect(text).toContain('- Card 1 (LEA)');
    expect(text).not.toContain('- Card 26 (LEA)');
  });
});

describe('splitDigestMessage', () => {
  it('returns a digest that fits as a single message', () => {
    expect(splitDigestMessage('Heading\n\nNEW HAVES (1)\n- Black Lotus')).toEqual([
      'Heading\n\nNEW HAVES (1)\n- Black Lotus',
    ]);
  });

  it('splits a long digest into messages under the limit without losing a line', () => {
    const rows = Array.from({ length: DIGEST_SECTION_CAP * 2 }, (_, i) =>
      listing({
        id: i + 1,
        intent: i % 2 === 0 ? 'have' : 'want',
        cardName: `Ragavan, Nimble Pilferer ${i + 1}`,
        manapoolUrl: `https://manapool.com/card/mh2/${i + 1}/ragavan-nimble-pilferer`,
      }),
    );
    const text = `Daily Listing Digest\n\n${formatDigest(rows)}`;
    expect(text.length).toBeGreaterThan(DISCORD_MESSAGE_MAX_LENGTH);

    const messages = splitDigestMessage(text);

    expect(messages.length).toBeGreaterThan(1);
    for (const message of messages) {
      expect(message.length).toBeLessThanOrEqual(DISCORD_MESSAGE_MAX_LENGTH);
    }
    const lines = (value: string) => value.split('\n').filter((line) => line !== '');
    expect(messages.flatMap(lines)).toEqual(lines(text));
  });

  it('starts a new message at a section heading rather than splitting a section that fits', () => {
    const haves = `NEW HAVES (2)\n- ${'a'.repeat(30)}\n- ${'b'.repeat(30)}`;
    const wants = `NEW WANTS (2)\n- ${'c'.repeat(30)}\n- ${'d'.repeat(30)}`;

    const messages = splitDigestMessage(`${haves}\n\n${wants}`, 100);

    expect(messages).toEqual([haves, wants]);
  });

  it('hard-splits a single line longer than the limit instead of dropping it', () => {
    const messages = splitDigestMessage('x'.repeat(250), 100);

    expect(messages).toEqual(['x'.repeat(100), 'x'.repeat(100), 'x'.repeat(50)]);
  });
});

const serverRow: NewServerRow = {
  id: '500',
  digestMode: 'channel',
  digestCron: '0 9 * * *',
  digestTimezone: 'UTC',
  enabledGames: '["mtg"]',
  adminChannelId: 'channel-1',
  digestDmUserId: null,
  lastDigestAt: 0,
  removedAt: null,
  createdAt: 1,
  updatedAt: 1,
};

function addListing(overrides: Partial<NewListingRow> = {}): void {
  getDb()
    .insert(listings)
    .values({
      serverId: '500',
      userId: 'u1',
      username: 'alice',
      intent: 'have',
      accepts: 'cash',
      game: 'mtg',
      cardName: 'Black Lotus',
      cardNameNormalized: 'black lotus',
      cardSet: null,
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
      expiresAt: Date.now() + 30 * 24 * 3600 * 1000,
      createdAt: Date.now(),
      updatedAt: Date.now(),
      ...overrides,
    } satisfies NewListingRow)
    .run();
}

/** Add enough listings with printings and Manapool links to overflow one message. */
function addBusyDaysListings(count: number): void {
  for (let i = 0; i < count; i++) {
    addListing({
      intent: i % 2 === 0 ? 'have' : 'want',
      cardName: 'Ragavan, Nimble Pilferer',
      cardNameNormalized: 'ragavan nimble pilferer',
      cardSet: 'MH2',
      collectorNumber: String(100 + i),
      manapoolUrl: `https://manapool.com/card/mh2/${100 + i}/ragavan-nimble-pilferer`,
    });
  }
}

function fakeClientWithChannelSend(send: (message: string) => Promise<unknown>): Client {
  return {
    channels: {
      fetch: vi.fn().mockResolvedValue({
        isTextBased: () => true,
        isSendable: () => true,
        send,
      }),
    },
  } as unknown as Client;
}

describe('runDigest delivery retry', () => {
  it('succeeds and advances the watermark when a transient send failure is retried', async () => {
    getDb().insert(servers).values(serverRow).run();
    addListing();
    const send = vi
      .fn()
      .mockRejectedValueOnce(new Error('transient 503'))
      .mockResolvedValueOnce(undefined);
    const client = fakeClientWithChannelSend(send);

    const result = await runDigest(client, getServerConfig('500')!, 'scheduled');

    expect(result.sent).toBe(true);
    expect(result.channelOk).toBe(true);
    expect(send).toHaveBeenCalledTimes(2);
    expect(getServerConfig('500')!.lastDigestAt).toBeGreaterThan(0);
  });

  it('suppresses mention parsing so a display name like "everyone" cannot mass-ping the channel', async () => {
    getDb().insert(servers).values(serverRow).run();
    addListing();
    const send = vi.fn().mockResolvedValue(undefined);
    const client = fakeClientWithChannelSend(send);

    await runDigest(client, getServerConfig('500')!, 'scheduled');

    expect(send).toHaveBeenCalledWith(expect.objectContaining({ allowedMentions: { parse: [] } }));
  });

  it('gives up after repeated failures and leaves the watermark unchanged', async () => {
    getDb().insert(servers).values(serverRow).run();
    addListing();
    const send = vi.fn().mockRejectedValue(new Error('persistent failure'));
    const client = fakeClientWithChannelSend(send);

    const result = await runDigest(client, getServerConfig('500')!, 'scheduled');

    expect(result.sent).toBe(false);
    expect(result.channelOk).toBe(false);
    expect(getServerConfig('500')!.lastDigestAt).toBe(0);
    expect(send).toHaveBeenCalledTimes(3);
  }, 10_000);
});

describe('runDigest on a busy day', () => {
  it('sends a digest longer than one message as several, each within the limit', async () => {
    getDb().insert(servers).values(serverRow).run();
    addBusyDaysListings(30);
    const send = vi.fn().mockResolvedValue(undefined);
    const client = fakeClientWithChannelSend(send);

    const result = await runDigest(client, getServerConfig('500')!, 'scheduled');

    expect(result.sent).toBe(true);
    expect(send.mock.calls.length).toBeGreaterThan(1);
    for (const [options] of send.mock.calls as Array<[{ content: string }]>) {
      expect(options.content.length).toBeLessThanOrEqual(DISCORD_MESSAGE_MAX_LENGTH);
      expect(options).toEqual(expect.objectContaining({ allowedMentions: { parse: [] } }));
    }
    expect(getServerConfig('500')!.lastDigestAt).toBeGreaterThan(0);
  });

  it('leaves the watermark unchanged when a later message fails, so nothing is dropped', async () => {
    getDb().insert(servers).values(serverRow).run();
    addBusyDaysListings(30);
    const send = vi
      .fn()
      .mockResolvedValueOnce(undefined)
      .mockRejectedValue(new Error('persistent failure'));
    const client = fakeClientWithChannelSend(send);

    const result = await runDigest(client, getServerConfig('500')!, 'scheduled');

    expect(result.sent).toBe(false);
    expect(result.channelOk).toBe(false);
    expect(getServerConfig('500')!.lastDigestAt).toBe(0);
  }, 10_000);
});
