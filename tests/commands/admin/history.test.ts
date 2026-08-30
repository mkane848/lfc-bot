import { beforeEach, describe, expect, it } from 'vitest';
import { getDb } from '../../../src/db/index.js';
import { servers, type NewServerRow } from '../../../src/db/schema.js';
import { execute as historyExecute } from '../../../src/commands/admin/history.js';
import { recordAdminAction } from '../../../src/services/audit-log.js';
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

describe('/admin history', () => {
  it('shows "No admin actions recorded" when there are none', async () => {
    const i = fakeChatInputInteraction({});

    await historyExecute(i);

    const call = i.reply.mock.calls[0]?.[0] as {
      embeds: Array<{ toJSON: () => { description?: string } }>;
    };
    expect(call.embeds[0]!.toJSON().description).toContain('No admin actions recorded');
  });

  it('lists recorded actions', async () => {
    recordAdminAction({
      serverId: 'guild-1',
      adminId: 'admin-1',
      adminUsername: 'admin',
      action: 'mode',
      details: { mode: 'channel' },
    });
    const i = fakeChatInputInteraction({});

    await historyExecute(i);

    const call = i.reply.mock.calls[0]?.[0] as {
      embeds: Array<{ toJSON: () => { description?: string } }>;
    };
    expect(call.embeds[0]!.toJSON().description).toContain('/admin mode');
  });
});
