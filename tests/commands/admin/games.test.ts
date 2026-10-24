import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { EmbedBuilder } from 'discord.js';
import { execute as gamesExecute } from '../../../src/commands/admin/games.js';
import { execute as configExecute } from '../../../src/commands/admin/config.js';
import { adminCommand } from '../../../src/commands/admin/admin.js';
import { listRecentAdminActions } from '../../../src/services/audit-log.js';
import { fakeChatInputInteraction } from '../../helpers/interaction.js';
import { setupTestDb } from '../../helpers/db.js';
import {
  enableGames,
  FAKE_GAME_ID,
  registerFakeGame,
  storedGames,
  unregisterFakeGame,
} from '../../helpers/games.js';

setupTestDb();

beforeEach(() => {
  registerFakeGame();
});

afterEach(() => {
  unregisterFakeGame();
});

function run(game: string, enabled: boolean, guildId = 'guild-1') {
  const i = fakeChatInputInteraction({
    guildId,
    options: { strings: { game }, booleans: { enabled } },
  });
  return gamesExecute(i).then(() => i);
}

function replied(i: Awaited<ReturnType<typeof run>>): string {
  const call = i.reply.mock.calls[0]?.[0] as { content: string };
  return call.content;
}

describe('/admin games', () => {
  it('enables a game, after the ones already enabled', async () => {
    const i = await run(FAKE_GAME_ID, true);
    expect(replied(i)).toBe('Fake Game enabled.');
    expect(storedGames('guild-1')).toEqual(['mtg', FAKE_GAME_ID]);
  });

  it('disables a game, keeping the others in order', async () => {
    enableGames('guild-1', ['mtg', FAKE_GAME_ID]);
    const i = await run('mtg', false);
    expect(replied(i)).toMatch(
      /Magic: The Gathering disabled.*kept.*hidden from search and digests/,
    );
    expect(storedGames('guild-1')).toEqual([FAKE_GAME_ID]);
  });

  it('will not disable the last enabled game', async () => {
    const i = await run('mtg', false);
    expect(replied(i)).toMatch(/only game enabled.*at least one has to stay enabled/);
    expect(storedGames('guild-1')).toEqual(['mtg']);
  });

  it('says so when a game is already in the state asked for, and changes nothing', async () => {
    expect(replied(await run('mtg', true))).toBe('Magic: The Gathering is already enabled.');
    expect(replied(await run(FAKE_GAME_ID, false))).toBe('Fake Game is already disabled.');
    expect(storedGames('guild-1')).toEqual(['mtg']);
  });

  it('rejects a game that is not registered, listing the ones that are', async () => {
    const i = await run('nonsense', true);
    expect(replied(i)).toBe(`Game not supported. Available: mtg, ${FAKE_GAME_ID}.`);
  });

  it('only changes the server it was run in', async () => {
    await run(FAKE_GAME_ID, true, 'guild-1');
    expect(storedGames('guild-2')).toEqual([]);
  });

  it('refuses outside a server', async () => {
    const i = fakeChatInputInteraction({
      guildId: null,
      options: { strings: { game: 'mtg' }, booleans: { enabled: true } },
    });
    await gamesExecute(i);
    expect(replied(i)).toMatch(/only be used inside a server/);
  });
});

describe('/admin games through /admin', () => {
  it('is dispatched and recorded in the audit log like every other subcommand', async () => {
    enableGames('guild-1', ['mtg']); // the audit log needs the server's row
    const i = fakeChatInputInteraction({
      rawMemberPermissions: 1n << 5n, // Manage Server
      options: {
        subcommand: 'games',
        strings: { game: FAKE_GAME_ID },
        booleans: { enabled: true },
        data: [
          {
            name: 'games',
            options: [
              { name: 'game', value: FAKE_GAME_ID },
              { name: 'enabled', value: true },
            ],
          },
        ],
      },
    });
    await adminCommand.execute(i);
    expect(storedGames('guild-1')).toEqual(['mtg', FAKE_GAME_ID]);
    const [action] = listRecentAdminActions('guild-1', 5);
    expect(action).toMatchObject({ action: 'games' });
    expect(action?.details).toContain(FAKE_GAME_ID);
  });
});

describe('/admin config', () => {
  it('names the enabled games rather than listing their ids', async () => {
    enableGames('guild-1', ['mtg', FAKE_GAME_ID]);
    const i = fakeChatInputInteraction({ options: { subcommand: 'config' } });
    await configExecute(i);
    const call = i.reply.mock.calls[0]?.[0] as { embeds: EmbedBuilder[] };
    const field = call.embeds[0]?.toJSON().fields?.find((f) => f.name === 'Enabled games');
    expect(field?.value).toBe('Magic: The Gathering, Fake Game');
  });
});
