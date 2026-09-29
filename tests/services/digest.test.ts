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

function fakeClientWithDmSend(send: (message: string) => Promise<unknown>): Client {
  return {
    channels: { fetch: vi.fn() },
    users: {
      fetch: vi.fn().mockResolvedValue({ send }),
    },
  } as unknown as Client;
}

function serverRowDm(overrides: Partial<NewServerRow> = {}): NewServerRow {
  return {
    ...serverRow,
    digestMode: 'dm',
    digestDmUserId: 'dm-user-1',
    adminChannelId: null,
    ...overrides,
  };
}

function serverRowBoth(): NewServerRow {
  return {
    ...serverRow,
    digestMode: 'both',
    digestDmUserId: 'dm-user-1',
    adminChannelId: 'channel-1',
  };
}

describe('runDigest edge cases', () => {
  it('returns sent=false with no calls when there are no listings to deliver', async () => {
    getDb().insert(servers).values(serverRow).run();
    const client = fakeClientWithChannelSend(vi.fn());

    const result = await runDigest(client, getServerConfig('500')!, 'manual');

    expect(result.sent).toBe(false);
    expect(result.listingCount).toBe(0);
    expect(result.channelOk).toBe(false);
    expect(result.dmOk).toBe(false);
  });

  it('treats a missing adminChannelId as channelOk=false and leaves the watermark unchanged', async () => {
    getDb()
      .insert(servers)
      .values({ ...serverRow, adminChannelId: null })
      .run();
    addListing();
    const send = vi.fn().mockResolvedValue(undefined);
    const client = fakeClientWithChannelSend(send);

    const result = await runDigest(client, getServerConfig('500')!, 'manual');

    expect(result.sent).toBe(false);
    expect(result.channelOk).toBe(false);
    expect(send).not.toHaveBeenCalled();
    expect(getServerConfig('500')!.lastDigestAt).toBe(0);
  });

  it('treats a non-text channel as a failure', async () => {
    getDb().insert(servers).values(serverRow).run();
    addListing();
    const client = {
      channels: {
        fetch: vi.fn().mockResolvedValue({
          isTextBased: () => false,
          isSendable: () => false,
        }),
      },
    } as unknown as Client;

    const result = await runDigest(client, getServerConfig('500')!, 'manual');

    expect(result.sent).toBe(false);
    expect(result.channelOk).toBe(false);
    expect(getServerConfig('500')!.lastDigestAt).toBe(0);
  });
});

describe('runDigest DM delivery', () => {
  it('sends to a user via DM and advances the watermark when digestMode=dm', async () => {
    getDb().insert(servers).values(serverRowDm()).run();
    addListing();
    const send = vi.fn().mockResolvedValue(undefined);
    const client = fakeClientWithDmSend(send);

    const result = await runDigest(client, getServerConfig('500')!, 'manual');

    expect(result.sent).toBe(true);
    expect(result.dmOk).toBe(true);
    expect(result.channelOk).toBe(false);
    expect(send).toHaveBeenCalledTimes(1);
    expect(getServerConfig('500')!.lastDigestAt).toBeGreaterThan(0);
  });

  it('skips DM when digestDmUserId is null and reports dmOk=false', async () => {
    getDb()
      .insert(servers)
      .values({ ...serverRowDm(), digestDmUserId: null })
      .run();
    addListing();
    const client = fakeClientWithDmSend(vi.fn());

    const result = await runDigest(client, getServerConfig('500')!, 'manual');

    expect(result.sent).toBe(false);
    expect(result.dmOk).toBe(false);
    expect(getServerConfig('500')!.lastDigestAt).toBe(0);
  });

  it('treats a null user (fetched but missing from cache) as dmOk=false', async () => {
    getDb().insert(servers).values(serverRowDm()).run();
    addListing();
    const client = {
      channels: { fetch: vi.fn() },
      users: { fetch: vi.fn().mockResolvedValue(null) },
    } as unknown as Client;

    const result = await runDigest(client, getServerConfig('500')!, 'manual');

    expect(result.dmOk).toBe(false);
    expect(result.sent).toBe(false);
  });

  it('treats a thrown DM send as a failure and retries', async () => {
    getDb().insert(servers).values(serverRowDm()).run();
    addListing();
    const send = vi.fn().mockRejectedValue(new Error('persistent DM failure'));
    const client = fakeClientWithDmSend(send);

    const result = await runDigest(client, getServerConfig('500')!, 'manual');

    expect(result.sent).toBe(false);
    expect(send).toHaveBeenCalledTimes(3);
  }, 10_000);
});

describe('runDigest both delivery', () => {
  it('sends to both the channel and the DM when digestMode=both', async () => {
    getDb().insert(servers).values(serverRowBoth()).run();
    addListing();
    const channelSend = vi.fn().mockResolvedValue(undefined);
    const dmSend = vi.fn().mockResolvedValue(undefined);
    const client = {
      channels: {
        fetch: vi.fn().mockResolvedValue({
          isTextBased: () => true,
          isSendable: () => true,
          send: channelSend,
        }),
      },
      users: {
        fetch: vi.fn().mockResolvedValue({ send: dmSend }),
      },
    } as unknown as Client;

    const result = await runDigest(client, getServerConfig('500')!, 'manual');

    expect(result.sent).toBe(true);
    expect(result.channelOk).toBe(true);
    expect(result.dmOk).toBe(true);
    expect(channelSend).toHaveBeenCalledTimes(1);
    expect(dmSend).toHaveBeenCalledTimes(1);
  });

  it('still succeeds when only the DM succeeds but the channel fails', async () => {
    getDb().insert(servers).values(serverRowBoth()).run();
    addListing();
    const channelSend = vi.fn().mockRejectedValue(new Error('channel 500'));
    const dmSend = vi.fn().mockResolvedValue(undefined);
    const client = {
      channels: {
        fetch: vi.fn().mockResolvedValue({
          isTextBased: () => true,
          isSendable: () => true,
          send: channelSend,
        }),
      },
      users: {
        fetch: vi.fn().mockResolvedValue({ send: dmSend }),
      },
    } as unknown as Client;

    const result = await runDigest(client, getServerConfig('500')!, 'manual');

    expect(result.sent).toBe(true);
    expect(result.channelOk).toBe(false);
    expect(result.dmOk).toBe(true);
  });
});
