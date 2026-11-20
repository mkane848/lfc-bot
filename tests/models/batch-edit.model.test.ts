/**
 * The batch-edit queue. Picking several listings in `/mylistings`' "edit"
 * select opens the first one's edit modal; saving it shows an "Edit #N next"
 * button, which opens the next modal, until the queue is empty. No state is
 * kept on the server: the remaining queue rides along in each modal's and
 * button's custom id (`encodeEditModalId` / `encodeEditNextId`), and Discord
 * caps a custom id at 100 characters.
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { handleBatchSelect } from '../../src/commands/user/mylistings.js';
import { getDb } from '../../src/db/index.js';
import { listings } from '../../src/db/schema.js';
import {
  encodeBatchSelectId,
  encodeEditModalId,
  encodeEditNextId,
} from '../../src/utils/customId.js';
import { setupTestDb } from '../helpers/db.js';
import { fakeSelectMenuInteraction } from '../helpers/interaction.js';
import { explore, formatTrace, violationOf, type Machine } from '../helpers/model-check.js';
import { seedServer } from './support.js';

/** `/mylistings` offers at most this many listings in the select (`BATCH_SELECT_LIMIT`). */
const SELECT_LIMIT = 25;
const CUSTOM_ID_MAX = 100;

/** `count` listing ids that are each `digits` long, as a server that far along would have. */
const idsOf = (digits: number, count: number) =>
  Array.from({ length: count }, (_, i) => 10 ** (digits - 1) + i);

type Event = { select: { count: number; digits: number } } | 'save' | 'next';

interface State {
  phase: 'idle' | 'modal' | 'button' | 'done';
  /** The listing ids not yet edited, the one on screen first. */
  queue: number[];
  /** The longest custom id built so far. */
  longest: number;
}

const machine: Machine<State, Event> = {
  init: { phase: 'idle', queue: [], longest: 0 },
  events: (s) =>
    s.phase === 'idle'
      ? Array.from({ length: SELECT_LIMIT }, (_, i) =>
          [1, 2, 3, 4, 5, 6].map((digits) => ({ select: { count: i + 1, digits } })),
        ).flat()
      : ['save', 'next'],
  step(s, event) {
    if (typeof event === 'object') {
      if (s.phase !== 'idle') return null;
      const [first, ...rest] = idsOf(event.select.digits, event.select.count);
      const id = encodeEditModalId(first!, rest);
      return { phase: 'modal', queue: [first!, ...rest], longest: id.length };
    }
    if (event === 'save') {
      if (s.phase !== 'modal') return null;
      const [, next, ...rest] = s.queue;
      if (next === undefined) return { ...s, phase: 'done', queue: [] };
      const id = encodeEditNextId(next, rest);
      return { phase: 'button', queue: [next, ...rest], longest: Math.max(s.longest, id.length) };
    }
    if (s.phase !== 'button') return null;
    const [current, ...rest] = s.queue;
    const id = encodeEditModalId(current!, rest);
    return { ...s, phase: 'modal', longest: Math.max(s.longest, id.length) };
  },
  invariants: {
    customIdsFit: (s) => s.longest <= CUSTOM_ID_MAX,
  },
};

describe('batch-edit queue model', () => {
  it.fails('every custom id the queue builds fits in 100 characters', () => {
    const violation = violationOf(explore(machine, 3), 'customIdsFit');
    expect(violation, violation && formatTrace(violation.trace)).toBeUndefined();
  });

  it('breaks once the selection is this large, by id length', () => {
    // The first modal carries the longest queue, so the select itself is what overflows.
    const smallestFailing = Object.fromEntries(
      [1, 2, 3, 4, 5, 6].map((digits) => {
        const count = Array.from({ length: SELECT_LIMIT }, (_, i) => i + 1).find((n) => {
          const [first, ...rest] = idsOf(digits, n);
          return encodeEditModalId(first!, rest).length > CUSTOM_ID_MAX;
        });
        return [`${digits}-digit ids`, count ?? 'never'];
      }),
    );
    expect(smallestFailing).toEqual({
      '1-digit ids': 'never',
      '2-digit ids': 'never',
      '3-digit ids': 22,
      '4-digit ids': 18,
      '5-digit ids': 15,
      '6-digit ids': 13,
    });
  });
});

describe('batch-edit queue model conforms to the real code', () => {
  setupTestDb();

  beforeEach(() => {
    seedServer();
  });

  function seed(ids: number[]): void {
    for (const id of ids) {
      getDb()
        .insert(listings)
        .values({
          id,
          serverId: 'guild-1',
          userId: 'user-1',
          username: 'alice',
          intent: 'have',
          accepts: 'cash',
          cardName: `Card ${id}`,
          cardNameNormalized: `card ${id}`,
          condition: 'nm',
          expiresAt: Date.now() + 1000,
          createdAt: Date.now(),
          updatedAt: Date.now(),
        })
        .run();
    }
  }

  const select = (ids: number[]) =>
    handleBatchSelect(
      fakeSelectMenuInteraction({
        customId: encodeBatchSelectId('batchedit'),
        values: ids.map(String),
      }),
    );

  it('opens the modal while the queue fits', async () => {
    const ids = idsOf(3, 21);
    seed(ids);
    await expect(select(ids)).resolves.toBeUndefined();
  });

  it.fails('opens the modal for a full selection of 3-digit ids', async () => {
    // `buildEditModal` -> `ModalBuilder.setCustomId` throws "Invalid string length",
    // which `interactionCreate` turns into "Something went wrong" and a critical alert.
    const ids = idsOf(3, 22);
    seed(ids);
    await expect(select(ids)).resolves.toBeUndefined();
  });
});
