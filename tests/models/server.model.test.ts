/**
 * A server's lifecycle, and the digest cron job the scheduler keeps for it.
 *
 * `servers.removed_at` is the state: null while the bot is in the guild, set
 * when it leaves, and the row (with its listings) is purged 30 days later. The
 * scheduler's in-memory `jobs` map is a cache of `digest_mode` that has to be
 * rebuilt whenever that changes. Both are driven only by gateway events
 * (`guildCreate`, `guildDelete`) and boot (`handleReady`), and the bot can be
 * offline when a guild adds or removes it. The model is what those handlers do
 * today; the invariants are what AGENTS.md promises.
 */
import type { Client } from 'discord.js';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { execute as modeExecute } from '../../src/commands/admin/mode.js';
import { handleGuildCreate } from '../../src/events/guildCreate.js';
import { handleGuildDelete } from '../../src/events/guildDelete.js';
import { handleReady } from '../../src/events/ready.js';
import { getServerConfig } from '../../src/services/digest-state.js';
import { purgeMarkedServers } from '../../src/services/listing-expiry.js';
import { stopAllJobs } from '../../src/services/scheduler.js';
import { GUILD_RETENTION_MS } from '../../src/utils/constants.js';
import { setupTestDb } from '../helpers/db.js';
import { fakeChatInputInteraction } from '../helpers/interaction.js';
import {
  explore,
  formatTrace,
  run,
  traces,
  violationOf,
  type Machine,
} from '../helpers/model-check.js';
import { clearTables, DAY_MS } from './support.js';

const cronState = vi.hoisted(() => ({
  active: new Set<{ expression: string }>(),
}));

// Record which cron tasks are running instead of starting real timers.
vi.mock('node-cron', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node-cron')>();
  const schedule = (expression: string) => {
    const task = {
      expression,
      stop: () => {
        cronState.active.delete(task);
      },
    };
    cronState.active.add(task);
    return task;
  };
  return { ...actual, default: { ...actual.default, schedule } };
});

// Boot must not reach the network.
vi.mock('../../src/services/sealed.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/services/sealed.js')>();
  return {
    ...actual,
    syncSealedCatalog: vi.fn().mockResolvedValue({ imported: 0, removed: 0 }),
  };
});
vi.mock('../../src/services/game-catalogs.js', () => ({
  warmUpGameCatalogs: vi.fn(),
  syncEnabledGameCatalogs: vi.fn(),
  refreshCatalogIfStale: vi.fn(),
}));

type Row = 'none' | 'live' | 'marked' | 'markedOld';
type Event =
  'join' | 'leave' | 'crash' | 'boot' | 'modeOn' | 'modeOff' | 'retentionElapses' | 'purge';

interface State {
  /** Discord's truth: the bot is in the guild. */
  member: boolean;
  /** The bot process is connected and receiving gateway events. */
  online: boolean;
  /** `live`: removed_at is null; `marked`: set; `markedOld`: set over 30 days ago. */
  row: Row;
  digestOn: boolean;
  /** The scheduler has a digest cron job for the server. */
  job: boolean;
  /** Ghost: the row was purged while the bot was in the guild. */
  purgedWhileMember: boolean;
}

export const serverMachine: Machine<State, Event> = {
  init: {
    member: false,
    online: true,
    row: 'none',
    digestOn: false,
    job: false,
    purgedWhileMember: false,
  },
  events: () => [
    'join',
    'leave',
    'crash',
    'boot',
    'modeOn',
    'modeOff',
    'retentionElapses',
    'purge',
  ],
  step(s, event) {
    switch (event) {
      case 'join':
        if (s.member) return null;
        // `handleGuildCreate`: clear the marker and upsert. It never touches the scheduler.
        return s.online ? { ...s, member: true, row: 'live' } : { ...s, member: true };
      case 'leave':
        if (!s.member) return null;
        // `handleGuildDelete`: cancel the job, mark the row if there is one.
        return s.online
          ? { ...s, member: false, job: false, row: s.row === 'none' ? 'none' : 'marked' }
          : { ...s, member: false };
      case 'crash':
        // The jobs map lives in memory.
        return s.online ? { ...s, online: false, job: false } : null;
      case 'boot': {
        if (s.online) return null;
        // `handleReady`: upsert every guild the bot is in (which never clears a
        // marker), then `scheduleAllDigests`, which selects on digest_mode alone.
        const row: Row = s.member && s.row === 'none' ? 'live' : s.row;
        const digestOn = row === 'none' ? false : s.digestOn;
        return { ...s, online: true, row, digestOn, job: row !== 'none' && digestOn };
      }
      case 'modeOn':
      case 'modeOff': {
        // `/admin mode`, which members can only run while the bot is there.
        if (!s.online || !s.member) return null;
        const digestOn = event === 'modeOn';
        return { ...s, row: s.row === 'none' ? 'live' : s.row, digestOn, job: digestOn };
      }
      case 'retentionElapses':
        return s.row === 'marked' ? { ...s, row: 'markedOld' } : null;
      case 'purge':
        // The hourly maintenance job. It deletes the row but leaves any cron job.
        if (!s.online || s.row !== 'markedOld') return null;
        return {
          ...s,
          row: 'none',
          digestOn: false,
          purgedWhileMember: s.purgedWhileMember || s.member,
        };
    }
  },
  invariants: {
    memberIsNotMarked: (s) =>
      !(s.online && s.member && (s.row === 'marked' || s.row === 'markedOld')),
    leftGuildIsMarked: (s) => !(s.online && !s.member && s.row === 'live'),
    neverPurgeAMember: (s) => !s.purgedWhileMember,
    jobMatchesConfig: (s) => !s.online || s.job === (s.member && s.row === 'live' && s.digestOn),
  },
};

