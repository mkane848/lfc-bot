/**
 * A small, exhaustive, bounded model checker for the bot's implicit state
 * machines (see `tests/models/`).
 *
 * A `Machine` is an abstraction of what the code does: a state, the events
 * that can happen in it, and how each event changes it. Invariants say what
 * the code is supposed to guarantee. `explore` walks every event sequence up to
 * a depth, breadth first, so the first violation it reports for an invariant
 * comes with the shortest trace that breaks it.
 *
 * The abstraction is only worth something if it matches the code, so each
 * model also has a conformance test: `traces` lists the sequences, and the test
 * replays each one against the real services, comparing the real state, after
 * every step, with the model's.
 */

export interface Machine<S, E> {
  /** The state before any event. */
  init: S;
  /** The events to try in a state. */
  events: (state: S) => readonly E[];
  /** The state after `event`, or `null` when the event can't happen in `state`. */
  step: (state: S, event: E) => S | null;
  /** Named properties that must hold in every reachable state. */
  invariants: Record<string, (state: S) => boolean>;
  /** Identifies equal states, so each is expanded once. Defaults to `JSON.stringify`. */
  key?: (state: S) => string;
}

export interface Violation<S, E> {
  invariant: string;
  /** The shortest event sequence from `init` that reaches `state`. */
  trace: E[];
  state: S;
}

export interface ExploreResult<S, E> {
  /** The first (so shortest) violation found for each broken invariant. */
  violations: Violation<S, E>[];
  /** Distinct states reached. */
  states: number;
}

/**
 * Breadth-first search over every event sequence of at most `depth` events.
 * Reports at most one violation per invariant. A state that breaks one
 * invariant is still expanded, since what follows it can break another (a
 * server wrongly left marked for removal is what later gets purged).
 */
export function explore<S, E>(machine: Machine<S, E>, depth: number): ExploreResult<S, E> {
  const key = machine.key ?? ((state: S) => JSON.stringify(state));
  const seen = new Set<string>([key(machine.init)]);
  const found = new Map<string, Violation<S, E>>();
  let frontier: Array<{ state: S; trace: E[] }> = [{ state: machine.init, trace: [] }];

  const check = (state: S, trace: E[]): void => {
    for (const [name, holds] of Object.entries(machine.invariants)) {
      if (!found.has(name) && !holds(state)) {
        found.set(name, { invariant: name, trace, state });
      }
    }
  };

  check(machine.init, []);
  for (let level = 0; level < depth && frontier.length > 0; level += 1) {
    const next: typeof frontier = [];
    for (const { state, trace } of frontier) {
      for (const event of machine.events(state)) {
        const after = machine.step(state, event);
        if (after === null) {
          continue;
        }
        const id = key(after);
        if (seen.has(id)) {
          continue;
        }
        seen.add(id);
        const extended = [...trace, event];
        check(after, extended);
        next.push({ state: after, trace: extended });
      }
    }
    frontier = next;
  }
  return { violations: [...found.values()], states: seen.size };
}

/** The violation of `invariant`, or `undefined` when the search found none. */
export function violationOf<S, E>(
  result: ExploreResult<S, E>,
  invariant: string,
): Violation<S, E> | undefined {
  return result.violations.find((violation) => violation.invariant === invariant);
}

/**
 * Every enabled event sequence of exactly `length` events (no state dedup), for
 * conformance tests that replay each one against the real code. Keep `length`
 * small: the count grows as (events per state) ^ length.
 */
export function traces<S, E>(machine: Machine<S, E>, length: number): E[][] {
  let level: Array<{ state: S; trace: E[] }> = [{ state: machine.init, trace: [] }];
  for (let i = 0; i < length; i += 1) {
    const next: typeof level = [];
    for (const { state, trace } of level) {
      for (const event of machine.events(state)) {
        const after = machine.step(state, event);
        if (after !== null) {
          next.push({ state: after, trace: [...trace, event] });
        }
      }
    }
    level = next;
  }
  return level.map(({ trace }) => trace);
}

/** The model's state after each event of `trace`; throws if an event isn't enabled. */
export function run<S, E>(machine: Machine<S, E>, trace: readonly E[]): S[] {
  const states: S[] = [];
  let state = machine.init;
  for (const event of trace) {
    const after = machine.step(state, event);
    if (after === null) {
      throw new Error(`Event ${JSON.stringify(event)} is not enabled`);
    }
    state = after;
    states.push(state);
  }
  return states;
}

/** A trace as one readable line, for test names and failure messages. */
export function formatTrace(trace: readonly unknown[]): string {
  return trace.length === 0 ? '(initial state)' : trace.map(formatEvent).join(' → ');
}

/** `'tick'` stays `tick`; `{ post: 'a' }` becomes `post(a)`. */
function formatEvent(event: unknown): string {
  if (typeof event === 'string') {
    return event;
  }
  if (event && typeof event === 'object') {
    const entries: Array<[string, unknown]> = Object.entries(event);
    if (entries.length === 1) {
      const [name, value] = entries[0]!;
      return `${name}(${typeof value === 'string' ? value : JSON.stringify(value)})`;
    }
  }
  return JSON.stringify(event);
}
