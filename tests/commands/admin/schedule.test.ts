import { beforeEach, describe, expect, it, vi } from 'vitest';
import { getDb } from '../../../src/db/index.js';
import { servers, type NewServerRow } from '../../../src/db/schema.js';
import { execute as scheduleExecute } from '../../../src/commands/admin/schedule.js';
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

describe('/admin schedule', () => {
  it('accepts natural-language time input', async () => {
    const i = fakeChatInputInteraction({ options: { strings: { time: 'every day at 9am' } } });

    await scheduleExecute(i);

    expect(i.reply).toHaveBeenCalledWith(
      expect.objectContaining({ content: expect.stringContaining('0 9 * * *') }),
    );
    expect(refreshServerDigest).toHaveBeenCalledWith(i.client, 'guild-1');
  });

  it('accepts a raw cron expression', async () => {
    const i = fakeChatInputInteraction({ options: { strings: { cron: '0 12 * * *' } } });

    await scheduleExecute(i);

    expect(i.reply).toHaveBeenCalledWith(
      expect.objectContaining({ content: expect.stringContaining('0 12 * * *') }),
    );
  });

  it('rejects when both time and cron are given', async () => {
    const i = fakeChatInputInteraction({
      options: { strings: { time: 'every day at 9am', cron: '0 12 * * *' } },
    });

    await scheduleExecute(i);

    expect(i.reply).toHaveBeenCalledWith(
      expect.objectContaining({ content: expect.stringContaining('not both') }),
    );
    expect(refreshServerDigest).not.toHaveBeenCalled();
  });

  it('rejects when neither time nor cron is given', async () => {
    const i = fakeChatInputInteraction({ options: {} });

    await scheduleExecute(i);

    expect(i.reply).toHaveBeenCalledWith(
      expect.objectContaining({ content: expect.stringContaining('Provide a schedule') }),
    );
  });

  it('rejects an invalid cron string', async () => {
    const i = fakeChatInputInteraction({ options: { strings: { cron: 'not a cron' } } });

    await scheduleExecute(i);

    expect(i.reply).toHaveBeenCalledWith(
      expect.objectContaining({ content: expect.stringContaining('Invalid cron expression') }),
    );
    expect(refreshServerDigest).not.toHaveBeenCalled();
  });
});
