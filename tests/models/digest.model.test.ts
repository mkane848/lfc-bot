/**
 * The digest watermark: `servers.last_digest_at` decides which listings the
 * next digest carries. A run selects active listings created in
 * `[last_digest_at, now]`, awaits delivery, and on success sets the watermark
 * to the time delivery *finished*. Turning digests on initializes the
 * watermark, but only the first time (`initializeWatermarkIfNeeded`).
 *
 * The model has a clock of a few discrete ticks (one tick is one millisecond of
 * real time), up to two listings, and up to two runs in flight, since a
 * scheduled run and `/admin digest` can overlap. Each run is split into the
 * `start` that selects listings and the `ok`/`fail` that finishes delivery, so
 * the search covers everything that can happen while a send is awaited.
 */
import type { Client } from 'discord.js';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { execute as modeExecute } from '../../src/commands/admin/mode.js';
import { getDb } from '../../src/db/index.js';
import { digestLog } from '../../src/db/schema.js';
import { getServerConfig, upsertServerConfig } from '../../src/services/digest-state.js';
import { runDigest } from '../../src/services/digest.js';
import { createListing } from '../../src/services/listings.js';
import { setupTestDb } from '../helpers/db.js';
import { FAKE_GAME_ID, registerFakeGame, unregisterFakeGame } from '../helpers/games.js';
import { fakeChatInputInteraction } from '../helpers/interaction.js';
import {
  explore,
  formatTrace,
  run,
  traces,
  violationOf,
  type Machine,
} from '../helpers/model-check.js';
import { clearTables, seedServer } from './support.js';

vi.mock('node-cron', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node-cron')>();
  return { ...actual, default: { ...actual.default, schedule: () => ({ stop: () => undefined }) } };
});
// One attempt per send, so a failed delivery fails now instead of after real backoff delays.
vi.mock('../../src/utils/retry.js', () => ({
  retryWithBackoff: <T>(fn: () => Promise<T>) => fn(),
}));
vi.mock('../../src/services/alerts.js', () => ({ sendCriticalAlert: vi.fn() }));
vi.mock('../../src/services/game-catalogs.js', () => ({ refreshCatalogIfStale: vi.fn() }));

type Game = 'a' | 'b';
type Event =
  | 'tick'
  | 'modeOn'
  | 'modeOff'
  | 'toggleB'
  | { post: Game }
  | 'start'
  | { ok: number }
  | { fail: number };

interface Listing {
  created: number;
  game: Game;
  sent: number;
  /** Ghost: digests were on when it was posted, so a digest owes it delivery. */
  owed: boolean;
  /** Ghost: its game was disabled when it was posted. */
  postedWhileDisabled: boolean;
}

interface State {
  t: number;
  on: boolean;
  watermark: number | null;
  /** Game `a` is always enabled; `b` can be switched off and on. */
  bEnabled: boolean;
  listings: Listing[];
  /** Runs in flight: the indexes of the listings each selected. */
  runs: number[][];
}

interface Options {
  maxTicks: number;
  maxListings: number;
  maxRuns: number;
  /**
   * Whether two events can share a millisecond. With `false`, the clock moves
   * after every run finishes, which rules out ties with the watermark.
   */
  sameMillisecond: boolean;
}

