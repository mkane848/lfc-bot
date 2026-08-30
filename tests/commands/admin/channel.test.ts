import { beforeEach, describe, expect, it } from 'vitest';
import { getDb } from '../../../src/db/index.js';
import { servers, type NewServerRow } from '../../../src/db/schema.js';
import { execute as channelExecute } from '../../../src/commands/admin/channel.js';
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

describe('/admin channel', () => {
  it('persists the chosen channel and replies with confirmation', async () => {
    const i = fakeChatInputInteraction({
      options: { channels: { channel: { id: 'channel-42' } } },
    });

    await channelExecute(i);

    expect(i.reply).toHaveBeenCalledWith(
      expect.objectContaining({ content: expect.stringContaining('<#channel-42>') }),
    );
    expect(getDb().select().from(servers).all()[0]?.adminChannelId).toBe('channel-42');
  });
});
