import { describe, expect, it } from 'vitest';
import { explore, run, traces, violationOf, type Machine } from './model-check.js';

// A counter that can go up or reset, and must never reach 3.
const counter: Machine<number, 'inc' | 'reset'> = {
  init: 0,
  events: () => ['inc', 'reset'],
  step: (n, event) => (event === 'inc' ? n + 1 : n === 0 ? null : 0),
  invariants: { belowThree: (n) => n < 3, nonNegative: (n) => n >= 0 },
};

describe('explore', () => {
  it('finds the shortest trace that breaks an invariant', () => {
    const result = explore(counter, 5);
    expect(violationOf(result, 'belowThree')?.trace).toEqual(['inc', 'inc', 'inc']);
    expect(violationOf(result, 'nonNegative')).toBeUndefined();
  });

  it('finds nothing when the bound is too shallow to reach a violation', () => {
    expect(explore(counter, 2).violations).toEqual([]);
  });

  it('skips events that are not enabled', () => {
    // `reset` at 0 is disabled, so three steps reach only 0..3.
    expect(explore(counter, 3).states).toBe(4);
  });

  it('keeps expanding past a violation, to find what it leads to', () => {
    const leadsOn: Machine<number, 'inc' | 'reset'> = {
      ...counter,
      invariants: { belowThree: (n) => n < 3, belowFive: (n) => n < 5 },
    };
    expect(violationOf(explore(leadsOn, 5), 'belowFive')?.trace).toHaveLength(5);
  });
});

describe('traces and run', () => {
  it('enumerates every enabled sequence of a given length', () => {
    expect(traces(counter, 2)).toEqual([
      ['inc', 'inc'],
      ['inc', 'reset'],
    ]);
  });

  it('replays a trace through the model', () => {
    expect(run(counter, ['inc', 'inc', 'reset'] as const)).toEqual([1, 2, 0]);
    expect(() => run(counter, ['reset'] as const)).toThrow('not enabled');
  });
});
