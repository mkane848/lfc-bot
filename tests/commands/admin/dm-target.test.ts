import { beforeEach, describe, expect, it } from 'vitest';
import { getDb } from '../../../src/db/index.js';
import { servers, type NewServerRow } from '../../../src/db/schema.js';
import { execute as dmTargetExecute } from '../../../src/commands/admin/dm-target.js';
import { fakeChatInputInteraction } from '../../helpers/interaction.js';
import { setupTestDb } from '../../helpers/db.js';

setupTestDb();

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
});

describe('/admin dm-target', () => {
  it('persists the chosen user and replies with confirmation', async () => {
    const i = fakeChatInputInteraction({
      options: { users: { user: { id: 'user-42', username: 'bob' } } },
    });

    await dmTargetExecute(i);

    expect(i.reply).toHaveBeenCalledWith(
      expect.objectContaining({ content: expect.stringContaining('<@user-42>') }),
    );
    expect(getDb().select().from(servers).all()[0]?.digestDmUserId).toBe('user-42');
  });
});
