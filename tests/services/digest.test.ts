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
import { formatDigest, runDigest } from '../../src/services/digest.js';
import { getServerConfig } from '../../src/services/digest-state.js';
import { DIGEST_SECTION_CAP } from '../../src/utils/constants.js';
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

function addListing(): void {
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
    } satisfies NewListingRow)
    .run();
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
