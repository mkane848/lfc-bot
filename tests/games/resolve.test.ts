import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  enabledGameIds,
  enabledGames,
  getGame,
  hasMultipleGames,
  listGames,
  parseEnabledGames,
  resolveGameForValue,
  splitGameTag,
  tagChoice,
} from '../../src/games/index.js';
import { setupTestDb } from '../helpers/db.js';
import {
  enableGames,
  FAKE_GAME_ID,
  registerFakeGame,
  unregisterFakeGame,
} from '../helpers/games.js';

setupTestDb();

beforeEach(() => {
  registerFakeGame();
});

afterEach(() => {
  unregisterFakeGame();
});

describe('game registry', () => {
  it('lists games in registration order, Magic first', () => {
    expect(listGames().map((game) => game.id)).toEqual(['mtg', FAKE_GAME_ID]);
  });

  it('forgets a game once it is unregistered', () => {
    unregisterFakeGame();
    expect(getGame(FAKE_GAME_ID)).toBeUndefined();
    expect(listGames().map((game) => game.id)).toEqual(['mtg']);
  });
});

describe('enabled games', () => {
  it('defaults to Magic for a server with no row', () => {
    expect(enabledGameIds('nobody')).toEqual(['mtg']);
    expect(hasMultipleGames('nobody')).toBe(false);
  });

  it('keeps the order games were enabled in', () => {
    enableGames('guild-1', [FAKE_GAME_ID, 'mtg']);
    expect(enabledGameIds('guild-1')).toEqual([FAKE_GAME_ID, 'mtg']);
    expect(enabledGames('guild-1').map((game) => game.label)).toEqual([
      'Fake Game',
      'Magic: The Gathering',
    ]);
    expect(hasMultipleGames('guild-1')).toBe(true);
  });

  it('drops a game that is no longer registered, and falls back to Magic if none is left', () => {
    enableGames('guild-1', [FAKE_GAME_ID]);
    unregisterFakeGame();
    expect(enabledGameIds('guild-1')).toEqual(['mtg']);
  });

  it('tolerates a malformed stored value', () => {
    expect(parseEnabledGames('not json')).toEqual([]);
    expect(parseEnabledGames('{"a":1}')).toEqual([]);
    expect(parseEnabledGames('["mtg", 3, null]')).toEqual(['mtg']);
    expect(parseEnabledGames(null)).toEqual([]);
  });
});

describe('splitGameTag', () => {
  it('splits a tagged value into its game and payload', () => {
    const split = splitGameTag('mtg:Black Lotus');
    expect(split?.game.id).toBe('mtg');
    expect(split?.payload).toBe('Black Lotus');
  });

  it('keeps colons inside the payload', () => {
    expect(splitGameTag('mtg:uuid:abc-123')?.payload).toBe('uuid:abc-123');
  });

  it('returns null for an untagged value or one tagged for no registered game', () => {
    expect(splitGameTag('Black Lotus')).toBeNull();
    expect(splitGameTag('xyz:Black Lotus')).toBeNull();
    unregisterFakeGame();
    expect(splitGameTag('fk:anything')).toBeNull();
  });
});

describe('tagChoice', () => {
  const mtg = getGame('mtg');

  it('tags the value and names the game in the label', () => {
    expect(mtg && tagChoice(mtg, { name: 'Black Lotus', value: 'Black Lotus' })).toEqual({
      name: 'Black Lotus · MTG',
      value: 'mtg:Black Lotus',
    });
  });

  it('shortens a long label so the game still fits within 100 characters', () => {
    const choice = mtg && tagChoice(mtg, { name: 'x'.repeat(100), value: 'short' });
    expect(choice?.name).toHaveLength(100);
    expect(choice?.name.endsWith('… · MTG')).toBe(true);
  });

  it('drops a choice whose tagged value would pass 100 characters', () => {
    expect(mtg && tagChoice(mtg, { name: 'n', value: 'v'.repeat(97) })).toBeNull();
    expect(mtg && tagChoice(mtg, { name: 'n', value: 'v'.repeat(96) })).not.toBeNull();
  });
});

describe('resolveGameForValue', () => {
  it('uses the picked suggestion’s game over the option and the default', () => {
    enableGames('guild-1', ['mtg', FAKE_GAME_ID]);
    const resolution = resolveGameForValue({
      serverId: 'guild-1',
      value: 'fk:Fake Card',
      gameOption: 'mtg',
    });
    expect(resolution).toMatchObject({ ok: true, value: 'Fake Card' });
    expect(resolution.ok && resolution.game.id).toBe(FAKE_GAME_ID);
  });

  it('uses the game option when the value is typed, not picked', () => {
    enableGames('guild-1', ['mtg', FAKE_GAME_ID]);
    const resolution = resolveGameForValue({
      serverId: 'guild-1',
      value: 'Fake Card',
      gameOption: FAKE_GAME_ID,
    });
    expect(resolution.ok && resolution.game.id).toBe(FAKE_GAME_ID);
    expect(resolution.ok && resolution.value).toBe('Fake Card');
  });

  it('falls back to the first game the server enabled', () => {
    enableGames('guild-1', [FAKE_GAME_ID, 'mtg']);
    const resolution = resolveGameForValue({ serverId: 'guild-1', value: 'Anything' });
    expect(resolution.ok && resolution.game.id).toBe(FAKE_GAME_ID);
  });

  it('is Magic on a server that never configured games', () => {
    const resolution = resolveGameForValue({ serverId: 'fresh', value: 'Black Lotus' });
    expect(resolution.ok && resolution.game.id).toBe('mtg');
  });

  it('rejects a game the server has not enabled, naming the ones it has', () => {
    enableGames('guild-1', ['mtg']);
    const resolution = resolveGameForValue({
      serverId: 'guild-1',
      value: 'Fake Card',
      gameOption: FAKE_GAME_ID,
    });
    expect(resolution.ok).toBe(false);
    expect(resolution.ok ? '' : resolution.message).toMatch(
      /Fake Game is not enabled.*Enabled: Magic: The Gathering.*\/admin games/,
    );
  });

  it('rejects a picked suggestion from a game that has since been disabled', () => {
    enableGames('guild-1', ['mtg']);
    const resolution = resolveGameForValue({ serverId: 'guild-1', value: 'fk:Fake Card' });
    expect(resolution.ok).toBe(false);
  });

  it('rejects an unknown game option', () => {
    const resolution = resolveGameForValue({
      serverId: 'guild-1',
      value: 'x',
      gameOption: 'nonsense',
    });
    expect(resolution).toEqual({ ok: false, message: 'Unknown game.' });
  });
});