export function digestMachine(options: Options): Machine<State, Event> {
  const selectable = (s: State) =>
    s.listings.flatMap((l, i) =>
      (l.game === 'a' || s.bEnabled) && l.created >= (s.watermark ?? 0) && l.created <= s.t
        ? [i]
        : [],
    );
  return {
    init: { t: 0, on: false, watermark: null, bEnabled: true, listings: [], runs: [] },
    events: (s) => [
      'tick',
      'modeOn',
      'modeOff',
      'toggleB',
      { post: 'a' },
      { post: 'b' },
      'start',
      ...s.runs.flatMap((_, i) => [{ ok: i }, { fail: i }]),
    ],
    step(s, event) {
      if (event === 'tick') {
        return s.t < options.maxTicks ? { ...s, t: s.t + 1 } : null;
      }
      if (event === 'modeOn') {
        if (s.on) return null;
        return {
          ...s,
          on: true,
          watermark: s.watermark ?? s.t,
          // A listing posted in the same millisecond digests turn on is owed too.
          listings: s.listings.map((l) => (l.created === s.t ? { ...l, owed: true } : l)),
        };
      }
      if (event === 'modeOff') {
        return s.on ? { ...s, on: false } : null;
      }
      if (event === 'toggleB') {
        return { ...s, bEnabled: !s.bEnabled };
      }
      if (event === 'start') {
        // Both the cron callback and `/admin digest` check the mode first; a
        // run that selects nothing returns before sending anything.
        if (!s.on || s.runs.length >= options.maxRuns) return null;
        const selected = selectable(s);
        return selected.length === 0 ? null : { ...s, runs: [...s.runs, selected] };
      }
      if ('post' in event) {
        if (s.listings.length >= options.maxListings) return null;
        const listing: Listing = {
          created: s.t,
          game: event.post,
          sent: 0,
          owed: s.on,
          postedWhileDisabled: event.post === 'b' && !s.bEnabled,
        };
        return { ...s, listings: [...s.listings, listing] };
      }
      if ('ok' in event) {
        const selected = s.runs[event.ok];
        if (!selected) return null;
        const after: State = {
          ...s,
          watermark: s.t,
          listings: s.listings.map((l, i) =>
            selected.includes(i) ? { ...l, sent: l.sent + 1 } : l,
          ),
          runs: s.runs.filter((_, i) => i !== event.ok),
        };
        if (!options.sameMillisecond) {
          if (s.t >= options.maxTicks) return null;
          after.t = s.t + 1;
        }
        return after;
      }
      if (!s.runs[event.fail]) return null;
      return { ...s, runs: s.runs.filter((_, i) => i !== event.fail) };
    },
    invariants: {
      // A listing posted while digests were on is never skipped by the watermark.
      noListingLost: (s) =>
        s.listings.every(
          (l) =>
            !(
              l.owed &&
              l.game === 'a' &&
              l.sent === 0 &&
              s.watermark !== null &&
              s.watermark > l.created
            ),
        ),
      // Turning digests back on does not send what was posted while they were off.
      noBacklogFlood: (s) => s.listings.every((l) => l.owed || l.sent === 0),
      noDuplicate: (s) => s.listings.every((l) => l.sent <= 1),
      // `prepareDigestListings`: disabled-game listings "appear again if the game is re-enabled".
      disabledGameListingsReturn: (s) =>
        s.listings.every(
          (l) =>
            !(
              l.postedWhileDisabled &&
              l.owed &&
              s.bEnabled &&
              l.sent === 0 &&
              s.watermark !== null &&
              s.watermark > l.created
            ),
        ),
    },
  };
}

const full = digestMachine({ maxTicks: 2, maxListings: 2, maxRuns: 2, sameMillisecond: true });

describe('digest model', () => {
  const result = explore(full, 8);
  const trace = (invariant: string) => {
    const violation = violationOf(result, invariant);
    return violation && formatTrace(violation.trace);
  };

  it.fails('a listing posted while a digest is being sent is not skipped', () => {
    expect(violationOf(result, 'noListingLost'), trace('noListingLost')).toBeUndefined();
  });

  it.fails('turning digests off and on again does not send the backlog', () => {
    expect(violationOf(result, 'noBacklogFlood'), trace('noBacklogFlood')).toBeUndefined();
  });

  it.fails('no listing is sent twice', () => {
    expect(violationOf(result, 'noDuplicate'), trace('noDuplicate')).toBeUndefined();
  });

  it.fails("a disabled game's listings come back when it is enabled again", () => {
    const violation = violationOf(result, 'disabledGameListingsReturn');
    expect(violation, trace('disabledGameListingsReturn')).toBeUndefined();
  });

  it.fails('runs that never overlap still never send a listing twice', () => {
    // One run at a time: the duplicate comes from the inclusive `>=` on a
    // watermark equal to a listing's creation millisecond.
    const sequential = explore(
      digestMachine({ maxTicks: 2, maxListings: 2, maxRuns: 1, sameMillisecond: true }),
      8,
    );
    const violation = violationOf(sequential, 'noDuplicate');
    expect(violation, violation && formatTrace(violation.trace)).toBeUndefined();
  });

  it.fails('runs at distinct milliseconds never send a listing twice', () => {
    // No ties with the watermark: the duplicate comes from two runs overlapping.
    const distinct = explore(
      digestMachine({ maxTicks: 3, maxListings: 2, maxRuns: 2, sameMillisecond: false }),
      8,
    );
    const violation = violationOf(distinct, 'noDuplicate');
    expect(violation, violation && formatTrace(violation.trace)).toBeUndefined();
  });

  it('reports the shortest counterexamples', () => {
    expect({
      noListingLost: trace('noListingLost'),
      noBacklogFlood: trace('noBacklogFlood'),
      noDuplicate: trace('noDuplicate'),
      disabledGameListingsReturn: trace('disabledGameListingsReturn'),
    }).toMatchInlineSnapshot(`
      {
        "disabledGameListingsReturn": "modeOn → toggleB → post(a) → post(b) → tick → start → toggleB → ok(0)",
        "noBacklogFlood": "modeOn → modeOff → post(a) → tick → modeOn → start → ok(0)",
        "noDuplicate": "modeOn → post(a) → start → start → ok(0) → ok(0)",
        "noListingLost": "modeOn → post(a) → start → post(a) → tick → ok(0)",
      }
    `);
  });
});

