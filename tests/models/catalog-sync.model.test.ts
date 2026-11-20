/**
 * Catalog syncs: each is idle or running, and each can be started from more
 * than one place. The sealed (MTGJSON) sync starts from the boot warm-up and
 * the 16:00 UTC cron; the Pokémon (TCGCSV) sync from the boot warm-up, the
 * 21:00 UTC cron, and `/admin games` enabling the game. A second start while a
 * run is in flight should join it, not download the catalog again alongside it.
 * `syncPokemonCatalog` keeps an `inFlight` promise for exactly this; the
 * sealed sync has no such guard.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { syncSealedCatalog } from '../../src/services/sealed.js';
import { syncPokemonCatalog } from '../../src/services/tcgcsv.js';
import { setupTestDb } from '../helpers/db.js';
import { explore, formatTrace, violationOf, type Machine } from '../helpers/model-check.js';

type Event = 'start' | 'finish';

interface State {
  /** Downloads in progress. */
  downloads: number;
  /** Callers waiting on a run. */
  waiting: number;
}

/** `coalesce`: a start while a run is in flight joins it (Pokémon) or starts another (sealed). */
const syncMachine = (coalesce: boolean): Machine<State, Event> => ({
  init: { downloads: 0, waiting: 0 },
  events: () => ['start', 'finish'],
  step(s, event) {
    if (event === 'start') {
      if (s.waiting >= 3) return null;
      const downloads = coalesce && s.downloads > 0 ? s.downloads : s.downloads + 1;
      return { downloads, waiting: s.waiting + 1 };
    }
    // A finish settles every caller waiting on that download.
    if (s.downloads === 0) return null;
    return coalesce
      ? { downloads: 0, waiting: 0 }
      : { downloads: s.downloads - 1, waiting: s.waiting - 1 };
  },
  invariants: { oneDownloadAtATime: (s) => s.downloads <= 1 },
});

describe('catalog sync model', () => {
  it('the Pokémon sync never runs two downloads at once', () => {
    expect(explore(syncMachine(true), 6).violations).toEqual([]);
  });

  it.fails('the sealed sync never runs two downloads at once', () => {
    const violation = violationOf(explore(syncMachine(false), 6), 'oneDownloadAtATime');
    // start → start: the boot warm-up and the cron (or two boots in quick succession).
    expect(violation, violation && formatTrace(violation.trace)).toBeUndefined();
  });
});

describe('catalog sync model conforms to the real code', () => {
  setupTestDb();

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  /** A fetch that never answers, counting the requests to `url`. */
  function hangingFetch(match: string): { count: () => number } {
    let calls = 0;
    vi.stubGlobal('fetch', (input: string | URL) => {
      if (String(input).includes(match)) calls += 1;
      return new Promise(() => undefined);
    });
    return { count: () => calls };
  }

  const settle = () => new Promise<void>((resolve) => setImmediate(resolve));

  it('a second Pokémon start joins the first run', async () => {
    const requests = hangingFetch('last-updated.txt');
    const first = syncPokemonCatalog({ requestIntervalMs: 0 });
    const second = syncPokemonCatalog({ requestIntervalMs: 0 });
    await settle();
    expect(second).toBe(first);
    expect(requests.count()).toBe(1);
  });

  it.fails('a second sealed start joins the first run', async () => {
    const requests = hangingFetch('Meta.json');
    void syncSealedCatalog();
    void syncSealedCatalog();
    await settle();
    expect(requests.count()).toBe(1);
  });
});
