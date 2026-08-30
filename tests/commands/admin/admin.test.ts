import { PermissionFlagsBits } from 'discord.js';
import { beforeEach, describe, expect, it } from 'vitest';
import { getDb } from '../../../src/db/index.js';
import { servers, type NewServerRow } from '../../../src/db/schema.js';
import { adminCommand } from '../../../src/commands/admin/admin.js';
import { listRecentAdminActions } from '../../../src/services/audit-log.js';
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

describe('/admin', () => {
  it('rejects a member without Manage Server, without dispatching or recording an action', async () => {
    const i = fakeChatInputInteraction({
      rawMemberPermissions: PermissionFlagsBits.SendMessages,
      options: { subcommand: 'config' },
    });

    await adminCommand.execute(i);

    expect(i.reply).toHaveBeenCalledWith(
      expect.objectContaining({ content: expect.stringContaining('Manage Server') }),
    );
    expect(listRecentAdminActions('guild-1')).toHaveLength(0);
  });

  it('dispatches to the matching subcommand and records the invocation for a Manage Server member', async () => {
    const i = fakeChatInputInteraction({
      rawMemberPermissions: PermissionFlagsBits.ManageGuild,
      options: { subcommand: 'config' },
    });

    await adminCommand.execute(i);

    // config's own handler replies with an embed rather than a plain content string.
    expect(i.reply).toHaveBeenCalledWith(expect.objectContaining({ embeds: expect.any(Array) }));
    const actions = listRecentAdminActions('guild-1');
    expect(actions).toHaveLength(1);
    expect(actions[0]?.action).toBe('config');
  });

  it('replies with an error for an unknown subcommand', async () => {
    const i = fakeChatInputInteraction({
      rawMemberPermissions: PermissionFlagsBits.ManageGuild,
      options: { subcommand: 'not-a-real-subcommand' },
    });

    await adminCommand.execute(i);

    expect(i.reply).toHaveBeenCalledWith(
      expect.objectContaining({ content: expect.stringContaining('Unknown admin subcommand') }),
    );
  });

  it('no longer registers the removed games subcommand', () => {
    const names = adminCommand.data.options.map((option) => option.toJSON().name);
    expect(names).not.toContain('games');
  });
});
