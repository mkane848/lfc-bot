import { beforeEach, describe, expect, it, vi } from 'vitest';
import { getDb } from '../../../src/db/index.js';
import { servers, type NewServerRow } from '../../../src/db/schema.js';
import { execute as digestExecute } from '../../../src/commands/admin/digest.js';
import * as digestService from '../../../src/services/digest.js';
import { fakeChatInputInteraction } from '../../helpers/interaction.js';
import { setupTestDb } from '../../helpers/db.js';

setupTestDb();

vi.mock('../../../src/services/digest.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../src/services/digest.js')>();
  return { ...actual, runDigest: vi.fn() };
});

const runDigest = vi.mocked(digestService.runDigest);

function serverRow(overrides: Partial<NewServerRow> = {}): NewServerRow {
  return {
    id: 'guild-1',
    digestMode: 'channel',
    digestCron: '0 9 * * *',
    digestTimezone: 'UTC',
    enabledGames: '["mtg"]',
    adminChannelId: 'channel-1',
    digestDmUserId: null,
    lastDigestAt: null,
    removedAt: null,
    createdAt: 1,
    updatedAt: 1,
    ...overrides,
  };
}

beforeEach(() => {
  runDigest.mockReset();
});

describe('/admin digest', () => {
  it('errors without calling runDigest when digest mode is disabled', async () => {
    getDb()
      .insert(servers)
      .values(serverRow({ digestMode: 'disabled' }))
      .run();
    const i = fakeChatInputInteraction({});

    await digestExecute(i);

    expect(runDigest).not.toHaveBeenCalled();
    expect(i.reply).toHaveBeenCalledWith(
      expect.objectContaining({ content: expect.stringContaining('disabled') }),
    );
  });

  it('reports no new listings', async () => {
    getDb().insert(servers).values(serverRow()).run();
    runDigest.mockResolvedValue({ sent: false, channelOk: false, dmOk: false, listingCount: 0 });
    const i = fakeChatInputInteraction({});

    await digestExecute(i);

    expect(i.reply).toHaveBeenCalledWith(
      expect.objectContaining({ content: expect.stringContaining('no new listings') }),
    );
  });

  it('reports delivery success', async () => {
    getDb().insert(servers).values(serverRow()).run();
    runDigest.mockResolvedValue({ sent: true, channelOk: true, dmOk: false, listingCount: 3 });
    const i = fakeChatInputInteraction({});

    await digestExecute(i);

    expect(i.reply).toHaveBeenCalledWith(
      expect.objectContaining({ content: expect.stringContaining('sent with 3 new listings') }),
    );
  });

  it('reports delivery failure', async () => {
    getDb().insert(servers).values(serverRow()).run();
    runDigest.mockResolvedValue({ sent: false, channelOk: false, dmOk: false, listingCount: 2 });
    const i = fakeChatInputInteraction({});

    await digestExecute(i);

    expect(i.reply).toHaveBeenCalledWith(
      expect.objectContaining({ content: expect.stringContaining('delivery failed') }),
    );
  });
});
