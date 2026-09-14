import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Client } from 'discord.js';
import { handleReady } from '../../src/events/ready.js';
import { getDb } from '../../src/db/index.js';
import { sealedCatalogMeta, servers } from '../../src/db/schema.js';
import { setupTestDb } from '../helpers/db.js';

vi.mock('../../src/services/scheduler.js', () => ({
  scheduleAllDigests: vi.fn(),
  startMaintenance: vi.fn(),
  startSealedCatalogSync: vi.fn(),
}));

// Only `syncSealedCatalog` is stubbed, so nothing reaches the network. The real
// `isSealedCatalogStale` runs against the in-memory database, which is the point:
// a version of it that throws would take `handleReady` down on boot, and mocking
// it away would hide exactly that.
vi.mock('../../src/services/sealed.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/services/sealed.js')>();
  return { ...actual, syncSealedCatalog: vi.fn() };
});

const { scheduleAllDigests, startMaintenance, startSealedCatalogSync } =
  await import('../../src/services/scheduler.js');
const { syncSealedCatalog } = await import('../../src/services/sealed.js');

setupTestDb();

beforeEach(() => {
  // Module-level vi.mock is not auto-reset in this repo's Vitest config.
  vi.mocked(scheduleAllDigests).mockReset();
  vi.mocked(startMaintenance).mockReset();
  vi.mocked(startSealedCatalogSync).mockReset();
  vi.mocked(syncSealedCatalog).mockReset().mockResolvedValue({ imported: 0, removed: 0 });
});

/** Mark the catalog as synced just now, so the real staleness check reports fresh. */
function markCatalogFresh(): void {
  getDb()
    .insert(sealedCatalogMeta)
    .values({ id: 1, buildVersion: 'v1', setListEtag: '"e1"', syncedAt: Date.now() })
    .run();
}

function fakeClient(guildIds: string[] = ['g1', 'g2']): Client {
  return {
    user: { tag: 'LFCbot#0001' },
    guilds: { cache: new Map(guildIds.map((id) => [id, { id }])) },
  } as unknown as Client;
}

describe('handleReady', () => {
  // This path had no coverage at all, which is how a commit shipped that called
  // a not-yet-implemented service function and would have thrown on boot.
  it('completes without throwing and starts every scheduled job', () => {
    expect(() => handleReady(fakeClient())).not.toThrow();

    expect(scheduleAllDigests).toHaveBeenCalledTimes(1);
    expect(startMaintenance).toHaveBeenCalledTimes(1);
    expect(startSealedCatalogSync).toHaveBeenCalledTimes(1);
  });

  it('seeds a config row for every guild the bot is in', () => {
    handleReady(fakeClient(['g1', 'g2', 'g3']));

    const rows = getDb().select({ id: servers.id }).from(servers).all();
    expect(rows.map((r) => r.id).sort()).toEqual(['g1', 'g2', 'g3']);
  });

  it('warms the sealed catalog when it has never been synced', () => {
    // No sealed_catalog_meta row at all -- the cold-start case.
    handleReady(fakeClient());

    expect(syncSealedCatalog).toHaveBeenCalledTimes(1);
  });

  it('does not re-download a fresh catalog on restart', () => {
    markCatalogFresh();

    handleReady(fakeClient());

    expect(syncSealedCatalog).not.toHaveBeenCalled();
  });

  // Boot must not be brought down by the catalog sync, which is fire-and-forget.
  it('survives a rejected warm-up sync without an unhandled rejection', async () => {
    const unhandled = vi.fn();
    process.once('unhandledRejection', unhandled);
    vi.mocked(syncSealedCatalog).mockRejectedValue(new Error('mtgjson unreachable'));

    expect(() => handleReady(fakeClient())).not.toThrow();
    // Let the rejection settle and any unhandled-rejection callback fire.
    await new Promise((resolve) => setImmediate(resolve));

    expect(unhandled).not.toHaveBeenCalled();
    process.off('unhandledRejection', unhandled);
  });
});
