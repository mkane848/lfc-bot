import { describe, expect, it } from 'vitest';
import { getDb } from '../../src/db/index.js';
import { servers, type NewServerRow } from '../../src/db/schema.js';
import { listRecentAdminActions, recordAdminAction } from '../../src/services/audit-log.js';
import { setupTestDb } from '../helpers/db.js';

setupTestDb();

const serverRow: NewServerRow = {
  id: '400',
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

describe('audit log', () => {
  it('records an admin action with serialized details', () => {
    getDb().insert(servers).values(serverRow).run();
    recordAdminAction({
      serverId: '400',
      adminId: 'admin1',
      adminUsername: 'alice',
      action: 'mode',
      details: { mode: 'channel' },
    });

    const [entry] = listRecentAdminActions('400');
    expect(entry.adminId).toBe('admin1');
    expect(entry.adminUsername).toBe('alice');
    expect(entry.action).toBe('mode');
    expect(entry.details).toBe('{"mode":"channel"}');
  });

  it('records an action with no details as null', () => {
    getDb().insert(servers).values(serverRow).run();
    recordAdminAction({
      serverId: '400',
      adminId: 'admin1',
      adminUsername: 'alice',
      action: 'digest',
    });

    const [entry] = listRecentAdminActions('400');
    expect(entry.details).toBeNull();
  });

  it('returns the most recent actions first, scoped to the server', () => {
    getDb()
      .insert(servers)
      .values([serverRow, { ...serverRow, id: '401' }])
      .run();
    recordAdminAction({ serverId: '400', adminId: 'a', adminUsername: 'a', action: 'first' });
    recordAdminAction({
      serverId: '401',
      adminId: 'b',
      adminUsername: 'b',
      action: 'other-server',
    });
    recordAdminAction({ serverId: '400', adminId: 'a', adminUsername: 'a', action: 'second' });

    const entries = listRecentAdminActions('400');
    expect(entries.map((e) => e.action)).toEqual(['second', 'first']);
  });

  it('limits the number of returned actions', () => {
    getDb().insert(servers).values(serverRow).run();
    for (let i = 0; i < 15; i += 1) {
      recordAdminAction({
        serverId: '400',
        adminId: 'a',
        adminUsername: 'a',
        action: `action-${i}`,
      });
    }

    expect(listRecentAdminActions('400')).toHaveLength(10);
    expect(listRecentAdminActions('400', 3)).toHaveLength(3);
  });
});