describe('digest model conforms to the real code', () => {
  setupTestDb();

  const base = new Date('2026-01-01T00:00:00Z').getTime();

  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] });
    registerFakeGame();
  });

  afterEach(() => {
    unregisterFakeGame();
    vi.useRealTimers();
  });

  const settle = () => new Promise<void>((resolve) => setImmediate(resolve));

  interface Pending {
    content: string | null;
    resolve: () => void;
    reject: (err: Error) => void;
  }

  /** A client whose channel holds each send open until the test settles it. */
  function runClient(pending: Pending): Client {
    const send = vi.fn(({ content }: { content: string }) => {
      pending.content = content;
      return new Promise<void>((resolve, reject) => {
        pending.resolve = resolve;
        pending.reject = reject;
      });
    });
    return {
      channels: {
        fetch: vi.fn().mockResolvedValue({ isTextBased: () => true, isSendable: () => true, send }),
      },
      users: { fetch: vi.fn() },
    } as unknown as Client;
  }

  function sentCounts(): number[] {
    const counts = [0, 0];
    for (const row of getDb().select().from(digestLog).all()) {
      if (!(JSON.parse(row.deliveryResults) as { channel: boolean }).channel) continue;
      for (const id of JSON.parse(row.listingIdsIncluded) as number[]) {
        counts[ids.indexOf(id)]! += 1;
      }
    }
    return counts;
  }

  let ids: number[] = [];

  it('every trace of five events leaves the digest where the model says', async () => {
    const machine = digestMachine({
      maxTicks: 1,
      maxListings: 2,
      maxRuns: 2,
      sameMillisecond: true,
    });
    const all = traces(machine, 5);
    expect(all.length).toBeGreaterThan(500);
    for (const trace of all) {
      clearTables();
      vi.setSystemTime(base);
      seedServer({
        adminChannelId: 'channel-1',
        enabledGames: JSON.stringify(['mtg', FAKE_GAME_ID]),
      });
      ids = [];
      const runs: Array<{ pending: Pending; done: Promise<unknown> }> = [];
      const expected = run(machine, trace);
      for (const [index, event] of trace.entries()) {
        if (event === 'tick') {
          vi.setSystemTime(Date.now() + 1);
        } else if (event === 'modeOn' || event === 'modeOff') {
          await modeExecute(
            fakeChatInputInteraction({
              client: runClient({
                content: null,
                resolve: () => undefined,
                reject: () => undefined,
              }),
              options: { strings: { mode: event === 'modeOn' ? 'channel' : 'disabled' } },
            }),
          );
        } else if (event === 'toggleB') {
          const games = JSON.parse(getServerConfig('guild-1')!.enabledGames) as string[];
          upsertServerConfig({
            serverId: 'guild-1',
            enabledGames: games.includes(FAKE_GAME_ID)
              ? games.filter((id) => id !== FAKE_GAME_ID)
              : [...games, FAKE_GAME_ID],
          });
        } else if (event === 'start') {
          const pending: Pending = {
            content: null,
            resolve: () => undefined,
            reject: () => undefined,
          };
          const done = runDigest(runClient(pending), getServerConfig('guild-1')!, 'manual');
          await settle();
          if (pending.content !== null) runs.push({ pending, done });
        } else if ('post' in event) {
          ids.push(
            createListing({
              serverId: 'guild-1',
              userId: `user-${ids.length}`,
              username: 'alice',
              intent: 'have',
              accepts: 'cash',
              cardName: `Card${ids.length}`,
              cardNameNormalized: `card${ids.length}`,
              game: event.post === 'a' ? 'mtg' : FAKE_GAME_ID,
            }).listing.id,
          );
        } else {
          const at = 'ok' in event ? event.ok : event.fail;
          const [finished] = runs.splice(at, 1);
          if ('ok' in event) finished!.pending.resolve();
          else finished!.pending.reject(new Error('send failed'));
          await finished!.done;
        }

        const model = expected[index]!;
        const server = getServerConfig('guild-1')!;
        const counts = sentCounts();
        const actual = {
          t: Date.now() - base,
          on: server.digestMode !== 'disabled',
          watermark: server.lastDigestAt === null ? null : server.lastDigestAt - base,
          bEnabled: server.enabledGames.includes(FAKE_GAME_ID),
          sent: ids.map((_, i) => counts[i]),
          runs: runs.map(({ pending }) =>
            ids.flatMap((_, i) => (pending.content?.includes(`Card${i} `) ? [i] : [])),
          ),
        };
        expect(actual, formatTrace(trace.slice(0, index + 1))).toEqual({
          t: model.t,
          on: model.on,
          watermark: model.watermark,
          bEnabled: model.bEnabled,
          sent: model.listings.map((l) => l.sent),
          runs: model.runs,
        });
      }
      for (const { pending, done } of runs) {
        pending.resolve();
        await done;
      }
    }
  }, 60_000);
});
