import { beforeEach, describe, expect, it, vi } from 'vitest';
import { getDb } from '../../../src/db/index.js';
import { servers, type NewServerRow } from '../../../src/db/schema.js';
import { execute as timezoneExecute } from '../../../src/commands/admin/timezone.js';
import * as scheduler from '../../../src/services/scheduler.js';
import { fakeChatInputInteraction } from '../../helpers/interaction.js';
import { setupTestDb } from '../../helpers/db.js';

setupTestDb();

vi.mock('../../../src/services/scheduler.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../src/services/scheduler.js')>();
  return { ...actual, refreshServerDigest: vi.fn() };
});

const refreshServerDigest = vi.mocked(scheduler.refreshServerDigest);

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

beforeEach(() => {
  getDb().insert(servers).values(serverRow).run();
  refreshServerDigest.mockReset();
});

describe('/admin timezone', () => {
  it('sets a valid IANA timezone', async () => {
    const i = fakeChatInputInteraction({
      options: { strings: { timezone: 'America/New_York' } },
    });

    await timezoneExecute(i);

    expect(i.reply).toHaveBeenCalledWith(
      expect.objectContaining({ content: expect.stringContaining('America/New_York') }),
    );
    expect(getDb().select().from(servers).all()[0]?.digestTimezone).toBe('America/New_York');
  });

  it('rejects an invalid timezone string', async () => {
    const i = fakeChatInputInteraction({
      options: { strings: { timezone: 'Not/A_Timezone' } },
    });

    await timezoneExecute(i);

    expect(i.reply).toHaveBeenCalledWith(
      expect.objectContaining({ content: expect.stringContaining('Invalid IANA timezone') }),
    );
    expect(refreshServerDigest).not.toHaveBeenCalled();
  });
});
