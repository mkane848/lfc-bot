import { describe, expect, it } from 'vitest';
import { commandMap, commands } from '../../src/commands/index.js';

describe('commands registry', () => {
  it('exposes every slash command the bot registers', () => {
    expect(commands.map((c) => c.name)).toEqual([
      'have',
      'have-multi',
      'have-sealed',
      'want',
      'want-multi',
      'want-sealed',
      'search',
      'mylistings',
      'edit',
      'fulfill',
      'delete',
      'help',
      'admin',
    ]);
  });

  it('builds the commandMap with one entry per command', () => {
    expect(commandMap.size).toBe(commands.length);
    for (const command of commands) {
      expect(commandMap.get(command.name)).toBe(command);
    }
  });

  it('assigns consistent names between the commands array and the map keys', () => {
    const names = new Set(commands.map((c) => c.name));
    expect(names.size).toBe(commands.length);
  });
});