describe('server lifecycle model', () => {
  const result = explore(serverMachine, 7);

  it.fails(
    'a guild that re-adds the bot while it is offline is not left marked for removal',
    () => {
      const violation = violationOf(result, 'memberIsNotMarked');
      expect(violation, violation && formatTrace(violation.trace)).toBeUndefined();
    },
  );

  it.fails('a guild that removes the bot while it is offline is marked for removal', () => {
    const violation = violationOf(result, 'leftGuildIsMarked');
    expect(violation, violation && formatTrace(violation.trace)).toBeUndefined();
  });

  it.fails('the retention purge never deletes a guild the bot is in', () => {
    const violation = violationOf(result, 'neverPurgeAMember');
    expect(violation, violation && formatTrace(violation.trace)).toBeUndefined();
  });

  it.fails('a server has a digest job exactly when it is live with digests on', () => {
    const violation = violationOf(result, 'jobMatchesConfig');
    expect(violation, violation && formatTrace(violation.trace)).toBeUndefined();
  });

  it('reports the shortest counterexamples', () => {
    const shortest = Object.fromEntries(
      result.violations.map((v) => [v.invariant, formatTrace(v.trace)]),
    );
    expect(shortest).toEqual({
      memberIsNotMarked: 'join → leave → crash → join → boot',
      leftGuildIsMarked: 'join → crash → leave → boot',
      neverPurgeAMember: 'join → leave → crash → join → boot → retentionElapses → purge',
      jobMatchesConfig: 'join → modeOn → leave → join',
    });
  });
});

describe('server lifecycle model conforms to the real code', () => {
  setupTestDb();

  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-01-01T00:00:00Z'));
  });

  afterEach(() => {
    stopAllJobs();
    vi.useRealTimers();
  });

  const client = (guildIds: string[]): Client =>
    ({
      user: { tag: 'LFCbot#0001' },
      guilds: { cache: new Map(guildIds.map((id) => [id, { id }])) },
      channels: { fetch: vi.fn() },
      users: { fetch: vi.fn() },
    }) as unknown as Client;
  const guild = { id: 'guild-1', name: 'Test' } as never;

  const project = (member: boolean, online: boolean, purgedWhileMember: boolean): State => {
    const row = getServerConfig('guild-1');
    const digestJobs = [...cronState.active].filter((task) => task.expression === '0 9 * * *');
    return {
      member,
      online,
      row: !row
        ? 'none'
        : row.removedAt === null
          ? 'live'
          : Date.now() - row.removedAt >= GUILD_RETENTION_MS
            ? 'markedOld'
            : 'marked',
      digestOn: row ? row.digestMode !== 'disabled' : false,
      job: digestJobs.length > 0,
      purgedWhileMember,
    };
  };

  it('every trace of five events leaves the server where the model says', async () => {
    const all = traces(serverMachine, 5);
    expect(all.length).toBeGreaterThan(100);
    for (const trace of all) {
      clearTables();
      stopAllJobs();
      vi.setSystemTime(new Date('2026-01-01T00:00:00Z'));
      const expected = run(serverMachine, trace);
      let member = false;
      let online = true;
      let purgedWhileMember = false;
      for (const [index, event] of trace.entries()) {
        switch (event) {
          case 'join':
            member = true;
            if (online) handleGuildCreate(guild);
            break;
          case 'leave':
            member = false;
            if (online) handleGuildDelete(guild);
            break;
          case 'crash':
            online = false;
            stopAllJobs();
            break;
          case 'boot':
            online = true;
            handleReady(client(member ? ['guild-1'] : []));
            break;
          case 'modeOn':
          case 'modeOff':
            await modeExecute(
              fakeChatInputInteraction({
                client: client(['guild-1']),
                options: { strings: { mode: event === 'modeOn' ? 'channel' : 'disabled' } },
              }),
            );
            break;
          case 'retentionElapses':
            vi.setSystemTime(Date.now() + GUILD_RETENTION_MS + DAY_MS);
            break;
          case 'purge':
            if (purgeMarkedServers(GUILD_RETENTION_MS) > 0 && member) purgedWhileMember = true;
            break;
        }
        expect(
          project(member, online, purgedWhileMember),
          formatTrace(trace.slice(0, index + 1)),
        ).toEqual(expected[index]);
      }
    }
  });
});
