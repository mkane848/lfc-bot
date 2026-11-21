import { afterEach, describe, expect, it } from 'vitest';
import {
  getGame,
  isGameId,
  listGames,
  registerGame,
  unregisterGame,
} from '../../src/games/registry.js';
import { createFakeGame, FAKE_GAME_ID } from '../helpers/games.js';

afterEach(() => {
  unregisterGame(FAKE_GAME_ID);
});

describe('game registry', () => {
  it('looks a game up by id', () => {
    registerGame(createFakeGame());

    expect(isGameId(FAKE_GAME_ID)).toBe(true);
    expect(getGame(FAKE_GAME_ID)?.label).toBe('Fake Game');
  });

  it('stops reporting a game once it is unregistered', () => {
    registerGame(createFakeGame());
    unregisterGame(FAKE_GAME_ID);

    expect(isGameId(FAKE_GAME_ID)).toBe(false);
    expect(getGame(FAKE_GAME_ID)).toBeUndefined();
  });

  it('lists games in registration order and replaces a duplicate id in place', () => {
    const before = listGames().map((game) => game.id);
    registerGame(createFakeGame());
    registerGame({ ...createFakeGame(), label: 'Fake Game II' });

    expect(listGames().map((game) => game.id)).toEqual([...before, FAKE_GAME_ID]);
    expect(getGame(FAKE_GAME_ID)?.label).toBe('Fake Game II');
  });
});
