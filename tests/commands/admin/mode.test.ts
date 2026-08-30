import { beforeEach, describe, expect, it, vi } from 'vitest';
import { getDb } from '../../../src/db/index.js';
import { servers, type NewServerRow } from '../../../src/db/schema.js';
import { execute as modeExecute } from '../../../src/commands/admin/mode.js';
import * as scheduler from '../../../src/services/scheduler.js';
import { fakeChatInputInteraction } from '../../helpers/interaction.js';
import { setupTestDb } from '../../helpers/db.js';

setupTestDb();

vi.mock('../../../src/services/scheduler.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../src/services/scheduler.js')>();
  return { ...actual, refreshServerDigest: vi.fn(), removeServerDigest: vi.fn() };
});

const refreshServerDigest = vi.mocked(scheduler.refreshServerDigest);
const removeServerDigest = vi.mocked(scheduler.removeServerDigest);

const serverRow: NewServerRow = {
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
};

beforeEach(() => {
  getDb().insert(servers).values(serverRow).run();
  refreshServerDigest.mockReset();
  removeServerDigest.mockReset();
});

describe('/admin mode', () => {
  it('sets a valid mode and reschedules the digest job', async () => {
    const i = fakeChatInputInteraction({ options: { strings: { mode: 'both' } } });

    await modeExecute(i);

    expect(i.reply).toHaveBeenCalledWith(
      expect.objectContaining({ content: expect.stringContaining('both') }),
    );
    expect(getDb().select().from(servers).all()[0]?.digestMode).toBe('both');
    expect(refreshServerDigest).toHaveBeenCalledWith(i.client, 'guild-1');
    expect(removeServerDigest).not.toHaveBeenCalled();
  });

  it('rejects an invalid mode value', async () => {
    const i = fakeChatInputInteraction({ options: { strings: { mode: 'bogus' } } });

    await modeExecute(i);

    expect(i.reply).toHaveBeenCalledWith(
      expect.objectContaining({ content: expect.stringContaining('Invalid mode') }),
    );
    expect(refreshServerDigest).not.toHaveBeenCalled();
    expect(removeServerDigest).not.toHaveBeenCalled();
  });

  it('calls removeServerDigest (not refreshServerDigest) when setting mode to disabled', async () => {
    const i = fakeChatInputInteraction({ options: { strings: { mode: 'disabled' } } });

    await modeExecute(i);

    expect(removeServerDigest).toHaveBeenCalledWith('guild-1');
    expect(refreshServerDigest).not.toHaveBeenCalled();
  });
});
