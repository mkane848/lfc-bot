/**
 * The listing lifecycle: `listings.status` moves from `active` to `expired`,
 * `fulfilled`, or `deleted`. The model below is an abstraction of what
 * `src/services/listings.ts` and `src/services/listing-expiry.ts` do today; the
 * invariants are what AGENTS.md and the command docs say should hold (`/fulfill`
 * and `/delete` are documented as terminal).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { getListingById } from '../../src/services/listings.js';
import {
  createListing,
  fulfillListing,
  softDeleteListing,
  updateListing,
} from '../../src/services/listings.js';
import { expireListings } from '../../src/services/listing-expiry.js';
import { LISTING_TTL_MS } from '../../src/utils/constants.js';
import { setupTestDb } from '../helpers/db.js';
import {
  explore,
  formatTrace,
  run,
  traces,
  violationOf,
  type Machine,
} from '../helpers/model-check.js';
import { clearTables, DAY_MS, seedServer } from './support.js';

type Status = 'none' | 'active' | 'expired' | 'fulfilled' | 'deleted';
type Event = 'post' | 'pastExpiry' | 'sweep' | 'fulfill' | 'delete' | 'edit';

interface State {
  status: Status;
  /** The clock is past the listing's `expiresAt`. */
  pastExpiry: boolean;
  /** How many edits were written. */
  edits: number;
  // Ghost variables: history the invariants need, not part of the real row.
  /** The status the listing first left `active` for. */
  closedAs: Status | null;
  editedWhileClosed: boolean;
}

const closed = (status: Status) => status !== 'none' && status !== 'active';

/** What the code does: every transition is an unconditional `UPDATE ... WHERE id = ?`. */
export const listingMachine: Machine<State, Event> = {
  init: { status: 'none', pastExpiry: false, edits: 0, closedAs: null, editedWhileClosed: false },
  events: () => ['post', 'pastExpiry', 'sweep', 'fulfill', 'delete', 'edit'],
  step(s, event) {
    if (event === 'post') {
      return s.status === 'none' ? { ...s, status: 'active' } : null;
    }
    if (s.status === 'none') {
      return null;
    }
    const close = (status: Status): State => ({
      ...s,
      status,
      closedAs: s.closedAs ?? status,
    });
    switch (event) {
      case 'pastExpiry':
        return s.pastExpiry ? null : { ...s, pastExpiry: true };
      case 'sweep':
        // `expireListings`: WHERE status = 'active' AND expires_at <= now.
        return s.status === 'active' && s.pastExpiry ? close('expired') : s;
      case 'fulfill':
        // `setStatus`: WHERE id = ?, whatever the current status.
        return close('fulfilled');
      case 'delete':
        return close('deleted');
      case 'edit':
        // `updateListing` and `handleEditModal` never look at the status.
        return {
          ...s,
          edits: s.edits + 1,
          editedWhileClosed: s.editedWhileClosed || closed(s.status),
        };
    }
  },
  invariants: {
    closedIsTerminal: (s) => s.closedAs === null || s.status === s.closedAs,
    noEditAfterClose: (s) => !s.editedWhileClosed,
    // Search and digests filter on `status`, so an active row is visible.
    activeMeansUnexpired: (s) => !(s.status === 'active' && s.pastExpiry),
  },
  // Two edits look the same as one to every invariant; cap them so the search stays finite.
  key: (s) => JSON.stringify({ ...s, edits: Math.min(s.edits, 2) }),
};

describe('listing model', () => {
  const result = explore(listingMachine, 6);

  it.fails('a fulfilled, deleted, or expired listing never changes status again', () => {
    const violation = violationOf(result, 'closedIsTerminal');
    // Shortest counterexample: post → fulfill → delete (or the reverse).
    expect(violation, violation && formatTrace(violation.trace)).toBeUndefined();
  });

  it.fails('a closed listing is never edited', () => {
    const violation = violationOf(result, 'noEditAfterClose');
    expect(violation, violation && formatTrace(violation.trace)).toBeUndefined();
  });

  it.fails('an active listing is never past its expiry', () => {
    // post → pastExpiry: visible in search until the next hourly sweep.
    const violation = violationOf(result, 'activeMeansUnexpired');
    expect(violation, violation && formatTrace(violation.trace)).toBeUndefined();
  });

  it('reports the shortest counterexamples', () => {
    expect(violationOf(result, 'closedIsTerminal')?.trace).toEqual(['post', 'fulfill', 'delete']);
    expect(violationOf(result, 'noEditAfterClose')?.trace).toEqual(['post', 'fulfill', 'edit']);
    expect(violationOf(result, 'activeMeansUnexpired')?.trace).toEqual(['post', 'pastExpiry']);
  });
});

describe('listing model conforms to the real code', () => {
  setupTestDb();

  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-01-01T00:00:00Z'));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('every trace of four events leaves the row where the model says', () => {
    const all = traces(listingMachine, 4);
    expect(all.length).toBeGreaterThan(100);
    const start = Date.now();
    for (const trace of all) {
      clearTables();
      vi.setSystemTime(start);
      seedServer();
      let id = 0;
      const expected = run(listingMachine, trace);
      trace.forEach((event, index) => {
        switch (event) {
          case 'post':
            id = createListing({
              serverId: 'guild-1',
              userId: 'u1',
              username: 'alice',
              intent: 'have',
              accepts: 'cash',
              cardName: 'Black Lotus',
              cardNameNormalized: 'black lotus',
            }).listing.id;
            break;
          case 'pastExpiry':
            vi.setSystemTime(start + LISTING_TTL_MS + DAY_MS);
            break;
          case 'sweep':
            expireListings();
            break;
          case 'fulfill':
            fulfillListing(id);
            break;
          case 'delete':
            softDeleteListing(id);
            break;
          case 'edit':
            updateListing(id, { notes: String(Number(getListingById(id)?.notes ?? 0) + 1) });
            break;
        }
        const model = expected[index]!;
        const row = getListingById(id);
        const actual = {
          status: row?.status ?? 'none',
          pastExpiry: row ? Date.now() >= row.expiresAt : model.pastExpiry,
          edits: Number(row?.notes ?? 0),
        };
        expect(actual, formatTrace(trace.slice(0, index + 1))).toEqual({
          status: model.status,
          pastExpiry: model.pastExpiry,
          edits: model.edits,
        });
      });
    }
  });
});
